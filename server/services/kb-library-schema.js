// SPDX-License-Identifier: MIT
'use strict';
const CATEGORIES = Object.freeze(['buildingCode', 'mepStandard', 'material']);
const MAX_BYTES = 2 * 1024 * 1024, MAX_RULES = 500;
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function inspect(value, depth = 0) {
  if (depth > 12) throw new Error('KB_DATA_DEPTH');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('KB_NONFINITE_NUMBER');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw new Error('KB_DATA_NOT_JSON');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('KB_DATA_NOT_PLAIN');
  for (const key of Object.keys(value)) { if (BAD_KEYS.has(key)) throw new Error('KB_UNSAFE_KEY'); inspect(value[key], depth + 1); }
}
function data(value) {
  inspect(value);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text || '') > MAX_BYTES) throw new Error('KB_FILE_TOO_LARGE');
  return clone(value);
}
function rule(input, category, { requireId = false } = {}) {
  const r = data(input);
  if (!r || Array.isArray(r) || typeof r !== 'object') throw new Error('KB_INVALID_RULE');
  if (requireId && (typeof r.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/.test(r.id))) throw new Error('KB_INVALID_RULE_ID');
  if (typeof (r.rule || r.material) !== 'string' || !(r.rule || r.material).trim()) throw new Error('KB_RULE_TEXT_REQUIRED');
  for (const k of ['rule','material','source','field','commandAction','subType','category','domain','type','thickness','fireRating','libraryId'])
    if (r[k] !== undefined && r[k] !== null && typeof r[k] !== 'string') throw new Error('KB_INVALID_RULE_FIELD:' + k);
  if (r.severity !== undefined && !['error','warning','info'].includes(r.severity)) throw new Error('KB_INVALID_SEVERITY');
  if (r.scope !== undefined && !['shared','library'].includes(r.scope)) throw new Error('KB_INVALID_SCOPE');
  for (const k of ['minValue','maxValue','recommendedValue','thermalConductivity'])
    if (r[k] !== undefined && (typeof r[k] !== 'number' || !Number.isFinite(r[k]))) throw new Error('KB_INVALID_NUMBER:' + k);
  if (r.minRange !== undefined && (!Array.isArray(r.minRange) || r.minRange.length !== 2 || r.minRange.some(x => typeof x !== 'number' || !Number.isFinite(x)) || r.minRange[0] > r.minRange[1])) throw new Error('KB_INVALID_RANGE');
  if (r.minValue !== undefined && r.maxValue !== undefined && r.minValue > r.maxValue) throw new Error('KB_INVALID_RANGE');
  if (r.disabled !== undefined && typeof r.disabled !== 'boolean') throw new Error('KB_INVALID_DISABLED');
  if (!CATEGORIES.includes(category)) throw new Error('KB_INVALID_CATEGORY');
  delete r.expectedRevision;
  return r;
}
function library(input) {
  if (typeof input === 'string' && Buffer.byteLength(input) > MAX_BYTES) throw new Error('KB_FILE_TOO_LARGE');
  const lib = data(typeof input === 'string' ? JSON.parse(input) : input);
  if (lib.schemaVersion !== '1.0.0' || typeof lib.libraryId !== 'string' || !/^custom:[A-Za-z0-9][A-Za-z0-9_.-]{0,90}$/.test(lib.libraryId)) throw new Error('KB_INVALID_LIBRARY_ID_OR_SCHEMA');
  for (const k of ['name','region','contentLanguage','version','updatedAt']) if (typeof lib[k] !== 'string' || !lib[k].trim()) throw new Error('KB_LIBRARY_METADATA_REQUIRED:' + k);
  if (lib.nameEn !== undefined && typeof lib.nameEn !== 'string') throw new Error('KB_INVALID_NAME');
  if (!Array.isArray(lib.sources) || !lib.sources.length || lib.sources.some(s => typeof s !== 'string')) throw new Error('KB_INVALID_SOURCES');
  if (!lib.rules || typeof lib.rules !== 'object' || Array.isArray(lib.rules)) throw new Error('KB_INVALID_RULES');
  let count = 0;
  for (const cat of CATEGORIES) {
    if (!Array.isArray(lib.rules[cat])) throw new Error('KB_INVALID_CATEGORY:' + cat);
    const ids = new Set(); lib.rules[cat] = lib.rules[cat].map(item => {
      const r = rule(item, cat, { requireId: true });
      if (!r.source || (cat !== 'material' && !['error','warning'].includes(r.severity))) throw new Error('KB_RULE_SOURCE_OR_SEVERITY_REQUIRED');
      if (ids.has(r.id)) throw new Error('KB_DUPLICATE_RULE_ID'); ids.add(r.id);
      if (++count > MAX_RULES) throw new Error('KB_TOO_MANY_RULES');
      delete r.isUserAdded; delete r.isBuiltinOverride; r.scope = 'library'; r.libraryId = lib.libraryId;
      return r;
    });
  }
  // No uploaded code, URL/path resolver or uploaded keyword authority.
  return { schemaVersion: lib.schemaVersion, libraryId: lib.libraryId, name: lib.name, nameEn: lib.nameEn || lib.name,
    region: lib.region === 'INT' ? 'INTL' : lib.region, contentLanguage: lib.contentLanguage, version: lib.version,
    updatedAt: lib.updatedAt, sources: lib.sources, rules: lib.rules };
}
module.exports = { CATEGORIES, MAX_BYTES, MAX_RULES, clone, data, rule, library };
