const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_NAME = 'MEPBridge';
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function getDefaultDataDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
  }
  return path.join(os.homedir(), '.mepbridge');
}

const DATA_DIR = path.resolve(process.env.MEPBRIDGE_DATA_DIR || getDefaultDataDir());

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function dataPath(...segments) {
  return path.join(DATA_DIR, ...segments);
}

function projectPath(...segments) {
  return path.join(PROJECT_ROOT, ...segments);
}

function ensureDataDir(...segments) {
  return ensureDir(dataPath(...segments));
}

function migrateLegacyFile(legacyRelativePath, targetRelativePath = legacyRelativePath) {
  const source = projectPath(...legacyRelativePath.split(/[\\/]+/));
  const target = dataPath(...targetRelativePath.split(/[\\/]+/));

  try {
    if (fs.existsSync(source) && !fs.existsSync(target)) {
      ensureDir(path.dirname(target));
      fs.copyFileSync(source, target);
      console.log(`[RuntimePaths] Migrated legacy file ${legacyRelativePath} -> ${target}`);
    }
  } catch (error) {
    console.warn(`[RuntimePaths] Legacy file migration skipped for ${legacyRelativePath}: ${error.message}`);
  }

  return target;
}

function copyDirectoryIfMissing(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  ensureDir(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    const targetEntry = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryIfMissing(sourceEntry, targetEntry);
    } else if (entry.isFile() && !fs.existsSync(targetEntry)) {
      fs.copyFileSync(sourceEntry, targetEntry);
    }
  }
}

function migrateLegacyDirectory(legacyRelativePath, targetRelativePath = legacyRelativePath) {
  const source = projectPath(...legacyRelativePath.split(/[\\/]+/));
  const target = dataPath(...targetRelativePath.split(/[\\/]+/));

  try {
    copyDirectoryIfMissing(source, target);
  } catch (error) {
    console.warn(`[RuntimePaths] Legacy directory migration skipped for ${legacyRelativePath}: ${error.message}`);
  }

  return target;
}

ensureDataDir();

module.exports = {
  APP_NAME,
  PROJECT_ROOT,
  DATA_DIR,
  dataPath,
  projectPath,
  ensureDir,
  ensureDataDir,
  migrateLegacyFile,
  migrateLegacyDirectory
};
