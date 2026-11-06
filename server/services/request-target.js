// SPDX-License-Identifier: MIT
'use strict';

const axios = require('axios');
const { endpointForPort } = require('./archicad-endpoint');
const { describeInstance } = require('./archicad-instances');
const { resolveTargetInstance, computeTargetFingerprint, computeProjectPathHash } = require('./instance-targeting');

function targetFailure(result) {
  const unreachable = ['TARGET_PORT_NOT_LIVE', 'NO_ARCHICAD_INSTANCES'].includes(result.errorType);
  const conflict = ['TARGET_CONFLICT', 'TARGET_PROJECT_CHANGED', 'TARGET_FINGERPRINT_MISMATCH', 'TARGET_VERSION_MISMATCH'].includes(result.errorType);
  return Object.assign(new Error(result.message || result.errorType || 'TARGET_RESOLUTION_FAILED'), {
    code: result.errorType || 'TARGET_RESOLUTION_FAILED',
    statusCode: unreachable ? 503 : (conflict ? 409 : 400),
    detail: result.detail
  });
}

// Resolve once at request admission and return an immutable identity snapshot.
// Planning context and every later execution step consume this same target.
async function freezeRequestTarget(body, { post = (...args) => axios.post(...args), requireExplicit = true } = {}) {
  const resolved = await resolveTargetInstance(body || {}, { post, probeTimeout: 1500, describeTimeout: 2500 });
  if (!resolved.requested) {
    if (requireExplicit) throw Object.assign(new Error('TARGET_PORT_REQUIRED'), { code: 'TARGET_PORT_REQUIRED', statusCode: 400 });
    return null;
  }
  if (!resolved.ok) throw targetFailure(resolved);
  const instance = resolved.instance?.mepbridge === undefined
    ? await describeInstance(resolved.instance || { port: resolved.port, productInfo: null }, { post, timeout: 2500 })
    : resolved.instance;
  if (instance.mepbridge !== true) throw Object.assign(new Error('TARGET_MEPBRIDGE_NOT_AVAILABLE'), {
    code: 'TARGET_MEPBRIDGE_NOT_AVAILABLE', statusCode: 409, detail: { port: resolved.port }
  });
  const target = {
    port: resolved.port,
    mode: resolved.mode,
    endpoint: endpointForPort(resolved.port),
    archicadVersion: instance.archicadVersion ?? instance.productInfo?.version ?? null,
    addOnVersion: instance.addOnVersion || null,
    projectName: instance.projectName || null,
    projectPath: instance.projectPath || null,
    untitled: instance.untitled === true,
    teamwork: instance.teamwork === true,
    projectPathHash: (instance.projectPath || instance.projectName)
      ? computeProjectPathHash(instance.projectPath || instance.projectName) : null,
    fingerprint: computeTargetFingerprint({
      port: resolved.port,
      projectName: instance.projectName,
      projectPath: instance.projectPath
    })
  };
  return Object.freeze(target);
}

function executionTarget(target) {
  if (!target) return {};
  return {
    targetPort: target.port,
    ...(target.projectPath ? { targetProject: target.projectPath } : {}),
    ...(target.projectPathHash ? { expectedProjectPathHash: target.projectPathHash } : {}),
    ...(target.fingerprint ? { targetFingerprint: target.fingerprint } : {}),
    ...(target.archicadVersion != null ? { expectedArchicadVersion: target.archicadVersion } : {})
  };
}

function publicTarget(target) {
  if (!target) return null;
  return {
    port: target.port,
    archicadVersion: target.archicadVersion,
    projectName: target.projectName,
    projectPath: target.projectPath,
    fingerprint: target.fingerprint
  };
}

module.exports = { freezeRequestTarget, executionTarget, publicTarget, targetFailure };