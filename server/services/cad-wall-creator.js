'use strict';
const crypto = require('crypto');
function invalid(message, errorType = 'INVALID_CANDIDATE_DATA') {
  return { ok: false, httpStatus: 400, errorType, message };
}
function buildCreateWallParameters(candidate, options = {}) {
  if (!candidate || typeof candidate.candidateId !== 'string' || !candidate.candidateId.trim()) throw new Error('candidateId is required');
  const cl = candidate.centerLine || {};
  const thickness = candidate.parameters?.thickness?.value ?? candidate.thickness ?? 0.20;
  const height = options.defaultHeight ?? candidate.parameters?.height?.value ?? 2.8;
  const floorIndex = options.storyIndex ?? candidate.parameters?.floorIndex?.value;
  const refLinePosition = candidate.parameters?.refLinePosition?.value ?? 'center';
  const refLineOffset = candidate.parameters?.refLineOffset?.value ?? 0;
  const targetLayer = options.targetLayer ?? candidate.parameters?.targetLayer?.value;
  if (targetLayer !== undefined && targetLayer !== null && targetLayer !== '') throw new Error('TARGET_LAYER_UNSUPPORTED: CreateWall does not accept a target layer');
  if (![cl.begX, cl.begY, cl.endX, cl.endY, thickness, height, refLineOffset].every(Number.isFinite)) throw new Error('Coordinates, thickness, height and offset must be finite numbers');
  if (thickness < 0.01 || thickness > 2 || height <= 0 || height > 1000) throw new Error('Invalid wall thickness or height');
  if (!Number.isInteger(floorIndex) || floorIndex < -32768 || floorIndex > 32767) throw new Error('An explicit valid floorIndex is required');
  if (!['center', 'inside', 'outside'].includes(refLinePosition)) throw new Error('Invalid refLinePosition');
  if (refLinePosition === 'center' && refLineOffset !== 0) throw new Error('Center reference ignores offset in native API; select inside/outside for a nonzero offset');
  const round = n => Number(n.toFixed(4));
  const params = { start: { x: round(cl.begX), y: round(cl.begY) }, end: { x: round(cl.endX), y: round(cl.endY) },
    thickness: round(thickness), height: round(height), floorIndex, refLinePosition, refLineOffset: round(refLineOffset),
    dryRun: options.dryRun !== false, confirmRequired: options.dryRun === false };
  if (Math.hypot(params.end.x - params.start.x, params.end.y - params.start.y) < 0.05 || params.height <= 0) throw new Error('Degenerate wall after rounding');
  return params;
}
function validateWallCandidate(candidate, options = {}) {
  try { buildCreateWallParameters(candidate, options); return { valid: true }; }
  catch (error) { return { valid: false, error: error.message }; }
}
function compileWallCandidates(candidates, options = {}) {
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 1000) throw new Error('Expected 1..1000 wall candidates');
  const ids = new Set(), geometries = new Set();
  return candidates.map(c => {
    const parameters = buildCreateWallParameters(c, options);
    if (ids.has(c.candidateId)) throw new Error('Duplicate candidateId');
    ids.add(c.candidateId);
    const points = [JSON.stringify(parameters.start), JSON.stringify(parameters.end)].sort();
    const key = `${parameters.floorIndex}:${points.join('|')}`;
    if (geometries.has(key)) throw new Error('DUPLICATE_CANDIDATE_DETECTED');
    geometries.add(key);
    return { candidateId: c.candidateId, parameters };
  });
}
async function createWallsFromCandidates(candidates, options = {}, callCommand = null) {
  if (!Array.isArray(candidates) || !candidates.length) return invalid('候选列表不能为空', 'EMPTY_CANDIDATE_LIST');
  const dryRun = options.dryRun !== false;
  if (!dryRun && options.confirm !== true) return invalid('真实写入必须显式传入 confirm: true', 'CONFIRM_REQUIRED');
  let compiled;
  try { compiled = compileWallCandidates(candidates, options); }
  catch (err) { return invalid(err.message, err.message.includes('DUPLICATE_CANDIDATE_DETECTED') ? 'DUPLICATE_CANDIDATE_DETECTED' : 'INVALID_CANDIDATE_DATA'); }
  // Only the coordinator can issue this in-process capability; never accept a body flag as authorization.
  if (!dryRun && !require('./cad-wall-write-session').isWritePermit(options.writePermit)) return invalid('Server preview/write session required', 'WRITE_SESSION_REQUIRED');
  const results = [], createdGuids = [];
  let stopped = false;
  for (const item of compiled) {
    if (stopped) { results.push({ ...item, status: 'not_attempted' }); continue; }
    if (dryRun) { results.push({ ...item, status: 'simulated', guid: `SIMULATED_WALL_${item.candidateId}` }); continue; }
    let sent = false;
    try {
      await options.beforeWrite();
      sent = true;
      const nativeResponse = await callCommand(options.endpoint, 'CreateWall', item.parameters);
      const guid = nativeResponse?.wallGuid;
      if (nativeResponse?.status !== 'ok' || nativeResponse.mode !== 'created' || !guid || nativeResponse.geometryVerified !== true || !nativeResponse.readback) {
        throw Object.assign(new Error('CreateWall response lacks verified creation evidence'), { payload: nativeResponse });
      }
      createdGuids.push(guid);
      results.push({ ...item, status: 'created', guid, nativeResponse });
    } catch (err) {
      stopped = true;
      // A transport error or unverified cleanup is UNKNOWN, never safe to replay automatically.
      results.push({ ...item, status: sent ? 'unknown' : 'failed', error: err.message, nativeResponse: err.payload || null, submissionStarted: sent });
    }
    try { await options.onProgress(results); }
    catch (err) {
      stopped = true;
      results[results.length - 1].persistenceError = err.message;
    }
  }
  const succeededCount = results.filter(r => r.status === 'created' || r.status === 'simulated').length;
  const failedCount = results.filter(r => r.status === 'failed' || r.status === 'unknown').length;
  const unknown = results.some(r => r.status === 'unknown' || r.persistenceError);
  return {
    ok: failedCount === 0 && !unknown,
    ...(failedCount || unknown ? { httpStatus: 409 } : {}),
    status: dryRun ? 'dry_run_success' : unknown ? 'unknown' : failedCount ? (createdGuids.length ? 'partial_failure' : 'failed') : 'completed',
    receipt: { receiptId: crypto.randomUUID(), createdAt: new Date().toISOString(), dryRun, totalCandidates: candidates.length,
      succeededCount, failedCount, createdGuids, scope: options.scope || null },
    limitations: ['Openings are not reconstructed', 'Target layer uses native defaults; no target-layer assignment'],
    results
  };
}
module.exports = { validateWallCandidate, buildCreateWallParameters, compileWallCandidates, createWallsFromCandidates };
