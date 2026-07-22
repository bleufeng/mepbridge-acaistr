const assert = require('assert');
const { _test } = require('../routes/mcp-status');

function main() {
  let invocation = null;
  const processText = _test.getRunningProcessText('win32', (command, args, options) => {
    invocation = { command, args, options };
    return [
      '"ChatGPT.exe","1234","Console","1","100,000 K"',
      '"Cursor.exe","5678","Console","1","200,000 K"',
    ].join('\r\n');
  });

  assert.strictEqual(invocation.command, 'tasklist.exe');
  assert.deepStrictEqual(invocation.args, ['/FO', 'CSV', '/NH']);
  assert.strictEqual(invocation.options.windowsHide, true);
  assert.deepStrictEqual(invocation.options.stdio, ['ignore', 'pipe', 'ignore']);
  assert.strictEqual(_test.isHostRunning(processText, ['chatgpt.exe']), true);
  assert.strictEqual(_test.isHostRunning(processText, ['claude.exe']), false);

  const failed = _test.getRunningProcessText('win32', () => {
    throw new Error('access denied');
  });
  assert.strictEqual(failed, '');
}

main();
console.log('mcp-status test passed');
