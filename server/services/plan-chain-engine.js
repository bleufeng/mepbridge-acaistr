// plan-chain-engine.js
// V2 H2 自治编排引擎 — 多步计划链式执行核心
//
// 职责：
//   H2.1  approvalPolicy 配置体系（三预设模式：copilot-auto / copilot-supervised / manual-strict）
//   H2.2  plan-chain-engine 执行编排器（逐步执行 + 闸门检查 + 结果回灌 + SSE 进度）
//   H2.5  回滚链 + 失败阈值暂停
//
// 数据流：
//   LLM generatePlan / decomposeGoal → PlanChain.create(draft)
//     → for each step:
//       preState capture → gate check → execute → postCheck → refineWithResult → progress
//       → on failure: LLM 分析重试 / 回滚 / 暂停

const axios = require('axios');
const { getArchicadEndpoint } = require('./archicad-endpoint');
const { normalizeUiLocale, isEnglishUiLocale } = require('./ui-locale');
// ARCHICAD_ENDPOINT 改为动态解析（AC29 实测会用 19724，硬编码 19723 会导致 ARCHICAD_OFFLINE）
// 优先级：global.archicadPort（status.js 探测） > ARCHICAD_ENDPOINT 环境变量 > 默认 19723
function ARCHICAD_ENDPOINT() {
  return getArchicadEndpoint();
}
// V2 修复：PlanChain 优先通过 server /api/execute（端口 19780）执行，而非直接调 Archicad
// 原因：server 的 execute 路由会做参数规范化（删除 dryRun/confirmRequired 等非标准字段、单位转换等）
// 直接调 Archicad 会因 schema 不匹配而失败
const SERVER_ENDPOINT = process.env.SERVER_ENDPOINT || 'http://127.0.0.1:19780';
const EXECUTE_ENDPOINT = `${SERVER_ENDPOINT}/api/execute`;

// V2 H6.2: 审计日志服务
const auditLogger = require('./audit-log');

// ─── H2.1: 三种预设审批策略 ───

const APPROVAL_PRESETS = {
  'copilot-auto': {
    mode: 'copilot-auto',
    label: 'Copilot 自动模式',
    description: '日常 AI 自治建模，仅高风险需确认',
    gate1SchemaCheck: true,
    gate2PlanPreview: 'high-risk',   // 仅高风险预览
    gate3Confirm: 'high-risk',        // 仅高风险确认
    riskThresholds: {
      autoRun: ['read', 'low-mutation', 'create-element'],
      confirm: ['medium-mutation', 'batch-create'],
      forbidden: ['delete-all', 'irreversible']
    },
    failureThreshold: 3,
    rollbackOnFailure: true,
    maxRetries: 2,
    visualFeedback: 'on-failure'      // H4.3: 失败时触发视觉反馈
  },
  'copilot-supervised': {
    mode: 'copilot-supervised',
    label: 'Copilot 监督模式',
    description: '学习/调试阶段，总预览 + mutation 确认',
    gate1SchemaCheck: true,
    gate2PlanPreview: 'always',
    gate3Confirm: 'mutation',          // 所有 mutation 确认
    riskThresholds: {
      autoRun: ['read', 'create-element'],
      confirm: ['low-mutation', 'high-mutation', 'medium-mutation', 'batch-create'],
      forbidden: ['delete-all', 'irreversible']
    },
    failureThreshold: 3,
    rollbackOnFailure: true,
    maxRetries: 1,
    visualFeedback: 'always'           // H4.3: 监督模式每次 mutation 都视觉验证
  },
  'manual-strict': {
    mode: 'manual-strict',
    label: '手动严格模式',
    description: '手动精确操控，三闸门全开',
    gate1SchemaCheck: true,
    gate2PlanPreview: 'always',
    gate3Confirm: 'always',             // 每步都确认
    riskThresholds: {
      autoRun: ['read'],                // 只有读操作自动执行
      confirm: ['low-mutation', 'high-mutation', 'mutation', 'create-element', 'medium-mutation', 'batch-create'],
      forbidden: ['delete-all', 'irreversible']
    },
    failureThreshold: 2,
    rollbackOnFailure: true,
    maxRetries: 0,                       // 不自动重试
    visualFeedback: 'off'               // H4.3: 手动模式关闭视觉反馈
  }
};

// 风险等级排序（从低到高），用于闸门判断
const RISK_LEVEL_ORDER = [
  'read',                    // 只读查询
  'create-element',          // 创建元素（新 V2 分级）
  'low-mutation',            // 低风险修改
  'medium-mutation',         // 中等风险修改（旋转/镜像）
  'high-mutation',           // 高风险修改
  'batch-create',            // 批量创建
  'delete-all',              // 删除全部
  'irreversible'             // 不可逆操作
];

// ─── PlanChain 核心 ───

