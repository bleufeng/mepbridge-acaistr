const fs = require('fs');
const path = require('path');
const {
  readJsonFile,
  resolveInside,
  validateDescriptorDocument,
  validateManifest,
  validateRegistry,
} = require('../server/services/module-validation');

const workspace = path.resolve(__dirname, '..');
const modulesRoot = path.join(workspace, 'modules');
const registryPath = path.join(modulesRoot, 'registry.json');
const forbiddenSourcePatterns = [
  { pattern: /\brequire\s*\(\s*['"](?:child_process|cluster|worker_threads|net|tls|dgram|http|https|fs|fs\/promises|module|vm)['"]\s*\)/, label: 'restricted Node module import' },
  { pattern: /\bimport\s*\(/, label: 'dynamic import' },
  { pattern: /\beval\s*\(/, label: 'eval' },
  { pattern: /\bnew\s+Function\s*\(/, label: 'dynamic Function constructor' },
  { pattern: /\bprocess\./, label: 'direct process access' },
];

function listJavaScriptFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(fullPath));
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

function fail(errors) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
}

function main() {
  const errors = [];
  const registry = readJsonFile(registryPath);
  errors.push(...validateRegistry(registry));

  const globalCommands = new Set();
  for (const entry of registry.modules || []) {
    const moduleRoot = resolveInside(modulesRoot, entry.path, `module path for ${entry.id}`);
    const manifest = readJsonFile(path.join(moduleRoot, 'manifest.json'));
    errors.push(...validateManifest(manifest, entry.id).map((error) => `${entry.id}: ${error}`));

    const entryPath = resolveInside(moduleRoot, manifest.entry, `entry for ${entry.id}`);
    const descriptorsPath = resolveInside(moduleRoot, manifest.descriptors, `descriptors for ${entry.id}`);
    if (!fs.existsSync(entryPath)) errors.push(`${entry.id}: entry file is missing`);

    const descriptorDocument = readJsonFile(descriptorsPath);
    errors.push(
      ...validateDescriptorDocument(descriptorDocument, entry.id)
        .map((error) => `${entry.id}: ${error}`)
    );

    for (const command of descriptorDocument.commands || []) {
      if (globalCommands.has(command.name)) {
        errors.push(`duplicate command across modules: ${command.name}`);
      }
      globalCommands.add(command.name);
    }

    for (const sourcePath of listJavaScriptFiles(path.join(moduleRoot, 'server'))) {
      const source = fs.readFileSync(sourcePath, 'utf8');
      for (const rule of forbiddenSourcePatterns) {
        if (rule.pattern.test(source)) {
          errors.push(`${path.relative(workspace, sourcePath)}: ${rule.label} is not allowed`);
        }
      }
    }
  }

  if (errors.length > 0) {
    fail(errors);
    return;
  }

  console.log(
    `Validated ${registry.modules.length} reviewed module(s) and ` +
    `${globalCommands.size} namespaced module command(s)`
  );
}

try {
  main();
} catch (error) {
  fail([error.message]);
}
