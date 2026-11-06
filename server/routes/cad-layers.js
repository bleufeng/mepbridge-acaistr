'use strict';

const express = require('express');
const axios = require('axios');
const { createCadLayerRecognitionService } = require('../services/cad-layer-recognition');
const { endpointForPort, getArchicadEndpoint } = require('../services/archicad-endpoint');
const { resolveTargetInstance } = require('../services/instance-targeting');
const { deriveProjectIdentity } = require('../services/cad-project-identity');
const { defaultStore: defaultMappingStore } = require('../services/cad-layer-mapping-store');
const { mergeLayersWithMapping } = require('../services/cad-layer-mapping-merge');
const { validateDraftingDataset } = require('../services/dwg-intermediate-contract');
const { createCadGeometryReaderService } = require('../services/cad-geometry-reader');

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
  if (!outer || !payload || outer.succeeded === false || payload.status === 'error' || payload.success === false) {
    const message = (payload && payload.error && payload.error.message)
      || (outer && outer.error && outer.error.message)
      || `MEPBridge ${commandName} failed`;
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
  return payload;
}

const { digest, datasetDigest } = require('../services/cad-snapshot-contract');
const { getDefaultSession } = require('../services/cad-wall-write-session');
const router = express.Router();
function wallSession() { return router._wallSession || getDefaultSession(); }
function cadExecution() { return router._cadExecution || require('../services/cad-wall-execution').getCadWallExecution(); }
async function verifyWallBinding(snapshot) {
  if (snapshot.binding && JSON.stringify(snapshot.binding) !== JSON.stringify(await cadExecution().bindPreview(snapshot.endpoint))) {
    rejectWrite('PREVIEW_SESSION_CHANGED', 'Native project session changed; obtain a new preview');
  }
}
function rejectWrite(type, message) { throw Object.assign(new Error(message), { errorType: type, httpStatus: 409 }); }
async function verifyWallSnapshot(snapshot) {
  await verifyWallBinding(snapshot);
  const store = router._store || defaultMappingStore;
  const identity = await resolveProjectIdentityFromReq({}, snapshot.endpoint);
  if (!identity.isIdentifiable || identity.projectKey !== snapshot.scope.projectKey) rejectWrite('PREVIEW_TARGET_CHANGED', 'Target project changed');
  if (digest(store.getConfirmedMapping(identity.projectKey)) !== snapshot.mappingDigest) rejectWrite('PREVIEW_MAPPING_CHANGED', 'Confirmed mapping changed');
  const layers = await callCommand(snapshot.endpoint, 'GetLayers', {});
  if (digest(layers.layers) !== snapshot.layerDigest) rejectWrite('PREVIEW_LAYERS_CHANGED', 'Layer inventory changed');
  const reader = createCadGeometryReaderService({ callCommand, mappingStore: store });
  const read = await reader.readDraftingElements(snapshot.endpoint, snapshot.readParams);
  if (!read.ok || !read.completeness.complete || datasetDigest(read.dataset) !== snapshot.scope.datasetDigest) rejectWrite('PREVIEW_SOURCE_CHANGED', 'Complete drafting source changed');
  const after = await resolveProjectIdentityFromReq({}, snapshot.endpoint);
  if (after.projectKey !== identity.projectKey || digest(store.getConfirmedMapping(identity.projectKey)) !== snapshot.mappingDigest ||
      digest((await callCommand(snapshot.endpoint, 'GetLayers', {})).layers) !== snapshot.layerDigest) rejectWrite('PREVIEW_SCOPE_CHANGED', 'Target scope changed during verification');
  await verifyWallBinding(snapshot);
}

