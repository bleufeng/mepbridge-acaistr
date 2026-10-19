'use strict';

/**
 * SPDX-License-Identifier: MIT
 * MEPbridge ACAIstr - A/B Three-Tier Diff Detection Engine
 * Task C-INS-03 (v0.1.8 Foundation / v0.1.9 Alignment)
 *
 * Responsibilities:
 * 1. Pre-flight compatibility checks (origin, north angle, story alignment)
 * 2. Overall coordinate shift detection (detects >= 80% uniform translation and halts false add/del)
 * 3. Tier 1: Stable GUID exact match (determines unchanged / geometry_modified / property_modified / both_modified)
 * 4. Tier 2: Spatial-semantic heuristic re-matching (IoU + distance decay + property sim for redrawn elements)
 * 5. Tier 3: 1:N / N:1 topological split & merge detection (collinear wall breakdown)
 * 6. Door/Window host wall change attribution (hostWallChanged flag)
 * 7. Standardized c-ins-diff-v1 contract generation
 */

const {
  numbersClose,
  pointsClose,
  polygonsClose,
  GEOMETRY_FIELDS,
} = require('./snapshot-diff');

const DIFF_SCHEMA_VERSION = 'c-ins-diff-v1';

// Tolerance profiles (§7.4)
const TOLERANCES = {
  displacement: { ignore: 0.001, minor: 0.005 }, // 1mm, 5mm
  thickness: { ignore: 0.0005, minor: 0.002 },   // 0.5mm, 2mm
  angleDeg: { ignore: 0.05, minor: 0.20 },       // 0.05°, 0.2°
  areaSqM: { ignore: 0.001, minor: 0.01 },       // 0.001 m², 0.01 m²
  elevation: { ignore: 0.001, minor: 0.005 },    // 1mm, 5mm
};

/**
 * 2D Bounding Box Intersection over Union (IoU)
 */
function computeBBox2DIoU(b1, b2) {
  if (!b1 || !b2) return 0;
  const interMinX = Math.max(b1.minX, b2.minX);
  const interMinY = Math.max(b1.minY, b2.minY);
  const interMaxX = Math.min(b1.maxX, b2.maxX);
  const interMaxY = Math.min(b1.maxY, b2.maxY);

  if (interMaxX <= interMinX || interMaxY <= interMinY) {
    return 0;
  }

  const interArea = (interMaxX - interMinX) * (interMaxY - interMinY);
  const area1 = Math.max(0, (b1.maxX - b1.minX) * (b1.maxY - b1.minY));
  const area2 = Math.max(0, (b2.maxX - b2.minX) * (b2.maxY - b2.minY));
  const unionArea = area1 + area2 - interArea;

  return unionArea > 1e-9 ? interArea / unionArea : 0;
}

/**
 * Center point of a 2D bounding box
 */
function getBBoxCenter(b) {
  if (!b) return { x: 0, y: 0 };
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
  };
}

/**
 * Jaccard property similarity between two propertiesCanonical objects
 */
function computePropertySimilarity(propA = {}, propB = {}) {
  const keysA = Object.keys(propA);
  const keysB = Object.keys(propB);
  if (keysA.length === 0 && keysB.length === 0) return 1.0;

  const allKeys = new Set([...keysA, ...keysB]);
  let matches = 0;

  for (const k of allKeys) {
    if (propA[k] !== undefined && propB[k] !== undefined) {
      if (propA[k] === propB[k]) {
        matches++;
      } else if (typeof propA[k] === 'number' && typeof propB[k] === 'number') {
        if (numbersClose(propA[k], propB[k], TOLERANCES.thickness.ignore)) {
          matches++;
        }
      }
    }
  }

  return matches / allKeys.size;
}

/**
 * Pre-flight baseline compatibility and overall shift check (§7.1)
 */
