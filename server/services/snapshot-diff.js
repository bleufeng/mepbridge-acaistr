// D-3 快照差异报告
//
// 输入两份 D-2 快照（通常来自两个工程的同一采集口径），输出结构化差异：
// 仅 A、仅 B、以及配对元素的几何/属性/分类/图层/楼层不一致。
//
// 为什么是纯函数：差异比较不需要连 Archicad —— 快照里已经有全部信息。做成纯函数
// 可以完全离线测试，也让「同一对快照必然得到同一份报告」成为可断言的性质。
//
// 三个设计要点：
//
// ① **sourceGuid 不能用来跨工程配对**。契约已冻结 `sourceGuidScope: 'source-project-only'`，
//    两个工程里的 GUID 互不相干。所以配对必须靠「类型 + 楼层 + 几何锚点」，而不是 GUID。
//    这一点如果搞错，报告会把每个元素都算成「仅 A」+「仅 B」，看起来能跑但毫无意义。
//
// ② **禁止浮点精确相等**（v0.1.4 发布闸门第 4 条）。所有坐标与数值比较走容差；
//    容差口径随报告一起输出，使「为什么这两个算相同」可被复核。
//
// ③ **配对是贪心最近邻，不是全局最优**。同一 (类型, 楼层) 桶内按锚点距离取最近且在容差内
//    的未配对候选。这对差异报告足够，但要如实说明：极端密集重叠的模型可能出现配对次序
//    影响结果。报告里回报 `matching.strategy` 与容差，不把启发式伪装成精确匹配。

'use strict';

const DEFAULT_DISTANCE_TOLERANCE_M = 0.001;
const REPORT_SCHEMA_VERSION = 'd3-1';

// 各类型的几何比较字段。与 snapshot-replay.js 的 compareElement 保持同一口径：
// 一处放宽另一处不放宽会让 replay 通过而 diff 报差异（或反之）。
const GEOMETRY_FIELDS = {
  Wall: [['point', 'start'], ['point', 'end'], ['number', 'thickness'], ['number', 'height']],
  Column: [['point', 'position'], ['number', 'height']],
  Beam: [['point', 'start'], ['point', 'end']],
  Slab: [['polygon', 'polygon'], ['number', 'thickness'], ['number', 'level']],
  Zone: [['polygon', 'polygon'], ['number', 'height']]
};