class PlanChain {
  /**
   * @param {Object} opts
   * @param {string} [opts.mode] - 预设模式名，默认 copilot-auto
   * @param {Object} [opts.approvalPolicy] - 完整自定义策略（覆盖预设）
   * @param {Function} [opts.onProgress] - 进度回调 fn(event): event={type:'step_start'|'step_complete'|'step_failed'|'gate_wait'|'rollback'|'complete'|'paused', stepIndex, totalSteps, step, data}
   * @param {Function} [opts.onGateRequired] - 需要用户确认时回调 fn(gateInfo): Promise<boolean>
   * @param {Object} [opts.llm] - LLMAdapter 实例（用于结果回灌 refineStepWithResult）
   * @param {Object} [opts.aiAdapter] - AIAdapter 实例（用于 H4.2 visualVerifyStep）
   */
  constructor(opts = {}) {
    const presetName = opts.mode || 'copilot-auto';
    const preset = APPROVAL_PRESETS[presetName] || APPROVAL_PRESETS['copilot-auto'];

    // 合并策略：用户自定义覆盖预设
    this.approvalPolicy = { ...preset, ...(opts.approvalPolicy || {}) };
    this.onProgress = opts.onProgress || (() => {});
    this.onGateRequired = opts.onGateRequired || null;
    this.llm = opts.llm || null;
    this.aiAdapter = opts.aiAdapter || null;
    this.locale = normalizeUiLocale(opts.locale);

    // 运行时状态
    this.chain = null;           // 当前执行的 planChain 对象
    this.currentStepIndex = -1;
    this.failureCount = 0;
    this.executionLog = [];       // 执行日志
    this.paused = false;
    this.cancelled = false;

    console.log(`[PlanChain] Initialized with mode=${this.approvalPolicy.mode}, gate2=${this.approvalPolicy.gate2PlanPreview}, gate3=${this.approvalPolicy.gate3Confirm}`);
  }

  // ── 创建计划链 ──

  /**
   * 从 LLM 生成的 plan 或 decomposeGoal 结果创建可执行链
   * @param {Object} draft - { steps[], userIntent?, reasoning? } 来自 generatePlan/decomposeGoal
   * @returns {Object} planChain 可执行对象
   */
  create(draft) {
    const steps = Array.isArray(draft.steps) ? draft.steps : [];
    if (steps.length === 0) {
      return {
        id: this._generateId(),
        status: 'empty',
        draft,
        steps: [],
        executionLog: [],
        summary: '无步骤可执行'
      };
    }

    // 规范化每步：确保有完整元数据
    const normalizedSteps = steps.map((step, idx) => this._normalizeStep(step, idx));

    // 推断整体风险等级
    const overallRisk = this._inferOverallRisk(normalizedSteps);

    const chain = {
      id: this._generateId(),
      status: 'ready',
      createdAt: new Date().toISOString(),
      userIntent: draft.userIntent || '',
      reasoning: draft.reasoning || '',
      confidence: draft.confidence || 0,
      isMutation: draft.isMutation || false,
      warningText: draft.warningText || null,
      steps: normalizedSteps,
      executionLog: [],
      approvalPolicy: { ...this.approvalPolicy },
      summary: isEnglishUiLocale(this.locale)
        ? `${normalizedSteps.length}-step plan${overallRisk ? ` (highest risk: ${overallRisk})` : ''}`
        : `${normalizedSteps.length} 步计划${overallRisk ? `（最高风险: ${overallRisk}）` : ''}`,
      stats: {
        total: normalizedSteps.length,
        autoRun: 0,
        confirmed: 0,
        skipped: 0,
        failed: 0
      }
    };

    // 预统计各闸门行为（仅记录预期行为分布，不计入执行结果）
    // 注意：执行成功后会在 executeStep 中再次 ++ autoRun/confirmed，所以这里不重复计数
    chain.stats.expectedAutoRun = 0;
    chain.stats.expectedConfirmed = 0;
    for (const step of normalizedSteps) {
      const behavior = this._resolveStepBehavior(step);
      if (behavior === 'autoRun') chain.stats.expectedAutoRun++;
      else if (behavior === 'confirmed') chain.stats.expectedConfirmed++;
    }

    this.chain = chain;
    this.currentStepIndex = -1;
    this.failureCount = 0;
    this.executionLog = [];
    this.paused = false;
    this.cancelled = false;

    // V2 H5.2: 构建子任务依赖图 + 计算可并行批次
    this._buildDependencyGraph(chain);

    // V2 H6.2: 审计日志 — 记录链开始
    auditLogger.logChainStart(chain.id, chain, this._contextSnapshot);

    console.log(`[PlanChain] Created chain ${chain.id}: ${chain.summary}, dependencyBatches=${chain.dependencyBatches?.length || 1}`);
    return chain;
  }

  // ── H5.2: 子任务依赖图 + 并行/串行调度 ──

