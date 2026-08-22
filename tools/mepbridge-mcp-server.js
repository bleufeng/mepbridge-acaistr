#!/usr/bin/env node
// mepbridge-mcp-server.js
// MEPBridge 通用 MCP Server（stdio 模式）
//
// 功能：
//   - 从 tool-descriptors.json 自动生成 MCP 工具列表
//   - 每个工具调用 → POST /api/execute → Archicad JSON API
//   - 支持 MCP 协议: initialize / tools/list / tools/call
//   - 通用兼容 CodeBuddy / Codex CLI / Cursor / Claude Desktop
//
// 通信协议：JSON-RPC 2.0 over stdio（MCP 标准）
// 依赖：仅 Node.js 内置模块（http/fs/path），零外部依赖
//
// 环境变量：
//   MEPBRIDGE_ENDPOINT — Node.js Server 地址，默认 http://127.0.0.1:19780
//   MEPBRIDGE_DESCRIPTORS — tool-descriptors.json 路径（可选，默认自动查找）

const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  getCommandSafetyCapabilities,
  normalizeCommandSafetyParameters,
} = require('../server/services/command-capabilities');
const { APP_VERSION } = require('../server/services/app-version');

// ── 配置 ──
const SERVER_ENDPOINT = process.env.MEPBRIDGE_ENDPOINT || 'http://127.0.0.1:19780';
const SERVER_URL = new URL(SERVER_ENDPOINT);

