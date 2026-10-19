'use strict';

/**
 * SPDX-License-Identifier: MIT
 * MEPbridge ACAIstr - Diff Review Store & Export Service
 * Task C-INS-05 (v0.1.8 Foundation / v0.1.9 Alignment)
 *
 * Responsibilities:
 * 1. Human review state management (pending -> confirmed / ignored / adjusted)
 * 2. Stale fingerprint drift defense (anti-tamper / invalidates if model mutated)
 * 3. Structured report export (JSON report, Markdown summary table, Vector SVG)
 */

const VALID_REVIEW_STATUSES = new Set(['pending', 'confirmed', 'ignored', 'adjusted', 'stale']);

/**
 * XML / SVG entity escape helper (V18R-I-3 / C-4)
 */
function escapeXml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Update review item state in a diff session
 */
function updateReviewItemState(session, diffId, { status, reviewedBy = 'architect', userNote = '' } = {}) {
  if (!session || !Array.isArray(session.diffItems)) {
    throw new Error('updateReviewItemState: Invalid diff session');
  }
  if (!VALID_REVIEW_STATUSES.has(status)) {
    throw new Error(`updateReviewItemState: Invalid review status '${status}'. Must be one of: ${Array.from(VALID_REVIEW_STATUSES).join(', ')}`);
  }

  const item = session.diffItems.find((it) => it.diffId === diffId);
  if (!item) {
    throw new Error(`updateReviewItemState: Diff item '${diffId}' not found in session`);
  }

  // Intercept stale items: if an item is already stale, prevent state transition to confirmed/ignored/adjusted (V18R-I-2 / C-3)
  if (status !== 'stale') {
    assertNotStale(item);
  }

  item.reviewState = {
    status,
    reviewedBy,
    reviewedAt: new Date().toISOString(),
    userNote: String(userNote || ''),
  };

  return item;
}

/**
 * Check and flag stale diff items if model fingerprints have drifted (§11 T-INS-09 & §12.3)
 * @param {Object} session
 * @param {Map<string, Object>|Array<Object>} currentElementsMap - current live/snapshot elements
 */
function checkStale(session, currentElements) {
  if (!session || !Array.isArray(session.diffItems)) return session;

  const currentMap = Array.isArray(currentElements)
    ? new Map(currentElements.map((e) => [e.elementGuid, e]))
    : (currentElements instanceof Map ? currentElements : new Map());

  let staleCount = 0;

  for (const item of session.diffItems) {
    const guidA = item.sourceA && item.sourceA.elementGuid;
    const guidB = item.sourceB && item.sourceB.elementGuid;

    let drifted = false;

    if (guidA && currentMap.has(guidA)) {
      const current = currentMap.get(guidA);
      const currCombined = current.fingerprints && current.fingerprints.combinedHash;
      if (currCombined && item.sourceA.combinedHash && currCombined !== item.sourceA.combinedHash) {
        drifted = true;
      }
    }

    if (guidB && currentMap.has(guidB)) {
      const current = currentMap.get(guidB);
      const currCombined = current.fingerprints && current.fingerprints.combinedHash;
      if (currCombined && item.sourceB.combinedHash && currCombined !== item.sourceB.combinedHash) {
        drifted = true;
      }
    }

    if (drifted) {
      item.stale = true;
      item.staleReason = 'FINGERPRINT_DRIFT_DETECTED';
      item.reviewState = {
        status: 'stale',
        reviewedBy: 'system',
        reviewedAt: new Date().toISOString(),
        userNote: '构件在审阅期间发生外部变动，指纹失效，强制阻断操作。',
      };
      staleCount++;
    }
  }

  session.staleCount = staleCount;
  return session;
}

/**
 * Guard assertion preventing execution on stale items
 */
function assertNotStale(item) {
  if (item && (item.stale || (item.reviewState && item.reviewState.status === 'stale'))) {
    const err = new Error(`STALE_FINGERPRINT_REJECTED: 构件 [${item.diffId}] 空间指纹已漂移，拒绝执行回放或回写。`);
    err.code = 'STALE_FINGERPRINT_REJECTED';
    throw err;
  }
}

/**
 * Export structured JSON report
 */
function exportReportJSON(session) {
  return JSON.stringify(session, null, 2);
}

/**
 * Export Markdown summary table
 */
