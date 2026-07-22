const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const router = express.Router();
const ROOT = path.join(__dirname, '../..');

function safeExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (_) {
    return false;
  }
}

function fileContains(filePath, text) {
  try {
    if (!safeExists(filePath)) return false;
    return fs.readFileSync(filePath, 'utf8').toLowerCase().includes(text.toLowerCase());
  } catch (_) {
    return false;
  }
}

function getRunningProcessText(platform = process.platform, executeFileSync = execFileSync) {
  try {
    if (platform === 'win32') {
      return executeFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toLowerCase();
    }
    return executeFileSync('ps', ['-axo', 'comm,args'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toLowerCase();
  } catch (_) {
    return '';
  }
}

function isHostRunning(processText, matchers = []) {
  if (!processText) return false;
  return matchers.some((matcher) => processText.includes(String(matcher).toLowerCase()));
}

function detectConfig(name, configPath, processText, processMatchers, marker = 'mepbridge') {
  const exists = safeExists(configPath);
  const configured = exists && fileContains(configPath, marker);
  const running = isHostRunning(processText, processMatchers);
  if (!configured || !running) return null;
  return {
    name,
    configured: true,
    running: true,
    connected: true,
    path: configPath,
    status: 'connected'
  };
}

router.get('/status', (req, res) => {
  const home = os.homedir();
  const serverScript = path.join(ROOT, 'tools', 'mepbridge-mcp-server.js');
  const generatedCodexConfig = path.join(ROOT, 'dist', 'mcp-configs', 'codex-config.toml');
  const codexUserConfig = path.join(home, '.codex', 'config.toml');

  const processText = getRunningProcessText();
  const candidates = [
    {
      name: 'CodeBuddy',
      configPath: path.join(ROOT, '.codebuddy', '.mcp.json'),
      processMatchers: ['codebuddy']
    },
    {
      name: 'Codex',
      configPath: safeExists(codexUserConfig) ? codexUserConfig : generatedCodexConfig,
      processMatchers: ['codex.exe', 'chatgpt.exe']
    },
    {
      name: 'Cursor',
      configPath: path.join(ROOT, '.cursor', 'mcp.json'),
      processMatchers: ['cursor.exe', 'cursor']
    },
    {
      name: 'Claude Desktop',
      configPath: path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
      processMatchers: ['claude.exe', 'claude desktop', 'cowork-svc.exe']
    }
  ];
  const platforms = candidates
    .map(({ name, configPath, processMatchers }) => detectConfig(name, configPath, processText, processMatchers))
    .filter(Boolean);

  const configuredCount = platforms.length;
  res.json({
    ok: true,
    serverAvailable: safeExists(serverScript),
    serverScript,
    configuredCount,
    platforms,
    note: 'MCP uses stdio and is launched by each host app; only configured and currently running host apps are listed.'
  });
});

module.exports = router;
module.exports._test = {
  detectConfig,
  getRunningProcessText,
  isHostRunning,
};
