// SPDX-License-Identifier: MIT
'use strict';
// One encrypted persisted authority. Draft tests never write or activate it.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { resolveConfig, failure } = require('./llm-provider-config');
const tokenKey = crypto.randomBytes(32); // opaque legacy CAS token, not a public credential digest
function createConfigStore({ file, io = fs, crypt = require('./llm-config-crypto') }) {
  function read() {
    if (!io.existsSync(file)) return { raw: null, configId: 'unconfigured', revision: 0 };
    const bytes = io.readFileSync(file, 'utf8');
    let raw; try { raw = JSON.parse(bytes.replace(/^\uFEFF/, '')); } catch (_) { throw failure('LLM_CONFIG_LOAD_FAILED'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw failure('LLM_CONFIG_LOAD_FAILED');
    const configId = crypto.createHmac('sha256', tokenKey).update(bytes).digest('hex');
    return { raw, configId, revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0 };
  }
  function metadata(snapshot = read()) {
    const { raw, configId, revision } = snapshot;
    if (!raw) return { configured: false, configId, revision, disabled: false, provider: null, rawEndpoint: '', effectiveEndpoint: '', model: '', keyPresent: false, credentialState: 'NOT_SET', supported: true };
    let resolved, code = null;
    try { resolved = resolveConfig(raw); } catch (e) { code = e.code; }
    return { configured: true, configId, revision, provider: raw.provider || null, rawEndpoint: resolved?.rawEndpoint || '', effectiveEndpoint: resolved?.effectiveEndpoint || '', model: resolved?.model || raw.model || '', disabled: raw.disabled === true, keyPresent: !!raw.apiKey, credentialState: raw.apiKey ? 'STORED_NOT_EXPOSED' : 'NOT_SET', supported: code !== 'LLM_UNSUPPORTED_PROVIDER', code };
  }
  function assertExpected(expected, snapshot) {
    if (typeof expected !== 'string' || expected !== snapshot.configId) throw failure('LLM_CONFIG_CONFLICT');
  }
  function credentials(snapshot) {
    if (!snapshot.raw) throw failure('LLM_NOT_CONFIGURED');
    if (snapshot.raw.disabled === true) throw failure('LLM_DISABLED');
    let apiKey;
    if (snapshot.raw.apiKey) { try { apiKey = crypt.decrypt(snapshot.raw.apiKey); } catch (_) { throw failure('LLM_KEY_UNAVAILABLE'); } }
    const resolved = resolveConfig(snapshot.raw);
    if (resolved.protocol !== 'ollama' && !apiKey) throw failure('LLM_API_KEY_REQUIRED');
    return { ...snapshot.raw, ...resolved, apiKey };
  }
  function draft(input, snapshot) {
    assertExpected(input.expectedConfigId, snapshot);
    const resolved = resolveConfig(input);
    let apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (apiKey && (apiKey === '***' || apiKey.includes('...') || apiKey.includes('•'))) throw failure('LLM_MASKED_KEY_NOT_CREDENTIAL');
    if (resolved.protocol !== 'ollama' && !apiKey && input.reuseSavedKey === true) {
      if (!snapshot.raw?.apiKey || snapshot.raw.provider !== resolved.provider) throw failure('LLM_CREDENTIAL_BINDING_MISMATCH');
      let saved; try { saved = resolveConfig(snapshot.raw); } catch (_) { throw failure('LLM_CREDENTIAL_BINDING_MISMATCH'); }
      if (saved.effectiveEndpoint !== resolved.effectiveEndpoint) throw failure('LLM_CREDENTIAL_BINDING_MISMATCH');
      try { apiKey = crypt.decrypt(snapshot.raw.apiKey); } catch (_) { throw failure('LLM_KEY_UNAVAILABLE'); }
    }
    if (resolved.protocol !== 'ollama' && !apiKey) throw failure('LLM_API_KEY_REQUIRED');
    return { ...resolved, endpoint: resolved.rawEndpoint || null, apiKey, disabled: false };
  }
  function commit(raw, expected) {
    const lock = file + '.lock', temp = file + '.' + crypto.randomUUID() + '.tmp';
    let fd, committed = false, result, failureError;
    try {
      io.mkdirSync(path.dirname(file), { recursive: true });
      fd = io.openSync(lock, 'wx'); const current = read(); assertExpected(expected, current);
      const next = { ...raw, revision: current.revision + 1 };
      io.writeFileSync(temp, JSON.stringify(next, null, 2), { flag: 'wx' }); io.renameSync(temp, file); committed = true;
      result = read();
    } catch (e) { failureError = Object.assign(failure(e.code === 'EEXIST' ? 'LLM_CONFIG_CONFLICT' : e.code?.startsWith('LLM_') ? e.code : 'LLM_CONFIG_SAVE_FAILED'), { operationMayBeCommitted: committed }); }
    finally {
      try { if (io.existsSync(temp)) io.unlinkSync(temp); } catch (_) { /* unrelated file never touched */ }
      if (fd !== undefined) { try { io.closeSync(fd); io.unlinkSync(lock); } catch (_) { failureError = Object.assign(failure('LLM_CONFIG_SAVE_FAILED'), { operationMayBeCommitted: committed }); } }
    }
    if (failureError) throw failureError;
    return result;
  }
  function save(input) {
    const snap = read(), config = draft(input, snap);
    const raw = { provider: config.provider, endpoint: config.endpoint, model: config.model, disabled: false };
    if (config.protocol !== 'ollama') raw.apiKey = crypt.encrypt(config.apiKey);
    return commit(raw, snap.configId);
  }
  function setDisabled(disabled, expected) {
    const snap = read(); assertExpected(expected, snap); if (!snap.raw) throw failure('LLM_NOT_CONFIGURED');
    if (!disabled) credentials({ ...snap, raw: { ...snap.raw, disabled: false } });
    return commit({ ...snap.raw, disabled }, snap.configId);
  }
  return { read, metadata, credentials, draft, assertExpected, save, setDisabled };
}
module.exports = { createConfigStore };
