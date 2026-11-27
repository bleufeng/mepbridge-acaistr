// SPDX-License-Identifier: MIT
// MEPbridge ACAIstr - AI Adapter Server
// Copyright (c) 2026 Zuxai Z.
// Licensed under the MIT License.
//
// OFF-02 (GEN-RT-DIAGNOSTICS, W1 §28.1): deterministic parameter preflight for
// the four primary element commands. Archicad's JSON API may reject a payload at
// schema-validation time (anyOf / 4002) without ever reaching Execute; this module
// reproduces only the C++ hard constraints that are *certain* to fail, and returns a
// JSON-pointer level diagnosis instead of a bare numeric error.
//
// Safety contract: this preflight NEVER rejects a payload the add-on would accept.
// Rules are limited to required-field presence, exclusive groups, pair/conditional
// requirements, deterministic array bounds and control-field prohibitions that are
// hard-coded in the C++ GetSchema / Execute paths. Anything uncertain is passed
// through so the native schema remains the single source of truth.

'use strict';

const MAX_BATCH = 500;

// Fields that an EditBuildingElement batch item must never carry (C++ BATCH_ITEM_CONTROL_FORBIDDEN).
const BATCH_ITEM_FORBIDDEN_FIELDS = [
  'target', 'dryRun', 'confirmRequired', 'elements', 'items', 'atomic', 'atomicityPolicy',
  '_mepbridgeExecution', 'resultDetail'
];

function issue (pointer, field, rule, message) {
  return { pointer, field, rule, message };
}

function hasValue (value) {
  return value !== undefined && value !== null;
}

function checkExclusivePair (params, [a, b], pointer, issues, commandName) {
  if (hasValue(params[a]) && hasValue(params[b])) {
    issues.push(issue(
      `${pointer}/${b}`,
      b,
      'exclusiveFields',
      `${commandName}: "${a}" and "${b}" are mutually exclusive.`
    ));
  }
}

function checkExactlyOneOf (params, fields, pointer, issues, commandName) {
  const present = fields.filter((field) => hasValue(params[field]));
  if (present.length !== 1) {
    issues.push(issue(
      `${pointer}/${present.length > 1 ? present[1] : fields[0]}`,
      present.length > 1 ? present[1] : fields[0],
      'exactlyOneOf',
      `${commandName}: exactly one of [${fields.join(', ')}] is required; found [${present.join(', ')}].`
    ));
  }
}

function checkPairRequires (params, pairs, pointer, issues, commandName) {
  for (const [a, b] of pairs) {
    const hasA = hasValue(params[a]);
    const hasB = hasValue(params[b]);
    if (hasA !== hasB) {
      const missing = hasA ? b : a;
      issues.push(issue(
        `${pointer}/${missing}`,
        missing,
        'pairRequires',
        `${commandName}: "${a}" and "${b}" must be provided together.`
      ));
    }
  }
}

function checkRequired (params, required, pointer, issues, commandName) {
  for (const field of required) {
    if (!hasValue(params[field])) {
      issues.push(issue(
        `${pointer}/${field}`,
        field,
        'required',
        `${commandName}: required field "${field}" is missing.`
      ));
    }
  }
}

