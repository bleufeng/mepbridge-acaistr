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
    case 'point2d':
      return pointSchema(2, description, 'coordinate in meters');
    case 'point3d':
      return pointSchema(3, description, 'coordinate/value');
    case 'delta3d':
      return pointSchema(3, description, 'offset in millimeters');
    case 'point2dList':
    case 'polygon':
      return arraySchema(
        pointSchema(2, '2D point', 'coordinate in meters'),
        description
      );
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
      return arraySchema({ type: 'object', additionalProperties: true }, description);
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
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'mepbridge-mcp-server',
  version: '0.1.0',
};

function handleRequest(req) {
  const { id, method, params } = req;

  try {
    switch (method) {
      case 'initialize':
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
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    process.stderr.write('[MCP] SIGTERM received\n');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    process.stderr.write('[MCP] SIGINT received\n');
    process.exit(0);
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