function precheckBaseline(snapA, snapB) {
  const warnings = [];
  const srcA = snapA.sourceInstance || {};
  const srcB = snapB.sourceInstance || {};

  // 1. North angle check
  const northA = (srcA.projectLocation && srcA.projectLocation.northAngleDeg) || 0;
  const northB = (srcB.projectLocation && srcB.projectLocation.northAngleDeg) || 0;
  if (Math.abs(northA - northB) > TOLERANCES.angleDeg.ignore) {
    warnings.push(`NORTH_ANGLE_MISMATCH: A=${northA}° vs B=${northB}°`);
  }

  // 2. Project origin check
  const origA = (srcA.projectLocation && srcA.projectLocation.originOffset) || { x: 0, y: 0, z: 0 };
  const origB = (srcB.projectLocation && srcB.projectLocation.originOffset) || { x: 0, y: 0, z: 0 };
  if (!pointsClose(origA, origB, TOLERANCES.displacement.ignore)) {
    warnings.push('PROJECT_ORIGIN_MISMATCH');
  }

  // 3. Story alignment check
  const storiesA = snapA.stories || [];
  const storiesB = snapB.stories || [];
  let storyAlignment = 'exact';

  if (storiesA.length !== storiesB.length) {
    storyAlignment = 'count_mismatch';
    warnings.push(`STORY_COUNT_MISMATCH: A=${storiesA.length} vs B=${storiesB.length}`);
  } else {
    for (let i = 0; i < storiesA.length; i++) {
      if (!numbersClose(storiesA[i].elevation, storiesB[i].elevation, TOLERANCES.elevation.ignore)) {
        storyAlignment = 'elevation_offset';
        warnings.push(`STORY_ELEVATION_MISMATCH at story ${storiesA[i].index}`);
        break;
      }
    }
  }

  // 4. Overall Coordinate Shift Detection (§7.1 #3 & §11 T-INS-06)
  // Collect candidate anchor points from elements with matching GUIDs or same type order
  const elemsA = snapA.elements || [];
  const elemsB = snapB.elements || [];

  let shiftDetected = false;
  let shiftVector = null;

  if (elemsA.length >= 5 && elemsB.length >= 5) {
    const mapB = new Map(elemsB.map((e) => [e.elementGuid, e]));
    const vectors = [];

    for (const ea of elemsA) {
      const eb = mapB.get(ea.elementGuid);
      if (eb) {
        const ca = getBBoxCenter(ea.bbox2D);
        const cb = getBBoxCenter(eb.bbox2D);
        vectors.push({
          dx: cb.x - ca.x,
          dy: cb.y - ca.y,
        });
      }
    }

    if (vectors.length >= 5) {
      // Find candidate shift (median of dx, dy)
      const sortedDx = vectors.map((v) => v.dx).sort((a, b) => a - b);
      const sortedDy = vectors.map((v) => v.dy).sort((a, b) => a - b);
      const medDx = sortedDx[Math.floor(sortedDx.length / 2)];
      const medDy = sortedDy[Math.floor(sortedDy.length / 2)];
      const shiftMag = Math.hypot(medDx, medDy);

      // If median shift > 0.05m
      if (shiftMag > 0.05) {
        // Count how many vectors match the median within 0.02m
        let matchCount = 0;
        for (const v of vectors) {
          if (Math.hypot(v.dx - medDx, v.dy - medDy) <= 0.02) {
            matchCount++;
          }
        }
        const ratio = matchCount / vectors.length;
        if (ratio >= 0.80) {
          shiftDetected = true;
          shiftVector = { deltaX: medDx, deltaY: medDy, deltaZ: 0 };
        }
      }
    }
  }

  return {
    compatible: !shiftDetected,
    storyAlignment,
    coordShiftDetected: shiftDetected,
    shiftVector,
    toleranceProfile: 'archicad-bim-default-v1',
    warnings,
  };
}

/**
 * Extract specific changes between two elements
 */