async function resolveEndpoint (request) {
  const resolved = await resolveTargetInstance(request, {
    post: (url, data, config) => axios.post(url, data, config),
    probeTimeout: 1500
  });
  if (!resolved.requested) return getArchicadEndpoint();
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

async function resolveProjectIdentityFromReq (req, endpoint) {
  try {
    const payload = await callCommand(endpoint, 'GetProjectInfo', {});
    const projectInfo = payload?.projectInfo || payload;
    return deriveProjectIdentity(projectInfo);
  } catch (err) {
    const error = new Error(`无法获取目标工程信息: ${err.message}`);
    error.errorType = 'GET_PROJECT_INFO_FAILED';
    error.httpStatus = 502;
    throw error;
  }
}

// Writes must be tied to the snapshot the caller actually inspected. Revisions
// alone do not distinguish two different projects both at revision zero.
function assertSnapshotTarget(body, identity, endpoint) {
  const port = Number(new URL(endpoint).port);
  if (Number(body.targetPort) !== port || !Object.hasOwn(body, 'expectedProjectKey')) {
    throw Object.assign(new Error('Resolve the target project before saving'), { errorType: 'MAPPING_TARGET_REQUIRED', httpStatus: 409 });
  }
  if (body.expectedProjectKey !== identity.projectKey) {
    throw Object.assign(new Error('Target project changed; resolve again'), { errorType: 'MAPPING_TARGET_CHANGED', httpStatus: 409 });
  }
}
function sessionForEndpoint(sessionKey, endpoint) {
  // Untitled has no durable project identity in the current native response.
  // Its draft belongs to the caller session + instance, NEVER to a project.
  return typeof sessionKey === 'string' && sessionKey.trim() ? `${new URL(endpoint).port}:${sessionKey}` : sessionKey;
}

// GET /api/cad-layers/mapping
router.get('/mapping', async (req, res) => {
  try {
    const endpoint = await resolveEndpoint(req.query || {});
    const identity = await resolveProjectIdentityFromReq(req, endpoint);
    const store = router._store || defaultMappingStore;
    const mapping = store.getConfirmedMapping(identity.projectKey);
    const draft = store.getDraftMapping(identity.projectKey, sessionForEndpoint(req.query?.sessionKey, endpoint));
    return res.json({ ok: true, identity, targetPort: Number(new URL(endpoint).port), mapping, draft });
  } catch (error) {
    return res.status(error.httpStatus || 400).json({
      ok: false,
      error: error.message,
      errorType: error.errorType || 'GET_MAPPING_FAILED',
      detail: error.detail
    });
  }
});

// POST /api/cad-layers/mapping/resolve
router.post('/mapping/resolve', async (req, res) => {
  try {
    const body = req.body || {};
    const endpoint = body.layers === undefined ? await resolveEndpoint(body) : null;
    let identity = null;
    if (endpoint) {
      identity = await resolveProjectIdentityFromReq(req, endpoint);
    } else if (body.projectInfo) {
      identity = deriveProjectIdentity(body.projectInfo);
    } else {
      identity = deriveProjectIdentity(null);
    }

    const store = router._store || defaultMappingStore;
    const confirmedMapping = store.getConfirmedMapping(identity?.projectKey);
    const draftMapping = identity?.projectKey || body.sessionKey !== undefined
      ? store.getDraftMapping(identity?.projectKey, endpoint ? sessionForEndpoint(body.sessionKey, endpoint) : body.sessionKey) : null;

    const service = createCadLayerRecognitionService({
      getLayers: async () => {
        if (!endpoint) return { ok: false, message: 'no endpoint' };
        const payload = await callCommand(endpoint, 'GetLayers', {});
        return { ok: true, layers: payload };
      }
    });
    const recognitionResult = await service.recognizeLayers(body);
    if (!recognitionResult.ok) {
      return res.status(recognitionResult.httpStatus || 400).json(recognitionResult);
    }

    if (endpoint) {
      const after = await resolveProjectIdentityFromReq(req, endpoint);
      if (after.projectKey !== identity.projectKey || after.projectName !== identity.projectName) {
        throw Object.assign(new Error('Project changed during resolve'), { errorType: 'MAPPING_TARGET_CHANGED', httpStatus: 409 });
      }
    }

    const mergedView = mergeLayersWithMapping({
      recognizedLayers: recognitionResult.report?.layers || [],
      confirmedMapping,
      draftMapping
    });

    return res.json({
      ok: true,
      identity,
      targetPort: endpoint ? Number(new URL(endpoint).port) : null,
      warnings: recognitionResult.warnings || [],
      view: mergedView,
      mapping: confirmedMapping,
      draft: draftMapping
    });
  } catch (error) {
    return res.status(error.httpStatus || 400).json({
      ok: false,
      error: error.message,
      errorType: error.errorType || 'RESOLVE_MAPPING_FAILED',
      detail: error.detail
    });
  }
});

// PUT /api/cad-layers/mapping
router.put('/mapping', async (req, res) => {
  try {
    const body = req.body || {};
    const endpoint = await resolveEndpoint(body);
    const identity = await resolveProjectIdentityFromReq(req, endpoint);
    assertSnapshotTarget(body, identity, endpoint);
    const store = router._store || defaultMappingStore;
    const result = store.saveConfirmedMapping({
      projectKey: identity.projectKey,
      identity,
      entries: body.entries || [],
      expectedMappingRevision: body.expectedMappingRevision,
      expectedDraftRevision: body.expectedDraftRevision
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.httpStatus || 400).json({
      ok: false,
      error: error.message,
      errorType: error.errorType || 'SAVE_MAPPING_FAILED',
      detail: error.detail
    });
  }
});

// PUT /api/cad-layers/mapping/draft
router.put('/mapping/draft', async (req, res) => {
  try {
    const body = req.body || {};
    const endpoint = await resolveEndpoint(body);
    const identity = await resolveProjectIdentityFromReq(req, endpoint);
    assertSnapshotTarget(body, identity, endpoint);
    const store = router._store || defaultMappingStore;
    const result = store.saveDraftMapping({
      projectKey: identity.projectKey,
      identity,
      entries: body.entries || [],
      expectedDraftRevision: body.expectedDraftRevision,
      basedOnMappingRevision: body.basedOnMappingRevision,
      sessionKey: sessionForEndpoint(body.sessionKey, endpoint)
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.httpStatus || 400).json({
      ok: false,
      error: error.message,
      errorType: error.errorType || 'SAVE_DRAFT_FAILED',
      detail: error.detail
    });
  }
});

// DELETE /api/cad-layers/mapping
router.delete('/mapping', async (req, res) => {
  try {
    const body = req.body || {};
    const endpoint = await resolveEndpoint(body);
    const identity = await resolveProjectIdentityFromReq(req, endpoint);
    assertSnapshotTarget(body, identity, endpoint);
    const store = router._store || defaultMappingStore;
    const result = store.deleteConfirmedMapping({
      projectKey: identity.projectKey,
      expectedMappingRevision: body.expectedMappingRevision,
      confirm: body.confirm
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.httpStatus || 400).json({
      ok: false,
      error: error.message,
      errorType: error.errorType || 'DELETE_MAPPING_FAILED',
      detail: error.detail
    });
  }
});

// POST /api/cad-layers/mapping/reset-draft
router.post('/mapping/reset-draft', async (req, res) => {
  try {
    const body = req.body || {};
    const endpoint = await resolveEndpoint(body);
    const identity = await resolveProjectIdentityFromReq(req, endpoint);
    assertSnapshotTarget(body, identity, endpoint);
    const store = router._store || defaultMappingStore;
    const result = store.resetDraft({
      projectKey: identity.projectKey,
      expectedDraftRevision: body.expectedDraftRevision,
      sessionKey: sessionForEndpoint(body.sessionKey, endpoint)
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.httpStatus || 400).json({
      ok: false,
      error: error.message,
      errorType: error.errorType || 'RESET_DRAFT_FAILED',
      detail: error.detail
    });
  }
});

// POST /api/cad-layers/drafting-elements (C-CAD-01/02 S2 drafting geometry reading)
router.post('/drafting-elements', async (req, res) => {
  try {
    const body = req.body || {};
    const store = router._store || defaultMappingStore;
    const geometryService = createCadGeometryReaderService({ callCommand, mappingStore: store });

    // Pure offline mode: if body contains a dataset directly, validate and return
    if (body.dataset) {
      const validCheck = validateDraftingDataset(body.dataset);
      if (!validCheck.valid) {
        return res.status(400).json({
          ok: false,
          error: validCheck.error,
          errorType: 'INVALID_DRAFTING_DATASET'
        });
      }
      return res.json({ ok: true, data: validCheck.payload, completeness: require('../services/cad-snapshot-contract').completeness(validCheck.payload, body) });
    }

    const endpoint = await resolveEndpoint(body);
    const result = await geometryService.readDraftingElements(endpoint, body);
    if (!result.ok) {
      return res.status(result.httpStatus || 400).json({
        ok: false,
        error: result.message,
        errorType: result.errorType
      });
    }
    return res.json({ ok: true, data: result.dataset, completeness: result.completeness });
  } catch (error) {
    return res.status(error.httpStatus || 400).json({
      ok: false,
      error: error.message,
      errorType: error.errorType || 'DRAFTING_READ_FAILED',
      detail: error.detail
    });
  }
});

// POST /api/cad-layers/preview-candidates (C-CAD-01/02 S2 intermediate candidates preview)
router.post('/preview-candidates', async (req, res) => {
  try {
    const body = req.body || {};
    const store = router._store || defaultMappingStore;
    const geometryService = createCadGeometryReaderService({ callCommand, mappingStore: store });

    // Pure offline mode: if dataset is provided directly
    if (body.dataset) {
      let confirmedMapping = body.confirmedMapping;
      let identity = null;
      if (body.projectInfo) {
        identity = deriveProjectIdentity(body.projectInfo);
        if (!confirmedMapping && identity?.projectKey) {
          confirmedMapping = store.getConfirmedMapping(identity.projectKey);
        }
      }
      const preview = await geometryService.previewCandidates(null, {
        dataset: body.dataset,
        confirmedMapping,
        candidateOptions: body.candidateOptions,
        layerInventory: body.layerInventory
      });
      if (!preview.ok) {
        return res.status(preview.httpStatus || 400).json(preview);
      }
      return res.json({ ok: true, identity, preview, writeAllowed: false, reason: 'OFFLINE_PREVIEW_ONLY' });
    }

    if (!Number.isInteger(body.targetPort)) rejectWrite('WRITE_TARGET_REQUIRED', 'Live previews require an explicit targetPort');
    if (body.confirmedMapping !== undefined) rejectWrite('MAPPING_OVERRIDE_FORBIDDEN', 'Live previews use the server confirmed mapping');
    const endpoint = await resolveEndpoint(body);
    const identity = await resolveProjectIdentityFromReq(req, endpoint);
    assertSnapshotTarget(body, identity, endpoint);
    // Capture before the source read; the final check must match this session.
    // An older Add-On may still provide a read-only preview, but cannot mint a write ticket.
    let binding = null, bindingError = null;
    try { binding = await cadExecution().bindPreview(endpoint, identity); }
    catch (error) { bindingError = error.message; }
    const confirmedMapping = store.getConfirmedMapping(identity.projectKey);
    const mappingDigest = digest(confirmedMapping);
    const layers = await callCommand(endpoint, 'GetLayers', {});
    if (!Array.isArray(layers.layers)) rejectWrite('INVALID_LAYER_INVENTORY', 'GetLayers returned no inventory');
    const layerDigest = digest(layers.layers);
    const validation = geometryService.validateParams(body.readParams || {});
    if (!validation.ok) return res.status(400).json(validation);
    if (!Number.isInteger(validation.params.storyIndex)) rejectWrite('SOURCE_STORY_REQUIRED', 'Specify the source story for a live preview');
    const read = await geometryService.readDraftingElements(endpoint, validation.params);
    if (!read.ok || !read.completeness.complete) return res.status(409).json({ ok: false, errorType: 'FULL_DATASET_REQUIRED', detail: read });
    const preview = await geometryService.previewCandidates(null, { dataset: read.dataset, confirmedMapping,
      layerInventory: layers.layers, candidateOptions: body.candidateOptions });
    if (!preview.ok) return res.status(preview.httpStatus || 400).json(preview);
    const snapshot = { endpoint, binding, readParams: validation.params, mappingDigest, layerDigest, candidates: preview.candidates.walls,
      scope: { targetPort: body.targetPort, projectKey: identity.projectKey, mappingRevision: confirmedMapping?.mappingRevision ?? 0,
        sourceFingerprint: read.dataset.sourceFingerprint, datasetDigest: datasetDigest(read.dataset),
        targetStoryIndex: preview.sourceMetadata.targetStoryIndex, candidatesDigest: digest(preview.candidates) } };
    await verifyWallSnapshot(snapshot);
    let authorization = null;
    let reason = bindingError || 'SAVED_PROJECT_CONFIRMED_MAPPING_AND_VALID_WALLS_REQUIRED';
    if (binding && identity.isIdentifiable && confirmedMapping && preview.sourceMetadata.mappingApplied && !preview.sourceMetadata.unresolvedLayers.length && snapshot.candidates.length) {
      try {
        require('../services/cad-wall-creator').compileWallCandidates(snapshot.candidates, { dryRun: false });
        authorization = wallSession().issue(snapshot);
        preview.scope = authorization.scope;
        reason = null;
      } catch (err) { reason = err.message; }
    }
    return res.json({ ok: true, identity, targetPort: body.targetPort, preview, authorization, writeAllowed: Boolean(authorization), reason });
  } catch (error) {
    return res.status(error.httpStatus || 400).json({
      ok: false,
      error: error.message,
      errorType: error.errorType || 'PREVIEW_CANDIDATES_FAILED',
      detail: error.detail
    });
  }
});

// POST /api/cad-layers/create-walls (C-CAD-05 S3 controlled wall creation)
router.post('/create-walls', async (req, res) => {
  try {
    const body = req.body || {};
    const dryRun = body.dryRun !== false;
    const { createWallsFromCandidates } = require('../services/cad-wall-creator');
    const result = dryRun ? await createWallsFromCandidates(body.candidates, {
      dryRun: true, storyIndex: body.storyIndex, defaultHeight: body.height, targetLayer: body.targetLayer
    }) : await wallSession().execute(body, verifyWallSnapshot, callCommand, cadExecution());
    if (!result.ok) {
      return res.status(result.httpStatus || 400).json(result);
    }
    return res.json(result);
  } catch (error) {
    const durableError = /^(EXEC_|RECEIPT_|SNAPSHOT_|WORKFLOW_)/.test(error.message);
    return res.status(error.httpStatus || (durableError ? 409 : 400)).json({
      ok: false,
      error: error.message,
      errorType: error.errorType || (durableError ? error.message : 'CREATE_WALLS_FAILED'),
      detail: error.detail
    });
  }
});

// POST /api/cad-layers/quality-report (C-CAD-07 S5 unified quality & residue report)
router.post('/quality-report', (req, res) => {
  try {
    const body = req.body || {};
    const dataset = body.dataset || {};
    const candidates = body.candidates || {};
    const creationResults = body.creationResults || {};

    const { generateQualityReport } = require('../services/cad-quality-audit');
    const report = generateQualityReport(dataset, candidates, creationResults, body.options || {});

    return res.json({
      ok: true,
      report
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error.message,
      errorType: 'QUALITY_REPORT_FAILED'
    });
  }
});

// POST /api/cad-layers/trace-lineage (C-CAD-07 S5 lineage lookup)
router.post('/trace-lineage', (req, res) => {
  try {
    const body = req.body || {};
    const report = body.report;
    const query = body.query;

    if (!report || !query) {
      return res.status(400).json({
        ok: false,
        errorType: 'MISSING_QUERY_PARAMS',
        error: '必须提供 report 对象与 query 查询参数'
      });
    }

    const { traceElementLineage } = require('../services/cad-quality-audit');
    const result = traceElementLineage(report, query);

    if (!result.ok) {
      return res.status(404).json(result);
    }
    return res.json(result);
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error.message,
      errorType: 'TRACE_LINEAGE_FAILED'
    });
  }
});

module.exports = router;
