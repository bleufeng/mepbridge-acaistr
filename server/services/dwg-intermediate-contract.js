'use strict';

/**
 * SPDX-License-Identifier: MIT
 * MEPbridge ACAIstr - DWG Reverse Modeling Intermediate Contract & Geometric Engine
 * Phase 3 (V18-CAD-01P / DWG-H / DWG-I Staging)
 *
 * Provides:
 * 1. Data contract validation for raw 2D drafting elements (Line, Polyline, Arc/Circle, Text, Hatch)
 * 2. 2D geometric operations: distance, collinearity, double-line wall pairing, polygon area/centroid
 * 3. Door/Window Bridge Mask generation (retains continuous native AC walls across openings)
 * 4. SOLID Hatch extraction for structural column candidates
 * 5. Grid axis line extraction & label text association
 * 6. Big-coordinate / GIS origin defense & FNV-1a anti-tamper fingerprinting verification
 */

const { recognizeLayerName, REVIEW_CONFIDENCE_THRESHOLD } = require('./cad-layer-recognition');

const SCHEMA_VERSION = 'dwg-intermediate-v1';

// Geometric tolerance constants (meters & degrees)
const DEFAULT_GEOM_EPSILON = 1e-4; // 0.1mm
const DEFAULT_SNAP_TOLERANCE = 0.02; // 20mm
const DEFAULT_ANGLE_TOLERANCE_DEG = 2.0; // 2 degrees for parallel / collinear lines
const DEFAULT_MIN_WALL_THICKNESS = 0.08; // 80mm
const DEFAULT_MAX_WALL_THICKNESS = 0.80; // 800mm
const DEFAULT_OVERLAP_RATIO_MIN = 0.50; // 50% overlap required for double-line wall pairing
const FAR_FROM_ORIGIN_THRESHOLD_METERS = 5000.0; // 5km GIS/Cadastral threshold

/**
 * 2D Point distance
 */
function distance2D(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.hypot(dx, dy);
}

/**
 * Undirected angle of a 2D line segment in [0, PI)
 */
function lineAngle(p1, p2) {
  let ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  if (ang < 0) ang += Math.PI;
  if (ang >= Math.PI) ang -= Math.PI;
  return ang;
}

/**
 * Check if two line segments are parallel within angular tolerance (degrees)
 */
function areParallel(l1, l2, angleTolDeg = DEFAULT_ANGLE_TOLERANCE_DEG) {
  const a1 = lineAngle(l1.p1, l1.p2);
  const a2 = lineAngle(l2.p1, l2.p2);
  let diff = Math.abs(a1 - a2);
  if (diff > Math.PI / 2) diff = Math.PI - diff;
  const tolRad = (angleTolDeg * Math.PI) / 180.0;
  return diff <= tolRad;
}

/**
 * Project point onto infinite line defined by p1 -> p2
 * Returns { proj: {x, y}, t: scalar projection factor }
 */
function projectPointOntoLine(pt, p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    return { proj: { x: p1.x, y: p1.y }, t: 0 };
  }
  const t = ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / lenSq;
  return {
    proj: { x: p1.x + t * dx, y: p1.y + t * dy },
    t
  };
}

/**
 * Perpendicular distance from point to line segment
 */
function pointToLineDistance(pt, p1, p2) {
  const { proj } = projectPointOntoLine(pt, p1, p2);
  return distance2D(pt, proj);
}

/**
 * Measure parallel distance and 1D overlap ratio between two parallel line segments
 */
