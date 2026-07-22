// knowledge-base.js
// V2 H8 知识库建设 — 建筑规范 + MEP标准 + 材料规格
//
// 多语言发布包支持：
//   中文发布包 (zh-CN) → 内置 GB/JGJ 国标 → knowledge-base-zh-CN.js
//   英文发布包 (en-US) → 内置 IBC/ASME/ASHRAE/NEC 国际标准 → knowledge-base-en-US.js
//   打包时通过替换 require 路径决定使用哪个语言版本（非运行时切换）

const fs = require('fs');
const path = require('path');
const { ensureDataDir, migrateLegacyFile } = require('./runtime-paths');

const USER_DATA_DIR = ensureDataDir('user-data');
const USER_KB_FILE = migrateLegacyFile('user-data/knowledge-base.json', 'user-data/knowledge-base.json');

(function ensureUserDataDir() {
  try {
    if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('[KnowledgeBase] Ensure dir failed:', e.message);
  }
})();

// 加载内置知识库（发布包级别静态加载，非运行时切换）
// 中文发布包使用 knowledge-base-zh-CN.js
// 英文发布包打包时替换为 knowledge-base-en-US.js
const BUILTIN_KB = require('./knowledge-base-zh-CN');
console.log(`[KnowledgeBase] Loaded builtin KB: locale=${BUILTIN_KB.locale}, version=${BUILTIN_KB.version}, ${BUILTIN_KB.buildingCode.length}+${BUILTIN_KB.mepStandard.length}+${BUILTIN_KB.material.length} rules`);

const BUILDING_CODE = BUILTIN_KB.buildingCode;
const MEP_STANDARD = BUILTIN_KB.mepStandard;
const MATERIAL_SPEC = BUILTIN_KB.material;
const KB_I18N = BUILTIN_KB.i18n;
const { CURRENT_TIER, getCurrentTier, getLimit, checkLimit } = require('./user-tiers');

class KnowledgeBase {
  constructor() {
    this.locale = BUILTIN_KB.locale;
    this.region = BUILTIN_KB.region;
    this.builtinVersion = BUILTIN_KB.version;
    this.builtinUpdatedAt = BUILTIN_KB.updatedAt;
    this.builtinSources = BUILTIN_KB.sources;
    this.buildingCode = [...BUILDING_CODE];
    this.mepStandard = [...MEP_STANDARD];
    this.material = [...MATERIAL_SPEC];
    this._loadUserKB();
  }

  _loadUserKB() {
    try {
      if (fs.existsSync(USER_KB_FILE)) {
        const data = JSON.parse(fs.readFileSync(USER_KB_FILE, 'utf8'));
        if (Array.isArray(data.buildingCode)) this.buildingCode = [...this.buildingCode, ...data.buildingCode];
        if (Array.isArray(data.mepStandard)) this.mepStandard = [...this.mepStandard, ...data.mepStandard];
        if (Array.isArray(data.material)) this.material = [...this.material, ...data.material];
        console.log(`[KnowledgeBase] Loaded user KB: ${data.buildingCode?.length || 0} building, ${data.mepStandard?.length || 0} mep, ${data.material?.length || 0} material`);
      }
    } catch (e) {
      console.error('[KnowledgeBase] Load user KB failed:', e.message);
    }
  }

  _saveUserKB() {
    try {
      const userKB = {
        version: 2,
        locale: this.locale,
        exportedAt: new Date().toISOString(),
        buildingCode: this.buildingCode.filter(r => r.isUserAdded),
        mepStandard: this.mepStandard.filter(r => r.isUserAdded),
        material: this.material.filter(r => r.isUserAdded)
      };
      fs.writeFileSync(USER_KB_FILE, JSON.stringify(userKB, null, 2));
      console.log(`[KnowledgeBase] Saved user KB: ${userKB.buildingCode.length} building, ${userKB.mepStandard.length} mep, ${userKB.material.length} material`);
    } catch (e) {
      console.error('[KnowledgeBase] Save user KB failed:', e.message);
    }
  }

  getAll() {
    const tier = getCurrentTier();
    return {
      version: 2,
      locale: this.locale,
      region: this.region,
      tier: {
        level: CURRENT_TIER,
        label: tier.label,
        labelEn: tier.labelEn,
        limits: {
          knowledgeRules: getLimit('knowledgeRules'),
          templates: getLimit('templates'),
          commands: getLimit('commands')
        }
      },
      builtin: {
        version: this.builtinVersion,
        updatedAt: this.builtinUpdatedAt,
        sources: this.builtinSources,
        counts: {
          buildingCode: BUILDING_CODE.length,
          mepStandard: MEP_STANDARD.length,
          material: MATERIAL_SPEC.length,
          total: BUILDING_CODE.length + MEP_STANDARD.length + MATERIAL_SPEC.length
        }
      },
      buildingCode: this.buildingCode,
      mepStandard: this.mepStandard,
      material: this.material,
      totals: {
        buildingCode: this.buildingCode.length,
        mepStandard: this.mepStandard.length,
        material: this.material.length,
        total: this.buildingCode.length + this.mepStandard.length + this.material.length,
        userAdded: {
          buildingCode: this.buildingCode.filter(r => r.isUserAdded).length,
          mepStandard: this.mepStandard.filter(r => r.isUserAdded).length,
          material: this.material.filter(r => r.isUserAdded).length
        }
      }
    };
  }

