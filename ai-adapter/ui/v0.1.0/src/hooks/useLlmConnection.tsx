// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from 'react';
import { workbenchFetch as fetch } from '../execution-recovery';
import type { LlmConfig } from '../types';
export type LlmBinding = { configured: boolean; configId: string; revision: number; provider: string | null; rawEndpoint: string; effectiveEndpoint: string; model: string; keyPresent: boolean; disabled: boolean; supported: boolean; runtime: { configId: string | null; status: string; provider?: string; model?: string; effectiveEndpoint?: string }; code?: string; profiles: Record<string, { endpoint: string; model: string }> };
export type LlmStatus = 'unknown' | 'loading' | 'unconfigured' | 'testing' | 'connected' | 'model-available' | 'disconnected' | 'disabled' | 'unsupported' | 'load-failed';
const empty = (provider = 'deepseek'): LlmConfig => ({ provider, endpoint: '', apiKey: '', modelName: '' });
function validate(value: any): LlmBinding {
  if (value?.success !== true || typeof value.configId !== 'string' || !Number.isSafeInteger(value.revision) || typeof value.configured !== 'boolean' || typeof value.disabled !== 'boolean' || typeof value.keyPresent !== 'boolean' || !value.runtime || typeof value.runtime.status !== 'string' || !value.profiles) throw Error(value?.code || 'LLM_INVALID_RESPONSE');
  if (value.revision < 0 || typeof value.rawEndpoint !== 'string' || typeof value.effectiveEndpoint !== 'string' || typeof value.model !== 'string' || typeof value.supported !== 'boolean' || (value.configured && typeof value.provider !== 'string')) throw Error('LLM_INVALID_RESPONSE');
  return value;
}
async function request(url: string, body?: any) {
  const res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const value = await res.json();
  if (!res.ok) throw Error(value?.code || 'LLM_REQUEST_FAILED');
  return value;
}
function baseStatus(v: LlmBinding): LlmStatus {
  return !v.configured ? 'unconfigured' : !v.supported ? 'unsupported' : v.disabled ? 'disabled' : v.runtime.configId !== v.configId || v.runtime.status !== 'APPLIED' ? 'load-failed' : 'unknown';
}
export function useLlmConnection() {
  const [active, setActive] = useState<LlmBinding | null>(null);
  const [draft, setDraftState] = useState<LlmConfig>(empty);
  const [status, setStatus] = useState<LlmStatus>('loading');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ success: boolean; text: string } | null>(null);
  const [busyState, setBusyState] = useState(false);
  const activeRef = useRef<LlmBinding | null>(null), generation = useRef(0), mounted = useRef(true), busy = useRef(false), ready = useRef(false);
  const valid = (epoch: number) => mounted.current && generation.current === epoch;
  const accept = (v: LlmBinding) => { activeRef.current = v; setActive(v); setStatus(baseStatus(v)); };
  const initDraft = (v: LlmBinding, provider?: string) => setDraftState(provider && provider !== v.provider ? { ...empty(provider), modelName: v.profiles[provider]?.model || '' } : { provider: v.provider || provider || 'deepseek', endpoint: v.rawEndpoint, apiKey: '', modelName: v.model || v.profiles[v.provider || 'deepseek']?.model || '' });
  const load = async (provider?: string) => {
    if (busy.current) return false;
    ready.current = false; busy.current = true; setBusyState(true); const epoch = ++generation.current; setFeedback(null); setError(''); setStatus('loading');
    try { const v = validate(await request('/api/llm-config/load')); if (valid(epoch)) { accept(v); initDraft(v, provider); ready.current = true; } return valid(epoch); }
    catch (e: any) { if (valid(epoch)) { setStatus('load-failed'); setError(e.message); } return false; }
    finally { if (valid(epoch)) { busy.current = false; setBusyState(false); } }
  };
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; generation.current++; busy.current = false; }; }, []);
  const setDraft = (value: LlmConfig) => { if (busy.current) return; generation.current++; setDraftState(value); setFeedback(null); };
  const chooseDraftProvider = (provider: string) => { if (busy.current) return; setDraft({ ...empty(provider), modelName: activeRef.current?.profiles[provider]?.model || '' }); };
  const payload = (v: LlmBinding) => ({ provider: draft.provider, endpoint: draft.endpoint.trim() || null, model: draft.modelName.trim() || null, apiKey: draft.apiKey.trim() || undefined, expectedConfigId: v.configId, reuseSavedKey: v.keyPresent && draft.provider === v.provider && draft.endpoint.trim() === v.rawEndpoint.trim() });
  const draftIdentity = (v: LlmBinding) => {
    let endpoint = draft.endpoint.trim() || v.profiles[draft.provider]?.endpoint || '';
    endpoint = endpoint.replace(/\/+$/, '');
    if (draft.provider === 'anthropic' && !/\/messages$/.test(endpoint)) endpoint += /\/v1$/.test(endpoint) ? '/messages' : '/v1/messages';
    if (['openai','deepseek','custom'].includes(draft.provider) && !/\/chat\/completions$/.test(endpoint)) endpoint += /\/v1$/.test(endpoint) ? '/chat/completions' : '/v1/chat/completions';
    return { model: draft.modelName.trim() || v.profiles[draft.provider]?.model || '', effectiveEndpoint: endpoint };
  };
  const test = async (mode: 'saved' | 'draft') => {
    const v = activeRef.current; if (!v || busy.current || !ready.current) return;
    busy.current = true; setBusyState(true); const epoch = ++generation.current; setError(''); setFeedback(null); if (mode === 'saved') setStatus('testing');
    try {
      const requestId = `probe-${Date.now()}-${epoch}`;
      const input = mode === 'draft' ? { ...payload(v), mode, requestId } : { mode, requestId, expectedConfigId: v.configId, provider: v.provider, effectiveEndpoint: v.effectiveEndpoint, model: v.model };
      const result = await request('/api/llm-config/test', input);
      if (!valid(epoch)) return;
      if (result.requestId !== requestId || result.mode !== mode || result.testedConfigId !== v.configId || result.provider !== input.provider || typeof result.success !== 'boolean' || !['INFERENCE_VERIFIED','MODEL_AVAILABLE','ENDPOINT_REACHABLE','TEST_FAILED'].includes(result.verification) || !Number.isFinite(Date.parse(result.testedAt))) throw Error('LLM_INVALID_TEST_IDENTITY');
      const expected = mode === 'draft' ? draftIdentity(v) : v;
      if (result.model !== expected.model || result.effectiveEndpoint !== expected.effectiveEndpoint) throw Error('LLM_INVALID_TEST_IDENTITY');
      if (mode === 'saved' && (result.model !== v.model || result.effectiveEndpoint !== v.effectiveEndpoint || result.runtime?.configId !== v.configId || result.runtime?.status !== 'APPLIED')) throw Error('LLM_INVALID_TEST_IDENTITY');
      if (result.success && (result.verification !== 'INFERENCE_VERIFIED' && result.verification !== 'MODEL_AVAILABLE')) throw Error('LLM_INVALID_TEST_IDENTITY');
      if (result.inferenceVerified !== (result.verification === 'INFERENCE_VERIFIED')) throw Error('LLM_INVALID_TEST_IDENTITY');
      if (mode === 'saved') setStatus(result.success ? result.inferenceVerified ? 'connected' : 'model-available' : 'disconnected');
      setFeedback({ success: result.success, text: `${mode === 'draft' ? 'DRAFT (not applied)' : 'ACTIVE'} · ${result.provider} · ${result.model} · ${result.verification}${result.code ? ' · ' + result.code : ''}` });
    } catch (e: any) { if (valid(epoch)) { if (mode === 'saved') setStatus('disconnected'); setError(e.message); setFeedback({ success: false, text: e.message }); } }
    finally { if (valid(epoch)) { busy.current = false; setBusyState(false); } }
  };
  const apply = async (action: 'save' | 'disconnect' | 'connect') => {
    const v = activeRef.current; if (!v || busy.current || !ready.current) return false;
    busy.current = true; setBusyState(true); const epoch = ++generation.current; setError(''); setFeedback(null); setStatus('loading');
    try {
      const next = validate(await request('/api/llm-config/' + action, action === 'save' ? payload(v) : { expectedConfigId: v.configId }));
      if (next.configId === v.configId || next.revision <= v.revision || (action === 'save' && (next.provider !== draft.provider || next.model !== draftIdentity(v).model || next.effectiveEndpoint !== draftIdentity(v).effectiveEndpoint))) throw Error('LLM_INVALID_APPLY_IDENTITY');
      if (next.runtime.configId !== next.configId || (next.disabled ? next.runtime.status !== 'DISABLED' : next.runtime.status !== 'APPLIED')) throw Error('LLM_RUNTIME_APPLY_FAILED');
      if (valid(epoch)) { accept(next); initDraft(next); ready.current = true; } return valid(epoch);
    } catch (e: any) {
      if (valid(epoch)) {
        // No write retry after a conflict or uncertain commit. Read current authority once.
        try { const latest = validate(await request('/api/llm-config/load')); if (valid(epoch)) { accept(latest); ready.current = true; } } catch (_) { if (valid(epoch)) { setStatus('load-failed'); ready.current = false; } }
        if (valid(epoch)) { setError(e.message); setFeedback({ success: false, text: e.message }); }
      }
      return false;
    } finally { if (valid(epoch)) { busy.current = false; setBusyState(false); } }
  };
  return { active, draft, ready: ready.current, setDraft, chooseDraftProvider, status, error, feedback, busy: busyState, load, testSaved: () => test('saved'), testDraft: () => test('draft'), save: () => apply('save'), disconnect: () => apply('disconnect'), connect: () => apply('connect') };
}
