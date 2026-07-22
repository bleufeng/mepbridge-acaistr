// learning-memory.js (routes)
// V2 H9.5: 学习记忆 UI 查看 + 管理 API
//
// 端点：
//   GET    /api/learning-memory/corrections        — 列出纠正记录
//   GET    /api/learning-memory/patterns           — 列出模式学习
//   POST   /api/learning-memory/corrections        — 记录新纠正（H9.1）
//   DELETE /api/learning-memory/corrections/:id    — 删除单条纠正
//   DELETE /api/learning-memory/clear              — 清除所有学习记忆（H9.6）
//   POST   /api/learning-memory/check              — 校验计划是否触发历史错误（H9.4）

const express = require('express');
const router = express.Router();
const learningMemory = require('../services/learning-memory');

/**
 * GET /api/learning-memory/corrections
 * 列出纠正记录（最近 limit 条，默认50）
 */
router.get('/corrections', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const corrections = learningMemory.listCorrections(limit);
  res.json({
    ok: true,
    count: corrections.length,
    corrections
  });
});

/**
 * GET /api/learning-memory/patterns
 * 列出模式学习记录
 */
router.get('/patterns', (req, res) => {
  const patterns = learningMemory.listPatterns();
  res.json({
    ok: true,
    count: patterns.length,
    patterns
  });
});

/**
 * POST /api/learning-memory/corrections
 * H9.1: 记录用户纠正
 * Body: { originalCommand, originalParams, userCorrection, correctedParams, context, pattern }
 */
router.post('/corrections', (req, res) => {
  const correction = req.body;
  if (!correction.originalCommand) {
    return res.status(400).json({ ok: false, error: 'Missing field: originalCommand' });
  }
  const entry = learningMemory.recordCorrection(correction);
  res.json({ ok: true, correction: entry });
});

/**
 * DELETE /api/learning-memory/corrections/:id
 * 删除单条纠正记录
 */
router.delete('/corrections/:id', (req, res) => {
  const { id } = req.params;
  const result = learningMemory.deleteCorrection(id);
  res.json({ ok: true, ...result });
});

/**
 * DELETE /api/learning-memory/clear
 * H9.6: 清除所有学习记忆（隐私保护）
 */
router.delete('/clear', (req, res) => {
  const result = learningMemory.clearAll();
  res.json({ ok: true, ...result });
});

/**
 * POST /api/learning-memory/check
 * H9.4: 校验计划是否触发历史错误
 * Body: { steps: [...] }
 */
router.post('/check', (req, res) => {
  const { steps } = req.body;
  if (!Array.isArray(steps)) {
    return res.status(400).json({ ok: false, error: 'Missing field: steps' });
  }
  const result = learningMemory.checkPlanAgainstHistory({ steps });
  res.json({ ok: true, ...result });
});

module.exports = router;
