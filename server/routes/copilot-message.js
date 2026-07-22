// copilot-message.js
// /api/copilot/message 路由（D.1，修复 NL 链路断点①）
// 接收 {message}，调用 ai-adapter.generatePlan()，返回 UI 期望的 {message, isMepAction, action} 格式
// 来源：REVIEW §11.3.2 断点①、TASK_PLAN D.1
//
// FO-3 (2026-06-26): 自动感知当前选择集，注入 systemPrompt（count/types/guids）

const express = require('express');
const router = express.Router();
const aiAdapter = require('../services/ai-adapter');
const archicadClient = require('../services/archicad-client');
const taskTemplates = require('../services/task-templates');   // V2 H5.5 任务模板库
const { normalizeUiLocale, isEnglishUiLocale } = require('../services/ui-locale');

/**
 * 获取当前选择集摘要（FO-3）
 * 返回 { count, types, guids } 或 null（获取失败/无选中）
 * @returns {Promise<{count: number, types: Array<{type:string,count:number}>, guids: string[]} | null>}
 */
async function fetchSelectionContext() {
  try {
    const result = await archicadClient.executeCommand('GetSelectedElements', {
      onlyEditable: false,
      includeAabb: false,
      includeMepInfo: true
    });

    if (!result.success || !result.data) return null;

    // 解析 GS::ObjectState 响应 → 标准数组格式
    const rawElements = result.data.elements || result.data.result?.elements;
    if (!Array.isArray(rawElements) || rawElements.length === 0) {
      return { count: 0, types: [], guids: [] };
    }

    const typeCounts = {};
    const guids = [];
    for (const el of rawElements) {
      const guid = el.guid || '';
      const type = el.type || 'Unknown';
      if (guid) guids.push(guid);
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }

    return {
      count: guids.length,
      types: Object.entries(typeCounts).map(([type, count]) => ({ type, count })),
      guids
    };
  } catch (err) {
    console.warn('[Copilot][FO-3] Selection fetch failed:', err.message);
    return null;
  }
}

/**
 * POST /api/copilot/message
 * Copilot NL → Operation Plan *
 * 请求 body: { message: string }
 * 响应: { message, isMepAction, action: { title, warning, isMutation, mepCode, steps, parameters } }
 */
