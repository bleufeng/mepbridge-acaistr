'use strict';

/**
 * cad-layer-mapping-store.js
 * C-CAD-03 (WP-02): CAD 图层项目映射与草稿持久化存储模块
 *
 * 权威契约：
 *   - C_CAD_REVERSE_MODELING_MASTER_PLAN_20261024 §4.3 (WP-02), §4.4 与 §4.5
 *
 * 核心机制：
 *   - 本地用户配置存储，AC 模型严格只读（零模型写入）
 *   - 确认映射与草稿分离：<projectKey>.json 与 <projectKey>.draft.json
 *   - 版本冲突检测：mappingRevision 与 draftRevision
 *   - 覆盖前自动备份：<projectKey>.bak
 *   - 临时文件 + rename 原子写入保护
 *   - 未解决项拦截：确认映射严禁包含 pending / reviewRequired 项（MAPPING_UNRESOLVED_ITEMS）
 *   - 未命名工程拦截：PROJECT_UNIDENTIFIABLE
 */

const fs = require('fs');
const path = require('path');
const { dataPath, ensureDir } = require('./runtime-paths');

const SCHEMA_VERSION = 'cad-mapping-v1';
const RULE_VERSION = 'cad0-1';

// 权威用途枚举：门、窗、洞口必须分开，不可合并；标注与尺寸为 dimension，文本与注释为 text
const VALID_USE_CATEGORIES = new Set([
  'grid',
  'column',
  'wall',
  'door',
  'window',
  'opening',
  'text',
  'dimension',
  'other',
  'ignore'
]);

