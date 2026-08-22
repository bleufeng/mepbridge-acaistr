const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRegistry } = require('../services/mcp-client-registry');

const router = express.Router();
const ROOT = path.join(__dirname, '../..');

// MCP server 在 initialize 握手后上报的活跃会话（权威来源）
const clientRegistry = createRegistry();

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

// 配置探测：配置文件里有 mepbridge + 宿主进程在跑。
// 注意这**不能**证明 MCP 已连接（宿主可能启动失败、或扩展未加载），因此只标记为
// configured/running，connected 交给握手注册表判定。
function detectConfig(name, configPaths, processText, processMatchers, marker = 'mepbridge') {
  const paths = Array.isArray(configPaths) ? configPaths : [configPaths];
  const configuredPath = paths.find((p) => safeExists(p) && fileContains(p, marker));
  const running = isHostRunning(processText, processMatchers);
  if (!configuredPath || !running) return null;
  return {
    name,
    configured: true,
    running: true,
    connected: false,
    path: configuredPath,
    status: 'configured',
    source: 'config-probe'
  };
}

// 合并两个来源：握手注册表（权威，能证明真的连上了）优先，配置探测仅作补充。
// 同名条目合并，握手信息覆盖探测信息。
function mergeClientsAndPlatforms(clients, probed) {
  const merged = new Map();

  for (const platform of probed) {
    merged.set(platform.name.toLowerCase(), { ...platform });
  }

  for (const client of clients) {
    const key = client.name.toLowerCase();
    const existing = merged.get(key) || { name: client.name, configured: false, running: true };
    merged.set(key, {
      ...existing,
      name: client.name,
      running: true,
      connected: true,
      status: 'connected',
      source: 'mcp-handshake',
      clientVersion: client.version,
      protocolVersion: client.protocolVersion,
      pid: client.pid,
      sessionId: client.sessionId,
      connectedSince: client.firstSeen,
      lastSeen: client.lastSeen
    });
  }

  return Array.from(merged.values())
    .sort((a, b) => (a.connected === b.connected ? a.name.localeCompare(b.name) : (a.connected ? -1 : 1)));
}

// MCP server 在 initialize 时调用，上报协议自带的 clientInfo
router.post('/clients', (req, res) => {
  const { name, version, protocolVersion, pid } = req.body || {};
  const result = clientRegistry.register({ name, version, protocolVersion, pid });
  if (!result.ok) {
    return res.status(400).json({ ok: false, error: result.error });
  }
  res.json(result);
});

router.post('/clients/:sessionId/heartbeat', (req, res) => {
  const alive = clientRegistry.heartbeat(req.params.sessionId);
  if (!alive) {
    // 让客户端知道要重新 register，而不是一直心跳到不存在的会话
    return res.status(404).json({ ok: false, error: 'Unknown or expired sessionId; re-register required.' });
  }
  res.json({ ok: true });
});

router.delete('/clients/:sessionId', (req, res) => {
  res.json({ ok: true, removed: clientRegistry.unregister(req.params.sessionId) });
});

router.get('/status', (req, res) => {
  const home = os.homedir();
  const serverScript = path.join(ROOT, 'tools', 'mepbridge-mcp-server.js');
  const generatedCodexConfig = path.join(ROOT, 'dist', 'mcp-configs', 'codex-config.toml');

  const processText = getRunningProcessText();
  const candidates = [
    {
      name: 'CodeBuddy',
      configPaths: [
        path.join(home, '.codebuddy', 'mcp.json'),
        path.join(home, '.codebuddy', '.mcp.json'),
        path.join(ROOT, '.codebuddy', '.mcp.json')
      ],
      // CodeBuddy 以 VS Code 扩展形式运行，没有自己的进程名；宿主是 Code.exe。
      // 这里保留宿主名只为「已配置」提示，真正的连接判定靠 initialize 握手上报。
      processMatchers: ['codebuddy', 'code.exe']
    },
    {
      name: 'WorkBuddy',
      configPaths: [
        path.join(home, '.workbuddy', 'mcp.json'),
        path.join(home, '.workbuddy', '.mcp.json')
      ],
      processMatchers: ['workbuddy']
    },
    {
      name: 'Codex',
      configPaths: [
        path.join(home, '.codex', 'mcp.json'),
        path.join(home, '.codex', 'config.toml'),
        generatedCodexConfig
      ],
      processMatchers: ['codex.exe', 'chatgpt.exe']
    },
    {
      name: 'Cursor',
      configPaths: [
        path.join(home, '.cursor', 'mcp.json'),
        path.join(ROOT, '.cursor', 'mcp.json')
      ],
      processMatchers: ['cursor.exe', 'cursor']
    },
    {
      name: 'Claude Code',
      configPaths: [
        path.join(home, '.claude.json')
      ],
      processMatchers: ['claude.exe'],
      marker: 'mepbridge-mcp-server'
    },
    {
      name: 'Claude Desktop',
      configPaths: [
        path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
      ],
      processMatchers: ['claude desktop']
    }
  ];
  const probed = candidates
    .map(({ name, configPaths, processMatchers, marker }) => detectConfig(name, configPaths, processText, processMatchers, marker || 'mepbridge'))
    .filter(Boolean);

  const clients = clientRegistry.list();
  const platforms = mergeClientsAndPlatforms(clients, probed);

  res.json({
    ok: true,
    serverAvailable: safeExists(serverScript),
    serverScript,
    configuredCount: platforms.length,
    connectedCount: clients.length,
    clients,
    platforms,
    note: 'connected 来自 MCP initialize 握手自报（权威）；configured 仅表示配置文件与宿主进程存在，不能证明已连接。'
  });
});

module.exports = router;
module.exports._test = {
  detectConfig,
  getRunningProcessText,
  isHostRunning,
  mergeClientsAndPlatforms,
  clientRegistry,
};