router.post('/', async (req, res) => {
  const locale = normalizeUiLocale(req.body?.locale);
  const english = isEnglishUiLocale(locale);

  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        message: 'Missing required field: message',
        isMepAction: false,
        action: null
      });
    }

    console.log(`[Copilot] NL input: ${message}`);

    // FO-3: 并行获取选择集上下文 + V2 H3.1 模型快照 + V2 H3.2/H3.4 项目上下文
    // 选择集/快照/项目上下文获取失败不阻断主流程（降级为无上下文模式）
    const { getArchicadEndpoint } = require('../services/archicad-endpoint');
    const ARCHICAD_ENDPOINT = getArchicadEndpoint();
    const [selectionContext, modelSnapshot, projectContext] = await Promise.all([
      fetchSelectionContext(),
      aiAdapter.getModelSnapshot(ARCHICAD_ENDPOINT),
      aiAdapter.getProjectContext(ARCHICAD_ENDPOINT)
    ]);

    const context = {
      language: locale,
      locale,
    };
    if (selectionContext && selectionContext.count > 0) {
      context.selection = selectionContext;
      console.log(`[Copilot][FO-3] Selection injected: ${selectionContext.count} elements, types=[${selectionContext.types.map(t => `${t.type}(${t.count})`).join(', ')}]`);
    }
    // V2 H3.1: 注入模型快照摘要
    if (modelSnapshot) {
      context.modelSnapshot = modelSnapshot.summary;
      console.log(`[Copilot][H3.1] Model snapshot: ${modelSnapshot.summary}`);
    }
    // V2 H3.2 + H3.4: 注入项目上下文（楼层/视图/项目设置）
    if (projectContext) {
      context.projectContext = projectContext.summary;
      if (projectContext.stories) context.stories = projectContext.stories;
      console.log(`[Copilot][H3.2] Project context: ${projectContext.summary}`);
    }

    // V2 H5.5: 先尝试任务模板匹配（<200ms 精确匹配，避免不必要的 LLM 调用）
    const templatePlan = taskTemplates.tryGenerate(message, context);
    if (templatePlan) {
      console.log(`[Copilot][H5.5] Template matched: ${templatePlan.userIntent}, ${templatePlan.steps.length} steps`);

      // 转换模板计划为 UI 期望的 Copilot 响应格式
      const steps = templatePlan.steps.map((step, idx) => ({
        id: `step_${idx + 1}`,
        title: step.title || step.action || `Step ${idx + 1}`,
        action: step.action || '',
        description: '',
        expectedResult: '',
        params: step.params || {},
        commandJson: null,
        commandNamespace: null,
        commandName: step.action || '',
        descriptorName: null,
        riskLevel: step.riskLevel || 'create-element',
        status: 'pending'
      }));

      const isMutation = steps.some(s => s.riskLevel && (s.riskLevel.includes('mutation') || s.riskLevel.includes('create')));
      const mepCode = steps[0]?.action || '';

      return res.json({
        message: english
          ? `Matched template: ${templatePlan.userIntent}. Generated a ${steps.length}-step operation plan.`
          : `已匹配模板：${templatePlan.userIntent}，生成 ${steps.length} 步操作计划。`,
        isMepAction: true,
        action: {
          title: templatePlan.userIntent,
          warning: isMutation
            ? (english
              ? 'This operation will create or modify building elements. Confirm before execution.'
              : '此操作将创建或修改建筑构件，请确认后执行。')
            : '',
          isMutation,
          mepCode,
          steps,
          parameters: []
        }
      });
    }

    // 调用 AI 适配器生成计划（双模式架构：有 LLM 走 LLM 优先，无 LLM 走纯本地）
    const plan = await aiAdapter.generatePlan(message, context);

    // D5: 无法识别意图 → 返回友好提示（不执行任何命令）
    if (plan.unsupported) {
      console.log('[Copilot] Intent unrecognized, returning friendly reply');
      return res.json({
        message: plan.message || (english
          ? 'Sorry, I could not understand the request. Please describe it more specifically.'
          : '抱歉，我未能理解您的意图。请尝试更具体的描述。'),
        isMepAction: false,
        action: null
      });
    }

    // 转换为 UI 期望的 Copilot 响应格式
    // D.4: 同时保留 action（驱动命令映射）和 title（显示用）
    const steps = (plan.steps || []).map((step, idx) => ({
      id: `step_${idx + 1}`,
      title: step.title || step.action || `Step ${idx + 1}`,
      action: step.action || '',
      description: step.description || '',
      expectedResult: step.expected || '',
      params: step.params || {},
      commandJson: step.commandJson || null,
      commandNamespace: step.commandNamespace || null,
      commandName: step.commandName || step.action || '',
      descriptorName: step.descriptorName || null,
      riskLevel: step.riskLevel || null,
      status: 'pending'
    }));

    const response = {
      message: plan.userIntent
        ? (english
          ? `Parsed request: "${plan.userIntent}". Generated a ${steps.length}-step operation plan.`
          : `已解析指令："${plan.userIntent}"，生成 ${steps.length} 步操作计划。`)
        : (english
          ? `Generated a ${steps.length}-step operation plan.`
          : `已生成 ${steps.length} 步操作计划。`),
      isMepAction: steps.length > 0,
      reasoning: plan.reasoning || '',  // V2: 返回 LLM CAD-CoT 思考过程
      action: {
        title: plan.userIntent || message.slice(0, 50),
        warning: plan.warningText || (plan.isMutation
          ? (english ? 'This operation will modify the Archicad model.' : '此操作将修改 Archicad 模型')
          : null),
        isMutation: plan.isMutation || false,
        mepCode: steps.map(s => s.title).join(' → '),
        steps: steps,
        parameters: []
      }
    };

    console.log(`[Copilot] Generated ${steps.length} steps, isMutation=${response.action.isMutation}`);
    res.json(response);
  } catch (error) {
    console.error('[Copilot] Error:', error.message);
    res.status(500).json({
      message: `${english ? 'Processing failed' : '处理失败'}: ${error.message}`,
      isMepAction: false,
      action: null
    });
  }
});

module.exports = router;
