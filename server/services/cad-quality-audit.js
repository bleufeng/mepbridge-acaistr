'use strict';

/**
 * C-CAD-07 S5 Unified Quality & Residue Audit Service
 *
 * Implements C_CAD_REVERSE_MODELING_MASTER_PLAN_20261024.md §5.6:
 * 1. Bidirectional Lineage Tracking (Raw CAD elements <-> Candidates <-> Target Element GUIDs)
 * 2. Quality Metrics Computation (conversion ratios, geometric health, junction counts)
 * 3. Residue Analysis (unpaired lines, unbridged gaps, unoccupied grid intersections)
 */

const { datasetDigest, digest, completeness } = require('./cad-snapshot-contract');
const { validateDraftingDataset } = require('./dwg-intermediate-contract');

const SCHEMA_VERSION = 'cad-quality-report-v1';

/**
 * Build bidirectional traceability mappings across raw elements, candidates, and created targets
 */
function buildTraceabilityMaps(dataset = {}, intermediateCandidates = {}, creationResults = {}) {
  const elements = dataset.elements || [];
  const rawElementMap = new Map();
  for (const el of elements) {
    if (el && el.guid) {
      rawElementMap.set(el.guid, el);
    }
  }

  const rawToCandidate = Object.create(null);
  const candidateToRaw = Object.create(null);
  const candidateMap = new Map();

  const allCandidates = [
    ...(intermediateCandidates.candidates?.walls || intermediateCandidates.walls || []),
    ...(intermediateCandidates.candidates?.columns || intermediateCandidates.columns || []),
    ...(intermediateCandidates.candidates?.grids || intermediateCandidates.grids || [])
  ];

  for (const c of allCandidates) {
    if (!c || !c.candidateId) continue;
    candidateMap.set(c.candidateId, c);
    candidateToRaw[c.candidateId] = Array.isArray(c.sourceGuids) ? [...c.sourceGuids] : [];

    if (Array.isArray(c.sourceGuids)) {
      for (const rawGuid of c.sourceGuids) {
        if (!rawToCandidate[rawGuid]) {
          rawToCandidate[rawGuid] = [];
        }
        if (!rawToCandidate[rawGuid].includes(c.candidateId)) {
          rawToCandidate[rawGuid].push(c.candidateId);
        }
      }
    }
  }

  const candidateToTarget = Object.create(null);
  const targetToCandidate = Object.create(null);

  const resultsList = Array.isArray(creationResults.results)
    ? creationResults.results
    : (Array.isArray(creationResults) ? creationResults : []);

  for (const res of resultsList) {
    if (!res || !res.candidateId) continue;
    candidateToTarget[res.candidateId] = {
      guid: res.guid || null,
      status: res.status || 'unknown',
      error: res.error || null
    };
    if (res.guid) {
      targetToCandidate[res.guid] = res.candidateId;
    }
  }

  return {
    rawElementMap,
    candidateMap,
    rawToCandidate,
    candidateToRaw,
    candidateToTarget,
    targetToCandidate
  };
}

/**
 * Compute quality metrics and conversion rates
 */
function computeQualityMetrics(dataset = {}, intermediateCandidates = {}, creationResults = {}, maps = {}) {
  const elements = dataset.elements || [];
  const totalRawElements = elements.length;

  const consumedRawGuids = new Set(Object.keys(maps.rawToCandidate || {}).filter(guid => elements.some(e => e.guid === guid)));
  const consumedRawCount = consumedRawGuids.size;
  const unconsumedRawCount = Math.max(0, totalRawElements - consumedRawCount);
  const rawConsumptionRate = totalRawElements > 0
    ? Number((consumedRawCount / totalRawElements).toFixed(3))
    : 1.0;

  const walls = intermediateCandidates.candidates?.walls || intermediateCandidates.walls || [];
  const columns = intermediateCandidates.candidates?.columns || intermediateCandidates.columns || [];
  const grids = intermediateCandidates.candidates?.grids || intermediateCandidates.grids || [];
  const intersections = intermediateCandidates.candidates?.gridIntersections || intermediateCandidates.gridIntersections || [];

  const resultsList = Array.isArray(creationResults.results)
    ? creationResults.results
    : (Array.isArray(creationResults) ? creationResults : []);

  const totalCreated = resultsList.filter(r => r.status === 'created').length;
  const totalSimulated = resultsList.filter(r => r.status === 'simulated').length;
  const totalFailed = resultsList.filter(r => r.status === 'failed').length;
  const totalAttempted = resultsList.length;

  const creationSuccessRate = totalAttempted > 0
    ? Number((totalCreated / totalAttempted).toFixed(3))
    : (totalSimulated > 0 ? 1.0 : 0.0);

  // Geometric quality analysis
  const mergedWallCount = walls.filter(w => w.fitKind === 'collinear_merged').length;
  const bridgedOpeningCount = walls.reduce((sum, w) => sum + (w.bridgeMask?.openings?.length || 0), 0);
  const resolvedJunctionCount = walls.reduce((sum, w) => sum + (w.junctions?.length || 0), 0);
  const atypicalThicknessCount = walls.filter(w => (w.warnings || []).some(warn => warn.code === 'ATYPICAL_THICKNESS')).length;

  const correlatedColumnCount = columns.filter(c => Boolean(c.gridAssociation)).length;
  const unoccupiedIntersectionCount = (intermediateCandidates.candidates?.unoccupiedIntersections || intermediateCandidates.unoccupiedIntersections || []).length;

  return {
    rawInventory: {
      totalRawElements,
      consumedRawElements: consumedRawCount,
      unconsumedRawElements: unconsumedRawCount,
      consumptionRate: rawConsumptionRate
    },
    candidateDistribution: {
      walls: walls.length,
      columns: columns.length,
      grids: grids.length,
      gridIntersections: intersections.length,
      totalCandidates: walls.length + columns.length + grids.length
    },
    creationSummary: {
      totalAttempted,
      createdCount: totalCreated,
      simulatedCount: totalSimulated,
      failedCount: totalFailed,
      successRate: creationSuccessRate
    },
    geometricHealth: {
      mergedWallCount,
      bridgedOpeningCount,
      resolvedJunctionCount,
      atypicalThicknessCount,
      correlatedColumnCount,
      unoccupiedIntersectionCount
    }
  };
}

