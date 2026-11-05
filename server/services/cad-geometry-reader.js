'use strict';

/**
 * SPDX-License-Identifier: MIT
 * MEPbridge ACAIstr - CAD Geometry Reader & Preview Service (C-CAD-01 / C-CAD-02)
 *
 * Provides:
 * 1. Parameter schema validation for ReadDraftingElements native command
 * 2. Service encapsulation for reading 2D drafting elements from Archicad
 * 3. End-to-end bridge from raw drafting dataset to dwg-intermediate-v1 candidates,
 *    consuming confirmed project layer mappings from cad-layer-mapping-store.
 */

const { validateDraftingDataset, generateIntermediateCandidates } = require('./dwg-intermediate-contract');
const { defaultStore: defaultMappingStore } = require('./cad-layer-mapping-store');

const { completeness } = require('./cad-snapshot-contract');

const ALLOWED_WINDOW_TYPES = new Set(['floorPlan', 'worksheet', 'detail']);
const ALLOWED_SOURCE_MODES = new Set(['auto', 'exploded_2d', 'drawing_memo']);
const ALLOWED_ELEMENT_TYPES = new Set(['Line', 'PolyLine', 'Arc', 'Circle', 'Text', 'Hatch']);

/**
 * Validates and sanitizes parameters for ReadDraftingElements
 * @param {object} params
 * @returns {{ ok: boolean, errorType?: string, message?: string, params?: object }}
 */
function validateReadDraftingParams(params = {}) {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return { ok: false, errorType: 'INVALID_DRAFTING_PARAMS', message: 'Parameters must be an object' };
  }

  const sanitized = {};

  // 1. windowType
  if (params.windowType !== undefined) {
    if (typeof params.windowType !== 'string' || !ALLOWED_WINDOW_TYPES.has(params.windowType)) {
      return {
        ok: false,
        errorType: 'INVALID_WINDOW_TYPE',
        message: `windowType must be one of: ${[...ALLOWED_WINDOW_TYPES].join(', ')}`
      };
    }
    sanitized.windowType = params.windowType;
  } else {
    sanitized.windowType = 'floorPlan';
  }

  // 2. databaseUnId
  if (params.databaseUnId !== undefined) {
    if (typeof params.databaseUnId !== 'string') {
      return { ok: false, errorType: 'INVALID_DATABASE_UNID', message: 'databaseUnId must be a string' };
    }
    sanitized.databaseUnId = params.databaseUnId.trim();
  }

  // 3. sourceMode
  if (params.sourceMode !== undefined) {
    if (typeof params.sourceMode !== 'string' || !ALLOWED_SOURCE_MODES.has(params.sourceMode)) {
      return {
        ok: false,
        errorType: 'INVALID_SOURCE_MODE',
        message: `sourceMode must be one of: ${[...ALLOWED_SOURCE_MODES].join(', ')}`
      };
    }
    sanitized.sourceMode = params.sourceMode;
  } else {
    sanitized.sourceMode = 'auto';
  }

  // 4. summaryOnly
  if (params.summaryOnly !== undefined) {
    if (typeof params.summaryOnly !== 'boolean') {
      return { ok: false, errorType: 'INVALID_SUMMARY_ONLY', message: 'summaryOnly must be a boolean' };
    }
    sanitized.summaryOnly = params.summaryOnly;
  } else {
    sanitized.summaryOnly = false;
  }

  // 5. storyIndex
  if (params.storyIndex !== undefined && params.storyIndex !== null) {
    const sIdx = params.storyIndex;
    if (!Number.isInteger(sIdx) || sIdx < -32768 || sIdx > 32767) {
      return { ok: false, errorType: 'INVALID_STORY_INDEX', message: 'storyIndex must be an integer' };
    }
    sanitized.storyIndex = sIdx;
  }

  // 6. limit and offset
  if (params.limit !== undefined) {
    const l = Number(params.limit);
    if (!Number.isInteger(l) || l < 1 || l > 10000) {
      return { ok: false, errorType: 'INVALID_LIMIT', message: 'limit must be an integer between 1 and 10000' };
    }
    sanitized.limit = l;
  } else {
    sanitized.limit = 5000;
  }

  if (params.offset !== undefined) {
    const o = Number(params.offset);
    if (!Number.isInteger(o) || o < 0) {
      return { ok: false, errorType: 'INVALID_OFFSET', message: 'offset must be a non-negative integer' };
    }
    sanitized.offset = o;
  } else {
    sanitized.offset = 0;
  }

  // 7. layerFilter
  if (params.layerFilter !== undefined) {
    if (!Array.isArray(params.layerFilter)) {
      return { ok: false, errorType: 'INVALID_LAYER_FILTER', message: 'layerFilter must be an array of layer names' };
    }
    const cleanLayers = [];
    for (const item of params.layerFilter) {
      if (typeof item !== 'string' || !item.trim()) {
        return { ok: false, errorType: 'INVALID_LAYER_FILTER', message: 'All items in layerFilter must be non-empty strings' };
      }
      cleanLayers.push(item.trim());
    }
    sanitized.layerFilter = cleanLayers;
  }

  // 8. elementTypes
  if (params.elementTypes !== undefined) {
    if (!Array.isArray(params.elementTypes) || params.elementTypes.length === 0) {
      return { ok: false, errorType: 'INVALID_ELEMENT_TYPES', message: 'elementTypes must be a non-empty array' };
    }
    const cleanTypes = [];
    for (const t of params.elementTypes) {
      if (typeof t !== 'string' || !ALLOWED_ELEMENT_TYPES.has(t)) {
        return {
          ok: false,
          errorType: 'INVALID_ELEMENT_TYPES',
          message: `Unknown element type: ${t}. Allowed: ${[...ALLOWED_ELEMENT_TYPES].join(', ')}`
        };
      }
      cleanTypes.push(t);
    }
    sanitized.elementTypes = cleanTypes;
  }

  // 9. boundingBox
  if (params.boundingBox !== undefined && params.boundingBox !== null) {
    const bbox = params.boundingBox;
    if (typeof bbox !== 'object' || Array.isArray(bbox)) {
      return { ok: false, errorType: 'INVALID_BOUNDING_BOX', message: 'boundingBox must be an object with minX, minY, maxX, maxY' };
    }
    const { minX, minY, maxX, maxY } = bbox;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
      return { ok: false, errorType: 'INVALID_BOUNDING_BOX', message: 'boundingBox minX, minY, maxX, maxY must all be numbers' };
    }
    if (minX > maxX || minY > maxY) {
      return { ok: false, errorType: 'INVALID_BOUNDING_BOX', message: 'boundingBox min coordinates cannot exceed max coordinates' };
    }
    sanitized.boundingBox = { minX, minY, maxX, maxY };
  }

  return { ok: true, params: sanitized };
}

