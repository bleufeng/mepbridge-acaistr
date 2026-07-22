// plan-chain.js
// V2 H2.6: /api/plan-chain 路由 — 自治编排引擎 API
//
// 端点：
//   POST /api/plan-chain/execute  — 创建并执行计划链（NL 目标 → 全自治执行）
//   POST /api/plan-chain/create   — 仅创建链（不执行，返回预览）
//   GET  /api/plan-chain/status   — 获取当前链状态
//   POST /api/plan-chain/pause    — 暂停执行
//   POST /api/plan-chain/resume   — 恢复执行
//   POST /api/plan-chain/cancel   — 取消执行
//   GET  /api/chain-presets       — 获取三预设审批策略列表

const express = require('express');
const axios = require('axios');
const router = express.Router();
const { PlanChain, APPROVAL_PRESETS } = require('../services/plan-chain-engine');
const aiAdapter = require('../services/ai-adapter');
const taskTemplates = require('../services/task-templates');   // V2 H5.5 任务模板库
const auditLogger = require('../services/audit-log');         // V2 H6.2 审计日志
const knowledgeBase = require('../services/knowledge-base');  // V2 H8.6 知识库校验钩子
const learningMemory = require('../services/learning-memory'); // V2 H9.4 错误避免
const { normalizeUiLocale, isEnglishUiLocale } = require('../services/ui-locale');

// 活跃的 PlanChain 实例（单例模式：同一时间只运行一条链）
let activeChain = null;

/**
 * GET /api/chain-presets
 * 返回三种审批预设策略（供 UI 展示选择）
 */
router.get('/presets', (req, res) => {
  const presets = Object.entries(APPROVAL_PRESETS).map(([key, val]) => ({
    mode: key,
    label: val.label,
    description: val.description,
    gate2PlanPreview: val.gate2PlanPreview,
    gate3Confirm: val.gate3Confirm,
    riskSummary: {
      autoRun: val.riskThresholds.autoRun.length,
      confirm: val.riskThresholds.confirm.length,
      forbidden: val.riskThresholds.forbidden.length
    }
  }));

  res.json({
    ok: true,
    presets,
    currentDefault: 'copilot-auto'
  });
});

/**
 * POST /api/plan-chain/execute
 * 核心端点：接收 NL 文本 → LLM 生成计划 → 创建链 → 全自治执行 → SSE 进度推送
 *
 * Body:
 *   message: string          — 用户 NL 需求（如 "建一个3×4房间" 或 "给卫生间布管"）
 *   mode?: string            — 审批预设（copilot-auto/copilot-supervised/manual-strict），默认 copilot-auto
 *   approvalPolicy?: Object  — 完全自定义策略（覆盖预设）
 *   autoConfirm?: boolean    — UI 传入是否自动确认闸门（true=全自动，false=需用户点击确认）
 *
 * Response:
 *   chainId, status, steps[], executionLog[]
 */