// 自动查找 tool-descriptors.json
function findDescriptorsPath() {
  const candidates = [
    process.env.MEPBRIDGE_DESCRIPTORS,
    path.join(__dirname, '..', 'ai-adapter', 'tool-descriptors.json'),
    path.join(__dirname, 'tool-descriptors.json'),
    path.join(process.cwd(), 'ai-adapter', 'tool-descriptors.json'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 加载 descriptors
let _descriptorsCache = null;
let _toolsCache = null;
let _toolNameMap = null;  // 工具名 → descriptor 名 的映射

function loadDescriptors() {
  if (_descriptorsCache) return _descriptorsCache;
  const p = findDescriptorsPath();
  if (!p) {
    console.error('[MCP] tool-descriptors.json not found');
    _descriptorsCache = { descriptors: [] };
    return _descriptorsCache;
  }
  try {
    _descriptorsCache = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.error(`[MCP] Loaded ${_descriptorsCache.descriptors?.length || 0} descriptors from ${p}`);
    // 构建工具名映射表：descriptor.name → MCP 工具名（仅第一段点号→下划线）
    _toolNameMap = {};
    for (const desc of (_descriptorsCache.descriptors || [])) {
      // 只替换第一个点号为下划线（namespace.action → namespace_action）
      const firstDot = desc.name.indexOf('.');
      if (firstDot > 0) {
        const toolName = desc.name.substring(0, firstDot) + '_' + desc.name.substring(firstDot + 1);
        _toolNameMap[toolName] = desc.name;
      } else {
        _toolNameMap[desc.name] = desc.name;
      }
    }
  } catch (e) {
    console.error(`[MCP] Failed to load descriptors: ${e.message}`);
    _descriptorsCache = { descriptors: [] };
  }
  return _descriptorsCache;
}

function pointSchema(dimensions, description, unitDescription) {
  const coordinateProperties = {
    x: { type: 'number', description: `X ${unitDescription}` },
    y: { type: 'number', description: `Y ${unitDescription}` },
  };
  if (dimensions === 3) {
    coordinateProperties.z = { type: 'number', description: `Z ${unitDescription}` };
  }

  return {
    type: 'object',
    description,
    properties: coordinateProperties,
    required: dimensions === 3 ? ['x', 'y', 'z'] : ['x', 'y'],
    additionalProperties: false,
  };
}

function arraySchema(items, description) {
  return {
    type: 'array',
    description,
    items,
  };
}

function inferRawSchema(defaultValue, description) {
  if (Array.isArray(defaultValue)) {
    const sample = defaultValue.find((value) => value !== undefined && value !== null);
    let items = {};
    if (typeof sample === 'string') items = { type: 'string' };
    else if (typeof sample === 'number') items = { type: 'number' };
    else if (typeof sample === 'boolean') items = { type: 'boolean' };
    else if (sample && typeof sample === 'object') items = { type: 'object', additionalProperties: true };
    return arraySchema(items, description);
  }
  if (defaultValue && typeof defaultValue === 'object') {
    return {
      type: 'object',
      description,
      additionalProperties: true,
    };
  }
  return {
    description,
  };
}

function extractorSpecToJsonSchema(key, spec = {}, defaultValue) {
  const type = spec.type || 'string';
  const description = spec.description || key;

  switch (type) {
    case 'number':
      return { type: 'number', description };
    case 'integer':
    case 'story-index':
      return { type: 'integer', description };
    case 'boolean':
      return { type: 'boolean', description };
    case 'enum':
      return {
        type: 'string',
        description,
        ...(Array.isArray(spec.values) ? { enum: spec.values } : {}),
      };
    case 'guid':
    case 'string':
      return { type: 'string', description };
    case 'object-reference':
      return {
        type: 'object',
        description,
        properties: {
          source: {
            type: 'string',
            enum: ['favorite', 'projectLibrary'],
            description: 'Object source: project Favorite or current project library',
          },
          guid: {
            type: 'string',
            description: 'Optional stable library-part GUID',
          },
          name: {
            type: 'string',
            description: 'Optional exact Favorite or library-part name',
          },
        },
        required: ['source'],
        additionalProperties: false,
      };
    case 'point2d':
      return pointSchema(2, description, 'coordinate in meters');
    case 'point3d':
      return pointSchema(3, description, 'coordinate/value');
    case 'delta3d':
      return pointSchema(3, description, 'offset in millimeters');
    case 'point2dList':
      return arraySchema(
        pointSchema(2, '2D point', 'coordinate in meters'),
        description
      );
    case 'polygon': {
      const pointsSchema = arraySchema(
        pointSchema(2, '2D point', 'coordinate in meters'),
        description
      );
      if (defaultValue && !Array.isArray(defaultValue) && Array.isArray(defaultValue.points)) {
        const properties = { points: pointsSchema };
        if (Array.isArray(defaultValue.heights)) {
          properties.heights = arraySchema(
            { type: 'number', description: 'Vertex height relative to the element base level' },
            'Optional per-vertex heights; length must equal points.length'
          );
        }
        return {
          type: 'object',
          description,
          properties,
          required: ['points'],
          additionalProperties: false,
        };
      }
      return pointsSchema;
    }
    case 'point3dList':
      return arraySchema(
        pointSchema(3, '3D point', 'coordinate in meters'),
        description
      );
    case 'guidList':
      return arraySchema({ type: 'string' }, description);
    case 'elementTypeList':
      return arraySchema({ type: 'string' }, description);
    case 'keyValuePairs':
      return arraySchema({
        type: 'object',
        properties: {
          propertyGuid: { type: 'string', description: 'Property definition GUID' },
          groupName: { type: 'string', minLength: 1, description: 'Property group name for name-based lookup' },
          propertyName: { type: 'string', description: 'Property name for name-based lookup' },
          valueString: { type: 'string', description: 'New property value encoded as text' },
        },
        required: ['valueString'],
        additionalProperties: false,
      }, description);
    case 'array':
      return arraySchema({}, description);
    case 'raw':
      return inferRawSchema(defaultValue, description);
    default:
      return { type: 'string', description };
  }
}

// 将 descriptor 转换为 MCP tool 定义
function descriptorToMcpTool(desc) {
  const params = desc.paramExtractors || {};
  const defaultParams = desc.commandJson?.parameters?.addOnCommandParameters || {};
  const properties = {};
  const required = [];

  for (const [key, spec] of Object.entries(params)) {
    properties[key] = extractorSpecToJsonSchema(key, spec, defaultParams[key]);
    if (spec.required === true) required.push(key);
  }

  // mutation 类命令仅暴露底层命令实际支持的安全字段。
  const riskLevel = desc.riskLevel || 'read';
  const isMutation = ['low-mutation', 'high-mutation', 'mutation', 'create-element', 'medium-mutation', 'batch-create'].includes(riskLevel);
  const safetyCapabilities = getCommandSafetyCapabilities(desc.commandName);
  if (isMutation && safetyCapabilities.dryRun) {
    properties.dryRun = {
      type: 'boolean',
      description: 'If true, preview without executing (default: true for safety)',
    };
  }
  if (isMutation && safetyCapabilities.confirmRequired) {
    properties.confirmRequired = {
      type: 'boolean',
      description: 'If true, requires user confirmation before execution',
    };
  }

  // 仅替换第一个点号为下划线（namespace.action → namespace_action）
  const firstDot = desc.name.indexOf('.');
  const toolName = firstDot > 0
    ? desc.name.substring(0, firstDot) + '_' + desc.name.substring(firstDot + 1)
    : desc.name;

  return {
    name: toolName,
    description: `${desc.title || desc.name}\n${desc.description || ''}\nRisk: ${riskLevel} | Namespace: ${desc.commandNamespace || 'N/A'} | Command: ${desc.commandName || 'N/A'}`,
    inputSchema: {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };
}

function normalizeToolArguments(desc, args, cmdParams) {
  const normalizedArgs = { ...(args || {}) };
  const commandName = desc.commandName;

  if (commandName === 'MoveElements') {
    if (typeof normalizedArgs.routeGuid === 'string' && normalizedArgs.routeGuid.trim()) {
      const routeGuids = Array.isArray(normalizedArgs.routeGuids)
        ? normalizedArgs.routeGuids.filter(Boolean)
        : [];
      if (!routeGuids.includes(normalizedArgs.routeGuid)) {
        routeGuids.unshift(normalizedArgs.routeGuid);
      }
      normalizedArgs.routeGuids = routeGuids;
      delete normalizedArgs.routeGuid;
    }

    if (!Array.isArray(normalizedArgs.routeGuids) && Array.isArray(cmdParams.routeGuids) && cmdParams.routeGuids.length === 0) {
      delete cmdParams.routeGuids;
    }
  }

  return normalizedArgs;
}

function buildCommandJson(desc, args = {}) {
  const commandJson = JSON.parse(JSON.stringify(desc.commandJson));
  const cmdParams = commandJson.parameters?.addOnCommandParameters || {};
  const normalizedArgs = normalizeToolArguments(desc, args, cmdParams);

  for (const [key, value] of Object.entries(normalizedArgs)) {
    if (value !== undefined && value !== null) {
      cmdParams[key] = value;
    }
  }

  const riskLevel = desc.riskLevel || 'read';
  const isMutation = ['low-mutation', 'high-mutation', 'mutation', 'create-element', 'medium-mutation', 'batch-create'].includes(riskLevel);
  const normalizedSafetyParams = normalizeCommandSafetyParameters(desc.commandName, cmdParams);
  commandJson.parameters.addOnCommandParameters = normalizedSafetyParams;
  if (isMutation && getCommandSafetyCapabilities(desc.commandName).dryRun && normalizedSafetyParams.dryRun === undefined) {
    normalizedSafetyParams.dryRun = true;
  }

  return commandJson;
}

// 获取所有 MCP 工具
function getMcpTools() {
  if (_toolsCache) return _toolsCache;
  const { descriptors } = loadDescriptors();
  _toolsCache = (descriptors || []).map(descriptorToMcpTool).filter(t => t.name);
  return _toolsCache;
}

// ── HTTP 调用 /api/execute ──
function callExecute(commandJson) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ command: commandJson });
    const req = http.request(
      {
        hostname: SERVER_URL.hostname,
        port: SERVER_URL.port,
        path: '/api/execute',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ ok: false, error: `JSON parse failed: ${e.message}`, raw: data.slice(0, 500) });
          }
        });
      }
    );
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout (30s)')); });
    req.write(body);
    req.end();
  });
}

