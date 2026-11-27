const fs = require('fs');
const path = require('path');
const { SUPPORTED_UI_LOCALES, normalizeUiLocale } = require('./ui-locale');

// Fresh installs default to English. Persisted UI/KB choices remain authoritative.
const DEFAULT_LOCALE = 'en-US';
const PACKAGE_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_MANIFEST_PATH = path.join(PACKAGE_ROOT, 'RELEASE_MANIFEST.json');

function readManifestLocale(manifestPath = DEFAULT_MANIFEST_PATH) {
  try {
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (SUPPORTED_UI_LOCALES.has(manifest.defaultLocale)) return manifest.defaultLocale;
    return SUPPORTED_UI_LOCALES.has(manifest.locale) ? manifest.locale : null;
  } catch (error) {
    console.warn(`[ReleaseLocale] Ignoring invalid manifest locale: ${error.message}`);
    return null;
  }
}

function resolveReleaseLocale(options = {}) {
  const env = options.env || process.env;
  for (const locale of [env.UI_LANGUAGE, env.MEPBRIDGE_LOCALE]) {
    if (SUPPORTED_UI_LOCALES.has(locale)) return locale;
  }

  const manifestLocale = readManifestLocale(options.manifestPath || DEFAULT_MANIFEST_PATH);
  return normalizeUiLocale(manifestLocale, DEFAULT_LOCALE);
}

module.exports = {
  DEFAULT_LOCALE,
  DEFAULT_MANIFEST_PATH,
  readManifestLocale,
  resolveReleaseLocale,
};
