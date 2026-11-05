/**
 * bounded-result-summary.js
 * V19-DISC-01 / R-08: 大结果有界摘要与防撑爆截断服务
 *
 * 约束对齐（校准项 5）：
 * 1. 阈值保护：构件数 > 20 或体积 > 4KB 时触发有界摘要。
 * 2. 可追溯性保证：同次响应内完整可逆明细，不丢 GUID。
 * 3. 错误状态保全：原样保留 errors 与 warnings 数组，绝不静默吞没异常。
 * 4. 明细恢复：inline-lossless 列式编码；不虚构远端分页。
 */

'use strict';

const DEFAULT_MAX_ELEMENTS = 20;
const DEFAULT_MAX_BYTES = 4096; // 4 KB

/**
 * 从不同可能的数据层级中提取构件数组
 * @param {object} result
 * @returns {Array<object>|null}
 */
function extractElementsArray(result) {
  if (!result) return null;
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.elements)) return result.elements;
  if (result.data && Array.isArray(result.data.elements)) return result.data.elements;
  if (result.result && Array.isArray(result.result.elements)) return result.result.elements;
  return null;
}

/**
 * 计算构件类型的分布统计
 * @param {Array<object>} elements
 * @returns {Record<string, number>}
 */
function computeTypeDistribution(elements) {
  const distribution = {};
  for (const el of elements) {
    const type = el.type || el.elementType || 'Unknown';
    distribution[type] = (distribution[type] || 0) + 1;
  }
  return distribution;
}

/**
 * 尝试计算元素集合的外包盒 AABB（若存在坐标点信息）
 * @param {Array<object>} elements
 * @returns {{ min: number[], max: number[] } | null}
 */
function computeBoundingBox(elements) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let hasValidCoords = false;

  for (const el of elements) {
    const candidates = [
      el.coordinates,
      el.position,
      el.start,
      el.end,
      el.anchorPosition,
      el.bounds?.min,
      el.bounds?.max
    ];

    for (const c of candidates) {
      if (!c) continue;
      const x = Number(c.x ?? c[0]);
      const y = Number(c.y ?? c[1]);
      const z = Number(c.z ?? c[2] ?? 0);

      if (Number.isFinite(x) && Number.isFinite(y)) {
        hasValidCoords = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (Number.isFinite(z)) {
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
    }
  }

  if (!hasValidCoords) return null;
  return {
    min: [Number(minX.toFixed(3)), Number(minY.toFixed(3)), Number((minZ === Infinity ? 0 : minZ).toFixed(3))],
    max: [Number(maxX.toFixed(3)), Number(maxY.toFixed(3)), Number((maxZ === -Infinity ? 0 : maxZ).toFixed(3))]
  };
}

/**
 * Presentation-only, lossless columnar summary for known element arrays.
 * All details travel in this SAME response: no cache, expiry, scope widening or
 * fictitious pagination. Unknown/heterogeneous/over-budget shapes pass through.
 * maxBytes is a summary budget, not permission to truncate an error or result.
 */
function summarizeResult(result, options = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.hasOwn(result, '_summary')) return result;
  const maxElements = options.maxElements ?? DEFAULT_MAX_ELEMENTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
  const originalBytes = bytes(result);
  const paths = [ ['elements'], ['data','elements'], ['result','elements'],
    ['response','result','addOnCommandResponse','elements'], ['result','addOnCommandResponse','elements'] ];
  const found = paths.filter(keys => Array.isArray(keys.reduce((v,k) => v?.[k], result)));
  if (found.length !== 1) return result;
  const elementPath = found[0];
  const elements = elementPath.reduce((v,k) => v[k], result);
  if (!elements.length || (elements.length <= maxElements && originalBytes <= maxBytes)) return result;
  if (elements.some(e => !e || typeof e !== 'object' || Array.isArray(e))) return result;
  const columns = Object.keys(elements[0]);
  // Preserve exact field presence as well as values; no guessed GUIDs/types.
  if (elements.some(e => Object.keys(e).length !== columns.length || columns.some(k => !Object.hasOwn(e,k)))) return result;
  const out = JSON.parse(JSON.stringify(result));
  let owner = out;
  for (const key of elementPath.slice(0,-1)) owner = owner[key];
  const encodedElements = owner.elements;
  delete owner.elements;
  out._summary = {
    encoding: 'element-columns-v1', elementPath, totalCount: elements.length,
    columns, rows: encodedElements.map(e => columns.map(k => e[k])),
    typeDistribution: computeTypeDistribution(elements),
    retrievalGuide: { mode: 'inline-lossless', note: 'Rebuild each element with columns[i] = row[i]; all details are included in this response. No remote pagination or re-query required.' }
  };
  // All wrapper status/error/warning/partial/recovery/target fields stay intact.
  // Do not synthesize ok:true (or overwrite the producer's success semantics).
  if (bytes(out) > maxBytes || bytes(out) >= originalBytes) return result;
  return out;
}

function restoreResult(summary) {
  if (summary?._summary?.encoding !== 'element-columns-v1') return summary;
  const meta = summary._summary;
  const allowedPaths = ['elements', 'data.elements', 'result.elements',
    'response.result.addOnCommandResponse.elements', 'result.addOnCommandResponse.elements'];
  if (!Array.isArray(meta.elementPath) || !allowedPaths.includes(meta.elementPath.join('.')) ||
      !Array.isArray(meta.columns) || meta.columns.some(k => typeof k !== 'string') ||
      new Set(meta.columns).size !== meta.columns.length || !Array.isArray(meta.rows) ||
      meta.rows.length !== meta.totalCount || meta.rows.some(row => !Array.isArray(row) || row.length !== meta.columns.length)) return summary;
  const out = JSON.parse(JSON.stringify(summary));
  const { elementPath, columns, rows } = out._summary;
  let owner = out;
  for (const key of elementPath.slice(0,-1)) {
    if (!owner || typeof owner !== 'object' || !Object.hasOwn(owner, key)) return summary;
    owner = owner[key];
  }
  if (!owner || typeof owner !== 'object' || Array.isArray(owner) || Object.hasOwn(owner, 'elements')) return summary;
  delete out._summary;
  owner.elements = rows.map(row => Object.fromEntries(columns.map((key,i) => [key,row[i]])));

  return out;
}

// Inspect only known response wrappers; arbitrary element attributes are not
// execution statuses. Used before presentation encoding, never infer success.
function hasResultFailure(result, seen = new Set()) {
  if (!result || typeof result !== 'object') return false;
  if (seen.has(result)) return true;
  seen.add(result);
  if (result.ok === false || result.success === false || result.succeeded === false ||
      ['error', 'failed', 'partial', 'unknown'].includes(result.status) || Number(result.failedCount) > 0 || result.error || (Array.isArray(result.errors) && result.errors.length)) return true;
  return ['response', 'result', 'addOnCommandResponse', 'data'].some(k => hasResultFailure(result[k], new Set(seen)));
}

const SUMMARY_COMMANDS = new Set(['GetElementsByType', 'GetSelectedElements']);
function summarizeReadResult(commandName, result, options) {
  return SUMMARY_COMMANDS.has(commandName) ? summarizeResult(result, options) : result;
}

module.exports = { DEFAULT_MAX_ELEMENTS, DEFAULT_MAX_BYTES, extractElementsArray,
  computeTypeDistribution, computeBoundingBox, summarizeResult, restoreResult, summarizeReadResult, hasResultFailure };
