'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);

function getArgument(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const root = path.resolve(getArgument('--root') || process.cwd());
const base = getArgument('--base');
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function requireContains(relativePath, expected, label) {
  if (!read(relativePath).includes(expected)) {
    failures.push(`${relativePath} does not contain ${label}: ${expected}`);
  }
}

function git(arguments_) {
  const safeDirectory = root.replaceAll('\\', '/');
  return execFileSync('git', [
    '-c',
    `safe.directory=${safeDirectory}`,
    '-C',
    root,
    ...arguments_,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function canResolveCommit(commit) {
  if (!commit || /^0+$/.test(commit)) return false;
  try {
    git(['cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function readVersionAt(commit) {
  try {
    return git(['show', `${commit}:VERSION`]).trim();
  } catch {
    return null;
  }
}

function readFileAt(commit, relativePath) {
  try {
    return git(['show', `${commit}:${relativePath}`]);
  } catch {
    return null;
  }
}

function extractUnreleased(content) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '## [Unreleased]');
  if (start < 0) return null;

  const nextHeading = lines.findIndex(
    (line, index) => index > start && /^##\s/.test(line),
  );
  return lines.slice(start + 1, nextHeading < 0 ? undefined : nextHeading)
    .join('\n')
    .trim();
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

const version = read('VERSION').trim();
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  failures.push(`VERSION must contain a stable Semantic Version, found: ${version}`);
}

const serverPackage = readJson('server/package.json');
const serverLock = readJson('server/package-lock.json');
const uiPackage = readJson('ai-adapter/ui/v0.1.0/package.json');
const uiLock = readJson('ai-adapter/ui/v0.1.0/package-lock.json');

for (const [label, value] of [
  ['server/package.json', serverPackage.version],
  ['server/package-lock.json', serverLock.version],
  ['server/package-lock.json root package', serverLock.packages?.['']?.version],
  ['UI package.json', uiPackage.version],
  ['UI package-lock.json', uiLock.version],
  ['UI package-lock.json root package', uiLock.packages?.['']?.version],
]) {
  if (value !== version) {
    failures.push(`${label} version must equal VERSION ${version}, found: ${value}`);
  }
}

const changelog = read('CHANGELOG.md');
if (!changelog.includes('## [Unreleased]')) {
  failures.push('CHANGELOG.md must contain ## [Unreleased].');
}
const escapedVersion = version.replaceAll('.', '\\.');
if (!new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelog)) {
  failures.push(`CHANGELOG.md must contain a dated ## [${version}] release heading.`);
}

requireContains('README.md', `version-${version}-`, 'the current version badge');
requireContains('README.md', `Version: \`v${version}\``, 'the current public version');
requireContains('README.zh-CN.md', `version-${version}-`, 'the current version badge');
requireContains('README.zh-CN.md', `版本：\`v${version}\``, 'the current public version');
requireContains('docs/user/INSTALL.md', `v${version} Installation`, 'the current installation-guide version');
requireContains('docs/user/INSTALL.zh-CN.md', `v${version} 安装说明`, 'the current installation-guide version');
requireContains('docs/user/QUICK_START.md', `v${version}`, 'the current quick-start version');
requireContains('docs/user/QUICK_START.zh-CN.md', `v${version}`, 'the current quick-start version');

let changedFiles = [];
let previousVersion = null;
const resolvedBase = canResolveCommit(base);

if (resolvedBase) {
  const diffFiles = git(['diff', '--name-only', base])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => file.replaceAll('\\', '/'));
  const untrackedFiles = git(['ls-files', '--others', '--exclude-standard'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => file.replaceAll('\\', '/'));
  changedFiles = [...new Set([...diffFiles, ...untrackedFiles])].sort();

  if (changedFiles.length > 0 && !changedFiles.includes('CHANGELOG.md')) {
    failures.push('Every public update must change CHANGELOG.md under [Unreleased].');
  } else if (changedFiles.includes('CHANGELOG.md')) {
    const baseChangelog = readFileAt(base, 'CHANGELOG.md');
    if (
      baseChangelog !== null
      && extractUnreleased(baseChangelog) === extractUnreleased(changelog)
    ) {
      failures.push(
        'Every public update must change the CHANGELOG.md [Unreleased] section.',
      );
    }
  }

  previousVersion = readVersionAt(base);
  if (previousVersion && previousVersion !== version) {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(previousVersion)) {
      failures.push(`Base VERSION is not stable Semantic Versioning: ${previousVersion}`);
    } else if (compareVersions(version, previousVersion) <= 0) {
      failures.push(`VERSION must increase from ${previousVersion}, found: ${version}`);
    }

    const requiredVersionFiles = [
      'VERSION',
      'CHANGELOG.md',
      'README.md',
      'README.zh-CN.md',
      'docs/user/INSTALL.md',
      'docs/user/INSTALL.zh-CN.md',
      'docs/user/QUICK_START.md',
      'docs/user/QUICK_START.zh-CN.md',
      'server/package.json',
      'server/package-lock.json',
      'ai-adapter/ui/v0.1.0/package.json',
      'ai-adapter/ui/v0.1.0/package-lock.json',
    ];

    for (const relativePath of requiredVersionFiles) {
      if (!changedFiles.includes(relativePath)) {
        failures.push(`Product version changes must update ${relativePath}.`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Public version/update record validation failed:');
  for (const failure of [...new Set(failures)].sort()) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'ok',
  version,
  base: resolvedBase ? base : null,
  previousVersion,
  changedFileCount: changedFiles.length,
  changelogRequired: changedFiles.length > 0,
}, null, 2));
