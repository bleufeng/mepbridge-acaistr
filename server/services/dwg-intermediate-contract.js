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
 * 6. Big-coordinate / GIS origin defense & FNV-1a change detection (not an authenticity proof)
 */

const { recognizeLayerName, REVIEW_CONFIDENCE_THRESHOLD } = require('./cad-layer-recognition');

const { canonicalGuid, completeness, datasetDigest } = require('./cad-snapshot-contract');

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
  const finiteTree = value => typeof value === 'number' ? Number.isFinite(value) : value && typeof value === 'object' ? Object.values(value).every(finiteTree) : true;
  if (!finiteTree(element)) return { valid: false, error: 'Non-finite geometry' };
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
    if (payload.elements.some(e => !e || typeof e.guid !== 'string' || !e.guid) || new Set(payload.elements.map(e => e.guid)).size !== payload.elements.length)
      return { valid: false, error: 'Unique raw GUIDs required' };
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
 * Emits a merged or standalone wall candidate from an aligned span
 */
function emitMergedWall(span, pBase, uBase, outputList, candidateNum) {
  const isMerged = span.walls.length > 1;
  const repWall = span.walls[0];
  const begX = Number((pBase.x + span.sMin * uBase.x).toFixed(4));
  const begY = Number((pBase.y + span.sMin * uBase.y).toFixed(4));
  const endX = Number((pBase.x + span.sMax * uBase.x).toFixed(4));
  const endY = Number((pBase.y + span.sMax * uBase.y).toFixed(4));
  const totalLen = Number((span.sMax - span.sMin).toFixed(4));

  if (totalLen < 0.05) return; // degenerate

  // Re-normalize openings parameter T relative to the new continuous span
  const finalOpenings = [];
  const seenOpenings = new Set();
  for (const op of span.bridgedOpenings) {
    if (op.openingGuid && seenOpenings.has(op.openingGuid)) continue;
    if (op.openingGuid) seenOpenings.add(op.openingGuid);

    let t = op.locationParamT;
    if (typeof op.sLocation === 'number' && totalLen > 0) {
      t = Number(((op.sLocation - span.sMin) / totalLen).toFixed(3));
    }
    finalOpenings.push({
      openingGuid: op.openingGuid,
      openingType: op.openingType,
      locationParamT: typeof t === 'number' ? Math.max(0, Math.min(1, t)) : 0.5,
      estimatedWidth: op.estimatedWidth,
      isGapBridge: Boolean(op.isGapBridge)
    });
  }

  const allGuids = [];
  for (const w of span.walls) {
    if (Array.isArray(w.sourceGuids)) {
      allGuids.push(...w.sourceGuids);
    }
  }

  outputList.push({
    candidateId: `WALL_CANDIDATE_${candidateNum}`,
    fitKind: isMerged ? 'collinear_merged' : repWall.fitKind,
    mergedFrom: isMerged ? span.walls.map(w => w.candidateId) : undefined,
    sourceGuids: [...new Set(allGuids)],
    sourceSegments: span.walls.flatMap(w => w.sourceSegments || []),
    sourceLayer: repWall.sourceLayer,
    thickness: repWall.thickness,
    centerLine: {
      begX,
      begY,
      endX,
      endY,
      length: totalLen
    },
    bridgeMask: {
      hasBridgeOpenings: finalOpenings.length > 0,
      openings: finalOpenings
    },
    confidence: isMerged
      ? Math.min(1.0, Number((repWall.confidence + 0.03).toFixed(2)))
      : repWall.confidence,
    warnings: span.warnings || [],
    junctions: []
  });
}

/**
 * Merges collinear wall candidate segments across door/window opening gaps and adjacent touchpoints.
 * Refuses to falsely bridge gaps without openings.
 */
