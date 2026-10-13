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

// Node 系宿主（Gemini CLI / Claude Code / Codex ...）都跑在 node.exe 上，进程名无法区分。
// tasklist 只输出进程名、不含命令行，因此改用 CIM 读取完整命令行做精确匹配。
// 惰性求值 + 结果缓存：/api/mcp/status 有 10s 轮询，不能每次都拉全量命令行。
let _nodeCommandLineCache = { at: 0, text: '' };
const NODE_CMDLINE_TTL_MS = 5000;

function getNodeCommandLineText(platform = process.platform) {
  const now = Date.now();
  if (now - _nodeCommandLineCache.at < NODE_CMDLINE_TTL_MS) {
    return _nodeCommandLineCache.text;
  }

  let text = '';
  try {
    if (platform === 'win32') {
      // 过滤到 node/gemini 进程，避免拉全量命令行（性能：见 REVIEW_20260822 审计记录）
      const raw = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
          "Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='gemini.exe'\" " +
          '| Select-Object -ExpandProperty CommandLine'],
        { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
      );
      text = String(raw || '').toLowerCase();
    } else {
      text = execFileSync('ps', ['-axo', 'comm,args'], {
        encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
      }).toLowerCase();
    }
  } catch (_) {
    text = '';
  }

  _nodeCommandLineCache = { at: now, text };
  return text;
}

// 命令行精确匹配：要求同时命中宿主标记，且不落在其他宿主的命令行里。
// 用于区分共享 node.exe 的多个宿主，避免「A 装了 MCP 就把 B 也标成 running」。
function isNodeHostRunning(commandLineText, { require = [], deny = [] } = {}) {
  if (!commandLineText) return false;
  // 空 require 视为「无判据」直接判否：与 isHostRunning 的空 matcher 行为保持一致，
  // 否则 [].every() === true 会让任何进程都被误判为该宿主在运行。
  if (!require.length) return false;
  const hasAllRequire = require.every((token) => commandLineText.includes(String(token).toLowerCase()));
  if (!hasAllRequire) return false;
  return !deny.some((token) => commandLineText.includes(String(token).toLowerCase()));
}

// 测试用：清空命令行缓存，避免用例之间互相污染
function _resetNodeCommandLineCache() {
  _nodeCommandLineCache = { at: 0, text: '' };
}

// 配置探测：配置文件里有 mepbridge + 宿主进程在跑。
// 注意这**不能**证明 MCP 已连接（宿主可能启动失败、或扩展未加载），因此只标记为
// configured/running，connected 交给握手注册表判定。
function detectConfig(name, configPaths, processText, processMatchers, marker = 'mepbridge', options = {}) {
  const paths = Array.isArray(configPaths) ? configPaths : [configPaths];
  const configuredPath = paths.find((p) => safeExists(p) && fileContains(p, marker));
  // Node 系宿主需要按命令行判定（共享 node.exe，进程名无法区分），
  // 通过 options.isRunning 覆盖默认的进程名匹配。
  const running = typeof options.isRunning === 'function'
    ? Boolean(options.isRunning())
    : isHostRunning(processText, processMatchers);
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
    },
    {
      // 豆包桌面版：MCP 配置写入 Electron 用户数据 Preferences（含 mepbridge 才算已配置）。
      // 连接判定仍以 initialize 握手自报为准（自报名 "Copilot"，由注册表别名映射为 Doubao）。
      name: 'Doubao',
      configPaths: [
        path.join(home, 'AppData', 'Local', 'Doubao', 'User Data', 'Default', 'Preferences')
      ],
      processMatchers: ['doubao.exe']
    },
    {
      // Antigravity（Google）：独立 Electron 桌面 IDE，进程名 Antigravity.exe 可直接匹配。
      //
      // MCP 配置用 mcp_config.json 格式，位置基准由 Antigravity 自带的文档字符串确认：
      //   - 全局：~/.gemini/config/mcp_config.json（对所有 session 生效）
      //   - 插件：plugins/<plugin_name>/mcp_config.json（插件启用时生效）
      //
      // 注意探测路径以 home 为基准而非安装目录：配置文件属于用户机器，
      // 无论 MEPBridge 解压到哪里都不会影响探测，因此第三方用户升级后即可自动识别。
      // 连接判定仍以 initialize 握手自报为准（自报名 antigravity-client，由别名映射为 Antigravity）。
      name: 'Antigravity',
      configPaths: [
        path.join(home, '.gemini', 'config', 'mcp_config.json'),
        path.join(ROOT, '.agents', 'plugins', 'mepbridge', 'mcp_config.json')
      ],
      processMatchers: ['antigravity.exe']
    },
    {
      // Gemini CLI（Google，npm 全局包，@google/gemini-cli）。
      //
      // 与 Antigravity 共用 ~/.gemini/ 根目录，但配置文件不同（实测 bundle 源码）：
      //   Gemini CLI   → ~/.gemini/settings.json（顶层 mcpServers），bundle 中无 mcp_config.json 命中
      //   Antigravity  → ~/.gemini/config/mcp_config.json
      // 两者配置路径互不重叠，因此不会互相误判。
      //
      // 进程匹配用严格策略：Gemini CLI 跑在 node.exe 上，直接匹配 node.exe 会把
      // Claude Code / Codex 等所有 Node 宿主一并算成 running。这里改为读命令行，
      // 要求命中 gemini 脚本标记，并排除其他已知 Node 宿主的标志。
      // 握手自报名 gemini-cli，由注册表别名映射为 Gemini CLI。
      name: 'Gemini CLI',
      configPaths: [
        path.join(home, '.gemini', 'settings.json')
      ],
      processMatchers: ['gemini'],
      nodeHostMatch: {
        require: ['gemini'],
        // 排除同在 node.exe 上的其他宿主，避免交叉误判
        deny: ['claude', 'codex', 'mcpbridge-mcp-server', 'antigravity']
      }
    }
  ];
  const probed = candidates
    .map(({ name, configPaths, processMatchers, marker, nodeHostMatch }) => {
      // Node 系宿主走命令行精确匹配，其余沿用进程名匹配
      const options = nodeHostMatch
        ? { isRunning: () => isNodeHostRunning(getNodeCommandLineText(), nodeHostMatch) }
        : undefined;
      return detectConfig(name, configPaths, processText, processMatchers, marker || 'mepbridge', options);
    })
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
  isNodeHostRunning,
  getNodeCommandLineText,
  _resetNodeCommandLineCache,
};
