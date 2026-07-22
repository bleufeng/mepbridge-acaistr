const express = require('express');
const router = express.Router();
const archicadClient = require('../services/archicad-client');

// 撤销操作
router.post('/', async (req, res) => {
  try {
    console.log('[Undo] Executing undo...');

    // 调用 Archicad Undo API
    const result = await archicadClient.undo();

    res.json({
      success: result.success,
      message: result.success ? 'Undo completed' : 'Undo failed',
      error: result.error
    });
  } catch (error) {
    console.error('[Undo] Error:', error.message);
    res.json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