function mergeCollinearWalls(rawWalls = [], openingElements = [], options = {}) {
  const angleTolDeg = options.angleTolDeg ?? DEFAULT_ANGLE_TOLERANCE_DEG;
  const maxPerpDist = options.maxCollinearPerpDist ?? 0.03;
  const maxThicknessDiff = options.maxCollinearThicknessDiff ?? 0.02;
  const maxBridgeGap = options.maxBridgeGap ?? 3.5;

  if (rawWalls.length <= 1) {
    return rawWalls.map(w => ({ ...w }));
  }

  // Pre-process opening elements into midpoints and widths
  const openingsList = [];
  for (const op of (openingElements || [])) {
    if (op.type === 'Line') {
      const mid = {
        x: (op.geometry.begX + op.geometry.endX) / 2.0,
        y: (op.geometry.begY + op.geometry.endY) / 2.0
      };
      const width = distance2D(
        { x: op.geometry.begX, y: op.geometry.begY },
        { x: op.geometry.endX, y: op.geometry.endY }
      );
      const isDoor = (op.layerName || '').toLowerCase().includes('door') || (op.layerName || '').includes('门');
      openingsList.push({
        guid: op.guid,
        layerName: op.layerName,
        type: isDoor ? 'door' : 'window',
        p1: { x: op.geometry.begX, y: op.geometry.begY },
        p2: { x: op.geometry.endX, y: op.geometry.endY },
        mid,
        width
      });
    } else if (op.type === 'PolyLine' && Array.isArray(op.geometry.vertices) && op.geometry.vertices.length > 0) {
      let sumX = 0, sumY = 0;
      for (const pt of op.geometry.vertices) {
        sumX += pt.x;
        sumY += pt.y;
      }
      const mid = { x: sumX / op.geometry.vertices.length, y: sumY / op.geometry.vertices.length };
      const isDoor = (op.layerName || '').toLowerCase().includes('door') || (op.layerName || '').includes('门');
      openingsList.push({
        guid: op.guid,
        layerName: op.layerName,
        type: isDoor ? 'door' : 'window',
        mid,
        width: 1.0 // default nominal width
      });
    }
  }

  // Group walls into collinear clusters
  const clusters = [];
  const clustered = new Set();

  for (let i = 0; i < rawWalls.length; i++) {
    if (clustered.has(i)) continue;
    const w1 = rawWalls[i];
    const cluster = [w1];
    clustered.add(i);

    const l1 = {
      p1: { x: w1.centerLine.begX, y: w1.centerLine.begY },
      p2: { x: w1.centerLine.endX, y: w1.centerLine.endY }
    };

    for (let j = i + 1; j < rawWalls.length; j++) {
      if (clustered.has(j)) continue;
      const w2 = rawWalls[j];

      // Thickness check
      if (Math.abs(w1.thickness - w2.thickness) > maxThicknessDiff) continue;

      const l2 = {
        p1: { x: w2.centerLine.begX, y: w2.centerLine.begY },
        p2: { x: w2.centerLine.endX, y: w2.centerLine.endY }
      };

      if (!areParallel(l1, l2, angleTolDeg)) continue;

      // Lateral distance check
      const d1 = pointToLineDistance(l2.p1, l1.p1, l1.p2);
      const d2 = pointToLineDistance(l2.p2, l1.p1, l1.p2);
      if (d1 <= maxPerpDist && d2 <= maxPerpDist) {
        clustered.add(j);
        cluster.push(w2);
      }
    }
    clusters.push(cluster);
  }

  // Process each cluster
  const mergedWallCandidates = [];
  let candidateCounter = 1;

  for (const cluster of clusters) {
    if (cluster.length === 1) {
      mergedWallCandidates.push({
        ...cluster[0],
        candidateId: `WALL_CANDIDATE_${candidateCounter++}`,
        warnings: cluster[0].warnings || [],
        junctions: cluster[0].junctions || []
      });
      continue;
    }

    // Align all walls in the cluster along the axis of cluster[0]
    const baseWall = cluster[0];
    const pBase = { x: baseWall.centerLine.begX, y: baseWall.centerLine.begY };
    const vBase = {
      x: baseWall.centerLine.endX - baseWall.centerLine.begX,
      y: baseWall.centerLine.endY - baseWall.centerLine.begY
    };
    const baseLen = Math.hypot(vBase.x, vBase.y);
    if (baseLen < 1e-4) {
      mergedWallCandidates.push(...cluster);
      continue;
    }
    const uBase = { x: vBase.x / baseLen, y: vBase.y / baseLen };

    // Map each wall to [sMin, sMax] along uBase
    const wallSpans = cluster.map(w => {
      const s1 = (w.centerLine.begX - pBase.x) * uBase.x + (w.centerLine.begY - pBase.y) * uBase.y;
      const s2 = (w.centerLine.endX - pBase.x) * uBase.x + (w.centerLine.endY - pBase.y) * uBase.y;
      const sMin = Math.min(s1, s2);
      const sMax = Math.max(s1, s2);
      const wOpenings = (w.bridgeMask?.openings || []).map(op => {
        const sLoc = sMin + (op.locationParamT ?? 0.5) * (sMax - sMin);
        return { ...op, sLocation: sLoc };
      });
      return {
        wall: w,
        sMin,
        sMax,
        openings: wOpenings
      };
    });

    // Sort spans along the axis
    wallSpans.sort((a, b) => a.sMin - b.sMin);

    // Merge iteratively along the line
    let curSpan = {
      sMin: wallSpans[0].sMin,
      sMax: wallSpans[0].sMax,
      walls: [wallSpans[0].wall],
      bridgedOpenings: [...wallSpans[0].openings],
      warnings: [...(wallSpans[0].wall.warnings || [])]
    };

    for (let k = 1; k < wallSpans.length; k++) {
      const nextSpan = wallSpans[k];
      const gap = nextSpan.sMin - curSpan.sMax;

      if (gap <= DEFAULT_SNAP_TOLERANCE) {
        // Touching or overlapping: merge directly
        curSpan.sMax = Math.max(curSpan.sMax, nextSpan.sMax);
        curSpan.walls.push(nextSpan.wall);
        curSpan.bridgedOpenings.push(...nextSpan.openings);
      } else if (gap <= maxBridgeGap) {
        // Check for opening bridging this gap
        const gapMidS = (curSpan.sMax + nextSpan.sMin) / 2.0;
        const thickness = curSpan.walls[0].thickness;

        const matchedOpenings = openingsList.filter(op => {
          if (!op.p1 || !op.p2 || !areParallel(op, { p1: pBase, p2: { x: pBase.x + uBase.x, y: pBase.y + uBase.y } }, angleTolDeg)) return false;
          const ends = [op.p1, op.p2].map(p => (p.x - pBase.x) * uBase.x + (p.y - pBase.y) * uBase.y).sort((a,b) => a-b);
          if (Math.abs(ends[0] - curSpan.sMax) > DEFAULT_SNAP_TOLERANCE || Math.abs(ends[1] - nextSpan.sMin) > DEFAULT_SNAP_TOLERANCE) return false;
          const sOp = (op.mid.x - pBase.x) * uBase.x + (op.mid.y - pBase.y) * uBase.y;
          const perpDist = pointToLineDistance(
            op.mid,
            pBase,
            { x: pBase.x + uBase.x, y: pBase.y + uBase.y }
          );
          return (
            perpDist <= thickness / 2.0 + DEFAULT_SNAP_TOLERANCE &&
            sOp >= curSpan.sMax - DEFAULT_SNAP_TOLERANCE &&
            sOp <= nextSpan.sMin + DEFAULT_SNAP_TOLERANCE
          );
        });

        const matchedOpening = matchedOpenings.length === 1 ? matchedOpenings[0] : null;
        if (matchedOpening) {
          // Merge across the door/window gap!
          curSpan.sMax = Math.max(curSpan.sMax, nextSpan.sMax);
          curSpan.walls.push(nextSpan.wall);
          curSpan.bridgedOpenings.push(...nextSpan.openings);
          curSpan.bridgedOpenings.push({
            openingGuid: matchedOpening.guid,
            openingType: matchedOpening.type,
            sLocation: gapMidS,
            estimatedWidth: Number(matchedOpening.width.toFixed(3)),
            isGapBridge: true
          });
        } else {
          // Gap has no opening: DO NOT merge!
          curSpan.warnings.push({
            code: 'UNCONNECTED_GAP',
            message: `与后续共线墙段存在 ${gap.toFixed(2)}m 间隙且无门窗洞口标记，保留为独立断开墙体`,
            gapDistance: Number(gap.toFixed(3)),
            nextCandidateLayer: nextSpan.wall.sourceLayer
          });
          emitMergedWall(curSpan, pBase, uBase, mergedWallCandidates, candidateCounter++);
          curSpan = {
            sMin: nextSpan.sMin,
            sMax: nextSpan.sMax,
            walls: [nextSpan.wall],
            bridgedOpenings: [...nextSpan.openings],
            warnings: [...(nextSpan.wall.warnings || [])]
          };
        }
      } else {
        // Gap > maxBridgeGap: distinctly separate walls
        emitMergedWall(curSpan, pBase, uBase, mergedWallCandidates, candidateCounter++);
        curSpan = {
          sMin: nextSpan.sMin,
          sMax: nextSpan.sMax,
          walls: [nextSpan.wall],
          bridgedOpenings: [...nextSpan.openings],
          warnings: [...(nextSpan.wall.warnings || [])]
        };
      }
    }
    emitMergedWall(curSpan, pBase, uBase, mergedWallCandidates, candidateCounter++);
  }

  return mergedWallCandidates;
}

