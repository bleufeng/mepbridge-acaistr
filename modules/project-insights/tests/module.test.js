const assert = require('assert');
const createModule = require('../server/index');
const manifest = require('../manifest.json');
const descriptors = require('../descriptors.json').commands;

async function main() {
  const calls = [];
  const context = {
    async executeArchicad(commandName) {
      calls.push(commandName);
      return { success: true, data: { commandName } };
    },
  };

  const moduleInstance = createModule(context, manifest, descriptors);
  assert.strictEqual(await moduleInstance.isAvailable(), true);
  assert.strictEqual((await moduleInstance.getCommands()).length, 1);

  const result = await moduleInstance.execute('project-insights.get-summary', {});
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(calls, [
    'MEPBridge.GetProjectInfo',
    'MEPBridge.GetStories',
  ]);
}

main().then(
  () => console.log('project-insights module test passed'),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