  search(query, category = null) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return this.getAll();
    const matchItem = (item) => JSON.stringify(item).toLowerCase().includes(q);
    const result = {};
    if (!category || category === 'buildingCode') result.buildingCode = this.buildingCode.filter(matchItem);
    if (!category || category === 'mepStandard') result.mepStandard = this.mepStandard.filter(matchItem);
    if (!category || category === 'material') result.material = this.material.filter(matchItem);
    return {
      ...result,
      totals: {
        buildingCode: result.buildingCode?.length || 0,
        mepStandard: result.mepStandard?.length || 0,
        material: result.material?.length || 0,
        total: (result.buildingCode?.length || 0) + (result.mepStandard?.length || 0) + (result.material?.length || 0)
      }
    };
  }

  buildKnowledgeSection(context = {}) {
    const steps = context.steps || [];
    const userIntent = (context.userIntent || '').toLowerCase();
    const kw = KB_I18N.intentKeywords;

    const isMEP = steps.some(s => ['CreatePipe', 'CreateDuct', 'CreateCableCarrier', 'CreatePipeSystem'].includes(s.action)) ||
                  kw.pipe.some(k => userIntent.includes(k));
    const isBuilding = steps.some(s => ['CreateWall', 'CreateColumn', 'CreateBeam', 'CreateSlab', 'CreateRoof'].includes(s.action)) ||
                       kw.building.some(k => userIntent.includes(k));
    const isDoorWindow = steps.some(s => ['CreateDoor', 'CreateWindow'].includes(s.action)) ||
                         kw.doorWindow.some(k => userIntent.includes(k));

    let section = `\n${KB_I18N.sectionTitle}\n`;
    section += `${KB_I18N.sectionIntro}\n\n`;

    if (isBuilding || isDoorWindow) {
      section += `${KB_I18N.buildingTitle}\n`;
      const relevant = this.buildingCode.filter(r => {
        if (isDoorWindow && (r.field === 'width' || r.category === 'fireproof')) return true;
        if (isBuilding && (r.field === 'height' || r.field === 'thickness' || r.field === 'roomArea')) return true;
        return false;
      });
      for (const r of relevant.slice(0, 8)) {
        const sevLabel = r.severity === 'error' ? KB_I18N.severityError : KB_I18N.severityWarning;
        section += `- [${sevLabel}] ${r.rule} (${KB_I18N.sourceLabel}: ${r.source})\n`;
      }
      section += '\n';
    }

    if (isMEP) {
      section += `${KB_I18N.mepTitle}\n`;
      const relevant = this.mepStandard.filter(r => {
        return steps.some(s => r.commandAction === s.action) ||
               (kw.drainage.some(k => userIntent.includes(k)) && r.subType === 'Drainage') ||
               (kw.water.some(k => userIntent.includes(k)) && r.subType === 'Water') ||
               (kw.duct.some(k => userIntent.includes(k)) && r.subType === 'Duct') ||
               (kw.electrical.some(k => userIntent.includes(k)) && r.subType === 'Electrical');
      });
      for (const r of (relevant.length > 0 ? relevant : this.mepStandard).slice(0, 8)) {
        const sevLabel = r.severity === 'error' ? KB_I18N.severityError : KB_I18N.severityWarning;
        section += `- [${sevLabel}] ${r.rule} (${KB_I18N.sourceLabel}: ${r.source})\n`;
      }
      section += '\n';
    }

    if (isBuilding || isDoorWindow) {
      section += `${KB_I18N.materialTitle}\n`;
      for (const hint of KB_I18N.materialHints) {
        section += `- ${hint}\n`;
      }
      section += '\n';
    }

    return section;
  }

  validatePlan(plan) {
    const violations = [];
    const steps = plan.steps || [];
    const ACTION_ALIAS = { 'AutoRoutePipe': 'CreatePipe' };

    steps.forEach((step, idx) => {
      const params = step.params || {};
      const action = step.action;
      const effectiveAction = ACTION_ALIAS[action] || action;

      for (const rule of this.buildingCode) {
        if (!rule.field || !rule.minValue) continue;
        const value = params[rule.field];
        if (value === undefined) continue;

        if (action === 'CreateWall' && rule.field === 'thickness' && value < rule.minValue) {
          violations.push({ stepIndex: idx, rule: rule.rule, severity: rule.severity, message: `${action} thickness=${value}m < ${rule.minValue}m (${rule.rule})` });
        }
        if (action === 'CreateWall' && rule.field === 'height' && value < rule.minValue) {
          violations.push({ stepIndex: idx, rule: rule.rule, severity: rule.severity, message: `${action} height=${value}m < ${rule.minValue}m (${rule.rule})` });
        }
        if (['CreateSlab', 'CreateRoof', 'CreateBeam'].includes(action) && rule.field === 'thickness' && value < rule.minValue) {
          violations.push({ stepIndex: idx, rule: rule.rule, severity: rule.severity, message: `${action} thickness=${value}m < ${rule.minValue}m (${rule.rule})` });
        }
        if ((action === 'CreateDoor' || action === 'CreateWindow') && rule.field === 'width' && value < rule.minValue) {
          violations.push({ stepIndex: idx, rule: rule.rule, severity: rule.severity, message: `${action} width=${value}m < ${rule.minValue}m (${rule.rule})` });
        }
      }

      for (const rule of this.mepStandard) {
        const matchesAction = rule.commandAction === action || (rule.commandAction === effectiveAction && !rule.subType);
        if (!rule.commandAction || !matchesAction) continue;
        if (!rule.field) continue;

        if (rule.subType) {
          const stepText = (step.title || '') + (step.description || '') + (plan.userIntent || '');
          const kw = KB_I18N.intentKeywords;
          const isWaterMatch = rule.subType === 'Water' && kw.water.some(k => stepText.includes(k));
          const isDrainageMatch = rule.subType === 'Drainage' && kw.drainage.some(k => stepText.includes(k));
          const isDuctBath = rule.subType === 'Duct' && /卫生间|排风|换气|bathroom|exhaust/.test(stepText) && rule.id === 'MEP-103';
          const isDuctKitchen = rule.subType === 'Duct' && /厨房|油烟|炊事|kitchen|range/.test(stepText) && rule.id === 'MEP-104';

          if (rule.subType === 'Water' && !isWaterMatch && kw.drainage.some(k => stepText.includes(k))) continue;
          if (rule.subType === 'Drainage' && !isDrainageMatch && kw.water.some(k => stepText.includes(k))) continue;
          if (rule.id === 'MEP-103' && !isDuctBath) continue;
          if (rule.id === 'MEP-104' && !isDuctKitchen) continue;
        }

        const value = params[rule.field];
        if (value === undefined) continue;

        if (rule.minValue && value < rule.minValue) {
          violations.push({ stepIndex: idx, rule: rule.rule, severity: rule.severity, message: `${action} ${rule.field}=${value} < ${rule.minValue} (${rule.rule})` });
        }
        if (rule.maxValue && value > rule.maxValue) {
          violations.push({ stepIndex: idx, rule: rule.rule, severity: rule.severity, message: `${action} ${rule.field}=${value} > ${rule.maxValue} (${rule.rule})` });
        }
        if (rule.minRange && (value < rule.minRange[0] || value > rule.minRange[1])) {
          violations.push({ stepIndex: idx, rule: rule.rule, severity: rule.severity, message: `${action} ${rule.field}=${value} not in range [${rule.minRange[0]}, ${rule.minRange[1]}] (${rule.rule})` });
        }
      }
    });

    const errors = violations.filter(v => v.severity === 'error');
    const warnings = violations.filter(v => v.severity === 'warning');

    return {
      passed: errors.length === 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      violations,
      errors,
      warnings,
      summary: errors.length > 0
        ? `${errors.length} violation(s) must fix + ${warnings.length} warning(s)`
        : warnings.length > 0
          ? `${warnings.length} warning(s) (optimize recommended)`
          : 'Compliant with all standards'
    };
  }

  listByCategory(category) {
    switch (category) {
      case 'buildingCode': return this.buildingCode;
      case 'mepStandard': return this.mepStandard;
      case 'material': return this.material;
      default: return this.getAll();
    }
  }

  _getCategoryArray(category) {
    if (category === 'buildingCode') return this.buildingCode;
    if (category === 'mepStandard') return this.mepStandard;
    if (category === 'material') return this.material;
    return null;
  }

  _generateId(category) {
    const arr = this._getCategoryArray(category);
    if (!arr) return null;
    const prefix = category === 'buildingCode' ? 'BC' : category === 'mepStandard' ? 'MEP' : 'MAT';
    let maxNum = 0;
    for (const item of arr) {
      const match = (item.id || '').match(new RegExp(`^${prefix}-(\\d+)$`));
      if (match) { const num = parseInt(match[1]); if (num > maxNum) maxNum = num; }
    }
    return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
  }

  addRule(category, rule) {
    const arr = this._getCategoryArray(category);
    if (!arr) return { ok: false, error: `Invalid category: ${category}` };
    if (!rule || (!rule.rule && !rule.material)) return { ok: false, error: 'Missing required field: rule or material' };
    // 用户级别数量限制检查
    const userAddedCount = arr.filter(r => r.isUserAdded).length;
    const check = checkLimit('knowledgeRules', userAddedCount);
    if (!check.allowed) {
      return { ok: false, error: `已达上限 (${check.limit} 条自定义规则)，请升级版本或删除旧条目` };
    }
    const newRule = { id: this._generateId(category), ...rule, isUserAdded: true, addedAt: new Date().toISOString() };
    arr.push(newRule);
    this._saveUserKB();
    console.log(`[KnowledgeBase] Added rule ${newRule.id} to ${category} (${userAddedCount + 1}/${check.limit})`);
    return { ok: true, rule: newRule };
  }

  updateRule(category, id, updates) {
    const arr = this._getCategoryArray(category);
    if (!arr) return { ok: false, error: `Invalid category: ${category}` };
    const idx = arr.findIndex(r => r.id === id);
    if (idx === -1) return { ok: false, error: `Rule ${id} not found in ${category}` };
    const updated = { ...arr[idx], ...updates, id: id, isUserAdded: true, updatedAt: new Date().toISOString() };
    arr[idx] = updated;
    this._saveUserKB();
    console.log(`[KnowledgeBase] Updated rule ${id} in ${category}`);
    return { ok: true, rule: updated };
  }

  deleteRule(category, id) {
    const arr = this._getCategoryArray(category);
    if (!arr) return { ok: false, error: `Invalid category: ${category}` };
    const idx = arr.findIndex(r => r.id === id);
    if (idx === -1) return { ok: false, error: `Rule ${id} not found in ${category}` };
    const rule = arr[idx];
    if (!rule.isUserAdded && !rule.disabled) {
      rule.disabled = true;
      rule.disabledAt = new Date().toISOString();
      this._saveUserKB();
      console.log(`[KnowledgeBase] Disabled builtin rule ${id} in ${category}`);
      return { ok: true, action: 'disabled', rule };
    }
    arr.splice(idx, 1);
    this._saveUserKB();
    console.log(`[KnowledgeBase] Deleted rule ${id} from ${category}`);
    return { ok: true, action: 'deleted' };
  }

  enableRule(category, id) {
    const arr = this._getCategoryArray(category);
    if (!arr) return { ok: false, error: `Invalid category: ${category}` };
    const rule = arr.find(r => r.id === id);
    if (!rule) return { ok: false, error: `Rule ${id} not found` };
    if (!rule.disabled) return { ok: false, error: `Rule ${id} is not disabled` };
    delete rule.disabled;
    delete rule.disabledAt;
    this._saveUserKB();
    return { ok: true, rule };
  }

  exportAll() {
    return { version: 2, exportedAt: new Date().toISOString(), ...this.getAll() };
  }

  importRules(data, overwrite = false) {
    const stats = { buildingCode: 0, mepStandard: 0, material: 0, skipped: 0 };
    const importCategory = (category, items) => {
      if (!Array.isArray(items)) return;
      const arr = this._getCategoryArray(category);
      if (!arr) return;
      for (const item of items) {
        if (!item.id) item.id = this._generateId(category);
        const existingIdx = arr.findIndex(r => r.id === item.id);
        if (existingIdx >= 0) {
          if (overwrite) {
            arr[existingIdx] = { ...item, isUserAdded: true, importedAt: new Date().toISOString() };
            stats[category]++;
          } else { stats.skipped++; }
        } else {
          arr.push({ ...item, isUserAdded: true, importedAt: new Date().toISOString() });
          stats[category]++;
        }
      }
    };
    importCategory('buildingCode', data.buildingCode);
    importCategory('mepStandard', data.mepStandard);
    importCategory('material', data.material);
    this._saveUserKB();
    console.log(`[KnowledgeBase] Import complete: +${stats.buildingCode} building, +${stats.mepStandard} mep, +${stats.material} material, ${stats.skipped} skipped`);
    return { ok: true, stats };
  }

  resetToBuiltin() {
    this.buildingCode = [...BUILDING_CODE];
    this.mepStandard = [...MEP_STANDARD];
    this.material = [...MATERIAL_SPEC];
    this._saveUserKB();
    console.log('[KnowledgeBase] Reset to builtin knowledge base');
    return { ok: true, ...this.getAll().totals };
  }
}

module.exports = new KnowledgeBase();
