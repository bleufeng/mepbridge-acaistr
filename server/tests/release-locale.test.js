const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_LOCALE,
  readManifestLocale,
  resolveReleaseLocale,
} = require('../services/release-locale');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mepbridge-release-locale-'));
const manifestPath = path.join(tempRoot, 'RELEASE_MANIFEST.json');

try {
  assert.strictEqual(
    resolveReleaseLocale({ env: {}, manifestPath }),
    DEFAULT_LOCALE
  );

  fs.writeFileSync(manifestPath, JSON.stringify({ locale: 'en-US' }));
  assert.strictEqual(readManifestLocale(manifestPath), 'en-US');
  assert.strictEqual(resolveReleaseLocale({ env: {}, manifestPath }), 'en-US');

  assert.strictEqual(
    resolveReleaseLocale({
      env: { UI_LANGUAGE: 'zh-CN', MEPBRIDGE_LOCALE: 'en-US' },
      manifestPath,
    }),
    'zh-CN'
  );
  assert.strictEqual(
    resolveReleaseLocale({
      env: { MEPBRIDGE_LOCALE: 'zh-CN' },
      manifestPath,
    }),
    'zh-CN'
  );
  assert.strictEqual(
    resolveReleaseLocale({
      env: { UI_LANGUAGE: 'invalid-locale' },
      manifestPath,
    }),
    'en-US'
  );

  fs.writeFileSync(manifestPath, '{ invalid json');
  assert.strictEqual(resolveReleaseLocale({ env: {}, manifestPath }), DEFAULT_LOCALE);

  console.log('release locale test passed');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