function measureParallelPair(l1, l2, angleTolDeg = DEFAULT_ANGLE_TOLERANCE_DEG) {
  if (!areParallel(l1, l2, angleTolDeg)) {
    return null;
  }

  // Perpendicular distance (average of l2's endpoints to l1)
  const d1 = pointToLineDistance(l2.p1, l1.p1, l1.p2);
  const d2 = pointToLineDistance(l2.p2, l1.p1, l1.p2);
  const perpDist = (d1 + d2) / 2.0;

  // Project l2 endpoints onto l1 line to get parameter range [tMin2, tMax2]
  const pr1 = projectPointOntoLine(l2.p1, l1.p1, l1.p2);
  const pr2 = projectPointOntoLine(l2.p2, l1.p1, l1.p2);
  const tMin2 = Math.min(pr1.t, pr2.t);
  const tMax2 = Math.max(pr1.t, pr2.t);

  // l1's own parameter range is [0, 1]
  const overlapStart = Math.max(0, tMin2);
  const overlapEnd = Math.min(1, tMax2);
  const overlapLen = Math.max(0, overlapEnd - overlapStart);

  const l1Len = distance2D(l1.p1, l1.p2);
  const l2Len = distance2D(l2.p1, l2.p2);
  const minLen = Math.min(l1Len, l2Len);
  if (minLen < 1e-6) return null;

  const overlapRatio = (overlapLen * l1Len) / minLen;

  return {
    perpendicularDistance: perpDist,
    overlapRatio,
    overlapStartT: overlapStart,
    overlapEndT: overlapEnd
  };
}

/**
 * Compute signed area of 2D polygon using Shoelace formula
 * Positive = Counter-Clockwise (CCW, outer ring)
 * Negative = Clockwise (CW, void/hole)
 */
function polygonSignedArea(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return 0;
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return area / 2.0;
}

/**
 * Compute centroid of 2D polygon
 */
function polygonCentroid(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  let signedArea = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const factor = vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
    cx += (vertices[i].x + vertices[j].x) * factor;
    cy += (vertices[i].y + vertices[j].y) * factor;
    signedArea += factor;
  }
  signedArea /= 2.0;
  if (Math.abs(signedArea) < 1e-9) {
    // Degenerate polygon, fallback to bounding box center
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of vertices) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }
  const factor = 1.0 / (6.0 * signedArea);
  return { x: cx * factor, y: cy * factor };
}

/**
 * Validate a raw 2D drafting element conforming to CMD-1 (ReadDraftingElements)
 */
function validateDraftingElement(element) {
  if (!element || typeof element !== 'object') {
    return { valid: false, error: 'Element must be a non-null object' };
  }
  if (typeof element.guid !== 'string' || !element.guid) {
    return { valid: false, error: 'Missing or invalid element.guid' };
  }
  if (!['Line', 'PolyLine', 'Arc', 'Circle', 'Text', 'Hatch'].includes(element.type)) {
    return { valid: false, error: `Unsupported element type: ${element.type}` };
  }
  if (typeof element.layerName !== 'string') {
    return { valid: false, error: 'Missing element.layerName' };
  }
  const geom = element.geometry;
  if (!geom || typeof geom !== 'object') {
    return { valid: false, error: 'Missing element.geometry object' };
  }

  switch (element.type) {
    case 'Line':
      if (typeof geom.begX !== 'number' || typeof geom.begY !== 'number' ||
          typeof geom.endX !== 'number' || typeof geom.endY !== 'number') {
        return { valid: false, error: 'Line geometry missing begX/begY/endX/endY' };
      }
      break;
    case 'PolyLine':
    case 'Hatch':
      if (!Array.isArray(geom.vertices) || geom.vertices.length < 2) {
        return { valid: false, error: `${element.type} must have vertices array with >= 2 points` };
      }
      for (const v of geom.vertices) {
        if (typeof v.x !== 'number' || typeof v.y !== 'number') {
          return { valid: false, error: `${element.type} vertex missing x or y number` };
        }
      }
      break;
    case 'Arc':
    case 'Circle':
      if (typeof geom.centerX !== 'number' || typeof geom.centerY !== 'number' ||
          typeof geom.radius !== 'number' || geom.radius <= 0) {
        return { valid: false, error: `${element.type} missing centerX/centerY or invalid radius` };
      }
      if (element.type === 'Arc' && (typeof geom.begAng !== 'number' || typeof geom.endAng !== 'number')) {
        return { valid: false, error: 'Arc missing begAng/endAng' };
      }
      break;
    case 'Text':
      if (typeof geom.locX !== 'number' || typeof geom.locY !== 'number' ||
          typeof geom.text !== 'string') {
        return { valid: false, error: 'Text missing locX/locY or text content string' };
      }
      break;
  }

  return { valid: true };
}

