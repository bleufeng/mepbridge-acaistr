// MCP 客户端注册表（权威连接来源）
//
// 背景：MCP 走 stdio，由每个宿主 app 自行 spawn `tools/mepbridge-mcp-server.js` 子进程，
// 因此本地 server 无法通过监听端口观察到「谁连上来了」。原先 `routes/mcp-status.js` 只能
// 靠「配置文件里有 mepbridge」+「进程名匹配」做启发式推断，这对以编辑器扩展形式运行的
// 宿主必然误判：CodeBuddy 实际是 VS Code 扩展，进程名是 Code.exe，永远匹配不上 'codebuddy'。
//
// 本模块改为让 MCP server 在 `initialize` 握手时把协议自带的 clientInfo 主动上报，
// 由本表按 TTL 维护活跃会话。自报数据是权威的，且与宿主进程名无关。
//
// 纯内存、无副作用：server 重启即清空；MCP 子进程随宿主退出后靠 TTL 自然过期。

const DEFAULT_TTL_MS = 90 * 1000;         // 容忍 2 次心跳丢失
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const MAX_NAME_LENGTH = 120;
const MAX_SESSIONS = 64;                  // 防御异常客户端无限注册

// 已知宿主的自报名 → 展示名。用于和配置探测结果去重合并；
// 未收录的名字原样展示，不因为不认识就丢弃。
const CLIENT_NAME_ALIASES = new Map([
  ['claude-code', 'Claude Code'],
  ['claude code', 'Claude Code'],
  ['claude-desktop', 'Claude Desktop'],
  ['claude desktop', 'Claude Desktop'],
  ['codebuddy', 'CodeBuddy'],
  ['coding-copilot', 'CodeBuddy'],
  ['tencent-cloud.coding-copilot', 'CodeBuddy'],
  ['workbuddy', 'WorkBuddy'],
  ['codex', 'Codex'],
  ['codex-cli', 'Codex'],
  ['chatgpt', 'Codex'],
  ['cursor', 'Cursor'],
  ['cursor-ide', 'Cursor'],
]);

function normalizeClientName(rawName) {
  const trimmed = String(rawName == null ? '' : rawName).trim();
  if (!trimmed) return '';
  const alias = CLIENT_NAME_ALIASES.get(trimmed.toLowerCase());
  return alias || trimmed.slice(0, MAX_NAME_LENGTH);
}

function sanitizeOptionalString(value) {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, MAX_NAME_LENGTH) : undefined;
}

function sanitizePid(value) {
  if (value == null) return undefined;
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function createRegistry({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  const sessions = new Map();
  let sequence = 0;

  function prune() {
    const cutoff = now() - ttlMs;
    for (const [sessionId, session] of sessions) {
      if (session.lastSeen < cutoff) sessions.delete(sessionId);
    }
  }

  function register(input = {}) {
    const name = normalizeClientName(input.name);
    if (!name) {
      return { ok: false, error: 'clientInfo.name is required and must be a non-empty string.' };
    }

    prune();
    if (sessions.size >= MAX_SESSIONS) {
      return { ok: false, error: `Too many active MCP sessions (limit ${MAX_SESSIONS}).` };
    }

    const timestamp = now();
    const sessionId = `mcp-${timestamp.toString(36)}-${(++sequence).toString(36)}`;
    sessions.set(sessionId, {
      sessionId,
      name,
      reportedName: sanitizeOptionalString(input.name),
      version: sanitizeOptionalString(input.version),
      protocolVersion: sanitizeOptionalString(input.protocolVersion),
      pid: sanitizePid(input.pid),
      firstSeen: timestamp,
      lastSeen: timestamp,
    });

    return { ok: true, sessionId, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS, ttlMs };
  }

  // 心跳只刷新时间戳。会话已过期/未知时返回 false，让调用方重新 register，
  // 避免 server 重启后客户端永久心跳到一个不存在的 sessionId。
  function heartbeat(sessionId) {
    prune();
    const session = sessions.get(sessionId);
    if (!session) return false;
    session.lastSeen = now();
    return true;
  }

  function unregister(sessionId) {
    return sessions.delete(sessionId);
  }

  function list() {
    prune();
    const timestamp = now();
    return Array.from(sessions.values())
      .sort((a, b) => (a.name === b.name ? a.firstSeen - b.firstSeen : a.name.localeCompare(b.name)))
      .map((session) => ({
        name: session.name,
        reportedName: session.reportedName,
        version: session.version,
        protocolVersion: session.protocolVersion,
        pid: session.pid,
        sessionId: session.sessionId,
        firstSeen: new Date(session.firstSeen).toISOString(),
        lastSeen: new Date(session.lastSeen).toISOString(),
        ageMs: timestamp - session.firstSeen,
        staleMs: timestamp - session.lastSeen,
      }));
  }

  function clear() {
    sessions.clear();
  }

  return { register, heartbeat, unregister, list, clear, get size() { prune(); return sessions.size; } };
}

module.exports = {
  createRegistry,
  normalizeClientName,
  DEFAULT_TTL_MS,
  HEARTBEAT_INTERVAL_MS,
  MAX_SESSIONS,
};
