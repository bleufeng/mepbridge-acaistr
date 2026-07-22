'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || process.cwd());
const failures = [];
const skippedDirectories = new Set(['.git', 'node_modules', 'dist', '.vite']);
const blockedTopLevel = new Set([
  'Sources',
  'RINT',
  'RFIX',
  'RFIX.win',
  'Handoff',
  'packaging',
  'tests',
  'build',
  'outputs',
  'user-data',
]);
const blockedExtensions = new Set([
  '.apx',
  '.pln',
  '.zip',
  '.map',
  '.log',
  '.pdb',
  '.obj',
  '.ilk',
]);
const textExtensions = new Set([
  '',
  '.cjs',
  '.css',
  '.editorconfig',
  '.example',
  '.gitignore',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yml',
  '.yaml',
]);
const forbiddenText = [
  { label: 'internal Handoff path', pattern: /\bHandoff[\\/]/i },
  { label: 'private repository topology', pattern: /\bprivate (?:C\+\+ )?repository\b/i },
  { label: 'hard-coded engineering workspace', pattern: /\bI:[\\/]AI-KOA[\\/]mep-bridge-addon\b/i },
  { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'GitHub token', pattern: /(?:^|[^A-Za-z0-9_])(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/ },
  { label: 'OpenAI-style key', pattern: /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/ },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

function relative(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function requireFile(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    failures.push(`Required public file is missing: ${relativePath}`);
  }
}

function parseJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    failures.push(`Invalid JSON in ${relative(filePath)}: ${error.message}`);
    return null;
  }
}

function checkMarkdownLinks(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (!target || target.startsWith('#') || /^(?:https?|mailto):/i.test(target)) continue;

    const decoded = decodeURIComponent(target.split(/[?#]/, 1)[0]);
    const resolved = path.resolve(path.dirname(filePath), decoded);
    const leavesRoot = resolved !== root && !resolved.startsWith(`${root}${path.sep}`);
    if (leavesRoot || !fs.existsSync(resolved)) {
      failures.push(`Broken or out-of-root Markdown link in ${relative(filePath)}: ${target}`);
    }
  }
}

function checkReadmeLanguageEntrypoints() {
  const englishReadmePath = path.join(root, 'README.md');
  const chineseReadmePath = path.join(root, 'README.zh-CN.md');
  if (!fs.existsSync(englishReadmePath) || !fs.existsSync(chineseReadmePath)) return;

  const englishReadme = fs.readFileSync(englishReadmePath, 'utf8');
  const chineseReadme = fs.readFileSync(chineseReadmePath, 'utf8');

  if (!englishReadme.includes('## Release Scope')) {
    failures.push('README.md must remain the English default GitHub entrypoint.');
  }
  if (!englishReadme.includes('[中文说明](README.zh-CN.md)')) {
    failures.push('README.md must link to README.zh-CN.md.');
  }
  if (!chineseReadme.includes('## 发布范围')) {
    failures.push('README.zh-CN.md must remain the Chinese entrypoint.');
  }
  if (!chineseReadme.includes('[English](README.md)')) {
    failures.push('README.zh-CN.md must link back to README.md.');
  }
}

for (const requiredPath of [
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  'NOTICE',
  '.github/CONTRIBUTING.md',
  '.github/SECURITY.md',
  '.github/SUPPORT.md',
  'docs/contributors/MODULE_DEVELOPMENT.md',
  'docs/contributors/PUBLIC_SOURCE_BOUNDARY.md',
  'ai-adapter/tool-descriptors.json',
  'modules/registry.json',
  'server/server.js',
  'tools/mepbridge-mcp-server.js',
  'tools/validate-modules.js',
  'tools/validate-public-repository.js',
]) {
  requireFile(requiredPath);
}

checkReadmeLanguageEntrypoints();

for (const unwantedPath of [
  'docs/contributors/REPOSITORY_STRATEGY.md',
  'ai-adapter/ui/v0.1.0/assets/.aistudio',
]) {
  if (fs.existsSync(path.join(root, unwantedPath))) {
    failures.push(`Non-public resource is present: ${unwantedPath}`);
  }
}

const files = walk(root);
for (const filePath of files) {
  const relativePath = relative(filePath);
  const firstSegment = relativePath.split('/', 1)[0];
  if (blockedTopLevel.has(firstSegment)) {
    failures.push(`Blocked top-level path is present: ${relativePath}`);
  }
  if (blockedExtensions.has(path.extname(filePath).toLowerCase())) {
    failures.push(`Blocked file type is present: ${relativePath}`);
  }

  const extension = path.extname(filePath).toLowerCase();
  if (relativePath === 'tools/validate-public-repository.js') continue;
  if (!textExtensions.has(extension) || fs.statSync(filePath).size > 5 * 1024 * 1024) continue;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      failures.push(`Trailing whitespace in ${relativePath}:${index + 1}`);
    }
  });
  if (content.endsWith('\n\n')) {
    failures.push(`Extra blank line at end of ${relativePath}`);
  }

  for (const rule of forbiddenText) {
    if (rule.pattern.test(content)) {
      failures.push(`${rule.label} found in ${relativePath}`);
    }
  }
  if (extension === '.json') parseJson(filePath);
  if (extension === '.md') checkMarkdownLinks(filePath);
}

const descriptorRegistry = parseJson(path.join(root, 'ai-adapter/tool-descriptors.json'));
if (descriptorRegistry && (!Array.isArray(descriptorRegistry.descriptors) || descriptorRegistry.descriptors.length !== 59)) {
  failures.push('Core descriptor count must be 59.');
}

const moduleRegistry = parseJson(path.join(root, 'modules/registry.json'));
const trustedModules = moduleRegistry?.modules?.filter((module) => module.enabled && module.trusted) || [];
if (trustedModules.length < 1) {
  failures.push('At least one enabled trusted Workbench module is required.');
}

const uiPackage = parseJson(path.join(root, 'ai-adapter/ui/v0.1.0/package.json'));
if (uiPackage && uiPackage.name !== 'mepbridge-acaistr-workbench') {
  failures.push('UI package name must be mepbridge-acaistr-workbench.');
}

if (failures.length > 0) {
  console.error('Public repository validation failed:');
  for (const failure of [...new Set(failures)].sort()) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'ok',
  root,
  fileCount: files.length,
  descriptorCount: descriptorRegistry.descriptors.length,
  trustedModuleCount: trustedModules.length,
}, null, 2));