// ── 调用 /api/ping 检查连接 ──
function callPing() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: SERVER_URL.hostname,
        port: SERVER_URL.port,
        path: '/api/ping',
        method: 'GET',
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ ok: false, raw: data }); }
        });
      }
    );
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Ping timeout (5s)')); });
    req.end();
  });
}

// ── 根据工具名找 descriptor ──
function findDescriptorByToolName(toolName) {
  // 使用预构建的映射表查找（避免全局下划线→点号替换的歧义）
  loadDescriptors();  // 确保映射表已构建
  const descName = _toolNameMap && _toolNameMap[toolName];
  if (!descName) return null;
  const { descriptors } = _descriptorsCache;
  return descriptors.find(d => d.name === descName);
}

// ── 执行工具调用 ──
async function executeTool(toolName, args = {}) {
  args = args || {};

  // 特殊内置工具：ping
  if (toolName === 'mepbridge_ping') {
    try {
      const result = await callPing();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: `❌ Server connection failed: ${e.message}\nEndpoint: ${SERVER_ENDPOINT}` }],
        isError: true,
      };
    }
  }

  const desc = findDescriptorByToolName(toolName);
  if (!desc) {
    return {
      content: [{ type: 'text', text: `❌ Tool not found: ${toolName}` }],
      isError: true,
    };
  }

  const commandJson = buildCommandJson(desc, args);

  try {
    const result = await callExecute(commandJson);
    const resultText = JSON.stringify(result, null, 2);

    // 检查执行结果
    const isSuccess = result.ok !== false &&
      result.response?.result?.addOnCommandResponse?.status !== 'error' &&
      !result.error;

    return {
      content: [{
        type: 'text',
        text: isSuccess
          ? `✅ ${desc.name} executed successfully\n\n${resultText}`
          : `⚠️ ${desc.name} completed with issues\n\n${resultText}`,
      }],
      isError: !isSuccess,
    };
  } catch (e) {
    return {
      content: [{
        type: 'text',
        text: `❌ Execution failed: ${e.message}\n\nCommand: ${JSON.stringify(commandJson, null, 2)}`,
      }],
      isError: true,
    };
  }
}

