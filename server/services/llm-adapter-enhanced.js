const fs = require('fs');
const { migrateLegacyFile } = require('./runtime-paths');

class LLMAdapter {
  constructor(config) {
    this.provider = config.provider;
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint;
    this.model = config.model;
    this.feedbackFile = migrateLegacyFile('.feature-requests.json');
  }

  // 生成操作计划（带未支持检测）
  async generatePlan(text, context = {}) {
    const language = context.language || 'zh-CN';
    const systemPrompt = this.getSystemPrompt(language);
    const userPrompt = this.getUserPrompt(text, context);

    let response;
    try {
      // 调用 LLM
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
      }

      const plan = this.parseResponse(response);

      // 检查是否有未支持的功能
      const unsupported = this.checkUnsupportedFeatures(plan, text);
      if (unsupported) {
        plan.unsupported = unsupported;
        this.logFeatureRequest(text, unsupported);
      }

      return plan;
    } catch (error) {
      throw error;
    }
  }

  // 检查未支持的功能
  checkUnsupportedFeatures(plan, userIntent) {
    const supportedCommands = [
      'Ping',
      'GetAvailableSizes',
      'GetAvailableSystems',
      'ScanStructuralElements',
      'GetMEPElementInfo',
      'GetSelectedElements',
      'CreatePipe',
      'MoveSelectedElements',
      'DeleteMEPElements'
    ];

    // 检查是否有不支持的命令
    const unsupportedCommands = [];
    plan.steps.forEach(step => {
      if (!supportedCommands.includes(step.action)) {
        unsupportedCommands.push(step.action);
      }
    });

    if (unsupportedCommands.length > 0) {
      return {
        commands: unsupportedCommands,
        userIntent: userIntent,
        timestamp: new Date().toISOString()
      };
    }

    return null;
  }

  // 记录功能请求
  logFeatureRequest(userIntent, unsupported) {
    try {
      let requests = [];

      // 读取现有记录
      if (fs.existsSync(this.feedbackFile)) {
        const data = fs.readFileSync(this.feedbackFile, 'utf8');
        requests = JSON.parse(data);
      }

      // 添加新记录
      requests.push({
        userIntent,
        unsupportedCommands: unsupported.commands,
        timestamp: unsupported.timestamp,
        language: 'zh-CN'
      });

      // 写回文件
      fs.writeFileSync(this.feedbackFile, JSON.stringify(requests, null, 2));

      console.log(`[Feature Request] Logged: ${userIntent}`);
    } catch (error) {
      console.error('[Feature Request] Log error:', error.message);
    }
  }

  // 系统提示词（增强：包含未支持处理）
  getSystemPrompt(language = 'zh-CN') {
    if (language === 'en-US') {
      return this.getEnglishSystemPrompt();
    }
    return this.getChineseSystemPrompt();
  }

  getChineseSystemPrompt() {
    return `你是 MEPBridge 操作助手。

## 当前支持的命令

- Ping: 检查连接
- GetAvailableSizes: 查询可用尺寸
- GetAvailableSystems: 查询可用系统
- ScanStructuralElements: 扫描结构
- GetMEPElementInfo: 获取元素信息
- GetSelectedElements: 获取选中元素
- CreatePipe: 创建管道
- MoveSelectedElements: 移动元素
- DeleteMEPElements: 删除元素

CreatePipe 参数必须使用 waypoints: [{x,y,z},{x,y,z}]，坐标为 Archicad 模型坐标米；MoveSelectedElements 的 deltaMm 使用毫米。

## 重要规则

**如果用户需求超出当前命令能力**，返回：
{
  "steps": [],
  "isMutation": false,
  "unsupported": true,
  "message": "抱歉，[具体功能] 暂未支持。已记录您的需求反馈给开发团队。",
  "suggestedFeature": "建议的命令名称",
  "userIntent": "用户意图描述"
}

## 示例

用户: "创建阀门"
当前命令: 没有 CreateValve
返回:
{
  "steps": [],
  "unsupported": true,
  "message": "抱歉，创建阀门功能暂未支持。已记录您的需求反馈给开发团队。",
  "suggestedFeature": "CreateValve",
  "userIntent": "创建阀门"
}

用户: "创建管道" (支持)
返回正常的操作计划。`;
  }

  getEnglishSystemPrompt() {
    return `You are MEPBridge assistant.

## Supported Commands

- Ping, GetAvailableSizes, GetAvailableSystems
- ScanStructuralElements, GetMEPElementInfo, GetSelectedElements
- CreatePipe, MoveSelectedElements, DeleteMEPElements

CreatePipe parameters must use waypoints: [{x,y,z},{x,y,z}] in Archicad model coordinates (meters). MoveSelectedElements uses deltaMm in millimeters.

## Important Rule

**If user request is beyond current capabilities**, return:
{
  "steps": [],
  "unsupported": true,
  "message": "Sorry, [specific feature] is not supported yet. Your request has been logged.",
  "suggestedFeature": "SuggestedCommandName",
  "userIntent": "User intent description"
}`;
  }

  // 解析响应（带未支持检测）
  parseResponse(text) {
    try {
      const json = JSON.parse(text);

      // 如果 LLM 返回 unsupported
      if (json.unsupported) {
        return {
          steps: [],
          isMutation: false,
          unsupported: true,
          message: json.message,
          suggestedFeature: json.suggestedFeature,
          userIntent: json.userIntent
        };
      }

      return this.validatePlan(json);
    } catch (error) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const json = JSON.parse(jsonMatch[0]);
          if (json.unsupported) {
            return {
              steps: [],
              unsupported: true,
              message: json.message
            };
          }
          return this.validatePlan(json);
        } catch (e) {
          // 继续
        }
      }

      return this.fallbackPlan();
    }
  }

  // ... 其他方法保持不变
}

module.exports = LLMAdapter;
