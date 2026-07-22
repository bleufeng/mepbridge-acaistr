const axios = require('axios');

// OpenAI 兼容 provider 的默认完整 endpoint
const DEFAULT_OPENAI_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions'
};

const DEFAULT_ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

// 归一化 OpenAI 兼容 endpoint：
// 用户常填 https://api.deepseek.com 或 https://api.openai.com/v1，
// 但实际请求需要 .../v1/chat/completions
function normalizeOpenAiEndpoint(endpoint, provider) {
  if (!endpoint || !endpoint.trim()) {
    return DEFAULT_OPENAI_ENDPOINTS[provider] || DEFAULT_OPENAI_ENDPOINTS.openai;
  }
  let url = endpoint.trim().replace(/\/+$/, ''); // 去掉尾部斜杠
  // 已含完整路径
  if (/\/chat\/completions$/.test(url)) return url;
  // 已含 /v1
  if (/\/v1$/.test(url)) return url + '/chat/completions';
  // 已含 /v1/
  if (/\/v1\/?$/.test(url)) return url.replace(/\/+$/, '') + '/chat/completions';
  // 仅域名，补全 /v1/chat/completions
  return url + '/v1/chat/completions';
}

// 归一化 Anthropic endpoint：补全 /v1/messages
function normalizeAnthropicEndpoint(endpoint) {
  if (!endpoint || !endpoint.trim()) return DEFAULT_ANTHROPIC_ENDPOINT;
  let url = endpoint.trim().replace(/\/+$/, '');
  if (/\/messages$/.test(url)) return url;
  if (/\/v1$/.test(url)) return url + '/messages';
  return url + '/v1/messages';
}

class LLMAdapter {
  constructor(config) {
    this.provider = config.provider; // anthropic | openai | deepseek | custom
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint;
    this.model = config.model;
    // D5: 持有 descriptors 引用，用于自动生成 systemPrompt
    this.descriptors = config.descriptors || [];
  }

  // 生成操作计划
  async generatePlan(text, context = {}) {
    const language = context.language || 'zh-CN';
    const systemPrompt = this.getSystemPrompt(language, context);
    const userPrompt = this.getUserPrompt(text, context);

    let response;
    switch(this.provider) {
      case 'anthropic':
        response = await this.callAnthropicAPI(systemPrompt, userPrompt);
        break;
      case 'openai':
      case 'deepseek':
        response = await this.callOpenAICompatibleAPI(systemPrompt, userPrompt);
        break;
      case 'custom':
        response = await this.callCustomAPI(systemPrompt, userPrompt);
        break;
      default:
        throw new Error(`Unsupported provider: ${this.provider}`);
    }

    return this.parseResponse(response);
  }

  // V2 H4.2: 视觉验证 — 真 PNG 截图 + 多模态 vision API
  // 当 viewportSnapshot 含 imageBase64 时走 vision 多模态调用，让 LLM 真正看图判断
  // 否则退回原 text 模式（基于结构化 AABB 数据）
  async visualVerify(step, viewportSnapshot) {
    if (!this.apiKey) return null;

    const hasImage = !!(viewportSnapshot && viewportSnapshot.imageBase64);
    const verifyPrompt = `你是 Archicad 视觉验证助手。刚刚执行了如下操作：

**执行的步骤**: ${step.action} (${step.title || step.description || ''})
**预期结果**: ${step.expected || step.expectedResult || '未指定'}

**执行后视口快照数据**:
- 视图类型: ${viewportSnapshot?.viewType || '未知'}
- 当前楼层: ${viewportSnapshot?.storyName || '未知'} (索引${viewportSnapshot?.storyIndex ?? '?'}, 标高${viewportSnapshot?.storyLevel ?? '?'}m)
- 可见元素: ${viewportSnapshot?.elementCount ?? 0} 个
- 整体范围: ${viewportSnapshot?.bounds ? `X[${viewportSnapshot.bounds.xMin},${viewportSnapshot.bounds.xMax}] Y[${viewportSnapshot.bounds.yMin},${viewportSnapshot.bounds.yMax}]` : '无'}
${hasImage ? `\n**附真 PNG 截图（请仔细看图判断）**: 视口截图大小 ${viewportSnapshot.imageSize} bytes` : ''}

请${hasImage ? '结合截图和结构化数据' : '基于结构化数据'}判断：
1. 执行结果是否符合预期？
2. 是否存在位置错误/尺寸错误/碰撞/异常？
3. 如果有问题，给出修正建议。

返回严格 JSON：
{
  "approved": true/false,
  "issues": ["问题1", "问题2"],
  "suggestions": ["修正建议1", "修正建议2"],
  "confidence": 0.0-1.0
}

如果approved=true，issues和suggestions为空数组。`;

    try {
      let response;
      const systemPrompt = '你是 Archicad 视觉验证专家，负责判断建模操作结果是否正确。只返回JSON。';

      if (hasImage) {
        // H4.2 真多模态 vision API 调用
        console.log('[LLM][H4.2] Calling multimodal vision API (PNG included)');
        switch (this.provider) {
          case 'anthropic':
            response = await this.callAnthropicVisionAPI(systemPrompt, verifyPrompt, viewportSnapshot.imageBase64);
            break;
          case 'openai':
          case 'deepseek':
          case 'custom':
            response = await this.callOpenAIVisionAPI(systemPrompt, verifyPrompt, viewportSnapshot.imageBase64);
            break;
          default:
            // 不支持的 provider，退回 text 模式
            response = await this.callOpenAICompatibleAPI(systemPrompt, verifyPrompt);
        }
      } else {
        // 无图片，走原 text 模式
        switch (this.provider) {
          case 'anthropic':
            response = await this.callAnthropicAPI(systemPrompt, verifyPrompt);
            break;
          case 'openai':
          case 'deepseek':
            response = await this.callOpenAICompatibleAPI(systemPrompt, verifyPrompt);
            break;
          default:
            return null;
        }
      }

      const parsed = this.parseResponse(response);
      return {
        approved: parsed.approved !== false,
        issues: parsed.issues || [],
        suggestions: parsed.suggestions || [],
        confidence: parsed.confidence || 0.5,
        verifiedWithImage: hasImage
      };
    } catch (error) {
      console.error('[LLM][H4.2] Visual verify failed:', error.message);
      return null;
    }
  }
  // FO-3 (2026-06-26): 新增 context 参数，注入当前选择集信息
  getSystemPrompt(context = {}) {
    // D5: 优先从 descriptors 动态生成（覆盖所有 23+ 命令）
    if (this.descriptors && this.descriptors.length > 0) {
      const dynamicPrompt = this.buildSystemPromptFromDescriptors(context);
      if (dynamicPrompt) return dynamicPrompt;
    }
    // 兜底：旧版硬编码 prompt（仅含 8 条命令，已过时）
    return this.getLegacySystemPrompt(context);
  }

