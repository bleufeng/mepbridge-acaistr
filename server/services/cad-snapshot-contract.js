'use strict';
const crypto = require('crypto');
// Stable serialization is also used for local change detection; it is not a native document identity.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const canonicalGuid = value => typeof value === 'string' ? value.replace(/[{}]/g, '').trim().toLowerCase() : '';
function completeness(dataset, params = {}) {
  const elements = dataset.elements;
  const complete = Array.isArray(elements) && Number.isSafeInteger(dataset.totalCount) &&
    dataset.totalCount === elements.length && (dataset.returnedCount === undefined || dataset.returnedCount === elements.length) &&
    !params.summaryOnly && !dataset.summaryOnly && !(params.offset > 0) && !(dataset.offset > 0);
  return { complete, reason: complete ? null : 'FULL_DATASET_REQUIRED' };
}
function datasetDigest(dataset) {
  // Native response has no stable ordering guarantee. Include every raw field, not only FNV.
  return digest({ ...dataset, elements: Array.isArray(dataset.elements) ? [...dataset.elements].sort((a,b) => a.guid.localeCompare(b.guid)) : dataset.elements });
}
module.exports = { digest, canonicalGuid, completeness, datasetDigest };
