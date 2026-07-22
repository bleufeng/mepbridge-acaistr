const axios = require('axios');
const {
  DynamicResolutionError,
  resolveDynamicCommandParameters
} = require('./dynamic-command-resolver');
const { getArchicadEndpoint } = require('./archicad-endpoint');

class ArchicadClient {
  constructor() {
    // 不再硬编码 19723：AC29 实测会用 19724
    // endpoint 改为每次调用时动态解析（global.archicadPort > 环境变量 > 默认 19723）
  }

  // 获取当前 Archicad JSON API 端点
  get endpoint() {
    return getArchicadEndpoint();
  }

  // 执行 MEPBridge 命令
  async executeCommand(commandName, params = {}) {
    try {
      const parsed = parseCommandName(commandName);

      const payload = parsed.isApiCommand
        ? { command: parsed.commandName, parameters: params || {} }
        : {
            command: 'API.ExecuteAddOnCommand',
            parameters: {
              addOnCommandId: {
                commandNamespace: parsed.commandNamespace,
                commandName: parsed.commandName
              },
              addOnCommandParameters: normalizeAddOnParameters(parsed.commandName, params)
            }
          };

      const dynamicResolution = await resolveDynamicCommandParameters(payload, this.endpoint);
      const response = await axios.post(this.endpoint, payload, { timeout: 30000 });

      if (response.data.succeeded) {
        const addOnResponse = response.data.result?.addOnCommandResponse;
        if (addOnResponse?.status === 'error' || addOnResponse?.success === false) {
          return {
            success: false,
            error: addOnResponse?.error?.message || addOnResponse?.error || 'Command failed',
            data: addOnResponse
          };
        }

        return {
          success: true,
          data: addOnResponse || response.data.result,
          dynamicResolution
        };
      } else {
        return {
          success: false,
          error: response.data.error?.message || 'Command failed'
        };
      }
    } catch (error) {
      if (error instanceof DynamicResolutionError) {
        return {
          success: false,
          error: error.message,
          errorType: error.code,
          detail: error.detail
        };
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  // 撤销操作
  async undo() {
    try {
      const response = await axios.post(
        this.endpoint,
        {
          command: 'API.Undo'
        },
        { timeout: 5000 }
      );

      return {
        success: response.data.succeeded || false,
        error: response.data.error?.message
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

function parseCommandName(commandName) {
  const raw = String(commandName || '').trim();
  if (raw.startsWith('API.')) {
    return { isApiCommand: true, commandName: raw, commandNamespace: null };
  }

  if (raw.includes('.')) {
    const [commandNamespace, ...rest] = raw.split('.');
    return {
      isApiCommand: false,
      commandNamespace,
      commandName: rest.join('.')
    };
  }

  return {
    isApiCommand: false,
    commandNamespace: 'MEPBridge',
    commandName: raw
  };
}

function normalizeAddOnParameters(commandName, params) {
  const normalized = JSON.parse(JSON.stringify(params || {}));

  if (commandName === 'CreatePipe') {
    if (!Array.isArray(normalized.waypoints) && normalized.start && normalized.end) {
      normalized.waypoints = [normalizePoint(normalized.start), normalizePoint(normalized.end)];
      delete normalized.start;
      delete normalized.end;
    } else if (Array.isArray(normalized.waypoints)) {
      normalized.waypoints = normalized.waypoints.map(normalizePoint);
    }
  }

  if (!supportsDryRunConfirmation(commandName)) {
    delete normalized.dryRun;
    delete normalized.confirmRequired;
  }

  return normalized;
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

function supportsDryRunConfirmation(commandName) {
  return [
    'MoveElements', 'MoveSelectedElements', 'EditElements', 'EditSelectedElements',
    'CopyElements', 'AutoRoutePipe',
    // V2 H1.1 建筑创建
    'CreateWall', 'CreateColumn', 'CreateBeam', 'CreateSlab', 'CreateDoor', 'CreateWindow', 'CreateRoof',
    'CreateStair',
    // V2 H1.3 变换
    'RotateSelectedElements', 'MirrorSelectedElements',
    // MEP 创建命令
    'CreateDuct', 'CreatePipe', 'CreatePipeSystem', 'CreateCableCarrier',
    'CreateFlexibleSegment', 'CreateTakeOff'
  ].includes(commandName);
}

module.exports = new ArchicadClient();
