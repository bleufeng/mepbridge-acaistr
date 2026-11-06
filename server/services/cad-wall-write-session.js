'use strict';
// Process-local previews + durable fail-closed submission journal. No timer or background model calls.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataPath } = require('./runtime-paths');
const { digest } = require('./cad-snapshot-contract');
const permits = new WeakSet();
const isWritePermit = value => Boolean(value && permits.has(value));
function fail(type, message, status = 409) { throw Object.assign(new Error(message), { errorType: type, httpStatus: status }); }
function durableJson(file, value) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function createWallWriteSession({ directory = dataPath('cad-wall-submissions'), ttlMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const previews = new Map();
  function issue(snapshot) {
    for (const [key, value] of previews) if (value.expiresAt <= now()) previews.delete(key);
    if (previews.size >= 100) fail('PREVIEW_CAPACITY', 'Preview capacity reached; retry after expiry');
    const previewId = crypto.randomUUID(), expiresAt = now() + ttlMs;
    const scope = { ...snapshot.scope, previewId };
    previews.set(previewId, structuredClone({ ...snapshot, scope, expiresAt }));
    return { previewId, expiresAt, scope };
  }
  async function execute(body, verify, callCommand, durableExecution = null) {
    if (body.confirm !== true) fail('CONFIRM_REQUIRED', 'confirm must be literal true', 400);
    if (!Number.isInteger(body.targetPort) || typeof body.expectedProjectKey !== 'string' || !body.expectedProjectKey) fail('WRITE_TARGET_REQUIRED', 'Explicit targetPort and saved project key required');
    if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId)) fail('REQUEST_ID_REQUIRED', 'Supply a stable requestId (8..100 safe characters)', 400);
    if (typeof body.previewId !== 'string' || !Array.isArray(body.candidateIds) || !body.candidateIds.length || body.candidateIds.some(x => typeof x !== 'string') || new Set(body.candidateIds).size !== body.candidateIds.length) fail('PREVIEW_SELECTION_REQUIRED', 'Select unique candidateIds from a server preview', 400);
    for (const key of ['candidates', 'storyIndex', 'height', 'targetLayer', '_mockCallCommand', 'dataset', 'candidateOptions']) {
      if (Object.hasOwn(body, key)) fail('PREVIEW_OVERRIDE_FORBIDDEN', 'Creation parameters cannot override a server preview', 400);
    }
    // Production routes always supply the common workflow. Standalone callback
    // fixtures exercise only the older provenance journal, not production qualification.
    if (durableExecution) {
      let saved;
      try { saved = durableExecution.recover(body); }
      catch (error) { fail(error.message, error.message, error.message.includes('ID_REQUIRED') ? 400 : 409); }
      if (saved) return flatten(saved);
    }
    fs.mkdirSync(directory, { recursive: true });
    const projectScope = digest({ port: body.targetPort, projectKey: body.expectedProjectKey });
    const file = path.join(directory, projectScope + '.json'), lock = file + '.lock';
    let fd;
    try { fd = fs.openSync(lock, 'wx'); } catch (err) {
      if (err.code === 'EEXIST') fail('WRITE_JOURNAL_LOCKED', 'A write is active or interrupted. Reconcile evidence before retrying; locks are never auto-expired');
      throw err;
    }
    try {
      const journal = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { requests: {}, sources: {} };
      const key = digest(body.requestId), requestHash = digest(body);
      const previous = journal.requests[key];
      if (previous) {
        if (previous.requestHash !== requestHash) fail('IDEMPOTENCY_CONFLICT', 'requestId already used with a different request');
        if (previous.result && !durableExecution) return { ...previous.result, replayed: true };
        return { ok: false, httpStatus: 409, status: 'unknown', errorType: 'SUBMISSION_UNRESOLVED', results: previous.results || [], scope: previous.scope, replayed: true };
      }
      const snapshot = previews.get(body.previewId);
      if (!snapshot || snapshot.expiresAt <= now()) fail('PREVIEW_EXPIRED', 'Obtain and inspect a new live preview');
      if (snapshot.scope.targetPort !== body.targetPort || snapshot.scope.projectKey !== body.expectedProjectKey) fail('PREVIEW_TARGET_CHANGED', 'Preview target differs');
      const byId = new Map(snapshot.candidates.map(c => [c.candidateId, c]));
      const selected = body.candidateIds.map(id => { if (!byId.has(id)) fail('INVALID_SELECTION', 'Unknown preview candidate'); return byId.get(id); });
      const creator = require('./cad-wall-creator');
      creator.compileWallCandidates(selected, { dryRun: false }); // all candidates compile BEFORE journal claim or any write
      const sources = [...new Set(selected.flatMap(c => c.sourceGuids || []))].map(guid => digest({ guid, story: snapshot.scope.targetStoryIndex }));
      if (!sources.length) fail('SOURCE_IDENTITY_REQUIRED', 'Candidates lack source provenance');
      if (sources.some(source => journal.sources[source])) fail('SOURCE_ALREADY_SUBMITTED', 'Source geometry already submitted; reconcile previous receipt instead of rebuilding');
      await verify(snapshot);
      if (durableExecution && !snapshot.binding) fail('PREVIEW_SESSION_REQUIRED', 'Use a session-bound live preview');
      let localResult;
      const perform = async (dispatch, saveEvidence = () => {}) => {
        const record = { requestHash, state: 'pending', scope: snapshot.scope, results: [], startedAt: now() };
        journal.requests[key] = record;
        for (const source of sources) journal.sources[source] = key;
        durableJson(file, journal); // Persist PENDING before the first network write. Never automatically replay it.
        saveEvidence('cad-source-reservation', {requestId: body.requestId, scope: snapshot.scope, sources});
        const permit = {};
        permits.add(permit);
        try {
          const result = await creator.createWallsFromCandidates(selected, {
            dryRun: false, confirm: true, endpoint: snapshot.endpoint, writePermit: permit, scope: snapshot.scope,
            beforeWrite: async () => {
              if (snapshot.expiresAt <= now()) fail('PREVIEW_EXPIRED', 'Preview expired during submission; inspect partial receipt');
              await verify(snapshot);
              if (snapshot.expiresAt <= now()) fail('PREVIEW_EXPIRED', 'Preview expired during verification; inspect partial receipt');
            },
            onProgress: results => { record.results = structuredClone(results); durableJson(file, journal); saveEvidence('cad-progress', {results: record.results}); }
          }, dispatch);
          record.result = result;
          record.state = result.status;
          record.results = result.results;
          try { durableJson(file, journal); }
          catch (err) { return { ...result, ok: false, httpStatus: 409, status: 'unknown', persistenceError: err.message }; }
          return result;
        } finally { permits.delete(permit); }
        };
      if (!durableExecution) return await perform(callCommand);
      const createdIds = new Set();
      const output = await durableExecution.run({request: body, endpoint: snapshot.endpoint, binding: snapshot.binding}, async ({command, saveEvidence}) => {
        localResult = await perform(async (endpoint, name, params) => {
          const response = require('./cad-wall-execution').verifyCreation(await command(endpoint, name, params, {phase: 'create'}), params);
          const guid = response.wallGuid.replace(/[{}]/g, '').toLowerCase();
          if (createdIds.has(guid)) throw Object.assign(Error('CAD_DUPLICATE_CREATED_GUID'), {payload: response});
          createdIds.add(guid);
          return response;
        }, saveEvidence);
        return {ok: localResult.ok, result: localResult};
      });
      return flatten(output, localResult);
    } finally {
      // Cleanup errors must not discard the receipt. A retained lock safely blocks subsequent writes.
      try { fs.closeSync(fd); } catch (err) { console.error('[CAD write journal] lock close failed:', err.message); }
      try { fs.unlinkSync(lock); } catch (err) { console.error('[CAD write journal] lock retained; reconcile before retry:', err.message); }
    }
  }
  function flatten(output, localResult) {
    const {result, ...envelope} = output;
    // The common result is authoritative even if the local journal says completed.
    return {...(result || localResult || {}), ...envelope,
      ...(!output.ok ? {status: 'unknown', httpStatus: output.httpStatus || 409} : {})};
  }
  return { issue, execute };
}
let defaultSession;
module.exports = { createWallWriteSession, isWritePermit, getDefaultSession: () => defaultSession ||= createWallWriteSession() };
