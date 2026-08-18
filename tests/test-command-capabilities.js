const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  applyDefaultSafetyParameters,
  getCommandSafetyCapabilities,
  normalizeCommandSafetyParameters,
} = require('../server/services/command-capabilities');

// A write command missing from DRY_RUN_AND_CONFIRM_COMMANDS has its
// dryRun/confirmRequired stripped before the call, so the Add-On falls back to
// its `dryRun = true` default and the write silently never happens while still
// reporting success. AssignClassification, ApplyFavorite, CreateFromFavorite,
// SaveFavorite and SetLayerBatch all shipped in v0.1.1 with that defect; it only
// surfaced when a real assignment was attempted against AC29 on 2026-08-01.
const sourcesRoot = path.resolve(__dirname, '../Sources');
if (fs.existsSync(sourcesRoot)) {
  const cppDryRunCommands = fs
    .readdirSync(sourcesRoot)
    .filter((name) => name.endsWith('Command.cpp'))
    .filter((name) => fs.readFileSync(path.join(sourcesRoot, name), 'utf8').includes('parameters.Get ("dryRun"'))
    .map((name) => name.replace(/Command\.cpp$/, ''))
    .sort();

  assert(cppDryRunCommands.length > 0, 'Expected to find C++ commands reading dryRun');

  const notWhitelisted = cppDryRunCommands.filter(
    (commandName) => !getCommandSafetyCapabilities(commandName).dryRun
  );
  assert.deepStrictEqual(
    notWhitelisted,
    [],
    'These commands enforce dryRun/confirmRequired in C++ but are missing from '
    + `DRY_RUN_AND_CONFIRM_COMMANDS, so their write parameters get stripped: ${notWhitelisted.join(', ')}`
  );

  for (const commandName of cppDryRunCommands) {
    assert.strictEqual(
      getCommandSafetyCapabilities(commandName).confirmRequired,
      true,
      `${commandName} must require confirmation`
    );
  }
}

assert.deepStrictEqual(
  getCommandSafetyCapabilities('CreateObject'),
  { dryRun: true, confirmRequired: true }
);
assert.deepStrictEqual(
  getCommandSafetyCapabilities('AssignClassification'),
  { dryRun: true, confirmRequired: true }
);
assert.deepStrictEqual(
  getCommandSafetyCapabilities('MoveElements'),
  { dryRun: false, confirmRequired: true }
);
assert.deepStrictEqual(
  getCommandSafetyCapabilities('SetStories'),
  { dryRun: true, confirmRequired: true }
);
assert.deepStrictEqual(
  getCommandSafetyCapabilities('DeleteMEPElements'),
  { dryRun: false, confirmRequired: false }
);

assert.deepStrictEqual(
  normalizeCommandSafetyParameters('CreateObject', {
    dryRun: false,
    confirmRequired: true,
    position: { x: 1, y: 2 },
  }),
  {
    dryRun: false,
    confirmRequired: true,
    position: { x: 1, y: 2 },
  }
);

assert.deepStrictEqual(
  normalizeCommandSafetyParameters('MoveElements', {
    dryRun: true,
    confirmRequired: true,
    routeGuids: ['A'],
  }),
  {
    confirmRequired: true,
    routeGuids: ['A'],
  }
);

for (const commandName of ['CreatePipe', 'CreateDuct', 'CreateCableCarrier']) {
  assert.deepStrictEqual(
    normalizeCommandSafetyParameters(commandName, {
      dryRun: true,
      confirmRequired: true,
      waypoints: [{ x: 0, y: 0, z: 3 }, { x: 5, y: 0, z: 3 }],
    }),
    {
      waypoints: [{ x: 0, y: 0, z: 3 }, { x: 5, y: 0, z: 3 }],
    },
    `${commandName} must not receive unsupported safety parameters`
  );
}

assert.deepStrictEqual(
  applyDefaultSafetyParameters('CreateObject', { position: { x: 1, y: 2 } }, {
    dryRun: true,
    confirmRequired: true,
  }),
  {
    position: { x: 1, y: 2 },
    dryRun: true,
    confirmRequired: true,
  }
);

const aiAdapter = require('../server/services/ai-adapter');
const registry = require('../ai-adapter/tool-descriptors.json');

function descriptor(name) {
  const found = registry.descriptors.find((item) => item.name === name);
  assert(found, `Missing descriptor: ${name}`);
  return found;
}

assert.deepStrictEqual(
  aiAdapter.buildPlanFromDescriptor(descriptor('mepbridge.set_stories'), 'test').steps[0].params,
  {
    dryRun: true,
    confirmRequired: true,
  }
);
assert.deepStrictEqual(
  aiAdapter.buildPlanFromDescriptor(descriptor('mepbridge.move_elements'), 'test').steps[0].params,
  {
    deltaMm: { x: 0, y: 0, z: 0 },
    confirmRequired: true,
  }
);

assert.deepStrictEqual(
  normalizeCommandSafetyParameters('AssignClassification', {
    elementGuid: 'AABBCC-DDDD-EEEE-FFFF-000000000001',
    assignItemGuid: 'AABBCC-DDDD-EEEE-FFFF-000000000002',
    dryRun: false,
    confirmRequired: true,
  }),
  {
    elementGuid: 'AABBCC-DDDD-EEEE-FFFF-000000000001',
    assignItemGuid: 'AABBCC-DDDD-EEEE-FFFF-000000000002',
    dryRun: false,
    confirmRequired: true,
  },
  'AssignClassification must keep both write-safety parameters'
);

console.log('Command safety capability tests passed.');