  /**
   * 构建依赖图，计算可并行执行的批次
   * 策略：
   *   - dependsOn 为空 → 第 0 批（可与其它第 0 批并行）
   *   - dependsOn 中的步骤都完成后 → 当前步骤就绪
   *   - 同一批次内的步骤可并行执行（当前实现仍串行，但标记批次供未来并行化）
   */
  _buildDependencyGraph(chain) {
    const steps = chain.steps;
    if (!steps || steps.length === 0) {
      chain.dependencyBatches = [[]];
      return;
    }

    // 为每步分配 index 映射（用于依赖解析）
    const stepIndexById = {};
    steps.forEach((s, i) => { stepIndexById[s.id || `step_${i}`] = i; });

    // 确保每步有 dependsOn 数组（默认依赖上一步，保守策略）
    steps.forEach((s, i) => {
      if (!s.dependsOn) {
        // 无显式依赖 → 默认依赖前一步（保守串行）
        s.dependsOn = i > 0 ? [`step_${i - 1}`] : [];
      }
    });

    // 拓扑排序 + 分批
    const batches = [];
    const completedSet = new Set();
    const remaining = [...steps.map((_, i) => i)];

    let safetyCounter = steps.length + 5;
    while (remaining.length > 0 && safetyCounter-- > 0) {
      const currentBatch = [];

      for (let i = remaining.length - 1; i >= 0; i--) {
        const idx = remaining[i];
        const step = steps[idx];
        const deps = (step.dependsOn || []).map(d => stepIndexById[d] ?? -1).filter(d => d >= 0);

        // 检查所有依赖是否已完成
        const allDepsComplete = deps.every(d => completedSet.has(d));
        if (allDepsComplete) {
          currentBatch.push(idx);
          remaining.splice(i, 1);
        }
      }

      if (currentBatch.length === 0) {
        // 死锁：存在循环依赖 → 强制打破（将剩余步骤放入当前批次）
        console.warn('[PlanChain][H5.2] Dependency cycle detected, forcing remaining steps');
        currentBatch.push(...remaining);
        remaining.length = 0;
      }

      // 标记当前批次完成（用于下一轮依赖检查）
      currentBatch.forEach(idx => completedSet.add(idx));
      batches.push(currentBatch);
    }

    chain.dependencyBatches = batches;
    chain.canParallelize = batches.some(b => b.length > 1);

    // 为每步标注批次号
    batches.forEach((batch, batchIdx) => {
      batch.forEach(stepIdx => {
        steps[stepIdx].batchIndex = batchIdx;
      });
    });
  }

  // ── 执行计划链 ──

  /**
   * 同步/异步逐步执行整个计划链
   * @returns {Promise<Object>} 最终执行结果
   */
  async execute() {
    if (!this.chain || this.chain.steps.length === 0) {
      return { status: 'empty', message: '无步骤可执行' };
    }
    if (this.chain.status === 'running') {
      return { status: 'error', message: '链已在运行中' };
    }

    this.chain.status = 'running';
    this.chain.startedAt = new Date().toISOString();
    this.onProgress({ type: 'chain_start', chain: this.chain });

    try {
      for (let i = 0; i < this.chain.steps.length; i++) {
        if (this.cancelled) {
          this.chain.status = 'cancelled';
          this.onProgress({ type: 'chain_cancelled', chain: this.chain });
          break;
        }
        if (this.paused) {
          this.chain.status = 'paused';
          this.onProgress({ type: 'chain_paused', chain: this.chain, stepIndex: i });
          // 等待恢复（外部调用 resume()）
          await this._waitResume();
          if (this.cancelled) break;
        }

        const result = await this.executeStep(i);
        if (result.status === 'fatal') {
          // 致命失败：停止整条链
          this.chain.status = 'failed';
          this.onProgress({ type: 'chain_failed', chain: this.chain, error: result.error });
          break;
        }
        // non-fatal failure: continue to next step
      }

      // 正常完成所有步骤
      if (this.chain.status === 'running') {
        this.chain.status = 'completed';
        this.chain.completedAt = new Date().toISOString();
        this.onProgress({ type: 'chain_complete', chain: this.chain });
      }
    } catch (error) {
      this.chain.status = 'error';
      this.chain.error = error.message;
      this.onProgress({ type: 'chain_error', chain: this.chain, error: error.message });
    }

    // V2 H6.2: 审计日志 — 记录链结束
    const duration = this.chain.startedAt && this.chain.completedAt
      ? new Date(this.chain.completedAt) - new Date(this.chain.startedAt)
      : null;
    auditLogger.logChainEnd(this.chain.id, {
      ...this.chain.stats,
      duration,
      finalStatus: this.chain.status
    }, this.chain.status);

    return this._buildResult();
  }

  // ── 执行单步 ──