/**
 * Extract residual items (unconsumed lines, unconnected wall gaps, unoccupied intersections, creation errors)
 */
function extractResidueItems(dataset = {}, intermediateCandidates = {}, creationResults = {}, maps = {}) {
  const elements = dataset.elements || [];
  const unconsumedElements = [];

  for (const el of elements) {
    if (el && el.guid && !maps.rawToCandidate[el.guid]) {
      unconsumedElements.push({
        guid: el.guid,
        type: el.type,
        layerName: el.layerName,
        reason: 'UNPAIRED_OR_UNRECOGNIZED'
      });
    }
  }

  const walls = intermediateCandidates.candidates?.walls || intermediateCandidates.walls || [];
  const unconnectedGaps = [];
  for (const w of walls) {
    const gapWarnings = (w.warnings || []).filter(warn => warn.code === 'UNCONNECTED_GAP');
    for (const gw of gapWarnings) {
      unconnectedGaps.push({
        candidateId: w.candidateId,
        sourceLayer: w.sourceLayer,
        gapDistance: gw.gapDistance,
        message: gw.message
      });
    }
  }

  const unoccupiedIntersections = intermediateCandidates.candidates?.unoccupiedIntersections ||
    intermediateCandidates.unoccupiedIntersections || [];

  const resultsList = Array.isArray(creationResults.results)
    ? creationResults.results
    : (Array.isArray(creationResults) ? creationResults : []);

  const failedCreations = resultsList
    .filter(r => ['failed', 'unknown', 'not_attempted'].includes(r.status))
    .map(r => ({
      candidateId: r.candidateId,
      error: r.error,
      status: r.status,
      nativeResponse: r.nativeResponse || null,
      parameters: r.parameters
    }));

  return {
    unconsumedRawElements: unconsumedElements,
    unconnectedWallGaps: unconnectedGaps,
    unoccupiedGridIntersections: unoccupiedIntersections.map(u => ({
      intersectionId: u.intersectionId,
      label: u.label,
      point: u.position,
      intersectingGridIds: [u.grid1?.candidateId, u.grid2?.candidateId].filter(Boolean)
    })),
    failedCreations
  };
}

/**
 * Main Entry Point: Generate Unified Quality & Residue Report
 */