/**
 * Validate a complete ReadDraftingElements response dataset
 */
function validateDraftingDataset(dataset) {
  if (!dataset || typeof dataset !== 'object') {
    return { valid: false, error: 'Dataset must be an object' };
  }
  const payload = dataset.data || dataset;
  if (payload.unit !== 'm' || payload.coordSystem !== 'archicad_world') {
    return { valid: false, error: 'Dataset must declare unit="m" and coordSystem="archicad_world"' };
  }
  if (typeof payload.sourceFingerprint !== 'string' || !payload.sourceFingerprint.startsWith('fnv64:')) {
    return { valid: false, error: 'Dataset missing valid fnv64 sourceFingerprint' };
  }
  if (!payload.originCheck || typeof payload.originCheck.isFarFromOrigin !== 'boolean') {
    return { valid: false, error: 'Dataset missing valid originCheck block' };
  }
  if (Array.isArray(payload.elements)) {
    for (let i = 0; i < payload.elements.length; i++) {
      const v = validateDraftingElement(payload.elements[i]);
      if (!v.valid) {
        return { valid: false, error: `Element at index ${i} invalid: ${v.error}` };
      }
    }
  }
  return { valid: true, payload };
}

/**
 * Pair double-line walls and synthesize centerlines with Bridge Mask for openings
 */
