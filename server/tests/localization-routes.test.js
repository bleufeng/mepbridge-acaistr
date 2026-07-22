const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mepbridge-localization-routes-'));
process.env.MEPBRIDGE_DATA_DIR = TEST_DATA_DIR;

const CJK_PATTERN = /[\u3400-\u9fff]/;

function assertNoCjk(label, value) {
  const serialized = JSON.stringify(value);
  assert.strictEqual(CJK_PATTERN.test(serialized), false, `${label} contains CJK text: ${serialized}`);
}

async function startTestServer() {
  const aiAdapterPath = require.resolve('../services/ai-adapter');
  const archicadClientPath = require.resolve('../services/archicad-client');

  require.cache[aiAdapterPath] = {
    id: aiAdapterPath,
    filename: aiAdapterPath,
    loaded: true,
    exports: {
      llm: null,
      async getModelSnapshot() { return null; },
      async getProjectContext() { return null; },
      async generatePlan() {
        return { unsupported: true, steps: [], isMutation: false };
      },
    },
  };
  require.cache[archicadClientPath] = {
    id: archicadClientPath,
    filename: archicadClientPath,
    loaded: true,
    exports: {
      async executeCommand() {
        return { success: true, data: { elements: [] } };
      },
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/api/user-assets', require('../routes/user-assets'));
  app.use('/api/copilot/message', require('../routes/copilot-message'));
  app.use('/api/plan-chain', require('../routes/plan-chain'));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  assert.ok(response.ok, `${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const { server, baseUrl } = await startTestServer();
  try {
    const initialAssets = await requestJson(`${baseUrl}/api/user-assets/load?locale=en-US`);
    assert.strictEqual(initialAssets.locale, 'en-US');
    assert.strictEqual(initialAssets.templates.length, 5);
    assert.strictEqual(initialAssets.commands.length, 5);
    assertNoCjk('First-run English user asset response', {
      templates: initialAssets.templates,
      commands: initialAssets.commands,
    });

    const reset = await requestJson(`${baseUrl}/api/user-assets/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'en-US' }),
    });
    assert.strictEqual(reset.locale, 'en-US');
    assert.deepStrictEqual(reset.stats, { templates: 5, commands: 5 });

    const assets = await requestJson(`${baseUrl}/api/user-assets/load?locale=en-US`);
    assert.strictEqual(assets.locale, 'en-US');
    assert.strictEqual(assets.templates.length, 5);
    assert.strictEqual(assets.commands.length, 5);
    assertNoCjk('English user asset response', {
      templates: assets.templates,
      commands: assets.commands,
    });

    const copilot = await requestJson(`${baseUrl}/api/copilot/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'create slab', locale: 'en-US' }),
    });
    assert.strictEqual(copilot.isMepAction, true);
    assertNoCjk('English Copilot response', copilot);

    const unsupported = await requestJson(`${baseUrl}/api/copilot/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'unrecognized example request', locale: 'en-US' }),
    });
    assert.strictEqual(unsupported.isMepAction, false);
    assert.match(unsupported.message, /could not understand/i);
    assertNoCjk('English unsupported response', unsupported);

    const chain = await requestJson(`${baseUrl}/api/plan-chain/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'create slab',
        locale: 'en-US',
        mode: 'manual-strict',
      }),
    });
    assert.strictEqual(chain.status, 'preview');
    assert.match(chain.summary, /step plan/i);
    assertNoCjk('English plan-chain preview', chain);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

main().then(
  () => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    console.log('localization route test passed');
  },
  (error) => {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    console.error(error);
    process.exitCode = 1;
  }
);
