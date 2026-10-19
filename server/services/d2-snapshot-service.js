'use strict';

/**
 * SPDX-License-Identifier: MIT
 * MEPbridge ACAIstr - D-2 Model Snapshot Generation & Integrity Service
 * Task C-INS-02 (v0.1.8 Foundation / v0.1.9 Alignment)
 *
 * Responsibilities:
 * 1. D-2 Model Snapshot (d2-snapshot-v1) contract validation and building
 * 2. 0.1mm (1e-4 m) quantization to eliminate floating point jitter
 * 3. 7 Core building structure types support + skippedByCategory accounting
 * 4. Self-contained 2D projection geometry for Door/Window
 * 5. Deterministic canonical-json serialization and SHA-256 integrity signature
 * 6. Big-coordinate (GIS/5km) defense and local offset recommendation
 */

const crypto = require('crypto');
const { fnv1a64 } = require('./instance-registry');

const SNAPSHOT_SCHEMA_VERSION = 'd2-snapshot-v1';
const QUANTIZATION_TOLERANCE_M = 0.0001; // 0.1mm
const LARGE_COORDINATE_THRESHOLD_M = 5000.0; // 5km GIS/Cadastral defense

const SUPPORTED_CORE_TYPES = new Set([
  'Wall',
  'Column',
  'Beam',
  'Slab',
  'Door',
  'Window',
  'GridElement',
]);

const DEFAULT_SKIPPED_CATEGORIES = new Set([
  'Roof',
  'Stair',
  'Morph',
  'Mesh',
  'Object',
  'Lamp',
  'Zone',
  'CurtainWall',
  'Railing',
  'Skylight',
]);

/**
 * Quantize a number to given precision (default 0.1mm)
 */
function quantize(num, precision = QUANTIZATION_TOLERANCE_M) {
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    return 0;
  }
  const factor = Math.round(1 / precision);
  return Math.round(num * factor) / factor;
}

/**
 * Quantize a 2D or 3D point
 */
function quantizePoint(pt, precision = QUANTIZATION_TOLERANCE_M) {
  if (!pt || typeof pt !== 'object') return { x: 0, y: 0 };
  const res = {
    x: quantize(pt.x, precision),
    y: quantize(pt.y, precision),
  };
  if (pt.z !== undefined && Number.isFinite(Number(pt.z))) {
    res.z = quantize(Number(pt.z), precision);
  }
  return res;
}

/**
 * Quantize a polygon vertex list
 */
function quantizePolygon(points, precision = QUANTIZATION_TOLERANCE_M) {
  if (!Array.isArray(points)) return [];
  return points.map((p) => quantizePoint(p, precision));
}

/**
 * Deterministic JSON stringify (alphabetical key sorting, no whitespace)
 */
function canonicalStringify(obj) {
  if (obj === null || obj === undefined) {
    return 'null';
  }
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) return 'null';
    return Object.is(obj, -0) ? '0' : String(obj);
  }
  if (typeof obj === 'boolean' || typeof obj === 'string') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const parts = [];
    for (const key of keys) {
      if (obj[key] !== undefined) {
        parts.push(JSON.stringify(key) + ':' + canonicalStringify(obj[key]));
      }
    }
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(obj);
}

/**
 * Compute SHA-256 of snapshot canonical JSON excluding 'integrity'
 */
