// User asset persistence routes.
// Mutable user data is stored in the runtime data directory, not the release tree.

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const {
  ensureDir,
  migrateLegacyDirectory,
  migrateLegacyFile,
  projectPath
} = require('../services/runtime-paths');
const { normalizeUiLocale } = require('../services/ui-locale');

// 用户数据统一存放到 user-data/ 目录（便于用户查找、备份、迁移）
const USER_DATA_DIR = migrateLegacyDirectory('user-data', 'user-data');
ensureDir(USER_DATA_DIR);
const ASSETS_FILE = migrateLegacyFile('user-data/assets.json', 'user-data/assets.json');
const BACKUPS_DIR = migrateLegacyDirectory('user-data/backups', 'user-data/backups');
ensureDir(BACKUPS_DIR);
const TOOL_DESCRIPTORS_FILE = projectPath('ai-adapter', 'tool-descriptors.json');
const { checkLimit, getCurrentTier, getLimit, CURRENT_TIER } = require('../services/user-tiers');

function getStarterAssetsFile(locale) {
  const normalizedLocale = normalizeUiLocale(locale);
  return projectPath(
    'examples',
    'user-assets',
    `mepbridge-starter-user-assets.${normalizedLocale}.json`
  );
}

function loadStarterAssets(locale) {
  const starterAssetsFile = getStarterAssetsFile(locale);
  if (!fs.existsSync(starterAssetsFile)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(starterAssetsFile, 'utf8'));
}

function createStarterAssets(locale, metadata = {}) {
  const starter = loadStarterAssets(locale);
  if (!starter) {
    return null;
  }

  return {
    schemaVersion: 'user-asset-1',
    templates: Array.isArray(starter.templates) ? starter.templates : [],
    commands: Array.isArray(starter.commands) ? starter.commands : [],
    ...metadata,
  };
}

function localizeStarterAssets(assets, locale) {
  const starter = loadStarterAssets(locale);
  if (!starter) {
    return assets;
  }

  const localizedTemplates = new Map(
    (starter.templates || []).map((template) => [template.id, template])
  );
  const localizedCommands = new Map(
    (starter.commands || []).map((command) => [command.id, command])
  );

  return {
    ...assets,
    notes: starter.notes || assets.notes,
    templates: (assets.templates || []).map((template) =>
      localizedTemplates.get(template.id) || template
    ),
    commands: (assets.commands || []).map((command) =>
      localizedCommands.get(command.id) || command
    ),
  };
}

// 确保 user-data/ 和 backups/ 目录存在（新用户首次启动自动创建）
(function ensureUserDataDirs() {
  try {
    if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  } catch (e) {
    console.error('[UserAssets] Ensure dirs failed:', e.message);
  }
})();

// E.7: 命令白名单（SYNC-3 铁律：singleStep.action 必须命中 tool-descriptors.json 已注册命令）
// 从 tool-descriptors.json 动态加载，失败时使用硬编码回退
const FALLBACK_WHITELIST = [
  'Ping', 'GetSelectedElements', 'ScanStructuralElements', 'GetAvailableSizes',
  'GetAvailableSystems', 'GetElementPropertyDefinitions', 'GetElementProperties',
  'MoveSelectedElements', 'EditSelectedElements', 'CopyElements',
  'DeleteMEPElements', 'DeleteElements', 'CreatePipe', 'CreatePipeSystem',
  'CreateDuct', 'CreateCableCarrier', 'CreateWall', 'CreateColumn', 'CreateBeam', 'CreateSlab',
  'RotateSelectedElements', 'MirrorSelectedElements',
  'GetMEPElementInfo', 'MoveElements', 'EditElements',
  'SetElementProperty', 'SetElementProperties', 'SetRoutesProperties',
  'FindRoutesByProperty', 'FindRoutesByProperties', 'EnsurePropertyDefinitions',
  'SolveConn', 'AutoRoutePipe',
  'ChangeElementGeometry', 'BatchCreateElements',
  // P4-2/P4-3/P4-5 查询与选择（2026-06-29 新增）
  'GetElementsByType', 'SetSelectedElements', 'GetElementGeometry',
  // P4-7/P4-8 编辑命令（门窗几何 + MEP路由属性）
  'ChangeOpeningGeometry', 'ChangeMEPRouteProperties',
  // 项目环境查询（原生 MEPBridge 命令）
  'GetProjectInfo', 'GetStories', 'GetLibraries', 'GetHotlinks',
  // 建筑构件创建扩展
  'CreateDoor', 'CreateWindow', 'CreateRoof', 'CreateStair',
  'CreateObject', 'CreateLamp', 'CreateMesh', 'CreateZone',
  // Archicad 原生命令
  'GetAllElements',
];

let commandWhitelist = null;