function generateQualityReport(dataset = {}, intermediateCandidates = {}, creationResults = {}, options = {}) {
  const validation = validateDraftingDataset(dataset);
  if (!validation.valid) throw new Error(validation.error);
  dataset = validation.payload;
  if (!Array.isArray(dataset.elements)) throw new Error('Raw element inventory required');
  const rawIds = new Set(dataset.elements.map(e => e.guid));
  const all = ['walls', 'columns', 'grids'].flatMap(k => {
    const list = intermediateCandidates.candidates?.[k] || intermediateCandidates[k] || [];
    if (!Array.isArray(list)) throw new Error('Candidate lists must be arrays');
    return list;
  });
  const candidateIds = new Set();
  for (const c of all) {
    if (!c || typeof c.candidateId !== 'string' || candidateIds.has(c.candidateId) || !Array.isArray(c.sourceGuids)) throw new Error('Unique candidate IDs and raw provenance required');
    candidateIds.add(c.candidateId);
    if (c.sourceGuids.some(g => !rawIds.has(g))) throw new Error('Candidate source GUID is outside the raw inventory');
  }
  const metadata = intermediateCandidates.sourceMetadata || {};
  for (const field of ['unit', 'coordSystem', 'storyIndex']) {
    if (metadata[field] !== undefined && dataset[field] !== undefined && metadata[field] !== dataset[field]) throw new Error('Source metadata mismatch: ' + field);
  }
  if (metadata.sourceFingerprint && metadata.sourceFingerprint !== dataset.sourceFingerprint) throw new Error('Source fingerprint mismatch');
  if (metadata.datasetDigest && metadata.datasetDigest !== datasetDigest(dataset)) throw new Error('Raw dataset digest mismatch');
  const scope = intermediateCandidates.scope;
  if (scope && (scope.datasetDigest !== datasetDigest(dataset) || scope.candidatesDigest !== digest(intermediateCandidates.candidates))) throw new Error('Preview scope mismatch');
  const receiptScope = creationResults.receipt?.scope;
  if (receiptScope && (!scope || digest(receiptScope) !== digest(scope))) throw new Error('Receipt belongs to a different preview/target scope');
  const resultList = Array.isArray(creationResults) ? creationResults : creationResults.results || [];
  if (!Array.isArray(resultList)) throw new Error('Results must be an array');
  const resultIds = new Set();
  for (const r of resultList) {
    if (!r || !candidateIds.has(r.candidateId) || resultIds.has(r.candidateId)) throw new Error('Receipt has unknown or duplicate candidate ID');
    resultIds.add(r.candidateId);
  }
  // Client-supplied offline reports can be internally consistent, never authenticated native evidence.
  const verification = { status: 'unverified', completeness: completeness(dataset), consistency: metadata.datasetDigest && (!resultList.length || receiptScope) ? 'scope_matched' : 'legacy_unscoped',
    reason: 'Offline client inputs are not server-authenticated creation evidence' };
  const maps = buildTraceabilityMaps(dataset, intermediateCandidates, creationResults);
  const metrics = computeQualityMetrics(dataset, intermediateCandidates, creationResults, maps);
  const residue = extractResidueItems(dataset, intermediateCandidates, creationResults, maps);

  const report = {
    schemaVersion: SCHEMA_VERSION,
    verification,
    generatedAt: new Date().toISOString(),
    sourceMetadata: {
      sourceFingerprint: dataset.sourceFingerprint || intermediateCandidates.sourceMetadata?.sourceFingerprint || 'unknown',
      unit: dataset.unit || intermediateCandidates.sourceMetadata?.unit || 'm',
      coordSystem: dataset.coordSystem || intermediateCandidates.sourceMetadata?.coordSystem || 'archicad_world',
      storyIndex: intermediateCandidates.sourceMetadata?.storyIndex ?? options.storyIndex ?? 0,
      totalRawElements: (dataset.elements || []).length
    },
    traceability: {
      rawToCandidate: maps.rawToCandidate,
      candidateToRaw: maps.candidateToRaw,
      candidateToTarget: maps.candidateToTarget,
      targetToCandidate: maps.targetToCandidate
    },
    metrics,
    residue
  };

  return report;
}

/**
 * Query bidirectional lineage for a specific element (rawGuid, candidateId, or targetGuid)
 */
function traceElementLineage(report, query = {}) {
  if (!report || !report.traceability) {
    return { ok: false, error: 'Invalid or missing quality report' };
  }
  const trace = report.traceability;

  // Query by created Archicad target GUID
  if (query.targetGuid) {
    const candidateId = Object.hasOwn(trace.targetToCandidate, query.targetGuid) ? trace.targetToCandidate[query.targetGuid] : null;
    if (!candidateId) {
      return { ok: false, error: `No candidate found for target GUID: ${query.targetGuid}` };
    }
    const rawGuids = trace.candidateToRaw[candidateId] || [];
    const targetInfo = trace.candidateToTarget[candidateId] || null;

    return {
      ok: true,
      queryKind: 'targetGuid',
      targetGuid: query.targetGuid,
      targetInfo,
      candidateId,
      rawGuids
    };
  }

  // Query by Candidate ID
  if (query.candidateId) {
    if (!Object.hasOwn(trace.candidateToRaw, query.candidateId)) return { ok: false, error: 'Candidate not found' };
    const rawGuids = trace.candidateToRaw[query.candidateId] || [];
    const targetInfo = trace.candidateToTarget[query.candidateId] || null;

    return {
      ok: true,
      queryKind: 'candidateId',
      candidateId: query.candidateId,
      targetGuid: targetInfo?.guid || null,
      targetInfo,
      rawGuids
    };
  }

  // Query by raw CAD element GUID
  if (query.rawGuid) {
    if (!Object.hasOwn(trace.rawToCandidate, query.rawGuid)) return { ok: false, error: 'Raw GUID has no candidate lineage' };
    const candidateIds = trace.rawToCandidate[query.rawGuid] || [];
    const candidates = candidateIds.map(cid => ({
      candidateId: cid,
      targetInfo: trace.candidateToTarget[cid] || null
    }));

    return {
      ok: true,
      queryKind: 'rawGuid',
      rawGuid: query.rawGuid,
      candidateIds,
      candidates
    };
  }

  return { ok: false, error: 'Must provide targetGuid, candidateId, or rawGuid in query' };
}

module.exports = {
  SCHEMA_VERSION,
  buildTraceabilityMaps,
  computeQualityMetrics,
  extractResidueItems,
  generateQualityReport,
  traceElementLineage
};
