const express = require('express');
const router = express.Router();

// 此端点不提供撤销能力，只如实说明为什么不能提供。
//
// 2026-08-31 审计发现原实现向 Archicad JSON API 发 `command: 'API.Undo'`。
// 该命令不存在于官方 JSON API：DevKit 29 的 ACAPinc.h 里与 undo 相关的只有
// `ACAPI_CallUndoableCommand`（把 Add-On 自己的写入登记为一个可撤销步骤），
// 没有任何触发撤销的公开 API。因此原实现永远走 `succeeded=false` 或抛错，
// 却按 `success: result.success` 返回 200 —— 调用方会把它当成「撤销失败」
// 而不是「撤销从未被支持」，进而可能误以为存在一条可依赖的回滚路径。
//
// 这一点对批量写入的安全评估很关键：`DeleteElements` 等不可逆操作的上限
// （200，见 Sources/DeleteElementsCommand.cpp MaxDeleteGuids）必须建立在
// 「服务端没有程序化撤销」这个前提上。撤销只能由用户在 Archicad 界面里
// 按 Ctrl+Z 完成，逐个撤销 Add-On 登记的 undoable 步骤。
//
// 保留该路由而非直接删除，是为了让已有调用方拿到明确的 501 与原因，
// 而不是 404 这种「路径是否写错」的歧义信号。
router.post('/', (req, res) => {
  res.status(501).json({
    success: false,
    error: {
      code: 'UNDO_NOT_SUPPORTED',
      message: 'Programmatic undo is not available: the Archicad JSON API exposes no undo command. Press Ctrl+Z in Archicad to undo the last MEPBridge step.'
    },
    guidance: {
      manualUndo: 'Each MEPBridge write is registered as one undoable step via ACAPI_CallUndoableCommand, so Ctrl+Z in Archicad reverses it.',
      preferPreview: 'Use dryRun=true to preview a write before executing it; irreversible commands additionally require confirmRequired=true.',
      batchScope: 'Batch writes run inside a single undoable command, so one Ctrl+Z reverses the whole batch rather than one element at a time.'
    }
  });
});

module.exports = router;
