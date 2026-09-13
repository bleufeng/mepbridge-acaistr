'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = 'UI_BUILD_MANIFEST.json';
const SCHEMA_VERSION = 1;

function normalizeRelativePath(relativePath) {
  return relativePath.replaceAll(path.sep, '/');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function collectFiles(directory, baseDirectory, excludedNames = new Set()) {
  const files = new Map();
  if (!fs.existsSync(directory)) return files;

  const visit = (currentDirectory) => {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = normalizeRelativePath(path.relative(baseDirectory, absolutePath));
      if (excludedNames.has(relativePath)) continue;
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.set(relativePath, sha256File(absolutePath));
      }
    }
  };
  visit(directory);
  return files;
}

function filesSection(files) {
  const entries = [...files.entries()].sort(([a], [b]) => a.localeCompare(b));
  const canonical = entries
    .map(([relativePath, hash]) => `${relativePath}\0${hash}`)
    .join('\n');
  return {
    fileCount: entries.length,
    files: Object.fromEntries(entries),
    sha256: crypto.createHash('sha256').update(canonical).digest('hex').toUpperCase()
  };
}

function computeUiBuildManifest(root) {
  const repoRoot = path.resolve(root);
  const uiRoot = path.join(repoRoot, 'ai-adapter', 'ui', 'v0.1.0');
  const distRoot = path.join(uiRoot, 'dist');

  const packageDocument = JSON.parse(fs.readFileSync(path.join(uiRoot, 'package.json'), 'utf8'));
  const productVersion = fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();
  const inputFiles = new Map();

  const addInputDirectory = (relativeDirectory) => {
    const directory = path.join(uiRoot, relativeDirectory);
    for (const [relativePath, hash] of collectFiles(directory, uiRoot)) {
      inputFiles.set(relativePath, hash);
    }
  };
  const addInputFile = (relativePath) => {
    const absolutePath = path.join(uiRoot, relativePath);
    if (fs.existsSync(absolutePath)) {
      inputFiles.set(normalizeRelativePath(relativePath), sha256File(absolutePath));
    }
  };

  addInputDirectory('src');
  addInputDirectory('public');
  for (const relativePath of [
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
    'index.html',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'build-manifest.cjs',
    '../../../VERSION'
  ]) {
    addInputFile(relativePath);
  }

  return {
    schema: SCHEMA_VERSION,
    productVersion,
    uiVersion: packageDocument.version,
    source: filesSection(inputFiles),
    output: filesSection(collectFiles(distRoot, uiRoot, new Set([`dist/${MANIFEST_NAME}`])))
  };
}

function uiBuildManifestPath(root) {
  return path.join(root, 'ai-adapter', 'ui', 'v0.1.0', 'dist', MANIFEST_NAME);
}

function writeUiBuildManifest(root) {
  const manifest = computeUiBuildManifest(root);
  const manifestPath = uiBuildManifestPath(root);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function validateUiBuildManifest(actual, expected) {
  const differences = [];
  const compareValue = (field) => {
    if (actual?.[field] !== expected[field]) {
      differences.push(`${field}: expected ${JSON.stringify(expected[field])}, found ${JSON.stringify(actual?.[field])}`);
    }
  };
  const compareSection = (section) => {
    compareValue(`${section}.fileCount`);
    compareValue(`${section}.sha256`);
    const expectedFiles = expected[section]?.files || {};
    const actualFiles = actual?.[section]?.files || {};
    for (const [relativePath, hash] of Object.entries(expectedFiles)) {
      if (actualFiles[relativePath] !== hash) {
        differences.push(`${section}.files[${relativePath}]: expected ${hash}, found ${actualFiles[relativePath] || '(missing)'}`);
      }
    }
    for (const relativePath of Object.keys(actualFiles)) {
      if (!Object.prototype.hasOwnProperty.call(expectedFiles, relativePath)) {
        differences.push(`${section}.files[${relativePath}]: unexpected file`);
      }
    }
  };

  compareValue('schema');
  compareValue('productVersion');
  compareValue('uiVersion');
  compareSection('source');
  compareSection('output');
  return differences;
}

module.exports = {
  MANIFEST_NAME,
  computeUiBuildManifest,
  validateUiBuildManifest,
  writeUiBuildManifest
};
