const express = require('express');
const router = express.Router();
const archicadClient = require('../services/archicad-client');

// 执行单步操作
router.post('/', async (req, res) => {
  try {
    const { action, params, index } = req.body;

    if (!action) {
      return res.status(400).json({ error: 'Missing required field: action' });
    }

    console.log(`[Execute Step] Action: ${action}`);

    // 执行命令
    const result = await archicadClient.executeCommand(action, params);

    // 如果是 Mutation 操作，自动读回验证 (Gate 4)
    let readback = null;
    if (isMutationAction(action) && result.success) {
      readback = await performReadback(action, result, params);
    }

    console.log(`[Execute Step] ${action} - ${result.success ? 'Success' : 'Failed'}`);

    res.json({
      success: result.success,
      data: result.data,
      dynamicResolution: result.dynamicResolution,
      readback,
      error: result.error
    });
  } catch (error) {
    console.error('[Execute Step] Error:', error.message);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// 判断是否为 Mutation 操作
function isMutationAction(action) {
  const mutationActions = [
    'CreatePipe', 'CreatePipeSystem', 'CreateWall',
    'MoveElements', 'MoveSelectedElements',
    'EditSelectedElements', 'SetElementProperty',
    'DeleteMEPElements'
  ];
  return mutationActions.includes(action);
}

// 执行读回验证
async function performReadback(action, result, params) {
  try {
    // 根据操作类型决定读回方式
    if (result.data?.guid) {
      // 有 GUID，读取元素信息
      const info = await archicadClient.executeCommand('GetMEPElementInfo', {
        guid: result.data.guid
      });
      return info.data;
    } else if (action === 'MoveSelectedElements') {
      // 移动操作，读回坐标验证
      const selected = await archicadClient.executeCommand('GetSelectedElements', {});
      return selected.data;
    }
    return null;
  } catch (error) {
    console.error('[Readback] Error:', error.message);
    return { error: error.message };
  }
}

module.exports = router;