function reconstructWalls(wallElements, openingElements, options = {}) {
  const minThickness = options.minThickness ?? DEFAULT_MIN_WALL_THICKNESS;
  const maxThickness = options.maxThickness ?? DEFAULT_MAX_WALL_THICKNESS;
  const angleTolDeg = options.angleTolDeg ?? DEFAULT_ANGLE_TOLERANCE_DEG;
  const minOverlapRatio = options.minOverlapRatio ?? DEFAULT_OVERLAP_RATIO_MIN;

  // Convert all wall line elements into unified segment structs
  const segments = [];
  for (const el of wallElements) {
    if (el.type === 'Line') {
      segments.push({
        guid: el.guid,
        layerName: el.layerName,
        p1: { x: el.geometry.begX, y: el.geometry.begY },
        p2: { x: el.geometry.endX, y: el.geometry.endY }
      });
    } else if (el.type === 'PolyLine' && Array.isArray(el.geometry.vertices)) {
      const v = el.geometry.vertices;
      for (let i = 0; i < v.length - 1; i++) {
        segments.push({
          guid: `${el.guid}_seg_${i}`,
          parentGuid: el.guid,
          layerName: el.layerName,
          p1: { x: v[i].x, y: v[i].y },
          p2: { x: v[i + 1].x, y: v[i + 1].y }
        });
      }
    }
  }

  const pairedIndices = new Set();
  const wallCandidates = [];
  let candidateCounter = 1;

  // Step 1: Greedy parallel pair matching
  for (let i = 0; i < segments.length; i++) {
    if (pairedIndices.has(i)) continue;
    const s1 = segments[i];

    let bestPair = null;
    let bestDist = Infinity;

    for (let j = i + 1; j < segments.length; j++) {
      if (pairedIndices.has(j)) continue;
      const s2 = segments[j];

      const measure = measureParallelPair(s1, s2, angleTolDeg);
      if (!measure) continue;

      if (measure.perpendicularDistance >= minThickness &&
          measure.perpendicularDistance <= maxThickness &&
          measure.overlapRatio >= minOverlapRatio) {
        if (measure.perpendicularDistance < bestDist) {
          bestDist = measure.perpendicularDistance;
          bestPair = { index: j, measure };
        }
      }
    }

    if (bestPair) {
      pairedIndices.add(i);
      pairedIndices.add(bestPair.index);

      const s2 = segments[bestPair.index];
      const thickness = Number(bestPair.measure.perpendicularDistance.toFixed(4));

      // Calculate centerline from s1 and projected s2
      const pr1 = projectPointOntoLine(s2.p1, s1.p1, s1.p2).proj;
      const pr2 = projectPointOntoLine(s2.p2, s1.p1, s1.p2).proj;

      // Extend to full overlap span
      const minX = Math.min(s1.p1.x, s1.p2.x, pr1.x, pr2.x);
      const maxX = Math.max(s1.p1.x, s1.p2.x, pr1.x, pr2.x);
      const minY = Math.min(s1.p1.y, s1.p2.y, pr1.y, pr2.y);
      const maxY = Math.max(s1.p1.y, s1.p2.y, pr1.y, pr2.y);

      // Centerline vector
      const centerBeg = {
        x: Number(((s1.p1.x + s2.p1.x) / 2.0).toFixed(4)),
        y: Number(((s1.p1.y + s2.p1.y) / 2.0).toFixed(4))
      };
      const centerEnd = {
        x: Number(((s1.p2.x + s2.p2.x) / 2.0).toFixed(4)),
        y: Number(((s1.p2.y + s2.p2.y) / 2.0).toFixed(4))
      };
      const centerLen = distance2D(centerBeg, centerEnd);

      // Step 2: Check for door/window bridge gaps across this wall span
      const bridgeGaps = [];
      for (const op of (openingElements || [])) {
        if (op.type === 'Line') {
          const midPt = {
            x: (op.geometry.begX + op.geometry.endX) / 2,
            y: (op.geometry.begY + op.geometry.endY) / 2
          };
          const distToCenter = pointToLineDistance(midPt, centerBeg, centerEnd);
          if (distToCenter <= thickness / 2.0 + DEFAULT_SNAP_TOLERANCE) {
            const { t } = projectPointOntoLine(midPt, centerBeg, centerEnd);
            if (t >= 0.05 && t <= 0.95) {
              const opWidth = distance2D(
                { x: op.geometry.begX, y: op.geometry.begY },
                { x: op.geometry.endX, y: op.geometry.endY }
              );
              bridgeGaps.push({
                openingGuid: op.guid,
                openingType: op.layerName.toLowerCase().includes('door') || op.layerName.includes('门') ? 'door' : 'window',
                locationParamT: Number(t.toFixed(3)),
                estimatedWidth: Number(opWidth.toFixed(3))
              });
            }
          }
        }
      }

      wallCandidates.push({
        candidateId: `WALL_CANDIDATE_${candidateCounter++}`,
        fitKind: 'double_line_fitted',
        sourceGuids: [s1.guid, s2.guid],
        sourceLayer: s1.layerName,
        thickness,
        centerLine: {
          begX: centerBeg.x,
          begY: centerBeg.y,
          endX: centerEnd.x,
          endY: centerEnd.y,
          length: Number(centerLen.toFixed(4))
        },
        bridgeMask: {
          hasBridgeOpenings: bridgeGaps.length > 0,
          openings: bridgeGaps
        },
        confidence: Number((0.92 + 0.06 * bestPair.measure.overlapRatio).toFixed(2))
      });
    } else {
      // Unpaired single line -> single centerline wall candidate
      const len = distance2D(s1.p1, s1.p2);
      if (len >= 0.3) { // ignore noise shorter than 300mm
        wallCandidates.push({
          candidateId: `WALL_CANDIDATE_${candidateCounter++}`,
          fitKind: 'single_line_centerline',
          sourceGuids: [s1.guid],
          sourceLayer: s1.layerName,
          thickness: 0.20, // default standard 200mm wall
          centerLine: {
            begX: Number(s1.p1.x.toFixed(4)),
            begY: Number(s1.p1.y.toFixed(4)),
            endX: Number(s1.p2.x.toFixed(4)),
            endY: Number(s1.p2.y.toFixed(4)),
            length: Number(len.toFixed(4))
          },
          bridgeMask: {
            hasBridgeOpenings: false,
            openings: []
          },
          confidence: 0.70
        });
      }
    }
  }

  return wallCandidates;
}

