'use strict';

const express = require('express');
const axios = require('axios');
const { createCadLayerRecognitionService } = require('../services/cad-layer-recognition');
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

const router = express.Router();

async function resolveEndpoint (request) {
  const rawPort = request.targetPort;
  const rawProject = request.targetProject;
  if (rawPort === undefined && rawProject === undefined) return getArchicadEndpoint();

  const body = {};
  if (rawPort !== undefined) body.targetPort = rawPort;
  if (rawProject !== undefined) body.targetProject = rawProject;
  const resolved = await resolveTargetInstance(body, {
    post: (url, data, config) => axios.post(url, data, config),
    probeTimeout: 1500
  });
  if (!resolved.ok) {
    const error = new Error(resolved.message);
    error.errorType = resolved.errorType;
    error.httpStatus = 400;
    throw error;
  }
  return endpointForPort(resolved.port);
}

router.post('/recognize', async (req, res) => {
  try {
    const request = req.body || {};
    // Provided layers are a pure offline analysis; reject mixed targeting fields
    // before performing any network discovery.
    const endpoint = request.layers === undefined ? await resolveEndpoint(request) : null;
    const service = createCadLayerRecognitionService({
      getLayers: async () => {
        const payload = await callCommand(endpoint, 'GetLayers', {});
        return { ok: true, layers: payload };
      }
    });
    const result = await service.recognizeLayers(request);
    if (!result.ok) {
      return res.status(result.httpStatus || 400).json({
        ok: false,
        error: result.message,
        errorType: result.errorType,
        detail: result.detail
      });
    }
    return res.json({ ok: true, report: result.report, warnings: result.warnings });
  } catch (error) {
    console.error('[CadLayers][recognize] error:', error.message);
    if (error.errorType) {
      return res.status(error.httpStatus || 400).json({
        ok: false,
        error: error.message,
        errorType: error.errorType
      });
    }
    return res.status(502).json({
      ok: false,
      error: error.message,
      errorType: 'GET_LAYERS_FAILED'
    });
  }
});

module.exports = router;
