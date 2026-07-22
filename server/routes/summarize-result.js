const express = require('express');
const router = express.Router();
const aiAdapter = require('../services/ai-adapter');

// AI 总结执行结果
router.post('/', async (req, res) => {
  try {
    const { userIntent, steps } = req.body;

    if (!steps || !Array.isArray(steps)) {
      return res.status(400).json({ error: 'Missing required field: steps' });
    }

    console.log(`[Summarize] Summarizing ${steps.length} steps`);

    // 调用 AI 生成总结
    const summary = await aiAdapter.summarizeResult(userIntent, steps);

    res.json(summary);
  } catch (error) {
    console.error('[Summarize] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
