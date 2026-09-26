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
const { APP_VERSION } = require('../services/app-version');
const { normalizeUiLocale } = require('../services/ui-locale');
const {
  getCommandSafetyCapabilities,
  normalizeCommandSafetyParameters
} = require('../services/command-capabilities');
const userTemplateCodes = require('../services/user-template-codes');

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

  return normalizeUserAssetsSafety({
    schemaVersion: 'user-asset-1',
    templates: Array.isArray(starter.templates) ? starter.templates : [],
    commands: Array.isArray(starter.commands) ? starter.commands : [],
    ...metadata,
  });
}

// 内置示例模板/命令与用户存储里的同 id 条目：以 updatedAt 较新的一方为准。
//
// 2026-09-18 实测缺陷：原实现无条件用 starter 覆盖同 id 条目，导致用户对内置模板的修改
// 永远不可见 —— 更新了「在第 2/3 层创建外墙与楼板」的楼板与墙高后，/api/user-assets/load
// 仍返回发布包旧版本（10 步），前端回放自然也一直是旧数据。
// 现在的规则：① 发布包更新（starter 更新）仍能下发给已有用户；② 用户改过的（updatedAt 更新）
// 优先，用户资产不会被静默回滚。
function assetTimestamp(asset) {
  const parsed = Date.parse(asset && typeof asset.updatedAt === 'string' ? asset.updatedAt : '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickNewerAsset(stored, starterVersion) {
  if (!starterVersion) {
    return stored;
  }
  if (!stored) {
    return starterVersion;
  }
  return assetTimestamp(stored) > assetTimestamp(starterVersion) ? stored : starterVersion;
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

  return normalizeUserAssetsSafety({
    ...assets,
    notes: starter.notes || assets.notes,
    templates: (assets.templates || []).map((template) =>
      pickNewerAsset(template, localizedTemplates.get(template.id))
    ),
    commands: (assets.commands || []).map((command) =>
      pickNewerAsset(command, localizedCommands.get(command.id))
    ),
  });
}

function visibleTemplates(templates) {
  return (templates || []).filter((template) => template.geometryTemplate === undefined);
}

// 内置任务模板的 id 也是 TPL-0NN，但用户模板编号**不再避开内置区间**（维护者 2026-09-18 裁定）：
// 用户模板从 TPL-001 起按列表顺序连续编号；编号直达时用户模板优先，未命中才回落到内置模板 id。
function reservedTemplateCodes() {
  return [];
}

/**
 * "面板模板"判定：可见（非 geometryTemplate）**且**不被出厂模板替代。
 * 被出厂模板替代的（见 user-template-codes#SUPERSEDED_BY_BUILTIN）数据仍保留在
 * assets.json 里（可导出/可回退），但不再进面板、也不占编号 —— 避免与 SYS-0NN 重复。
 */
function isPanelTemplate(template) {
  return Boolean(template)
    && template.geometryTemplate === undefined
    && !userTemplateCodes.builtinCodeForTemplateId(template.id);
}

function panelTemplates(templates) {
  return (templates || []).filter(isPanelTemplate);
}

/**
 * 用户模板编号 = 列表序号：就地重排为 TPL-001、TPL-002 …（返回变更个数）。
 * 只对**面板模板**编号（隐藏项与被替代项不占号），全量连续 ⇒ 天然不重复；
 * 新增模板落到末尾，删除后自动补齐。
 */
function ensureTemplateCodes(assets) {
  if (!assets || !Array.isArray(assets.templates)) return 0;
  return userTemplateCodes.renumberTemplateCodes(panelTemplates(assets.templates));
}

/**
 * 非面板模板（geometryTemplate / 已被出厂模板替代）不参与编号：清掉其 code，
 * 避免"面板看不到的行"与可见行出现同号（编号只在面板列表内连续）。
 */
function clearHiddenTemplateCodes(assets) {
  let cleared = 0;
  for (const tpl of (assets && assets.templates) || []) {
    if (tpl && tpl.code && !isPanelTemplate(tpl)) {
      delete tpl.code;
      cleared += 1;
    }
  }
  return cleared;
}

/**
 * 面板展示 /「按编号复现」共用的模板列表：
 * 存储资产（user-data）+ 发布包 starter 合并 → 本地化 → 保证每个模板都有稳定编号。
 */
/**
 * 把存储侧已分配的编号按 id 回填到合并结果。
 * 发布包 starter 版本不带 code 字段；若不回填，兜底分配会跳过已占用编号，
 * 把同一个模板编成与存储侧不同的号（面板显示与实际不一致）。
 */
function applyStoredTemplateCodes(mergedTemplates, storedTemplates) {
  const codeById = new Map((storedTemplates || []).map((tpl) => [tpl.id, tpl.code]));
  for (const tpl of mergedTemplates || []) {
    if (tpl && !tpl.code && codeById.has(tpl.id)) {
      tpl.code = codeById.get(tpl.id);
    }
  }
}

function loadVisibleTemplates(locale = 'zh-CN') {
  const storedAssets = loadAssets();
  // 重复项（同 id 多条）只保留最新，避免同一模板占两个编号（展示层兜底，不删数据）
  const deduped = userTemplateCodes.dedupeTemplates(panelTemplates(storedAssets.templates));
  if (deduped.removed.length > 0) {
    console.warn(`[UserAssets] Ignored ${deduped.removed.length} duplicate template(s) while listing; kept the newest per id`);
  }
  const storedVisible = { ...storedAssets, templates: deduped.templates };
  const hiddenCleared = clearHiddenTemplateCodes(storedAssets);
  if (ensureTemplateCodes(storedVisible) > 0 || hiddenCleared > 0) {
    // 编号 = 列表序号：重排后落盘，保证下次读取一致（旧资产无 code 时也在此补齐）
    saveAssets(storedAssets);
  }
  const merged = localizeStarterAssets(storedVisible, locale);
  applyStoredTemplateCodes(merged.templates, storedVisible.templates);
  ensureTemplateCodes(merged); // 发布包独有的模板再兜底编号
  return localizeTemplateDisplayNames(merged, locale).templates || [];
}

// 用户采集模板可携带可选 nameEn（英文 UI 显示名）。en-US 下用 nameEn 替换展示名；
// 其余 locale 展示原始 name。替换只发生在 /load 展示层，存储与 /export 保持原数据。
function localizeTemplateDisplayNames(assets, locale) {
  if (normalizeUiLocale(locale) !== 'en-US' || !assets || !Array.isArray(assets.templates)) {
    return assets;
  }
  return {
    ...assets,
    templates: assets.templates.map((template) => {
      if (!template || typeof template !== 'object') return template;
      const nameEn = typeof template.nameEn === 'string' ? template.nameEn.trim() : '';
      return nameEn ? { ...template, name: nameEn } : template;
    })
  };
}

function forceConfirmedSafetyParameters(commandName, params = {}) {
  const capabilities = getCommandSafetyCapabilities(commandName);
  const normalized = normalizeCommandSafetyParameters(commandName, params);

  // Template replay already has an explicit UI preview/confirm stage. Mutation
  // steps must not fall back to the Add-On's dryRun=true default.
  if (capabilities.dryRun) {
    normalized.dryRun = false;
  }
  if (capabilities.confirmRequired) {
    normalized.confirmRequired = true;
  }

  return normalized;
}

function getAddOnCommandName(commandJson) {
  return commandJson?.parameters?.addOnCommandId?.commandName;
}

function normalizeUserStepSafety(step) {
  if (!step || typeof step !== 'object') {
    return step;
  }

  const nextStep = { ...step };
  const actionName = typeof step.action === 'string' ? step.action : step.commandName;

  if (actionName) {
    nextStep.params = forceConfirmedSafetyParameters(actionName, step.params || {});
  }

  if (step.commandJson && typeof step.commandJson === 'object') {
    const commandJson = { ...step.commandJson };
    const parameters = { ...(commandJson.parameters || {}) };
    const addOnCommandName = getAddOnCommandName({ parameters });

    if (addOnCommandName) {
      parameters.addOnCommandParameters = forceConfirmedSafetyParameters(
        addOnCommandName,
        parameters.addOnCommandParameters || {}
      );
      commandJson.parameters = parameters;
      nextStep.commandJson = commandJson;
    }
  }

  return nextStep;
}

function normalizeUserTemplateSafety(template) {
  if (!template || typeof template !== 'object' || !template.plan || !Array.isArray(template.plan.steps)) {
    return template;
  }

  return {
    ...template,
    plan: {
      ...template.plan,
      steps: template.plan.steps.map(normalizeUserStepSafety),
      // 回放后步骤（postReplaySteps）同样是回放体会真实执行的命令，
      // 必须走同一套安全归一化（mutation 步骤不得沿用 Add-On 的 dryRun=true 默认值）。
      ...(Array.isArray(template.plan.postReplaySteps)
        ? { postReplaySteps: template.plan.postReplaySteps.map(normalizeUserStepSafety) }
        : {})
    }
  };
}

/**
 * E.7: 校验 plan 里所有会被回放执行的步骤 action 都命中白名单。
 * 覆盖 plan.steps（普通步骤）与 plan.postReplaySteps（回放后收尾步骤）——
 * 后者同样会把命令发给 Archicad，不能绕过 SYNC-3 白名单。
 */
function validatePlanActionWhitelist(plan) {
  if (!plan || typeof plan !== 'object') {
    return { valid: true };
  }

  const groups = [
    { key: 'steps', label: 'Step' },
    { key: 'postReplaySteps', label: 'PostReplayStep' }
  ];

  for (const { key, label } of groups) {
    const list = plan[key];
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i++) {
      const step = list[i];
      if (!step || !step.action) continue;
      const check = validateActionWhitelist(step.action);
      if (!check.valid) {
        return { valid: false, error: `${label} ${i + 1} action validation failed: ${check.error}` };
      }
    }
  }

  return { valid: true };
}