function fail(errorType, message, httpStatus = 400, detail) {
  throw Object.assign(new Error(message), { errorType, httpStatus, detail });
}
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
function revision(expected, current, errorType) {
  if (!Number.isSafeInteger(expected) || expected < 0 || expected !== current)
    fail(errorType, 'Explicit non-negative integer revision must match current state', 409, { expected, currentRevision: current });
}
function nextRevision(current) {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER)
    fail('REVISION_EXHAUSTED', 'Revision cannot be incremented safely', 409);
  return current + 1;
}
function session(key) {
  if (typeof key !== 'string' || !key.trim()) fail('SESSION_KEY_REQUIRED', 'Untitled drafts require an explicit sessionKey');
  return key;
}
function canonicalGuid(guid) {
  return typeof guid === 'string' ? guid.trim().replace(/^\{|\}$/g, '').toLowerCase() : '';
}
class CadLayerMappingStore {
  constructor(options = {}) {
    this.storageDir = options.storageDir || dataPath('cad-layer-mappings');
    ensureDir(this.storageDir);
    this._sessionDrafts = new Map();
  }
  _key(projectKey) {
    if (typeof projectKey !== 'string' || !/^fnv1a64:[0-9a-f]{16}$/.test(projectKey)) fail('INVALID_PROJECT_KEY', 'Expected canonical fnv1a64:<16 lowercase hex> project key');
    return projectKey.replace(/:/g, '_');
  }
  _getConfirmedFilePath(key) { return path.join(this.storageDir, this._key(key) + '.json'); }
  _getDraftFilePath(key) { return path.join(this.storageDir, this._key(key) + '.draft.json'); }
  _getBackupFilePath(key) { return path.join(this.storageDir, this._key(key) + '.bak'); }
  _readJsonFile(file, projectKey, draft = false) {
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      const validRevision = value => Number.isSafeInteger(value) && value >= 0;
      const rev = draft ? doc?.draftRevision : doc?.mappingRevision;
      if (!doc || Array.isArray(doc) || doc.schemaVersion !== SCHEMA_VERSION || doc.projectKey !== projectKey ||
          !validRevision(rev) || rev === 0 || !Array.isArray(doc.entries) ||
          doc.entries.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry)) ||
          (draft && !validRevision(doc.basedOnMappingRevision)) ||
          (doc.deleted !== undefined && typeof doc.deleted !== 'boolean') ||
          (doc.reset !== undefined && typeof doc.reset !== 'boolean') ||
          ((doc.deleted === true || doc.reset === true) && doc.entries.length !== 0))
        throw new Error('Invalid mapping document shape, identity or revision');
      return doc;
    }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      fail('MAPPING_READ_FAILED', 'Mapping is unreadable or corrupt; refusing overwrite', 500, { cause: error.code || error.name });
    }
  }
  _atomicWriteJson(file, data) {
    const temp = file + '.' + require('crypto').randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temp, file);
    } catch (error) {
      fail('MAPPING_WRITE_FAILED', 'Atomic mapping write failed', 500, { cause: error.code });
    } finally {
      try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') console.warn('Mapping temp cleanup failed:', error.code); }
    }
  }
  _backup(key) {
    try { fs.copyFileSync(this._getConfirmedFilePath(key), this._getBackupFilePath(key)); }
    catch (error) { fail('MAPPING_BACKUP_FAILED', 'Backup failed; original mapping retained', 500, { cause: error.code }); }
  }
  _withLock(key, fn) {
    if (!key) return fn(); // synchronous session map operations do not yield
    const lock = path.join(this.storageDir, this._key(key) + '.lock');
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (error) { fail('MAPPING_LOCKED', 'Project mapping is locked; retry or inspect abandoned lock', 409, { cause: error.code }); }
    let result, operationError, releaseError;
    try { result = fn(); } catch (error) { operationError = error; }
    try { fs.closeSync(fd); } catch (error) { releaseError = error; }
    try { fs.unlinkSync(lock); } catch (error) { releaseError = releaseError || error; }
    if (operationError) {
      if (releaseError) operationError.detail = { ...operationError.detail, lockReleaseError: releaseError.code };
      throw operationError;
    }
    if (releaseError) fail('MAPPING_LOCK_RELEASE_FAILED', 'Operation completed but lock release failed; re-read state before retry', 500,
      { operationCompleted: true, cause: releaseError.code });
    return result;
  }
  getConfirmedMapping(projectKey) {
    return projectKey ? this._readJsonFile(this._getConfirmedFilePath(projectKey), projectKey) : null;
  }
  getDraftMapping(projectKey, sessionKey) {
    return projectKey ? this._readJsonFile(this._getDraftFilePath(projectKey), projectKey, true) : clone(this._sessionDrafts.get(session(sessionKey)) || null);
  }
  saveConfirmedMapping({ projectKey, identity, entries, expectedMappingRevision, expectedDraftRevision }) {
    if (!identity?.isIdentifiable || !projectKey) fail('PROJECT_UNIDENTIFIABLE', 'Saved live project identity required');
    if (identity.projectKey !== projectKey) fail('PROJECT_IDENTITY_MISMATCH', 'Identity and project key differ');
    if (!Array.isArray(entries)) fail('INVALID_MAPPING_ENTRIES', 'entries must be an array');
    // Check unresolved intent before stable identity validation.
    for (const entry of entries) {
      if (!entry || !VALID_USE_CATEGORIES.has(entry.confirmedUse) || entry.status === 'pending' || entry.reviewRequired === true)
        fail('MAPPING_UNRESOLVED_ITEMS', 'Every confirmed entry requires a resolved use');
    }
    const seen = new Set();
    for (const entry of entries) {
      const guid = canonicalGuid(entry.guid);
      if (!guid || !/^[a-z0-9-]+$/.test(guid) || canonicalGuid(String(entry.layerKey || '').replace(/^guid:/, '')) !== guid || !String(entry.layerKey).startsWith('guid:') || seen.has(guid))
        fail('MAPPING_LAYER_IDENTITY_INVALID', 'Confirmed entries require unique coherent GUID keys; index/name cannot bind confirmation');
      seen.add(guid);
    }
    const existing = this.getConfirmedMapping(projectKey);
    const draft = this.getDraftMapping(projectKey);
    revision(expectedMappingRevision, existing?.mappingRevision || 0, 'REVISION_CONFLICT');
    revision(expectedDraftRevision, draft?.draftRevision || 0, 'DRAFT_REVISION_CONFLICT');
    if (draft && !draft.reset) revision(draft.basedOnMappingRevision, existing?.mappingRevision || 0, 'DRAFT_BASE_REVISION_CONFLICT');
    if (existing) this._backup(projectKey);
    const now = new Date().toISOString();
    const doc = { schemaVersion: SCHEMA_VERSION, projectKey, projectName: identity.projectName, projectPath: identity.projectPath,
      mappingRevision: nextRevision(existing?.mappingRevision || 0), ruleVersion: RULE_VERSION, updatedAt: now,
      entries: entries.map(e => ({ ...clone(e), guid: canonicalGuid(e.guid), layerKey: 'guid:' + canonicalGuid(e.guid), updatedAt: now })) };
    this._atomicWriteJson(this._getConfirmedFilePath(projectKey), doc);
    // Old drafts retain their base revision and are explicitly stale, never silently promoted.
    return { ok: true, mappingRevision: doc.mappingRevision, mapping: doc };
  }
  saveDraftMapping({ projectKey, identity, entries, expectedDraftRevision, basedOnMappingRevision, sessionKey }) {
    if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry)))
      fail('INVALID_DRAFT_ENTRIES', 'entries must be an array of entry objects');
    const persistent = Boolean(identity?.isIdentifiable && projectKey);
    if (persistent && identity.projectKey !== projectKey) fail('PROJECT_IDENTITY_MISMATCH', 'Identity and project key differ');
    const existing = this.getDraftMapping(persistent ? projectKey : null, sessionKey);
    const mapping = persistent ? this.getConfirmedMapping(projectKey) : null;
    revision(expectedDraftRevision, existing?.draftRevision || 0, 'DRAFT_REVISION_CONFLICT');
    revision(basedOnMappingRevision, mapping?.mappingRevision || 0, 'DRAFT_BASE_REVISION_CONFLICT');
    const doc = { schemaVersion: SCHEMA_VERSION, projectKey: persistent ? projectKey : null,
      ...(persistent ? { projectName: identity.projectName, projectPath: identity.projectPath } : { sessionKey: session(sessionKey), isIdentifiable: false }),
      draftRevision: nextRevision(existing?.draftRevision || 0), basedOnMappingRevision, updatedAt: new Date().toISOString(), entries: clone(entries) };
    if (persistent) this._atomicWriteJson(this._getDraftFilePath(projectKey), doc);
    else this._sessionDrafts.set(sessionKey, clone(doc));
    return { ok: true, draftRevision: doc.draftRevision, draft: doc };
  }
  deleteConfirmedMapping({ projectKey, expectedMappingRevision, confirm }) {
    if (confirm !== true) fail('CONFIRM_REQUIRED', 'Deletion requires confirm: true');
    if (!projectKey) fail('PROJECT_UNIDENTIFIABLE', 'Saved project identity required');
    const existing = this.getConfirmedMapping(projectKey);
    revision(expectedMappingRevision, existing?.mappingRevision || 0, 'REVISION_CONFLICT');
    if (existing) this._backup(projectKey);
    // Atomic logical deletion keeps a revision tombstone, preventing delete/recreate ABA.
    const mapping = { schemaVersion: SCHEMA_VERSION, projectKey, deleted: true, mappingRevision: nextRevision(existing?.mappingRevision || 0), entries: [], updatedAt: new Date().toISOString() };
    this._atomicWriteJson(this._getConfirmedFilePath(projectKey), mapping);
    return { ok: true, deleted: Boolean(existing && !existing.deleted), mappingRevision: mapping.mappingRevision, mapping };
  }
  resetDraft({ projectKey, expectedDraftRevision, sessionKey }) {
    const existing = this.getDraftMapping(projectKey, sessionKey);
    revision(expectedDraftRevision, existing?.draftRevision || 0, 'DRAFT_REVISION_CONFLICT');
    const draft = { schemaVersion: SCHEMA_VERSION, projectKey: projectKey || null, reset: true,
      draftRevision: nextRevision(existing?.draftRevision || 0), basedOnMappingRevision: projectKey ? (this.getConfirmedMapping(projectKey)?.mappingRevision || 0) : 0,
      entries: [], updatedAt: new Date().toISOString() };
    if (projectKey) this._atomicWriteJson(this._getDraftFilePath(projectKey), draft);
    else this._sessionDrafts.set(session(sessionKey), clone(draft));
    return { ok: true, reset: true, draftRevision: draft.draftRevision, draft };
  }
}
// One project lock covers mapping AND draft compare/read/write across processes.
for (const name of ['saveConfirmedMapping', 'saveDraftMapping', 'deleteConfirmedMapping', 'resetDraft']) {
  const operation = CadLayerMappingStore.prototype[name];
  CadLayerMappingStore.prototype[name] = function (args) { return this._withLock(args.projectKey, () => operation.call(this, args)); };
}

// 单例默认实例
const defaultStore = new CadLayerMappingStore();

module.exports = {
  CadLayerMappingStore,
  defaultStore,
  VALID_USE_CATEGORIES,
  SCHEMA_VERSION,
  RULE_VERSION,
  canonicalGuid
};
