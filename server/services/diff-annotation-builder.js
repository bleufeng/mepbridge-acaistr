'use strict';

/**
 * SPDX-License-Identifier: MIT
 * MEPbridge ACAIstr - Revision Cloud & Visual Annotation Builder
 * Task C-INS-04 (v0.1.8 Foundation / v0.1.9 Alignment)
 *
 * Responsibilities:
 * 1. Automatic revision cloud bounding box expansion (margin p = max(0.3m, 0.15*min(W,H)))
 * 2. Revision cloud convex arc generation (adaptive chord length in [0.25m, 0.60m])
 * 3. Ghost overlays: A ghost dashed contour + B solid contour
 * 4. Spatial clustering: merges adjacent items (< 0.50m) into ClusterCloud
 * 5. Architectural callout tags, style presets and leader lines
 */

const STYLE_PRESETS = {
  added: 'cloud_add_green',
  deleted: 'cloud_del_red',
  geometry_modified: 'cloud_modify_amber',
  property_modified: 'cloud_prop_blue',
  split_or_merge_candidate: 'cloud_uncertain_magenta',
  uncertain: 'cloud_uncertain_magenta',
};

const CATEGORY_LABELS = {
  added: '+新增',
  deleted: '-删除',
  geometry_modified: '~几何',
  property_modified: '@属性',
  both_modified: '~几何+属性',
  split_or_merge_candidate: '?拆分合并',
  uncertain: '?待核',
};

/**
 * Calculate distance between two 2D bounding boxes (0 if overlapping)
 */
function bboxDistance2D(b1, b2) {
  const dx = Math.max(0, b1.minX - b2.maxX, b2.minX - b1.maxX);
  const dy = Math.max(0, b1.minY - b2.maxY, b2.minY - b1.maxY);
  return Math.hypot(dx, dy);
}

/**
 * Extract 2D contour vertices from an element geometry
 */
function extractElementContour(sourceElem) {
  if (!sourceElem) return null;
  const geom = sourceElem.geometryCanonical || {};
  const bbox = sourceElem.bbox2D;

  if (geom.polygon && Array.isArray(geom.polygon)) {
    return geom.polygon.map((p) => [p.x, p.y]);
  }

  if (geom.start && geom.end) {
    const s = geom.start;
    const e = geom.end;
    const thick = Number(geom.thickness || geom.width || 0.24);
    const half = thick / 2;
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    const len = Math.hypot(dx, dy);

    if (len > 1e-6) {
      const nx = (-dy / len) * half;
      const ny = (dx / len) * half;
      return [
        [Math.round((s.x + nx) * 10000) / 10000, Math.round((s.y + ny) * 10000) / 10000],
        [Math.round((e.x + nx) * 10000) / 10000, Math.round((e.y + ny) * 10000) / 10000],
        [Math.round((e.x - nx) * 10000) / 10000, Math.round((e.y - ny) * 10000) / 10000],
        [Math.round((s.x - nx) * 10000) / 10000, Math.round((s.y - ny) * 10000) / 10000],
      ];
    }
  }

  // Fallback to bounding box rectangle
  if (bbox) {
    return [
      [bbox.minX, bbox.minY],
      [bbox.maxX, bbox.minY],
      [bbox.maxX, bbox.maxY],
      [bbox.minX, bbox.maxY],
    ];
  }

  return null;
}

/**
 * Compute expanded cloud bounding box (§8.1)
 * p = max(0.30m, 0.15 * min(W, H))
 */
function computeCloudBBox(bboxList) {
  if (!Array.isArray(bboxList) || bboxList.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const b of bboxList) {
    if (b) {
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
  }

  const w = Math.max(0.1, maxX - minX);
  const h = Math.max(0.1, maxY - minY);
  const p = Math.max(0.30, 0.15 * Math.min(w, h));

  return {
    minX: Math.round((minX - p) * 10000) / 10000,
    minY: Math.round((minY - p) * 10000) / 10000,
    maxX: Math.round((maxX + p) * 10000) / 10000,
    maxY: Math.round((maxY + p) * 10000) / 10000,
  };
}

/**
 * Generate revision cloud arcs around bounding box (§8.1 #2)
 */
function generateCloudArcs(cloudBBox, targetChord = 0.40) {
  const chord = Math.min(0.60, Math.max(0.25, targetChord));
  const arcs = [];
  const edges = [
    // Bottom edge: (minX, minY) -> (maxX, minY)
    { from: { x: cloudBBox.minX, y: cloudBBox.minY }, to: { x: cloudBBox.maxX, y: cloudBBox.minY }, normal: { x: 0, y: -1 } },
    // Right edge: (maxX, minY) -> (maxX, maxY)
    { from: { x: cloudBBox.maxX, y: cloudBBox.minY }, to: { x: cloudBBox.maxX, y: cloudBBox.maxY }, normal: { x: 1, y: 0 } },
    // Top edge: (maxX, maxY) -> (minX, maxY)
    { from: { x: cloudBBox.maxX, y: cloudBBox.maxY }, to: { x: cloudBBox.minX, y: cloudBBox.maxY }, normal: { x: 0, y: 1 } },
    // Left edge: (minX, maxY) -> (minX, minY)
    { from: { x: cloudBBox.minX, y: cloudBBox.maxY }, to: { x: cloudBBox.minX, y: cloudBBox.minY }, normal: { x: -1, y: 0 } },
  ];

  for (const edge of edges) {
    const len = Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y);
    const count = Math.max(1, Math.round(len / chord));
    const stepX = (edge.to.x - edge.from.x) / count;
    const stepY = (edge.to.y - edge.from.y) / count;

    for (let i = 0; i < count; i++) {
      const p1 = {
        x: Math.round((edge.from.x + i * stepX) * 10000) / 10000,
        y: Math.round((edge.from.y + i * stepY) * 10000) / 10000,
      };
      const p2 = {
        x: Math.round((edge.from.x + (i + 1) * stepX) * 10000) / 10000,
        y: Math.round((edge.from.y + (i + 1) * stepY) * 10000) / 10000,
      };
      const mid = {
        x: (p1.x + p2.x) / 2 + edge.normal.x * (chord * 0.25),
        y: (p1.y + p2.y) / 2 + edge.normal.y * (chord * 0.25),
      };
      arcs.push({ start: p1, control: mid, end: p2 });
    }
  }

  return arcs;
}

