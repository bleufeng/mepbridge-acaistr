const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { APP_VERSION } = require('../services/app-version');
const {
  DEFAULT_PORTS: ARCHICAD_PORTS,
  discoverInstances,
  pickPrimaryPort,
  describeAllInstances,
} = require('../services/archicad-instances');

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
//
// 改为并行发现全部实例（原实现命中首个端口即 return，只能看到一个实例）。
// global.archicadPort 沿用已知存活端口，双实例下不会跳变到另一个工程；
// global.archicadInstances 供 /instances 与后续跨文件功能使用。
async function checkArchicad() {
  const instances = await discoverInstances({ post: axios.post });
  global.archicadInstances = instances;

  const primary = pickPrimaryPort(instances, global.archicadPort);
  if (primary == null) return false;

  global.archicadPort = primary;
  return true;
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

// 列出全部在线 Archicad 实例及各自打开的工程
//
// 跨文件对比（A 文件读 / B 文件写）的前置能力：一个 Archicad 实例只能打开一个工程，
// 且 ACAPI_ProjectOperation_Open 在 Add-On 命令上下文中会被拒绝（APIERR_REFUSEDCMD），
// 因此真正的「同时」只能靠多实例。此端点只读，不改任何模型。
router.get('/instances', async (req, res) => {
  try {
    const instances = await describeAllInstances({ post: axios.post });
    const withMepbridge = instances.filter((i) => i.mepbridge);
    const distinctProjects = new Set(
      instances.map((i) => i.projectPath).filter(Boolean)
    );

    res.json({
      ok: true,
      count: instances.length,
      mepbridgeCount: withMepbridge.length,
      distinctProjectCount: distinctProjects.size,
      primaryPort: global.archicadPort || null,
      scannedPorts: { from: ARCHICAD_PORTS[0], to: ARCHICAD_PORTS[ARCHICAD_PORTS.length - 1] },
      instances,
      note: distinctProjects.size > 1
        ? 'Multiple distinct projects are open; cross-file read/write is possible by addressing instances separately.'
        : 'Fewer than two distinct projects are open; cross-file comparison needs a second Archicad instance with another project.',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;
module.exports._test = { checkArchicad, checkMEPBridge };
