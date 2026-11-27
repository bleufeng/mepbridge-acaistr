// SPDX-License-Identifier: MIT
'use strict';
const router = require('express').Router();
const { migrateLegacyFile } = require('../services/runtime-paths');
const { createConfigStore } = require('../services/llm-config-store');
const { PROFILES, probeConfig, failure } = require('../services/llm-provider-config');
const store = createConfigStore({ file: migrateLegacyFile('.llm-config.json') });
function runtime() { return require('../services/ai-adapter'); }
function view(snapshot) { return { ...store.metadata(snapshot), runtime: runtime().getLlmRuntimeState(), profiles: Object.fromEntries(Object.entries(PROFILES).map(([name, p]) => [name, { endpoint: p.endpoint, model: p.model }])) }; }
function error(res, e) {
  const code = e.code?.startsWith('LLM_') ? e.code : 'LLM_CONFIG_OPERATION_FAILED';
  return res.status(code === 'LLM_CONFIG_CONFLICT' ? 409 : ['LLM_CONFIG_LOAD_FAILED','LLM_CONFIG_SAVE_FAILED','LLM_RUNTIME_APPLY_FAILED','LLM_KEY_UNAVAILABLE'].includes(code) ? 503 : 400)
    .json({ success: false, code, error: code, ...(e.saved ? { saved: true } : {}), ...(e.operationMayBeCommitted ? { operationMayBeCommitted: true } : {}) });
}
router.get('/load', (_req, res) => { try { return res.json({ success: true, ...view(store.read()) }); } catch (e) { return error(res, e); } });
function apply(snapshot) {
  const applied = runtime().loadConfig(snapshot);
  if (!applied?.ok || applied.configId !== snapshot.configId) throw Object.assign(failure('LLM_RUNTIME_APPLY_FAILED'), { saved: true });
  return view(snapshot);
}
router.post('/save', (req, res) => { try { const snapshot = store.save(req.body || {}); return res.json({ success: true, ...apply(snapshot) }); } catch (e) { return error(res, e); } });
for (const [action, disabled] of [['disconnect', true], ['connect', false]]) {
  router.post('/' + action, (req, res) => { try { const snapshot = store.setDisabled(disabled, req.body?.expectedConfigId); return res.json({ success: true, ...apply(snapshot) }); } catch (e) { return error(res, e); } });
}
router.post('/test', async (req, res) => {
  try {
    const input = req.body || {}, mode = input.mode || 'saved', snapshot = store.read();
    store.assertExpected(input.expectedConfigId, snapshot);
    if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(input.requestId)) throw failure('LLM_TEST_REQUEST_ID_REQUIRED');
    if (!['saved', 'draft'].includes(mode)) throw failure('LLM_INVALID_TEST_MODE');
    // Never save/reload when testing a draft. An explicit key cannot silently leak
    // to a previous provider's endpoint; shared profile and credential binding apply.
    const config = mode === 'draft' ? store.draft(input, snapshot) : store.credentials(snapshot);
    if (mode === 'saved' && (input.provider !== config.provider || input.model !== config.model || input.effectiveEndpoint !== config.effectiveEndpoint)) throw failure('LLM_CONFIG_CONFLICT');
    const result = await probeConfig(config);
    store.assertExpected(snapshot.configId, store.read()); // late result never qualifies a newer config
    const { rawEndpoint: _raw, protocol: _protocol, ...publicResult } = result;
    return res.json({ ...publicResult, requestId: input.requestId, mode, testedConfigId: snapshot.configId, testedAt: new Date().toISOString(), ...(mode === 'saved' ? { runtime: runtime().getLlmRuntimeState() } : {}) });
  } catch (e) { return error(res, e); }
});
module.exports = router;
