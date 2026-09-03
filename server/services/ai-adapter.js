// AI 适配器 - 升级版（支持真实 LLM）
const fs = require('fs');
const path = require('path');
const {
  applyDefaultSafetyParameters,
  normalizeCommandSafetyParameters,
} = require('./command-capabilities');
const { migrateLegacyFile } = require('./runtime-paths');
const { decrypt: decryptLlmConfig } = require('./llm-config-crypto');
const { normalizeUiLocale, isEnglishUiLocale } = require('./ui-locale');
const semanticIndex = require('./semantic-index');
// NL 参数提取器：与 task-templates.js 共用同一份实现。
// 此前这些函数只定义在本文件内部，模板路径取不到，导致 TPL-011 生成的 deltaMm
// 恒为零并被 Add-On 以 ZERO_DELTA 拒绝（成因见 nl-param-extractors.js 顶部说明）。
const {
  extractDiameterMm,
  extractElementType,
  extractWaypoints,
  extractDelta,
  extractTargetStoryIndex
} = require('./nl-param-extractors');

const CONFIG_FILE = migrateLegacyFile('.llm-config.json');
// D.5: 加载 tool-descriptors.json 作为命令注册中心
const DESCRIPTORS_FILE = path.join(__dirname, '../../ai-adapter/tool-descriptors.json');

class AIAdapter {
  constructor() {
    this.llm = null;
    this.descriptors = [];
    // V2 H3.3: 执行历史记录（最近 10 步），注入 LLM 上下文
    this.executionHistory = [];
    this.MAX_HISTORY = 10;
    this.loadDescriptors();
    this.loadConfig();
  }

  // D.5: 加载 tool-descriptors.json
  loadDescriptors() {
    try {
      if (fs.existsSync(DESCRIPTORS_FILE)) {
        const data = JSON.parse(fs.readFileSync(DESCRIPTORS_FILE, 'utf8'));
        this.descriptors = data.descriptors || [];
        console.log(`[AI Adapter] Loaded ${this.descriptors.length} tool descriptors`);
      } else {
        console.log('[AI Adapter] No tool-descriptors.json found, NL matching will use fallback keywords');
        this.descriptors = [];
      }
    } catch (error) {
      console.error('[AI Adapter] Descriptors load error:', error.message);
      this.descriptors = [];
    }
  }

  // 加载配置
  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

        if (config.disabled === true) {
          console.log('[AI Adapter] LLM config is disabled, using fallback mode');
          this.llm = null;
          return;
        }

        // 解密 API 密钥
        if (config.apiKey) {
          config.apiKey = this.decrypt(config.apiKey);
        }