/**
 * Reconstruct Column candidates from SOLID Hatch and closed polylines
 */
function reconstructColumns(columnElements, options = {}) {
  const candidates = [];
  let counter = 1;

  for (const el of columnElements) {
    if (el.type === 'Hatch' || el.type === 'PolyLine') {
      const v = el.geometry.vertices;
      if (!Array.isArray(v) || v.length < 3) continue;

      const area = Math.abs(polygonSignedArea(v));
      if (area < 0.01 || area > 25.0) continue; // between 0.1m*0.1m and 5m*5m

      const centroid = polygonCentroid(v);

      // Determine bounding box
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const pt of v) {
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
      }
      const width = Number((maxX - minX).toFixed(4));
      const depth = Number((maxY - minY).toFixed(4));
      const isRectangular = (v.length === 4 || (v.length === 5 && distance2D(v[0], v[4]) < 1e-4));

      candidates.push({
        candidateId: `COL_CANDIDATE_${counter++}`,
        sourceGuids: [el.guid],
        sourceLayer: el.layerName,
        sourceType: el.type,
        shape: isRectangular ? 'rectangular' : 'polygon',
        position: {
          x: Number(centroid.x.toFixed(4)),
          y: Number(centroid.y.toFixed(4))
        },
        dimensions: isRectangular
          ? { width, depth, area: Number(area.toFixed(4)) }
          : { polygonVertices: v.map(p => ({ x: Number(p.x.toFixed(4)), y: Number(p.y.toFixed(4)) })), area: Number(area.toFixed(4)) },
        rotationAngle: 0.0,
        confidence: el.type === 'Hatch' ? 0.98 : 0.88
      });
    } else if (el.type === 'Circle') {
      const r = el.geometry.radius;
      candidates.push({
        candidateId: `COL_CANDIDATE_${counter++}`,
        sourceGuids: [el.guid],
        sourceLayer: el.layerName,
        sourceType: 'Circle',
        shape: 'circular',
        position: {
          x: Number(el.geometry.centerX.toFixed(4)),
          y: Number(el.geometry.centerY.toFixed(4))
        },
        dimensions: {
          radius: Number(r.toFixed(4)),
          diameter: Number((2 * r).toFixed(4)),
          area: Number((Math.PI * r * r).toFixed(4))
        },
        rotationAngle: 0.0,
        confidence: 0.95
      });
    }
  }

  return candidates;
}

/**
 * Reconstruct Axis Grid candidates and correlate label text
 */
function reconstructGrids(gridElements, textElements, options = {}) {
  const candidates = [];
  let counter = 1;

  const texts = (textElements || []).map(t => ({
    guid: t.guid,
    text: t.geometry.text.trim(),
    pt: { x: t.geometry.locX, y: t.geometry.locY }
  }));

  for (const el of gridElements) {
    if (el.type === 'Line') {
      const p1 = { x: el.geometry.begX, y: el.geometry.begY };
      const p2 = { x: el.geometry.endX, y: el.geometry.endY };
      const len = distance2D(p1, p2);
      if (len < 1.0) continue; // Grid lines are long spans

      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);
      let orientation = 'skew';
      if (dy < 0.05 && dx >= 1.0) orientation = 'orthogonal_x';
      else if (dx < 0.05 && dy >= 1.0) orientation = 'orthogonal_y';

      // Find nearest text within 2.5m of either endpoint
      let matchedLabel = null;
      let matchedTextGuid = null;
      let bestDist = 2.5;

      for (const t of texts) {
        const d1 = distance2D(t.pt, p1);
        const d2 = distance2D(t.pt, p2);
        const d = Math.min(d1, d2);
        if (d < bestDist && t.text.length <= 6) { // Axis labels are typically short ("1", "A", "1-A")
          bestDist = d;
          matchedLabel = t.text;
          matchedTextGuid = t.guid;
        }
      }

      candidates.push({
        candidateId: `GRID_CANDIDATE_${counter++}`,
        sourceGuids: [el.guid],
        sourceLayer: el.layerName,
        label: matchedLabel || `Axis_${counter}`,
        labelSourceGuid: matchedTextGuid,
        orientation,
        line: {
          begX: Number(p1.x.toFixed(4)),
          begY: Number(p1.y.toFixed(4)),
          endX: Number(p2.x.toFixed(4)),
          endY: Number(p2.y.toFixed(4)),
          length: Number(len.toFixed(4))
        },
        confidence: matchedLabel ? 0.95 : 0.80
      });
    }
  }

  return candidates;
}

