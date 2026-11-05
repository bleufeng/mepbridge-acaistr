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
    const addonCommands = descriptors.filter(d => d.executionKind === 'mepbridge-addon-command').length;
    const serverTools = descriptors.filter(d => d.executionKind === 'server-endpoint').length;
    return {
      descriptorCount: descriptors.length,
      descriptorCommandCount: commandNames.size,
      totalDescriptors: descriptors.length,
      addonCommands,
      serverTools
    };
  } catch (_) {
    return {
      descriptorCount: null,
      descriptorCommandCount: null,
      totalDescriptors: null,
      addonCommands: null,
      serverTools: null
    };
  }
}

// 上次已知的 Archicad/MEPBridge 状态（乐观断连策略，2026-06-29）
// 当 Archicad 正在执行耗时命令时，并发健康检查会超时，此时保留上次状态避免 UI 闪烁断连
let lastKnownStatus = {
  archicad: null,
  mepbridge: null,
  timestamp: 0,
  port: null,
  archicadVersion: null,
  addOnVersion: null,
  projectName: null,
  instances: []
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

    // 获取当前实例详情
    const instances = Array.isArray(global.archicadInstances) ? global.archicadInstances : [];
    const activeInst = instances.find(i => i.port === global.archicadPort) || null;
    const currentArchicadVersion = activeInst?.archicadVersion ?? activeInst?.productInfo?.version ?? null;
    const currentAddOnVersion = activeInst?.addOnVersion ?? null;
    const currentProjectName = activeInst?.projectName ?? null;

    // 仅在真实检查结果为 true 时更新 timestamp（保留窗口不刷新窗口）
    if (archicadStatus === true) {
      lastKnownStatus.archicad = true;
      lastKnownStatus.timestamp = now;
      lastKnownStatus.port = global.archicadPort;
      lastKnownStatus.archicadVersion = currentArchicadVersion;
      lastKnownStatus.addOnVersion = currentAddOnVersion;
      lastKnownStatus.projectName = currentProjectName;
      lastKnownStatus.instances = instances;
    } else if (!inHoldWindow) {
      // 保留窗口已过期，清除旧状态
      lastKnownStatus.archicad = false;
      lastKnownStatus.port = null;
      lastKnownStatus.archicadVersion = null;
      lastKnownStatus.addOnVersion = null;
      lastKnownStatus.projectName = null;
      lastKnownStatus.instances = [];
    }
    if (mepbridgeStatus === true) {
      lastKnownStatus.mepbridge = true;
    } else if (!inHoldWindow) {
      lastKnownStatus.mepbridge = false;
    }

    const resolvedPort = finalArchicad === true ? (global.archicadPort || lastKnownStatus.port || null) : null;
    const resolvedArchicadVersion = finalArchicad === true ? (currentArchicadVersion ?? lastKnownStatus.archicadVersion ?? null) : null;
    const resolvedAddOnVersion = finalMepbridge === true ? (currentAddOnVersion || lastKnownStatus.addOnVersion || APP_VERSION) : null;
    const resolvedProjectName = finalArchicad === true ? (currentProjectName ?? lastKnownStatus.projectName ?? null) : null;
    const resolvedInstances = finalArchicad === true
      ? (instances.length > 0 ? instances : (lastKnownStatus.instances || []))
      : [];

    res.json({
      ok: finalArchicad && finalMepbridge, // UI 需要的格式
      archicad: finalArchicad,
      mepbridge: finalMepbridge,
      port: resolvedPort,
      archicadVersion: resolvedArchicadVersion,
      addOnVersion: resolvedAddOnVersion,
      projectName: resolvedProjectName,
      instances: resolvedInstances.map(inst => ({
        port: inst.port,
        version: inst.version ?? inst.archicadVersion ?? inst.productInfo?.version ?? null,
        archicadVersion: inst.archicadVersion ?? inst.version ?? inst.productInfo?.version ?? null,
        productInfo: inst.productInfo || null,
        mepbridge: !!inst.mepbridge,
        addOnVersion: inst.addOnVersion || null,
        projectName: inst.projectName || null,
        projectPath: inst.projectPath || null,
        untitled: inst.untitled ?? null,
        teamwork: inst.teamwork ?? null
      })),
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
      port: null,
      archicadVersion: null,
      instances: [],
      version: APP_VERSION,
      build: BUILD_INFO,
      ...getDescriptorStats(),
      error: error.message
    });
  }
});

// 检查 Archicad JSON API
//
// 并行发现全部实例并补齐描述（原实现仅返回端口，无法向 UI 暴露宿主版本与多实例）。
// global.archicadPort 沿用已知存活端口，双实例下不会跳变到另一个工程；
// global.archicadInstances 供 /instances、/api/ping 与多实例切换使用。
async function checkArchicad() {
  const described = await describeAllInstances({ post: axios.post });
  if (!described || described.length === 0) {
    global.archicadInstances = [];
    return false;
  }

  const primary = pickPrimaryPort(described, global.archicadPort);
  if (primary == null) return false;

  global.archicadPort = primary;
  global.archicadInstances = described;
  return true;
}