function extractElementChanges(elemA, elemB) {
  const changes = [];
  const ga = elemA.geometryCanonical || {};
  const gb = elemB.geometryCanonical || {};

  // Thickness
  if (ga.thickness !== undefined && gb.thickness !== undefined) {
    const delta = Math.abs(gb.thickness - ga.thickness);
    if (delta > TOLERANCES.thickness.ignore) {
      changes.push({
        field: 'geometryCanonical.thickness',
        oldValue: ga.thickness,
        newValue: gb.thickness,
        delta: Math.round((gb.thickness - ga.thickness) * 10000) / 10000,
        unit: 'm',
        humanLabel: `厚度: ${Math.round(ga.thickness * 1000)}mm -> ${Math.round(gb.thickness * 1000)}mm`,
      });
    }
  }

  // Position / Translation
  const ca = getBBoxCenter(elemA.bbox2D);
  const cb = getBBoxCenter(elemB.bbox2D);
  const shiftDist = Math.hypot(cb.x - ca.x, cb.y - ca.y);
  if (shiftDist > TOLERANCES.displacement.ignore) {
    changes.push({
      field: 'geometryCanonical.position',
      oldValue: { x: ca.x, y: ca.y },
      newValue: { x: cb.x, y: cb.y },
      delta: Math.round(shiftDist * 10000) / 10000,
      unit: 'm',
      humanLabel: `位移: 平移 ${Math.round(shiftDist * 1000)}mm`,
    });
  }

  // Properties changes
  const pa = elemA.propertiesCanonical || {};
  const pb = elemB.propertiesCanonical || {};
  const propKeys = new Set([...Object.keys(pa), ...Object.keys(pb)]);

  for (const k of propKeys) {
    if (pa[k] !== pb[k]) {
      changes.push({
        field: `propertiesCanonical.${k}`,
        oldValue: pa[k] !== undefined ? pa[k] : null,
        newValue: pb[k] !== undefined ? pb[k] : null,
        delta: 0,
        unit: '',
        humanLabel: `属性[${k}]: ${JSON.stringify(pa[k])} -> ${JSON.stringify(pb[k])}`,
      });
    }
  }

  return changes;
}

/**
 * Three-Tier Matching Engine
 */