  // D5: 从 descriptors 自动生成 system prompt
  // FO-3 (2026-06-26): 新增 context 参数，注入选择集上下文
  // 优势：新增命令只需更新 tool-descriptors.json，无需手动维护 prompt
  buildSystemPromptFromDescriptors(context = {}) {
    if (!this.descriptors || this.descriptors.length === 0) return null;

    // 按 riskLevel 分组
    const readCmds = [];
    const mutationCmds = [];

    for (const desc of this.descriptors) {
      if (!desc.commandName) continue;
      const isMutation = ['low-mutation', 'high-mutation', 'mutation', 'create-element', 'medium-mutation', 'batch-create'].includes(desc.riskLevel);
      const entry = this.formatDescriptorForPrompt(desc);
      if (isMutation) mutationCmds.push(entry);
      else readCmds.push(entry);
    }

    // FO-3: 构建选择集上下文段落
    let selectionSection = '';
    const sel = context?.selection;
    if (sel && sel.count > 0) {
      const typeLines = sel.types.map(t => `  - ${t.type}: ${t.count} 个`).join('\n');
      const guidList = sel.guids.slice(0, 20).join(', ');
      const guidNote = sel.guids.length > 20 ? `... (共 ${sel.guids.length} 个，仅显示前 20)` : '';
      selectionSection = `\n## 当前选择集状态（实时感知）\n\n` +
        `- **选中数量**: ${sel.count} 个构件\n` +
        `- **类型分布**:\n${typeLines}\n` +
        `- **GUID 列表**: [${guidList}${guidNote}]\n\n` +
        `**重要**: 用户说"选中"/"这些"/"它们"/"移动/复制/删除"等时，默认指代上述选择集中的构件。` +
        `若用户指令涉及对选中元素的操作，应优先生成针对选择集的命令（如 MoveSelectedElements、CopyElements），而非要求用户额外指定 GUID。\n`;
    } else if (sel && sel.count === 0) {
      selectionSection = '\n## 当前选择集状态（实时感知）\n\n- **选中数量**: 0（无选中构件）\n\n**注意**: 若用户意图操作"选中元素"，请提示用户先在 Archicad 中选中目标构件。\n';
    }

    // V2 H3.3: 注入执行历史段落
    let historySection = '';
    if (context?.history) {
      historySection = context.history;
    }

    // V2 H3.1: 注入模型快照段落
    let modelSection = '';
    if (context?.modelSnapshot) {
      modelSection = `\n## 当前模型状态（H3.1 快照）\n${context.modelSnapshot}\n\n**重要**: 根据当前模型已有构件做上下文感知决策。如已有墙可在其上开门洞；已有管道可延伸或修改。\n`;
    }

    // V2 H3.2 + H3.4: 注入项目上下文段落（楼层/视图/项目设置/单位）
    let projectSection = '';
    if (context?.projectContext) {
      projectSection = `\n## 项目上下文（H3.2 楼层 + H3.4 项目设置）\n${context.projectContext}\n\n**重要**: 建墙/布管时参考楼层标高定位 z 坐标；项目单位为 mm，LLM 输出统一用米(m)。如用户说"一楼"/"二层"，根据楼层列表选择对应 floorIndex。\n`;
    }

    // V2 H8.4: 注入领域知识库段落（建筑规范+MEP标准+材料规格，按任务类型动态注入）
    let knowledgeSection = '';
    try {
      const knowledgeBase = require('./knowledge-base');
      knowledgeSection = knowledgeBase.buildKnowledgeSection(context);
    } catch (e) {
      console.log('[LLM][H8.4] Knowledge base injection skipped:', e.message);
    }

    // V2 H9.2 + H9.3: 注入学习记忆段落（用户纠正记录 + 模式学习）
    let learningSection = '';
    try {
      const learningMemory = require('./learning-memory');
      const correctionsSummary = learningMemory.getCorrectionsSummary(context);
      const patternSuggestions = learningMemory.getPatternSuggestions(context);
      learningSection = correctionsSummary + patternSuggestions;
    } catch (e) {
      console.log('[LLM][H9.2] Learning memory injection skipped:', e.message);
    }

    return `你是 MEPBridge AI 建模助手，负责解析用户的建筑/MEP 操作需求，通过 CAD-CoT（建模思维链）推理生成结构化操作计划。

${selectionSection}${historySection}${modelSection}${projectSection}${knowledgeSection}${learningSection}
## 可用命令（自动从 tool-descriptors.json 生成，共 ${this.descriptors.length} 个）

### 查询类命令（read，不修改模型）
${readCmds.join('\n')}

### 修改类命令（mutation，会修改模型，需用户确认）
${mutationCmds.join('\n')}

## CAD-CoT 建模思维链（核心推理策略）

收到用户需求后，先在内心按以下思维链推理，再输出最终 JSON：

### 第1步：意图分类
- 单元素创建（建一面墙/柱/梁/板/门/窗/屋顶）
- 多元素组合（建一个房间/楼层/三居室 → 墙→门窗洞口→屋顶→MEP管线）
- 变换操作（旋转/镜像/移动选中）
- 查询操作（扫描/读取/获取信息）
- MEP 管线（创建管道/风管/桥架）
- **MEP 自动布置**（给房间/卫生间/厨房布管 → 需房间功能识别+标准配置）

### 第2步：空间布局推理（创建类任务必做）
- 确定坐标系：Archicad 模型坐标，单位米，原点(0,0)
- 推算各构件角点坐标：根据尺寸和位置关系计算
- 确认创建顺序：先主体结构（墙/柱/梁/板），再 MEP 管线

### 第3步：模糊参数推断（用户未给精确值时）
建筑常识尺寸字典：
- 标准卧室: 3.3m × 3.6m，层高 2.8m
- 主卧: 3.6m × 4.2m，层高 2.8m
- 客厅: 4.2m × 5.4m，层高 3.0m
- 卫生间: 1.8m × 2.4m，层高 2.6m
- 厨房: 2.1m × 3.0m，层高 2.8m
- 走廊: 1.2m 宽
- 标准墙厚: 外墙 0.24m，内墙 0.12m
- 标准柱: 0.4m × 0.4m
- 标准梁: 宽 0.24m × 高 0.4m
- 给水管径: 住宅进水 DN25，分支 DN20
- 排水管径: 主管 DN100，支管 DN50

### 第4步：房间功能识别 + MEP 标准布置（MEP 任务核心）

当用户要求"根据房间布置 MEP"/"布管线"/"给卫生间布管"时，先根据模型快照或用户描述识别房间功能，再按标准配置自动生成 MEP 构件：

**房间功能识别规则**（按面积和比例推断）：
- 4-8㎡ + 靠近厨房 → 卫生间
- 4-8㎡ + 有给水点 → 厨房
- 15-25㎡ + 朝南 → 客厅
- 10-15㎡ → 卧室
- 25-40㎡ → 主卧/大客厅

**各功能房间 MEP 标准配置**：

| 房间功能 | 给水(Water) | 排水(Water) | 通风(Ventilation) | 电气(Electrical) |
|---------|-------------|-------------|-------------------|------------------|
| 卫生间 | DN20 冷热水管沿墙距地0.8m，预留淋浴/洗手台/马桶接口 | DN100 排水主管+DN50 支管 | 排风管 150×150mm，换气扇 | DN20 桥架走顶 |
| 厨房 | DN20 冷水管沿墙距地0.5m，水槽接口 | DN50 排水支管 | 排油烟管 200×200mm | DN25 桥架走顶（含插座回路） |
| 客厅 | 无 | 无 | 无 | DN25 桥架走顶（照明+空调+插座） |
| 卧室 | 无 | 无 | 无 | DN20 桥架走顶（照明+插座） |

**MEP 管线坐标计算规则**：
- 给水管：沿房间内墙底部布置，距地 0.5-0.8m（卫生间0.8m/厨房0.5m），管中心距墙面 0.05m
- 排水管：沿房间内墙底部，距地 0.3m（重力坡度 2%），管中心距墙面 0.1m
- 通风管：沿房间顶部，距地 (层高-0.3m)，居中布置
- 电气桥架：沿房间顶部，距地 (层高-0.2m)，靠墙布置

**MEP 自动布置推理示例**：
用户: "给卫生间布管"
模型快照: 已有卫生间 1.8m×2.4m，墙体 AABB 范围 (5.0,3.0)-(6.8,5.4)，层高2.6m
推理:
1. 识别为卫生间功能（面积4.32㎡，小房间）
2. 给水: 沿南墙(5.0,3.0)-(6.8,3.0)距地0.8m → waypoints [{5.05,3.05,0.8},{6.75,3.05,0.8}] DN20
3. 排水: 沿北墙(5.0,5.4)-(6.8,5.4)距地0.3m → waypoints [{5.1,5.3,0.3},{6.7,5.3,0.3}] DN100
4. 通风: 顶部居中距地2.3m → waypoints [{5.9,3.0,2.3},{5.9,5.4,2.3}] 150×150mm
5. 电气: 顶部靠墙距地2.4m → waypoints [{5.05,3.0,2.4},{5.05,5.4,2.4}] DN20桥架

### 第5步：多步分解（复杂目标必做）
将高层目标分解为有序步骤：
- "建一个3×4房间" → 4面墙（南墙→东墙→北墙→西墙），每面墙计算起止坐标
- "建一个三居室" → 先外围墙→内隔墙→门窗洞→MEP管线
- "给卫生间布管" → 识别功能→计算坐标→给水管→排水管→通风管→电气桥架
- 每步要有明确的 action + 精确 params

## 返回格式

必须返回严格的 JSON 格式：
{
  "steps": [
    {
      "action": "命令名称",
      "commandNamespace": "MEPBridge",
      "description": "步骤描述（中文，面向用户）",
      "expected": "预期结果（中文）",
      "params": {}
    }
  ],
  "isMutation": true/false,
  "warningText": "警告文本（可选，仅 mutation 时）",
  "userIntent": "用户意图总结（中文）",
  "reasoning": "CAD-CoT 推理过程简述（中文，说明空间布局和坐标推算逻辑）",
  "confidence": 0.0~1.0
}

## 规则

1. **命令选择**: 严格使用上面列出的命令名称。如果用户意图无法匹配任何命令，返回 {"steps":[], "confidence": 0.0, "userIntent": "未识别"}
2. **坐标单位**: MoveSelectedElements/Rotate/Mirror 用当前选择集；CreatePipe/Duct/CableCarrier 的 waypoints 用 3D 坐标(米)；CreateWall 用 start/end 二维 {x,y}(米)，thickness/height 为米；CreateColumn 用 position {x,y}(米)+height(米)；CreateSlab/CreateRoof 用 polygon/vertices 顶点数组 [{x,y}](米)；CreateDoor/CreateWindow 需 owner(墙GUID)+width+height+refPos(米)
3. **mutation 判断**: 所有 Create*、Move*、Edit*、Delete*、Copy*、Rotate*、Mirror* 为 mutation
4. **步骤顺序**: 复杂操作先查询/扫描，再执行，最后读回验证
5. **参数提取**: 从用户输入中提取具体数值；未给值时用尺寸字典推断
6. **类型查询**: "查询所有柱/墙/梁" 应使用 MEPBridge.GetElementsByType，参数 elementType=Wall/Column/Beam 等
7. **confidence**: 高(>0.7)明确匹配，中(0.5~0.7)部分匹配，低(<0.5)不确定
8. **reasoning**: 创建类任务必须填写推理过程，说明坐标如何计算

## 示例

用户: "创建一根从(0,0,3000)到(5000,0,3000)的管道"
返回:
{
  "steps": [
    {
      "action": "ScanStructuralElements",
      "commandNamespace": "MEPBridge",
      "description": "扫描路径上的结构障碍物",
      "expected": "确认无阻挡",
      "params": {}
    },
    {
      "action": "CreatePipe",
      "commandNamespace": "MEPBridge",
      "description": "创建管道",
      "expected": "返回新管道的 GUID",
      "params": {
        "waypoints": [{"x": 0, "y": 0, "z": 3}, {"x": 5, "y": 0, "z": 3}],
        "diameterMm": 22
      }
    }
  ],
  "isMutation": true,
  "warningText": "此操作会在模型中创建新的管道元素",
  "userIntent": "创建一根从 (0,0,3000) 到 (5000,0,3000) 的管道",
  "reasoning": "单元素创建，直接使用用户给定坐标，Z=3.0m=3000mm",
  "confidence": 0.95
}

用户: "建一个3×4的房间"
返回:
{
  "steps": [
    {
      "action": "CreateWall",
      "commandNamespace": "MEPBridge",
      "description": "创建南墙（底边）",
      "expected": "返回墙体 GUID",
      "params": {
        "start": {"x": 0, "y": 0},
        "end": {"x": 4, "y": 0},
        "thickness": 0.24,
        "height": 2.8
      }
    },
    {
      "action": "CreateWall",
      "commandNamespace": "MEPBridge",
      "description": "创建东墙（右边）",
      "expected": "返回墙体 GUID",
      "params": {
        "start": {"x": 4, "y": 0},
        "end": {"x": 4, "y": 3},
        "thickness": 0.24,
        "height": 2.8
      }
    },
    {
      "action": "CreateWall",
      "commandNamespace": "MEPBridge",
      "description": "创建北墙（顶边）",
      "expected": "返回墙体 GUID",
      "params": {
        "start": {"x": 4, "y": 3},
        "end": {"x": 0, "y": 3},
        "thickness": 0.24,
        "height": 2.8
      }
    },
    {
      "action": "CreateWall",
      "commandNamespace": "MEPBridge",
      "description": "创建西墙（左边）",
      "expected": "返回墙体 GUID",
      "params": {
        "start": {"x": 0, "y": 3},
        "end": {"x": 0, "y": 0},
        "thickness": 0.24,
        "height": 2.8
      }
    }
  ],
  "isMutation": true,
  "warningText": "此操作将在模型中创建 4 面墙体围成 3m×4m 房间",
  "userIntent": "建一个 3m×4m 的房间",
  "reasoning": "3×4房间=3m宽×4m长。以(0,0)为西南角，4面墙：南墙(0,0)-(4,0)、东墙(4,0)-(4,3)、北墙(4,3)-(0,3)、西墙(0,3)-(0,0)。外墙厚0.24m，层高2.8m",
  "confidence": 0.9
}

用户: "给卫生间布管"
（模型快照: 卫生间 1.8m×2.4m，墙体内侧范围约 (5.05,3.05)-(6.75,5.35)，层高2.6m）
返回:
{
  "steps": [
    {
      "action": "ScanStructuralElements",
      "commandNamespace": "MEPBridge",
      "description": "扫描结构元素获取房间 AABB 范围",
      "expected": "返回墙体坐标范围",
      "params": { "types": ["Wall"] }
    },
    {
      "action": "CreatePipe",
      "commandNamespace": "MEPBridge",
      "description": "卫生间给水管（冷热水沿南墙距地0.8m）",
      "expected": "返回管道 GUID",
      "params": {
        "waypoints": [
          {"x": 5.05, "y": 3.05, "z": 0.8},
          {"x": 6.75, "y": 3.05, "z": 0.8}
        ],
        "diameterMm": 20,
        "mepSystemName": "给水"
      }
    },
    {
      "action": "CreatePipe",
      "commandNamespace": "MEPBridge",
      "description": "卫生间排水主管（沿北墙距地0.3m，重力坡度）",
      "expected": "返回管道 GUID",
      "params": {
        "waypoints": [
          {"x": 5.1, "y": 5.3, "z": 0.3},
          {"x": 6.7, "y": 5.3, "z": 0.3}
        ],
        "diameterMm": 100,
        "mepSystemName": "排水"
      }
    },
    {
      "action": "CreateDuct",
      "commandNamespace": "MEPBridge",
      "description": "卫生间排风管（顶部居中距地2.3m）",
      "expected": "返回风管 GUID",
      "params": {
        "waypoints": [
          {"x": 5.9, "y": 3.0, "z": 2.3},
          {"x": 5.9, "y": 5.4, "z": 2.3}
        ],
        "width": 0.15,
        "height": 0.15,
        "mepSystemName": "排风"
      }
    },
    {
      "action": "CreateCableCarrier",
      "commandNamespace": "MEPBridge",
      "description": "卫生间电气桥架（顶部靠西墙距地2.4m）",
      "expected": "返回桥架 GUID",
      "params": {
        "waypoints": [
          {"x": 5.05, "y": 3.0, "z": 2.4},
          {"x": 5.05, "y": 5.4, "z": 2.4}
        ],
        "width": 0.02,
        "height": 0.02,
        "mepSystemName": "电气"
      }
    }
  ],
  "isMutation": true,
  "warningText": "此操作将在卫生间内创建给水管、排水管、排风管、电气桥架共 4 条 MEP 管线",
  "userIntent": "给卫生间布置标准 MEP 管线",
  "reasoning": "房间功能识别: 面积4.32㎡小房间→卫生间。给水: DN20沿南墙距地0.8m管中心距墙0.05m→y=3.05。排水: DN100沿北墙距地0.3m→y=5.3。通风: 150×150mm顶部居中距地2.3m→x=5.9(房间中心)。电气: DN20桥架靠西墙距地2.4m→x=5.05",
  "confidence": 0.85
}`;
  }