        // 根据类型初始化适配器
        if (config.provider === 'ollama') {
          const OllamaAdapter = require('./ollama-adapter');
          this.llm = new OllamaAdapter(config);
          console.log(`[AI Adapter] Loaded Ollama configuration`);
        } else {
          const LLMAdapter = require('./llm-adapter');
          // D5: 传入 descriptors，让 LLMAdapter 能自动生成 systemPrompt
          this.llm = new LLMAdapter({ ...config, descriptors: this.descriptors });
          console.log(`[AI Adapter] Loaded ${config.provider} configuration with ${this.descriptors.length} descriptors`);
        }
      } else {
        console.log('[AI Adapter] No LLM config found, using fallback mode');
        this.llm = null;
      }
    } catch (error) {
      console.error('[AI Adapter] Config load error:', error.message);
      this.llm = null;
    }
  }

  // V2 H3.3: 记录执行步骤到历史
  recordExecution(step) {
    this.executionHistory.push({
      action: step.action,
      commandNamespace: step.commandNamespace || 'MEPBridge',
      success: step.success !== false,
      timestamp: new Date().toISOString(),
      result: step.result ? JSON.stringify(step.result).slice(0, 200) : null
    });
    // 保持最近 MAX_HISTORY 条
    if (this.executionHistory.length > this.MAX_HISTORY) {
      this.executionHistory.shift();
    }
  }

  // V2 H3.3: 获取执行历史摘要（注入 LLM）
  getHistorySummary() {
    if (this.executionHistory.length === 0) return '';
    const lines = this.executionHistory.map((h, i) => {
      const status = h.success ? '✅' : '❌';
      return `  ${i + 1}. ${status} ${h.commandNamespace}.${h.action}${h.result ? ' → ' + h.result : ''}`;
    });
    return `\n## 最近执行历史（${this.executionHistory.length} 步）\n${lines.join('\n')}\n\n**重要**: 用户说"再建一面"/"继续"等时，参考历史推断意图。如上次建了墙，"再建一面"可能是建相邻墙。\n`;
  }

  // V2 H3.1: 获取模型快照（调用 ScanStructuralElements）
  // 让 LLM 感知当前模型状态，做上下文感知决策
  async getModelSnapshot(archicadEndpoint) {
    try {
      const axios = require('axios');
      const response = await axios.post(archicadEndpoint, {
        command: 'API.ExecuteAddOnCommand',
        parameters: {
          addOnCommandId: { commandNamespace: 'MEPBridge', commandName: 'ScanStructuralElements' },
          addOnCommandParameters: {}
        }
      }, { timeout: 5000 });

      const result = response.data?.result?.addOnCommandResponse;
      if (result?.status === 'ok' && result.count !== undefined) {
        const typeCounts = {};
        if (Array.isArray(result.elements)) {
          for (const el of result.elements) {
            typeCounts[el.type] = (typeCounts[el.type] || 0) + 1;
          }
        }
        const typeSummary = Object.entries(typeCounts).map(([t, c]) => `${t}×${c}`).join('、');
        return {
          count: result.count,
          types: typeCounts,
          summary: `当前模型有 ${result.count} 个结构构件（${typeSummary}）`
        };
      }
    } catch (error) {
      // 模型快照获取失败不阻断主流程
      console.log('[AI Adapter] Model snapshot skipped:', error.message);
    }
    return null;
  }

  // V2 H3.2 + H3.4: 获取项目上下文（楼层/视图/项目设置）
  // 让 LLM 感知当前楼层结构、项目单位、比例等，做上下文感知决策
  async getProjectContext(archicadEndpoint) {
    const axios = require('axios');
    const result = { stories: null, projectInfo: null, summary: '' };

    // 并行获取楼层 + 项目信息
    const [storiesRes, projectRes] = await Promise.allSettled([
      axios.post(archicadEndpoint, {
        command: 'API.GetStoryInfo'
      }, { timeout: 5000 }),
      axios.post(archicadEndpoint, {
        command: 'API.GetProjectInfo'
      }, { timeout: 5000 })
    ]);

    // 解析楼层
    if (storiesRes.status === 'fulfilled') {
      const storiesData = storiesRes.value.data?.result;
      if (storiesData?.stories && Array.isArray(storiesData.stories)) {
        const stories = storiesData.stories.map((s, i) => ({
          index: s.index ?? i,
          name: s.name || `Floor ${i + 1}`,
          level: s.level ?? 0
        }));
        result.stories = stories;
        const storyNames = stories.map(s => `${s.name}(+${s.level.toFixed(2)}m)`).join(', ');
        result.summary += `楼层结构（${stories.length}层）: ${storyNames}。`;
      }
    }

    // 解析项目信息
    if (projectRes.status === 'fulfilled') {
      const projData = projectRes.value.data?.result;
      if (projData) {
        result.projectInfo = {
          name: projData.projectName || projData.name || '',
          path: projData.projectPath || projData.path || '',
          location: projData.location || '',
          storyStructure: projData.storyStructure || ''
        };
        if (result.projectInfo.name) {
          result.summary += `项目"${result.projectInfo.name}"。`;
        }
      }
    }

    // H3.4: 项目单位/比例（Archicad 无直接API，用约定推断）
    // 默认住宅项目单位 mm，比例 1:100
    result.units = 'mm';
    result.scale = '1:100';
    result.summary += `单位: ${result.units}, 比例: ${result.scale}。`;

    return result.stories || result.projectInfo ? result : null;
  }

  // V2 H4.2: 视觉验证 — 执行 ViewportCapture 后将快照数据交给 LLM 判断
  // 返回 { approved: bool, issues: string[], suggestions: string[] }
  async visualVerifyStep(step, viewportSnapshot, archicadEndpoint) {
    if (!this.llm) return { approved: true, issues: [], suggestions: [] };

    try {
      const verifyResult = await this.llm.visualVerify(step, viewportSnapshot);
      return verifyResult || { approved: true, issues: [], suggestions: [] };
    } catch (error) {
      console.log('[AI Adapter][H4.2] Visual verify skipped:', error.message);
      return { approved: true, issues: [], suggestions: [] };
    }
  }

  // 生成操作计划
  // 双模式架构（2026-06-26 D5 重构）:
  //   [有 LLM]   LLM 语义理解 → descriptor nlTriggers → fallback 硬编码 → 友好回复
  //   [无 LLM]   descriptor nlTriggers → fallback 硬编码 → 友好回复（跳过 LLM）
  // BASE 模式不经此链路（UI 端直接调 /api/execute）
  async generatePlan(text, context = {}) {
    const hasLLM = !!this.llm;
    const planContext = { ...context };

    try {
      planContext.semanticIndex = await semanticIndex.createContext(text, {
        elementGuid: context.elementGuid || context.routeGuid
      });
    } catch (error) {
      console.log('[AI Adapter] Semantic index unavailable:', error.message);
      planContext.semanticIndex = {
        unavailable: true,
        error: error.message
      };
    }

    // V2 H3.3: 注入执行历史到 context（LLM 感知之前的操作）
    if (hasLLM && this.executionHistory.length > 0 && !planContext.history) {
      planContext.history = this.getHistorySummary();
    }

    if (hasLLM) {
      // ─── LLM 优先路径 ───
      // L1: LLM 语义理解（systemPrompt 已从 descriptors 自动生成）
      let llmFailure = null;
      try {
        const plan = await this.llm.generatePlan(text, planContext);
        if (plan && plan.steps && plan.steps.length > 0) {
          // LLM 命中：低置信度时仍降级到本地匹配（避免幻觉）
          if (plan.confidence !== undefined && plan.confidence < 0.5) {
            console.log(`[AI Adapter] LLM low confidence (${plan.confidence}), falling back to descriptor matching`);
          } else {
            console.log('[AI Adapter] LLM generated plan successfully');
            return this.enrichPlan(plan, text, planContext);
          }
        }
      } catch (error) {
        // 记下失败原因向上传递：LLM 不可用时用户只看到「反应很慢然后降级了」，
        // 却不知道是密钥失效、超时还是网络不通。降级本身能给出结果，
        // 但配置问题必须让用户看见，否则会一直误以为 LLM 在工作。
        llmFailure = describeLlmFailure(error, this.llm);
        console.error(`[AI Adapter] LLM call failed: ${error.message} (${llmFailure.reason})`);
      }

      // L2: descriptor nlTriggers 匹配（LLM 失败/降级时使用）
      const descriptorMatch = this.matchDescriptorByText(text);
      if (descriptorMatch) {
        console.log(`[AI Adapter] NL matched descriptor (after LLM): ${descriptorMatch.name}`);
        const plan = this.buildPlanFromDescriptor(descriptorMatch, text, planContext.language);
        return this.enrichPlan(attachLlmFailure(plan, llmFailure), text, planContext);
      }

      // L3: fallback 硬编码
      const fallbackPlan = this.fallbackGeneratePlan(text, planContext);
      if (fallbackPlan && !fallbackPlan.unsupported) {
        return this.enrichPlan(attachLlmFailure(fallbackPlan, llmFailure), text, planContext);
      }

      // L4: 无法识别 → 友好回复
      return attachLlmFailure(this.buildUnrecognizedResponse(text, planContext.language), llmFailure);
    }

    // ─── 无 LLM 路径（跳过 LLM 语义理解） ───
    // L1: descriptor nlTriggers 匹配（纯本地，<5ms）
    const descriptorMatch = this.matchDescriptorByText(text);
    if (descriptorMatch) {
      console.log(`[AI Adapter] NL matched descriptor (no-LLM mode): ${descriptorMatch.name}`);
      const plan = this.buildPlanFromDescriptor(descriptorMatch, text, planContext.language);
      return this.enrichPlan(plan, text, planContext);
    }

    // L2: fallback 硬编码
    const fallbackPlan = this.fallbackGeneratePlan(text, planContext);
    if (fallbackPlan && !fallbackPlan.unsupported) {
      return this.enrichPlan(fallbackPlan, text, planContext);
    }

    // L3: 无法识别 → 友好回复
    return this.buildUnrecognizedResponse(text, planContext.language);
  }

  // D5: 无法识别意图时的友好回复（不执行任何命令）
  buildUnrecognizedResponse(text, locale = 'zh-CN') {
    console.log(`[AI Adapter] Intent unrecognized: "${text}"`);
    const english = isEnglishUiLocale(normalizeUiLocale(locale));
    return {
      unsupported: true,
      steps: [],
      isMutation: false,
      userIntent: text,
      message: english
        ? `Sorry, I could not understand "${text.slice(0, 40)}". You can try:\n\n` +
          `**Example requests:**\n` +
          `- List available pipe sizes or MEP systems\n` +
          `- Create a DN25 pipe from (0,0,3) to (5,0,3)\n` +
          `- Move the selected elements up by 100mm\n` +
          `- List all columns or scan structural elements\n` +
          `- Read selected elements or ping the connection\n\n` +
          `**Create a custom command:**\n` +
          `Open Extensions > Custom Commands, add a trigger, and bind it to a single command or task template.`
        : `抱歉，我未能理解您的意图"${text.slice(0, 40)}"。您可以：\n\n` +
          `📋 **尝试以下说法：**\n` +
          `• 查询管径表 / 查询MEP系统\n` +
          `• 创建DN25水管从(0,0,3)到(5,0,3)\n` +
          `• 移动选中上移100mm\n` +
          `• 查询所有柱 / 扫描结构构件\n` +
          `• 读取选中构件 / ping连接\n\n` +
          `⚡ **创建自定义命令：**\n` +
          `在右侧扩展功能面板 → 自定义命令 Tab 中创建触发词，\n` +
          `绑定单步命令或任务模板，下次输入触发词即可快速执行。\n` +
          `例如：触发词"读墙" → 绑定 GetElementsByType elementType=Wall`
    };
  }

  // 后备计划生成（规则驱动，覆盖 9 类基础命令，中英文关键词）
  // D.2 扩充：从 3 类扩充到 9 类，对齐 tool-descriptors.json 基础命令集
  // D.5 增强：优先从 tool-descriptors.json 的 nlTriggers 匹配，硬编码关键词作为兜底
  fallbackGeneratePlan(text, context) {
    console.log('[AI Adapter] Using fallback plan generation');

    const lowerText = text.toLowerCase();

    // 辅助：检测关键词命中（中英文）
    const matches = (keywords) => keywords.some(kw => lowerText.includes(kw.toLowerCase()));

    // D.5: 优先从 tool-descriptors.json 的 nlTriggers 匹配
    const descriptorMatch = this.matchDescriptorByText(text);
    if (descriptorMatch) {
      console.log(`[AI Adapter] NL matched descriptor: ${descriptorMatch.name}`);
      return this.buildPlanFromDescriptor(descriptorMatch, text, context.language);
    }

    // 1. Ping / 连接检测
    if (matches(['ping', '连接', '连通', '心跳', '状态检测', 'health'])) {
      return {
        steps: [{
          action: 'Ping',
          title: 'Ping',
          description: '检查 MEPBridge Add-On 连接状态',
          expected: 'status=ok',
          params: {}
        }],
        isMutation: false,
        userIntent: text
      };
    }

    // 2. 读取/查询选中构件（GetSelectedElements）
    if (matches(['读取', '查询', '查看', '选中构件', '选择集', 'read', 'select', 'get selected', 'list selected'])) {
      return {
        steps: [{
          action: 'GetSelectedElements',
          title: 'GetSelectedElements',
          description: '获取当前选中构件列表',
          expected: '返回选中构件列表（GUID / 类型 / AABB）',
          params: {}
        }],
        isMutation: false,
        userIntent: text
      };
    }

    // 3. 扫描结构（ScanStructuralElements）— 注意：不含构件名(柱/墙/梁)，避免截胡 GetElementsByType
    // 构件类型查询（"查询所有柱"/"get walls"）由 mepbridge.get_elements_by_type 处理（P4-2，MEPBridge 自有）
    if (matches(['扫描', '结构', '障碍物', 'scan', 'structural', 'obstacle'])) {
      return {
        steps: [{
          action: 'ScanStructuralElements',
          title: 'ScanStructuralElements',
          description: '扫描模型结构障碍物（Wall/Column/Beam/Slab/Roof）',
          expected: '返回结构构件 AABB 列表',
          params: {}
        }],
        isMutation: false,
        userIntent: text
      };
    }

    // 4. 查询管径表（GetAvailableSizes）
    if (matches(['管径', '直径', '尺寸表', '管径表', 'pipe size', 'diameter', 'available size', 'DN20', 'DN25', 'DN32', 'DN40', 'DN50', 'DN65', 'DN80', 'DN100']) ||
        matches(['可用尺寸', '参考直径', '偏好尺寸'])) {
      return {
        steps: [{
          action: 'GetAvailableSizes',
          title: 'GetAvailableSizes',
          description: '查询可用管径表',
          expected: '返回 referenceIds + pipeSegmentTables',
          params: { domain: 'Piping' }
        }],
        isMutation: false,
        userIntent: text
      };
    }

    // 5. 查询 MEP 系统（GetAvailableSystems）
    if (matches(['系统', 'mep系统', 'piping系统', '系统列表', 'system', 'available system', 'mep system'])) {
      return {
        steps: [{
          action: 'GetAvailableSystems',
          title: 'GetAvailableSystems',
          description: '查询可用 MEP 系统',
          expected: '返回 Piping/Ventilation/CableCarrier 系统',
          params: {}
        }],
        isMutation: false,
        userIntent: text
      };
    }

    // 6. 查询属性定义（GetElementPropertyDefinitions）
    if (matches(['属性定义', '属性列表', 'property definition', 'property list', '可用属性'])) {
      return {
        steps: [{
          action: 'GetElementPropertyDefinitions',
          title: 'GetElementPropertyDefinitions',
          description: '查询选中构件可用属性定义',
          expected: '返回属性定义列表',
          params: {}
        }],
        isMutation: false,
        userIntent: text
      };
    }

    // 7. 移动构件（MoveSelectedElements）
    if (matches(['移动', '平移', 'move', 'shift', 'translate', '偏移'])) {
      // 尝试提取位移参数（支持 "x=300,y=-200,z=100" 或 "z=3000" 等格式）
      const delta = extractDelta(text);
      return {
        steps: [{
          action: 'MoveSelectedElements',
          title: 'MoveSelectedElements',
          description: `移动选中构件 delta=${JSON.stringify(delta)}`,
          expected: '返回 movedElementCount，AABB 偏移匹配',
          params: { deltaMm: delta, dryRun: true, confirmRequired: true }
        }],
        isMutation: true,
        warningText: '此操作会修改模型，需用户确认',
        userIntent: text
      };
    }

    // 8. 复制构件（CopyElements）
    if (matches(['复制', '拷贝', 'copy', 'duplicate', 'clone'])) {
      const offset = extractDelta(text);
      const targetStoryIndex = extractTargetStoryIndex(text);
      const params = { offsetMm: offset, dryRun: true, confirmRequired: true };
      if (targetStoryIndex !== null) params.targetStoryIndex = targetStoryIndex;
      return {
        steps: [{
          action: 'CopyElements',
          title: 'CopyElements',
          description: `复制选中构件 offset=${JSON.stringify(offset)}`,
          expected: '返回 createdGuids',
          params
        }],
        isMutation: true,
        warningText: '此操作会创建新构件，需用户确认',
        userIntent: text
      };
    }

    // 9. 删除构件（DeleteMEPElements）
    if (matches(['删除', '清除', '移除', 'delete', 'remove', 'erase'])) {
      return {
        steps: [{
          action: 'DeleteMEPElements',
          title: 'DeleteMEPElements',
          description: '删除选中构件',
          expected: '返回 deletedCount',
          params: { dryRun: true, confirmRequired: true }
        }],
        isMutation: true,
        warningText: '此操作不可逆，需用户确认',
        userIntent: text
      };
    }

    // 10. 创建管道（CreatePipe）— 保留原创建类，但需明确"管道"关键词
    if (matches(['创建', '新建', 'create', '新建管道', '创建管', 'create pipe', 'lay pipe'])) {
      return {
        steps: [
          {
            action: 'ScanStructuralElements',
            title: 'ScanStructuralElements',
            description: '扫描结构障碍物',
            expected: '找到约5个柱子',
            params: {}
          },
          {
            action: 'CreatePipe',
            title: 'CreatePipe',
            description: '创建管道',
            expected: '返回 GUID',
            params: { start: [0, 0, 3000], end: [5000, 0, 3000] }
          }
        ],
        isMutation: true,
        warningText: '此操作会修改模型',
        userIntent: text
      };
    }

    // 11. 创建管道系统（CreatePipeSystem）— 多步操作
    if (matches(['管道系统', '主管支管', '布管系统', '供水系统', '水系统', 'piping system', 'pipe system']) ||
        matches(['创建管道系统', '新建管道系统'])) {
      return {
        steps: [
          { action: 'ScanStructuralElements', title: 'ScanStructuralElements', description: '扫描结构障碍物', params: {} },
          { action: 'CreatePipeSystem', title: 'CreatePipeSystem', description: '创建管道系统（主管+支管）', params: {} }
        ],
        isMutation: true,
        warningText: '此操作会创建多条 MEP 管道，需用户确认',
        userIntent: text
      };
    }

    // 12. 读取管道信息（GetMEPElementInfo）— 需要 routeGuid
    if (matches(['管道信息', '管道详情', '路由信息', 'MEP信息', '读回管道', '查看管道', 'pipe info', 'route info'])) {
      return {
        steps: [{
          action: 'GetMEPElementInfo',
          title: 'GetMEPElementInfo',
          description: '读取 MEP 管道详细信息',
          params: {},
          note: '需要先选中或提供 routeGuid'
        }],
        isMutation: false,
        userIntent: text
      };
    }

    // 默认：未识别意图（不再默认 Ping，由调用方决定友好回复）
    // 2026-06-26 D5: 返回 unsupported 标记，由 generatePlan 的 buildUnrecognizedResponse 处理
    return {
      unsupported: true,
      steps: [],
      isMutation: false,
      userIntent: text
    };
  }

  // 总结执行结果
  async summarizeResult(userIntent, steps) {
    if (this.llm) {
      try {
        return await this.llm.summarizeResult(userIntent, steps);
      } catch (error) {
        console.error('[AI Adapter] Summarize failed:', error.message);
        return this.fallbackSummarize(userIntent, steps);
      }
    }

    return this.fallbackSummarize(userIntent, steps);
  }

  // 后备总结
  fallbackSummarize(userIntent, steps) {
    const successCount = steps.filter(s => s.success).length;
    const totalCount = steps.length;
    const allSuccess = successCount === totalCount;

    const keyResults = {};
    steps.forEach(step => {
      if (step.data?.guid) keyResults.guid = step.data.guid;
      if (step.data?.coords) keyResults.coords = step.data.coords;
    });

    const summary = allSuccess
      ? `✅ 操作已完成！\n完成 ${successCount}/${totalCount} 个步骤`
      : `⚠️ 部分操作失败\n完成 ${successCount}/${totalCount} 个步骤`;

    return {
      summary,
      success: allSuccess,
      key_results: keyResults,
      next_prompt: '还需要其他操作吗？'
    };
  }

  // 解密（与 llm-config.js 保持一致）
  decrypt(encryptedData) {
    return decryptLlmConfig(encryptedData);
  }

  // D.5: 从 tool-descriptors.json 匹配 nlTriggers
  // 匹配策略：先按命中质量排序，再用 mutation/read 作为同分兜底。
  matchDescriptorByText(text) {
    const lowerText = text.toLowerCase();

    const matches = [];
    const mutationLevels = ['low-mutation', 'high-mutation', 'mutation', 'create-element', 'medium-mutation', 'batch-create'];

    for (const desc of this.descriptors) {
      if (!desc.nlTriggers) continue;
      const allTriggers = [
        ...(desc.nlTriggers.zh || []),
        ...(desc.nlTriggers.en || [])
      ].map(t => t.toLowerCase());

      let bestTriggerLen = 0;
      let hitCount = 0;
      for (const trigger of allTriggers) {
        if (lowerText.includes(trigger)) {
          hitCount++;
          if (trigger.length > bestTriggerLen) bestTriggerLen = trigger.length;
        }
      }

      if (hitCount > 0) {
        const isMutation = mutationLevels.includes(desc.riskLevel);
        matches.push({ desc, hitCount, bestTriggerLen, isMutation });
      }
    }

    // 排序：命中数多的优先，平局取 trigger 最长的，平局取 MEPBridge 命名空间优先
    const namespacePriority = (ns) => {
      if (!ns) return 2;
      const lower = String(ns).toLowerCase();
      if (lower === 'mepbridge') return 3;       // MEPBridge 最高优先
      return 2;                                  // 其他（official API 等）
    };

    // 检测是否为"按类型查询构件"的意图（如 "查询所有柱"、"get walls"）
    const typeQueryPattern = /^(查询|get|query)\s*(所有|all\s+)?/i;
    const isTypeQueryIntent = typeQueryPattern.test(text.trim());
    const sortByScore = (a, b) => {
      if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
      if (b.bestTriggerLen !== a.bestTriggerLen) return b.bestTriggerLen - a.bestTriggerLen;

      // 类型查询意图下，GetElementsByType 优先于 ScanStructuralElements
      if (isTypeQueryIntent) {
        const aIsTypeQuery = a.desc.name === 'mepbridge.get_elements_by_type';
        const bIsTypeQuery = b.desc.name === 'mepbridge.get_elements_by_type';
        const aIsScanStructural = a.desc.name === 'mepbridge.scan_structural_elements';
        const bIsScanStructural = b.desc.name === 'mepbridge.scan_structural_elements';
        if (aIsTypeQuery && bIsScanStructural) return -1;
        if (bIsTypeQuery && aIsScanStructural) return 1;
      }

      const pa = namespacePriority(a.desc.commandNamespace);
      const pb = namespacePriority(b.desc.commandNamespace);
      if (a.isMutation !== b.isMutation) return a.isMutation ? -1 : 1;
      return pb - pa;
    };

    if (matches.length > 0) {
      matches.sort(sortByScore);
      return matches[0].desc;
    }

    return null;
  }

  // D.5: 从 descriptor 构建 Plan
  buildPlanFromDescriptor(desc, text, locale = 'zh-CN') {
    const commandName = desc.commandName;
    const namespace = desc.commandNamespace || 'MEPBridge';
    const isMutation = ['low-mutation', 'high-mutation', 'mutation', 'create-element', 'medium-mutation', 'batch-create'].includes(desc.riskLevel);
    const english = isEnglishUiLocale(normalizeUiLocale(locale));

    // 构建参数（基于 paramExtractors 提取）
    const params = {};
    if (desc.paramExtractors) {
      if (desc.paramExtractors.deltaMm || desc.paramExtractors.offsetMm) {
        const delta = extractDelta(text);
        const key = desc.paramExtractors.deltaMm ? 'deltaMm' : 'offsetMm';
        params[key] = delta;
      }
      if (desc.paramExtractors.targetStoryIndex) {
        const targetStoryIndex = extractTargetStoryIndex(text);
        if (targetStoryIndex !== null) params.targetStoryIndex = targetStoryIndex;
      }
      if (desc.paramExtractors.domain && desc.paramExtractors.domain.default) {
        params.domain = desc.paramExtractors.domain.default;
      }
      // 2026-06-25 新增：CreatePipe 提取 diameterMm（支持"100mm水管"、"100毫米"、"DN20" 等）
      if (desc.paramExtractors.diameterMm) {
        const dia = extractDiameterMm(text);
        if (dia !== null) params.diameterMm = dia;
      }
      // T4 新增：GetElementsByType 提取 elementType（支持"查询所有柱"、"get walls" 等）
      if (desc.paramExtractors.elementType) {
        const et = extractElementType(text);
        if (et !== null) params.elementType = et;
      }
    }

    // CreatePipe 特殊处理：若未提取到 diameterMm，使用 descriptor 默认值或契约默认 22mm
    // 避免报错 "Pipe size requires referenceId, crossSection.referenceId, diameter or diameterMm"
    if (commandName === 'CreatePipe' && params.diameterMm === undefined) {
      params.diameterMm = 22.0;  // 契约示例默认值，用户可在 UI 修改
    }

    // mutation 类命令按 C++ 契约能力补安全字段，避免 descriptor 与 Server 漂移。
    if (isMutation) {
      Object.assign(params, applyDefaultSafetyParameters(commandName, params, {
        dryRun: true,
        confirmRequired: true,
      }));
    }

    return {
      steps: [{
        action: commandName,
        title: commandName,
        description: desc.description || `${namespace}.${commandName}`,
        expected: desc.title || (english ? 'Execution succeeds' : '执行成功'),
        params: params,
        // 携带 descriptorName + commandNamespace + commandName，让 enrichPlan 能精确查找
        descriptorName: desc.name,
        commandNamespace: namespace,
        commandName: commandName,
        riskLevel: desc.riskLevel
      }],
      isMutation: isMutation,
      warningText: isMutation
        ? (desc.requiresConfirmationDefault
          ? (english ? 'This operation modifies the model and requires user confirmation.' : '此操作会修改模型，需用户确认')
          : null)
        : null,
      userIntent: text
    };
  }

  enrichPlan(plan, text, context = {}) {
    if (!plan || plan.unsupported) return plan;

    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    let hasMutation = Boolean(plan.isMutation);
    const english = isEnglishUiLocale(normalizeUiLocale(context.language));

    const enrichedSteps = steps.map((step) => {
      const action = String(step.action || step.commandName || '').trim();

      // 如果 step 已带 descriptorName，直接按 descriptorName 查找，避免 action 模糊匹配到同名 descriptor
      let desc = null;
      if (step.descriptorName) {
        desc = this.descriptors.find(d => d.name === step.descriptorName) || null;
      }
      if (!desc) {
        // 优先用 step 自带的 commandNamespace + commandName 精确查找
        const stepNs = step.commandNamespace;
        const stepCn = step.commandName;
        if (stepNs && stepCn) {
          desc = this.descriptors.find(d =>
            String(d.commandName || '').toLowerCase() === String(stepCn).toLowerCase() &&
            String(d.commandNamespace || 'MEPBridge').toLowerCase() === String(stepNs).toLowerCase()
          ) || null;
        }
      }
      if (!desc) {
        // 最后才 fallback 到 findDescriptorByAction（按 action 字符串）
        desc = this.findDescriptorByAction(action);
      }

      const commandName = desc?.commandName || step.commandName || stripCommandNamespace(action).commandName || action || 'Ping';
      const commandNamespace = desc?.commandNamespace || step.commandNamespace || stripCommandNamespace(action).commandNamespace || 'MEPBridge';
      const params = normalizeStepParams(commandName, this.applySemanticParameters(
        commandName,
        step.params || {},
        context.semanticIndex?.matches || {}
      ));
      const commandJson = step.commandJson || this.buildCommandJson(commandName, commandNamespace, params, desc);
      const isMutation = desc && ['low-mutation', 'high-mutation', 'mutation', 'create-element', 'medium-mutation', 'batch-create'].includes(desc.riskLevel);

      if (isMutation) hasMutation = true;

      return {
        ...step,
        action: commandName,
        title: step.title || commandName,
        description: step.description || desc?.description || `${commandNamespace}.${commandName}`,
        expected: step.expected || step.expectedResult || desc?.title || (english ? 'Execution succeeds' : '执行成功'),
        params,
        descriptorName: desc?.name || step.descriptorName || null,
        commandNamespace,
        commandName,
        riskLevel: desc?.riskLevel || step.riskLevel || null,
        commandJson
      };
    });

    return {
      ...plan,
      steps: enrichedSteps,
      isMutation: hasMutation,
      warningText: plan.warningText || (hasMutation
        ? (english
          ? 'This operation modifies the Archicad model and requires user confirmation.'
          : '此操作会修改 Archicad 模型，需用户确认')
        : null),
      userIntent: plan.userIntent || text
    };
  }

  applySemanticParameters(commandName, inputParams, matches = {}) {
    const params = { ...inputParams };
    const profile = matches.profiles;
    const favorite = matches.favorites;
    const layer = matches.layers;
    const classification = matches.classifications;
    const property = matches.propertyDefinitions;
    const story = matches.stories;
    const mepSystem = matches.mepSystems;

    if (profile?.guid && ['CreateWall', 'CreateColumn', 'CreateBeam'].includes(commandName) && !params.profileGuid) {
      params.profileGuid = profile.guid;
    }

    if (favorite?.name && ['GetFavorite', 'CreateFromFavorite', 'ApplyFavorite'].includes(commandName) && !params.favoriteName) {
      params.favoriteName = favorite.name;
    }

    if (layer && commandName === 'SetLayerBatch' && !params.layerGuid && !params.layerName) {
      if (layer.guid) params.layerGuid = layer.guid;
      else if (layer.name) params.layerName = layer.name;
    }

    if (classification && commandName === 'AssignClassification') {
      if (classification.systemGuid && !params.systemGuid) params.systemGuid = classification.systemGuid;
      if (classification.kind === 'item' && classification.itemGuid && !params.assignItemGuid) {
        params.assignItemGuid = classification.itemGuid;
      }
    }

    if (property && ['FindElementsByProperty', 'GetElementProperties', 'SetElementProperty', 'SetElementProperties'].includes(commandName)) {
      if (property.propertyGuid && !params.propertyGuid) params.propertyGuid = property.propertyGuid;
      if (property.groupName && !params.groupName) params.groupName = property.groupName;
      if (property.propertyName && !params.propertyName) params.propertyName = property.propertyName;
    }

    if (story && params.floorIndex === undefined && ['CreateWall', 'CreateColumn', 'CreateBeam', 'CreateSlab', 'FindElementsByProperty'].includes(commandName)) {
      const floorIndex = story.index ?? story.floorIndex;
      if (floorIndex !== undefined) params.floorIndex = floorIndex;
    }

    if (mepSystem && ['CreatePipe', 'CreateDuct', 'CreateCableCarrier', 'ChangeMEPRouteProperties'].includes(commandName)) {
      if (mepSystem.index !== undefined && params.mepSystemIndex === undefined) {
        params.mepSystemIndex = mepSystem.index;
      }
      if (mepSystem.name && !params.mepSystemName) params.mepSystemName = mepSystem.name;
    }

    return params;
  }

  findDescriptorByAction(action) {
    const parsed = stripCommandNamespace(action);
    const normalized = String(action || '').toLowerCase();
    const commandName = parsed.commandName.toLowerCase();
    const commandNamespace = parsed.commandNamespace?.toLowerCase();

    return this.descriptors.find((desc) => {
      if (String(desc.name || '').toLowerCase() === normalized) return true;
      if (String(desc.commandName || '').toLowerCase() !== commandName) return false;
      if (commandNamespace && String(desc.commandNamespace || 'MEPBridge').toLowerCase() !== commandNamespace) return false;
      return true;
    }) || null;
  }

  buildCommandJson(commandName, commandNamespace, params, desc) {
    const baseCommand = desc?.commandJson
      ? clone(desc.commandJson)
      : {
          command: 'API.ExecuteAddOnCommand',
          parameters: {
            addOnCommandId: {
              commandNamespace,
              commandName
            },
            addOnCommandParameters: {}
          }
        };

    if (baseCommand.command === 'API.ExecuteAddOnCommand') {
      const currentParams = baseCommand.parameters?.addOnCommandParameters || {};
      baseCommand.parameters = baseCommand.parameters || {};
      baseCommand.parameters.addOnCommandId = baseCommand.parameters.addOnCommandId || {
        commandNamespace,
        commandName
      };
      baseCommand.parameters.addOnCommandParameters = normalizeStepParams(commandName, {
        ...currentParams,
        ...params
      });
    } else {
      baseCommand.parameters = {
        ...(baseCommand.parameters || {}),
        ...params
      };
    }

    return baseCommand;
  }
}

