'use strict';

// B 通道官方 JSON API 的唯一能力事实源。
//
// 这里记录的是 MEPBridge 当前允许透传的安全子集，不是 Archicad 官方
// JSON API 的完整命令清单。完整清单和版本差异仍由 command guide 维护。
// directAllowed 与 planChainAllowed 必须显式登记，避免两个执行入口再次漂移。

const crypto = require('crypto');

const READ_ONLY = [
  'API.GetSelectedElements',
  'API.GetAllElements',
  'API.GetElementsByType',
  'API.GetPropertyValuesOfElements',
  'API.GetProductInfo',
  'API.GetStoryNavigatorItems',
  'API.GetClassificationsOfElements',
];

const PLAN_CHAIN_READS = [
  'API.GetSelectedElements',
  'API.GetAllElements',
  'API.GetElementsByType',
];

// These are design candidates only. Keeping them in the source makes their
// fail-closed status visible without accidentally putting them in a whitelist.
const ORGANIZATION_WRITE_DESIGNS = [
  'API.CreateLayout',
  'API.CreateLayoutSubset',
  'API.CreateViewMapFolder',
  'API.RenameNavigatorItem',
  'API.MoveNavigatorItem',
  'API.DeleteNavigatorItems',
  'API.SetLayoutSettings',
  'API.CloneProjectMapItemToViewMap',
  'API.CreateAttributeFolders',
  'API.RenameAttributeFolders',
  'API.MoveAttributesAndFolders',
];

const definitions = new Map();

function add(command, definition) {
  definitions.set(command, Object.freeze({ command, ...definition }));
}

// Confirmed by the 2026-09-08 AC29 runtime probe. The command exists, but the
// classification write protocol has not been reviewed or authorized yet.
add('API.SetClassificationsOfElements', {
  layer: 'authorized-write-design',
  directAllowed: false,
  planChainAllowed: false,
  riskLevel: 'medium-mutation',
  mutation: true,
  requiresAuthorization: true,
  supportsPreview: true,
  status: 'unverified-design',
  readbackCommand: 'API.GetClassificationsOfElements',
});

for (const command of READ_ONLY) {
  add(command, {
    layer: 'read-only',
    directAllowed: true,
    planChainAllowed: PLAN_CHAIN_READS.includes(command),
    riskLevel: 'read',
    mutation: false,
    requiresAuthorization: false,
    supportsPreview: false,
    status: 'implemented-scope',
    readbackCommand: null,
  });
}

add('API.SetPropertyValuesOfElements', {
  layer: 'authorized-write',
  directAllowed: true,
  planChainAllowed: false,
  riskLevel: 'medium-mutation',
  mutation: true,
  requiresAuthorization: true,
  supportsPreview: true,
  status: 'implemented-scope-guarded',
  readbackCommand: 'API.GetPropertyValuesOfElements',
});

for (const command of ORGANIZATION_WRITE_DESIGNS) {
  add(command, {
    layer: 'organization-write',
    directAllowed: false,
    planChainAllowed: false,
    riskLevel: 'high-mutation',
    mutation: true,
    requiresAuthorization: true,
    supportsPreview: true,
    status: 'unverified-design',
    readbackCommand: null,
  });
}

// Permanent exclusions are explicit metadata, not whitelist members.
for (const command of ['API.DeleteAttributes', 'API.ExecuteAddOnCommand']) {
  add(command, {
    layer: 'excluded',
    directAllowed: false,
    planChainAllowed: false,
    riskLevel: 'irreversible',
    mutation: command !== 'API.ExecuteAddOnCommand',
    requiresAuthorization: true,
    supportsPreview: false,
    status: 'permanently-excluded',
    readbackCommand: null,
  });
}

const directCommands = Object.freeze([...definitions.values()]
  .filter((entry) => entry.directAllowed)
  .map((entry) => entry.command));
const planChainCommands = Object.freeze([...definitions.values()]
  .filter((entry) => entry.planChainAllowed)
  .map((entry) => entry.command));

function getOfficialApiCapabilities(command) {
  return definitions.get(command) || null;
}

function getDirectOfficialApiCommands() {
  return [...directCommands];
}

function getPlanChainOfficialApiCommands() {
  return [...planChainCommands];
}