  /**
   * 执行单步（含完整闸门流程）
   * @param {number} stepIndex - 步骤索引
   * @returns {Promise<Object>} {status:'ok'|'skipped'|'failed'|'fatal', stepResult?, error?}
   */
  async executeStep(stepIndex) {
    const step = this.chain.steps[stepIndex];
    if (!step) return { status: 'failed', error: `步骤 ${stepIndex} 不存在` };

    this.currentStepIndex = stepIndex;
    step.status = 'running';
    step.startedAt = new Date().toISOString();

    this.onProgress({ type: 'step_start', stepIndex, totalSteps: this.chain.steps.length, step });

    // 1️⃣ Gate 1: Schema 校验
    const gate1Result = this._checkGate1Schema(step);
    if (!gate1Result.pass) {
      step.status = 'failed';
      step.error = `Gate 1 Schema 校验失败: ${gate1Result.reason}`;
      this._logExecution(step, 'gate1_failed');
      this.onProgress({ type: 'step_failed', stepIndex, totalSteps: this.chain.steps.length, step, data: gate1Result });
      return { status: 'failed', error: step.error, fatal: false };
    }

    // 2️⃣ Gate 2: Operation Plan 预览（按策略决定是否需要）
    const gate2Wait = this._needsGate2(step);
    if (gate2Wait) {
      step.status = 'waiting_gate2';
      this.onProgress({ type: 'gate_wait', stepIndex, totalSteps: this.chain.steps.length, step, gate: 2 });
      if (this.onGateRequired) {
        const approved = await this.onGateRequired({
          gate: 2,
          stepIndex,
          step,
          reason: `Operation Plan 预览（${step.action}）`,
          chain: this.chain
        });
        if (!approved) {
          step.status = 'cancelled';
          this.chain.stats.skipped++;
          this._logExecution(step, 'gate2_rejected');
          this.onProgress({ type: 'step_cancelled', stepIndex, totalSteps: this.chain.steps.length, step });
          return { status: 'skipped' };
        }
      }
    }

    // 3️⃣ Gate 3: 用户确认（按策略决定是否需要）
    const gate3Wait = this._needsGate3(step);
    if (gate3Wait) {
      step.status = 'waiting_gate3';
      this.onProgress({ type: 'gate_wait', stepIndex, totalSteps: this.chain.steps.length, step, gate: 3 });
      if (this.onGateRequired) {
        const approved = await this.onGateRequired({
          gate: 3,
          stepIndex,
          step,
          reason: `执行确认（${step.action}, 风险: ${step.riskLevel || 'unknown'}）`,
          chain: this.chain
        });
        if (!approved) {
          step.status = 'cancelled';
          this.chain.stats.skipped++;
          this._logExecution(step, 'gate3_rejected');
          this.onProgress({ type: 'step_cancelled', stepIndex, totalSteps: this.chain.steps.length, step });
          return { status: 'skipped' };
        }
      }
    }

    // 4️⃣ PreState 捕获（记录执行前的选择集/模型状态）
    const preState = await this._capturePreState(step);

    // 5️⃣ 命令执行
    let execResult;
    try {
      execResult = await this._executeCommand(step);
    } catch (execError) {
      execResult = { ok: false, error: execError.message };
    }

    // 6️⃣ PostChecks 读回验证
    const postCheck = await this._postCheck(step, execResult);

    // V2 H6.2 + H6.3: 审计日志记录步骤执行 + Before/After 快照
    if (this.chain) {
      auditLogger.logStepExecution(this.chain.id, stepIndex, step, execResult, preState, postCheck);
    }

    // 7️⃣ 结果判定 + 失败处理
    const stepSuccess = execResult.ok && execResult.response?.succeeded !== false;
    step.status = stepSuccess ? 'completed' : 'failed';
    step.result = execResult;
    step.preState = preState;
    step.postCheck = postCheck;
    step.completedAt = new Date().toISOString();

    if (!stepSuccess) {
      this.failureCount++;
      this.chain.stats.failed++;

      // 失败处理：LLM 分析重试 或 回滚
      const handled = await this._handleFailure(step, execResult, stepIndex);
      this._logExecution(step, stepSuccess ? 'completed' : 'failed');

      if (handled.retried) {
        // 重试成功，标记完成
        step.status = 'completed';
        step.result = handled.retryResult;
        this.failureCount--; // 重试成功不计数
        this.onProgress({ type: 'step_complete', stepIndex, totalSteps: this.chain.steps.length, step, data: { retried: true } });
        return { status: 'ok', stepResult: handled.retryResult };
      }

      if (handled.fatal || this.failureCount >= this.approvalPolicy.failureThreshold) {
        // 致命失败或超阈值 → 尝试回滚
        if (this.approvalPolicy.rollbackOnFailure) {
          await this._rollbackTo(stepIndex);
        }
        this.onProgress({ type: 'step_failed', stepIndex, totalSteps: this.chain.steps.length, step, data: { fatal: true, failureCount: this.failureCount } });
        return { status: 'fatal', error: step.error || execResult.error || '未知错误' };
      }

      // 非致命失败，继续下一步
      this.onProgress({ type: 'step_failed', stepIndex, totalSteps: this.chain.steps.length, step, data: { fatal: false, retryExhausted: true } });
      return { status: 'failed', error: step.error, fatal: false };
    }

    // ✅ 成功
    if (step.riskLevel && !['read'].includes(step.riskLevel)) {
      this.chain.stats.confirmed++;
    } else {
      this.chain.stats.autoRun++;
    }
    this._logExecution(step, 'completed');

    // 8️⃣ H2.4 结果回灌：将执行结果传给 LLM 精细化后续步骤参数
    if (this.llm && stepIndex < this.chain.steps.length - 1) {
      await this._refineRemainingSteps(stepIndex, execResult);
    }

    // 9️⃣ H4.3 视觉反馈触发策略 — mutation 后截图给 LLM 验证
    if (this._shouldRunVisualFeedback(step, stepIndex)) {
      const visualResult = await this._runVisualFeedback(step);
      if (visualResult && !visualResult.approved) {
        // 视觉验证不通过 → 记录问题，可能触发修正迭代
        step.visualIssues = visualResult.issues || [];
        step.visualSuggestions = visualResult.suggestions || [];
        this._logExecution(step, 'visual_issues');

        // 如果有修正建议且未达失败阈值，标记为需修正
        if (step.visualSuggestions.length > 0 && this.failureCount < this.approvalPolicy.failureThreshold) {
          this.onProgress({
            type: 'step_visual_issue',
            stepIndex,
            totalSteps: this.chain.steps.length,
            step,
            data: { issues: step.visualIssues, suggestions: step.visualSuggestions }
          });
        }
      } else if (visualResult && visualResult.approved) {
        step.visualVerified = true;
        this._logExecution(step, 'visual_verified');
      }
    }

    this.onProgress({ type: 'step_complete', stepIndex, totalSteps: this.chain.steps.length, step });
    return { status: 'ok', stepResult: execResult };
  }