// 配对锚点：取该类型最能代表位置的字段。缺失时回退到 AABB 最小角，
// 保证任何类型都能参与配对（含 Mesh/Morph 这类无结构化 payload 的）。
const ANCHOR_FIELDS = {
  Wall: 'start',
  Column: 'position',
  Beam: 'start',
  Slab: null,
  Zone: null
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function numbersClose(a, b, tolerance) {
  if (!isFiniteNumber(Number(a)) || !isFiniteNumber(Number(b))) return false;
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function pointsClose(a, b, tolerance) {
  if (!a || !b) return false;
  const ax = Number(a.x); const ay = Number(a.y);
  const bx = Number(b.x); const by = Number(b.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return false;
  if (Math.abs(ax - bx) > tolerance || Math.abs(ay - by) > tolerance) return false;
  if (a.z !== undefined && b.z !== undefined) {
    const az = Number(a.z); const bz = Number(b.z);
    if (Number.isFinite(az) && Number.isFinite(bz) && Math.abs(az - bz) > tolerance) return false;
  }
  return true;
}

function normalizePolygon(polygon) {
  if (Array.isArray(polygon)) return polygon;
  if (polygon && Array.isArray(polygon.points)) return polygon.points;
  return undefined;
}

function polygonsClose(a, b, tolerance) {
  const left = normalizePolygon(a);
  const right = normalizePolygon(b);
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((point, index) => pointsClose(point, right[index], tolerance));
}

// 元素的配对锚点。优先类型专属字段，其次多边形首点，最后 AABB 最小角。
//
// z 只在确实是有限数时才写入：2D 几何的 payload 常只有 {x, y}，
// 若把 Number(undefined) 得到的 NaN 写进锚点，anchorDistance 会因
// `NaN !== undefined` 为真而算出 NaN 距离，使所有配对静默失败。
function makeAnchor(x, y, z) {
  const anchor = { x: Number(x), y: Number(y) };
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;
  const numericZ = Number(z);
  if (z !== undefined && z !== null && Number.isFinite(numericZ)) anchor.z = numericZ;
  return anchor;
}

function anchorOf(element) {
  const geometry = element.geometry || {};
  const payload = geometry.payload || {};
  const field = ANCHOR_FIELDS[element.elementType];
  if (field && payload[field]) {
    const anchor = makeAnchor(payload[field].x, payload[field].y, payload[field].z);
    if (anchor) return anchor;
  }
  const polygon = normalizePolygon(payload.polygon);
  if (Array.isArray(polygon) && polygon.length > 0) {
    const anchor = makeAnchor(polygon[0].x, polygon[0].y, polygon[0].z);
    if (anchor) return anchor;
  }
  const min = geometry.aabb && Array.isArray(geometry.aabb.min) ? geometry.aabb.min : null;
  if (min && min.length >= 2) {
    const anchor = makeAnchor(min[0], min[1], min.length > 2 ? min[2] : undefined);
    if (anchor) return anchor;
  }
  return null;
}

function anchorDistance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  // 一侧缺 z 时只比平面距离，而不是让整个距离退化为 NaN
  const dz = (a.z !== undefined && b.z !== undefined) ? a.z - b.z : 0;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

function bucketKey(element) {
  const floorIndex = element.floor && element.floor.index !== undefined ? element.floor.index : 'unknown';
  return `${element.elementType}|${floorIndex}`;
}

function elementRef(element, index) {
  return {
    index,
    sourceGuid: element.sourceGuid,
    elementType: element.elementType,
    floorIndex: element.floor ? element.floor.index : undefined,
    layerName: element.layer ? element.layer.name : undefined,
    anchor: anchorOf(element)
  };
}

// 属性按 group+name 配对，而不是 definitionGuid：属性定义 GUID 跨工程不稳定
// （与图层/分类同理），用它配对会把同名属性判成「双方各有一条」。
function propertyKey(property) {
  return `${property.group}||${property.name}`;
}

function propertyValueEqual(a, b, tolerance) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return numbersClose(a, b, tolerance);
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    // 数值型属性常包成 { value: 42 } 之类；逐键比较并对数值走容差
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!propertyValueEqual(a[key], b[key], tolerance)) return false;
    }
    return true;
  }
  return false;
}

function compareProperties(left, right, tolerance) {
  const leftMap = new Map((left || []).map((p) => [propertyKey(p), p]));
  const rightMap = new Map((right || []).map((p) => [propertyKey(p), p]));
  const differences = [];

  for (const [key, leftProperty] of leftMap) {
    if (!rightMap.has(key)) {
      differences.push({ property: key, presence: 'only-in-a', a: leftProperty.value });
      continue;
    }
    const rightProperty = rightMap.get(key);
    if (!propertyValueEqual(leftProperty.value, rightProperty.value, tolerance)) {
      differences.push({ property: key, presence: 'both', a: leftProperty.value, b: rightProperty.value });
    }
  }
  for (const [key, rightProperty] of rightMap) {
    if (!leftMap.has(key)) {
      differences.push({ property: key, presence: 'only-in-b', b: rightProperty.value });
    }
  }
  return differences;
}

// 分类按 systemName+itemName 配对。systemGuid/itemGuid 跨工程不稳定，
// 这与 2026-08-07 实测得到的「replaceExisting 只在同一分类系统内替换」是同一类事实。
function classificationKey(classification) {
  return `${classification.systemName}||${classification.itemName}`;
}