/**
 * Resolves L-junctions and T-junctions between intersecting wall centerlines,
 * extending/trimming endpoints to cleanly meet at true corners.
 */
function resolveWallCornerJunctions(walls = [], options = {}) {
  const cornerSnapTol = options.cornerSnapTol ?? 0.35;
  const tJunctionTol = options.tJunctionTol ?? 0.30;

  for (let i = 0; i < walls.length; i++) {
    const w1 = walls[i];
    if (!w1.junctions) w1.junctions = [];

    for (let j = i + 1; j < walls.length; j++) {
      const w2 = walls[j];
      if (!w2.junctions) w2.junctions = [];

      const p1Beg = { x: w1.centerLine.begX, y: w1.centerLine.begY };
      const p1End = { x: w1.centerLine.endX, y: w1.centerLine.endY };
      const p2Beg = { x: w2.centerLine.begX, y: w2.centerLine.begY };
      const p2End = { x: w2.centerLine.endX, y: w2.centerLine.endY };

      // Skip parallel or nearly parallel walls
      if (areParallel({ p1: p1Beg, p2: p1End }, { p1: p2Beg, p2: p2End }, 15.0)) {
        continue;
      }

      // Check L-junction: 4 endpoint pairs
      const epPairs = [
        { ep1: 'beg', p1: p1Beg, ep2: 'beg', p2: p2Beg },
        { ep1: 'beg', p1: p1Beg, ep2: 'end', p2: p2End },
        { ep1: 'end', p1: p1End, ep2: 'beg', p2: p2Beg },
        { ep1: 'end', p1: p1End, ep2: 'end', p2: p2End }
      ];

      let lCornerFound = false;
      for (const pair of epPairs) {
        const dist = distance2D(pair.p1, pair.p2);
        const maxSnap = Math.max(w1.thickness, w2.thickness) + 0.12;
        if (dist <= maxSnap) {
          const pInt = intersectInfiniteLines(p1Beg, p1End, p2Beg, p2End);
          if (pInt) {
            const dInt1 = distance2D(pair.p1, pInt);
            const dInt2 = distance2D(pair.p2, pInt);
            if (dInt1 <= cornerSnapTol + 0.1 && dInt2 <= cornerSnapTol + 0.1) {
              if (pair.ep1 === 'beg') {
                w1.centerLine.begX = pInt.x;
                w1.centerLine.begY = pInt.y;
              } else {
                w1.centerLine.endX = pInt.x;
                w1.centerLine.endY = pInt.y;
              }
              w1.centerLine.length = Number(distance2D(
                { x: w1.centerLine.begX, y: w1.centerLine.begY },
                { x: w1.centerLine.endX, y: w1.centerLine.endY }
              ).toFixed(4));

              if (pair.ep2 === 'beg') {
                w2.centerLine.begX = pInt.x;
                w2.centerLine.begY = pInt.y;
              } else {
                w2.centerLine.endX = pInt.x;
                w2.centerLine.endY = pInt.y;
              }
              w2.centerLine.length = Number(distance2D(
                { x: w2.centerLine.begX, y: w2.centerLine.begY },
                { x: w2.centerLine.endX, y: w2.centerLine.endY }
              ).toFixed(4));

              if (!w1.junctions.some(j => j.connectedCandidateId === w2.candidateId)) {
                w1.junctions.push({
                  type: 'L_junction',
                  point: { x: pInt.x, y: pInt.y },
                  connectedCandidateId: w2.candidateId
                });
              }
              if (!w2.junctions.some(j => j.connectedCandidateId === w1.candidateId)) {
                w2.junctions.push({
                  type: 'L_junction',
                  point: { x: pInt.x, y: pInt.y },
                  connectedCandidateId: w1.candidateId
                });
              }

              lCornerFound = true;
              break;
            }
          }
        }
      }

      if (lCornerFound) continue;

      // Check T-junction: w1 endpoint abutting w2 body
      const w1Eps = [
        { name: 'beg', pt: { x: w1.centerLine.begX, y: w1.centerLine.begY } },
        { name: 'end', pt: { x: w1.centerLine.endX, y: w1.centerLine.endY } }
      ];

      for (const ep of w1Eps) {
        const proj = projectPointOntoLine(ep.pt, p2Beg, p2End);
        if (proj.t >= 0.05 && proj.t <= 0.95) {
          const dist = distance2D(ep.pt, proj.proj);
          const maxTDist = w1.thickness / 2.0 + 0.15;
          if (dist <= maxTDist && dist <= tJunctionTol) {
            if (ep.name === 'beg') {
              w1.centerLine.begX = Number(proj.proj.x.toFixed(4));
              w1.centerLine.begY = Number(proj.proj.y.toFixed(4));
            } else {
              w1.centerLine.endX = Number(proj.proj.x.toFixed(4));
              w1.centerLine.endY = Number(proj.proj.y.toFixed(4));
            }
            w1.centerLine.length = Number(distance2D(
              { x: w1.centerLine.begX, y: w1.centerLine.begY },
              { x: w1.centerLine.endX, y: w1.centerLine.endY }
            ).toFixed(4));

            if (!w1.junctions.some(j => j.connectedCandidateId === w2.candidateId && j.type === 'T_junction')) {
              w1.junctions.push({
                type: 'T_junction',
                role: 'branch',
                point: { x: Number(proj.proj.x.toFixed(4)), y: Number(proj.proj.y.toFixed(4)) },
                connectedCandidateId: w2.candidateId
              });
            }
            if (!w2.junctions.some(j => j.connectedCandidateId === w1.candidateId && j.type === 'T_junction')) {
              w2.junctions.push({
                type: 'T_junction',
                role: 'trunk',
                point: { x: Number(proj.proj.x.toFixed(4)), y: Number(proj.proj.y.toFixed(4)) },
                connectedCandidateId: w1.candidateId
              });
            }
            break;
          }
        }
      }

      // Check T-junction: w2 endpoint abutting w1 body
      const w2Eps = [
        { name: 'beg', pt: { x: w2.centerLine.begX, y: w2.centerLine.begY } },
        { name: 'end', pt: { x: w2.centerLine.endX, y: w2.centerLine.endY } }
      ];

      for (const ep of w2Eps) {
        const proj = projectPointOntoLine(ep.pt, p1Beg, p1End);
        if (proj.t >= 0.05 && proj.t <= 0.95) {
          const dist = distance2D(ep.pt, proj.proj);
          const maxTDist = w2.thickness / 2.0 + 0.15;
          if (dist <= maxTDist && dist <= tJunctionTol) {
            if (ep.name === 'beg') {
              w2.centerLine.begX = Number(proj.proj.x.toFixed(4));
              w2.centerLine.begY = Number(proj.proj.y.toFixed(4));
            } else {
              w2.centerLine.endX = Number(proj.proj.x.toFixed(4));
              w2.centerLine.endY = Number(proj.proj.y.toFixed(4));
            }
            w2.centerLine.length = Number(distance2D(
              { x: w2.centerLine.begX, y: w2.centerLine.begY },
              { x: w2.centerLine.endX, y: w2.centerLine.endY }
            ).toFixed(4));

            if (!w2.junctions.some(j => j.connectedCandidateId === w1.candidateId && j.type === 'T_junction')) {
              w2.junctions.push({
                type: 'T_junction',
                role: 'branch',
                point: { x: Number(proj.proj.x.toFixed(4)), y: Number(proj.proj.y.toFixed(4)) },
                connectedCandidateId: w1.candidateId
              });
            }
            if (!w1.junctions.some(j => j.connectedCandidateId === w2.candidateId && j.type === 'T_junction')) {
              w1.junctions.push({
                type: 'T_junction',
                role: 'trunk',
                point: { x: Number(proj.proj.x.toFixed(4)), y: Number(proj.proj.y.toFixed(4)) },
                connectedCandidateId: w2.candidateId
              });
            }
            break;
          }
        }
      }
    }
  }

  return walls;
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
          segmentIndex: i,
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

      // Direction normalization: ensure s2 runs in the same orientation as s1
      const v1 = { x: s1.p2.x - s1.p1.x, y: s1.p2.y - s1.p1.y };
      let s2Norm = { p1: { ...s2.p1 }, p2: { ...s2.p2 } };
      const v2 = { x: s2.p2.x - s2.p1.x, y: s2.p2.y - s2.p1.y };
      const dot = v1.x * v2.x + v1.y * v2.y;
      if (dot < 0) {
        // Invert s2 endpoints so both point in the same direction
        s2Norm = { p1: { ...s2.p2 }, p2: { ...s2.p1 } };
      }

      // Calculate centerline from normalized projection overlap interval
      const { overlapStartT, overlapEndT } = bestPair.measure;
      const q1Start = {
        x: s1.p1.x + overlapStartT * v1.x,
        y: s1.p1.y + overlapStartT * v1.y
      };
      const q1End = {
        x: s1.p1.x + overlapEndT * v1.x,
        y: s1.p1.y + overlapEndT * v1.y
      };

      const q2Start = projectPointOntoLine(q1Start, s2Norm.p1, s2Norm.p2).proj;
      const q2End = projectPointOntoLine(q1End, s2Norm.p1, s2Norm.p2).proj;

      const centerBeg = {
        x: Number(((q1Start.x + q2Start.x) / 2.0).toFixed(4)),
        y: Number(((q1Start.y + q2Start.y) / 2.0).toFixed(4))
      };
      const centerEnd = {
        x: Number(((q1End.x + q2End.x) / 2.0).toFixed(4)),
        y: Number(((q1End.y + q2End.y) / 2.0).toFixed(4))
      };
      const centerLen = distance2D(centerBeg, centerEnd);

      // Reject zero-length or degenerate centerlines (< 100mm)
      if (centerLen < 0.1) {
        continue;
      }

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
        sourceGuids: [...new Set([s1.parentGuid || s1.guid, s2.parentGuid || s2.guid])],
        sourceSegments: [s1, s2].map(s => ({ rawGuid: s.parentGuid || s.guid, segmentId: s.guid, segmentIndex: s.segmentIndex ?? null })),
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
    } else if (options.allowSingleLineWalls === true) {
      // Unpaired single line -> single centerline wall candidate (only when explicitly enabled)
      const len = distance2D(s1.p1, s1.p2);
      if (len >= 0.5) { // ignore noise shorter than 500mm
        wallCandidates.push({
          candidateId: `WALL_CANDIDATE_${candidateCounter++}`,
          fitKind: 'single_line_centerline',
          sourceGuids: [s1.parentGuid || s1.guid],
          sourceSegments: [{ rawGuid: s1.parentGuid || s1.guid, segmentId: s1.guid, segmentIndex: s1.segmentIndex ?? null }],
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
          confidence: 0.65
        });
      }
    }
  }

  // Step 2: Collinear wall merging across door/window openings and touch points
  let finalWalls = wallCandidates;
  if (options.enableCollinearMerge !== false) {
    finalWalls = mergeCollinearWalls(finalWalls, openingElements, options);
  }

  // Step 3: Corner L-junction and T-junction resolution
  if (options.enableCornerJunctions !== false) {
    finalWalls = resolveWallCornerJunctions(finalWalls, options);
  }

  // Step 4: Structured parameter attribution & warning flags
  for (const w of finalWalls) {
    if (!w.parameters) {
      const thickness = w.thickness || 0.20;
      const height = options.defaultHeight ?? 2.8;
      const floorIndex = options.storyIndex ?? options.sourceStoryIndex ?? null;
      const targetLayer = options.targetWallLayer ?? null;

      w.parameters = {
        thickness: { value: thickness, source: 'geometry_double_line' },
        height: { value: height, source: options.defaultHeight !== undefined ? 'user_override' : 'platform_default' },
        floorIndex: { value: floorIndex, source: options.storyIndex !== undefined ? 'user_target_story' : floorIndex !== null ? 'source_story' : 'unresolved' },
        refLinePosition: { value: 'center', source: 'standard_center' },
        refLineOffset: { value: 0.0, source: 'standard_zero' },
        sourceLayer: { value: w.sourceLayer || 'WALL', source: 'cad_source_layer' },
        targetLayer: { value: targetLayer, source: targetLayer ? 'unsupported_requested_layer' : 'native_default_uncontrolled' }
      };
    }
    if (!Array.isArray(w.warnings)) {
      w.warnings = [];
    }
    if (w.thickness < 0.08 || w.thickness > 0.80) {
      if (!w.warnings.some(warn => warn.code === 'ATYPICAL_THICKNESS')) {
        w.warnings.push({
          code: 'ATYPICAL_THICKNESS',
          message: `Wall thickness ${w.thickness}m is outside standard architectural range [0.08m, 0.80m]`
        });
      }
    }
    if (!Array.isArray(w.junctions)) {
      w.junctions = [];
    }
  }

  return finalWalls;
}