  // ─── H4.3 视觉反馈触发策略 ───
  // always: 每次 mutation 后截图
  // on-failure: 仅失败时截图（默认）
  // off: 关闭视觉反馈
  _shouldRunVisualFeedback(step, stepIndex) {
    const policy = this.approvalPolicy.visualFeedback || 'on-failure';
    if (policy === 'off') return false;
    if (policy === 'always') {
      // 仅 mutation 类步骤需要视觉验证（read 类无需）
      return step.riskLevel && !['read'].includes(step.riskLevel);
    }
    // on-failure: 失败时已由 _handleFailure 处理，这里返回 false
    return false;
  }

  // H4.1 + H4.2: 调用 ViewportCapture → LLM visualVerify
  async _runVisualFeedback(step) {
    try {
      // H4.1 调用 ViewportCapture 获取视口快照（含真 PNG 截图）
      // includeImage:true → C++ 用 ACAPI_ProjectOperation_Save 保存 PNG → base64 返回
      // 超时从 8s 提升到 20s，因为截图+base64 编码耗时较长
      const captureRes = await axios.post(ARCHICAD_ENDPOINT(), {
        command: 'API.ExecuteAddOnCommand',
        parameters: {
          addOnCommandId: { commandNamespace: 'MEPBridge', commandName: 'ViewportCapture' },
          addOnCommandParameters: { maxElements: 100, includeAabb: true, includeImage: true }
        }
      }, { timeout: 20000 });

      const snapshot = captureRes.data?.result?.addOnCommandResponse;
      if (!snapshot || snapshot.status !== 'ok') {
        console.log('[PlanChain][H4] ViewportCapture failed, skipping visual verify');
        return null;
      }
      console.log('[PlanChain][H4] ViewportCapture OK, viewType:', snapshot.viewType, 'hasImage:', !!snapshot.imageBase64, 'imageSize:', snapshot.imageSize);

      // H4.2 调用 LLM visualVerify（真多模态 vision，含 imageBase64 时走 vision API）
      if (this.aiAdapter && typeof this.aiAdapter.visualVerifyStep === 'function') {
        console.log('[PlanChain][H4] Calling aiAdapter.visualVerifyStep...');
        const verifyResult = await this.aiAdapter.visualVerifyStep(step, snapshot, ARCHICAD_ENDPOINT());
        console.log('[PlanChain][H4] visualVerifyStep result:', verifyResult ? JSON.stringify(verifyResult).slice(0, 200) : 'null');
        return verifyResult;
      }
      console.log('[PlanChain][H4] No aiAdapter or visualVerifyStep method, skipping');
      return null;
    } catch (error) {
      console.log('[PlanChain][H4] Visual feedback skipped:', error.message);
      return null;
    }
  }

  // ── 公共控制方法 ──

  /** 暂停执行（在当前步完成后生效） */
  pause() {
    this.paused = true;
    this.chain.status = 'pausing';
  }

  /** 恢复执行 */
  resume() {
    this.paused = false;
    if (this._resumeResolve) {
      this._resumeResolve();
      this._resumeResolve = null;
    }
  }

  /** 取消执行 */
  cancel() {
    this.cancelled = true;
    this.resume(); // 如果在等待恢复，唤醒后 cancel 检查会终止循环
  }

  /** 获取当前链状态 */
  getStatus() {
    if (!this.chain) return { status: 'idle' };
    const completedCount = (this.chain.stats.autoRun || 0) + (this.chain.stats.confirmed || 0);
    return {
      id: this.chain.id,
      status: this.chain.status,
      currentStep: this.currentStepIndex,
      totalSteps: this.chain.steps.length,
      failureCount: this.failureCount,
      stats: {
        ...this.chain.stats,
        completed: completedCount
      },
      userIntent: this.chain.userIntent
    };
  }

  /** 获取执行日志 */
  getExecutionLog() {
    return [...this.executionLog];
  }

  // ── 内部方法：闸门判断 ──

  _checkGate1Schema(step) {
    // 校验步骤必须有 action 和有效 params
    if (!step.action || typeof step.action !== 'string') {
      return { pass: false, reason: '缺少 action 字段' };
    }
    if (!step.commandNamespace) {
      return { pass: false, reason: '缺少 commandNamespace' };
    }
    // commandJson 结构校验
    if (step.commandJson && step.commandJson.command !== 'API.ExecuteAddOnCommand') {
      // 非 MEPBridge 命令额外检查白名单
      const cmd = step.commandJson.command;
      if (cmd.startsWith('API.') && cmd !== 'API.ExecuteAddOnCommand') {
        const whitelisted = [
          'API.GetSelectedElements', 'API.GetAllElements', 'API.GetElementsByType',
          'API.GetElementPropertyObjects', 'API.GetStoryInfo', 'API.GetProjectInfo',
          'API.ChangeSelection', 'API.SetStoryInfo', 'API.ApplyClassification'
        ].includes(cmd);
        if (!whitelisted) {
          return { pass: false, reason: `命令 ${cmd} 不在安全白名单内` };
        }
      }
    }
    return { pass: true };
  }