// ── MCP 协议处理 ──
// ── 向本地 server 上报 MCP 客户端身份（供 /api/mcp/status 显示真实连接）──
//
// MCP 走 stdio，由宿主 app spawn 本进程，所以 server 无法靠端口观察到谁连上来了。
// 唯一权威的身份来源是 initialize 握手里协议自带的 clientInfo。这里主动上报 +
// 心跳保活；所有失败都必须静默吞掉，绝不能影响 MCP 协议本身。
let _mcpSessionId = null;
let _heartbeatTimer = null;

function postRegistry(pathname, body, method = 'POST') {
  return new Promise((resolve) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: SERVER_URL.hostname,
        port: SERVER_URL.port,
        path: pathname,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
        timeout: 3000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) return resolve(null);
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }
    );
    // 上报是尽力而为：server 未启动、超时、报错都不影响 MCP 工作
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (payload) req.write(payload);
    req.end();
  });
}

function stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

function startHeartbeat(intervalMs) {
  stopHeartbeat();
  _heartbeatTimer = setInterval(() => {
    if (!_mcpSessionId) return;
    postRegistry(`/api/mcp/clients/${encodeURIComponent(_mcpSessionId)}/heartbeat`, {}).then((result) => {
      // server 重启后 sessionId 会失效，此时重新注册而不是一直心跳到不存在的会话
      if (result === null) {
        _mcpSessionId = null;
        stopHeartbeat();
      }
    });
  }, intervalMs);
  // 不能让心跳定时器把进程吊住，否则宿主关闭后本进程不退出
  if (typeof _heartbeatTimer.unref === 'function') _heartbeatTimer.unref();
}

function registerClient(clientInfo, protocolVersion) {
  const name = clientInfo && clientInfo.name;
  if (!name) return;  // 无法自报身份的客户端不登记，避免污染权威列表

  postRegistry('/api/mcp/clients', {
    name,
    version: clientInfo.version,
    protocolVersion,
    pid: process.pid,
  }).then((result) => {
    if (!result || !result.sessionId) return;
    _mcpSessionId = result.sessionId;
    startHeartbeat(result.heartbeatIntervalMs || 30000);
  });
}

function unregisterClient() {
  stopHeartbeat();
  if (!_mcpSessionId) return;
  const sessionId = _mcpSessionId;
  _mcpSessionId = null;
  postRegistry(`/api/mcp/clients/${encodeURIComponent(sessionId)}`, null, 'DELETE');
}

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'mepbridge-mcp-server',
  version: APP_VERSION,
};

function handleRequest(req) {
  const { id, method, params } = req;

  try {
    switch (method) {
      case 'initialize':
        // clientInfo 是宿主自报的权威身份，与进程名无关
        registerClient(params && params.clientInfo, params && params.protocolVersion);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: SERVER_INFO,
          },
        };

      case 'initialized':
      case 'notifications/initialized':
        return null;  // 通知，无需响应

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: getMcpTools(),
          },
        };

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        // 异步处理
        return executeTool(name, args).then(result => ({
          jsonrpc: '2.0',
          id,
          result,
        })).catch(err => ({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: `Tool execution error: ${err.message}`,
          },
        }));
      }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  } catch (e) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: `Internal error: ${e.message}`,
      },
    };
  }
}

function startStdioServer() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  process.stderr.write(`[MCP] MEPBridge MCP Server starting (endpoint: ${SERVER_ENDPOINT})\n`);

  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;

    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      process.stderr.write(`[MCP] JSON parse error: ${e.message}\n`);
      return;
    }

    Promise.resolve(handleRequest(req)).then(response => {
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    }).catch(err => {
      process.stderr.write(`[MCP] Handler error: ${err.message}\n`);
    });
  });

  rl.on('close', () => {
    process.stderr.write('[MCP] stdin closed, shutting down\n');
    unregisterClient();
    // 留一点时间让注销请求发出；即使失败也会由 server 端 TTL 兜底
    setTimeout(() => process.exit(0), 150);
  });

  process.on('SIGTERM', () => {
    process.stderr.write('[MCP] SIGTERM received\n');
    unregisterClient();
    setTimeout(() => process.exit(0), 150);
  });

  process.on('SIGINT', () => {
    process.stderr.write('[MCP] SIGINT received\n');
    unregisterClient();
    setTimeout(() => process.exit(0), 150);
  });
}

if (require.main === module) {
  startStdioServer();
}

module.exports = {
  buildCommandJson,
  descriptorToMcpTool,
  extractorSpecToJsonSchema,
  getMcpTools,
  handleRequest,
  loadDescriptors,
  normalizeToolArguments,
  startStdioServer,
};