/**
 * Analyze closed 4-vertex polygon to detect rectangle and extract local width, depth, rotation
 */
function analyzeRectangleVertices(vertices) {
  if (!Array.isArray(vertices)) return null;
  const pts = (vertices.length === 5 && distance2D(vertices[0], vertices[4]) < 1e-4)
    ? vertices.slice(0, 4)
    : (vertices.length === 4 ? vertices : null);
  if (!pts) return null;

  const e0 = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
  const e1 = { x: pts[2].x - pts[1].x, y: pts[2].y - pts[1].y };
  const e2 = { x: pts[3].x - pts[2].x, y: pts[3].y - pts[2].y };
  const e3 = { x: pts[0].x - pts[3].x, y: pts[0].y - pts[3].y };

  const l0 = Math.hypot(e0.x, e0.y);
  const l1 = Math.hypot(e1.x, e1.y);
  const l2 = Math.hypot(e2.x, e2.y);
  const l3 = Math.hypot(e3.x, e3.y);

  if (l0 < 1e-4 || l1 < 1e-4) return null;

  // Opposite edges must be approximately equal (< 5mm)
  if (Math.abs(l0 - l2) > 0.005 || Math.abs(l1 - l3) > 0.005) {
    return null;
  }

  // Adjacent edges must be perpendicular (|cos theta| <= sin(3 deg) ~ 0.052)
  const dot01 = (e0.x * e1.x + e0.y * e1.y) / (l0 * l1);
  if (Math.abs(dot01) > 0.06) {
    return null;
  }

  // Angle of edge 0 in radians
  let angle = Math.atan2(e0.y, e0.x);
  // Normalize angle to [-PI/4, PI/4] to orient width along principal axis
  let width = l0;
  let depth = l1;
  while (angle <= -Math.PI / 4) {
    angle += Math.PI / 2;
    const tmp = width; width = depth; depth = tmp;
  }
  while (angle > Math.PI / 4) {
    angle -= Math.PI / 2;
    const tmp = width; width = depth; depth = tmp;
  }

  const rotationDeg = Number(((angle * 180.0) / Math.PI).toFixed(2));

  return {
    isRectangular: true,
    width: Number(width.toFixed(4)),
    depth: Number(depth.toFixed(4)),
    rotationAngleRad: Number(angle.toFixed(4)),
    rotationAngleDeg: rotationDeg
  };
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

      // Analyze local rectangle orientation vs world AABB
      const rectAnalysis = analyzeRectangleVertices(v);
      const isRectangular = Boolean(rectAnalysis && rectAnalysis.isRectangular);
      const width = isRectangular ? rectAnalysis.width : Number((maxX - minX).toFixed(4));
      const depth = isRectangular ? rectAnalysis.depth : Number((maxY - minY).toFixed(4));
      const rotAngleRad = isRectangular ? rectAnalysis.rotationAngleRad : 0.0;
      const rotAngleDeg = isRectangular ? rectAnalysis.rotationAngleDeg : 0.0;

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
        rotationAngle: rotAngleRad,
        rotationAngleDeg: rotAngleDeg,
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
        rotationAngleDeg: 0.0,
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
 * Intersect two 2D line segments with small endpoint tolerance
 */
function intersectLineSegments(p1, p2, p3, p4, tolerance = 0.05) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;

  const det = d1x * d2y - d1y * d2x;
  if (Math.abs(det) < 1e-8) {
    return null; // Parallel or collinear
  }

  const dx = p3.x - p1.x;
  const dy = p3.y - p1.y;

  const t = (dx * d2y - dy * d2x) / det;
  const u = (dx * d1y - dy * d1x) / det;

  // Check if intersection lies within segment bounds (with tolerance margin)
  const len1 = Math.hypot(d1x, d1y), len2 = Math.hypot(d2x, d2y);
  if (!Number.isFinite(tolerance) || tolerance < 0 || len1 < 1e-8 || len2 < 1e-8) return null;
  const tol1 = tolerance / len1, tol2 = tolerance / len2;
  if (t >= -tol1 && t <= 1 + tol1 && u >= -tol2 && u <= 1 + tol2) {
    return {
      x: Number((p1.x + t * d1x).toFixed(4)),
      y: Number((p1.y + t * d1y).toFixed(4)),
      t: Number(t.toFixed(4)),
      u: Number(u.toFixed(4))
    };
  }
  return null;
}