  _needsGate2(step) {
    const policy = this.approvalPolicy.gate2PlanPreview;
    if (policy === 'always') return true;
    if (policy === 'never') return false;
    if (policy === 'high-risk') {
      const order = RISK_LEVEL_ORDER.indexOf(step.riskLevel || 'read');
      return order >= RISK_LEVEL_ORDER.indexOf('medium-mutation');
    }
    if (policy === 'mutation') {
      return ['low-mutation', 'high-mutation', 'mutation', 'create-element', 'medium-mutation', 'batch-create']
        .includes(step.riskLevel);
    }
    return false;
  }

  _needsGate3(step) {
    const policy = this.approvalPolicy.gate3Confirm;
    if (policy === 'always') return true;
    if (policy === 'never') return false;
    if (policy === 'high-risk') {
      const order = RISK_LEVEL_ORDER.indexOf(step.riskLevel || 'read');
      return order >= RISK_LEVEL_ORDER.indexOf('medium-mutation');
    }
    if (policy === 'mutation') {
      return ['low-mutation', 'high-mutation', 'mutation', 'create-element', 'medium-mutation', 'batch-create']
        .includes(step.riskLevel);
    }
    return false;
  }

  _resolveStepBehavior(step) {
    const risk = step.riskLevel || 'read';
    const thresholds = this.approvalPolicy.riskThresholds;
    if ((thresholds.forbidden || []).includes(risk)) return 'forbidden';
    if ((thresholds.confirm || []).includes(risk)) return 'confirmed';
    if ((thresholds.autoRun || []).includes(risk)) return 'autoRun';
    return 'confirmed'; // 默认需要确认
  }

  // ── 内部方法：执行 ──

