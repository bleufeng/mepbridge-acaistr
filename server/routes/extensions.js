const express = require('express');
const extensionManager = require('../services/extension-manager');

const router = express.Router();

async function ensureReady(_req, res, next) {
  try {
    await extensionManager.ready;
    next();
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: 'Reviewed module registry is unavailable',
      errorType: 'MODULE_REGISTRY_UNAVAILABLE',
    });
  }
}

function resultStatus(result) {
  switch (result?.errorType) {
    case 'MODULE_COMMAND_NOT_FOUND':
    case 'MODULE_COMMAND_MISMATCH':
      return 404;
    case 'MODULE_OFFLINE':
      return 503;
    case 'MODULE_PARAMETERS_INVALID':
    case 'MODULE_PARAMETERS_TOO_LARGE':
    case 'MODULE_PARAMETER_VALIDATION_ERROR':
    case 'MODULE_CONFIRMATION_REQUIRED':
      return 400;
    case 'MODULE_PERMISSION_DENIED':
    case 'MODULE_COMMAND_NOT_ALLOWED':
      return 403;
    case 'MODULE_TIMEOUT':
      return 504;
    default:
      return 422;
  }
}

router.use(ensureReady);

router.get('/catalog', (_req, res) => {
  const modules = extensionManager.getCatalog();
  res.json({
    ok: true,
    apiVersion: '1',
    modules,
    count: modules.length,
  });
});

router.get('/status', (_req, res) => {
  res.json({
    ok: true,
    extensions: extensionManager.getExtensionStatus(),
    timestamp: new Date().toISOString(),
  });
});

router.get('/stats', (_req, res) => {
  res.json({ ok: true, stats: extensionManager.getStats() });
});

router.get('/memory', (_req, res) => {
  res.json({ ok: true, memory: extensionManager.getMemoryUsage() });
});

router.get('/commands/all', (_req, res) => {
  const commands = extensionManager.getAllCommands();
  res.json({ ok: true, commands, count: commands.length });
});

router.post('/commands/:commandName/execute', async (req, res) => {
  const commandName = decodeURIComponent(req.params.commandName);
  const parameters = req.body?.parameters || {};
  const result = await extensionManager.executeCommand(commandName, parameters);

  if (!result.success) {
    return res.status(resultStatus(result)).json({
      ok: false,
      command: commandName,
      ...result,
    });
  }

  res.json({ ok: true, command: commandName, result });
});

router.get('/:name/features', (req, res) => {
  const info = extensionManager.getExtensionInfo(req.params.name);
  if (!info) {
    return res.status(404).json({
      ok: false,
      error: `Module not found: ${req.params.name}`,
      errorType: 'MODULE_NOT_FOUND',
    });
  }
  res.json({ ok: true, features: info.features || [] });
});

router.post('/:name/reload', async (req, res) => {
  try {
    const extension = await extensionManager.reloadExtension(req.params.name);
    res.json({
      ok: true,
      message: `Module reloaded: ${extension.id}`,
      extensions: extensionManager.getExtensionStatus(),
    });
  } catch (error) {
    res.status(404).json({
      ok: false,
      error: error.message,
      errorType: 'MODULE_RELOAD_FAILED',
    });
  }
});

router.post('/:name/clear-cache', (req, res) => {
  extensionManager.clearCache(req.params.name);
  res.json({ ok: true, message: `Module cache cleared: ${req.params.name}` });
});

router.post('/:name/execute', async (req, res) => {
  const moduleId = extensionManager.resolveExtensionId(req.params.name);
  if (!moduleId) {
    return res.status(404).json({
      ok: false,
      error: `Module not found: ${req.params.name}`,
      errorType: 'MODULE_NOT_FOUND',
    });
  }

  const commandName = req.body?.commandName;
  if (typeof commandName !== 'string' || commandName.trim() === '') {
    return res.status(400).json({
      ok: false,
      error: 'commandName is required',
      errorType: 'MISSING_COMMAND_NAME',
    });
  }

  const result = await extensionManager.executeCommand(
    commandName,
    req.body?.parameters || {},
    moduleId
  );
  if (!result.success) {
    return res.status(resultStatus(result)).json({
      ok: false,
      command: commandName,
      extension: moduleId,
      ...result,
    });
  }

  res.json({
    ok: true,
    command: commandName,
    extension: moduleId,
    result,
  });
});

router.get('/:name', (req, res) => {
  const info = extensionManager.getExtensionInfo(req.params.name);
  if (!info) {
    return res.status(404).json({
      ok: false,
      error: `Module not found: ${req.params.name}`,
      errorType: 'MODULE_NOT_FOUND',
    });
  }
  res.json({ ok: true, extension: info });
});

module.exports = router;
