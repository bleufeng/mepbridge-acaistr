'use strict';

const { canonicalGuid, VALID_USE_CATEGORIES } = require('./cad-layer-mapping-store');

/**
 * cad-layer-mapping-merge.js
 * C-CAD-03 (WP-04): 建议用途与人工确认映射合并视图模块
 *
 * 权威契约：
 *   - C_CAD_REVERSE_MODELING_MASTER_PLAN_20261024 §4.3 (WP-04) 与 §4.7 (T02~T10)
 *
 * 核心逻辑：
 *   - 以 layerKey (稳定 `guid:<guid>`) 为主键合并识别建议与已存确认/草稿
 *   - 人工确认用途（confirmedUse）享有绝对优先权，重读或重新识别绝不覆盖人工决定
 *   - 识别新增图层 (new)、原图层改名 (renamed) 以及在当前模型中缺席 (deleted/missing)
 *   - 统计聚合：total, confirmed, pending, newCount, renamedCount, deletedCount
 */

/**
 * 合并图层识别结果与持久化映射
 * @param {Object} options
 * @param {Array} options.recognizedLayers - 来自 cad-layer-recognition 的识别图层数组
 * @param {Object} [options.confirmedMapping] - 来自 store 的确认映射文档
 * @param {Object} [options.draftMapping] - 来自 store 的草稿文档
 * @returns {Object} { mergedEntries, summary }
 */
function mergeLayersWithMapping({ recognizedLayers = [], confirmedMapping = null, draftMapping = null } = {}) {
  const staleDraft = Boolean(draftMapping && !draftMapping.reset && draftMapping.basedOnMappingRevision !== (confirmedMapping?.mappingRevision || 0));
  // A GUID alone is insufficient: its key must agree and duplicates cannot
  // select a winner by array order. Invalid legacy entries remain review-only.
  const coherentGuid = entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.layerKey !== 'string' || !entry.layerKey.startsWith('guid:')) return '';
    const guid = canonicalGuid(entry.guid);
    return guid && /^[a-z0-9-]+$/.test(guid) && canonicalGuid(entry.layerKey.slice(5)) === guid ? guid : '';
  };
  const indexEntries = entries => {
    const indexed = new Map(), duplicates = new Set();
    for (const entry of entries || []) {
      const guid = coherentGuid(entry);
      if (!guid) continue;
      if (indexed.has(guid)) duplicates.add(guid);
      indexed.set(guid, entry);
    }
    for (const guid of duplicates) indexed.delete(guid);
    return indexed;
  };
  const confirmedByGuid = indexEntries(confirmedMapping?.deleted ? [] : confirmedMapping?.entries);
  const draftByGuid = indexEntries(draftMapping && !staleDraft && !draftMapping.reset ? draftMapping.entries : []);

  const mergedEntries = [];
  const seenKeys = new Set();

  for (const inputLayer of recognizedLayers) {
    const layer = { ...inputLayer, guid: canonicalGuid(inputLayer.guid) };
    const recognition = layer.recognition || layer;
    const layerKey = layer.guid ? `guid:${layer.guid}` : (layer.index !== undefined ? `index:${layer.index}` : `name:${layer.name}`);
    seenKeys.add(layerKey);

    const confirmed = layer.guid ? confirmedByGuid.get(layer.guid) : null;
    const draft = layer.guid ? draftByGuid.get(layer.guid) : null;

    // 草稿修改优先展示于草稿视界中，无草稿时取已确认映射
    let confirmedUse = null;
    let isDraftModified = false;

    if (layer.guid && draft && draft.confirmedUse !== undefined) {
      confirmedUse = draft.confirmedUse;
      isDraftModified = true;
    } else if (confirmed && confirmed.confirmedUse && confirmed.status !== 'pending' && confirmed.reviewRequired !== true) {
      confirmedUse = confirmed.confirmedUse;
    }

    const suggestedUse = recognition.category || null;
    const confidence = typeof recognition.confidence === 'number' ? recognition.confidence : 0;
    const isConfirmed = Boolean(layer.guid && VALID_USE_CATEGORIES.has(confirmedUse) && (!draft || (draft.status !== 'pending' && draft.reviewRequired !== true)));
    const reviewRequired = !isConfirmed; // High-confidence suggestions are still not manual decisions.

    let change = 'unchanged';
    let oldName = null;

    if (confirmed) {
      if (confirmed.layerName && confirmed.layerName !== layer.name) {
        change = 'renamed';
        oldName = confirmed.layerName;
      }
    } else {
      change = 'new';
    }

    mergedEntries.push({
      layerKey,
      guid: layer.guid || null,
      layerIndex: layer.index !== undefined ? layer.index : null,
      layerName: layer.name || '',
      suggestedUse,
      confirmedUse,
      confidence,
      status: isConfirmed && !isDraftModified ? 'confirmed' : 'pending',
      reviewRequired,
      ambiguity: recognition.ambiguity || null,
      matchedKeywords: recognition.matchedKeywords || [],
      matchingRule: recognition.matchingRule || '',
      change,
      oldName,
      isDraftModified,
      missing: false
    });
  }

  // 检查在已确认映射中存在、但当前工程图层列表中缺失的图层
  if (confirmedMapping && !confirmedMapping.deleted && Array.isArray(confirmedMapping.entries)) {
    for (const cEntry of confirmedMapping.entries) {
      if (!cEntry || typeof cEntry !== 'object') continue;
      const guid = canonicalGuid(cEntry.guid);
      const key = guid ? 'guid:' + guid : cEntry.layerKey;
      const valid = confirmedByGuid.get(guid) === cEntry && VALID_USE_CATEGORIES.has(cEntry.confirmedUse) && cEntry.status !== 'pending' && cEntry.reviewRequired !== true;
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        mergedEntries.push({
          layerKey: key,
          guid: guid || null,
          layerIndex: null,
          layerName: cEntry.layerName || '',
          suggestedUse: cEntry.suggestedUse || null,
          confirmedUse: cEntry.confirmedUse || null,
          confidence: cEntry.confidence || 1.0,
          status: valid ? 'confirmed' : 'pending',
          reviewRequired: !valid,
          ambiguity: null,
          matchedKeywords: [],
          change: 'deleted',
          oldName: null,
          isDraftModified: false,
          missing: true
        });
      }
    }
  }

  const byCategory = {};
  for (const entry of mergedEntries) {
    const category = entry.suggestedUse || 'unrecognized';
    byCategory[category] = (byCategory[category] || 0) + 1;
  }
  const summary = {
    byCategory,
    unrecognized: mergedEntries.filter(e => !e.suggestedUse || e.suggestedUse === 'unknown').length,
    total: mergedEntries.length,
    confirmed: mergedEntries.filter((e) => e.status === 'confirmed').length,
    pending: mergedEntries.filter((e) => e.status === 'pending').length,
    newCount: mergedEntries.filter((e) => e.change === 'new').length,
    renamedCount: mergedEntries.filter((e) => e.change === 'renamed').length,
    deletedCount: mergedEntries.filter((e) => e.change === 'deleted').length
  };

  return {
    mergedEntries,
    staleDraft,
    summary
  };
}

module.exports = {
  mergeLayersWithMapping
};
