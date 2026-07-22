const axios = require('axios');

const DEFAULT_COPY_ALLOWED_TYPES = ['MEPRoute', 'Wall', 'Column', 'Beam', 'Slab', 'Roof'];

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
    return {
      type: 'copy-elements-source-guids',
      status: 'skipped',
      reason: 'sourceGuids provided',
      sourceCount: params.sourceGuids.length
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
      'CopyElements requires 1-9 selected elements in Archicad.',
      409,
      { selectedCount: selected.selectedCount || 0 }
    );
  }

  if (elements.length >= 10) {
    throw new DynamicResolutionError(
      'COPY_TOO_MANY_SELECTED_ELEMENTS',
      `CopyElements supports fewer than 10 selected elements; current selection has ${elements.length}.`,
      409,
      { selectedCount: elements.length, maxExclusive: 10 }
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
  resolveDynamicCommandParameters
};
