// snapshot-replay.js 路由
// D-2 元素快照与 preview-first 回放、D-3 快照差异报告的 HTTP 入口。
//
//   POST /api/snapshot-replay/capture  —— 采集快照（读来源工程）
//   POST /api/snapshot-replay/preview  —— 生成回放 preview（读目标工程，绝不 mutation）
//   POST /api/snapshot-replay/apply    —— 绑定 preview 执行回放（dryRun/confirmRequired）
//   POST /api/snapshot-replay/compare  —— D-3 差异报告（纯计算，不连 Archicad、绝无 mutation）
//
// 语义权威：快照回放契约 D2_SNAPSHOT_REPLAY_CONTRACT（内部文档，不在公开仓库内）。
// 服务实例进程内共享（preview 存储需要跨请求存活）。

'use strict';

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { createSnapshotReplayService } = require('../services/snapshot-replay');
const { compareSnapshots } = require('../services/snapshot-diff');
const { getArchicadEndpoint } = require('../services/archicad-endpoint');
const { resolveTargetInstance } = require('../services/instance-targeting');

// 真实 callCommand：直连 Archicad JSON API 执行 MEPBridge add-on 命令。
// 失败语义与项目其它运行时一致：外层 succeeded:false 或 payload.status==='error' 均抛错。
async function callCommand (endpoint, commandName, params) {
  const response = await axios.post(endpoint, {
    command: 'API.ExecuteAddOnCommand',
    parameters: {
      addOnCommandId: { commandNamespace: 'MEPBridge', commandName },
      addOnCommandParameters: params || {}
    }
  }, { timeout: 60000, proxy: false, headers: { 'Content-Type': 'application/json' } });

  const outer = response.data;
  const payload = outer && outer.result ? (outer.result.addOnCommandResponse || outer.result) : outer;
  if (!outer || outer.succeeded === false || payload.status === 'error' || payload.success === false) {
    const message = (payload && payload.error && payload.error.message)
      || (outer && outer.error && outer.error.message)
      || `MEPBridge ${commandName} 失败`;
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
  return payload;
}

// resolveInstance 适配：{port?, project?} → instance-targeting 契约。
async function resolveInstance (spec) {
  if (spec.port === undefined && spec.project === undefined) {
    return { ok: true, port: null };
  }
  const body = {};
  if (spec.port !== undefined) body.targetPort = spec.port;
  if (spec.project !== undefined) body.targetProject = spec.project;
  const resolved = await resolveTargetInstance(body, {
    post: (url, data, config) => axios.post(url, data, config),
    probeTimeout: 1500
  });
  if (!resolved.requested) return { ok: true, port: null };
  if (!resolved.ok) {
    return { ok: false, errorType: resolved.errorType, message: resolved.message, detail: resolved.detail };
  }
  return { ok: true, port: resolved.port };
}

const service = createSnapshotReplayService({
  callCommand,
  resolveInstance,
  getEndpoint: () => getArchicadEndpoint()
});

function sendResult (res, result) {
  if (result.ok) {
    const body = result.snapshot ? { snapshot: result.snapshot, warnings: result.warnings } : { preview: result.preview };
    return res.json({ ok: true, ...body, ...(result.result ? { result: result.result } : {}) });
  }
  return res.status(result.httpStatus || 400).json({
    ok: false,
    error: result.message,
    errorType: result.errorType,
    detail: result.detail
  });
}

// POST /api/snapshot-replay/capture
router.post('/capture', async (req, res) => {
  try {
    const result = await service.captureSnapshot(req.body || {});
    sendResult(res, result);
  } catch (error) {
    console.error('[SnapshotReplay][capture] error:', error.message);
    res.status(500).json({ ok: false, error: error.message, errorType: 'INTERNAL_ERROR' });
  }
});

// POST /api/snapshot-replay/preview
router.post('/preview', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await service.buildPreview({
      snapshot: body.snapshot,
      targetPort: body.targetPort,
      targetProject: body.targetProject
    });
    sendResult(res, result);
  } catch (error) {
    console.error('[SnapshotReplay][preview] error:', error.message);
    res.status(500).json({ ok: false, error: error.message, errorType: 'INTERNAL_ERROR' });
  }
});

// POST /api/snapshot-replay/apply
router.post('/apply', async (req, res) => {
  try {
    const result = await service.applyReplay(req.body || {});
    sendResult(res, result);
  } catch (error) {
    console.error('[SnapshotReplay][apply] error:', error.message);
    res.status(500).json({ ok: false, error: error.message, errorType: 'INTERNAL_ERROR' });
  }
});

// POST /api/snapshot-replay/compare
//
// D-3 差异报告。纯计算：两份快照里已含全部信息，无需连 Archicad，因此该端点
// 不接受 targetPort/targetProject，也绝不产生任何 mutation。
router.post('/compare', (req, res) => {
  try {
    const body = req.body || {};
    const result = compareSnapshots({
      snapshotA: body.snapshotA,
      snapshotB: body.snapshotB,
      distanceToleranceM: body.distanceToleranceM
    });
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.message,
        errorType: result.errorType
      });
    }
    res.json({ ok: true, report: result.report });
  } catch (error) {
    console.error('[SnapshotReplay][compare] error:', error.message);
    res.status(500).json({ ok: false, error: error.message, errorType: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