/**
 * Intersect two infinite 2D lines defined by points (p1, p2) and (p3, p4)
 */
function intersectInfiniteLines(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;

  const det = d1x * d2y - d1y * d2x;
  if (Math.abs(det) < 1e-8) {
    return null; // Parallel or collinear
  }

  const dx = p3.x - p1.x;
  const dy = p3.y - p1.y;

  const t = (dx * d2y - dy * d2x) / det;
  const u = (dx * d1y - dy * d1x) / det;

  return {
    x: Number((p1.x + t * d1x).toFixed(4)),
    y: Number((p1.y + t * d1y).toFixed(4)),
    t: Number(t.toFixed(4)),
    u: Number(u.toFixed(4))
  };
}

/**
 * Solves all pairwise grid intersections and synthesizes joint labels (e.g. "1/A")
 */
function solveGridIntersections(gridCandidates = [], options = {}) {
  const intersections = [];
  let counter = 1;

  for (let i = 0; i < gridCandidates.length; i++) {
    const g1 = gridCandidates[i];
    const p1 = { x: g1.line.begX, y: g1.line.begY };
    const p2 = { x: g1.line.endX, y: g1.line.endY };

    for (let j = i + 1; j < gridCandidates.length; j++) {
      const g2 = gridCandidates[j];
      const p3 = { x: g2.line.begX, y: g2.line.begY };
      const p4 = { x: g2.line.endX, y: g2.line.endY };

      const pt = intersectLineSegments(p1, p2, p3, p4);
      if (pt) {
        // Label format: prefer orthogonal order (X-axis number first, Y-axis letter second)
        let label = `${g1.label} x ${g2.label}`;
        if (g1.orientation === 'orthogonal_x' && g2.orientation === 'orthogonal_y') {
          label = `${g1.label}/${g2.label}`;
        } else if (g1.orientation === 'orthogonal_y' && g2.orientation === 'orthogonal_x') {
          label = `${g2.label}/${g1.label}`;
        }

        intersections.push({
          intersectionId: `GRID_INT_${counter++}`,
          label,
          position: { x: pt.x, y: pt.y },
          grid1: { candidateId: g1.candidateId, label: g1.label, orientation: g1.orientation },
          grid2: { candidateId: g2.candidateId, label: g2.label, orientation: g2.orientation },
          hasColumnOutline: false,
          correlatedColumnId: null
        });
      }
    }
  }

  return intersections;
}

