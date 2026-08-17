'use strict';

const fs = require('fs');
const path = require('path');

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function readRequiredText(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8').trim();
}

function readAppVersion(root = PROJECT_ROOT) {
  const versionPath = path.join(root, 'VERSION');
  const configPath = path.join(root, 'config.json');
  const version = readRequiredText(versionPath, 'VERSION');
  const configText = readRequiredText(configPath, 'config.json');

  if (!STABLE_SEMVER.test(version)) {
    throw new Error(`VERSION must use stable SemVer, found: ${version}`);
  }

  let config;
  try {
    config = JSON.parse(configText);
  } catch (error) {
    throw new Error(`config.json is invalid JSON: ${error.message}`);
  }

  if (!STABLE_SEMVER.test(String(config.version || ''))) {
    throw new Error(`config.json.version must use stable SemVer, found: ${config.version}`);
  }
  if (config.version !== version) {
    throw new Error(`Version mismatch: VERSION=${version}, config.json=${config.version}`);
  }

  return version;
}

const APP_VERSION = readAppVersion();

module.exports = {
  APP_VERSION,
  PROJECT_ROOT,
  STABLE_SEMVER,
  readAppVersion
};