function compareClassifications(left, right) {
  const leftKeys = new Set((left || []).map(classificationKey));
  const rightKeys = new Set((right || []).map(classificationKey));
  const differences = [];
  for (const key of leftKeys) {
    if (!rightKeys.has(key)) differences.push({ classification: key, presence: 'only-in-a' });
  }
  for (const key of rightKeys) {
    if (!leftKeys.has(key)) differences.push({ classification: key, presence: 'only-in-b' });
  }
  return differences;
}

function compareGeometry(left, right, tolerance) {
  const checks = GEOMETRY_FIELDS[left.elementType] || [];
  const leftPayload = (left.geometry && left.geometry.payload) || {};
  const rightPayload = (right.geometry && right.geometry.payload) || {};
  const differences = [];

  for (const [kind, field] of checks) {
    const a = leftPayload[field];
    const b = rightPayload[field];
    let same;
    if (kind === 'point') same = pointsClose(a, b, tolerance);
    else if (kind === 'number') same = numbersClose(a, b, tolerance);
    else same = polygonsClose(a, b, tolerance);
    if (!same) differences.push({ field, kind, a, b });
  }

  // 无结构化比较字段的类型（Mesh/Morph 等）退回 AABB 比较，
  // 并标注这是较弱的判据，不让调用方误以为做了逐顶点比较。
  if (checks.length === 0) {
    const leftAabb = left.geometry && left.geometry.aabb;
    const rightAabb = right.geometry && right.geometry.aabb;
    const aabbSame = leftAabb && rightAabb
      && Array.isArray(leftAabb.min) && Array.isArray(rightAabb.min)
      && leftAabb.min.every((v, i) => numbersClose(v, rightAabb.min[i], tolerance))
      && leftAabb.max.every((v, i) => numbersClose(v, rightAabb.max[i], tolerance));
    if (!aabbSame) {
      differences.push({ field: 'aabb', kind: 'aabb-only', a: leftAabb, b: rightAabb });
    }
  }

  return { differences, comparison: checks.length === 0 ? 'aabb-only' : 'structured' };
}

/**
 * 比较两份快照。
 *
 * @param {Object} options
 *   snapshotA / snapshotB: D-2 快照文档
 *   distanceToleranceM: 几何容差（米），默认 1mm
 * @returns {{ok:boolean, errorType?:string, message?:string, report?:Object}}
 */