// 检查 MEPBridge Add-On
async function checkMEPBridge() {
  const current = (global.archicadInstances || []).find((i) => i.port === global.archicadPort);
  if (current && typeof current.mepbridge === 'boolean') {
    return current.mepbridge;
  }
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

// 动态切换当前主操作的 Archicad 实例端口
router.post('/primary', async (req, res) => {
  const targetPort = Number(req.body?.port);
  if (!Number.isInteger(targetPort) || targetPort < 19723 || targetPort > 19743) {
    return res.status(400).json({ ok: false, error: 'Invalid port', errorType: 'INVALID_TARGET_PORT' });
  }
  try {
    const { describeAllInstances } = require('../services/archicad-instances');
    const instances = await describeAllInstances({ post: axios.post, ports: [targetPort], probeTimeout: 1000, describeTimeout: 2500 });
    const target = instances.find(instance => instance.port === targetPort);
    if (!target) return res.status(503).json({ ok: false, error: 'Target Archicad instance is offline', errorType: 'TARGET_PORT_NOT_LIVE' });
    if (target.mepbridge !== true) return res.status(409).json({ ok: false, error: 'MEPBridge is not loaded on target instance', errorType: 'TARGET_MEPBRIDGE_NOT_AVAILABLE' });
    global.archicadPort = targetPort;
    global.archicadInstances = instances;
    lastKnownStatus = { archicad: null, mepbridge: null, timestamp: 0, archicadVersion: null, addOnVersion: null };
    res.json({ ok: true, primaryPort: global.archicadPort, target });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message, errorType: 'TARGET_VALIDATION_FAILED' });
  }
});

function compareSemVer(v1, v2) {
  const clean = (v) => {
    if (!v || typeof v !== 'string') return [0, 0, 0];
    const match = v.trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return [0, 0, 0];
    return [parseInt(match[1] || '0', 10), parseInt(match[2] || '0', 10), parseInt(match[3] || '0', 10)];
  };
  const [maj1, min1, pat1] = clean(v1);
  const [maj2, min2, pat2] = clean(v2);
  if (maj1 !== maj2) return maj1 > maj2 ? 1 : -1;
  if (min1 !== min2) return min1 > min2 ? 1 : -1;
  if (pat1 !== pat2) return pat1 > pat2 ? 1 : -1;
  return 0;
}

// 检查插件更新（检测依据：GitHub公开仓 https://github.com/bleufeng/mepbridge-acaistr/releases）
router.get('/check-update', async (req, res) => {
  const GITHUB_REPO = 'bleufeng/mepbridge-acaistr';
  const RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases`;
  const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const currentVersion = APP_VERSION;

  try {
    const response = await fetch(GITHUB_API_URL, {
      headers: {
        'User-Agent': 'MEPBridge-ACAIstr-Workbench',
        'Accept': 'application/vnd.github.v3+json'
      },
      signal: AbortSignal.timeout(4000)
    });

    if (!response.ok) {
      throw new Error(`GitHub API HTTP ${response.status}`);
    }

    const releaseData = await response.json();
    const rawTag = releaseData.tag_name || '';
    const latestVersion = rawTag.replace(/^v/i, '').trim();
    const releaseUrl = releaseData.html_url || RELEASES_PAGE_URL;
    const releaseName = releaseData.name || rawTag;

    const cmp = compareSemVer(currentVersion, latestVersion);
    let updateStatus = 'UP_TO_DATE';
    let hasUpdate = false;
    let isAhead = false;

    if (cmp < 0) {
      updateStatus = 'UPDATE_AVAILABLE';
      hasUpdate = true;
    } else if (cmp > 0) {
      // 本地版本高于公开仓（从第三方直接升级了高版本 / 预览先行版）
      updateStatus = 'AHEAD_OF_REMOTE';
      isAhead = true;
    } else {
      updateStatus = 'UP_TO_DATE';
    }

    return res.json({
      ok: true,
      currentVersion,
      latestVersion,
      updateStatus,
      hasUpdate,
      isAhead,
      releaseUrl,
      releasesPageUrl: RELEASES_PAGE_URL,
      releaseName,
      checkedAt: new Date().toISOString()
    });
  } catch (err) {
    return res.json({
      ok: true,
      currentVersion,
      latestVersion: currentVersion,
      updateStatus: 'OFFLINE_CHECK',
      hasUpdate: false,
      isAhead: false,
      offline: true,
      releaseUrl: RELEASES_PAGE_URL,
      releasesPageUrl: RELEASES_PAGE_URL,
      error: err.message,
      checkedAt: new Date().toISOString()
    });
  }
});

module.exports = router;
module.exports._test = { checkArchicad, checkMEPBridge };