router.post('/execute', async (req, res) => {
  try {
    const { message, mode, approvalPolicy, autoConfirm } = req.body;
    const locale = normalizeUiLocale(req.body?.locale);
    const english = isEnglishUiLocale(locale);

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing required field: message' });
    }

    // 如果已有活跃链，先取消
    if (activeChain && ['running', 'paused'].includes(activeChain.chain?.status)) {
      activeChain.cancel();
    }

    console.log(`[PlanChain API] Execute request: "${message.slice(0, 60)}", mode=${mode || 'copilot-auto'}`);

    // ── Phase 1: LLM 生成计划 ──
    const context = {
      language: locale,
      locale,
    };
    // 注入模型快照上下文
    const { getArchicadEndpoint } = require('../services/archicad-endpoint');
    const ARCHICAD_ENDPOINT = getArchicadEndpoint();
    const [modelSnapshot] = await Promise.all([
      aiAdapter.getModelSnapshot(ARCHICAD_ENDPOINT)
    ]);
    if (modelSnapshot) {
      context.modelSnapshot = modelSnapshot.summary;
    }

    // V2 H5.5: 任务模板库快速匹配（优先于 LLM，降低延迟）
    let plan = taskTemplates.tryGenerate(message, context);

    if (!plan) {
      // 模板未命中 → 走 LLM 生成
      plan = await aiAdapter.generatePlan(message, context);
    }

    if (plan.unsupported || !plan.steps || plan.steps.length === 0) {
      return res.json({
        ok: true,
        status: 'unsupported',
        message: plan.message || (english ? 'The request was not recognized.' : '无法识别意图'),
        chainId: null,
        steps: []
      });
    }

    // V2 H8.6: 知识库校验钩子 — 检查计划是否符合建筑/MEP规范
    // 默认关闭（环境变量 KB_VALIDATION=on 开启），避免误拦截合法操作
    const kbValidationEnabled = process.env.KB_VALIDATION === 'on';
    if (kbValidationEnabled) {
      const validation = knowledgeBase.validatePlan(plan);
      if (!validation.passed) {
        // 有 error 级别违规 → 返回校验失败，不执行
        console.log(`[PlanChain][H8.6] Plan validation failed: ${validation.errorCount} errors, ${validation.warningCount} warnings`);
        return res.json({
          ok: true,
          status: 'validation_failed',
          message: english
            ? 'The plan violates configured building-code rules and was blocked.'
            : '计划违反建筑规范，已拦截',
          validation,
          plan,
          chainId: null
        });
      }
      // 有 warning 级别 → 注入 warningText 但继续执行
      if (validation.warningCount > 0) {
        plan.warningText = (plan.warningText || '') + ` [规范警告: ${validation.summary}]`;
        plan.validationWarnings = validation.warnings;
      }
    } else {
      console.log('[PlanChain][H8.6] Knowledge base validation skipped (KB_VALIDATION!=on)');
    }

    // V2 H9.4: 错误避免 — 检查计划是否触发历史纠正记录
    const historyCheck = learningMemory.checkPlanAgainstHistory(plan);
    if (historyCheck.hasRisk) {
      console.log(`[PlanChain][H9.4] History risk detected: ${historyCheck.warnings.length} warnings`);
      plan.historyWarnings = historyCheck.warnings;
      // 注入 warningText
      const warnSummary = historyCheck.warnings.map(w => w.message).join('; ');
      plan.warningText = (plan.warningText || '') + ` [历史纠正提醒: ${warnSummary}]`;
    }

    // ── Phase 2: 创建编排链 ──
    activeChain = new PlanChain({
      mode: mode || 'copilot-auto',
      approvalPolicy,
      locale,
      llm: aiAdapter.llm,
      aiAdapter: aiAdapter,               // H4.2: 视觉验证需要 aiAdapter.visualVerifyStep
      onProgress: (event) => {
        console.log(`[PlanChain] Progress: ${event.type}`, event.stepIndex !== undefined ? `step ${event.stepIndex + 1}` : '');
      },
      onGateRequired: autoConfirm === false ? async () => false : undefined
    });

    const chain = activeChain.create(plan);

    // ── Phase 3: 立即返回响应，异步执行 ──
    const initialResponse = {
      ok: true,
      chainId: chain.id,
      status: chain.status,
      userIntent: chain.userIntent,
      reasoning: chain.reasoning,
      summary: chain.summary,
      stats: chain.stats,
      steps: chain.steps.map(s => ({
        id: s.id,
        action: s.action,
        title: s.title,
        description: s.description,
        riskLevel: s.riskLevel,
        behavior: activeChain._resolveStepBehavior(s),
        status: s.status,
        params: s.params
      })),
      approvalPolicy: chain.approvalPolicy.mode,
      message: english
        ? `Created a ${chain.steps.length}-step autonomous execution chain${autoConfirm === false ? ' (awaiting confirmation)' : ''}. Starting execution...`
        : `已创建 ${chain.steps.length} 步自治执行链${autoConfirm === false ? '（等待确认）' : ''}，开始执行...`
    };

    // 异步执行
    (async () => {
      try {
        const result = await activeChain.execute();
        console.log(`[PlanChain API] Chain ${chain.id} finished: ${result.status}, stats=`, result.stats);
      } catch (execError) {
        console.error(`[PlanChain API] Chain ${chain.id} error:`, execError.message);
      }
    })();

    res.json(initialResponse);

  } catch (error) {
    console.error('[PlanChain API] Error:', error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/plan-chain/create
 * 仅创建链预览（dry-run 模式），不实际执行任何命令
 */
router.post('/create', async (req, res) => {
  try {
    const { message, mode } = req.body;
    const locale = normalizeUiLocale(req.body?.locale);

    if (!message) {
      return res.status(400).json({ ok: false, error: 'Missing message' });
    }

    const context = {
      language: locale,
      locale,
    };
    let plan = taskTemplates.tryGenerate(message, context);
    if (!plan) {
      plan = await aiAdapter.generatePlan(message, context);
    }

    if (plan.unsupported || !plan.steps || plan.steps.length === 0) {
      return res.json({ ok: true, status: 'unsupported', message: plan.message, chain: null });
    }

    const chainInstance = new PlanChain({ mode: mode || 'manual-strict', locale });
    const chain = chainInstance.create(plan);

    res.json({
      ok: true,
      chainId: chain.id,
      status: 'preview',
      summary: chain.summary,
      userIntent: chain.userIntent,
      reasoning: chain.reasoning,
      stats: chain.stats,
      approvalPolicy: chain.approvalPolicy.mode,
      steps: chain.steps.map(s => ({
        id: s.id,
        action: s.action,
        title: s.title,
        description: s.description,
        riskLevel: s.riskLevel,
        behavior: chainInstance._resolveStepBehavior(s),
        estimatedGate2: chainInstance._needsGate2(s),
        estimatedGate3: chainInstance._needsGate3(s),
        params: s.params
      }))
    });

  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/plan-chain/status
 * 查询当前活跃链的状态（UI 轮询进度用）
 */
router.get('/status', (req, res) => {
  if (!activeChain || !activeChain.chain) {
    return res.json({ ok: true, hasActiveChain: false, status: 'idle' });
  }

  const status = activeChain.getStatus();
  const chain = activeChain.chain;

  res.json({
    ok: true,
    hasActiveChain: true,
    ...status,
    userIntent: chain.userIntent,
    reasoning: chain.reasoning,
    steps: chain.steps.map((s, i) => ({
      id: s.id,
      action: s.action,
      title: s.title,
      status: s.status,
      riskLevel: s.riskLevel,
      result: s.result ? { ok: s.result.ok } : null,
      error: s.error || null,
      // H4 视觉验证字段（让 UI 显示 👁/⚠ 图标）
      visualVerified: s.visualVerified || false,
      visualIssues: s.visualIssues || [],
      visualSuggestions: s.visualSuggestions || [],
      startedAt: s.startedAt,
      completedAt: s.completedAt
    })),
    recentLog: chain.executionLog.slice(-10),
    failureCount: activeChain.failureCount
  });
});

/**
 * POST /api/plan-chain/pause
 */
router.post('/pause', (req, res) => {
  if (!activeChain) return res.json({ ok: false, error: 'No active chain' });
  activeChain.pause();
  res.json({ ok: true, status: activeChain.getStatus() });
});

/**
 * POST /api/plan-chain/resume
 */
router.post('/resume', (req, res) => {
  if (!activeChain) return res.json({ ok: false, error: 'No active chain' });
  activeChain.resume();
  res.json({ ok: true, status: activeChain.getStatus() });
});

/**
 * POST /api/plan-chain/cancel
 */
router.post('/cancel', (req, res) => {
  if (!activeChain) return res.json({ ok: false, error: 'No active chain' });
  activeChain.cancel();
  const finalStatus = activeChain.getStatus();
  activeChain = null;
  res.json({ ok: true, status: finalStatus });
});

// ── V2 H5.5: 任务模板库端点 ──

/**
 * GET /api/plan-chain/templates
 * 返回所有可用任务模板（内置 + 用户自定义）
 */
router.get('/templates', (req, res) => {
  const locale = normalizeUiLocale(req.query.locale);
  const templates = taskTemplates.list(locale);
  res.json({
    ok: true,
    templates,
    total: templates.length
  });
});

// ── V2 H6.2 + H6.3: 审计日志端点 ──

/**
 * GET /api/plan-chain/audit/recent
 * 查询最近执行的链审计日志列表
 * Query: ?limit=20
 */
router.get('/audit/recent', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const recent = auditLogger.listRecentChains(limit);
  res.json({ ok: true, chains: recent, count: recent.length });
});

/**
 * GET /api/plan-chain/audit/:chainId
 * 查询指定 chainId 的完整审计日志
 */
router.get('/audit/:chainId', (req, res) => {
  const { chainId } = req.params;
  const log = auditLogger.getChainLog(chainId);
  if (!log) {
    return res.status(404).json({ ok: false, error: 'Audit log not found' });
  }
  res.json({ ok: true, ...log });
});

/**
 * GET /api/plan-chain/capture
 * 主动触发 ViewportCapture 截图，返回 base64 PNG（供 UI 显示当前视口）
 * 查询参数:
 *   - includeImage=true|false (默认 true)
 *   - maxElements=100
 *   - storyIndex=integer (可选) — 切换到指定楼层后再截图（需 SwitchStory 命令支持）
 */
router.get('/capture', async (req, res) => {
  try {
    const includeImage = req.query.includeImage !== 'false';
    const maxElements = parseInt(req.query.maxElements) || 100;
    const targetStoryIndex = req.query.storyIndex ? parseInt(req.query.storyIndex) : null;
    const { getArchicadEndpoint: _getEp } = require('../services/archicad-endpoint');
    const ARCHICAD_ENDPOINT = _getEp();

    // 如果指定了楼层，先调用 SwitchStory 切换楼层
    if (targetStoryIndex !== null && !isNaN(targetStoryIndex)) {
      try {
        await axios.post(ARCHICAD_ENDPOINT, {
          command: 'API.ExecuteAddOnCommand',
          parameters: {
            addOnCommandId: { commandNamespace: 'MEPBridge', commandName: 'SwitchStory' },
            addOnCommandParameters: { storyIndex: targetStoryIndex }
          }
        }, { timeout: 5000 });
      } catch (switchErr) {
        // 楼层切换失败不阻断截图，返回当前楼层截图 + warning
        console.warn('[PlanChain][capture] SwitchStory failed:', switchErr.message);
      }
    }

    // 等一小段时间让 Archicad 完成视图刷新
    if (targetStoryIndex !== null) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    const captureRes = await axios.post(ARCHICAD_ENDPOINT, {
      command: 'API.ExecuteAddOnCommand',
      parameters: {
        addOnCommandId: { commandNamespace: 'MEPBridge', commandName: 'ViewportCapture' },
        addOnCommandParameters: { maxElements, includeAabb: true, includeImage }
      }
    }, { timeout: 20000 });

    const snapshot = captureRes.data?.result?.addOnCommandResponse;
    if (!snapshot || snapshot.status !== 'ok') {
      return res.json({ ok: false, error: 'ViewportCapture failed' });
    }

    res.json({
      ok: true,
      viewType: snapshot.viewType,
      storyName: snapshot.storyName,
      storyIndex: snapshot.storyIndex,
      storyLevel: snapshot.storyLevel,
      elementCount: snapshot.elementCount,
      bounds: snapshot.bounds,
      summary: snapshot.summary,
      imageBase64: snapshot.imageBase64 || null,
      imageFormat: snapshot.imageFormat || null,
      imageSize: snapshot.imageSize || 0,
      switchedStory: targetStoryIndex !== null ? targetStoryIndex : undefined
    });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/plan-chain/audit/:chainId/diff
 * 生成指定链的 Before/After 差异报告（H6.3）
 */
router.get('/audit/:chainId/diff', (req, res) => {
  const { chainId } = req.params;
  const diffReport = auditLogger.generateDiffReport(chainId);
  if (!diffReport) {
    return res.status(404).json({ ok: false, error: 'Audit log not found' });
  }
  res.json({ ok: true, ...diffReport });
});

module.exports = router;
