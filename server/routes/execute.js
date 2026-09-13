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
const { getArchicadEndpoint, endpointForPort } = require('../services/archicad-endpoint');
const { resolveTargetInstance } = require('../services/instance-targeting');
const { normalizeCommandSafetyParameters } = require('../services/command-capabilities');
const {
  getOfficialApiCapabilities,
  getDirectOfficialApiCommands,
  createOfficialApiPreview,
  getOfficialApiPreview,
  consumeOfficialApiPreview,
  validateAuthorizedOfficialApiExecute,
  extractPropertyWriteTargets,
  comparePropertyReadback,
} = require('../services/official-api-capabilities');

// Archicad JSON API 端点：动态解析（global.archicadPort > 环境变量 > 默认 19723）
// 不能再硬编码 19723 —— AC29 实测会用 19724，导致 ping 在线但执行报 ARCHICAD_OFFLINE
function ARCHICAD_ENDPOINT() {
  return getArchicadEndpoint();
}

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

    // D-1 目标实例寻址：顶层 targetPort / targetProject（所有 body 格式通用）。
    // 未提供时行为与历史完全一致（默认端点）；提供了就必须解析成功，
    // 未命中/多候选/类型非法显式失败 —— 绝不静默回落默认端口。
    let endpoint = ARCHICAD_ENDPOINT();
    const targeting = await resolveTargetInstance(body, {
      post: (url, data, config) => axios.post(url, data, config),
      probeTimeout: 1500,
    });
    if (targeting.requested) {
      if (!targeting.ok) {
        const isUnreachable = targeting.errorType === 'TARGET_PORT_NOT_LIVE'
          || targeting.errorType === 'NO_ARCHICAD_INSTANCES';
        console.warn(`[Execute][D1] target resolve failed: ${targeting.errorType} - ${targeting.message}`);
        return res.status(isUnreachable ? 503 : 400).json({
          ok: false,
          error: targeting.message,
          errorType: targeting.errorType,
          detail: targeting.detail
        });
      }
      endpoint = endpointForPort(targeting.port);
      console.log(`[Execute][D1] resolved target -> port ${targeting.port} (mode: ${targeting.mode})`);
    }

    const dynamicResolution = await resolveDynamicCommandParameters(archicadCommand, endpoint);

    console.log(`[Execute] ${archicadCommand.command} -> Archicad @ ${endpoint}`);
    let guardedOfficialContext = null;

    // V2 H1.4: 官方 API 命令透传安全包装（B 通道）
    // 官方命令（API.* 非 ExecuteAddOnCommand）走白名单 + 审计日志
    if (archicadCommand.command.startsWith('API.') && archicadCommand.command !== 'API.ExecuteAddOnCommand') {
      const capability = getOfficialApiCapabilities(archicadCommand.command);
      const whitelist = getDirectOfficialApiCommands();
      if (!capability?.directAllowed || !whitelist.includes(archicadCommand.command)) {
        return res.status(403).json({
          ok: false,
          error: `Official API command '${archicadCommand.command}' is not in the direct whitelist.`,
          errorType: 'OFFICIAL_COMMAND_NOT_WHITELISTED',
          whitelist,
          capability: capability || null,
        });
      }
      const officialResult = await handleOfficialApiCapability({
        body,
        command: archicadCommand,
        capability,
        endpoint,
      });
      if (officialResult.handled) return res.status(officialResult.statusCode || 200).json(officialResult.body);
      guardedOfficialContext = officialResult.context || null;
      console.log(`[Execute] [B Official] ${archicadCommand.command} (${capability.layer}), parameters:`, Object.keys(archicadCommand.parameters || {}));
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
      let responseBody = {
        ok: true,
        response: archicadResult,
        command: archicadCommand,
        ...(targeting.requested ? { target: { port: targeting.port, mode: targeting.mode } } : {}),
        ...(dynamicResolution ? { dynamicResolution } : {})
      };
      // Guarded property writes return readback status in the same response.
      if (guardedOfficialContext) {
        responseBody = await completeOfficialApiResponse(responseBody, guardedOfficialContext, endpoint);
      }
      res.json(responseBody);
    } else {
      // Archicad 返回 succeeded:false
      res.json({
        ok: false,
        error: addOnResponse?.error?.message || addOnResponse?.error || archicadResult.error?.message || 'Archicad command failed',
        response: archicadResult,
        command: archicadCommand,
        ...(targeting.requested ? { target: { port: targeting.port, mode: targeting.mode } } : {}),
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

// SetPropertyValuesOfElements is the one currently allowed official mutation
// that needs an explicit preview/authorization/execute/readback binding.
// This is a request-level handshake; it does not insert a human wait between
// already-authorized AI steps.
async function handleOfficialApiCapability({ body, command, capability, endpoint }) {
  if (!capability.requiresAuthorization) return { handled: false };

  if (!capability.supportsPreview || capability.command !== 'API.SetPropertyValuesOfElements') {
    return { handled: true, statusCode: 403, body: { ok: false, error: 'Official mutation is not enabled for direct execution', errorType: 'OFFICIAL_MUTATION_NOT_ENABLED' } };
  }

  const protocol = body.officialApi;
  if (!protocol || typeof protocol !== 'object') {
    return { handled: true, statusCode: 403, body: { ok: false, error: '属性写入必须先 preview，并携带 officialApi 授权上下文', errorType: 'OFFICIAL_AUTHORIZATION_REQUIRED' } };
  }
  const phase = protocol.phase;
  const readback = protocol.readback;
  const authorization = protocol.authorization;
  if (!authorization || typeof authorization.scope !== 'object' || Array.isArray(authorization.scope) || Object.keys(authorization.scope).length === 0) {
    return { handled: true, statusCode: 400, body: { ok: false, error: 'officialApi.authorization.scope 必须是非空对象', errorType: 'OFFICIAL_SCOPE_REQUIRED' } };
  }
  if (!readback || readback.command !== capability.readbackCommand || !readback.parameters || typeof readback.parameters !== 'object' || Array.isArray(readback.parameters)) {
    return { handled: true, statusCode: 400, body: { ok: false, error: `必须提供 ${capability.readbackCommand} readback 请求`, errorType: 'OFFICIAL_READBACK_REQUIRED' } };
  }

  if (phase === 'preview') {
    const targets = extractPropertyWriteTargets(command.parameters);
    if (!targets.ok) {
      return { handled: true, statusCode: 400, body: { ok: false, error: targets.message, errorType: targets.errorType } };
    }
    const preview = createOfficialApiPreview({
      command: command.command,
      parameters: command.parameters,
      authorization,
      readback,
      endpoint,
    });
    return {
      handled: true,
      body: { ok: true, preview: true, capability, officialApi: preview, command },
    };
  }

  if (phase !== 'execute') {
    return { handled: true, statusCode: 400, body: { ok: false, error: 'officialApi.phase 只能是 preview 或 execute', errorType: 'OFFICIAL_PHASE_INVALID' } };
  }
  if (protocol.authorization.granted !== true) {
    return { handled: true, statusCode: 403, body: { ok: false, error: '真实属性写入必须携带 authorization.granted=true', errorType: 'OFFICIAL_AUTHORIZATION_REQUIRED' } };
  }
  const entry = getOfficialApiPreview(protocol.previewId);
  const validation = validateAuthorizedOfficialApiExecute({
    request: protocol,
    entry,
    command: command.command,
    parameters: command.parameters,
    endpoint,
  });
  if (!validation.ok) {
    return { handled: true, statusCode: validation.errorType === 'OFFICIAL_PREVIEW_NOT_FOUND' ? 404 : 409, body: { ok: false, error: validation.message, errorType: validation.errorType } };
  }
  // Consume before forwarding to make a preview single-use even if the client retries.
  consumeOfficialApiPreview(protocol.previewId);
  return {
    handled: false,
    context: { readback, capability, previewId: protocol.previewId, parameters: command.parameters },
  };
}

async function completeOfficialApiResponse(responseBody, context, endpoint) {
  try {
    const readbackResponse = await axios.post(endpoint, context.readback, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    const readbackData = readbackResponse.data;
    const comparison = comparePropertyReadback(context.parameters, readbackData);
    const verified = comparison.verified;
    return {
      ...responseBody,
      officialApi: {
        phase: 'execute',
        previewId: context.previewId,
        readback: readbackData,
        readbackVerified: verified,
        comparison,
      },
      ok: responseBody.ok && verified,
      ...(verified ? {} : { error: '属性写入后 readback 未通过', errorType: comparison.errorType || 'OFFICIAL_READBACK_FAILED' }),
    };
  } catch (error) {
    return {
      ...responseBody,
      ok: false,
      error: '属性写入后 readback 请求失败',
      errorType: 'OFFICIAL_READBACK_FAILED',
      officialApi: {
        phase: 'execute',
        previewId: context.previewId,
        readbackVerified: false,
        readbackError: error.message,
      },
    };
  }
}

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