function exportSummaryTable(session) {
  const items = (session && session.diffItems) || [];
  const lines = [
    `# Archicad A/B 差异审阅报告 (${session.diffSessionId || 'N/A'})`,
    `> 生成时间: ${new Date().toISOString()} | 差异总数: ${items.length} 处`,
    '',
    '| 标签 | 图元 GUID | 楼层 | 构件类型 | 差异分类 | 宿主墙变动 | 变更说明 | 复核状态 | 复核人 |',
    '| :--- | :--- | :---: | :---: | :--- | :---: | :--- | :---: | :--- |',
  ];

  for (const it of items) {
    const tag = (it.annotation && it.annotation.tagCode) || it.diffId;
    const guid = (it.sourceA && it.sourceA.elementGuid) || (it.sourceB && it.sourceB.elementGuid) || '-';
    const story = `${it.storyIndex}F`;
    const type = it.elementType;
    const cat = it.category;
    const hostWall = it.hostWallChanged ? '⚠️ 宿主已变' : '无';
    const change = (it.changes && it.changes[0] && it.changes[0].humanLabel) || it.category;
    const status = (it.reviewState && it.reviewState.status) || 'pending';
    const reviewer = (it.reviewState && it.reviewState.reviewedBy) || '-';

    lines.push(`| **${tag}** | \`${guid}\` | ${story} | ${type} | ${cat} | ${hostWall} | ${change} | \`${status}\` | ${reviewer} |`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Export Vector SVG of Revision Clouds and Ghost Contours
 */
function exportReviewSVG(session, options = {}) {
  const items = (session && session.diffItems) || [];
  const width = options.width || 1200;
  const height = options.height || 800;

  // Compute view bounds
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const it of items) {
    if (it.annotation && it.annotation.cloudBBox) {
      const b = it.annotation.cloudBBox;
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }
  }

  if (!Number.isFinite(minX)) {
    minX = 0; minY = 0; maxX = 100; maxY = 100;
  }

  const pad = 2.0;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = (maxX - minX) + pad * 2;
  const vbH = (maxY - minY) + pad * 2;

  const svgParts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}" width="${width}" height="${height}">`,
    `  <style>`,
    `    .ghost-a { fill: none; stroke: #e53935; stroke-width: 0.05; stroke-dasharray: 0.15,0.10; }`,
    `    .solid-b { fill: none; stroke: #00acc1; stroke-width: 0.06; }`,
    `    .cloud-green { fill: rgba(76,175,80,0.08); stroke: #4caf50; stroke-width: 0.08; }`,
    `    .cloud-red { fill: rgba(229,57,53,0.08); stroke: #e53935; stroke-width: 0.08; stroke-dasharray: 0.2,0.1; }`,
    `    .cloud-amber { fill: rgba(255,179,0,0.08); stroke: #ffb300; stroke-width: 0.08; }`,
    `    .cloud-blue { fill: rgba(30,136,229,0.08); stroke: #1e88e5; stroke-width: 0.08; }`,
    `    .cloud-magenta { fill: rgba(216,27,96,0.08); stroke: #d81b60; stroke-width: 0.08; stroke-dasharray: 0.2,0.1; }`,
    `    .leader-line { fill: none; stroke: #546e7a; stroke-width: 0.04; }`,
    `    .callout-text { font-family: sans-serif; font-size: 0.35px; fill: #263238; font-weight: bold; }`,
    `  </style>`,
    `  <g id="ghost-contours-a">`,
  ];

  // Ghost Contours A
  for (const it of items) {
    if (it.annotation && it.annotation.ghostContourA) {
      const pts = it.annotation.ghostContourA.map((p) => `${p[0]},${p[1]}`).join(' ');
      svgParts.push(`    <polygon points="${pts}" class="ghost-a" />`);
    }
  }
  svgParts.push(`  </g>`);

  // Solid Contours B
  svgParts.push(`  <g id="solid-contours-b">`);
  for (const it of items) {
    if (it.annotation && it.annotation.solidContourB) {
      const pts = it.annotation.solidContourB.map((p) => `${p[0]},${p[1]}`).join(' ');
      svgParts.push(`    <polygon points="${pts}" class="solid-b" />`);
    }
  }
  svgParts.push(`  </g>`);

  // Revision Clouds
  svgParts.push(`  <g id="revision-clouds">`);
  for (const it of items) {
    if (it.annotation && Array.isArray(it.annotation.arcs)) {
      const preset = it.annotation.stylePreset || 'cloud_modify_amber';
      let cls = 'cloud-amber';
      if (preset.includes('green')) cls = 'cloud-green';
      else if (preset.includes('red')) cls = 'cloud-red';
      else if (preset.includes('blue')) cls = 'cloud-blue';
      else if (preset.includes('magenta')) cls = 'cloud-magenta';

      let d = '';
      for (const arc of it.annotation.arcs) {
        if (!d) d = `M ${arc.start.x} ${arc.start.y} `;
        d += `Q ${arc.control.x} ${arc.control.y} ${arc.end.x} ${arc.end.y} `;
      }
      d += 'Z';
      svgParts.push(`    <path d="${d}" class="${cls}" />`);
    }
  }
  svgParts.push(`  </g>`);

  // Callouts & Leaders
  svgParts.push(`  <g id="callouts-and-labels">`);
  for (const it of items) {
    if (it.annotation && it.annotation.leaderLine) {
      const ll = it.annotation.leaderLine;
      svgParts.push(`    <polyline points="${ll[0].x},${ll[0].y} ${ll[1].x},${ll[1].y}" class="leader-line" />`);
      const safeCallout = escapeXml(it.annotation.calloutText);
      svgParts.push(`    <text x="${(ll[1].x + 0.1).toFixed(2)}" y="${ll[1].y.toFixed(2)}" class="callout-text">${safeCallout}</text>`);
    }
  }
  svgParts.push(`  </g>`);
  svgParts.push(`</svg>`);

  return svgParts.join('\n');
}

module.exports = {
  VALID_REVIEW_STATUSES,
  escapeXml,
  updateReviewItemState,
  checkStale,
  assertNotStale,
  exportReportJSON,
  exportSummaryTable,
  exportReviewSVG,
};