/**
 * Main Entry Point: Transforms raw ReadDraftingElements output into structured intermediate candidates
 */
function generateIntermediateCandidates(draftingDataset, options = {}) {
  const validation = validateDraftingDataset(draftingDataset);
  if (!validation.valid) {
    throw new Error(`Invalid drafting dataset: ${validation.error}`);
  }
  const payload = validation.payload;
  const elements = payload.elements || [];

  // Group elements by recognized layer categories
  const grouped = {
    wall: [],
    column: [],
    door: [],
    window: [],
    opening: [],
    grid: [],
    text: [],
    other: []
  };

  const layerCategoryCache = new Map();

  for (const el of elements) {
    let cat = layerCategoryCache.get(el.layerName);
    if (!cat) {
      const rec = recognizeLayerName(el.layerName);
      cat = rec.category || 'other';
      layerCategoryCache.set(el.layerName, cat);
    }
    if (el.type === 'Text') {
      grouped.text.push(el);
    }
    if (grouped[cat]) {
      grouped[cat].push(el);
    } else {
      grouped.other.push(el);
    }
  }

  const openingElements = [...grouped.door, ...grouped.window, ...grouped.opening];

  // Reconstruct candidates
  const wallCandidates = reconstructWalls(grouped.wall, openingElements, options);
  const columnCandidates = reconstructColumns(grouped.column, options);
  const gridCandidates = reconstructGrids(grouped.grid, grouped.text, options);

  // Large coordinate defense / recommended local offset
  const originCheck = payload.originCheck || {};
  const isFar = Boolean(originCheck.isFarFromOrigin);
  const recommendedOffset = originCheck.recommendedLocalOffset || { dx: 0, dy: 0 };

  const intermediateResult = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceMetadata: {
      sourceFingerprint: payload.sourceFingerprint,
      unit: payload.unit,
      coordSystem: payload.coordSystem,
      storyIndex: payload.storyIndex,
      totalRawElements: payload.totalCount,
      originCheck: {
        isFarFromOrigin: isFar,
        distanceFromOriginMeters: originCheck.distanceFromOriginMeters || 0,
        recommendedLocalOffset: recommendedOffset
      }
    },
    summary: {
      wallCandidateCount: wallCandidates.length,
      columnCandidateCount: columnCandidates.length,
      gridCandidateCount: gridCandidates.length,
      bridgedOpeningCount: wallCandidates.reduce((acc, w) => acc + w.bridgeMask.openings.length, 0)
    },
    candidates: {
      walls: wallCandidates,
      columns: columnCandidates,
      grids: gridCandidates
    }
  };

  return intermediateResult;
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_GEOM_EPSILON,
  DEFAULT_SNAP_TOLERANCE,
  DEFAULT_ANGLE_TOLERANCE_DEG,
  DEFAULT_MIN_WALL_THICKNESS,
  DEFAULT_MAX_WALL_THICKNESS,
  FAR_FROM_ORIGIN_THRESHOLD_METERS,
  // Geometric math utilities
  distance2D,
  lineAngle,
  areParallel,
  projectPointOntoLine,
  pointToLineDistance,
  measureParallelPair,
  polygonSignedArea,
  polygonCentroid,
  // Validators
  validateDraftingElement,
  validateDraftingDataset,
  // Reconstructors
  reconstructWalls,
  reconstructColumns,
  reconstructGrids,
  // Main Pipeline
  generateIntermediateCandidates
};