function getOfficialApiDefinitions() {
  return [...definitions.values()].map((entry) => ({ ...entry }));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function createPreviewId() {
  return `official-preview-${crypto.randomBytes(12).toString('hex')}`;
}

// Preview records are intentionally process-local. They are short-lived
// authorization bindings, not a replacement for project persistence or auth.
const previewStore = new Map();
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 1000;

function pruneExpiredPreviews(now = Date.now()) {
  for (const [previewId, entry] of previewStore) {
    if (entry.expiresAt <= now) previewStore.delete(previewId);
  }
}

function createOfficialApiPreview({ command, parameters, authorization, readback, endpoint }) {
  pruneExpiredPreviews();
  while (previewStore.size >= MAX_PREVIEWS) {
    const oldestPreviewId = previewStore.keys().next().value;
    if (!oldestPreviewId) break;
    previewStore.delete(oldestPreviewId);
  }
  const previewId = createPreviewId();
  const commandHash = hash({ command, parameters });
  const scopeHash = hash(authorization.scope);
  const readbackHash = hash(readback);
  const expiresAt = Date.now() + PREVIEW_TTL_MS;
  const entry = {
    previewId,
    command,
    parameters: canonicalize(parameters),
    commandHash,
    scope: canonicalize(authorization.scope),
    scopeHash,
    readback: canonicalize(readback),
    readbackHash,
    endpoint,
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  previewStore.set(previewId, entry);
  return {
    previewId,
    command,
    commandHash,
    scopeHash,
    readbackHash,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresInMs: PREVIEW_TTL_MS,
    status: 'preview',
    canExecute: true,
  };
}

function guidFromReference(reference) {
  if (typeof reference === 'string' && reference.trim()) return reference;
  if (reference && typeof reference === 'object' && typeof reference.guid === 'string' && reference.guid.trim()) {
    return reference.guid;
  }
  return null;
}

function elementGuidFromEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return guidFromReference(entry.elementId) || guidFromReference(entry.elementGuid);
}

function propertyGuidFromEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return guidFromReference(entry.propertyId) || guidFromReference(entry.propertyGuid);
}

function valueFromEntry(entry) {
  if (!entry || typeof entry !== 'object') return { found: false };
  for (const key of ['value', 'valueString', 'propertyValue']) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) {
      return { found: true, key, value: entry[key] };
    }
  }
  return { found: false };
}

function extractPropertyWriteTargets(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return { ok: false, errorType: 'OFFICIAL_WRITE_TARGETS_UNVERIFIABLE', message: '属性写入 parameters 必须是对象' };
  }

  const elements = Array.isArray(parameters.elements) ? parameters.elements : [];
  const topLevelProperties = Array.isArray(parameters.properties) ? parameters.properties : [];
  const targets = [];

  for (const element of elements) {
    const elementGuid = elementGuidFromEntry(element);
    if (!elementGuid) continue;
    const properties = Array.isArray(element.properties) ? element.properties : topLevelProperties;
    for (const property of properties) {
      const propertyGuid = propertyGuidFromEntry(property);
      const value = valueFromEntry(property);
      if (propertyGuid && value.found) {
        targets.push({ elementGuid, propertyGuid, expectedValue: value.value, valueKey: value.key });
      }
    }
  }

  if (targets.length === 0) {
    return {
      ok: false,
      errorType: 'OFFICIAL_WRITE_TARGETS_UNVERIFIABLE',
      message: '无法从属性写入参数解析元素 GUID、属性 GUID 和目标值',
    };
  }
  return { ok: true, targets };
}

function extractPropertyReadbackRecords(readbackData) {
  const records = [];
  const visited = new Set();

  function visit(value, inheritedElementGuid = null) {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    const elementGuid = elementGuidFromEntry(value) || inheritedElementGuid;
    const propertyGuid = propertyGuidFromEntry(value);
    const propertyValue = valueFromEntry(value);
    if (elementGuid && propertyGuid && propertyValue.found) {
      records.push({
        elementGuid,
        propertyGuid,
        actualValue: propertyValue.value,
        valueKey: propertyValue.key,
      });
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, elementGuid);
    } else {
      for (const child of Object.values(value)) visit(child, elementGuid);
    }
  }

  visit(readbackData);
  return records;
}