/**
 * Dual-path column-grid correlation (S4 C-CAD-06):
 * 1. Associates column outlines with nearest grid intersection, calculating eccentricity (dx, dy).
 * 2. Collects unoccupied grid intersections for user-selected column generation.
 */
function correlateColumnsWithGrids(columnCandidates = [], gridIntersections = [], options = {}) {
  const snapDist = options.gridSnapDistance ?? 1.5; // Max 1.5m snap radius for axis intersection
  const centerTol = options.centeringTolerance ?? 0.02; // 20mm centering tolerance

  const occupiedSet = new Set();
  const correlatedColumns = [];

  for (const col of columnCandidates) {
    let bestInt = null;
    let bestDist = Infinity;

    for (const gi of gridIntersections) {
      const d = distance2D(col.position, gi.position);
      if (d <= snapDist && d < bestDist) {
        bestDist = d;
        bestInt = gi;
      }
    }

    if (bestInt) {
      const dx = Number((col.position.x - bestInt.position.x).toFixed(4));
      const dy = Number((col.position.y - bestInt.position.y).toFixed(4));
      const isCentered = Math.abs(dx) <= centerTol && Math.abs(dy) <= centerTol;

      bestInt.hasColumnOutline = true;
      bestInt.correlatedColumnId = col.candidateId;
      occupiedSet.add(bestInt.intersectionId);

      correlatedColumns.push({
        ...col,
        gridAssociation: {
          intersectionId: bestInt.intersectionId,
          label: bestInt.label,
          distance: Number(bestDist.toFixed(4)),
          isCentered,
          eccentricity: { dx, dy }
        },
        confidence: Math.min(1.0, Number((col.confidence + 0.02).toFixed(2)))
      });
    } else {
      correlatedColumns.push({
        ...col,
        gridAssociation: null
      });
    }
  }

  const unoccupiedIntersections = gridIntersections.filter(gi => !occupiedSet.has(gi.intersectionId));

  return {
    correlatedColumns,
    gridIntersections,
    unoccupiedIntersections
  };
}

