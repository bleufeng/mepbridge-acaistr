// knowledge-base.js
// V2 H8 知识库建设 — 建筑规范 + MEP标准 + 材料规格
// v0.1.9 KB 双语体系 (KB-00 / KB-01 / KB-02 基础)
//
// 架构原则（KB-REGION-LIBRARY-AND-SINGLE-PACKAGE-PLAN REV4）：
//   1. 界面语言（uiLocale）与知识库原文（activeLibrary）正交解耦；
//   2. 规范条目保持原文，不因界面语言自动翻译或产生语义漂移；
//   3. 内置规则库只读不可变，覆盖与禁用状态外置持久化；
//   4. 用户规则支持 shared / library 显式作用域，重载与迁移无 ID 重复；
//   5. 校验与提示注入一致排除 disabled 规则；
//   6. 意图分类支持受控中英双语别名映射。

const fs = require('fs');
const path = require('path');
const { ensureDataDir, migrateLegacyFile } = require('./runtime-paths');
const crypto = require('crypto');
const schema = require('./kb-library-schema');
const { CATEGORIES, clone } = schema;
const { resolveReleaseLocale } = require('./release-locale');

const USER_DATA_DIR = ensureDataDir('user-data');
const USER_KB_FILE = migrateLegacyFile('user-data/knowledge-base.json', 'user-data/knowledge-base.json');

(function ensureUserDataDir() {
  try {
    if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('[KnowledgeBase] Ensure dir failed:', e.message);
  }
})();

// 固定注册表：受支持的随附内置标准规范库
const BUILTIN_LIBRARIES = {
  'builtin:zh-CN': {
    id: 'builtin:zh-CN',
    name: '中国国家标准 (GB/JGJ)',
    nameEn: 'Chinese National Standards (GB/JGJ)',
    region: 'CN',
    contentLanguage: 'zh-CN',
    version: '1.0.0',
    modulePath: './knowledge-base-zh-CN',
    isBuiltin: true
  },
  'builtin:en-US': {
    id: 'builtin:en-US',
    name: 'International Standards (IBC/IRC/ASHRAE)',
    nameEn: 'International Standards (IBC/IRC/ASHRAE)',
    region: 'INTL',
    contentLanguage: 'en-US',
    version: '1.0.0',
    modulePath: './knowledge-base-en-US',
    isBuiltin: true
  }
};

const RELEASE_LOCALE = resolveReleaseLocale();
const { CURRENT_TIER, getCurrentTier, getLimit, checkLimit } = require('./user-tiers');