function computeSnapshotIntegrity(snapshot) {
  const clone = { ...snapshot };
  delete clone.integrity;
  const canonical = canonicalStringify(clone);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Verify snapshot integrity
 */
function verifySnapshotIntegrity(snapshot) {
  if (!snapshot || !snapshot.integrity || typeof snapshot.integrity.sha256 !== 'string') {
    return false;
  }
  const expected = computeSnapshotIntegrity(snapshot);
  return snapshot.integrity.sha256.toLowerCase() === expected.toLowerCase();
}

/**
 * Compute bounding box from 2D points
 */
function computePointsBBox(points, precision = QUANTIZATION_TOLERANCE_M) {
  if (!Array.isArray(points) || points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const p of points) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return {
    minX: quantize(minX, precision),
    minY: quantize(minY, precision),
    maxX: quantize(maxX, precision),
    maxY: quantize(maxY, precision),
  };
}

/**
 * Normalize and quantize a single element into d2-snapshot-v1 canonical structure
 */
function normalizeElement(raw, options = {}) {
  const precision = options.precision || QUANTIZATION_TOLERANCE_M;
  const elementType = raw.elementType || raw.type || 'Unknown';

  // Check if type is in the 7 core MVP categories
  if (!SUPPORTED_CORE_TYPES.has(elementType)) {
    return {
      skipped: true,
      category: elementType,
      elementGuid: raw.elementGuid || raw.sourceGuid || raw.guid || '',
    };
  }

  const elementGuid = raw.elementGuid || raw.sourceGuid || raw.guid || '';
  const storyIndex = Number.isInteger(raw.storyIndex) ? raw.storyIndex : (raw.floor ? raw.floor.index : 0);
  const layerName = raw.layerName || (raw.layer ? raw.layer.name : 'DEFAULT');
  const classification = raw.classification || (raw.classifications && raw.classifications[0] ? raw.classifications[0].itemName : '');

  // Properties normalization
  const propertiesCanonical = {};
  if (raw.propertiesCanonical && typeof raw.propertiesCanonical === 'object') {
    Object.assign(propertiesCanonical, raw.propertiesCanonical);
  } else if (Array.isArray(raw.properties)) {
    for (const p of raw.properties) {
      if (p && p.name) {
        const key = p.group ? `${p.group}.${p.name}` : p.name;
        propertiesCanonical[key] = p.value !== undefined ? p.value : null;
      }
    }
  } else if (raw.properties && typeof raw.properties === 'object') {
    Object.assign(propertiesCanonical, raw.properties);
  }

  let geometryCanonical = {};
  let bbox2D = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let elevationRange = { bottomZ: 0, topZ: 3.0 };

  const rawGeom = raw.geometryCanonical || (raw.geometry && raw.geometry.payload) || raw.geometry || raw;

  switch (elementType) {
    case 'Wall': {
      const start = quantizePoint(rawGeom.start || { x: 0, y: 0 });
      const end = quantizePoint(rawGeom.end || { x: 1, y: 0 });
      const thickness = quantize(rawGeom.thickness || raw.thickness || 0.24);
      const arcAngleDeg = quantize(rawGeom.arcAngleDeg || 0.0);
      const height = quantize(rawGeom.height || raw.height || 3.0);
      const bottomZ = quantize(rawGeom.bottomZ || raw.level || 0.0);

      const openings = Array.isArray(rawGeom.openings)
        ? rawGeom.openings.map((op) => ({
            guid: op.guid || op.elementGuid || '',
            offsetFromStart: quantize(op.offsetFromStart || 0),
            width: quantize(op.width || 0.9),
            height: quantize(op.height || 2.1),
            sillHeight: quantize(op.sillHeight || 0.0),
          }))
        : [];

      geometryCanonical = {
        kind: 'wall_segment',
        start,
        end,
        thickness,
        arcAngleDeg,
        openings,
      };

      // Calculate Wall bbox2D including thickness
      const halfThick = thickness / 2;
      bbox2D = {
        minX: quantize(Math.min(start.x, end.x) - halfThick),
        minY: quantize(Math.min(start.y, end.y) - halfThick),
        maxX: quantize(Math.max(start.x, end.x) + halfThick),
        maxY: quantize(Math.max(start.y, end.y) + halfThick),
      };
      elevationRange = {
        bottomZ,
        topZ: quantize(bottomZ + height),
      };
      break;
    }

    case 'Column': {
      const position = quantizePoint(rawGeom.position || { x: 0, y: 0 });
      const profileKind = rawGeom.profileKind || (rawGeom.diameter ? 'circular' : 'rectangular');
      const width = quantize(rawGeom.width || rawGeom.coreWidth || 0.4);
      const depth = quantize(rawGeom.depth || rawGeom.coreDepth || width);
      const diameter = quantize(rawGeom.diameter || (profileKind === 'circular' ? width : 0));
      const rotationDeg = quantize(rawGeom.rotationDeg || rawGeom.angle || 0.0);
      const height = quantize(rawGeom.height || 3.0);
      const bottomZ = quantize(rawGeom.bottomZ || raw.level || 0.0);

      geometryCanonical = {
        kind: 'column_segment',
        position,
        profileKind,
        width,
        depth,
        diameter,
        rotationDeg,
      };

      const halfW = (profileKind === 'circular' ? diameter : width) / 2;
      const halfD = (profileKind === 'circular' ? diameter : depth) / 2;
      bbox2D = {
        minX: quantize(position.x - halfW),
        minY: quantize(position.y - halfD),
        maxX: quantize(position.x + halfW),
        maxY: quantize(position.y + halfD),
      };
      elevationRange = {
        bottomZ,
        topZ: quantize(bottomZ + height),
      };
      break;
    }

    case 'Beam': {
      const start = quantizePoint(rawGeom.start || { x: 0, y: 0 });
      const end = quantizePoint(rawGeom.end || { x: 1, y: 0 });
      const width = quantize(rawGeom.width || 0.25);
      const height = quantize(rawGeom.height || 0.50);
      const level = quantize(rawGeom.level || raw.level || 3.0);

      geometryCanonical = {
        kind: 'beam_segment',
        start,
        end,
        width,
        height,
        level,
      };

      const halfW = width / 2;
      bbox2D = {
        minX: quantize(Math.min(start.x, end.x) - halfW),
        minY: quantize(Math.min(start.y, end.y) - halfW),
        maxX: quantize(Math.max(start.x, end.x) + halfW),
        maxY: quantize(Math.max(start.y, end.y) + halfW),
      };
      elevationRange = {
        bottomZ: quantize(level - height),
        topZ: level,
      };
      break;
    }

    case 'Slab': {
      const polygon = quantizePolygon(
        rawGeom.polygon ? (rawGeom.polygon.points || rawGeom.polygon) : (rawGeom.points || [])
      );
      const thickness = quantize(rawGeom.thickness || 0.15);
      const level = quantize(rawGeom.level || raw.level || 0.0);
      const holes = Array.isArray(rawGeom.holes)
        ? rawGeom.holes.map((h) => quantizePolygon(h.points || h))
        : [];

      geometryCanonical = {
        kind: 'slab_polygon',
        polygon,
        thickness,
        level,
        holes,
      };

      bbox2D = computePointsBBox(polygon, precision);
      elevationRange = {
        bottomZ: quantize(level - thickness),
        topZ: level,
      };
      break;
    }

    case 'Door':
    case 'Window': {
      const hostWallGuid = rawGeom.hostWallGuid || raw.hostWallGuid || '';
      const offsetFromStart = quantize(rawGeom.offsetFromStart || raw.offsetFromStart || 0.0);
      const width = quantize(rawGeom.width || (elementType === 'Door' ? 0.9 : 1.5));
      const height = quantize(rawGeom.height || 2.1);
      const sillHeight = quantize(rawGeom.sillHeight || (elementType === 'Window' ? 0.9 : 0.0));

      // Self-contained 2D geometry (D-INS-2 & §6.1 Requirement)
      let centerPoint = quantizePoint(rawGeom.centerPoint || raw.centerPoint || { x: 0, y: 0 });
      let bBox2DProvided = rawGeom.bbox2D || raw.bbox2D;
      if (bBox2DProvided) {
        bbox2D = {
          minX: quantize(bBox2DProvided.minX),
          minY: quantize(bBox2DProvided.minY),
          maxX: quantize(bBox2DProvided.maxX),
          maxY: quantize(bBox2DProvided.maxY),
        };
      } else {
        const halfW = width / 2;
        bbox2D = {
          minX: quantize(centerPoint.x - halfW),
          minY: quantize(centerPoint.y - 0.15),
          maxX: quantize(centerPoint.x + halfW),
          maxY: quantize(centerPoint.y + 0.15),
        };
      }

      geometryCanonical = {
        kind: elementType === 'Door' ? 'door_placement' : 'window_placement',
        hostWallGuid,
        offsetFromStart,
        width,
        height,
        sillHeight,
        centerPoint,
      };

      elevationRange = {
        bottomZ: sillHeight,
        topZ: quantize(sillHeight + height),
      };
      break;
    }

    case 'GridElement': {
      const start = quantizePoint(rawGeom.start || { x: 0, y: 0 });
      const end = quantizePoint(rawGeom.end || { x: 10, y: 0 });
      const markerText = rawGeom.markerText || raw.markerText || 'A';
      const arcAngleDeg = quantize(rawGeom.arcAngleDeg || 0.0);

      geometryCanonical = {
        kind: 'grid_axis',
        start,
        end,
        markerText,
        arcAngleDeg,
      };

      bbox2D = {
        minX: quantize(Math.min(start.x, end.x)),
        minY: quantize(Math.min(start.y, end.y)),
        maxX: quantize(Math.max(start.x, end.x)),
        maxY: quantize(Math.max(start.y, end.y)),
      };
      elevationRange = { bottomZ: 0, topZ: 0 };
      break;
    }
  }

  // Override bbox2D if raw provided specific valid bbox
  if (raw.bbox2D && typeof raw.bbox2D === 'object') {
    bbox2D = {
      minX: quantize(raw.bbox2D.minX),
      minY: quantize(raw.bbox2D.minY),
      maxX: quantize(raw.bbox2D.maxX),
      maxY: quantize(raw.bbox2D.maxY),
    };
  }

  // Compute element fingerprints
  const geometryHash = fnv1a64(canonicalStringify(geometryCanonical));
  const propertyHash = fnv1a64(canonicalStringify(propertiesCanonical));
  const combinedHash = fnv1a64(`${geometryHash}:${propertyHash}`);

  return {
    skipped: false,
    elementGuid,
    elementType,
    storyIndex,
    layerName,
    classification,
    bbox2D,
    elevationRange,
    geometryCanonical,
    propertiesCanonical,
    fingerprints: {
      geometryHash,
      propertyHash,
      combinedHash,
    },
  };
}

/**
 * Build complete D-2 Model Snapshot (d2-snapshot-v1)
 */
function buildD2Snapshot({
  snapshotId,
  capturedAt,
  sourceInstance,
  stories = [],
  rawElements = [],
  options = {},
}) {
  const precision = options.precision || QUANTIZATION_TOLERANCE_M;
  const sid = snapshotId || `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const capTime = capturedAt || new Date().toISOString();

  const skippedByCategory = {};
  const validElements = [];
  const warnings = [];

  let sumX = 0;
  let sumY = 0;
  let pointCount = 0;
  let largeCoordDetected = false;

  for (const raw of rawElements) {
    const norm = normalizeElement(raw, { precision });
    if (norm.skipped) {
      skippedByCategory[norm.category] = (skippedByCategory[norm.category] || 0) + 1;
    } else {
      validElements.push(norm);

      // Check distance from origin for big-coordinate defense
      const cx = (norm.bbox2D.minX + norm.bbox2D.maxX) / 2;
      const cy = (norm.bbox2D.minY + norm.bbox2D.maxY) / 2;
      const distFromOrigin = Math.hypot(cx, cy);

      if (distFromOrigin > LARGE_COORDINATE_THRESHOLD_M) {
        largeCoordDetected = true;
      }
      sumX += cx;
      sumY += cy;
      pointCount++;
    }
  }

  let recommendedLocalOffset = null;
  if (largeCoordDetected) {
    warnings.push('LARGE_COORDINATE_DETECTED');
    if (pointCount > 0) {
      recommendedLocalOffset = {
        x: quantize(-(sumX / pointCount), precision),
        y: quantize(-(sumY / pointCount), precision),
        z: 0.0,
      };
    }
  }

  const coverage = {
    extractedCount: validElements.length,
    skippedByCategory,
    failedCount: 0,
    warnings,
    ...(recommendedLocalOffset ? { recommendedLocalOffset } : {}),
  };

  const normalizedStories = stories.map((s) => ({
    index: Number(s.index),
    name: String(s.name || `Story ${s.index}`),
    elevation: quantize(Number(s.elevation || 0.0), precision),
    height: quantize(Number(s.height || 3.0), precision),
  }));

  const snapshot = {
    schema: SNAPSHOT_SCHEMA_VERSION,
    snapshotId: sid,
    capturedAt: capTime,
    sourceInstance: sourceInstance || {
      instanceId: 'default-instance',
      projectName: 'DefaultProject.pln',
      projectPathHash: fnv1a64(''),
      archicadVersion: '29.0.0',
      coordSystem: 'archicad_world',
      lengthUnit: 'm',
      quantization: precision,
      projectLocation: {
        northAngleDeg: 0.0,
        originOffset: { x: 0.0, y: 0.0, z: 0.0 },
      },
    },
    stories: normalizedStories,
    coverage,
    elements: validElements,
  };

  // Add integrity block
  snapshot.integrity = {
    algorithm: 'canonical-json-excluding-integrity-sha256',
    sha256: computeSnapshotIntegrity(snapshot),
  };

  return snapshot;
}

module.exports = {
  SNAPSHOT_SCHEMA_VERSION,
  QUANTIZATION_TOLERANCE_M,
  LARGE_COORDINATE_THRESHOLD_M,
  SUPPORTED_CORE_TYPES,
  DEFAULT_SKIPPED_CATEGORIES,
  quantize,
  quantizePoint,
  quantizePolygon,
  canonicalStringify,
  computeSnapshotIntegrity,
  verifySnapshotIntegrity,
  computePointsBBox,
  normalizeElement,
  buildD2Snapshot,
};