function getCommandWhitelist() {
  if (commandWhitelist) return commandWhitelist;

  try {
    if (fs.existsSync(TOOL_DESCRIPTORS_FILE)) {
      const descriptors = JSON.parse(fs.readFileSync(TOOL_DESCRIPTORS_FILE, 'utf8'));
      const names = new Set(FALLBACK_WHITELIST);
      if (Array.isArray(descriptors.descriptors)) {
        for (const desc of descriptors.descriptors) {
          if (desc.commandName) {
            names.add(desc.commandName);
          }
          // 也从 commandJson 中提取
          if (desc.commandJson && desc.commandJson.parameters) {
            const cmdName = desc.commandJson.parameters.addOnCommandId;
            if (cmdName && cmdName.commandName) {
              names.add(cmdName.commandName);
            }
          }
        }
      }
      commandWhitelist = names;
      return names;
    }
  } catch (err) {
    console.warn('[UserAssets] Failed to load tool-descriptors.json, using fallback whitelist:', err.message);
  }

  commandWhitelist = new Set(FALLBACK_WHITELIST);
  return commandWhitelist;
}

/**
 * E.7: 校验 action 是否在白名单中
 * SYNC-3: 自定义命令 singleStep.action 必须命中 tool-descriptors.json 已注册命令
 */
function validateActionWhitelist(action) {
  if (!action || typeof action !== 'string') {
    return { valid: false, error: 'action is required and must be a string' };
  }
  const whitelist = getCommandWhitelist();
  if (whitelist.has(action)) {
    return { valid: true };
  }
  return {
    valid: false,
    error: `Action "${action}" is not in the command whitelist. Allowed: ${Array.from(whitelist).sort().join(', ')}`
  };
}

// 默认空资产结构
function emptyAssets() {
  return {
    schemaVersion: 'user-asset-1',
    templates: [],
    commands: []
  };
}

// 读取资产文件，不存在则返回空结构
function loadAssets() {
  try {
    if (!fs.existsSync(ASSETS_FILE)) {
      return emptyAssets();
    }
    const raw = fs.readFileSync(ASSETS_FILE, 'utf8');
    const data = JSON.parse(raw);
    // 基本校验
    if (!data.templates || !Array.isArray(data.templates)) {
      data.templates = [];
    }
    if (!data.commands || !Array.isArray(data.commands)) {
      data.commands = [];
    }
    if (!data.schemaVersion) {
      data.schemaVersion = 'user-asset-1';
    }
    return data;
  } catch (error) {
    console.error('[UserAssets] Load error:', error);
    return emptyAssets();
  }
}

// 保存资产文件
function saveAssets(data) {
  fs.writeFileSync(ASSETS_FILE, JSON.stringify(data, null, 2));
}

function writeAssetsBackup(assets, reason = 'manual') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(BACKUPS_DIR, `assets-${timestamp}.json`);
  const backupData = {
    schemaVersion: 'user-asset-1',
    backedUpAt: new Date().toISOString(),
    reason,
    templates: assets.templates || [],
    commands: assets.commands || []
  };
  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
  return backupFile;
}