/**
 * Build annotations and spatial clustering for a diffSession (§8 & §11 T-INS-07)
 */
function buildAnnotationsForDiffSession(diffSession, options = {}) {
  const items = diffSession.diffItems || [];
  if (items.length === 0) {
    return {
      ...diffSession,
      clusters: [],
    };
  }

  // 1. Generate individual item annotations
  let itemIndex = 1;
  for (const item of items) {
    const tagCode = `#D-${String(itemIndex++).padStart(3, '0')}`;
    const stylePreset = STYLE_PRESETS[item.category] || 'cloud_modify_amber';

    const bboxes = [];
    if (item.sourceA && item.sourceA.bbox2D) bboxes.push(item.sourceA.bbox2D);
    if (item.sourceB && item.sourceB.bbox2D) bboxes.push(item.sourceB.bbox2D);

    const cloudBBox = computeCloudBBox(bboxes);
    const focusPoint = {
      x: Math.round(((cloudBBox.minX + cloudBBox.maxX) / 2) * 10000) / 10000,
      y: Math.round(((cloudBBox.minY + cloudBBox.maxY) / 2) * 10000) / 10000,
    };

    const ghostContourA = extractElementContour(item.sourceA);
    const solidContourB = extractElementContour(item.sourceB);

    const catLabel = CATEGORY_LABELS[item.category] || item.category;
    const changeSummary = (item.changes && item.changes[0] && item.changes[0].humanLabel) || item.category;
    const calloutText = `${tagCode} [${catLabel}] ${changeSummary}`;

    const leaderLine = [
      { x: focusPoint.x, y: cloudBBox.maxY },
      { x: Math.round((focusPoint.x + 0.80) * 10000) / 10000, y: Math.round((cloudBBox.maxY + 0.60) * 10000) / 10000 },
    ];

    const arcs = generateCloudArcs(cloudBBox);

    item.annotation = {
      tagCode,
      stylePreset,
      focusPoint,
      cloudBBox,
      arcChordLength: 0.40,
      arcs,
      ghostContourA,
      solidContourB,
      calloutText,
      leaderLine,
    };

    item.reviewState = item.reviewState || {
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      userNote: '',
    };
  }

  // 2. Spatial Clustering (§8.3 & §11 T-INS-07)
  // Distance threshold: adjacent annotations < 0.50m on the same story
  const CLUSTER_DISTANCE_THRESHOLD = 0.50;
  const clusters = [];
  const visited = new Set();
  let clusterSeq = 1;

  for (let i = 0; i < items.length; i++) {
    if (visited.has(items[i].diffId)) continue;

    const clusterItems = [items[i]];
    visited.add(items[i].diffId);

    // BFS / flood-fill adjacent items within threshold
    const queue = [items[i]];
    while (queue.length > 0) {
      const current = queue.shift();
      for (let j = 0; j < items.length; j++) {
        if (!visited.has(items[j].diffId) && items[j].storyIndex === current.storyIndex) {
          const dist = bboxDistance2D(current.annotation.cloudBBox, items[j].annotation.cloudBBox);
          if (dist < CLUSTER_DISTANCE_THRESHOLD) {
            visited.add(items[j].diffId);
            clusterItems.push(items[j]);
            queue.push(items[j]);
          }
        }
      }
    }

    if (clusterItems.length > 1) {
      const storyIdx = clusterItems[0].storyIndex;
      const clusterId = `CL-${storyIdx}F-${String(clusterSeq++).padStart(2, '0')}`;
      const clusterBBox = computeCloudBBox(clusterItems.map((it) => it.annotation.cloudBBox));
      const clusterArcs = generateCloudArcs(clusterBBox, 0.50);

      for (const it of clusterItems) {
        it.annotation.clusterId = clusterId;
      }

      clusters.push({
        clusterId,
        storyIndex: storyIdx,
        memberCount: clusterItems.length,
        diffIds: clusterItems.map((it) => it.diffId),
        tag: `#${clusterId} (含 ${clusterItems.length} 处变更)`,
        clusterBBox,
        arcs: clusterArcs,
      });
    }
  }

  return {
    ...diffSession,
    clusters,
  };
}

module.exports = {
  STYLE_PRESETS,
  CATEGORY_LABELS,
  bboxDistance2D,
  computeCloudBBox,
  extractElementContour,
  generateCloudArcs,
  buildAnnotationsForDiffSession,
};
