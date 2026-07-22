// execute.js
// /api/execute 路由：透传 {command:{command,parameters}} 到 Archicad JSON API
// 兼容多种 body 结构：
//   1. UI 格式：{command: {command, parameters}}（BASE 模式）
//   2. execute-step 格式：{action, params}（向后兼容）
//   3. Copilot step 格式：{commandName, parameters}（NL plan 执行）
// 来源：REVIEW §3.2 方案 B + A.1.2 body 结构兼容性

const express = require('express');
const router = express.Router();
const axios = require('axios');
const {
  DynamicResolutionError,
  resolveDynamicCommandParameters
} = require('../services/dynamic-command-resolver');
const { getArchicadEndpoint } = require('../services/archicad-endpoint');
const { normalizeCommandSafetyParameters } = require('../services/command-capabilities');

// Archicad JSON API 端点：动态解析（global.archicadPort > 环境变量 > 默认 19723）
// 不能再硬编码 19723 —— AC29 实测会用 19724，导致 ping 在线但执行报 ARCHICAD_OFFLINE
function ARCHICAD_ENDPOINT() {
  return getArchicadEndpoint();
}

// V2 H1.4: 官方 API 命令透传白名单（B 通道安全控制）
// 仅允许只读和低风险官方命令透传，mutation 类官方命令需通过 MEPBridge C++ 包装
const OFFICIAL_API_WHITELIST = [
  // 只读查询
  'API.GetSelectedElements',
  'API.GetAllElements',
  'API.GetElementsByType',
  'API.GetElementPropertyObjects',
  'API.GetPropertyValuesOfElements',
  'API.SetPropertyValuesOfElements',
  'API.GetStoryInfo',
  'API.GetProjectInfo',
  'API.GetHotspots',
  'API.GetClassificationsOfItem',
  'API.GetLibraries',
  'API.GetHotlinks',
  // 低风险
  'API.ChangeSelection',
  'API.SetStoryInfo',
  'API.ApplyClassification',
  'API.SetHotspots',
  'API.SetLibrary',
  'API.SetHotlinks'
];

