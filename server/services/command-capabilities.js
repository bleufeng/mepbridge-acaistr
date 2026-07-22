const DRY_RUN_AND_CONFIRM_COMMANDS = new Set([
  'BatchCreateElements',
  'ChangeElementGeometry',
  'ChangeMEPRouteProperties',
  'ChangeOpeningGeometry',
  'ChangeStairGeometry',
  'CopyElements',
  'CreateBeam',
  'CreateColumn',
  'CreateDoor',
  'CreateFlexibleSegment',
  'CreateLamp',
  'CreateMesh',
  'CreateObject',
  'CreateRoof',
  'CreateSlab',
  'CreateStair',
  'CreateTakeOff',
  'CreateWall',
  'CreateWindow',
  'CreateZone',
  'DeleteElements',
  'MirrorSelectedElements',
  'MoveSelectedElements',
  'RotateSelectedElements',
  'SetSelectedElements',
  'SetStories',
]);

const CONFIRM_ONLY_COMMANDS = new Set([
  'AutoRoutePipe',
  'EditElements',
  'EditSelectedElements',
  'MoveElements',
]);

function getCommandSafetyCapabilities(commandName) {
  const dryRun = DRY_RUN_AND_CONFIRM_COMMANDS.has(commandName);
  return {
    dryRun,
    confirmRequired: dryRun || CONFIRM_ONLY_COMMANDS.has(commandName),
  };
}

function normalizeCommandSafetyParameters(commandName, params) {
  const normalized = { ...(params || {}) };
  const capabilities = getCommandSafetyCapabilities(commandName);

  if (!capabilities.dryRun) delete normalized.dryRun;
  if (!capabilities.confirmRequired) delete normalized.confirmRequired;

  return normalized;
}

function applyDefaultSafetyParameters(commandName, params, defaults = {}) {
  const normalized = normalizeCommandSafetyParameters(commandName, params);
  const capabilities = getCommandSafetyCapabilities(commandName);

  if (capabilities.dryRun && normalized.dryRun === undefined && defaults.dryRun !== undefined) {
    normalized.dryRun = defaults.dryRun;
  }
  if (capabilities.confirmRequired && normalized.confirmRequired === undefined && defaults.confirmRequired !== undefined) {
    normalized.confirmRequired = defaults.confirmRequired;
  }

  return normalized;
}

module.exports = {
  applyDefaultSafetyParameters,
  getCommandSafetyCapabilities,
  normalizeCommandSafetyParameters,
};