function stripCommandNamespace(action) {
  const raw = String(action || '').trim();
  if (!raw) return { commandNamespace: null, commandName: '' };
  if (!raw.includes('.')) return { commandNamespace: null, commandName: raw };
  const [commandNamespace, ...rest] = raw.split('.');
  return { commandNamespace, commandName: rest.join('.') };
}

function normalizeStepParams(commandName, params) {
  const normalized = clone(params || {});

  if (commandName === 'CreatePipe') {
    if (!Array.isArray(normalized.waypoints) && normalized.start && normalized.end) {
      normalized.waypoints = [normalizePoint(normalized.start), normalizePoint(normalized.end)];
      delete normalized.start;
      delete normalized.end;
    } else if (Array.isArray(normalized.waypoints)) {
      normalized.waypoints = normalized.waypoints.map(normalizePoint);
    }
  }

  return normalizeCommandSafetyParameters(commandName, normalized);
}

function normalizePoint(point) {
  let x;
  let y;
  let z;

  if (Array.isArray(point)) {
    [x, y, z] = point;
  } else {
    ({ x, y, z } = point || {});
  }

  const values = [Number(x || 0), Number(y || 0), Number(z || 0)];
  const looksLikeMillimeters = values.some((value) => Math.abs(value) > 100);
  const divisor = looksLikeMillimeters ? 1000 : 1;

  return {
    x: values[0] / divisor,
    y: values[1] / divisor,
    z: values[2] / divisor
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

// LLM 调用失败的可读归因。
//
// 为什么要分类而不是直接抛 error.message：LLM 不可用时本地降级仍能给出计划，
// 于是用户只感觉到「等了很久」，看不出是密钥失效、超时还是网络不通——
// 会一直误以为 LLM 在正常工作。原因必须回传到 UI。
//
// 措辞原则（维护者 2026-09-03 定）：**给出可自行处理的动作**，而不是只说「已降级」。
// LLM 不可用是配置或网络问题，用户能修；说清哪一项坏了、去哪儿改，比强调兜底更有用。
// 每条 zh/en 都必须含一句用户能照做的处置建议。
function describeLlmFailure(error, llm) {
  const provider = llm && llm.provider ? llm.provider : 'unknown';
  const model = llm && llm.model ? llm.model : 'unknown';
  const status = error && error.response ? error.response.status : null;
  const code = error && error.code ? error.code : null;
  const timeoutMs = llm && Number.isFinite(Number(llm.planTimeoutMs)) ? Number(llm.planTimeoutMs) : null;
  const timeoutText = timeoutMs ? `${Math.round(timeoutMs / 1000)} 秒` : '超时时限';
  const timeoutTextEn = timeoutMs ? `${Math.round(timeoutMs / 1000)}s` : 'the timeout';
  const fallbackZh = '本次已用本地命令匹配给出计划，可直接执行。';
  const fallbackEn = 'This request was answered by local command matching, so the plan is still usable.';

  let reason = 'unknown';
  let zh = `${provider} 调用失败`;
  let en = `The ${provider} call failed`;

  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout|aborted/i.test(error.message || '')) {
    reason = 'timeout';
    zh = `LLM 未响应：${provider} / ${model} 在 ${timeoutText}内没有返回。`
      + `请检查网络能否访问该服务、模型名是否正确，或在「LLM 配置」中换一个更快的模型。${fallbackZh}`;
    en = `The LLM did not respond: ${provider} / ${model} returned nothing within ${timeoutTextEn}. `
      + `Check that the service is reachable and the model name is correct, or pick a faster model in LLM settings. ${fallbackEn}`;
  } else if (status === 401 || status === 403) {
    reason = 'auth';
    zh = `LLM 凭据被拒（HTTP ${status}）：${provider} 不接受当前 API Key。`
      + `请在「LLM 配置」中重新填写有效的 API Key 并保存。${fallbackZh}`;
    en = `The LLM rejected the credentials (HTTP ${status}): ${provider} did not accept the current API key. `
      + `Enter a valid API key in LLM settings and save. ${fallbackEn}`;
  } else if (status === 429) {
    reason = 'rate-limit';
    zh = `LLM 触发限流（HTTP 429）：${provider} 暂时拒绝了请求。`
      + `请稍后重试，或在服务商后台确认配额与计费状态。${fallbackZh}`;
    en = `The LLM rate-limited the request (HTTP 429): ${provider} temporarily refused it. `
      + `Retry later, or check your quota and billing status with the provider. ${fallbackEn}`;
  } else if (status === 404 || (/model/i.test(error.message || '') && status >= 400)) {
    reason = 'model';
    zh = `LLM 模型不存在（HTTP ${status}）：${provider} 不认识模型「${model}」。`
      + `请在「LLM 配置」中改为该服务商实际提供的模型名。${fallbackZh}`;
    en = `The LLM model was not found (HTTP ${status}): ${provider} does not recognise "${model}". `
      + `Change it in LLM settings to a model this provider actually offers. ${fallbackEn}`;
  } else if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN') {
    reason = 'network';
    zh = `无法连接 LLM 服务（${code}）：连不上 ${provider}。`
      + `请检查网络、代理设置，以及「LLM 配置」里的服务地址是否正确。${fallbackZh}`;
    en = `Could not reach the LLM service (${code}): ${provider} is unreachable. `
      + `Check your network, proxy settings, and the endpoint in LLM settings. ${fallbackEn}`;
  } else if (status >= 500) {
    reason = 'provider-error';
    zh = `LLM 服务端故障（HTTP ${status}）：${provider} 自身报错，非本地配置问题。`
      + `请稍后重试或查看服务商状态页。${fallbackZh}`;
    en = `The LLM service failed (HTTP ${status}): the error came from ${provider}, not from local configuration. `
      + `Retry later or check the provider's status page. ${fallbackEn}`;
  } else {
    zh = `LLM 调用失败：${provider} 返回「${error.message}」。`
      + `请在「LLM 配置」中核对服务地址、API Key 与模型名。${fallbackZh}`;
    en = `The LLM call failed: ${provider} returned "${error.message}". `
      + `Verify the endpoint, API key and model name in LLM settings. ${fallbackEn}`;
  }

  return {
    failed: true,
    reason,
    provider,
    model,
    httpStatus: status,
    code,
    timeoutMs,
    detail: error.message,
    // UI 可据此把提示渲染为「需用户处理」而非普通信息
    userActionRequired: true,
    messageZh: zh,
    messageEn: en
  };
}

function attachLlmFailure(plan, llmFailure) {
  if (!plan || !llmFailure) return plan;
  return { ...plan, llmFailure };
}

module.exports = new AIAdapter();
