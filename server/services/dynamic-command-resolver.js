const axios = require('axios');

// 必须与 Sources/CopyElementsCommand.cpp 的 SupportedTypes[] 保持一致：
// 这是第一道闸，不通过则请求根本到不了 Add-On。
// tests/test-polygon-contour-contract.js 会 diff 两边。
const DEFAULT_COPY_ALLOWED_TYPES = ['MEPRoute', 'Wall', 'Column', 'Beam', 'Slab', 'Roof', 'Mesh', 'Morph'];

// 必须与 Sources/CopyElementsCommand.cpp 的 MaxSourceGuids 保持一致。
// tests/test-batch-limit-contract.js 会 diff 两边。
//
// 此前这里是硬编码的 `>= 10`，且只作用于「从选择集解析」这条路径 —— 显式传 sourceGuids
// 时函数在第 27 行就 `status: skipped` 返回了，压根走不到计数校验。于是实际语义是
// 「选择集路径限 9 个，显式路径无上限」。现在 C++ 侧是唯一真闸门（两条路径都过它），
// 这里保留同值预检只为把错误提前到调用层、给出可读的 409，而非作为唯一防线。
const MAX_COPY_SOURCE_GUIDS = 500;

class DynamicResolutionError extends Error {
  constructor(code, message, statusCode = 400, detail = {}) {
    super(message);
    this.name = 'DynamicResolutionError';
    this.code = code;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

async function resolveDynamicCommandParameters(archicadCommand, endpoint) {
  const addOnCommandId = archicadCommand?.parameters?.addOnCommandId;
  if (archicadCommand?.command !== 'API.ExecuteAddOnCommand' || addOnCommandId?.commandName !== 'CopyElements') {
    return null;
  }

  const params = archicadCommand.parameters.addOnCommandParameters || {};
  archicadCommand.parameters.addOnCommandParameters = params;

  if (Array.isArray(params.sourceGuids) && params.sourceGuids.length > 0) {
    // 显式路径也要过上限：此前这里直接 return，使上限只对选择集路径生效。
    if (params.sourceGuids.length > MAX_COPY_SOURCE_GUIDS) {
      throw new DynamicResolutionError(
        'COPY_TOO_MANY_SOURCE_GUIDS',
        `CopyElements supports at most ${MAX_COPY_SOURCE_GUIDS} source GUIDs; request has ${params.sourceGuids.length}.`,
        409,
        { sourceCount: params.sourceGuids.length, maxItems: MAX_COPY_SOURCE_GUIDS }
      );
    }
    return {
      type: 'copy-elements-source-guids',
      status: 'skipped',
      reason: 'sourceGuids provided',
      sourceCount: params.sourceGuids.length
    };
  }

  // dryRun=true with empty sourceGuids: skip selection fallback so the request
  // reaches the C++ CopyElements dry-run branch for param preview. The C++ side
  // returns NO_SOURCE_GUIDS in this case, which is the intended dry-run feedback
  // (not a server-side 409 error that blocks the template step).
  if (params.dryRun === true) {
    return {
      type: 'copy-elements-source-guids',
      status: 'skipped',
      reason: 'dryRun with empty sourceGuids; letting C++ dry-run branch handle preview'
    };
  }

  const selected = await fetchSelectedElements(endpoint);
  const allowedTypes = Array.isArray(params.allowedTypes) && params.allowedTypes.length > 0
    ? params.allowedTypes
    : DEFAULT_COPY_ALLOWED_TYPES;
  const elements = Array.isArray(selected.elements) ? selected.elements : [];

  if (elements.length === 0) {
    throw new DynamicResolutionError(
      'COPY_NO_SELECTION',
      `CopyElements requires 1-${MAX_COPY_SOURCE_GUIDS} selected elements in Archicad.`,
      409,
      { selectedCount: selected.selectedCount || 0 }
    );
  }

  if (elements.length > MAX_COPY_SOURCE_GUIDS) {
    throw new DynamicResolutionError(
      'COPY_TOO_MANY_SELECTED_ELEMENTS',
      `CopyElements supports at most ${MAX_COPY_SOURCE_GUIDS} selected elements; current selection has ${elements.length}.`,
      409,
      { selectedCount: elements.length, maxItems: MAX_COPY_SOURCE_GUIDS }
    );
  }

  const unsupported = elements.filter((element) => !allowedTypes.includes(element.type));
  if (unsupported.length > 0) {
    throw new DynamicResolutionError(
      'COPY_UNSUPPORTED_SELECTION_TYPES',
      'CopyElements selection contains unsupported element types.',
      409,
      {
        allowedTypes,
        unsupported: unsupported.map((element) => ({
          guid: element.guid,
          type: element.type
        }))
      }
    );
  }

  const sourceGuids = elements.map((element) => element.guid).filter(Boolean);
  if (sourceGuids.length === 0) {
    throw new DynamicResolutionError(
      'COPY_SELECTION_WITHOUT_GUIDS',
      'CopyElements could not resolve GUIDs from the current selection.',
      409,
      { selectedCount: elements.length }
    );
  }

  params.sourceGuids = sourceGuids;
  if (!Array.isArray(params.allowedTypes) || params.allowedTypes.length === 0) {
    params.allowedTypes = allowedTypes;
  }

  return {
    type: 'copy-elements-source-guids',
    status: 'resolved',
    sourceCount: sourceGuids.length,
    sourceGuids,
    elementTypes: elements.map((element) => element.type)
  };
}

async function fetchSelectedElements(endpoint) {
  const response = await axios.post(
    endpoint,
    {
      command: 'API.ExecuteAddOnCommand',
      parameters: {
        addOnCommandId: {
          commandNamespace: 'MEPBridge',
          commandName: 'GetSelectedElements'
        },
        addOnCommandParameters: {
          onlyEditable: false,
          includeAabb: true,
          includeMepInfo: true
        }
      }
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    }
  );

  const archicadResult = response.data || {};
  const addOnResponse = unwrapAddOnResponse(archicadResult);
  if (archicadResult.succeeded === false || addOnResponse?.status === 'error' || addOnResponse?.success === false) {
    throw new DynamicResolutionError(
      'COPY_SELECTION_READ_FAILED',
      addOnResponse?.error?.message || addOnResponse?.error || archicadResult.error?.message || 'Failed to read current Archicad selection.',
      502,
      { response: archicadResult }
    );
  }

  return addOnResponse || {};
}

function unwrapAddOnResponse(archicadResult) {
  return archicadResult?.result?.addOnCommandResponse || archicadResult?.result || archicadResult;
}

module.exports = {
  DynamicResolutionError,
  resolveDynamicCommandParameters,
  MAX_COPY_SOURCE_GUIDS
};
