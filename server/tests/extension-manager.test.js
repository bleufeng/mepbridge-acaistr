const assert = require('assert');
const path = require('path');
const { ExtensionManager } = require('../services/extension-manager');

async function main() {
  const calls = [];
  const manager = new ExtensionManager({
    modulesRoot: path.resolve(__dirname, '../../modules'),
    descriptorRegistryPath: path.resolve(__dirname, '../../ai-adapter/tool-descriptors.json'),
    archicadClient: {
      async executeCommand(commandName) {
        calls.push(commandName);
        return { success: true, data: { commandName } };
      },
    },
    startTimers: false,
    timeoutMs: 1000,
  });

  await manager.initialize();
  assert.strictEqual(manager.getStats().total, 1);
  assert.strictEqual(manager.getStats().commands, 1);

  const result = await manager.executeCommand('project-insights.get-summary', {});
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(calls, [
    'MEPBridge.GetProjectInfo',
    'MEPBridge.GetStories',
  ]);

  const missing = await manager.executeCommand('project-insights.missing', {});
  assert.strictEqual(missing.errorType, 'MODULE_COMMAND_NOT_FOUND');

  const invalid = await manager.executeCommand('project-insights.get-summary', { extra: true });
  assert.strictEqual(invalid.errorType, 'MODULE_PARAMETER_VALIDATION_ERROR');
  manager.shutdown();
}

main().then(
  () => console.log('extension-manager test passed'),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