/**
 * Helper to build confirmed use lookup map from confirmed mapping entries
 */
function buildConfirmedUseLookup(confirmedMapping) {
  if (!confirmedMapping) return null;
  const entries = Array.isArray(confirmedMapping)
    ? confirmedMapping
    : (Array.isArray(confirmedMapping.entries) ? confirmedMapping.entries : null);
  if (!entries || confirmedMapping.deleted) return null;

  const map = new Map();
  for (const entry of entries) {
    if (!entry) continue;
    const use = entry.confirmedUse;
    if (use) {
      if (entry.status === 'pending' || entry.reviewRequired === true) continue;
      const guid = canonicalGuid(entry.guid || (entry.layerKey || '').replace(/^guid:/i, ''));
      if (guid) map.set('guid:' + guid, use);
    }
  }
  return map;
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
  const completenessResult = completeness(payload);
  if (!completenessResult.complete) throw new Error('FULL_DATASET_REQUIRED: summary or paginated datasets cannot generate complete candidates');
  const elements = payload.elements;
  const sourceStories = [...new Set(elements.map(e => e.storyIndex ?? payload.storyIndex).filter(Number.isInteger))];
  if (sourceStories.length > 1) throw new Error('MULTI_STORY_DATASET: preview one source story at a time');
  options = { ...options, sourceStoryIndex: sourceStories[0] ?? payload.storyIndex };

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
  const confirmedMap = buildConfirmedUseLookup(options.confirmedMapping);
  const matchedConfirmedLayers = new Set();
  const unresolvedLayers = new Set();
  const inventory = options.layerInventory || payload.layerInventory || [];

  for (const el of elements) {
    let cat = null;
    const rawLayerName = String(el.layerName || '').trim();
    const normLayerName = rawLayerName.toLowerCase();
    const layers = inventory.filter(l => String(l.name).trim() === rawLayerName);
    const layerGuid = layers.length === 1 ? canonicalGuid(layers[0].guid) : '';
    const normLayerKey = layerGuid ? 'guid:' + layerGuid : null;

    if (confirmedMap) {
      const confirmedUse = normLayerKey ? confirmedMap.get(normLayerKey) : null;
      if (!confirmedUse) { unresolvedLayers.add(rawLayerName); continue; }
      if (confirmedUse) {
        matchedConfirmedLayers.add(normLayerName);
        if (confirmedUse === 'ignore') {
          // Explicitly ignored by user - skip this element
          continue;
        }
        if (['wall', 'column', 'door', 'window', 'opening', 'grid', 'text'].includes(confirmedUse)) {
          cat = confirmedUse;
        } else {
          cat = 'other';
        }
      }
    }

    if (!cat) {
      let cached = layerCategoryCache.get(el.layerName);
      if (!cached) {
        const rec = recognizeLayerName(el.layerName);
        cached = rec.category || 'other';
        layerCategoryCache.set(el.layerName, cached);
      }
      cat = cached;
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

  // S4 Axis-assisted column correlation & intersection solving (C-CAD-06)
  const gridIntersections = solveGridIntersections(gridCandidates, options);
  const { correlatedColumns, unoccupiedIntersections } = correlateColumnsWithGrids(columnCandidates, gridIntersections, options);

  // Include supporting evidence in raw lineage, never synthetic segment IDs.
  for (const c of [...wallCandidates, ...correlatedColumns, ...gridCandidates]) {
    c.sourceGuids = [...new Set([...(c.sourceGuids || []), ...(c.labelSourceGuid ? [c.labelSourceGuid] : []), ...(c.bridgeMask?.openings || []).map(o => o.openingGuid).filter(Boolean)])];
  }
  // Large coordinate defense / recommended local offset
  const originCheck = payload.originCheck || {};
  const isFar = Boolean(originCheck.isFarFromOrigin);
  const recommendedOffset = originCheck.recommendedLocalOffset || { dx: 0, dy: 0 };

  const intermediateResult = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceMetadata: {
      sourceFingerprint: payload.sourceFingerprint,
      datasetDigest: datasetDigest(payload),
      completeness: completenessResult,
      unresolvedLayers: [...unresolvedLayers],
      mappingRevision: options.confirmedMapping?.mappingRevision ?? null,
      targetStoryIndex: options.storyIndex ?? options.sourceStoryIndex ?? null,
      unit: payload.unit,
      coordSystem: payload.coordSystem,
      storyIndex: payload.storyIndex,
      totalRawElements: payload.totalCount,
      mappingApplied: Boolean(confirmedMap && matchedConfirmedLayers.size > 0),
      confirmedLayersCount: matchedConfirmedLayers.size,
      originCheck: {
        isFarFromOrigin: isFar,
        distanceFromOriginMeters: originCheck.distanceFromOriginMeters || 0,
        recommendedLocalOffset: recommendedOffset
      }
    },
    summary: {
      wallCandidateCount: wallCandidates.length,
      columnCandidateCount: correlatedColumns.length,
      gridCandidateCount: gridCandidates.length,
      gridIntersectionCount: gridIntersections.length,
      correlatedColumnCount: correlatedColumns.filter(c => c.gridAssociation).length,
      unoccupiedIntersectionCount: unoccupiedIntersections.length,
      bridgedOpeningCount: wallCandidates.reduce((acc, w) => acc + (w.bridgeMask?.openings?.length || 0), 0),
      mergedWallCount: wallCandidates.filter(w => w.fitKind === 'collinear_merged').length,
      resolvedJunctionCount: wallCandidates.reduce((acc, w) => acc + (w.junctions?.length || 0), 0)
    },
    candidates: {
      walls: wallCandidates,
      columns: correlatedColumns,
      grids: gridCandidates,
      gridIntersections,
      unoccupiedIntersections
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
  analyzeRectangleVertices,
  intersectLineSegments,
  intersectInfiniteLines,
  // S3 Wall Enhancement Algorithms
  mergeCollinearWalls,
  resolveWallCornerJunctions,
  // Validators
  validateDraftingElement,
  validateDraftingDataset,
  // Reconstructors
  reconstructWalls,
  reconstructColumns,
  reconstructGrids,
  solveGridIntersections,
  correlateColumnsWithGrids,
  // Main Pipeline
  generateIntermediateCandidates
};