  // D5: 格式化单个 descriptor 为 prompt 条目
  formatDescriptorForPrompt(desc) {
    const cmdName = desc.commandName;
    const ns = desc.commandNamespace || 'MEPBridge';
    const risk = desc.riskLevel || 'read';
    const title = desc.title || cmdName;
    const description = (desc.description || '').slice(0, 120);

    // 提取参数信息
    let paramInfo = '无参数';
    if (desc.paramExtractors && Object.keys(desc.paramExtractors).length > 0) {
      const params = Object.entries(desc.paramExtractors).map(([key, spec]) => {
        const type = spec.type || 'any';
        const desc2 = (spec.description || '').slice(0, 60);
        return `    ${key} (${type}): ${desc2}`;
      });
      paramInfo = params.join('\n');
    }

    // commandJson 示例参数
    let exampleParams = '{}';
    if (desc.commandJson && desc.commandJson.parameters && desc.commandJson.parameters.addOnCommandParameters) {
      exampleParams = JSON.stringify(desc.commandJson.parameters.addOnCommandParameters);
    }

    return `- **${cmdName}** (namespace: ${ns}, risk: ${risk}): ${title}
  ${description}
  参数:
${paramInfo}
  示例: ${exampleParams}`;
  }

  // 旧版硬编码 prompt（兜底用，不再推荐）
  // FO-3: 接受 context 参数以保持接口一致
  getLegacySystemPrompt(context = {}) {
    // FO-3: 同样注入选择集信息到旧版 prompt
    let selectionSection = '';
    const sel = context?.selection;
    if (sel && sel.count > 0) {
      const typeLines = sel.types.map(t => `${t.type}:${t.count}`).join(', ');
      selectionSection = `\n\n## 当前选择集\n- 选中 ${sel.count} 个构件 (${typeLines})\n- GUIDs: ${sel.guids.slice(0, 10).join(', ')}${sel.guids.length > 10 ? '...' : ''}\n用户说"选中"时默认指代这些构件。\n`;
    } else if (sel && sel.count === 0) {
      selectionSection = '\n\n## 当前选择集\n- 当前无选中构件。\n';
    }

    return `你是 MEPBridge 操作助手，负责解析用户的 MEP（机电管综）操作需求并生成结构化的操作计划。
${selectionSection}

## 可用的 MEPBridge 命令

### 基础命令
- **Ping**: 检查连接状态
  参数: 无
  返回: {status: "ok"}

### 查询命令
- **GetAvailableSizes**: 查询可用的管道/风管尺寸
  参数: 无
  返回: 尺寸列表

- **GetAvailableSystems**: 查询可用的 MEP 系统
  参数: 无
  返回: 系统列表

- **ScanStructuralElements**: 扫描结构元素（柱、梁、墙）
  参数: 无
  返回: 结构元素列表

- **GetMEPElementInfo**: 获取 MEP 元素详细信息
  参数: {guid: "元素GUID"}
  返回: 元素属性、坐标、尺寸等

- **GetSelectedElements**: 获取当前选中的元素
  参数: 无
  返回: 选中元素的 GUID 列表

### 创建命令
- **CreatePipe**: 创建管道
  参数: {
    waypoints: [{x, y, z}, {x, y, z}],  // Archicad 模型坐标，单位米；至少 2 个点
    diameterMm: 100,     // 直径（毫米，可选）
    mepSystemName: "给水" // 系统名称（可选）
  }
  返回: {guid: "新创建元素的GUID"}

### 修改命令
- **MoveSelectedElements**: 移动选中的元素
  参数: {deltaMm: [dx, dy, dz]}  // 偏移量（毫米）
  返回: {success: true}

- **DeleteMEPElements**: 删除 MEP 元素
  参数: {guids: ["guid1", "guid2"]}
  返回: {deleted: 2}

## 返回格式

必须返回严格的 JSON 格式：
{
  "steps": [
    {
      "action": "命令名称",
      "description": "步骤描述（中文，面向用户）",
      "expected": "预期结果（中文）",
      "params": {}  // 命令参数对象
    }
  ],
  "isMutation": true/false,  // 是否会修改模型
  "warningText": "警告文本（可选，仅 mutation 时）",
  "userIntent": "用户意图总结（中文）"
}

## 规则

1. **坐标单位**: 移动偏移使用毫米（deltaMm）；CreatePipe 的 waypoints 使用 Archicad 模型坐标米（例如 Z=3.0 表示 3000mm）
2. **mutation 判断**: CreatePipe、MoveSelectedElements、DeleteMEPElements 为 mutation
3. **步骤顺序**: 先查询/验证，再执行，最后读回验证
4. **参数提取**: 从用户输入中提取具体数值（坐标、尺寸等）
5. **安全考虑**: mutation 操作需要添加警告文本

## 示例

用户: "创建一根从(0,0,3000)到(5000,0,3000)的管道"
返回:
{
  "steps": [
    {
      "action": "ScanStructuralElements",
      "description": "扫描路径上的结构障碍物",
      "expected": "确认无阻挡",
      "params": {}
    },
    {
      "action": "CreatePipe",
      "description": "创建管道",
      "expected": "返回新管道的 GUID",
      "params": {
        "waypoints": [
          {"x": 0, "y": 0, "z": 3},
          {"x": 5, "y": 0, "z": 3}
        ]
      }
    }
  ],
  "isMutation": true,
  "warningText": "此操作会在模型中创建新的管道元素",
  "userIntent": "创建一根从 (0,0,3000) 到 (5000,0,3000) 的管道"
}`;
  }