  async _executeCommand(step) {
    const payload = step.commandJson || {
      command: 'API.ExecuteAddOnCommand',
      parameters: {
        addOnCommandId: {
          commandNamespace: step.commandNamespace || 'MEPBridge',
          commandName: step.action
        },
        addOnCommandParameters: step.params || {}
      }
    };

    // V2 修复：对支持 dryRun/confirmRequired 的命令，PlanChain 自动执行时强制注入 dryRun:false, confirmRequired:true
    // 否则 commandJson 默认 dryRun:true 只做预览不创建
    const CREATE_COMMANDS = ['CreateWall', 'CreateColumn', 'CreateBeam', 'CreateSlab', 'CreateRoof',
      'CreateDoor', 'CreateWindow', 'CreatePipe', 'CreateDuct', 'CreateCableCarrier', 'CreatePipeSystem',
      'MoveSelectedElements', 'MoveElements', 'EditSelectedElements', 'EditElements',
      'RotateSelectedElements', 'MirrorSelectedElements', 'CopyElements', 'AutoRoutePipe',
      'CreateStair'];
    if (CREATE_COMMANDS.includes(step.action) && payload.parameters?.addOnCommandParameters) {
      payload.parameters.addOnCommandParameters.dryRun = false;
      payload.parameters.addOnCommandParameters.confirmRequired = true;
    }

    console.log(`[PlanChain] Executing step ${this.currentStepIndex + 1}/${this.chain.steps.length}: ${step.action}`);
    console.log(`[PlanChain] Payload addOnCommandParameters:`, JSON.stringify(payload.parameters?.addOnCommandParameters || payload.parameters));
    // V2 修复：通过 server /api/execute 执行（自动处理参数规范化）
    const serverPayload = { command: payload.command, parameters: payload.parameters };
    const response = await axios.post(EXECUTE_ENDPOINT, serverPayload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    const archicadResult = response.data?.response || response.data;
    const addOnResponse = archicadResult?.result?.addOnCommandResponse || archicadResult?.addOnCommandResponse;
    const success = (archicadResult?.succeeded === true || response.data?.ok === true) && addOnResponse?.status !== 'error' && addOnResponse?.success !== false;

    return {
      ok: success,
      response: archicadResult,
      addOnResponse,
      command: payload
    };
  }

  async _capturePreState(step) {
    // 记录当前选择集作为前置状态
    try {
      const response = await axios.post(ARCHICAD_ENDPOINT(), {
        command: 'API.ExecuteAddOnCommand',
        parameters: {
          addOnCommandId: { commandNamespace: 'MEPBridge', commandName: 'GetSelectedElements' },
          addOnCommandParameters: {}
        }
      }, { timeout: 5000 });
      return { timestamp: new Date().toISOString(), selection: response.data?.result?.addOnCommandResponse };
    } catch (e) {
      return { timestamp: new Date().toISOString(), error: e.message };
    }
  }

  async _postCheck(step, execResult) {
    // 对于 mutation 操作，执行后重新读取选择集验证变化
    if (!execResult.ok) return { verified: false, reason: 'execution failed' };
    try {
      const response = await axios.post(ARCHICAD_ENDPOINT(), {
        command: 'API.ExecuteAddOnCommand',
        parameters: {
          addOnCommandId: { commandNamespace: 'MEPBridge', commandName: 'GetSelectedElements' },
          addOnCommandParameters: {}
        }
      }, { timeout: 5000 });
      return { verified: true, postSelection: response.data?.result?.addOnCommandResponse };
    } catch (e) {
      return { verified: null, error: e.message };
    }
  }

  // ── 内部方法：失败处理 H2.5 + H6.1 智能重试增强 ──

  async _handleFailure(step, execResult, stepIndex) {
    const maxRetries = this.approvalPolicy.maxRetries || 0;
    const stepRetries = step._retryCount || 0;

    // V2 H6.1: 错误分类 — 不同错误类型采用不同重试策略
    const errorCategory = this._classifyError(execResult);

    if (errorCategory === 'fatal') {
      // 不可恢复错误（如 CONFIRM_REQUIRED_FALSE, INVALID_GUID）→ 不重试
      console.log(`[PlanChain][H6.1] Fatal error (${execResult.error}), no retry`);
      return { fatal: true, reason: `不可恢复错误: ${execResult.error}` };
    }

    if (stepRetries < maxRetries && this.llm) {
      // LLM 分析失败原因并调参重试
      console.log(`[PlanChain] Step ${stepIndex} failed (${errorCategory}), retrying (${stepRetries + 1}/${maxRetries})...`);
      step._retryCount = stepRetries + 1;

      try {
        const remainingSteps = this.chain.steps.slice(stepIndex);
        const refinement = await this.llm.refineStepWithResult(
          step,
          execResult.error || JSON.stringify(execResult.response).slice(0, 500),
          remainingSteps
        );

        if (refinement.refined && refinement.step && !refinement.skip) {
          // 应用精炼后的参数到当前步骤
          Object.assign(step.params, refinement.step.params || {});
          if (refinement.step.commandJson) step.commandJson = refinement.step.commandJson;
          step.description += ` [精炼重试#${step._retryCount}]`;

          // 重试执行
          const retryResult = await this._executeCommand(step);
          if (retryResult.ok) {
            return { retried: true, retryResult, errorCategory };
          }
        }
      } catch (retryError) {
        console.error(`[PlanChain] Retry failed: ${retryError.message}`);
      }
    }

    // 检查是否为禁止类操作
    const behavior = this._resolveStepBehavior(step);
    if (behavior === 'forbidden') {
      return { fatal: true, reason: `禁止类操作 ${step.action} 失败` };
    }

    return { retried: false, fatal: false, errorCategory };
  }

  // V2 H6.1: 错误分类
  // fatal: 不可恢复（参数错误/权限错误/命令不存在）
  // transient: 可重试（超时/网络/临时锁）
  // logical: 逻辑错误（LLM 分析后可能调参成功）
  // unknown: 未知错误（保守尝试重试）
  _classifyError(execResult) {
    const errMsg = (execResult.error || '').toLowerCase();
    const apiErr = execResult.response?.error;

    // 不可恢复错误
    if (errMsg.includes('confirm_required') ||
        errMsg.includes('invalid_guid') ||
        errMsg.includes('invalid_') ||
        errMsg.includes('missing ') ||
        errMsg.includes('not found') ||
        errMsg.includes('unsupported')) {
      return 'fatal';
    }

    // 临时性错误（可重试）
    if (errMsg.includes('timeout') ||
        errMsg.includes('etimedout') ||
        errMsg.includes('econnreset') ||
        errMsg.includes('econnrefused') ||
        errMsg.includes('network')) {
      return 'transient';
    }

    // Archicad API 错误码（负数通常为临时/可重试）
    if (apiErr && typeof apiErr === 'number' && apiErr < 0) {
      return 'transient';
    }

    // 其他错误：让 LLM 尝试调参
    return 'logical';
  }

  async _rollbackTo(stepIndex) {
    console.log(`[PlanChain][H6.1] Rolling back to step ${stepIndex}, executing rollback for ${this.failureCount} failed steps`);
    const rolledBackSteps = [];

    this.onProgress({
      type: 'rollback',
      stepIndex,
      chain: this.chain,
      data: { rolledBackSteps: Math.min(this.failureCount, stepIndex) }
    });

    // V2 H6.1: 增强回滚 — 按命令类型构造反向操作
    for (let i = stepIndex; i >= 0; i--) {
      const step = this.chain.steps[i];
      if (step.status !== 'completed') continue;

      const reverseCmd = this._buildReverseCommand(step);
      if (reverseCmd) {
        // 尝试执行反向命令
        try {
          const rollbackResult = await this._executeCommand(reverseCmd);
          if (rollbackResult.ok) {
            step.rolledBack = true;
            rolledBackSteps.push({ stepIndex: i, action: step.action, reverseAction: reverseCmd.action });
          } else {
            step.rollbackSuggested = true;
            step.rollbackFailed = true;
          }
        } catch (e) {
          step.rollbackSuggested = true;
          step.rollbackError = e.message;
        }
      } else {
        // 无法自动回滚的命令 → 标记建议手动回滚
        step.rollbackSuggested = true;
      }
    }

    // V2 H6.2: 审计日志 — 记录回滚事件
    auditLogger.logRollback(this.chain.id, stepIndex, rolledBackSteps);
  }

  // V2 H6.1: 根据命令类型构造反向命令
  _buildReverseCommand(step) {
    const action = step.action;
    const params = step.params || {};

    switch (action) {
      case 'MoveSelectedElements':
      case 'MoveElements':
        // 反向移动：取反 deltaMm
        if (params.deltaMm) {
          return {
            action,
            params: {
              ...params,
              deltaMm: {
                x: -(params.deltaMm.x || 0),
                y: -(params.deltaMm.y || 0),
                z: -(params.deltaMm.z || 0)
              },
              dryRun: false,
              confirmRequired: true
            }
          };
        }
        return null;

      case 'RotateSelectedElements':
        // 反向旋转：取负角度
        if (params.angle !== undefined) {
          return {
            action,
            params: { ...params, angle: -params.angle, dryRun: false, confirmRequired: true }
          };
        }
        return null;

      case 'CreateWall':
      case 'CreateColumn':
      case 'CreateBeam':
      case 'CreateSlab':
      case 'CreateRoof':
      case 'CreateDoor':
      case 'CreateWindow':
      case 'CreatePipe':
      case 'CreateDuct':
      case 'CreateCableCarrier':
        // 创建类：需要删除创建的元素（需 GUID，从 execResult 获取）
        // 简化：标记为需手动删除（实际 GUID 在 execResult.response 中）
        return null;

      default:
        return null;
    }
  }

  // ── 内部方法：H2.4 结果回灌 ──

  async _refineRemainingSteps(completedStepIndex, execResult) {
    if (!this.llm) return;
    try {
      const completedStep = this.chain.steps[completedStepIndex];
      const remainingSteps = this.chain.steps.slice(completedStepIndex + 1);
      if (remainingSteps.length === 0) return;

      // 异步回灌（不阻塞主流程）
      setImmediate(async () => {
        try {
          await this.llm.refineStepWithResult(
            completedStep,
            execResult,
            remainingSteps
          );
        } catch (e) {
          console.warn('[PlanChain] Background refinement failed:', e.message);
        }
      });
    } catch (e) {
      console.warn('[PlanChain] Refine scheduling failed:', e.message);
    }
  }

  // ── 内部工具方法 ──

  _normalizeStep(step, idx) {
    const riskLevel = step.riskLevel ||
      (['CreateWall', 'CreateColumn', 'CreateBeam', 'CreateSlab', 'CreateRoof', 'CreateDoor', 'CreateWindow',
          'CreatePipe', 'CreateDuct', 'CreateCableCarrier', 'CreatePipeSystem'].includes(step.action) ? 'create-element' :
       ['MoveSelectedElements', 'MoveElements', 'CopyElements', 'EditSelectedElements', 'EditElements'].includes(step.action) ? 'low-mutation' :
       ['RotateSelectedElements', 'MirrorSelectedElements'].includes(step.action) ? 'medium-mutation' :
       ['DeleteMEPElements'].includes(step.action) ? 'high-mutation' :
       'read');

    return {
      id: `step_${idx + 1}`,
      action: step.action || step.commandName || `unknown_${idx}`,
      title: step.title || step.action || `Step ${idx + 1}`,
      description: step.description || '',
      expected: step.expected || '',
      params: step.params || {},
      commandJson: step.commandJson || null,
      commandNamespace: step.commandNamespace || 'MEPBridge',
      descriptorName: step.descriptorName || null,
      riskLevel,
      status: 'pending',         // pending | running | waiting_gate2 | waiting_gate3 | completed | failed | cancelled
      behavior: null,            // autoRun | confirmed | forbidden（执行时解析）
      result: null,
      preState: null,
      postCheck: null,
      startedAt: null,
      completedAt: null,
      _retryCount: 0,
      rollbackSuggested: false,
      ...step                  // 允许原始字段覆盖
    };
  }

  _inferOverallRisk(steps) {
    let maxOrder = -1;
    let maxRisk = null;
    for (const s of steps) {
      const order = RISK_LEVEL_ORDER.indexOf(s.riskLevel || 'read');
      if (order > maxOrder) {
        maxOrder = order;
        maxRisk = s.riskLevel;
      }
    }
    return maxRisk;
  }

  _logExecution(step, outcome) {
    const entry = {
      stepId: step.id,
      action: step.action,
      outcome,
      timestamp: new Date().toISOString(),
      riskLevel: step.riskLevel
    };
    this.executionLog.push(entry);
    if (this.chain) {
      this.chain.executionLog.push(entry);
    }
    // 同时记录到 ai-adapter 的全局执行历史（H3.3）
    try {
      const aiAdapter = require('./ai-adapter');
      aiAdapter.recordExecution({
        action: step.action,
        commandNamespace: step.commandNamespace,
        success: outcome === 'completed',
        result: step.result ? JSON.stringify(step.result).slice(0, 200) : null
      });
    } catch (e) { /* ignore */ }
  }

  _buildResult() {
    const chain = this.chain;
    // 计算实际完成步数 = autoRun(自动执行) + confirmed(确认执行)
    const completedCount = (chain.stats.autoRun || 0) + (chain.stats.confirmed || 0);
    return {
      id: chain.id,
      status: chain.status,
      userIntent: chain.userIntent,
      reasoning: chain.reasoning,
      summary: chain.summary,
      stats: {
        ...chain.stats,
        completed: completedCount  // UI 需要此字段显示"X步成功"
      },
      steps: chain.steps.map(s => ({
        id: s.id,
        action: s.action,
        title: s.title,
        status: s.status,
        riskLevel: s.riskLevel,
        result: s.result ? {
          ok: s.result.ok,
          guid: s.result.addOnResponse?.guid || s.result.addOnResponse?.wallGuid || null,
          hasResponse: !!s.result.response
        } : null,
        error: s.error || null
      })),
      executionLog: chain.executionLog,
      failureCount: this.failureCount,
      startedAt: chain.startedAt,
      completedAt: chain.completedAt
    };
  }

  _waitResume() {
    return new Promise((resolve) => {
      this._resumeResolve = resolve;
    });
  }

  _generateId() {
    return `chain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ── 导出 ───

module.exports = {
  PlanChain,
  APPROVAL_PRESETS,
  RISK_LEVEL_ORDER
};
