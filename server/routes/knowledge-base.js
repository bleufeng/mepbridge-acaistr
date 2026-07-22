// knowledge-base.js (routes)
// V2 H8.5: 知识库管理模块 API（可查看可管理可更新）
//
// 端点：
//   GET    /api/knowledge-base                       — 获取全部知识库（含统计）
//   GET    /api/knowledge-base/:category             — 按分类获取 (buildingCode/mepStandard/material)
//   GET    /api/knowledge-base/search?q=xxx          — 关键词搜索
//   POST   /api/knowledge-base/validate              — 校验计划是否符合规范（H8.6）
//
//   POST   /api/knowledge-base/:category             — 新增条目
//   PUT    /api/knowledge-base/:category/:id         — 更新条目
//   DELETE /api/knowledge-base/:category/:id         — 删除/禁用条目
//   POST   /api/knowledge-base/:category/:id/enable  — 恢复禁用的内置条目
//
//   GET    /api/knowledge-base/export                — 导出全部为 JSON
//   POST   /api/knowledge-base/import                — 导入知识库（合并模式）
//   POST   /api/knowledge-base/reset                 — 重置为内置知识库

const express = require('express');
const router = express.Router();
const knowledgeBase = require('../services/knowledge-base');

const VALID_CATEGORIES = ['buildingCode', 'mepStandard', 'material'];

/**
 * GET /api/knowledge-base
 * 返回全部知识库内容（含统计 + 用户自定义计数）
 */
router.get('/', (req, res) => {
  const all = knowledgeBase.getAll();
  res.json({ ok: true, ...all });
});

/**
 * GET /api/knowledge-base/export
 * 导出全部知识库为 JSON（含内置+用户，可用于备份/迁移）
 */
router.get('/export', (req, res) => {
  const data = knowledgeBase.exportAll();
  res.json({ ok: true, ...data });
});

/**
 * GET /api/knowledge-base/search?q=管径&category=mepStandard
 * 关键词搜索知识库
 */
router.get('/search', (req, res) => {
  const { q, category } = req.query;
  if (!q) {
    return res.status(400).json({ ok: false, error: 'Missing query parameter: q' });
  }
  const results = knowledgeBase.search(q, category);
  res.json({ ok: true, query: q, category: category || 'all', results });
});

/**
 * POST /api/knowledge-base/import
 * 导入知识库（合并模式，可选 overwrite 覆盖同 id）
 * Body: { buildingCode?, mepStandard?, material?, overwrite? }
 */
router.post('/import', (req, res) => {
  const { buildingCode, mepStandard, material, overwrite } = req.body;
  if (!buildingCode && !mepStandard && !material) {
    return res.status(400).json({ ok: false, error: 'No data to import. Provide buildingCode/mepStandard/material arrays.' });
  }
  const result = knowledgeBase.importRules({ buildingCode, mepStandard, material }, overwrite === true);
  res.json({ ok: true, ...result });
});

/**
 * POST /api/knowledge-base/reset
 * 重置为内置知识库（清除所有用户修改）
 */
router.post('/reset', (req, res) => {
  const result = knowledgeBase.resetToBuiltin();
  res.json({ ok: true, message: '已重置为内置知识库', ...result });
});

/**
 * POST /api/knowledge-base/validate
 * H8.6: 校验 LLM 生成的计划是否符合规范
 * Body: { steps: [...], userIntent: string }
 */
router.post('/validate', (req, res) => {
  const { steps, userIntent } = req.body;
  if (!Array.isArray(steps)) {
    return res.status(400).json({ ok: false, error: 'Missing or invalid field: steps' });
  }
  const result = knowledgeBase.validatePlan({ steps, userIntent });
  res.json({ ok: true, ...result });
});

/**
 * GET /api/knowledge-base/:category
 * 按分类获取知识条目
 */
router.get('/:category', (req, res) => {
  const { category } = req.params;
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ ok: false, error: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` });
  }
  const items = knowledgeBase.listByCategory(category);
  res.json({ ok: true, category, count: items.length, items });
});

/**
 * POST /api/knowledge-base/:category
 * 新增知识条目
 * Body: { rule: string, source: string, severity: string, ... }
 */
router.post('/:category', (req, res) => {
  const { category } = req.params;
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ ok: false, error: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` });
  }
  const result = knowledgeBase.addRule(category, req.body);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

/**
 * PUT /api/knowledge-base/:category/:id
 * 更新知识条目
 * Body: 要更新的字段
 */
router.put('/:category/:id', (req, res) => {
  const { category, id } = req.params;
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ ok: false, error: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` });
  }
  const result = knowledgeBase.updateRule(category, id, req.body);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

/**
 * DELETE /api/knowledge-base/:category/:id
 * 删除/禁用知识条目（用户自定义物理删除，内置条目标记禁用）
 */
router.delete('/:category/:id', (req, res) => {
  const { category, id } = req.params;
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ ok: false, error: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` });
  }
  const result = knowledgeBase.deleteRule(category, id);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

/**
 * POST /api/knowledge-base/:category/:id/enable
 * 恢复被禁用的内置条目
 */
router.post('/:category/:id/enable', (req, res) => {
  const { category, id } = req.params;
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ ok: false, error: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` });
  }
  const result = knowledgeBase.enableRule(category, id);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

module.exports = router;