function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const ALIAS_VERSION = 'controlled-bilingual-v1';
class KnowledgeBase {
  constructor() {
    this._snapshots = new WeakSet();
    const libraryId = RELEASE_LOCALE === 'en-US' ? 'builtin:en-US' : 'builtin:zh-CN';
    this._state = { version: 4, revision: 0, activeLibraryId: libraryId, customLibraries: {},
      disabledByLibrary: {}, overridesByLibrary: {}, userRules: { buildingCode: [], mepStandard: [], material: [] } };
    this.loadError = null;
    this._diskHash = null;
    this._loadUserKB();
    this._rebuild();
  }
  _loadBuiltinModule(id) {
    if (!Object.prototype.hasOwnProperty.call(BUILTIN_LIBRARIES, id)) throw new Error('KB_LIBRARY_NOT_FOUND');
    return require(BUILTIN_LIBRARIES[id].modulePath); // fixed registry only
  }
  _library(id = this._state.activeLibraryId) {
    if (Object.prototype.hasOwnProperty.call(BUILTIN_LIBRARIES, id)) {
      const b = this._loadBuiltinModule(id);
      return { ...BUILTIN_LIBRARIES[id], version: b.version, updatedAt: b.updatedAt, sources: b.sources,
        rules: Object.fromEntries(CATEGORIES.map(cat => [cat, b[cat]])), i18n: b.i18n };
    }
    if (Object.prototype.hasOwnProperty.call(this._state.customLibraries, id)) {
      const b = this._state.customLibraries[id];
      return { ...b, id, isBuiltin: false, i18n: this._loadBuiltinModule(b.contentLanguage === 'en-US' ? 'builtin:en-US' : 'builtin:zh-CN').i18n };
    }
    throw new Error('KB_LIBRARY_NOT_FOUND');
  }
  _rebuild() {
    const lib = this._library(); this.activeLibraryId = lib.id; this.locale = lib.contentLanguage;
    this.region = lib.region; this.builtinVersion = lib.version; this.builtinUpdatedAt = lib.updatedAt;
    this.builtinSources = clone(lib.sources); this.builtinKB = freeze(clone(lib.rules)); this.i18n = freeze(clone(lib.i18n));
    for (const cat of CATEGORIES) {
      const disabled = new Set(this._state.disabledByLibrary[lib.id]?.[cat] || []);
      const overrides = this._state.overridesByLibrary[lib.id]?.[cat] || [];
      const rows = lib.rules[cat].map(base => ({ ...clone(base), scope: 'library', libraryId: lib.id,
        ...(overrides.find(r => r.id === base.id) || {}), ...(disabled.has(base.id) ? { disabled: true } : {}) }));
      const ids = new Set(rows.map(r => r.id));
      for (const r of this._state.userRules[cat]) if ((r.scope === 'shared' || r.libraryId === lib.id) && !ids.has(r.id)) { rows.push(clone(r)); ids.add(r.id); }
      this[cat] = freeze(rows);
    }
  }
  _loadUserKB() {
    const pristine = clone(this._state);
    try {
      if (!fs.existsSync(USER_KB_FILE)) return;
      if (fs.statSync(USER_KB_FILE).size > schema.MAX_BYTES) throw new Error('KB_FILE_TOO_LARGE');
      const bytes = fs.readFileSync(USER_KB_FILE);
      if (bytes.length > schema.MAX_BYTES) throw new Error('KB_FILE_TOO_LARGE');
      this._diskHash = crypto.createHash('sha256').update(bytes).digest('hex');
      const data = schema.data(JSON.parse(bytes.toString('utf8')));
      if (data.version !== undefined && ![1,2,3,4].includes(data.version)) throw new Error('KB_UNSUPPORTED_STATE_VERSION');
      if (data.version === 4) {
        const next = data;
        if (!Number.isSafeInteger(next.revision) || next.revision < 0 || !next.customLibraries || !next.userRules || !next.disabledByLibrary || !next.overridesByLibrary) throw new Error('KB_INVALID_STATE');
        this._validateState(next);
        this._state = next;
      } else {
        const id = typeof data.activeLibraryId === 'string' && Object.prototype.hasOwnProperty.call(BUILTIN_LIBRARIES, data.activeLibraryId) ? data.activeLibraryId : this._state.activeLibraryId;
        this._state.activeLibraryId = id;
        this._state.disabledByLibrary[id] = clone(data.disabledBuiltinRules || {});
        this._state.overridesByLibrary[id] = {};
        const lib = this._library(id);
        for (const cat of CATEGORIES) {
          if (data[cat] !== undefined && !Array.isArray(data[cat])) throw new Error('KB_INVALID_STATE');
          for (const input of data[cat] || []) {
            const r = schema.rule(input, cat, { requireId: true });
            if (lib.rules[cat].some(base => base.id === r.id)) {
              (this._state.overridesByLibrary[id][cat] ||= []).push({ ...r, scope: 'library', libraryId: id, isUserAdded: true, isBuiltinOverride: true });
            } else {
              this._state.userRules[cat].push({ ...r, scope: r.scope || 'shared', libraryId: r.scope === 'library' ? (r.libraryId || id) : null,
                ...(!r.scope ? { migrationNote: 'historical-shared' } : {}), isUserAdded: true });
            }
          }
        }
      }
      this._validateState(this._state);
    } catch (error) { this._state = pristine; this.loadError = error.message; } // preserve file; no silent overwrite on a later CRUD
  }
  _validateState(next) {
    if (next.version !== 4 || !Number.isSafeInteger(next.revision) || next.revision < 0 || !next.customLibraries || !next.userRules || !next.disabledByLibrary || !next.overridesByLibrary) throw new Error('KB_INVALID_STATE');
    const previous = this._state; this._state = next;
    try {
      for (const [id, lib] of Object.entries(next.customLibraries)) { const valid = schema.library(lib); if (id !== valid.libraryId) throw new Error('KB_INVALID_LIBRARY_ID'); next.customLibraries[id] = valid; }
      this._library(next.activeLibraryId);
      for (const cat of CATEGORIES) {
        if (!Array.isArray(next.userRules[cat])) throw new Error('KB_INVALID_STATE');
        const ids = new Set();
        for (const r of next.userRules[cat]) {
          schema.rule(r, cat, {requireId:true});
          if (!['shared','library'].includes(r.scope) || ids.has(r.id)) throw new Error('KB_INVALID_SCOPE_OR_DUPLICATE');
          ids.add(r.id); if (r.scope === 'library') this._library(r.libraryId);
          for (const id of Object.keys({ ...BUILTIN_LIBRARIES, ...next.customLibraries }))
            if ((r.scope === 'shared' || r.libraryId === id) && this._library(id).rules[cat].some(base => base.id === r.id)) throw new Error('KB_USER_BUILTIN_ID_COLLISION');
        }
      }
      for (const field of ['disabledByLibrary','overridesByLibrary']) for (const [id,bucket] of Object.entries(next[field])) {
        const lib = this._library(id);
        for (const cat of CATEGORIES) if (bucket[cat] !== undefined) {
          const ids = new Set();
          if (!Array.isArray(bucket[cat])) throw new Error('KB_INVALID_STATE');
          for (const entry of bucket[cat]) {
            const entryId = typeof entry === 'string' ? entry : entry.id;
            if (ids.has(entryId)) throw new Error('KB_DUPLICATE_RULE_ID'); ids.add(entryId);
            if (field === 'disabledByLibrary') { if (typeof entry !== 'string' || !lib.rules[cat].some(r => r.id === entry)) throw new Error('KB_INVALID_DISABLED_ID'); }
            else { schema.rule(entry, cat, {requireId:true}); if (entry.scope !== 'library' || entry.libraryId !== id || !lib.rules[cat].some(r => r.id === entry.id)) throw new Error('KB_BUILTIN_OVERRIDE_SCOPE'); }
          }
        }
      }
      if (CATEGORIES.reduce((n,c) => n+next.userRules[c].length,0) > schema.MAX_RULES || Object.keys(next.customLibraries).length > 8) throw new Error('KB_STATE_QUOTA');
    } finally { this._state = previous; }
  }
  _saveUserKB() {
    const tmp = USER_KB_FILE + '.' + crypto.randomUUID() + '.tmp', lock = USER_KB_FILE + '.lock';
    let fd, result;
    try {
      fd = fs.openSync(lock, 'wx');
      const currentHash = fs.existsSync(USER_KB_FILE) ? crypto.createHash('sha256').update(fs.readFileSync(USER_KB_FILE)).digest('hex') : null;
      if (currentHash !== this._diskHash) { result = {ok:false,code:'KB_REVISION_CONFLICT',error:'Persisted knowledge base changed; reload before editing.'}; }
      else {
        const value = schema.data(this._state), text = JSON.stringify(value, null, 2);
        if (Buffer.byteLength(text) > schema.MAX_BYTES) throw new Error('KB_FILE_TOO_LARGE');
        fs.writeFileSync(tmp, text, { flag: 'wx' });
        fs.renameSync(tmp, USER_KB_FILE);
        this._diskHash = crypto.createHash('sha256').update(text).digest('hex');
        result = {ok:true};
      }
    } catch (error) {
      result = { ok: false, code: error.code === 'EEXIST' ? 'KB_REVISION_CONFLICT' : 'KB_PERSISTENCE_FAILED', error: error.message };
    } finally {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { /* retain original failure */ }
      if (fd !== undefined) {
        try { fs.closeSync(fd); fs.unlinkSync(lock); } catch (error) {
          result = {ok:false,code:'KB_PERSISTENCE_FAILED',error:error.message,operationMayBeCommitted:true};
        }
      }
    }
    return result;
  }
  _commit(edit, expectedRevision) {
    if (this.loadError) return { ok: false, code: 'KB_LOAD_FAILED', error: this.loadError };
    if (expectedRevision !== undefined && expectedRevision !== this._state.revision) return { ok: false, code: 'KB_REVISION_CONFLICT', error: 'Knowledge base revision changed.' };
    const before = clone(this._state);
    try {
      const result = edit();
      if (result.unchanged) return { ok: true, ...result, revision: this._state.revision };
      if (CATEGORIES.reduce((n,c) => n+this._state.userRules[c].length,0) > schema.MAX_RULES) throw new Error('KB_TOO_MANY_RULES');
      this._state.revision++; this._validateState(this._state); this._rebuild();
      const save = this._saveUserKB();
      if (!save.ok) { this._state = before; if (save.operationMayBeCommitted) this.loadError = 'KB_PERSISTENCE_RESULT_UNKNOWN'; this._rebuild(); return save; }
      return { ok: true, ...clone(result), revision: this._state.revision };
    } catch (error) { this._state = before; this._rebuild(); return { ok: false, code: 'KB_INVALID_DATA', error: error.message }; }
  }
  getLibraries() { return Object.keys({ ...BUILTIN_LIBRARIES, ...this._state.customLibraries }).map(id => { const l = this._library(id); return {
    id, name: l.name, nameEn: l.nameEn, contentLanguage: l.contentLanguage, region: l.region, version: l.version,
    isBuiltin: l.isBuiltin, active: id === this.activeLibraryId }; }); }
  switchLibrary(id, expectedRevision) { return this._commit(() => {
    this._library(id); if (id === this.activeLibraryId) return { unchanged: true, activeLibraryId: id };
    this._state.activeLibraryId = id; const l = this._library(id);
    return { activeLibraryId: id, region: l.region, locale: l.contentLanguage, version: l.version,
      counts: Object.fromEntries(CATEGORIES.map(c => [c, l.rules[c].length + this._state.userRules[c].filter(r => r.scope === 'shared' || r.libraryId === id).length])) };
  }, expectedRevision); }
  previewLibrary(input) { try { const lib = schema.library(input); return { ok: true, library: lib,
    counts: Object.fromEntries(CATEGORIES.map(c => [c, lib.rules[c].length])), revision: this._state.revision }; }
    catch (error) { return { ok: false, code: 'KB_INVALID_LIBRARY', error: error.message }; } }
  loadLibrary(input, expectedRevision) { return this._commit(() => { const lib = schema.library(input);
    if (Object.prototype.hasOwnProperty.call(this._state.customLibraries, lib.libraryId)) throw new Error('KB_LIBRARY_ID_EXISTS');
    if (Object.keys(this._state.customLibraries).length >= 8) throw new Error('KB_TOO_MANY_LIBRARIES');
    this._state.customLibraries[lib.libraryId] = lib; return { libraryId: lib.libraryId, activated: false };
  }, expectedRevision); }
  getStatus() { return { activeLibraryId: this.activeLibraryId, revision: this._state.revision, aliasVersion: ALIAS_VERSION,
    loadState: this.loadError ? 'UNKNOWN' : 'READY', loadError: this.loadError,
    automaticPlanValidation: process.env.KB_VALIDATION === 'on' ? 'ON' : 'OFF',
    modelAudit: 'MANUAL_PROJECT_SCOPED_DEFAULT_OFF', injection: 'PER_TASK_ONLY' }; }
  getAll() {
    const tier = getCurrentTier(), categories = Object.fromEntries(CATEGORIES.map(c => [c, clone(this[c])]));
    const count = key => Object.fromEntries(CATEGORIES.map(c => [c, this[c].filter(r => key ? r[key] : true).length]));
    const totals = count(); totals.total = Object.values(totals).reduce((a,b) => a+b, 0); totals.userAdded = count('isUserAdded');
    totals.disabled = count('disabled'); totals.disabled.total = Object.values(totals.disabled).reduce((a,b) => a+b,0);
    return { version: 4, schemaVersion: '1.0.0', ...this.getStatus(), locale: this.locale, contentLanguage: this.locale, region: this.region,
      tier: { level: CURRENT_TIER, label: tier.label, labelEn: tier.labelEn, limits: { knowledgeRules: getLimit('knowledgeRules'), templates: getLimit('templates'), commands: getLimit('commands') } },
      builtin: { libraryId: this.activeLibraryId, version: this.builtinVersion, updatedAt: this.builtinUpdatedAt, sources: clone(this.builtinSources),
        counts: { ...Object.fromEntries(CATEGORIES.map(c => [c, this.builtinKB[c].length])), total: CATEGORIES.reduce((n,c) => n+this.builtinKB[c].length,0) } }, ...categories, totals };
  }
  listByCategory(cat) { return CATEGORIES.includes(cat) ? clone(this[cat]) : this.getAll(); }
  search(query, cat = null) { const all = this.getAll(), q = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (!q) return all;
    const rows = Object.fromEntries(CATEGORIES.filter(c => !cat || cat === c).map(c => [c, this[c].filter(r => JSON.stringify(r).toLowerCase().includes(q)).map(clone)]));
    return { ...this.getStatus(), locale: this.locale, region: this.region, ...rows, totals: { ...Object.fromEntries(CATEGORIES.map(c => [c, rows[c]?.length || 0])), total: Object.values(rows).reduce((n,r) => n+r.length,0) } };
  }
  createSnapshot() {
    if (this.loadError) throw new Error('KB_LOAD_FAILED:' + this.loadError);
    const snapshot = freeze({ ...this.getStatus(), locale: this.locale, region: this.region, i18n: clone(this.i18n),
      ...Object.fromEntries(CATEGORIES.map(c => [c, clone(this[c])])) });
    this._snapshots.add(snapshot); return snapshot;
  }
  verifySnapshot(snapshot) { return this._view(snapshot); }
  _view(snapshot) { if (!this._snapshots.has(snapshot)) throw new Error('KB_SNAPSHOT_UNTRUSTED'); return snapshot; }
  _match(text, keywords) { const t = String(text || '').normalize('NFKC').toLowerCase(); return keywords.some(k => {
    const token = k.toLowerCase(); if (/^[a-z0-9 ]+$/.test(token)) { const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp('(^|[^a-z0-9])' + escaped + '(?=$|[^a-z0-9])').test(t); }
    return t.includes(token);
  }); }
  buildKnowledgeSection(context = {}) {
    const view = context.knowledgeSnapshot ? this._view(context.knowledgeSnapshot) : this;
    const steps = Array.isArray(context.steps) ? context.steps.filter(s => s && typeof s === 'object') : [];
    const userIntent = String(context.userIntent || '').toLowerCase();
    if (this.loadError && !context.knowledgeSnapshot) return '';
    const kw = view.i18n.intentKeywords;

    const isMEP = steps.some(s => ['CreatePipe', 'CreateDuct', 'CreateCableCarrier', 'CreatePipeSystem'].includes(s.action)) ||
                  this._match(userIntent, kw.pipe);
    const isBuilding = steps.some(s => ['CreateWall', 'CreateColumn', 'CreateBeam', 'CreateSlab', 'CreateRoof'].includes(s.action)) ||
                       this._match(userIntent, kw.building);
    const isDoorWindow = steps.some(s => ['CreateDoor', 'CreateWindow'].includes(s.action)) ||
                         this._match(userIntent, kw.doorWindow);

    let section = `\n${view.i18n.sectionTitle}\n`;
    section += `${view.i18n.sectionIntro}\n\n`;

    if (isBuilding || isDoorWindow) {
      section += `${view.i18n.buildingTitle}\n`;
      // 严格排除已禁用规则
      const relevant = view.buildingCode.filter(r => {
        if (r.disabled) return false;
        if (r.commandAction) return steps.some(s => s?.action === r.commandAction);
        if (isDoorWindow && (r.field === 'width' || r.category === 'fireproof')) return true;
        if (isBuilding && (r.field === 'height' || r.field === 'thickness' || r.field === 'roomArea')) return true;
        return false;
      });
      for (const r of relevant.slice(0, 8)) {
        const sevLabel = r.severity === 'error' ? view.i18n.severityError : view.i18n.severityWarning;
        section += `- [${sevLabel}] ${r.rule} (${view.i18n.sourceLabel}: ${r.source})\n`;
      }
      section += '\n';
    }

    if (isMEP) {
      section += `${view.i18n.mepTitle}\n`;
      // 严格排除已禁用规则
      const relevant = view.mepStandard.filter(r => {
        if (r.disabled) return false;
        return steps.some(s => r.commandAction === s.action) ||
               (this._match(userIntent, kw.drainage) && r.subType === 'Drainage') ||
               (this._match(userIntent, kw.water) && r.subType === 'Water') ||
               (this._match(userIntent, kw.duct) && r.subType === 'Duct') ||
               (this._match(userIntent, kw.electrical) && r.subType === 'Electrical');
      });
      const activeMepRules = view.mepStandard.filter(r => !r.disabled);
      for (const r of (relevant.length > 0 ? relevant : activeMepRules).slice(0, 8)) {
        const sevLabel = r.severity === 'error' ? view.i18n.severityError : view.i18n.severityWarning;
        section += `- [${sevLabel}] ${r.rule} (${view.i18n.sourceLabel}: ${r.source})\n`;
      }
      section += '\n';
    }

    if (isBuilding || isDoorWindow) {
      section += `${view.i18n.materialTitle}\n`;
      for (const hint of view.material.filter(r => !r.disabled).slice(0, 8).map(r => `${r.material} (${r.source || ''})`)) {
        section += `- ${hint}\n`;
      }
      section += '\n';
    }

    return section;
  }