function normalizeUserCommandSafety(command) {
  if (!command || typeof command !== 'object' || !command.singleStep) {
    return command;
  }

  return {
    ...command,
    singleStep: {
      ...command.singleStep,
      params: forceConfirmedSafetyParameters(
        command.singleStep.action,
        command.singleStep.params || {}
      )
    }
  };
}

function normalizeUserAssetsSafety(assets) {
  if (!assets || typeof assets !== 'object') {
    return assets;
  }

  return {
    ...assets,
    templates: Array.isArray(assets.templates)
      ? assets.templates.map(normalizeUserTemplateSafety)
      : [],
    commands: Array.isArray(assets.commands)
      ? assets.commands.map(normalizeUserCommandSafety)
      : []
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
    return normalizeUserAssetsSafety(data);
  } catch (error) {
    console.error('[UserAssets] Load error:', error);
    return emptyAssets();
  }
}

// 保存资产文件
function saveAssets(data) {
  const normalized = normalizeUserAssetsSafety(data);
  // 重复项（同 id）只保留最新：编号 = 列表序号，一条模板只能占一个编号
  const deduped = userTemplateCodes.dedupeTemplates(normalized.templates);
  if (deduped.removed.length > 0) {
    console.warn(`[UserAssets] Dropped ${deduped.removed.length} duplicate template(s) on save; kept the newest per id`);
    normalized.templates = deduped.templates;
  }
  // 隐藏模板（geometryTemplate）不参与编号，先清掉再对可见模板重排 TPL-001、TPL-002 …
  clearHiddenTemplateCodes(normalized);
  ensureTemplateCodes(normalized);
  fs.writeFileSync(ASSETS_FILE, JSON.stringify(normalized, null, 2));
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
    const storedVisibleAssets = {
      ...storedAssets,
      templates: panelTemplates(storedAssets.templates)
    };
    const hiddenCodesCleared = clearHiddenTemplateCodes(storedAssets);
    if (ensureTemplateCodes(storedVisibleAssets) > 0 || hiddenCodesCleared > 0) {
      // 编号 = 列表序号（TPL-001…）：重排后落盘，保证下次读取一致
      saveAssets(storedAssets);
    }
    const assets = localizeTemplateDisplayNames(
      localizeStarterAssets(storedVisibleAssets, locale),
      locale
    );
    applyStoredTemplateCodes(assets.templates, storedVisibleAssets.templates);
    ensureTemplateCodes(assets);
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

    const assets = normalizeUserAssetsSafety({
      schemaVersion: 'user-asset-1',
      templates: Array.isArray(templates) ? templates : [],
      commands: Array.isArray(commands) ? commands : [],
      updatedAt: new Date().toISOString()
    });

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

    if (template.geometryTemplate !== undefined) {
      return res.status(400).json({
        success: false,
        error: 'geometryTemplate user templates are not supported in v0.1.4'
      });
    }

    // E.7 安全白名单校验：plan.steps 与 plan.postReplaySteps 中所有 step.action 必须命中白名单
    const planActionCheck = validatePlanActionWhitelist(template.plan);
    if (!planActionCheck.valid) {
      return res.status(400).json({
        success: false,
        error: planActionCheck.error
      });
    }

    if (template.riskLevel && !['read', 'low-mutation'].includes(template.riskLevel)) {
      return res.status(400).json({
        success: false,
        error: `Invalid riskLevel: ${template.riskLevel}, must be "read" or "low-mutation"`
      });
    }

    const normalizedTemplate = normalizeUserTemplateSafety(template);
    const assets = loadAssets();
    const idx = assets.templates.findIndex(t => t.id === normalizedTemplate.id);
    const now = new Date().toISOString();

    if (idx >= 0) {
      // 更新
      normalizedTemplate.updatedAt = now;
      assets.templates[idx] = normalizedTemplate;
    } else {
      // 新增 — 检查数量限制
      const limitCheck = checkLimit('templates', assets.templates.length);
      if (!limitCheck.allowed) {
        return res.status(403).json({
          success: false,
          error: `模板数量已达上限 (${limitCheck.limit} 个)，请删除旧模板或升级版本`
        });
      }
      normalizedTemplate.createdAt = now;
      normalizedTemplate.updatedAt = now;
      assets.templates.push(normalizedTemplate);
    }

    saveAssets(assets);
    res.json({ success: true, template: normalizedTemplate, message: idx >= 0 ? 'Template updated' : 'Template created' });
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

    const normalizedCommand = normalizeUserCommandSafety(command);
    const assets = loadAssets();
    const idx = assets.commands.findIndex(c => c.id === normalizedCommand.id);
    const now = new Date().toISOString();

    if (idx >= 0) {
      assets.commands[idx] = normalizedCommand;
    } else {
      // 新增 — 检查数量限制
      const limitCheck = checkLimit('commands', assets.commands.length);
      if (!limitCheck.allowed) {
        return res.status(403).json({
          success: false,
          error: `自定义命令数量已达上限 (${limitCheck.limit} 个)，请删除旧命令或升级版本`
        });
      }
      normalizedCommand.createdAt = now;
      assets.commands.push(normalizedCommand);
    }

    saveAssets(assets);
    res.json({ success: true, command: normalizedCommand, message: idx >= 0 ? 'Command updated' : 'Command created' });
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
          // E.7: 校验导入的模板 steps.action 与 postReplaySteps.action
          const valid = validatePlanActionWhitelist(template.plan).valid;
          if (!valid) {
            templatesSkipped++;
          } else {
            assets.templates.push(normalizeUserTemplateSafety(template));
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
            assets.commands.push(normalizeUserCommandSafety(command));
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
      appVersion: APP_VERSION,
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
// 用户模板编号能力（面板展示 +「按编号复现」）：
//   loadVisibleTemplates(locale)  → 合并后的模板列表（带 code）
//   其余纯函数直接转发自 services/user-template-codes.js
module.exports.templateCodes = {
  loadVisibleTemplates,
  ensureTemplateCodes,
  reservedTemplateCodes,
  ...userTemplateCodes
};

module.exports._test = {
  getStarterAssetsFile,
  localizeStarterAssets,
  normalizeUserAssetsSafety,
  normalizeUserCommandSafety,
  normalizeUserTemplateSafety,
  normalizeUiLocale,
  assetTimestamp,
  pickNewerAsset,
};
