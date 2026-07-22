const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Archicad JSON API 端口范围
const ARCHICAD_PORTS = Array.from({length: 21}, (_, i) => 19723 + i);
const APP_VERSION = '0.1.0';
const BUILD_INFO = {
  version: APP_VERSION,
  buildDate: process.env.MEPBRIDGE_BUILD_DATE || null,
  releaseChannel: process.env.MEPBRIDGE_RELEASE_CHANNEL || 'local'
};

function getDescriptorStats() {
  try {
    const descriptorPath = path.join(__dirname, '../../ai-adapter/tool-descriptors.json');
    const registry = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
    const descriptors = Array.isArray(registry.descriptors) ? registry.descriptors : [];
    const commandNames = new Set(descriptors.map(d => d.commandName).filter(Boolean));
    return {
      descriptorCount: descriptors.length,
      descriptorCommandCount: commandNames.size
    };
  } catch (_) {
    return {
      descriptorCount: null,
      descriptorCommandCount: null
    };
  }
}

// 上次已知的 Archicad/MEPBridge 状态（乐观断连策略，2026-06-29）
// 当 Archicad 正在执行耗时命令时，并发健康检查会超时，此时保留上次状态避免 UI 闪烁断连
let lastKnownStatus = {
  archicad: null,
  mepbridge: null,
  timestamp: 0
};
const STATUS_HOLD_DURATION = 15000; // 状态保留 15 秒（覆盖命令执行窗口）

// 检查连接状态
router.get('/', async (req, res) => {
  try {
    // 检查 Archicad
    const archicadStatus = await checkArchicad();

    // 检查 MEPBridge
    const mepbridgeStatus = archicadStatus === true ? await checkMEPBridge() : false;

    // 乐观策略：如果本次检查为 false 但上次为 true 且在保留窗口内，保持 true
    // 注意：保留窗口内不更新 timestamp，否则窗口永远不过期（Bug 修复 2026-07-05）
    const now = Date.now();
    const inHoldWindow = now - lastKnownStatus.timestamp < STATUS_HOLD_DURATION;

    const finalArchicad = archicadStatus === false && inHoldWindow && lastKnownStatus.archicad === true
      ? true : archicadStatus;
    const finalMepbridge = mepbridgeStatus === false && inHoldWindow && lastKnownStatus.mepbridge === true
      ? true : mepbridgeStatus;

    // 仅在真实检查结果为 true 时更新 timestamp（保留窗口不刷新窗口）
    if (archicadStatus === true) {
      lastKnownStatus.archicad = true;
      lastKnownStatus.timestamp = now;
    } else if (!inHoldWindow) {
      // 保留窗口已过期，清除旧状态
      lastKnownStatus.archicad = false;
    }
    if (mepbridgeStatus === true) {
      lastKnownStatus.mepbridge = true;
    } else if (!inHoldWindow) {
      lastKnownStatus.mepbridge = false;
    }

    res.json({
      ok: finalArchicad && finalMepbridge, // UI 需要的格式
      archicad: finalArchicad,
      mepbridge: finalMepbridge,
      port: finalArchicad === true ? global.archicadPort : null,
      version: APP_VERSION,
      build: BUILD_INFO,
      ...getDescriptorStats(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      ok: false,
      archicad: false,
      mepbridge: false,
      version: APP_VERSION,
      build: BUILD_INFO,
      ...getDescriptorStats(),
      error: error.message
    });
  }
});

// 检查 Archicad JSON API
async function checkArchicad() {
  for (const port of ARCHICAD_PORTS) {
    try {
      const response = await axios.post(
        `http://127.0.0.1:${port}`,
        { command: 'API.GetProductInfo' },
        { timeout: 1000 }
      );

      if (response.data && (response.data.version || response.data.result?.version)) {
        global.archicadPort = port;
        return true;
      }
    } catch (err) {
      // 继续尝试下一个端口
    }
  }
  return false;
}

// 检查 MEPBridge Add-On
async function checkMEPBridge() {
  try {
    const response = await axios.post(
      `http://127.0.0.1:${global.archicadPort}`,
      {
        command: 'API.ExecuteAddOnCommand',
        parameters: {
          addOnCommandId: {
            commandNamespace: 'MEPBridge',
            commandName: 'Ping'
          },
          addOnCommandParameters: {}
        }
      },
      { timeout: 2000 }
    );

    // MEPBridge Ping 返回嵌套在 result.addOnCommandResponse 中
    const pingResult = response.data?.result?.addOnCommandResponse || response.data?.result || response.data;
    return pingResult?.status === 'ok';
  } catch (err) {
    return false;
  }
}

module.exports = router;
