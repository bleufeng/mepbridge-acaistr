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
const userAssets = require('./user-assets');                   // 用户模板（含 TPL-0NN 编号）
const auditLogger = require('../services/audit-log');         // V2 H6.2 审计日志
const knowledgeBase = require('../services/knowledge-base');  // V2 H8.6 知识库校验钩子
const learningMemory = require('../services/learning-memory'); // V2 H9.4 错误避免
const { normalizeUiLocale, isEnglishUiLocale } = require('../services/ui-locale');
const { freezeRequestTarget, executionTarget, publicTarget } = require('../services/request-target');
const { getArchicadEndpoint } = require('../services/archicad-endpoint');

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

    const frozenTarget = await freezeRequestTarget(req.body, { requireExplicit: false });
    const targetEnvelope = executionTarget(frozenTarget);
    const target = publicTarget(frozenTarget);

    // 如果已有活跃链，先取消
    if (activeChain && ['running', 'paused'].includes(activeChain.chain?.status)) {
      activeChain.cancel();
    }

    console.log(`[PlanChain API] Execute request: "${message.slice(0, 60)}", mode=${mode || 'copilot-auto'}`);


    // UI auto mode enters here first. Complete deterministic single edits in the
    // original request, not after model discovery + LLM + 1.5s status polling.
    const nativeEdit = require('../services/native-edit-fast-path');
    const nativePlan = nativeEdit.recognizeNativeEdit(message, req.body?.context || {});
    if (nativePlan) {
      if (!nativeEdit.automatic(req.body)) return res.json({
        ok:true,status:'unsupported',chainId:null,steps:[],target,
        message:english?'Native edit is available in the supervised plan path.':'原生编辑已转入人工审核计划。'
      });
      const snapshot=knowledgeBase.createSnapshot();
      knowledgeBase.verifySnapshot(snapshot);
      if(snapshot.automaticPlanValidation==='ON') {
        const validation=knowledgeBase.validatePlan(nativePlan,snapshot);
        if(!validation.passed) return res.json({ok:true,status:'validation_failed',chainId:null,steps:nativePlan.steps,validation,target});
      }
      const executionContext={...req.body,...targetEnvelope,autoMode:true,knowledgeSnapshot:snapshot};
      delete executionContext.message;delete executionContext.context;
      // Supply the operation ID silently before dispatch; transport failures can
      // still recover via the response header, without a negotiation roundtrip.
      if (!executionContext.execution) executionContext.execution={operationId:require('../services/execution-coordinator').operationId()};
      if (executionContext.execution?.operationId) res.setHeader('X-MEPBridge-Operation-Id',executionContext.execution.operationId);
      const outcome = await nativeEdit.executeNativeEditPlan(nativePlan,executionContext);
      // The durable client owns ID generation, binding, failure/rollback and replay.
      // Do not retry, compensate or relabel UNKNOWN here.
      activeChain = null;
      const completed=outcome.success===true;
      const intact = outcome.execution?.status==='FAILED_VERIFIED' && outcome.execution?.recoveryRequired===false;
      const nativeFailureMessage = !completed && intact
        ? (english?'The requested edit was not applied; native verification confirmed no model effect. Do not auto-retry.':
          '本次参数未生效，原生校验已确认未修改或完整回滚。不会自动重试；其它操作可继续。')
        : null;
      const single={...nativePlan.steps[0],id:'native_edit_1',status:completed?'completed':'failed',
        operationId:outcome.execution?.operationId||null,params:outcome.executedParams||nativePlan.steps[0].params,
        result:{ok:completed,guid:outcome.data?.elementGuid||null,data:outcome.data,execution:outcome.execution},
        error:outcome.detail?.message||outcome.error||null,diagnostic:outcome.detail||null};
      return res.json({ok:true,executedInline:true,chainId:null,status:completed?'completed':'failed',
        userIntent:message,summary:nativePlan.title,fastPath:outcome.fastPath||nativePlan.fastPath,
        execution:outcome.execution,result:outcome.data,detail:outcome.detail,errorType:outcome.errorType,
        stats:{completed:completed?1:0,failed:completed?0:1},steps:[single],target,
        message:completed?(english?'Native edit completed and read back.':'原生编辑已完成并回读。'):
          (nativeFailureMessage||outcome.detail?.actionableSuggestion||outcome.error||'Native edit failed; inspect the receipt.')});
    }

    // ── Phase 1: LLM 生成计划 ──
    const context = {
      language: locale,
      locale,
      userIntent: message,
      knowledgeSnapshot: knowledgeBase.createSnapshot(),
      target
    };
    // 注入模型快照上下文
    const ARCHICAD_ENDPOINT = frozenTarget?.endpoint || getArchicadEndpoint();
    const [modelSnapshot] = await Promise.all([
      aiAdapter.getModelSnapshot(ARCHICAD_ENDPOINT)
    ]);
    if (modelSnapshot) {
      context.modelSnapshot = modelSnapshot.summary;
    }

    // 编号直达（优先于关键词匹配）：① 用户模板 TPL-0NN ② 出厂模板 SYS-0NN（内置 TPL-001..020）
    const userTemplates = userAssets.templateCodes.loadVisibleTemplates(locale);
    const parsedCode = userAssets.templateCodes.parseTemplateCodeRequest(message);
    const codeRequest = parsedCode.kind === 'user'
      ? userAssets.templateCodes.resolveTemplateCodeRequest(message, userTemplates)
      : { plan: null, code: null, found: false };
    let plan = codeRequest.plan;
    if (!plan && parsedCode.kind === 'builtin' && parsedCode.builtinId) {
      plan = taskTemplates.generateById(parsedCode.builtinId, message, context);
    }
    if (!plan && (parsedCode.kind === 'builtin' || (parsedCode.kind === 'user' && !codeRequest.found))) {
      const available = userAssets.templateCodes.listTemplateCodes(userTemplates)
        .slice(0, 12)
        .map((item) => `${item.code} ${item.name}`)
        .join('；');
      return res.json({
        ok: true,
        status: 'unsupported',
        message: english
          ? `No template with code ${parsedCode.code}. Available: ${available || 'none'}`
          : `未找到模板编号 ${parsedCode.code}。可用编号：${available || '（暂无）'}`,
        chainId: null,
        steps: [],
        target
      });
    }

    // V2 H5.5: 任务模板库快速匹配（优先于 LLM，降低延迟）
    if (!plan) {
      plan = taskTemplates.tryGenerate(message, context);
    }

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
        steps: [],
        target
      });
    }

    // V2 H8.6: 知识库校验钩子 — 检查计划是否符合建筑/MEP规范
    // 默认关闭（环境变量 KB_VALIDATION=on 开启），避免误拦截合法操作
    plan.knowledgeContext = { activeLibraryId: context.knowledgeSnapshot.activeLibraryId, revision: context.knowledgeSnapshot.revision,
      aliasVersion: context.knowledgeSnapshot.aliasVersion, injection: plan.knowledgeContext?.injection || 'NOT_USED_TEMPLATE_OR_FALLBACK' };
    const kbValidationEnabled = context.knowledgeSnapshot.automaticPlanValidation === 'ON';
    if (kbValidationEnabled) {
      const validation = knowledgeBase.validatePlan(plan, context.knowledgeSnapshot);
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
          chainId: null,
          target
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
      useDurableExecution: true,
      mode: mode || 'copilot-auto',
      approvalPolicy,
      locale,
      llm: aiAdapter.llm,
      knowledgeSnapshot: context.knowledgeSnapshot,
      receiptTarget: targetEnvelope,
      target,
      aiAdapter: aiAdapter,               // H4.2: 视觉验证需要 aiAdapter.visualVerifyStep
      onProgress: (event) => {
        console.log(`[PlanChain] Progress: ${event.type}`, event.stepIndex !== undefined ? `step ${event.stepIndex + 1}` : '');
      },
      onGateRequired: autoConfirm === false ? async () => false : undefined
    });

    const executingChain = activeChain;
    const chain = executingChain.create(plan);

    // ── Phase 3: 立即返回响应，异步执行 ──
    const initialResponse = {
      ok: true,
      chainId: chain.id,
      status: chain.status,
      userIntent: chain.userIntent,
      knowledgeContext: chain.knowledgeContext,
      reasoning: chain.reasoning,
      summary: chain.summary,
      stats: chain.stats,
      target,
      steps: chain.steps.map(s => ({
        id: s.id,
        action: s.action,
        title: s.title,
        description: s.description,
        riskLevel: s.riskLevel,
        behavior: activeChain._resolveStepBehavior(s),
        status: s.status,
        operationId: s.durableOperationId || null,
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
        const result = await executingChain.execute();
        console.log(`[PlanChain API] Chain ${chain.id} finished: ${result.status}, stats=`, result.stats);
      } catch (execError) {
        console.error(`[PlanChain API] Chain ${chain.id} error:`, execError.message);
      }
    })();

    res.json(initialResponse);

  } catch (error) {
    console.error('[PlanChain API] Error:', error.message);
    res.status(error.statusCode || 500).json({ ok: false, error: error.message, errorType: error.code || error.message });
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

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing message' });
    }

    const frozenTarget = await freezeRequestTarget(req.body, { requireExplicit: false });
    const targetEnvelope = executionTarget(frozenTarget);
    const target = publicTarget(frozenTarget);

    const context = {
      language: locale,
      locale,
      userIntent: message,
      knowledgeSnapshot: knowledgeBase.createSnapshot(),
      target
    };
    // 编号直达（与 /execute 同规则）：① 用户模板 TPL-0NN ② 出厂模板 SYS-0NN
    const codeTemplates = userAssets.templateCodes.loadVisibleTemplates(locale);
    const parsedCode = userAssets.templateCodes.parseTemplateCodeRequest(message);
    const codePlan = parsedCode.kind === 'user'
      ? userAssets.templateCodes.resolveTemplateCodeRequest(message, codeTemplates)
      : { plan: null, code: null, found: false };
    let plan = codePlan.plan;
    if (!plan && parsedCode.kind === 'builtin' && parsedCode.builtinId) {
      plan = taskTemplates.generateById(parsedCode.builtinId, message, context);
    }
    if (!plan && (parsedCode.kind === 'builtin' || (parsedCode.kind === 'user' && !codePlan.found))) {
      const availableCodes = userAssets.templateCodes.listTemplateCodes(codeTemplates)
        .slice(0, 12)
        .map((item) => `${item.code} ${item.name}`)
        .join('；');
      return res.json({
        ok: true,
        status: 'unsupported',
        message: `未找到模板编号 ${parsedCode.code}。可用编号：${availableCodes || '（暂无）'}`,
        chain: null,
        target
      });
    }
    if (!plan) {
      plan = taskTemplates.tryGenerate(message, context);
    }
    if (!plan) {
      plan = await aiAdapter.generatePlan(message, context);
    }

    if (plan.unsupported || !plan.steps || plan.steps.length === 0) {
      return res.json({ ok: true, status: 'unsupported', message: plan.message, chain: null, target });
    }

    plan.knowledgeContext ||= { activeLibraryId: context.knowledgeSnapshot.activeLibraryId, revision: context.knowledgeSnapshot.revision, aliasVersion: context.knowledgeSnapshot.aliasVersion, injection: 'NOT_USED_TEMPLATE_OR_FALLBACK' };
    const chainInstance = new PlanChain({
      mode: mode || 'manual-strict',
      locale,
      knowledgeSnapshot: context.knowledgeSnapshot,
      receiptTarget: targetEnvelope,
      target
    });
    const chain = chainInstance.create(plan);

    res.json({
      ok: true,
      chainId: chain.id,
      status: 'preview',
      summary: chain.summary,
      userIntent: chain.userIntent,
      knowledgeContext: chain.knowledgeContext,
      reasoning: chain.reasoning,
      stats: chain.stats,
      target,
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
    res.status(error.statusCode || 500).json({ ok: false, error: error.message, errorType: error.code || error.message });
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
    target: chain.target || null,
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

// Current capture is read-only. Story changes require preview + confirmation + durable ID.
function viewportService() { return router._viewportCapture || require('../services/viewport-capture').getViewportCaptureService(); }
function captureHandler(method) {
  return async (req, res) => {
    try {
      const result = await viewportService()[method](method === 'current' ? req.query : req.body);
      return res.status(result.ok ? 200 : result.httpStatus || 409).json(result);
    } catch (error) {
      return res.status(error.httpStatus || 409).json({ok:false,error:error.message,errorType:error.errorType || error.message});
    }
  };
}
router.get('/capture', captureHandler('current'));
router.post('/capture/preview', captureHandler('preview'));
router.post('/capture', captureHandler('capture'));

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
