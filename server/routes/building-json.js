'use strict';

const express = require('express');
const axios = require('axios');
const { createSnapshotReplayService } = require('../services/snapshot-replay');
const { createBuildingJsonExportService } = require('../services/building-json-export');
const { endpointForPort, getArchicadEndpoint } = require('../services/archicad-endpoint');
const { resolveTargetInstance } = require('../services/instance-targeting');

async function callCommand (endpoint, commandName, params) {
  const response = await axios.post(endpoint, {
    command: 'API.ExecuteAddOnCommand',
    parameters: {
      addOnCommandId: { commandNamespace: 'MEPBridge', commandName },
      addOnCommandParameters: params || {}
    }
  }, { timeout: 60000, proxy: false, headers: { 'Content-Type': 'application/json' } });

  const outer = response.data;
  const payload = outer && outer.result ? (outer.result.addOnCommandResponse || outer.result) : outer;
  if (!outer || outer.succeeded === false || payload.status === 'error' || payload.success === false) {
    const message = (payload && payload.error && payload.error.message)
      || (outer && outer.error && outer.error.message)
      || `MEPBridge ${commandName} failed`;
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function resolveSourceInstance (spec, deps = {}) {
  if (!spec || (spec.port === undefined && spec.project === undefined)) {
    return { ok: true, port: null };
  }

  const body = {};
  if (spec.port !== undefined) body.targetPort = spec.port;
  if (spec.project !== undefined) body.targetProject = spec.project;

  const resolveTarget = deps.resolveTargetInstance || resolveTargetInstance;
  const resolved = await resolveTarget(body, {
    post: deps.post || ((url, data, config) => axios.post(url, data, config)),
    probeTimeout: deps.probeTimeout || 1500
  });
  if (!resolved.ok) {
    return {
      ok: false,
      errorType: resolved.errorType,
      message: resolved.message,
      detail: resolved.detail
    };
  }
  return { ok: true, port: resolved.port, endpoint: endpointForPort(resolved.port) };
}

function createBuildingJsonRouter (options = {}) {
  const snapshotService = createSnapshotReplayService({
    callCommand,
    resolveInstance: options.resolveInstance || resolveSourceInstance,
    getEndpoint: () => getArchicadEndpoint()
  });
  const service = createBuildingJsonExportService({
    captureSnapshot: snapshotService.captureSnapshot
  });

  const router = express.Router();

  router.post('/export', async (req, res) => {
    try {
      const result = await service.exportFromSnapshot(req.body || {});
      if (!result.ok) {
        return res.status(result.httpStatus || 400).json({
          ok: false,
          error: result.message,
          errorType: result.errorType,
          detail: result.detail
        });
      }
      return res.json({
        ok: true,
        buildingJson: result.buildingJson,
        warnings: result.warnings
      });
    } catch (error) {
      console.error('[BuildingJson][export] error:', error.message);
      return res.status(500).json({ ok: false, error: error.message, errorType: 'INTERNAL_ERROR' });
    }
  });

  return router;
}

const router = createBuildingJsonRouter();

module.exports = router;
module.exports.createBuildingJsonRouter = createBuildingJsonRouter;
module.exports.resolveSourceInstance = resolveSourceInstance;
