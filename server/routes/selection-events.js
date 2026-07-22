// selection-events.js 路由
// FO-2 (2026-06-26): 选择集事件推送 API
// - GET /api/selection/stream  → SSE 实时推送（替代 UI 端轮询）
// - GET /api/selection/state  → REST 当前选择集状态

const express = require('express');
const router = express.Router();
const selectionEventService = require('../services/selection-events');

/**
 * GET /api/selection/stream
 * Server-Sent Events (SSE) 端点 — 实时推送选择集变更
 *
 * 使用方法:
 *   const es = new EventSource('/api/selection/stream');
 *   es.onmessage = (e) => { const data = JSON.parse(e.data); ... };
 */
router.get('/stream', (req, res) => {
  // SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // 禁止 nginx 缓冲
  });

  // 心跳：每 15s 发一次 keepalive comment（防止代理断连）
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 15000);

  // 注册到选择集事件服务
  selectionEventService.addListener(res);

  // 清理
  req.on('close', () => {
    clearInterval(heartbeat);
    selectionEventService.removeListener(res);
  });
});

/**
 * GET /api/selection/state
 * REST 端点 — 返回当前选择集状态（一次性查询，兼容非 SSE 场景）
 *
 * 响应: { timestamp, count, types[], guids[], source }
 */
router.get('/state', (req, res) => {
  const state = selectionEventService.getState();
  res.json({
    ok: true,
    ...state,
    serverTime: new Date().toISOString()
  });
});

module.exports = router;
