'use strict';

// AUD-4: convert an already verified D-2 element snapshot into the local
// MEPBridge Building JSON document. This is a server-side transformation only:
// no external API call, no project mutation, and no arbitrary file writes.

const crypto = require('crypto');
const { computeContentHash } = require('./snapshot-replay');

const SCHEMA_VERSION = 'aud4-1';
const HASH_SCOPE = 'canonical-json-excluding-integrity.sha256';

function canonicalize (value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  return value;
}

function canonicalJson (value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex (text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function failure (errorType, message, detail, httpStatus = 400) {
  return { ok: false, errorType, message, detail, httpStatus };
}

function validateSnapshot (snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return failure('INVALID_SNAPSHOT', 'building JSON export requires an element snapshot');
  }
  if (snapshot.documentType !== 'element-snapshot') {
    return failure('INVALID_SNAPSHOT_DOCUMENT_TYPE', 'snapshot.documentType must be element-snapshot');
  }
  if (snapshot.schemaVersion !== 'd2-1') {
    return failure('UNSUPPORTED_SNAPSHOT_SCHEMA', `snapshot.schemaVersion must be d2-1 (got ${JSON.stringify(snapshot.schemaVersion)})`);
  }
  const requiredPaths = [
    ['source', 'port'],
    ['source', 'projectName'],
    ['source', 'projectPath'],
    ['source', 'archicadVersion'],
    ['coordinateSystem', 'unit'],
    ['coordinateSystem', 'space'],
    ['coordinateSystem', 'axis'],
    ['coordinateSystem', 'distanceToleranceM'],
    ['capture', 'selectionMode'],
    ['capture', 'succeeded'],
    ['capture', 'failed'],
    ['capture', 'skipped'],
    ['elements']
  ];
  for (const [key, child] of requiredPaths) {
    const value = child ? snapshot[key] && snapshot[key][child] : snapshot[key];
    if (value === undefined) {
      return failure('INVALID_SNAPSHOT_STRUCTURE', `snapshot is missing ${child ? `${key}.${child}` : key}`);
    }
  }
  if (!Array.isArray(snapshot.elements)) {
    return failure('INVALID_SNAPSHOT_STRUCTURE', 'snapshot.elements must be an array');
  }
  if (computeContentHash(snapshot) !== snapshot.contentHash) {
    return failure('SNAPSHOT_HASH_MISMATCH', 'snapshot.contentHash does not match its content', {
      declared: snapshot.contentHash,
      recomputed: computeContentHash(snapshot)
    });
  }
  return { ok: true };
}

function summarizeCounts (snapshot) {
  const byType = new Map();
  const byFloor = new Map();
  for (const element of snapshot.elements) {
    byType.set(element.elementType, (byType.get(element.elementType) || 0) + 1);
    const floor = element.floor && element.floor.name !== undefined
      ? element.floor.name
      : `#${element.floor && element.floor.index}`;
    byFloor.set(floor, (byFloor.get(floor) || 0) + 1);
  }
  const sortedObject = (map) => {
    const output = {};
    for (const key of Array.from(map.keys()).sort()) output[key] = map.get(key);
    return output;
  };
  return { byType: sortedObject(byType), byFloor: sortedObject(byFloor) };
}

function convertElement (element) {
  const output = {
    sourceGuid: element.sourceGuid,
    sourceGuidScope: 'source-project-only',
    elementType: element.elementType,
    floor: element.floor,
    layer: element.layer,
    geometry: element.geometry,
    properties: element.properties,
    classifications: element.classifications
  };
  if (Array.isArray(element.dependencies)) output.dependencies = element.dependencies;
  return output;
}

function computeDocumentHashFromDocument (document) {
  const copy = { ...document, integrity: { ...document.integrity, sha256: '' } };
  return sha256Hex(canonicalJson(copy));
}

function createBuildingJsonExportService (deps = {}) {
  const captureSnapshot = deps.captureSnapshot;
  if (typeof captureSnapshot !== 'function') {
    throw new Error('building-json-export requires an injectable captureSnapshot(request)');
  }
  const now = deps.now || (() => Date.now());

  async function exportFromSnapshot (input) {
    const request = input && typeof input === 'object' ? input : {};
    let snapshot;

    if (request.snapshot !== undefined) {
      if (request.selectionMode !== undefined
        || request.requestedTypes !== undefined
        || request.requestedGuids !== undefined
        || request.sourcePort !== undefined
        || request.sourceProject !== undefined) {
        return failure('SNAPSHOT_AND_CAPTURE_FIELDS_CONFLICT', 'Provide either snapshot or capture request fields, not both');
      }
      snapshot = request.snapshot;
    } else {
      const captured = await captureSnapshot({
        selectionMode: request.selectionMode,
        requestedTypes: request.requestedTypes,
        requestedGuids: request.requestedGuids,
        sourcePort: request.sourcePort,
        sourceProject: request.sourceProject
      });
      if (!captured || captured.ok !== true) {
        const errorType = captured && captured.errorType ? captured.errorType : 'CAPTURE_FAILED';
        const httpStatus = captured && captured.httpStatus ? captured.httpStatus : 400;
        return failure(errorType, `snapshot capture failed: ${captured ? captured.message || errorType : 'unknown error'}`, captured && captured.detail, httpStatus);
      }
      snapshot = captured.snapshot;
    }

    const validated = validateSnapshot(snapshot);
    if (!validated.ok) return validated;

    const counts = summarizeCounts(snapshot);
    const document = {
      documentType: 'mepbridge-building-json',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date(now()).toISOString(),
      source: snapshot.source,
      coordinateSystem: snapshot.coordinateSystem,
      capture: snapshot.capture,
      summary: {
        elementCount: snapshot.elements.length,
        byType: counts.byType,
        byFloor: counts.byFloor,
        succeededCount: snapshot.capture.succeeded.length,
        failedCount: snapshot.capture.failed.length,
        skippedCount: snapshot.capture.skipped.length
      },
      elements: snapshot.elements.map(convertElement),
      integrity: {
        algorithm: 'sha256',
        hashScope: HASH_SCOPE,
        sha256: '',
        byteCount: 0
      }
    };

    document.integrity.byteCount = Buffer.from(
      canonicalJson({ ...document, integrity: { ...document.integrity, sha256: '' } }),
      'utf8'
    ).length;
    document.integrity.sha256 = computeDocumentHashFromDocument(document);

    return { ok: true, buildingJson: document, warnings: [] };
  }

  return { exportFromSnapshot, computeDocumentHash: computeDocumentHashFromDocument };
}

module.exports = {
  createBuildingJsonExportService,
  computeDocumentHash: computeDocumentHashFromDocument,
  SCHEMA_VERSION
};