// GET /load —— 加载全部用户资产
router.get('/load', (req, res) => {
  try {
    const locale = normalizeUiLocale(req.query.locale);
    let storedAssets = loadAssets();
    if (!fs.existsSync(ASSETS_FILE)) {
      const starterAssetsFile = getStarterAssetsFile(locale);
      const starterAssets = createStarterAssets(locale, {
        initializedAt: new Date().toISOString(),
        initializedLocale: locale,
        initializedSource: path.relative(projectPath(), starterAssetsFile)
      });
      if (starterAssets) {
        saveAssets(starterAssets);
        storedAssets = starterAssets;
      }
    }
    const assets = localizeStarterAssets(storedAssets, locale);
    const tier = getCurrentTier();
    res.json({
      success: true,
      ...assets,
      locale,
      tier: {
        level: CURRENT_TIER,
        label: tier.label,
        limits: {
          templates: getLimit('templates'),
          commands: getLimit('commands'),
          knowledgeRules: getLimit('knowledgeRules')
        }
      }
    });
  } catch (error) {
    console.error('[UserAssets] GET /load error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /save —— 保存全部用户资产（整体覆盖）
router.post('/save', (req, res) => {
  try {
    const { templates, commands } = req.body;

    const assets = {
      schemaVersion: 'user-asset-1',
      templates: Array.isArray(templates) ? templates : [],
      commands: Array.isArray(commands) ? commands : [],
      updatedAt: new Date().toISOString()
    };

    saveAssets(assets);
    res.json({ success: true, message: 'User assets saved' });
  } catch (error) {
    console.error('[UserAssets] POST /save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /templates —— 新增/更新单个模板（按 id 去重）
router.post('/templates', (req, res) => {
  try {
    const template = req.body;
    if (!template.id || !template.name || !template.plan) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: id, name, plan'
      });
    }

    // E.7 安全白名单校验：模板 plan.steps 中所有 step.action 必须命中白名单
    if (template.plan && Array.isArray(template.plan.steps)) {
      for (let i = 0; i < template.plan.steps.length; i++) {
        const step = template.plan.steps[i];
        if (step.action) {
          const check = validateActionWhitelist(step.action);
          if (!check.valid) {
            return res.status(400).json({
              success: false,
              error: `Step ${i + 1} action validation failed: ${check.error}`
            });
          }
        }
      }
    }

    if (template.riskLevel && !['read', 'low-mutation'].includes(template.riskLevel)) {
      return res.status(400).json({
        success: false,
        error: `Invalid riskLevel: ${template.riskLevel}, must be "read" or "low-mutation"`
      });
    }

    const assets = loadAssets();
    const idx = assets.templates.findIndex(t => t.id === template.id);
    const now = new Date().toISOString();

    if (idx >= 0) {
      // 更新
      template.updatedAt = now;
      assets.templates[idx] = template;
    } else {
      // 新增 — 检查数量限制
      const limitCheck = checkLimit('templates', assets.templates.length);
      if (!limitCheck.allowed) {
        return res.status(403).json({
          success: false,
          error: `模板数量已达上限 (${limitCheck.limit} 个)，请删除旧模板或升级版本`
        });
      }
      template.createdAt = now;
      template.updatedAt = now;
      assets.templates.push(template);
    }

    saveAssets(assets);
    res.json({ success: true, template, message: idx >= 0 ? 'Template updated' : 'Template created' });
  } catch (error) {
    console.error('[UserAssets] POST /templates error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /templates/:id —— 删除单个模板
router.delete('/templates/:id', (req, res) => {
  try {
    const { id } = req.params;
    const assets = loadAssets();
    const idx = assets.templates.findIndex(t => t.id === id);

    if (idx < 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    assets.templates.splice(idx, 1);
    saveAssets(assets);
    res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    console.error('[UserAssets] DELETE /templates/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /commands —— 新增/更新单个自定义命令（按 id 去重）
router.post('/commands', (req, res) => {
  try {
    const command = req.body;
    if (!command.id || !command.triggers || !Array.isArray(command.triggers) || command.triggers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: id, triggers (non-empty array)'
      });
    }

    // 必须绑定 templateId 或 singleStep 之一
    if (!command.templateId && !command.singleStep) {
      return res.status(400).json({
        success: false,
        error: 'Must specify either templateId or singleStep'
      });
    }

    // E.7 安全白名单校验：singleStep.action 必须命中 tool-descriptors.json 白名单（SYNC-3 铁律）
    if (command.singleStep) {
      if (!command.singleStep.action) {
        return res.status(400).json({
          success: false,
          error: 'singleStep.action is required'
        });
      }
      const actionCheck = validateActionWhitelist(command.singleStep.action);
      if (!actionCheck.valid) {
        return res.status(400).json({
          success: false,
          error: `SYNC-3 whitelist validation failed: ${actionCheck.error}`
        });
      }
      if (!['read', 'low-mutation'].includes(command.singleStep.riskLevel)) {
        return res.status(400).json({
          success: false,
          error: `Invalid singleStep.riskLevel: ${command.singleStep.riskLevel}`
        });
      }
    }

    const assets = loadAssets();
    const idx = assets.commands.findIndex(c => c.id === command.id);
    const now = new Date().toISOString();

    if (idx >= 0) {
      assets.commands[idx] = command;
    } else {
      // 新增 — 检查数量限制
      const limitCheck = checkLimit('commands', assets.commands.length);
      if (!limitCheck.allowed) {
        return res.status(403).json({
          success: false,
          error: `自定义命令数量已达上限 (${limitCheck.limit} 个)，请删除旧命令或升级版本`
        });
      }
      command.createdAt = now;
      assets.commands.push(command);
    }

    saveAssets(assets);
    res.json({ success: true, command, message: idx >= 0 ? 'Command updated' : 'Command created' });
  } catch (error) {
    console.error('[UserAssets] POST /commands error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /commands/:id —— 删除单个自定义命令
router.delete('/commands/:id', (req, res) => {
  try {
    const { id } = req.params;
    const assets = loadAssets();
    const idx = assets.commands.findIndex(c => c.id === id);

    if (idx < 0) {
      return res.status(404).json({ success: false, error: 'Command not found' });
    }

    assets.commands.splice(idx, 1);
    saveAssets(assets);
    res.json({ success: true, message: 'Command deleted' });
  } catch (error) {
    console.error('[UserAssets] DELETE /commands/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /import —— 导入用户资产包（合并，按 id 去重）
router.post('/import', (req, res) => {
  try {
    const bundle = req.body;
    if (!bundle || !bundle.schemaVersion) {
      return res.status(400).json({
        success: false,
        error: 'Invalid bundle: missing schemaVersion'
      });
    }

    if (bundle.schemaVersion !== 'user-asset-1') {
      return res.status(400).json({
        success: false,
        error: `Unsupported schemaVersion: ${bundle.schemaVersion}, expected: user-asset-1`
      });
    }

    const assets = loadAssets();
    let templatesAdded = 0;
    let templatesSkipped = 0;
    let commandsAdded = 0;
    let commandsSkipped = 0;

    // 合并模板（按 id 去重，已存在则跳过；E.7 白名单校验）
    if (Array.isArray(bundle.templates)) {
      for (const template of bundle.templates) {
        const exists = assets.templates.find(t => t.id === template.id);
        if (exists) {
          templatesSkipped++;
        } else {
          // E.7: 校验导入的模板 steps.action
          let valid = true;
          if (template.plan && Array.isArray(template.plan.steps)) {
            for (const step of template.plan.steps) {
              if (step.action) {
                const check = validateActionWhitelist(step.action);
                if (!check.valid) {
                  templatesSkipped++;
                  valid = false;
                  break;
                }
              }
            }
          }
          if (valid) {
            assets.templates.push(template);
            templatesAdded++;
          }
        }
      }
    }

    // 合并命令（按 id 去重，已存在则跳过；E.7 白名单校验）
    if (Array.isArray(bundle.commands)) {
      for (const command of bundle.commands) {
        const exists = assets.commands.find(c => c.id === command.id);
        if (exists) {
          commandsSkipped++;
        } else {
          // E.7: 校验导入的命令 singleStep.action
          let valid = true;
          if (command.singleStep && command.singleStep.action) {
            const check = validateActionWhitelist(command.singleStep.action);
            if (!check.valid) {
              commandsSkipped++;
              valid = false;
            }
          }
          if (valid) {
            assets.commands.push(command);
            commandsAdded++;
          }
        }
      }
    }

    saveAssets(assets);

    res.json({
      success: true,
      message: 'Import completed',
      summary: {
        templatesAdded,
        templatesSkipped,
        commandsAdded,
        commandsSkipped
      }
    });
  } catch (error) {
    console.error('[UserAssets] POST /import error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /export —— 导出用户资产包
router.get('/export', (req, res) => {
  try {
    const assets = loadAssets();
    const bundle = {
      schemaVersion: 'user-asset-1',
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
      templates: assets.templates,
      commands: assets.commands
    };
    res.json({
      success: true,
      bundle
    });
  } catch (error) {
    console.error('[UserAssets] GET /export error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /reset — 清除当前用户资产并恢复发布包内置 starter 示例
router.post('/reset', (req, res) => {
  try {
    const locale = normalizeUiLocale(req.body?.locale);
    const starterAssetsFile = getStarterAssetsFile(locale);
    const currentAssets = loadAssets();
    const backupFile = writeAssetsBackup(currentAssets, 'reset-before-starter-restore');

    let nextAssets = emptyAssets();
    let source = 'empty';
    if (fs.existsSync(starterAssetsFile)) {
      nextAssets = createStarterAssets(locale, {
        resetAt: new Date().toISOString(),
        resetLocale: locale,
        resetSource: path.relative(projectPath(), starterAssetsFile)
      });
      source = 'starter';
    }

    saveAssets(nextAssets);
    res.json({
      success: true,
      message: source === 'starter' ? 'Assets reset to starter examples' : 'Assets cleared',
      source,
      locale,
      backupFile: path.basename(backupFile),
      stats: {
        templates: nextAssets.templates.length,
        commands: nextAssets.commands.length
      }
    });
  } catch (error) {
    console.error('[UserAssets] POST /reset error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /backup — 备份当前用户资产到 user-data/backups/
router.post('/backup', (req, res) => {
  try {
    const assets = loadAssets();
    const backupFile = writeAssetsBackup(assets, 'manual-backup');
    console.log(`[UserAssets] Backup created: ${backupFile}`);
    res.json({
      success: true,
      message: 'Backup created',
      backupFile: path.basename(backupFile),
      backupPath: path.join('user-data', 'backups', path.basename(backupFile)),
      stats: {
        templates: assets.templates.length,
        commands: assets.commands.length
      }
    });
  } catch (error) {
    console.error('[UserAssets] POST /backup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /backups — 列出所有备份文件
router.get('/backups', (req, res) => {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      return res.json({ success: true, backups: [] });
    }
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(BACKUPS_DIR, f);
        const stat = fs.statSync(filePath);
        return {
          filename: f,
          size: stat.size,
          createdAt: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ success: true, backups: files });
  } catch (error) {
    console.error('[UserAssets] GET /backups error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports._test = {
  getStarterAssetsFile,
  localizeStarterAssets,
  normalizeUiLocale,
};