/**
 * POST /api/execute
 * 透传命令到 Archicad JSON API
 *
 * 请求 body（两种格式均支持）：
 *   格式 A（UI 格式）：{ command: { command: "API.ExecuteAddOnCommand", parameters: {...} } }
 *   格式 B（execute-step 兼容）：{ action: "API.ExecuteAddOnCommand", params: {...} }
 *
 * 响应：
 *   成功：{ ok: true, response: { succeeded: true, result: {...} } }
 *   失败：{ ok: false, error: "...", statusCode: 404/500/... }
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};

    // 归一化：提取 {command, parameters} 对象
    let archicadCommand = null;

    if (body.command && typeof body.command === 'object' && body.command.command) {
      // 格式 A：UI 格式 {command: {command, parameters}}
      archicadCommand = normalizeArchicadCommand(body.command);
    } else if (body.commandJson && typeof body.commandJson === 'object' && body.commandJson.command) {
      // 格式 A2：AI plan step 中携带的 commandJson
      archicadCommand = normalizeArchicadCommand(body.commandJson);
    } else if (body.commandName) {
      // 格式 D：Copilot / NL step 格式 {commandName, parameters}
      archicadCommand = commandNameToArchicadCommand(
        body.commandName,
        body.parameters || body.params || {},
        body.commandNamespace
      );
    } else if (body.action) {
      // 格式 B：execute-step 兼容 {action, params}
      archicadCommand = commandNameToArchicadCommand(body.action, body.params || {});
    } else if (typeof body.command === 'string') {
      // 格式 C：扁平 {command: "...", parameters: {...}}
      archicadCommand = commandNameToArchicadCommand(body.command, body.parameters || {});
    }

    if (!archicadCommand || !archicadCommand.command) {
      return res.status(400).json({
        ok: false,
        error: 'Missing command. Expected {command:{command,parameters}} or {action,params}',
        received: Object.keys(body)
      });
    }

    const endpoint = ARCHICAD_ENDPOINT();
    const dynamicResolution = await resolveDynamicCommandParameters(archicadCommand, endpoint);

    console.log(`[Execute] ${archicadCommand.command} -> Archicad @ ${endpoint}`);

    // V2 H1.4: 官方 API 命令透传安全包装（B 通道）
    // 官方命令（API.* 非 ExecuteAddOnCommand）走白名单 + 审计日志
    if (archicadCommand.command.startsWith('API.') && archicadCommand.command !== 'API.ExecuteAddOnCommand') {
      if (!OFFICIAL_API_WHITELIST.includes(archicadCommand.command)) {
        return res.status(403).json({
          ok: false,
          error: `Official API command '${archicadCommand.command}' is not in the H1.4 whitelist.`,
          errorType: 'OFFICIAL_COMMAND_NOT_WHITELISTED',
          whitelist: OFFICIAL_API_WHITELIST
        });
      }
      console.log(`[Execute] [H1.4 Official] ${archicadCommand.command} whitelisted, parameters:`, Object.keys(archicadCommand.parameters || {}));
    }

    // 透传到 Archicad JSON API
    const response = await axios.post(endpoint, archicadCommand, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    const archicadResult = response.data;
    const addOnResponse = archicadResult?.result?.addOnCommandResponse;
    const addOnStatus = addOnResponse?.status;
    const addOnSuccess = addOnResponse?.success;

    // 返回 UI 期望的格式 {ok, response}
    if (archicadResult.succeeded && addOnStatus !== 'error' && addOnSuccess !== false) {
      res.json({
        ok: true,
        response: archicadResult,
        command: archicadCommand,
        ...(dynamicResolution ? { dynamicResolution } : {})
      });
    } else {
      // Archicad 返回 succeeded:false
      res.json({
        ok: false,
        error: addOnResponse?.error?.message || addOnResponse?.error || archicadResult.error?.message || 'Archicad command failed',
        response: archicadResult,
        command: archicadCommand,
        ...(dynamicResolution ? { dynamicResolution } : {})
      });
    }
  } catch (error) {
    console.error('[Execute] Error:', error.message);

    if (error instanceof DynamicResolutionError) {
      return res.status(error.statusCode || 400).json({
        ok: false,
        error: error.message,
        errorType: error.code,
        detail: error.detail
      });
    }

    // 网络错误（Archicad 离线）
    if (error.response) {
      // Archicad 返回了 HTTP 错误
      return res.status(error.response.status).json({
        ok: false,
        error: `Archicad API error: ${error.response.status}`,
        detail: error.response.data
      });
    }

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        ok: false,
        error: `Archicad JSON API not reachable at ${ARCHICAD_ENDPOINT()}`,
        errorType: 'ARCHICAD_OFFLINE'
      });
    }

    res.status(500).json({
      ok: false,
      error: error.message,
      errorType: error.code || 'INTERNAL_ERROR'
    });
  }
});

function normalizeArchicadCommand(commandJson) {
  const command = {
    command: commandJson.command,
    parameters: clone(commandJson.parameters || {})
  };

  const addOnCommandId = command.parameters?.addOnCommandId;
  if (command.command === 'API.ExecuteAddOnCommand' && addOnCommandId?.commandName) {
    command.parameters.addOnCommandParameters = normalizeAddOnParameters(
      addOnCommandId.commandName,
      command.parameters.addOnCommandParameters || {}
    );
  }

  return command;
}

function commandNameToArchicadCommand(commandName, params = {}, commandNamespace) {
  const parsed = parseCommandName(commandName, commandNamespace);

  if (parsed.isApiCommand) {
    return normalizeArchicadCommand({
      command: parsed.commandName,
      parameters: params || {}
    });
  }

  return normalizeArchicadCommand({
    command: 'API.ExecuteAddOnCommand',
    parameters: {
      addOnCommandId: {
        commandNamespace: parsed.commandNamespace,
        commandName: parsed.commandName
      },
      addOnCommandParameters: params || {}
    }
  });
}

function parseCommandName(commandName, explicitNamespace) {
  const raw = String(commandName || '').trim();

  if (raw.startsWith('API.')) {
    return { isApiCommand: true, commandName: raw, commandNamespace: null };
  }

  if (raw.includes('.')) {
    const [namespace, ...rest] = raw.split('.');
    return {
      isApiCommand: false,
      commandNamespace: namespace || explicitNamespace || 'MEPBridge',
      commandName: rest.join('.')
    };
  }

  return {
    isApiCommand: false,
    commandNamespace: explicitNamespace || 'MEPBridge',
    commandName: raw
  };
}

function normalizeAddOnParameters(commandName, params) {
  const normalized = clone(params || {});

  if (commandName === 'CreatePipe') {
    if (!Array.isArray(normalized.waypoints) && normalized.start && normalized.end) {
      normalized.waypoints = [normalizePoint(normalized.start), normalizePoint(normalized.end)];
      delete normalized.start;
      delete normalized.end;
    } else if (Array.isArray(normalized.waypoints)) {
      normalized.waypoints = normalized.waypoints.map(normalizePoint);
    }
  }

  return normalizeCommandSafetyParameters(commandName, normalized);
}

function normalizePoint(point) {
  let x;
  let y;
  let z;

  if (Array.isArray(point)) {
    [x, y, z] = point;
  } else {
    ({ x, y, z } = point || {});
  }

  const values = [Number(x || 0), Number(y || 0), Number(z || 0)];
  const looksLikeMillimeters = values.some((value) => Math.abs(value) > 100);
  const divisor = looksLikeMillimeters ? 1000 : 1;

  return {
    x: values[0] / divisor,
    y: values[1] / divisor,
    z: values[2] / divisor
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

module.exports = router;
