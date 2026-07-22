// proactive-intelligence.js (routes)
// V2 H10.5: 主动智能 API（建议气泡 + 灵敏度配置）
//
// 端点：
//   GET  /api/proactive/suggestions        — 获取主动建议（缺口+预判+异常）
//   GET  /api/proactive/gaps               — 仅获取工作流缺口
//   GET  /api/proactive/anomalies          — 仅获取异常预警
//   GET  /api/proactive/predict            — 预判下一步（基于选择集）
//   GET  /api/proactive/sensitivity        — 获取当前灵敏度
//   POST /api/proactive/sensitivity        — 设置灵敏度（off/low/medium/aggressive）

const express = require('express');
const router = express.Router();
const proactiveIntel = require('../services/proactive-intelligence');
const archicadClient = require('../services/archicad-client');

/**
 * 获取当前选择集（用于预判）
 */
async function fetchSelection() {
  try {
    const result = await archicadClient.executeCommand('GetSelectedElements', {
      onlyEditable: false, includeAabb: false, includeMepInfo: true
    });
    if (!result.success || !result.data) return null;

    const rawElements = result.data.elements || result.data.result?.elements || [];
    if (!Array.isArray(rawElements) || rawElements.length === 0) {
      return { count: 0, types: [] };
    }
    const typeCounts = {};
    for (const el of rawElements) {
      const type = el.type || 'Unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }
    return {
      count: rawElements.length,
      types: Object.entries(typeCounts).map(([type, count]) => ({ type, count }))
    };
  } catch (e) {
    return null;
  }
}

/**
 * GET /api/proactive/suggestions
 * 获取综合主动建议（异常 + 缺口 + 预判）
 */
router.get('/suggestions', async (req, res) => {
  try {
    const selection = await fetchSelection();
    const result = await proactiveIntel.generateSuggestions(selection);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/proactive/gaps
 * 仅获取工作流缺口检测
 */
router.get('/gaps', async (req, res) => {
  try {
    const result = await proactiveIntel.detectGaps();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/proactive/anomalies
 * 仅获取异常预警
 */
router.get('/anomalies', async (req, res) => {
  try {
    const result = await proactiveIntel.detectAnomalies();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/proactive/predict
 * 预判下一步操作（基于当前选择集）
 */
router.get('/predict', async (req, res) => {
  try {
    const selection = await fetchSelection();
    const result = proactiveIntel.predictNextAction(selection);
    res.json({ ok: true, selection, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/proactive/sensitivity
 * 获取当前灵敏度配置
 */
router.get('/sensitivity', (req, res) => {
  res.json({ ok: true, ...proactiveIntel.getSensitivity() });
});

/**
 * POST /api/proactive/sensitivity
 * 设置灵敏度（H10.6）
 * Body: { level: 'off' | 'low' | 'medium' | 'aggressive' }
 */
router.post('/sensitivity', (req, res) => {
  const { level } = req.body;
  const validLevels = ['off', 'low', 'medium', 'aggressive'];
  if (!validLevels.includes(level)) {
    return res.status(400).json({
      ok: false,
      error: `Invalid level. Valid: ${validLevels.join(', ')}`
    });
  }
  const success = proactiveIntel.setSensitivity(level);
  res.json({ ok: success, ...proactiveIntel.getSensitivity() });
});

module.exports = router;