  validatePlan(plan, snapshot) {
    const view = snapshot ? this._view(snapshot) : this;
    plan = plan || {};
    const violations = [];
    if (this.loadError && !snapshot) violations.push({ stepIndex: -1, rule: 'KB_LOAD_FAILED', severity: 'error', message: this.loadError });
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    let evaluatedCount = 0;
    const ACTION_ALIAS = { 'AutoRoutePipe': 'CreatePipe' };

    steps.forEach((step, idx) => {
      if (!step || typeof step !== 'object') return;
      const params = step.params || {};
      const action = step.action;
      const effectiveAction = ACTION_ALIAS[action] || action;
      for (const [field, value] of Object.entries(params)) if (['height','thickness','width','diameterMm','clearanceMm','z','slope'].includes(field) && (typeof value !== 'number' || !Number.isFinite(value)))
        violations.push({ stepIndex: idx, rule: 'KB_INVALID_NUMERIC_PARAMETER', severity: 'error', message: field + ' must be finite numeric input.' });

      for (const rule of view.buildingCode) {
        // 核心修复：排除已禁用规则
        if (rule.disabled) continue;
        if (!rule.field) continue;
        if (rule.commandAction && rule.commandAction !== action) continue;
        const value = params[rule.field];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          violations.push({stepIndex:idx,ruleId:rule.id,rule:'KB_INVALID_NUMERIC_PARAMETER',severity:'error',message:rule.field + ' must be finite numeric input.'});
          continue;
        }

        if (!rule.commandAction && !(
            action === 'CreateWall' && ['height','thickness'].includes(rule.field) ||
            ['CreateSlab','CreateRoof','CreateBeam'].includes(action) && rule.field === 'thickness' ||
            ['CreateDoor','CreateWindow'].includes(action) && rule.field === 'width')) continue;
        if (rule.minValue === undefined && rule.maxValue === undefined && !rule.minRange) continue;
        evaluatedCount++;
        if (rule.commandAction) {
          if (typeof rule.minValue === 'number' && typeof value === 'number' && value < rule.minValue ||
              typeof rule.maxValue === 'number' && typeof value === 'number' && value > rule.maxValue ||
              rule.minRange && typeof value === 'number' && (value < rule.minRange[0] || value > rule.minRange[1]))
            violations.push({ stepIndex: idx, ruleId: rule.id, rule: rule.rule, severity: rule.severity || 'warning', message: action + ' ' + rule.field + '=' + value + ' violates ' + rule.id });
          continue;
        }

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

      for (const rule of view.mepStandard) {
        // 核心修复：排除已禁用规则
        if (rule.disabled) continue;
        const matchesAction = rule.commandAction === action || (rule.commandAction === effectiveAction && !rule.subType);
        if (!rule.commandAction || !matchesAction) continue;
        if (!rule.field) continue;

        if (rule.subType) {
          const stepText = ((step.title || '') + ' ' + (step.description || '') + ' ' + (plan.userIntent || '')).normalize('NFKC').toLowerCase();
          const kw = view.i18n.intentKeywords;
          const isWaterMatch = rule.subType === 'Water' && this._match(stepText, kw.water);
          const isDrainageMatch = rule.subType === 'Drainage' && this._match(stepText, kw.drainage);
          const isDuctBath = rule.subType === 'Duct' && /卫生间|排风|换气|bathroom|exhaust/.test(stepText) && rule.id === 'MEP-103';
          const isDuctKitchen = rule.subType === 'Duct' && /厨房|油烟|炊事|kitchen|range/.test(stepText) && rule.id === 'MEP-104';

          if (rule.subType === 'Water' && !isWaterMatch && this._match(stepText, kw.drainage)) continue;
          if (rule.subType === 'Drainage' && !isDrainageMatch && this._match(stepText, kw.water)) continue;
          if (rule.id === 'MEP-103' && !isDuctBath) continue;
          if (rule.id === 'MEP-104' && !isDuctKitchen) continue;
        }

        const value = params[rule.field];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          violations.push({stepIndex:idx,ruleId:rule.id,rule:'KB_INVALID_NUMERIC_PARAMETER',severity:'error',message:rule.field + ' must be finite numeric input.'});
          continue;
        }

        if (rule.minValue === undefined && rule.maxValue === undefined && !rule.minRange) continue;
        evaluatedCount++;
        if (typeof rule.minValue === 'number' && typeof value === 'number' && value < rule.minValue) {
          violations.push({ stepIndex: idx, rule: rule.rule, severity: rule.severity, message: `${action} ${rule.field}=${value} < ${rule.minValue} (${rule.rule})` });
        }
        if (typeof rule.maxValue === 'number' && typeof value === 'number' && value > rule.maxValue) {
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
      ...{ activeLibraryId: view.activeLibraryId, revision: snapshot ? snapshot.revision : this._state.revision, aliasVersion: ALIAS_VERSION },
      passed: errors.length === 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      violations,
      errors,
      warnings,
      validationKind: 'PLAN_PARAMETER_CHECK_ONLY', modelAudit: 'MANUAL_PROJECT_SCOPED_DEFAULT_OFF', evaluatedCount,
      coverage: evaluatedCount > 0 ? 'SUPPORTED_PARAMETERS_ONLY' : 'NO_SUPPORTED_CHECKS',
      summary: errors.length > 0
        ? `${errors.length} violation(s) must fix + ${warnings.length} warning(s)`
        : warnings.length > 0
          ? `${warnings.length} warning(s) (optimize recommended)`
          : 'No violations detected by supported plan-parameter checks (not a model compliance audit)'
    };
  }

  _generateId(category) {
    const prefix = category === 'buildingCode' ? 'BC' : category === 'mepStandard' ? 'MEP' : 'MAT';
    const ids = new Set(this._state.userRules[category].map(r => r.id));
    for (const id of Object.keys({ ...BUILTIN_LIBRARIES, ...this._state.customLibraries })) for (const r of this._library(id).rules[category]) ids.add(r.id);
    let n = 1; while (ids.has(`${prefix}-${String(n).padStart(3,'0')}`)) n++;
    return `${prefix}-${String(n).padStart(3,'0')}`;
  }
  _scoped(input, fallback = 'library') { const r = clone(input); r.scope ||= fallback;
    r.libraryId = r.scope === 'shared' ? null : (r.libraryId || this.activeLibraryId);
    if (r.scope === 'library') this._library(r.libraryId); return r;
  }
  _quota() { const count = CATEGORIES.reduce((n,c) => n + this._state.userRules[c].length, 0);
    if (!checkLimit('knowledgeRules', count).allowed || count >= schema.MAX_RULES) throw new Error('KB_RULE_LIMIT'); }
  addRule(cat, input, revision) { return this._commit(() => {
    const r = schema.rule(input, cat); delete r.id; delete r.isBuiltinOverride;
    this._quota(); const row = { ...this._scoped(r), id: this._generateId(cat), isUserAdded: true, addedAt: new Date().toISOString() };
    this._state.userRules[cat].push(row); return { rule: row };
  }, revision); }
  updateRule(cat, id, input, revision) { return this._commit(() => {
    if (!CATEGORIES.includes(cat)) throw new Error('KB_INVALID_CATEGORY');
    const original = this[cat].find(r => r.id === id); if (!original) throw new Error('KB_RULE_NOT_FOUND');
    const updates = schema.rule({ ...original, ...input, id }, cat, { requireId: true });
    const base = this._library().rules[cat].some(r => r.id === id);
    if (base && ((updates.scope && updates.scope !== 'library') || (updates.libraryId && updates.libraryId !== this.activeLibraryId))) throw new Error('KB_BUILTIN_OVERRIDE_SCOPE');
    const row = { ...this._scoped(updates), id, isUserAdded: true, isBuiltinOverride: base, updatedAt: new Date().toISOString() };
    if (base) { const bucket = (this._state.overridesByLibrary[this.activeLibraryId] ||= {}); bucket[cat] ||= []; const index = bucket[cat].findIndex(r => r.id === id); if (index < 0) bucket[cat].push(row); else bucket[cat][index] = row; }
    else { const index = this._state.userRules[cat].findIndex(r => r.id === id && (r.scope === 'shared' || r.libraryId === this.activeLibraryId)); this._state.userRules[cat][index] = row; }
    return { rule: row };
  }, revision); }
  deleteRule(cat, id, revision) { return this._commit(() => {
    if (!CATEGORIES.includes(cat)) throw new Error('KB_INVALID_CATEGORY');
    const original = this[cat].find(r => r.id === id); if (!original) throw new Error('KB_RULE_NOT_FOUND');
    const base = this._library().rules[cat].some(r => r.id === id);
    if (base) { const bucket = (this._state.disabledByLibrary[this.activeLibraryId] ||= {}); bucket[cat] ||= []; if (!bucket[cat].includes(id)) bucket[cat].push(id); return { action: 'disabled', rule: { ...original, disabled: true } }; }
    this._state.userRules[cat] = this._state.userRules[cat].filter(r => r.id !== id); return { action: 'deleted' };
  }, revision); }
  enableRule(cat, id, revision) { return this._commit(() => {
    if (!CATEGORIES.includes(cat)) throw new Error('KB_INVALID_CATEGORY');
    const original = this[cat].find(r => r.id === id); if (!original || !original.disabled) throw new Error('KB_RULE_NOT_DISABLED');
    const bucket = (this._state.disabledByLibrary[this.activeLibraryId] ||= {}); bucket[cat] = (bucket[cat] || []).filter(x => x !== id);
    const override = this._state.overridesByLibrary[this.activeLibraryId]?.[cat]?.find(r => r.id === id); if (override) delete override.disabled;
    const user = this._state.userRules[cat].find(r => r.id === id); if (user) delete user.disabled;
    return { rule: { ...original, disabled: false } };
  }, revision); }
  exportAll() { return { ...this.getAll(), persistence: clone(this._state), exportedAt: new Date().toISOString() }; }
  importRules(input, overwrite = false, revision) { return this._commit(() => {
    const data = schema.data(input);
    if (data.persistence) {
      if (!overwrite || data.persistence.version !== 4) throw new Error('KB_RESTORE_REQUIRES_OVERWRITE_V4');
      const restored = clone(data.persistence); restored.revision = this._state.revision;
      this._validateState(restored); this._state = restored;
      return { restored: true, stats: Object.fromEntries(CATEGORIES.map(c => [c, restored.userRules[c].length])) };
    }
    const stats = { buildingCode: 0, mepStandard: 0, material: 0, skipped: 0 };
    let count = 0;
    for (const cat of CATEGORIES) {
      if (data[cat] !== undefined && !Array.isArray(data[cat])) throw new Error('KB_INVALID_CATEGORY');
      for (const source of data[cat] || []) {
        if (++count > schema.MAX_RULES) throw new Error('KB_TOO_MANY_RULES');
        const row = schema.rule(source, cat); row.id ||= this._generateId(cat); schema.rule(row, cat, { requireId: true });
        const base = this._library().rules[cat].some(r => r.id === row.id);
        const existing = this[cat].some(r => r.id === row.id) || this._state.userRules[cat].some(r => r.id === row.id);
        if (existing && !overwrite) { stats.skipped++; continue; }
        if (base) {
          if ((row.libraryId && row.libraryId !== this.activeLibraryId) || row.scope === 'shared') throw new Error('KB_BUILTIN_OVERRIDE_SCOPE');
          const bucket = (this._state.overridesByLibrary[this.activeLibraryId] ||= {}); bucket[cat] ||= [];
          bucket[cat] = bucket[cat].filter(r => r.id !== row.id);
          bucket[cat].push({ ...row, scope: 'library', libraryId: this.activeLibraryId, isUserAdded: true, isBuiltinOverride: true });
        } else {
          const index = this._state.userRules[cat].findIndex(r => r.id === row.id);
          const imported = { ...this._scoped(row, 'shared'), isUserAdded: true, isBuiltinOverride: false };
          if (index >= 0) {
            const old = this._state.userRules[cat][index];
            if (old.scope !== imported.scope || old.libraryId !== imported.libraryId) throw new Error('KB_IMPORT_SCOPE_CONFLICT');
            this._state.userRules[cat][index] = imported;
          } else { this._quota(); this._state.userRules[cat].push(imported); }
        }
        stats[cat]++;
      }
    }
    return { stats };
  }, revision); }
  resetToBuiltin(revision) { return this._commit(() => {
    this._state.userRules = { buildingCode: [], mepStandard: [], material: [] }; this._state.disabledByLibrary = {}; this._state.overridesByLibrary = {};
    const lib = this._library();
    return { ...Object.fromEntries(CATEGORIES.map(c => [c, lib.rules[c].length])), total: CATEGORIES.reduce((n,c) => n+lib.rules[c].length,0), resetScope: 'ALL_USER_RULES_AND_OVERRIDES', customLibrariesRetained: true };
  }, revision); }
}
module.exports = new KnowledgeBase();