/**
 * Factory for CAD Geometry Reader Service
 */
function createCadGeometryReaderService(dependencies = {}) {
  const callCommand = dependencies.callCommand || (async () => {
    throw new Error('callCommand not configured in CadGeometryReaderService');
  });
  const mappingStore = dependencies.mappingStore || defaultMappingStore;

  return {
    validateParams: validateReadDraftingParams,

    /**
     * Reads raw 2D drafting elements from Archicad via ReadDraftingElements
     */
    async readDraftingElements(endpoint, rawParams = {}) {
      const validation = validateReadDraftingParams(rawParams);
      if (!validation.ok) {
        return {
          ok: false,
          httpStatus: 400,
          errorType: validation.errorType,
          message: validation.message
        };
      }

      try {
        const payload = await callCommand(endpoint, 'ReadDraftingElements', validation.params);
        const dataset = payload?.data || payload;
        const validCheck = validateDraftingDataset(dataset);
        if (!validCheck.valid) {
          return {
            ok: false,
            httpStatus: 502,
            errorType: 'INVALID_DRAFTING_DATASET',
            message: `Archicad returned invalid drafting dataset: ${validCheck.error}`
          };
        }
        const expectedStory = validation.params.storyIndex;
        if (expectedStory !== undefined && (validCheck.payload.storyIndex !== expectedStory ||
            (validCheck.payload.elements || []).some(e => e.storyIndex !== undefined && e.storyIndex !== expectedStory))) {
          return { ok: false, httpStatus: 409, errorType: 'SOURCE_STORY_MISMATCH', message: 'Read response differs from requested source story' };
        }
        return {
          ok: true,
          dataset: validCheck.payload,
          completeness: completeness(validCheck.payload, validation.params)
        };
      } catch (err) {
        return {
          ok: false,
          httpStatus: 502,
          errorType: 'DRAFTING_READ_FAILED',
          message: `ReadDraftingElements command failed: ${err.message}`
        };
      }
    },

    /**
     * Reads drafting elements and generates intermediate candidates consuming confirmed project mapping
     */
    async previewCandidates(endpoint, options = {}) {
      let dataset = options.dataset;

      // 1. If dataset not supplied directly, read from Archicad endpoint
      if (!dataset) {
        if (!endpoint) {
          return {
            ok: false,
            httpStatus: 400,
            errorType: 'TARGET_REQUIRED',
            message: 'Target endpoint or offline dataset is required for previewCandidates'
          };
        }
        const readResult = await this.readDraftingElements(endpoint, options.readParams || {});
        if (!readResult.ok) {
          return readResult;
        }
        if (!readResult.completeness.complete) return { ok: false, httpStatus: 409, errorType: 'FULL_DATASET_REQUIRED', message: 'Summary or partial pages cannot authorize candidates' };
        dataset = readResult.dataset;
      } else {
        const validCheck = validateDraftingDataset(dataset);
        if (!validCheck.valid) {
          return {
            ok: false,
            httpStatus: 400,
            errorType: 'INVALID_DRAFTING_DATASET',
            message: `Provided dataset is invalid: ${validCheck.error}`
          };
        }
        dataset = validCheck.payload;
      }

      // 2. Resolve confirmed mapping: either explicitly passed or retrieved from mappingStore
      let confirmedMapping = options.confirmedMapping;
      if (!confirmedMapping && options.projectKey && mappingStore) {
        confirmedMapping = mappingStore.getConfirmedMapping(options.projectKey);
      }

      // 3. Generate intermediate candidates (consuming confirmedMapping)
      try {
        const candidateOptions = {
          ...(options.candidateOptions || {}),
          confirmedMapping,
          layerInventory: options.layerInventory || dataset.layerInventory
        };
        const intermediate = generateIntermediateCandidates(dataset, candidateOptions);
        return {
          ok: true,
          schemaVersion: intermediate.schemaVersion,
          sourceMetadata: intermediate.sourceMetadata,
          summary: intermediate.summary,
          candidates: intermediate.candidates
        };
      } catch (err) {
        return {
          ok: false,
          httpStatus: 500,
          errorType: 'CANDIDATE_GENERATION_FAILED',
          message: `Failed to generate candidates: ${err.message}`
        };
      }
    }
  };
}

module.exports = {
  ALLOWED_WINDOW_TYPES,
  ALLOWED_SOURCE_MODES,
  ALLOWED_ELEMENT_TYPES,
  validateReadDraftingParams,
  createCadGeometryReaderService
};