  // 用户提示词
  // FO-3: 当有选择集时，在用户输入前附加选择集摘要（强化 LLM 感知）
  getUserPrompt(text, context = {}) {
    let prompt = `用户需求：${text}`;

    if (context && Object.keys(context).length > 0) {
      // FO-3: 提取 selection 字段单独展示（比 JSON 更易读）
      const ctxCopy = { ...context };
      let selectionHint = '';
      if (ctxCopy.selection && ctxCopy.selection.count > 0) {
        const sel = ctxCopy.selection;
        const typeSummary = sel.types.map(t => `${t.type}×${t.count}`).join('、');
        selectionHint = `\n[当前选中: ${sel.count} 个构件 (${typeSummary})]`;
        delete ctxCopy.selection; // 避免重复输出
      }
      const otherContext = Object.keys(ctxCopy).length > 0
        ? `\n\n上下文：${JSON.stringify(ctxCopy, null, 2)}`
        : '';
      prompt += `${selectionHint}${otherContext}`;
    }

    return prompt;
  }

  // V2 H4.2: OpenAI 兼容多模态 vision API（OpenAI gpt-4o, DeepSeek 等）
  // 使用 image_url content type 传入 base64 PNG
  async callOpenAIVisionAPI(systemPrompt, textPrompt, imageBase64) {
    const url = normalizeOpenAiEndpoint(this.endpoint, this.provider);
    const dataUrl = `data:image/png;base64,${imageBase64}`;

    const response = await axios.post(
      url,
      {
        model: this.model || 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: textPrompt },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000  // vision API 比文本慢，给 60s
      }
    );

