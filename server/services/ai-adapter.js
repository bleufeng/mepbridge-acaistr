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

    // V2 H3.3: 注入执行历史到 context（LLM 感知之前的操作）
    if (hasLLM && this.executionHistory.length > 0 && !context.history) {
      context.history = this.getHistorySummary();
    }

    if (hasLLM) {
      // ─── LLM 优先路径 ───
      // L1: LLM 语义理解（systemPrompt 已从 descriptors 自动生成）
      try {
        const plan = await this.llm.generatePlan(text, context);
        if (plan && plan.steps && plan.steps.length > 0) {
          // LLM 命中：低置信度时仍降级到本地匹配（避免幻觉）
          if (plan.confidence !== undefined && plan.confidence < 0.5) {
            console.log(`[AI Adapter] LLM low confidence (${plan.confidence}), falling back to descriptor matching`);
          } else {
            console.log('[AI Adapter] LLM generated plan successfully');
            return this.enrichPlan(plan, text, context);
          }
        }
      } catch (error) {
        console.error('[AI Adapter] LLM call failed:', error.message);
      }

      // L2: descriptor nlTriggers 匹配（LLM 失败/降级时使用）
      const descriptorMatch = this.matchDescriptorByText(text);
      if (descriptorMatch) {
        console.log(`[AI Adapter] NL matched descriptor (after LLM): ${descriptorMatch.name}`);
        const plan = this.buildPlanFromDescriptor(descriptorMatch, text, context.language);
        return this.enrichPlan(plan, text, context);
      }

      // L3: fallback 硬编码
      const fallbackPlan = this.fallbackGeneratePlan(text, context);
      if (fallbackPlan && !fallbackPlan.unsupported) {
        return this.enrichPlan(fallbackPlan, text, context);
      }

      // L4: 无法识别 → 友好回复
      return this.buildUnrecognizedResponse(text, context.language);
    }

    // ─── 无 LLM 路径（跳过 LLM 语义理解） ───
    // L1: descriptor nlTriggers 匹配（纯本地，<5ms）
    const descriptorMatch = this.matchDescriptorByText(text);
    if (descriptorMatch) {
      console.log(`[AI Adapter] NL matched descriptor (no-LLM mode): ${descriptorMatch.name}`);
      const plan = this.buildPlanFromDescriptor(descriptorMatch, text, context.language);
      return this.enrichPlan(plan, text, context);
    }

    // L2: fallback 硬编码
    const fallbackPlan = this.fallbackGeneratePlan(text, context);
    if (fallbackPlan && !fallbackPlan.unsupported) {
      return this.enrichPlan(fallbackPlan, text, context);
    }

    // L3: 无法识别 → 友好回复
    return this.buildUnrecognizedResponse(text, context.language);
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
      return {
        steps: [{
          action: 'CopyElements',
          title: 'CopyElements',
          description: `复制选中构件 offset=${JSON.stringify(offset)}`,
          expected: '返回 createdGuids',
          params: { offsetMm: offset, dryRun: true, confirmRequired: true }
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
      const params = normalizeStepParams(commandName, step.params || {});
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

// D.2 辅助：从自然语言提取位移参数
// 支持 "x=300,y=-200,z=100"、"z=3000"、"往上抬200"、"向下1000mm" 等格式
function extractDiameterMm(text) {
  // 匹配 "100mm"、"100毫米"、"100 mm"、"直径100"、"DN100"、"100mm水管" 等
  // 1. DN100 / DN20 等公称直径
  const dnMatch = text.match(/DN\s*(\d+(?:\.\d+)?)/i);
  if (dnMatch) return parseFloat(dnMatch[1]);

  // 2. "直径100mm" / "直径100" / "diameter 100mm"
  const diaMatch = text.match(/(?:直径|diameter)\s*(\d+(?:\.\d+)?)\s*(mm|毫米)?/i);
  if (diaMatch) return parseFloat(diaMatch[1]);

  // 3. "100mm水管" / "100毫米管" / "100mm pipe"（数字后跟 mm/毫米 且前后有管/pipe 语义）
  const mmMatch = text.match(/(\d+(?:\.\d+)?)\s*(mm|毫米)\s*(?:水管|管道|管|pipe|tube)?/i);
  if (mmMatch) return parseFloat(mmMatch[1]);

  return null;
}

// 从自然语言提取 Archicad 构件类型（用于 GetElementsByType）
// 支持 "查询所有墙"、"所有柱"、"列出梁"、"get walls"、"columns" 等
function extractElementType(text) {
  const lowerText = text.toLowerCase();

  // 中英文构件类型映射表
  const typeMap = [
    { type: 'Wall',       zh: ['墙', '墙体', '墙构件'] },
    { type: 'Column',     zh: ['柱', '柱子', '柱构件'] },
    { type: 'Beam',       zh: ['梁', '梁构件'] },
    { type: 'Slab',       zh: ['板', '楼板', '板构件'] },
    { type: 'Roof',       zh: ['屋顶', '屋面'] },
    { type: 'Window',     zh: ['窗', '窗户'] },
    { type: 'Door',       zh: ['门'] },
    { type: 'Object',     zh: ['对象', '物件', '家具'] },
    { type: 'Lamp',       zh: ['灯', '灯具'] },
    { type: 'Mesh',       zh: ['网格', '地形'] },
    { type: 'Zone',       zh: ['区域', '房间'] },
    { type: 'CurtainWall', zh: ['幕墙'] },
    { type: 'Shell',      zh: ['壳体'] },
    { type: 'Skylight',   zh: ['天窗'] }
  ];

  // 英文匹配（单复数）
  const enMap = [
    { type: 'Wall',       en: ['wall', 'walls'] },
    { type: 'Column',     en: ['column', 'columns'] },
    { type: 'Beam',       en: ['beam', 'beams'] },
    { type: 'Slab',       en: ['slab', 'slabs'] },
    { type: 'Roof',       en: ['roof', 'roofs'] },
    { type: 'Window',     en: ['window', 'windows'] },
    { type: 'Door',       en: ['door', 'doors'] },
    { type: 'Object',     en: ['object', 'objects'] },
    { type: 'Lamp',       en: ['lamp', 'lamps'] },
    { type: 'Mesh',       en: ['mesh', 'meshes'] },
    { type: 'Zone',       en: ['zone', 'zones'] },
    { type: 'CurtainWall', en: ['curtainwall', 'curtain wall'] },
    { type: 'Shell',      en: ['shell', 'shells'] },
    { type: 'Skylight',   en: ['skylight', 'skylights'] }
  ];

  // 1. 中文匹配
  for (const item of typeMap) {
    for (const zh of item.zh) {
      if (text.includes(zh)) return item.type;
    }
  }

  // 2. 英文匹配（词边界）
  for (const item of enMap) {
    for (const en of item.en) {
      const regex = new RegExp(`\\b${en}\\b`, 'i');
      if (regex.test(lowerText)) return item.type;
    }
  }

  return null;
}

// F.3.3 新增：从自然语言提取管道路径点
// 支持 "从(0,0,3)到(5,0,3)"、"起点(0,0,3) 终点(5,0,3)"、"A点到B" 等格式
function extractWaypoints(text) {
  // 1. "从...到..." 格式 — 支持括号和逗号分隔坐标
  const fromToMatch = text.match(/从\s*[\[（(]?\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[\]）)]?\s*到\s*[\[（(]?\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[\]）)]?/);
  if (fromToMatch) {
    return {
      waypoints: [
        { x: parseFloat(fromToMatch[1]), y: parseFloat(fromToMatch[2]), z: parseFloat(fromToMatch[3]) },
        { x: parseFloat(fromToMatch[4]), y: parseFloat(fromToMatch[5]), z: parseFloat(fromToMatch[6]) }
      ],
      start: { x: parseFloat(fromToMatch[1]), y: parseFloat(fromToMatch[2]), z: parseFloat(fromToMatch[3]) },
      end: { x: parseFloat(fromToMatch[4]), y: parseFloat(fromToMatch[5]), z: parseFloat(fromToMatch[6]) }
    };
  }

  // 2. "起点...终点..." 格式
  const startEndMatch = text.match(/起点\s*[\[（(]?\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[\]）)]?\s*终点\s*[\[（(]?\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[,\s，]\s*(-?[\d.]+)\s*[\]）)]?/);
  if (startEndMatch) {
    return {
      waypoints: [
        { x: parseFloat(startEndMatch[1]), y: parseFloat(startEndMatch[2]), z: parseFloat(startEndMatch[3]) },
        { x: parseFloat(startEndMatch[4]), y: parseFloat(startEndMatch[5]), z: parseFloat(startEndMatch[6]) }
      ],
      start: { x: parseFloat(startEndMatch[1]), y: parseFloat(startEndMatch[2]), z: parseFloat(startEndMatch[3]) },
      end: { x: parseFloat(startEndMatch[4]), y: parseFloat(startEndMatch[5]), z: parseFloat(startEndMatch[6]) }
    };
  }

  return null;
}

function extractDelta(text) {
  const delta = { x: 0, y: 0, z: 0 };
  const lowerText = text.toLowerCase();

  // 匹配 "x=数字"、"x:数字"、"x  数字" 等
  const axisPatterns = [
    { axis: 'x', regex: /x\s*[=:：]?\s*(-?\d+(?:\.\d+)?)/i },
    { axis: 'y', regex: /y\s*[=:：]?\s*(-?\d+(?:\.\d+)?)/i },
    { axis: 'z', regex: /z\s*[=:：]?\s*(-?\d+(?:\.\d+)?)/i }
  ];
  axisPatterns.forEach(({ axis, regex }) => {
    const m = text.match(regex);
    if (m) delta[axis] = parseFloat(m[1]);
  });

  // 方向语义：上/下/左/右/前/后
  // 上/下 → z 轴；左/右 → x 轴；前/后 → y 轴
  if (!axisPatterns.some(({ regex }) => regex.test(text))) {
    const numMatch = text.match(/(-?\d+(?:\.\d+)?)\s*(mm|毫米)?/i);
    const num = numMatch ? parseFloat(numMatch[1]) : 0;
    if (num !== 0) {
      if (lowerText.includes('上') || lowerText.includes('up') || lowerText.includes('抬高')) delta.z = Math.abs(num);
      else if (lowerText.includes('下') || lowerText.includes('down') || lowerText.includes('降低')) delta.z = -Math.abs(num);
      else if (lowerText.includes('左') || lowerText.includes('left')) delta.x = -Math.abs(num);
      else if (lowerText.includes('右') || lowerText.includes('right')) delta.x = Math.abs(num);
      else if (lowerText.includes('前') || lowerText.includes('forward')) delta.y = Math.abs(num);
      else if (lowerText.includes('后') || lowerText.includes('backward')) delta.y = -Math.abs(num);
    }
  }

  return delta;
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

module.exports = new AIAdapter();
