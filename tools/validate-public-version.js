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

function addFailure(message) {
  failures.push(message);
}

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    addFailure(`Cannot read ${relativePath}: ${error.message}`);
    return null;
  }
}

function readJson(relativePath) {
  const content = read(relativePath);
  if (content === null) return null;
  try {
    return JSON.parse(content);
  } catch (error) {
    addFailure(`Invalid JSON in ${relativePath}: ${error.message}`);
    return null;
  }
}

function requireContains(relativePath, expected, label) {
  const content = read(relativePath);
  if (content !== null && !content.includes(expected)) {
    addFailure(`${relativePath} does not contain ${label}: ${expected}`);
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

function extractSection(content, heading) {
  if (content === null) return null;
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return null;
  const relativeEnd = lines
    .slice(start + 1)
    .findIndex((line) => /^##\s/.test(line));
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start + 1, end).join('\n').trim();
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

function versionOf(document, label) {
  const value = document?.version;
  return [label, value];
}

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const versionContent = read('VERSION');
const version = versionContent === null ? '' : versionContent.trim();
if (!semverPattern.test(version)) {
  addFailure(`VERSION must contain a stable Semantic Version, found: ${version || '(missing)'}`);
}

const config = readJson('config.json');
const serverPackage = readJson('server/package.json');
const serverLock = readJson('server/package-lock.json');
const uiPackage = readJson('ai-adapter/ui/v0.1.0/package.json');
const uiLock = readJson('ai-adapter/ui/v0.1.0/package-lock.json');

for (const [label, value] of [
  versionOf(config, 'config.json'),
  versionOf(serverPackage, 'server/package.json'),
  versionOf(serverLock, 'server/package-lock.json'),
  ['server/package-lock.json root package', serverLock?.packages?.['']?.version],
  versionOf(uiPackage, 'UI package.json'),
  versionOf(uiLock, 'UI package-lock.json'),
  ['UI package-lock.json root package', uiLock?.packages?.['']?.version],
]) {
  if (value !== undefined && value !== version) {
    addFailure(`${label} version must equal VERSION ${version}, found: ${value}`);
  }
}

const changelog = read('CHANGELOG.md');
const chineseChangelog = read('CHANGELOG.zh-CN.md');
if (semverPattern.test(version)) {
  const escapedVersion = version.replaceAll('.', '\\.');
  const releaseHeading = new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm');
  if (changelog !== null && !releaseHeading.test(changelog)) {
    addFailure(`CHANGELOG.md must contain a dated ## [${version}] release heading.`);
  }
  if (chineseChangelog !== null && !releaseHeading.test(chineseChangelog)) {
    addFailure(`CHANGELOG.zh-CN.md must contain a dated ## [${version}] release heading.`);
  }
}

if (semverPattern.test(version)) {
  requireContains('README.md', `version-${version}-`, 'the current version badge');
  requireContains('README.md', `Version: \`v${version}\``, 'the current public version');
  requireContains('README.zh-CN.md', `version-${version}-`, 'the current version badge');
  requireContains('README.zh-CN.md', `v${version}`, 'the current public version');
  requireContains('docs/user/INSTALL.md', `v${version} Installation`, 'the current installation-guide version');
  requireContains('docs/user/INSTALL.zh-CN.md', `v${version}`, 'the current installation-guide version');
  requireContains('docs/user/QUICK_START.md', `v${version}`, 'the current quick-start version');
  requireContains('docs/user/QUICK_START.zh-CN.md', `v${version}`, 'the current quick-start version');
}

let changedFiles = [];
let previousVersion = null;
const resolvedBase = canResolveCommit(base);

if (base && !resolvedBase) {
  addFailure(`Base commit cannot be resolved: ${base}`);
}

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

  if (changedFiles.length > 0) {
    const englishUnreleased = extractSection(changelog, '## [Unreleased]');
    const chineseUnreleased = extractSection(chineseChangelog, '## [未发布]');
    if (!englishUnreleased) {
      addFailure('Public changes require a non-empty CHANGELOG.md ## [Unreleased] section.');
    }
    if (!chineseUnreleased) {
      addFailure('Public changes require a non-empty CHANGELOG.zh-CN.md ## [未发布] section.');
    }

    const baseEnglish = extractSection(readFileAt(base, 'CHANGELOG.md'), '## [Unreleased]');
    const baseChinese = extractSection(readFileAt(base, 'CHANGELOG.zh-CN.md'), '## [未发布]');
    if (englishUnreleased && englishUnreleased === baseEnglish) {
      addFailure('Public changes must update the CHANGELOG.md [Unreleased] section.');
    }
    if (chineseUnreleased && chineseUnreleased === baseChinese) {
      addFailure('Public changes must update the CHANGELOG.zh-CN.md [未发布] section.');
    }
  }

  previousVersion = readVersionAt(base);
  if (previousVersion && previousVersion !== version) {
    if (!semverPattern.test(previousVersion)) {
      addFailure(`Base VERSION is not stable Semantic Versioning: ${previousVersion}`);
    } else if (semverPattern.test(version) && compareVersions(version, previousVersion) <= 0) {
      addFailure(`VERSION must increase from ${previousVersion}, found: ${version}`);
    }

    const requiredVersionFiles = [
      'VERSION',
      'config.json',
      'CHANGELOG.md',
      'CHANGELOG.zh-CN.md',
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
        addFailure(`Product version changes must update ${relativePath}.`);
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
  changelogRequired: resolvedBase && changedFiles.length > 0,
}, null, 2));