function comparePropertyReadback(parameters, readbackData) {
  const extracted = extractPropertyWriteTargets(parameters);
  if (!extracted.ok) return { verified: false, ...extracted, expectedCount: 0, matchedCount: 0 };
  if (!readbackData || readbackData.succeeded !== true || readbackData.error != null) {
    return {
      verified: false,
      errorType: 'OFFICIAL_READBACK_FAILED',
      message: 'Archicad readback 未返回 succeeded=true',
      expectedCount: extracted.targets.length,
      matchedCount: 0,
    };
  }

  const records = extractPropertyReadbackRecords(readbackData);
  const missing = [];
  const mismatches = [];
  let matchedCount = 0;
  for (const target of extracted.targets) {
    const matches = records.filter((record) => record.elementGuid === target.elementGuid
      && record.propertyGuid === target.propertyGuid);
    if (matches.length === 0) {
      missing.push({ elementGuid: target.elementGuid, propertyGuid: target.propertyGuid });
      continue;
    }
    matchedCount += 1;
    if (!matches.some((record) => stableJson(record.actualValue) === stableJson(target.expectedValue))) {
      mismatches.push({
        elementGuid: target.elementGuid,
        propertyGuid: target.propertyGuid,
        expectedValue: target.expectedValue,
        actualValues: matches.map((record) => record.actualValue),
      });
    }
  }

  const verified = missing.length === 0 && mismatches.length === 0;
  return {
    verified,
    errorType: verified ? null : 'OFFICIAL_READBACK_UNVERIFIABLE',
    message: verified ? '属性值逐项回读一致' : '属性值回读无法逐项证明与写入目标一致',
    expectedCount: extracted.targets.length,
    matchedCount,
    missing,
    mismatches,
  };
}

function getOfficialApiPreview(previewId) {
  pruneExpiredPreviews();
  return previewStore.get(previewId) || null;
}

function consumeOfficialApiPreview(previewId) {
  const entry = getOfficialApiPreview(previewId);
  if (entry) previewStore.delete(previewId);
  return entry;
}

function validateAuthorizedOfficialApiExecute({ request, entry, command, parameters, endpoint }) {
  if (!entry) return { ok: false, errorType: 'OFFICIAL_PREVIEW_NOT_FOUND', message: 'previewId 不存在或已过期，必须重新 preview' };
  if (entry.endpoint !== endpoint) return { ok: false, errorType: 'OFFICIAL_TARGET_MISMATCH', message: 'preview 与 execute 的目标 Archicad 实例不一致' };
  if (request.authorization?.granted !== true) {
    return { ok: false, errorType: 'OFFICIAL_AUTHORIZATION_REQUIRED', message: '真实属性写入必须携带 authorization.granted=true' };
  }
  if (hash(request.authorization.scope) !== entry.scopeHash) {
    return { ok: false, errorType: 'OFFICIAL_AUTHORIZATION_SCOPE_MISMATCH', message: '授权范围与 preview 不一致，必须重新 preview' };
  }
  if (hash({ command, parameters }) !== entry.commandHash) {
    return { ok: false, errorType: 'OFFICIAL_PREVIEW_COMMAND_MISMATCH', message: 'execute 命令或参数与 preview 不一致，必须重新 preview' };
  }
  if (hash(request.readback) !== entry.readbackHash) {
    return { ok: false, errorType: 'OFFICIAL_READBACK_MISMATCH', message: 'readback 请求与 preview 不一致，必须重新 preview' };
  }
  return { ok: true };
}

function resetOfficialApiPreviewStore() {
  previewStore.clear();
}

module.exports = {
  getOfficialApiCapabilities,
  getDirectOfficialApiCommands,
  getPlanChainOfficialApiCommands,
  getOfficialApiDefinitions,
  createOfficialApiPreview,
  getOfficialApiPreview,
  consumeOfficialApiPreview,
  validateAuthorizedOfficialApiExecute,
  canonicalize,
  stableJson,
  hash,
  extractPropertyWriteTargets,
  extractPropertyReadbackRecords,
  comparePropertyReadback,
  _test: { definitions, previewStore, resetOfficialApiPreviewStore, PREVIEW_TTL_MS, MAX_PREVIEWS },
};