function compareSnapshotsAB(snapA, snapB, options = {}) {
  const sessionId = options.diffSessionId || `diff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const precheck = precheckBaseline(snapA, snapB);

  // If overall shift detected, intercept and prevent false additions/deletions (§7.1 #3 & §11 T-INS-06)
  if (precheck.coordShiftDetected) {
    return {
      schema: DIFF_SCHEMA_VERSION,
      diffSessionId: sessionId,
      baselineSnapshotId: snapA.snapshotId,
      baselineSha256: snapA.integrity ? snapA.integrity.sha256 : '',
      targetSnapshotId: snapB.snapshotId,
      targetSha256: snapB.integrity ? snapB.integrity.sha256 : '',
      precheckStatus: precheck,
      summary: {
        added: 0,
        deleted: 0,
        geometryModified: 0,
        propertyModified: 0,
        bothModified: 0,
        splitOrMergeCandidate: 0,
        uncertain: 0,
        unchanged: 0,
      },
      diffItems: [],
      warning: '检测到两文件疑似存在整体坐标偏移，已阻断虚假全量增删输出。请进入坐标对齐向导。',
    };
  }

  const elementsA = snapA.elements || [];
  const elementsB = snapB.elements || [];

  const mapA = new Map(elementsA.map((e) => [e.elementGuid, e]));
  const mapB = new Map(elementsB.map((e) => [e.elementGuid, e]));

  const diffItems = [];
  const matchedGuidsA = new Set();
  const matchedGuidsB = new Set();

  let countUnchanged = 0;
  let countGeometryModified = 0;
  let countPropertyModified = 0;
  let countBothModified = 0;
  let countSplitOrMerge = 0;
  let countUncertain = 0;

  let diffIndex = 1;
  const nextDiffId = () => `DIFF-${String(diffIndex++).padStart(4, '0')}`;

  // =========================================================================
  // Tier 1: Stable GUID Exact Match (§7.2)
  // =========================================================================
  for (const ea of elementsA) {
    const eb = mapB.get(ea.elementGuid);
    if (eb) {
      matchedGuidsA.add(ea.elementGuid);
      matchedGuidsB.add(eb.elementGuid);

      const geomMatch = ea.fingerprints.geometryHash === eb.fingerprints.geometryHash;
      const propMatch = ea.fingerprints.propertyHash === eb.fingerprints.propertyHash;

      if (geomMatch && propMatch) {
        countUnchanged++;
      } else {
        const changes = extractElementChanges(ea, eb);
        let category = 'geometry_modified';

        if (!geomMatch && !propMatch) {
          category = 'both_modified';
          countBothModified++;
        } else if (!geomMatch) {
          category = 'geometry_modified';
          countGeometryModified++;
        } else {
          category = 'property_modified';
          countPropertyModified++;
        }

        diffItems.push({
          diffId: nextDiffId(),
          storyIndex: ea.storyIndex,
          elementType: ea.elementType,
          category,
          matchTier: 'tier1_guid_exact',
          confidence: 1.0,
          hostWallChanged: false,
          sourceA: {
            elementGuid: ea.elementGuid,
            geometryHash: ea.fingerprints.geometryHash,
            propertyHash: ea.fingerprints.propertyHash,
            combinedHash: ea.fingerprints.combinedHash,
            bbox2D: ea.bbox2D,
            geometryCanonical: ea.geometryCanonical,
          },
          sourceB: {
            elementGuid: eb.elementGuid,
            geometryHash: eb.fingerprints.geometryHash,
            propertyHash: eb.fingerprints.propertyHash,
            combinedHash: eb.fingerprints.combinedHash,
            bbox2D: eb.bbox2D,
            geometryCanonical: eb.geometryCanonical,
          },
          changes,
        });
      }
    }
  }

  // Remaining pools for Tier 2 and Tier 3
  const poolA = elementsA.filter((e) => !matchedGuidsA.has(e.elementGuid));
  const poolB = elementsB.filter((e) => !matchedGuidsB.has(e.elementGuid));

  // =========================================================================
  // Tier 2: Spatial-Semantic Heuristic Re-matching (§7.2)
  // =========================================================================
  // Group by storyIndex + elementType
  const groupA = new Map();
  for (const ea of poolA) {
    const key = `${ea.storyIndex}|${ea.elementType}`;
    if (!groupA.has(key)) groupA.set(key, []);
    groupA.get(key).push(ea);
  }

  const groupB = new Map();
  for (const eb of poolB) {
    const key = `${eb.storyIndex}|${eb.elementType}`;
    if (!groupB.has(key)) groupB.set(key, []);
    groupB.get(key).push(eb);
  }

  const tier2MatchedA = new Set();
  const tier2MatchedB = new Set();

  for (const [key, itemsA] of groupA.entries()) {
    const itemsB = groupB.get(key) || [];
    if (itemsB.length === 0) continue;

    for (const ea of itemsA) {
      if (tier2MatchedA.has(ea.elementGuid)) continue;

      const scoredCandidates = [];
      const ca = getBBoxCenter(ea.bbox2D);

      for (const eb of itemsB) {
        if (tier2MatchedB.has(eb.elementGuid)) continue;

        const cb = getBBoxCenter(eb.bbox2D);
        const dist = Math.hypot(cb.x - ca.x, cb.y - ca.y);
        const iou = computeBBox2DIoU(ea.bbox2D, eb.bbox2D);
        const propSim = computePropertySimilarity(ea.propertiesCanonical, eb.propertiesCanonical);

        // Scoring Formula (§7.2): S = 0.45 * IoU + 0.35 * exp(-dist / 0.5) + 0.20 * propSim
        const distDecay = Math.exp(-dist / 0.5);
        const score = 0.45 * iou + 0.35 * distDecay + 0.20 * propSim;

        scoredCandidates.push({ candidate: eb, score });
      }

      if (scoredCandidates.length > 0) {
        scoredCandidates.sort((a, b) => b.score - a.score);
        const best = scoredCandidates[0];
        const runnerUp = scoredCandidates[1];

        // S >= 0.85 and unique best candidate (gap >= 0.15 or no runner up)
        if (best.score >= 0.85 && (!runnerUp || (best.score - runnerUp.score >= 0.15))) {
          tier2MatchedA.add(ea.elementGuid);
          tier2MatchedB.add(best.candidate.elementGuid);

          const changes = extractElementChanges(ea, best.candidate);
          countGeometryModified++;

          diffItems.push({
            diffId: nextDiffId(),
            storyIndex: ea.storyIndex,
            elementType: ea.elementType,
            category: 'geometry_modified',
            matchTier: 'tier2_spatial_heuristic',
            confidence: Math.round(best.score * 100) / 100,
            hostWallChanged: false,
            sourceA: {
              elementGuid: ea.elementGuid,
              geometryHash: ea.fingerprints.geometryHash,
              propertyHash: ea.fingerprints.propertyHash,
              combinedHash: ea.fingerprints.combinedHash,
              bbox2D: ea.bbox2D,
              geometryCanonical: ea.geometryCanonical,
            },
            sourceB: {
              elementGuid: best.candidate.elementGuid,
              geometryHash: best.candidate.fingerprints.geometryHash,
              propertyHash: best.candidate.fingerprints.propertyHash,
              combinedHash: best.candidate.fingerprints.combinedHash,
              bbox2D: best.candidate.bbox2D,
              geometryCanonical: best.candidate.geometryCanonical,
            },
            changes: [
              {
                field: 'elementGuid',
                oldValue: ea.elementGuid,
                newValue: best.candidate.elementGuid,
                delta: 0,
                unit: '',
                humanLabel: `构件原位重绘 (匹配置信度 ${Math.round(best.score * 100)}%)`,
              },
              ...changes,
            ],
          });
        } else if (best.score >= 0.55) {
          // Ambiguous candidate (0.55 <= S < 0.85 or close runner-up) -> uncertain (§7.2)
          tier2MatchedA.add(ea.elementGuid);
          tier2MatchedB.add(best.candidate.elementGuid);

          countUncertain++;
          diffItems.push({
            diffId: nextDiffId(),
            storyIndex: ea.storyIndex,
            elementType: ea.elementType,
            category: 'uncertain',
            matchTier: 'tier2_spatial_ambiguous',
            confidence: Math.round(best.score * 100) / 100,
            hostWallChanged: false,
            sourceA: {
              elementGuid: ea.elementGuid,
              geometryHash: ea.fingerprints.geometryHash,
              propertyHash: ea.fingerprints.propertyHash,
              combinedHash: ea.fingerprints.combinedHash,
              bbox2D: ea.bbox2D,
              geometryCanonical: ea.geometryCanonical,
            },
            sourceB: {
              elementGuid: best.candidate.elementGuid,
              geometryHash: best.candidate.fingerprints.geometryHash,
              propertyHash: best.candidate.fingerprints.propertyHash,
              combinedHash: best.candidate.fingerprints.combinedHash,
              bbox2D: best.candidate.bbox2D,
              geometryCanonical: best.candidate.geometryCanonical,
            },
            changes: [
              {
                field: 'uncertainMatch',
                oldValue: ea.elementGuid,
                newValue: best.candidate.elementGuid,
                delta: 0,
                unit: '',
                humanLabel: `存在相近竞争候选 (最高置信度 ${Math.round(best.score * 100)}%)，待人工复核`,
              },
            ],
          });
        }
      }
    }
  }

  // =========================================================================
  // Tier 3: 1:N / N:1 Topological Split & Merge Detection (§7.2 & §11 T-INS-05)
  // =========================================================================
  const remainingA = poolA.filter((e) => !tier2MatchedA.has(e.elementGuid));
  const remainingB = poolB.filter((e) => !tier2MatchedB.has(e.elementGuid));

  const tier3MatchedA = new Set();
  const tier3MatchedB = new Set();

  // Check 1:N split on Wall
  for (const ea of remainingA) {
    if (ea.elementType !== 'Wall' || !ea.geometryCanonical.start) continue;

    const partsB = [];
    const lenA = Math.hypot(
      ea.geometryCanonical.end.x - ea.geometryCanonical.start.x,
      ea.geometryCanonical.end.y - ea.geometryCanonical.start.y
    );

    for (const eb of remainingB) {
      if (eb.elementType !== 'Wall' || !eb.geometryCanonical.start) continue;
      if (tier3MatchedB.has(eb.elementGuid)) continue;

      // Check thickness and story match
      if (
        ea.storyIndex === eb.storyIndex &&
        numbersClose(ea.geometryCanonical.thickness, eb.geometryCanonical.thickness, TOLERANCES.thickness.ignore)
      ) {
        // Check collinearity
        const ca = getBBoxCenter(ea.bbox2D);
        const cb = getBBoxCenter(eb.bbox2D);
        const inter = computeBBox2DIoU(ea.bbox2D, eb.bbox2D);

        // If part is completely or substantially inside or collinear with wall A
        const isNearLine = Math.abs(cb.y - ca.y) < 0.15 || Math.abs(cb.x - ca.x) < 0.15;
        if (isNearLine && (inter > 0 || Math.hypot(cb.x - ca.x, cb.y - ca.y) < lenA / 2 + 0.5)) {
          partsB.push(eb);
        }
      }
    }

    if (partsB.length >= 2) {
      // 1:N Split detected!
      tier3MatchedA.add(ea.elementGuid);
      for (const p of partsB) tier3MatchedB.add(p.elementGuid);

      countSplitOrMerge++;
      diffItems.push({
        diffId: nextDiffId(),
        storyIndex: ea.storyIndex,
        elementType: ea.elementType,
        category: 'split_or_merge_candidate',
        matchTier: 'tier3_topology_split_merge',
        confidence: 0.90,
        hostWallChanged: false,
        sourceA: {
          elementGuid: ea.elementGuid,
          geometryHash: ea.fingerprints.geometryHash,
          propertyHash: ea.fingerprints.propertyHash,
          combinedHash: ea.fingerprints.combinedHash,
          bbox2D: ea.bbox2D,
          geometryCanonical: ea.geometryCanonical,
        },
        sourceB: {
          elementGuids: partsB.map((p) => p.elementGuid),
          bbox2D: {
            minX: Math.min(...partsB.map((p) => p.bbox2D.minX)),
            minY: Math.min(...partsB.map((p) => p.bbox2D.minY)),
            maxX: Math.max(...partsB.map((p) => p.bbox2D.maxX)),
            maxY: Math.max(...partsB.map((p) => p.bbox2D.maxY)),
          },
          splitPartsCount: partsB.length,
        },
        changes: [
          {
            field: 'topologySplit',
            oldValue: ea.elementGuid,
            newValue: partsB.map((p) => p.elementGuid).join(', '),
            delta: partsB.length,
            unit: 'segments',
            humanLabel: `墙体拆分: 1 段母墙被打断为 ${partsB.length} 段子墙`,
          },
        ],
      });
    }
  }

  // =========================================================================
  // Remaining Unmatched: Added and Deleted
  // =========================================================================
  const finalDeleted = remainingA.filter((e) => !tier3MatchedA.has(e.elementGuid));
  const finalAdded = remainingB.filter((e) => !tier3MatchedB.has(e.elementGuid));

  for (const ea of finalDeleted) {
    diffItems.push({
      diffId: nextDiffId(),
      storyIndex: ea.storyIndex,
      elementType: ea.elementType,
      category: 'deleted',
      matchTier: 'unmatched',
      confidence: 1.0,
      hostWallChanged: false,
      sourceA: {
        elementGuid: ea.elementGuid,
        geometryHash: ea.fingerprints.geometryHash,
        propertyHash: ea.fingerprints.propertyHash,
        combinedHash: ea.fingerprints.combinedHash,
        bbox2D: ea.bbox2D,
        geometryCanonical: ea.geometryCanonical,
      },
      sourceB: null,
      changes: [
        {
          field: 'element',
          oldValue: ea.elementGuid,
          newValue: null,
          delta: 0,
          unit: '',
          humanLabel: `构件删除 [${ea.elementType}]`,
        },
      ],
    });
  }

  for (const eb of finalAdded) {
    diffItems.push({
      diffId: nextDiffId(),
      storyIndex: eb.storyIndex,
      elementType: eb.elementType,
      category: 'added',
      matchTier: 'unmatched',
      confidence: 1.0,
      hostWallChanged: false,
      sourceA: null,
      sourceB: {
        elementGuid: eb.elementGuid,
        geometryHash: eb.fingerprints.geometryHash,
        propertyHash: eb.fingerprints.propertyHash,
        combinedHash: eb.fingerprints.combinedHash,
        bbox2D: eb.bbox2D,
        geometryCanonical: eb.geometryCanonical,
      },
      changes: [
        {
          field: 'element',
          oldValue: null,
          newValue: eb.elementGuid,
          delta: 0,
          unit: '',
          humanLabel: `构件新增 [${eb.elementType}]`,
        },
      ],
    });
  }

  // =========================================================================
  // Host Wall Change Attribution (§7.3 & §11 T-INS-11)
  // =========================================================================
  const changedWallGuids = new Set();
  for (const item of diffItems) {
    if (item.elementType === 'Wall' && item.category !== 'unchanged') {
      if (item.sourceA && item.sourceA.elementGuid) changedWallGuids.add(item.sourceA.elementGuid);
      if (item.sourceB && item.sourceB.elementGuid) changedWallGuids.add(item.sourceB.elementGuid);
    }
  }

  for (const item of diffItems) {
    if (item.elementType === 'Door' || item.elementType === 'Window') {
      const hostGuidA = item.sourceA && item.sourceA.geometryCanonical ? item.sourceA.geometryCanonical.hostWallGuid : null;
      const hostGuidB = item.sourceB && item.sourceB.geometryCanonical ? item.sourceB.geometryCanonical.hostWallGuid : null;

      if ((hostGuidA && changedWallGuids.has(hostGuidA)) || (hostGuidB && changedWallGuids.has(hostGuidB))) {
        item.hostWallChanged = true;
      }
    }
  }

  return {
    schema: DIFF_SCHEMA_VERSION,
    diffSessionId: sessionId,
    baselineSnapshotId: snapA.snapshotId,
    baselineSha256: snapA.integrity ? snapA.integrity.sha256 : '',
    targetSnapshotId: snapB.snapshotId,
    targetSha256: snapB.integrity ? snapB.integrity.sha256 : '',
    precheckStatus: precheck,
    summary: {
      added: finalAdded.length,
      deleted: finalDeleted.length,
      geometryModified: countGeometryModified,
      propertyModified: countPropertyModified,
      bothModified: countBothModified,
      splitOrMergeCandidate: countSplitOrMerge,
      uncertain: countUncertain,
      unchanged: countUnchanged,
    },
    diffItems,
  };
}

module.exports = {
  DIFF_SCHEMA_VERSION,
  TOLERANCES,
  computeBBox2DIoU,
  computePropertySimilarity,
  precheckBaseline,
  extractElementChanges,
  compareSnapshotsAB,
};