function checkConditional (params, conditionals, pointer, issues, commandName) {
  for (const rule of conditionals) {
    if (params[rule.when] === rule.is && !hasValue(params[rule.then])) {
      issues.push(issue(
        `${pointer}/${rule.then}`,
        rule.then,
        'conditionalRequires',
        `${commandName}: "${rule.when}=${rule.is}" requires "${rule.then}".`
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// Per-command rules. Mirrors the frozen OFF-01 contract (structureModes /
// unitsAndSemantics) and the C++ schema hard constraints only. Exclusivity is
// expressed as precise pairs: sectionWidth/sectionDepth are a *pair*, only the
// diameter and profile identities conflict with them.
// ---------------------------------------------------------------------------

// Column/Beam: diameter conflicts with each basic dimension; profile conflicts with all basic fields.
const SECTION_AND_PROFILE_PAIRS = [
  ['sectionDiameter', 'sectionWidth'],
  ['sectionDiameter', 'sectionDepth'],
  ['profileGuid', 'sectionWidth'],
  ['profileGuid', 'sectionDepth'],
  ['profileGuid', 'sectionDiameter']
];
// Wall/Slab: the three structure identity fields are mutually exclusive.
const STRUCTURE_IDENTITY_PAIRS = [
  ['buildingMaterialIndex', 'compositeIndex'],
  ['buildingMaterialIndex', 'profileGuid'],
  ['compositeIndex', 'profileGuid']
];

const RULES = {
  CreateColumn: {
    required: ['position'],
    exclusivePairs: [
      ...SECTION_AND_PROFILE_PAIRS,
      ['floorIndex', 'absoluteZ'],
      ['layerGuid', 'layerName']
    ],
    pairRequires: [['sectionWidth', 'sectionDepth']],
    conditionals: [{ when: 'structureType', is: 'Profile', then: 'profileGuid' }]
  },
  CreateWall: {
    required: ['start', 'end'],
    exclusivePairs: [
      ...STRUCTURE_IDENTITY_PAIRS,
      ['layerGuid', 'layerName']
    ],
    conditionals: [
      { when: 'structureType', is: 'Composite', then: 'compositeIndex' },
      { when: 'structureType', is: 'Profile', then: 'profileGuid' }
    ]
  },
  CreateBeam: {
    required: ['start', 'end'],
    exclusivePairs: [
      ...SECTION_AND_PROFILE_PAIRS,
      ['absoluteZ', 'floorIndex'],
      ['absoluteZ', 'topOffset'],
      ['layerGuid', 'layerName']
    ],
    pairRequires: [['sectionWidth', 'sectionDepth']],
    conditionals: [{ when: 'structureType', is: 'Profile', then: 'profileGuid' }]
  },
  CreateSlab: {
    exclusivePairs: [['polygon', 'boundary'], ['layerGuid', 'layerName']],
    conditionals: [{ when: 'structureType', is: 'Composite', then: 'compositeIndex' }]
  },
  SetLayerBatch: {
    required: ['elementGuids'],
    exactlyOneOf: [['layerGuid', 'layerName']]
  }
};

// EditBuildingElement carries a per-type editable whitelist plus wall vertical
// constraint conflicts (C++ FIELD_NOT_EDITABLE / HEIGHT_CONSTRAINT_CONFLICT).
const EDIT_TYPE_WHITELIST = {
  Wall: ['height', 'thickness', 'relativeTopStory', 'topOffset', 'bottomOffset', 'begC', 'endC',
    'begX', 'begY', 'endX', 'endY', 'arcAngle', 'structureType', 'buildingMaterialIndex',
    'compositeIndex', 'profileGuid', 'refLinePosition', 'refLineOffset', 'floorIndex', 'layerGuid', 'layerName'],
  Column: ['height', 'origX', 'origY', 'position', 'rotationAngle', 'coreAnchor', 'structureType',
    'sectionWidth', 'sectionDepth', 'sectionDiameter', 'buildingMaterialIndex', 'profileGuid', 'floorIndex',
    'layerGuid', 'layerName', 'bottomOffset'],
  Beam: ['begC', 'endC', 'begX', 'begY', 'endX', 'endY', 'anchorPoint', 'axisOffset', 'structureType',
    'sectionWidth', 'sectionDepth', 'sectionDiameter', 'buildingMaterialIndex', 'profileGuid', 'floorIndex',
    'layerGuid', 'layerName', 'topOffset'],
  Slab: ['thickness', 'level', 'structureType', 'buildingMaterialIndex', 'compositeIndex',
    'boundary', 'floorIndex', 'layerGuid', 'layerName']
};

function preflightSimple (commandName, params, rule) {
  const issues = [];
  checkRequired(params, rule.required || [], '', issues, commandName);
  for (const pair of rule.exclusivePairs || []) checkExclusivePair(params, pair, '', issues, commandName);
  for (const fields of rule.exactlyOneOf || []) checkExactlyOneOf(params, fields, '', issues, commandName);
  checkPairRequires(params, rule.pairRequires || [], '', issues, commandName);
  checkConditional(params, rule.conditionals || [], '', issues, commandName);

  // dryRun=false demands confirmRequired=true (shared hard gate across writers).
  if (params.dryRun === false && params.confirmRequired !== true) {
    issues.push(issue('/confirmRequired', 'confirmRequired', 'confirmRequired',
      `${commandName}: confirmRequired=true is mandatory when dryRun=false.`));
  }
  return issues;
}

function preflightBatchCreate (params) {
  const issues = [];
  // OFF-03: root-level layer identity is resolved once by the C++ helper; supplying
  // both is a deterministic CANCEL-class rejection, so preflight it here.
  checkExclusivePair(params, ['layerGuid', 'layerName'], '', issues, 'BatchCreateElements');
  const items = params.items;
  if (!Array.isArray(items) || items.length === 0) {
    issues.push(issue('/items', 'items', 'required', 'BatchCreateElements: "items" array is required.'));
    return issues;
  }
  if (items.length > MAX_BATCH) {
    issues.push(issue('/items', 'items', 'maxItems',
      `BatchCreateElements: ${items.length} items exceed the hard cap of ${MAX_BATCH}.`));
    return issues;
  }
  const elementType = params.elementType;
  // C10: BatchCreateElementsCommand.cpp ReadPolygonFromItem accepts "polygon"
  // OR "vertices" (`!Get(polygon) && !Get(vertices)`). Requiring BOTH was an
  // AND/OR inversion that rejected a payload the add-on would accept.
  const requiredPerType = {
    Wall: ['start', 'end'], Column: ['position'], Beam: ['start', 'end']
  };
  const polygonAliasTypes = ['Roof', 'Morph'];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item === null || typeof item !== 'object') {
      issues.push(issue(`/items/${i}`, 'items', 'type', `BatchCreateElements: items[${i}] must be an object.`));
      continue;
    }
    const base = `/items/${i}`;
    if (elementType === 'Slab') {
      checkExclusivePair(item, ['polygon', 'boundary'], base, issues, 'BatchCreateElements[Slab]');
      checkExclusivePair(item, ['vertices', 'boundary'], base, issues, 'BatchCreateElements[Slab]');
      if (!hasValue(item.polygon) && !hasValue(item.vertices) && !hasValue(item.boundary)) {
        issues.push(issue(`${base}/polygon`, 'polygon', 'required', `BatchCreateElements[Slab] item ${i}: required field "polygon" or "boundary" is missing.`));
      }
      checkExclusivePair(item, ['buildingMaterialIndex', 'compositeIndex'], base, issues, 'BatchCreateElements[Slab]');
      if (hasValue(item.compositeIndex) && hasValue(item.thickness)) {
        issues.push(issue(`${base}/thickness`, 'thickness', 'exclusiveFields', 'BatchCreateElements[Slab]: Composite construction derives thickness; do not pass thickness.'));
      }
      checkConditional(item, [{ when: 'structureType', is: 'Composite', then: 'compositeIndex' }], base, issues, 'BatchCreateElements[Slab]');
    } else {
      if (polygonAliasTypes.includes(elementType)) {
        checkExclusivePair(item, ['polygon', 'boundary'], base, issues, `BatchCreateElements[${elementType}]`);
        if (!hasValue(item.polygon) && !hasValue(item.vertices)) {
          issues.push(issue(`${base}/polygon`, 'polygon', 'required',
            `BatchCreateElements[${elementType}] item ${i}: one of "polygon" or "vertices" is required (native aliases).`));
        }
      }
      const required = (requiredPerType[elementType] || []);
      checkRequired(item, required, base, issues, `BatchCreateElements[${elementType}] item ${i}`);
    }
    if (elementType === 'Column' || elementType === 'Beam') {
      for (const pair of SECTION_AND_PROFILE_PAIRS) {
        checkExclusivePair(item, pair, base, issues, `BatchCreateElements[${elementType}]`);
      }
      checkPairRequires(item, [['sectionWidth', 'sectionDepth']], base, issues, `BatchCreateElements[${elementType}]`);
      checkConditional(item, [{ when: 'structureType', is: 'Profile', then: 'profileGuid' }], base, issues, `BatchCreateElements[${elementType}]`);
    } else if (elementType === 'Wall') {
      checkWallCreationTop(item, base, issues);
      for (const pair of STRUCTURE_IDENTITY_PAIRS) {
        checkExclusivePair(item, pair, base, issues, 'BatchCreateElements[Wall]');
      }
      if ((hasValue(item.compositeIndex) || hasValue(item.profileGuid)) && hasValue(item.thickness)) {
        issues.push(issue(`${base}/thickness`, 'thickness', 'exclusiveFields', 'BatchCreateElements[Wall]: Composite/Profile construction cannot be combined with scalar thickness.'));
      }
      checkConditional(item, [
        { when: 'structureType', is: 'Composite', then: 'compositeIndex' },
        { when: 'structureType', is: 'Profile', then: 'profileGuid' }
      ], base, issues, 'BatchCreateElements[Wall]');
    }
  }
  return issues;
}

// C10: mirrors EditBuildingElementCommand.cpp HEIGHT_CONSTRAINT_CONFLICT
// (hasHeight && ((hasRelativeTopStory && relativeTopStory > 0) || hasTopOffset)).
// relativeTopStory:0 is a LEGAL explicit top-link unlink. This is a Wall-only
// rule: an unknown or non-Wall element type must never be forced through it,
// because Beam topOffset has a different meaning and Column height is legal.
const HEIGHT_INHERITABLE = ['elementType', 'type', 'height', 'topOffset', 'relativeTopStory'];
function checkWallHeightConstraint (params, pointer, issues, label) {
  const declared = params.elementType !== undefined ? params.elementType : params.type;
  if (declared === undefined || String(declared).toLowerCase() !== 'wall') return;
  if (!hasValue(params.height)) return;
  const hasTopOffset = hasValue(params.topOffset);
  const relative = params.relativeTopStory;
  const hasNonZeroTopLink = hasValue(relative) && Number(relative) > 0;
  if (hasTopOffset || hasNonZeroTopLink) {
    issues.push(issue(`${pointer}/height`, 'height', 'heightConstraintConflict',
      `${label}: Wall height cannot be combined with a non-zero relativeTopStory or topOffset.`));
  }
}
// Creation has a known Wall type, so apply the exact native top-link rules.
// Omitted topOffset may depend on host defaults; no speculative rejection.
function checkWallCreationTop (params, pointer, issues) {
  checkWallHeightConstraint({ ...params, elementType: 'Wall' }, pointer, issues, 'CreateWall');
  if (hasValue(params.relativeTopStory) && (!Number.isInteger(params.relativeTopStory)
      || params.relativeTopStory < 0 || params.relativeTopStory > 32767)) {
    issues.push(issue(`${pointer}/relativeTopStory`, 'relativeTopStory', 'integerRange', 'relativeTopStory must be an integer from 0 to 32767.'));
  }
  if (hasValue(params.topOffset) && (typeof params.topOffset !== 'number' || !Number.isFinite(params.topOffset))) {
    issues.push(issue(`${pointer}/topOffset`, 'topOffset', 'finiteNumber', 'topOffset must be finite meters.'));
  }
  if (params.relativeTopStory === 0 && hasValue(params.topOffset)) {
    issues.push(issue(`${pointer}/topOffset`, 'topOffset', 'topOffsetRequiresTopLink', 'topOffset requires a non-zero effective top-link.'));
  }
}
function effectiveEditFields (root, item) {
  // Batch items inherit root-level edit fields; an item's EXPLICIT value wins,
  // so an explicit relativeTopStory:0 legitimately unlinks a root top-link.
  const merged = {};
  for (const field of HEIGHT_INHERITABLE) if (hasValue(root[field])) merged[field] = root[field];
  for (const field of HEIGHT_INHERITABLE) if (hasValue(item[field])) merged[field] = item[field];
  return merged;
}

function preflightEditBuildingElement (params) {
  const issues = [];
  // OFF-03: layer identity is an ordinary inherited edit field, valid at root and
  // inside each batch item; C++ ResolveLayerBinding rejects both together.
  checkExclusivePair(params, ['layerGuid', 'layerName'], '', issues, 'EditBuildingElement');
  // C10: root-level field combinations use the same exact Wall rule.
  checkWallHeightConstraint(params, '', issues, 'EditBuildingElement');
  const items = params.elements || params.items;
  if (Array.isArray(items)) {
    if (params.elements && params.items) {
      issues.push(issue('/elements', 'elements', 'exclusiveFields',
        'EditBuildingElement: "elements" and "items" are aliases; provide only one.'));
      return issues;
    }
    if (items.length === 0 || items.length > MAX_BATCH) {
      issues.push(issue('/elements', 'elements', 'arrayBounds',
        `EditBuildingElement: batch size must be within 1..${MAX_BATCH}, got ${items.length}.`));
      return issues;
    }
    if (hasValue(params.target)) {
      issues.push(issue('/target', 'target', 'exclusiveFields',
        'EditBuildingElement: "target=currentSelection" cannot be combined with a batch list.'));
      return issues;
    }
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const base = `/${params.elements ? 'elements' : 'items'}/${i}`;
      if (item === null || typeof item !== 'object') {
        issues.push(issue(base, 'elements', 'type', `EditBuildingElement: item ${i} must be an object.`));
        continue;
      }
      if (!hasValue(item.elementGuid) && !hasValue(item.guid)) {
        issues.push(issue(`${base}/elementGuid`, 'elementGuid', 'required',
          `EditBuildingElement: item ${i} requires "elementGuid".`));
      }
      for (const forbidden of BATCH_ITEM_FORBIDDEN_FIELDS) {
        if (hasValue(item[forbidden])) {
          issues.push(issue(`${base}/${forbidden}`, forbidden, 'itemControlForbidden',
            `EditBuildingElement: batch items must not carry "${forbidden}" (root-level control field).`));
        }
      }
      checkExclusivePair(item, ['layerGuid', 'layerName'], base, issues, `EditBuildingElement item ${i}`);
      // C10: exact C++ condition, Wall-only, with legal batch inheritance.
      checkWallHeightConstraint(effectiveEditFields(params, item), base, issues,
        `EditBuildingElement item ${i}`);
    }
  }
  return issues;
}

/**
 * Deterministic preflight for add-on command parameters.
 * @param {string} commandName PascalCase add-on command name (e.g. "CreateColumn").
 * @param {object} parameters addOnCommandParameters (or parameters) object.
 * @returns {{ok:true}|{ok:false,errorType:string,message:string,statusCode:number,parameterDiagnostics:object[]}}
 */
function preflightCommandParameters (commandName, parameters) {
  const name = String(commandName || '');
  const params = (parameters && typeof parameters === 'object') ? parameters : {};
  let issues = [];

  if (RULES[name]) {
    issues = preflightSimple(name, params, RULES[name]);
    if (name === 'CreateWall') checkWallCreationTop(params, '', issues);
  } else if (name === 'BatchCreateElements') {
    issues = preflightBatchCreate(params);
  } else if (name === 'EditBuildingElement') {
    issues = preflightEditBuildingElement(params);
  } else {
    // Untouched commands pass through; the native schema stays authoritative.
    return { ok: true };
  }

  if (issues.length === 0) return { ok: true };
  return {
    ok: false,
    errorType: 'PARAMETER_PRECHECK_FAILED',
    statusCode: 422,
    message: `${name}: ${issues[0].message}${issues.length > 1 ? ` (+${issues.length - 1} more issue(s))` : ''}`,
    parameterDiagnostics: issues
  };
}

module.exports = { preflightCommandParameters, EDIT_TYPE_WHITELIST };
