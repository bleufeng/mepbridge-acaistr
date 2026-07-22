const express = require('express');
const router = express.Router();
const aiAdapter = require('../services/ai-adapter');

// AI 生成操作计划
router.post('/', async (req, res) => {
  try {
    const { text, context } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Missing required field: text' });
    }

    console.log(`[Generate Plan] Input: ${text}`);

    // 调用 AI 适配器解析意图
    const plan = await aiAdapter.generatePlan(text, context);

    // 检查是否为未支持功能
    if (plan.unsupported) {
      console.log(`[Generate Plan] Unsupported feature: ${text}`);
      return res.json({
        unsupported: true,
        message: plan.message || '抱歉，该功能暂未支持。已记录您的需求反馈给开发团队。',
        suggestedFeature: plan.suggestedFeature,
        steps: []
      });
    }

    // Gate 1: JSON Schema 校验
    const validation = validatePlan(plan);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Schema validation failed', details: validation.errors });
    }

    console.log(`[Generate Plan] Generated ${plan.steps.length} steps`);

    res.json(plan);
  } catch (error) {
    console.error('[Generate Plan] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 校验操作计划
function validatePlan(plan) {
  const errors = [];

  if (!plan.steps || !Array.isArray(plan.steps)) {
    errors.push('Missing or invalid steps array');
  }

  if (plan.steps && plan.steps.length === 0) {
    errors.push('Steps array is empty');
  }

  plan.steps?.forEach((step, i) => {
    if (!step.action) errors.push(`Step ${i+1}: missing action`);
    if (!step.description) errors.push(`Step ${i+1}: missing description`);
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = router;
