// SPDX-License-Identifier: MIT
'use strict';
// Shared profiles for actual inference and probes. No implicit unknown-provider fallback.
const PROFILES = Object.freeze({
  deepseek: { endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-reasoner', protocol: 'openai' },
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4-turbo-preview', protocol: 'openai' },
  anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-sonnet-20241022', protocol: 'anthropic' },
  ollama: { endpoint: 'http://localhost:11434', model: 'llama3:8b', protocol: 'ollama' },
  custom: { endpoint: '', model: '', protocol: 'openai' }
});
function failure(code) { return Object.assign(new Error(code), { code }); }
function resolveConfig(config) {
  const profile = Object.hasOwn(PROFILES, config?.provider) ? PROFILES[config.provider] : null;
  if (!profile) throw failure('LLM_UNSUPPORTED_PROVIDER');
  const rawEndpoint = typeof config.endpoint === 'string' ? config.endpoint.trim() : '';
  let endpoint = rawEndpoint || profile.endpoint;
  const model = typeof config.model === 'string' && config.model.trim() ? config.model.trim() : profile.model;
  if (!endpoint || !model) throw failure('LLM_ENDPOINT_MODEL_REQUIRED');
  let url; try { url = new URL(endpoint); } catch (_) { throw failure('LLM_INVALID_ENDPOINT'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw failure('LLM_INVALID_ENDPOINT');
  endpoint = endpoint.replace(/\/+$/, '');
  if (profile.protocol === 'openai' && !/\/chat\/completions$/.test(endpoint)) endpoint += /\/v1$/.test(endpoint) ? '/chat/completions' : '/v1/chat/completions';
  if (profile.protocol === 'anthropic' && !/\/messages$/.test(endpoint)) endpoint += /\/v1$/.test(endpoint) ? '/messages' : '/v1/messages';
  return { provider: config.provider, rawEndpoint, effectiveEndpoint: endpoint, model, protocol: profile.protocol };
}
async function probeConfig(config, transport = require('axios')) {
  const resolved = resolveConfig(config);
  if (resolved.protocol !== 'ollama' && !config.apiKey) throw failure('LLM_API_KEY_REQUIRED');
  const timeout = 20000;
  try {
    if (resolved.protocol === 'ollama') {
      const response = await transport.get(resolved.effectiveEndpoint + '/api/tags', { timeout });
      if (!Array.isArray(response.data?.models)) throw failure('LLM_INVALID_RESPONSE');
      const available = response.data.models.some(m => m.name === resolved.model || m.model === resolved.model);
      return { ...resolved, success: available, verification: available ? 'MODEL_AVAILABLE' : 'ENDPOINT_REACHABLE', code: available ? null : 'LLM_MODEL_NOT_AVAILABLE', inferenceVerified: false };
    }
    const anthropic = resolved.protocol === 'anthropic';
    const response = await transport.post(resolved.effectiveEndpoint, {
      model: resolved.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }]
    }, { timeout, headers: anthropic ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } : { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' } });
    const valid = anthropic ? Array.isArray(response.data?.content) && response.data.content.some(c => c.type === 'text' && typeof c.text === 'string') : Array.isArray(response.data?.choices) && response.data.choices.some(c => typeof c.message?.content === 'string');
    if (!valid) throw failure('LLM_INVALID_RESPONSE');
    return { ...resolved, success: true, verification: 'INFERENCE_VERIFIED', inferenceVerified: true, code: null };
  } catch (e) {
    // Never return upstream body, request headers, key prefixes or URL credentials.
    const status = e.response?.status;
    const code = e.code?.startsWith('LLM_') ? e.code : status === 401 || status === 403 ? 'LLM_AUTH_FAILED' : status === 429 ? 'LLM_RATE_LIMITED' : status ? 'LLM_HTTP_ERROR' : ['ECONNABORTED','ETIMEDOUT'].includes(e.code) ? 'LLM_TIMEOUT' : 'LLM_NETWORK_FAILED';
    return { ...resolved, success: false, verification: 'TEST_FAILED', inferenceVerified: false, code, ...(Number.isInteger(status) ? { httpStatus: status } : {}) };
  }
}
module.exports = { PROFILES, resolveConfig, probeConfig, failure };