function compareSnapshots({ snapshotA, snapshotB, distanceToleranceM } = {}) {
  const tolerance = distanceToleranceM === undefined ? DEFAULT_DISTANCE_TOLERANCE_M : Number(distanceToleranceM);

  for (const [label, snapshot] of [['snapshotA', snapshotA], ['snapshotB', snapshotB]]) {
    if (!snapshot || typeof snapshot !== 'object') {
      return { ok: false, errorType: 'INVALID_SNAPSHOT', message: `${label} 必须是快照对象` };
    }
    if (snapshot.documentType !== 'element-snapshot') {
      return {
        ok: false,
        errorType: 'INVALID_SNAPSHOT',
        message: `${label}.documentType 必须是 element-snapshot，实际 ${JSON.stringify(snapshot.documentType)}`
      };
    }
    if (!Array.isArray(snapshot.elements)) {
      return { ok: false, errorType: 'INVALID_SNAPSHOT', message: `${label}.elements 必须是数组` };
    }
  }

  if (!Number.isFinite(tolerance) || tolerance < 0) {
    return {
      ok: false,
      errorType: 'INVALID_TOLERANCE',
      message: `distanceToleranceM 必须是非负有限数，实际 ${JSON.stringify(distanceToleranceM)}`
    };
  }

  const elementsA = snapshotA.elements;
  const elementsB = snapshotB.elements;

  // 按 (类型, 楼层) 分桶后在桶内贪心最近邻配对
  const buckets = new Map();
  elementsB.forEach((element, index) => {
    const key = bucketKey(element);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ element, index, taken: false });
  });

  const matched = [];
  const onlyInA = [];

  elementsA.forEach((element, index) => {
    const candidates = buckets.get(bucketKey(element)) || [];
    const anchor = anchorOf(element);
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (candidate.taken) continue;
      const distance = anchorDistance(anchor, anchorOf(candidate.element));
      if (distance <= tolerance && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }

    if (!best) {
      onlyInA.push(elementRef(element, index));
      return;
    }
    best.taken = true;
    matched.push({ a: { element, index }, b: { element: best.element, index: best.index }, anchorDistance: bestDistance });
  });

  const onlyInB = [];
  for (const candidates of buckets.values()) {
    for (const candidate of candidates) {
      if (!candidate.taken) onlyInB.push(elementRef(candidate.element, candidate.index));
    }
  }

  // 配对元素的逐字段比较
  const differing = [];
  let identicalCount = 0;

  for (const pair of matched) {
    const a = pair.a.element;
    const b = pair.b.element;
    const geometry = compareGeometry(a, b, tolerance);
    const properties = compareProperties(a.properties, b.properties, tolerance);
    const classifications = compareClassifications(a.classifications, b.classifications);

    const attributes = [];
    const layerA = a.layer ? a.layer.name : undefined;
    const layerB = b.layer ? b.layer.name : undefined;
    if (layerA !== layerB) attributes.push({ field: 'layerName', a: layerA, b: layerB });

    const total = geometry.differences.length + properties.length + classifications.length + attributes.length;
    if (total === 0) {
      identicalCount += 1;
      continue;
    }
    differing.push({
      a: elementRef(a, pair.a.index),
      b: elementRef(b, pair.b.index),
      anchorDistance: pair.anchorDistance,
      geometryComparison: geometry.comparison,
      geometry: geometry.differences,
      properties,
      classifications,
      attributes,
      differenceCount: total
    });
  }

  // 类型级计数：roadmap 点名的「Morph 11 vs 0」正是这一层要直接读出来的
  const typeCounts = new Map();
  const bump = (type, side) => {
    if (!typeCounts.has(type)) typeCounts.set(type, { elementType: type, a: 0, b: 0 });
    typeCounts.get(type)[side] += 1;
  };
  elementsA.forEach((element) => bump(element.elementType, 'a'));
  elementsB.forEach((element) => bump(element.elementType, 'b'));
  const byElementType = [...typeCounts.values()]
    .map((entry) => ({ ...entry, delta: entry.a - entry.b }))
    .sort((x, y) => x.elementType.localeCompare(y.elementType));

  const report = {
    documentType: 'element-snapshot-diff',
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    tolerance: {
      distanceToleranceM: tolerance,
      note: '所有坐标与数值比较均按该容差判定，禁用浮点精确相等'
    },
    matching: {
      strategy: 'bucket-by-type-and-floor-then-greedy-nearest-anchor',
      note: 'sourceGuid 是工程局部标识（sourceGuidScope: source-project-only），跨工程不可用于配对，故按类型+楼层分桶后取容差内最近锚点。贪心匹配非全局最优，密集重叠模型下配对次序可能影响结果。',
      anchorFallback: 'type-specific field → first polygon point → aabb.min'
    },
    sources: {
      a: { snapshotId: snapshotA.snapshotId, projectName: snapshotA.source?.projectName, elementCount: elementsA.length, contentHash: snapshotA.contentHash },
      b: { snapshotId: snapshotB.snapshotId, projectName: snapshotB.source?.projectName, elementCount: elementsB.length, contentHash: snapshotB.contentHash }
    },
    summary: {
      matchedCount: matched.length,
      identicalCount,
      differingCount: differing.length,
      onlyInACount: onlyInA.length,
      onlyInBCount: onlyInB.length,
      byElementType
    },
    onlyInA,
    onlyInB,
    differing
  };

  return { ok: true, report };
}

module.exports = {
  compareSnapshots,
  DEFAULT_DISTANCE_TOLERANCE_M,
  REPORT_SCHEMA_VERSION,
  GEOMETRY_FIELDS
};