    return response.data.choices[0].message.content;
  }

  // V2 H4.2: Anthropic 多模态 vision API（Claude 3.5 Sonnet 等）
  // 使用 content 数组含 image source 传入 base64 PNG
  async callAnthropicVisionAPI(systemPrompt, textPrompt, imageBase64) {
    const url = normalizeAnthropicEndpoint(this.endpoint);
    const response = await axios.post(
      url,
      {
        model: this.model || 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: textPrompt },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageBase64
              }
            }
          ]
        }]
      },
      {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: 60000
      }
    );

    return response.data.content[0].text;
  }

  // Anthropic API
  async callAnthropicAPI(systemPrompt, userPrompt) {
    const url = normalizeAnthropicEndpoint(this.endpoint);
    const response = await axios.post(
      url,
      {
        model: this.model || 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      },
      {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: 30000
      }
    );

    return response.data.content[0].text;
  }

  // OpenAI 兼容 API（OpenAI, DeepSeek, 自定义）
  async callOpenAICompatibleAPI(systemPrompt, userPrompt) {
    const url = normalizeOpenAiEndpoint(this.endpoint, this.provider);

    const response = await axios.post(
      url,
      {
        model: this.model || 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return response.data.choices[0].message.content;
  }

  // 自定义 API
  async callCustomAPI(systemPrompt, userPrompt) {
    const url = normalizeOpenAiEndpoint(this.endpoint, this.provider);

    const response = await axios.post(
      url,
      {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return response.data.choices[0].message.content;
  }

  // 解析响应
  parseResponse(text) {
    try {
      // 尝试直接解析 JSON
      const json = JSON.parse(text);
      return this.validatePlan(json);
    } catch (error) {
      // 尝试提取 JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const json = JSON.parse(jsonMatch[0]);
          return this.validatePlan(json);
        } catch (e) {
          // 继续
        }
      }

      // 后备方案
      console.error('Failed to parse LLM response:', text);
      return this.fallbackPlan();
    }
  }

  // 验证计划
  validatePlan(plan) {
    if (!plan.steps || !Array.isArray(plan.steps)) {
      return this.fallbackPlan();
    }

    return {
      steps: plan.steps,
      isMutation: plan.isMutation || false,
      warningText: plan.warningText || null,
      userIntent: plan.userIntent || '',
      reasoning: plan.reasoning || ''
    };
  }

  // 后备计划
  fallbackPlan() {
    return {
      steps: [{
        action: 'Ping',
        description: '检查连接',
        expected: 'status=ok',
        params: {}
      }],
      isMutation: false,
      warningText: null,
      userIntent: '无法解析，执行基础检查'
    };
  }

  // V2 H2.3: 高层目标分解（CAD-CoT 粗粒度规划）
  // 将复杂目标（如"建一个三居室"）分解为有序子任务大纲
  // 每个 subTask 含 action + 参数骨架 + 依赖关系
  async decomposeGoal(goalText, context = {}) {
    const systemPrompt = `你是 MEPBridge AI 建筑规划师，负责将高层建筑目标分解为有序的子任务大纲。

## 可用命令
${this.descriptors.filter(d => d.commandName).map(d => `- ${d.commandName} (${d.commandNamespace}): ${d.title}`).join('\n')}

## CAD-CoT 目标分解策略（H5.1 增强）

1. **空间规划**: 先确定整体布局（房间排列、走廊位置、出入口）
2. **结构顺序**: 地基/楼板 → 外墙 → 内墙 → 柱梁 → 门窗洞 → MEP管线
3. **依赖关系（H5.2）**: 为每步标注 dependsOn（依赖的前置步骤 id）
   - 无依赖的步骤（如第一面墙）dependsOn=[]
   - 内墙依赖外墙 → dependsOn=[外墙步骤id]
   - 门窗洞依赖墙 → dependsOn=[墙步骤id]
   - MEP管线依赖结构完成 → dependsOn=[最后结构步骤id]
4. **尺寸推断（H5.3）**: 用建筑常识推断未指定的尺寸
5. **MEP 自动布置**: 结构完成后，按房间功能自动生成标准 MEP 管线
6. **指代解析（H5.4）**: 用户说"它/这个/那边/这里"时，结合上下文解析：
   - "它" → 当前选择集的元素
   - "这里" → 当前楼层/视图中心
   - "那边" → 模型快照中已有的元素位置
   - "继续/再建一面" → 执行历史中最近一步的同类操作

## 房间功能识别 + MEP 标准配置

| 房间功能 | 识别特征 | 给水 | 排水 | 通风 | 电气 |
|---------|---------|------|------|------|------|
| 卫生间 | 4-8㎡小房间 | DN20 距地0.8m | DN100 距地0.3m | 150×150 排风 | DN20 桥架 |
| 厨房 | 4-8㎡有给水 | DN20 距地0.5m | DN50 距地0.3m | 200×200 排油烟 | DN25 桥架 |
| 客厅 | 15-25㎡大房间 | 无 | 无 | 无 | DN25 桥架 |
| 卧室 | 10-15㎡ | 无 | 无 | 无 | DN20 桥架 |

## 建筑常识尺寸（H5.3 模糊参数推断字典）
- 标准卧室: 3.3m×3.6m，主卧 3.6m×4.2m
- 客厅: 4.2m×5.4m，卫生间: 1.8m×2.4m
- 厨房: 2.1m×3.0m，走廊: 1.2m宽
- 外墙厚 0.24m，内墙厚 0.12m，层高 2.8m
- 模糊词映射: "标准房间"→3×4m，"大房间"→5×6m，"小房间"→2×3m
- 模糊词映射: "高窗"→1.5×1.8m sillHeight=1.0m，"落地窗"→1.8×2.4m sillHeight=0.0m
- 模糊词映射: "入户门"→0.9×2.1m，"卫生间门"→0.7×2.0m

## 上下文感知（H5.4 指代解析）
${context.selection ? `当前选择集: ${context.selection.count}个元素 [${context.selection.types.map(t => t.type).join(',')}]` : '无选择集'}
${context.modelSnapshot ? `模型快照: ${context.modelSnapshot}` : '无模型快照'}
${context.history ? context.history : '无执行历史'}

## 返回格式（严格 JSON）
{
  "goal": "用户目标",
  "subTasks": [
    {
      "id": 1,
      "action": "命令名称",
      "commandNamespace": "MEPBridge",
      "description": "子任务描述",
      "params": {},
      "dependsOn": [],
      "riskLevel": "create-element|medium-mutation|read",
      "roomFunction": "卫生间|厨房|客厅|卧室|null"
    }
  ],
  "totalSteps": 10,
  "reasoning": "空间布局推理过程"
}`;

    const userPrompt = `请分解以下建筑目标为有序子任务：\n\n${goalText}`;

    let response;
    try {
      switch (this.provider) {
        case 'anthropic':
          response = await this.callAnthropicAPI(systemPrompt, userPrompt);
          break;
        default:
          response = await this.callOpenAICompatibleAPI(systemPrompt, userPrompt);
      }
      return this.parseDecomposition(response, goalText);
    } catch (error) {
      console.error('[LLM] decomposeGoal failed:', error.message);
      return { goal: goalText, subTasks: [], error: error.message };
    }
  }

  // 解析目标分解响应
  parseDecomposition(text, originalGoal) {
    try {
      const json = JSON.parse(text);
      if (json.subTasks && Array.isArray(json.subTasks)) {
        return json;
      }
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const json = JSON.parse(match[0]);
          if (json.subTasks) return json;
        } catch (e2) { /* fallthrough */ }
      }
    }
    return { goal: originalGoal, subTasks: [], error: 'Failed to parse decomposition' };
  }

  // V2 H2.4: 执行结果回灌（参数精细化）
  // 每步执行后，将结果回灌给 LLM，让 LLM 精细化下一步参数
  async refineStepWithResult(currentStep, executionResult, remainingSteps, context = {}) {
    const systemPrompt = `你是 MEPBridge AI 执行精炼器。上一步命令已执行完毕，请根据执行结果精细化下一步的参数。

## 任务
- 上一步: ${currentStep.action}
- 执行结果: ${JSON.stringify(executionResult).slice(0, 500)}
- 待执行的下一步: ${remainingSteps[0] ? JSON.stringify(remainingSteps[0]).slice(0, 300) : '无'}

## 精炼规则
1. 如果上一步成功且返回了 GUID，下一步如需引用该元素，在 params 中使用该 GUID
2. 如果上一步失败，分析错误原因，调整下一步参数或跳过依赖步骤
3. 如果上一步返回了坐标/尺寸信息，用于校正下一步的参数
4. 保持下一步的 action 不变，只精细化 params

## 返回格式（严格 JSON）
{
  "refined": true,
  "step": {
    "action": "命令名称",
    "commandNamespace": "MEPBridge",
    "description": "描述",
    "params": {}
  },
  "reasoning": "精炼原因",
  "skip": false
}`;

    const userPrompt = `请精细化下一步执行参数。`;

    let response;
    try {
      switch (this.provider) {
        case 'anthropic':
          response = await this.callAnthropicAPI(systemPrompt, userPrompt);
          break;
        default:
          response = await this.callOpenAICompatibleAPI(systemPrompt, userPrompt);
      }
      return this.parseRefinement(response, remainingSteps[0]);
    } catch (error) {
      console.error('[LLM] refineStepWithResult failed:', error.message);
      // 失败时返回原步骤不精炼
      return { refined: false, step: remainingSteps[0], reasoning: 'LLM refinement failed, using original', skip: false };
    }
  }

  // 解析参数精炼响应
  parseRefinement(text, originalStep) {
    try {
      const json = JSON.parse(text);
      if (json.step) return json;
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const json = JSON.parse(match[0]);
          if (json.step) return json;
        } catch (e2) { /* fallthrough */ }
      }
    }
    return { refined: false, step: originalStep, reasoning: 'Parse failed, using original', skip: false };
  }

  // 总结结果
  async summarizeResult(userIntent, steps) {
    const successCount = steps.filter(s => s.success).length;
    const totalCount = steps.length;
    const allSuccess = successCount === totalCount;

    const systemPrompt = '你是 MEPBridge 助手，负责总结操作结果。用简洁的语言告知用户操作是否成功，并提取关键信息。';
    const userPrompt = `用户意图：${userIntent}\n\n执行结果：${JSON.stringify(steps, null, 2)}\n\n请总结操作结果，格式：\n✅/⚠️ 标题\n关键信息（GUID、坐标等）`;

    let summaryText;
    try {
      if (this.provider === 'anthropic') {
        summaryText = await this.callAnthropicAPI(systemPrompt, userPrompt);
      } else {
        summaryText = await this.callOpenAICompatibleAPI(systemPrompt, userPrompt);
      }
    } catch (error) {
      // 后备总结
      summaryText = allSuccess
        ? `✅ 操作已完成！\n完成 ${successCount}/${totalCount} 个步骤`
        : `⚠️ 部分操作失败\n完成 ${successCount}/${totalCount} 个步骤`;
    }

    // 提取关键结果
    const keyResults = {};
    steps.forEach(step => {
      if (step.data?.guid) keyResults.guid = step.data.guid;
      if (step.data?.coords) keyResults.coords = step.data.coords;
    });

    return {
      summary: summaryText,
      success: allSuccess,
      key_results: keyResults,
      next_prompt: '还需要其他操作吗？'
    };
  }
}

module.exports = LLMAdapter;
module.exports.normalizeOpenAiEndpoint = normalizeOpenAiEndpoint;
module.exports.normalizeAnthropicEndpoint = normalizeAnthropicEndpoint;
module.exports.DEFAULT_OPENAI_ENDPOINTS = DEFAULT_OPENAI_ENDPOINTS;
module.exports.DEFAULT_ANTHROPIC_ENDPOINT = DEFAULT_ANTHROPIC_ENDPOINT;
