const axios = require('axios');

class OllamaAdapter {
  constructor(config) {
    this.endpoint = config.endpoint || 'http://localhost:11434';
    this.model = config.model || 'llama3:8b';
  }

  // 生成操作计划
  async generatePlan(text, context = {}) {
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = `用户需求：${text}\n\n上下文：${JSON.stringify(context)}`;

    const response = await axios.post(
      `${this.endpoint}/api/generate`,
      {
        model: this.model,
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream: false,
        format: 'json'
      },
      { timeout: 60000 }
    );

    return this.parseResponse(response.data.response);
  }

  // 系统提示词（与 LLMAdapter 相同）
  getSystemPrompt() {
    return `你是 MEPBridge 操作助手。返回 JSON 格式的操作计划。

可用命令: Ping, GetSelectedElements, CreatePipe, MoveSelectedElements, ScanStructuralElements

CreatePipe 参数必须使用 waypoints: [{x,y,z},{x,y,z}]，坐标为 Archicad 模型坐标米；移动命令的 deltaMm 才使用毫米。

返回格式:
{
  "steps": [{"action": "命令", "description": "描述", "expected": "预期", "params": {}}],
  "isMutation": true/false,
  "userIntent": "意图"
}`;
  }

  // 解析响应
  parseResponse(text) {
    try {
      const json = JSON.parse(text);
      return {
        steps: json.steps || [],
        isMutation: json.isMutation || false,
        warningText: json.warningText || null,
        userIntent: json.userIntent || ''
      };
    } catch (error) {
      console.error('[Ollama] Parse error:', error.message);
      return this.fallbackPlan();
    }
  }

  // 后备方案
  fallbackPlan() {
    return {
      steps: [{ action: 'Ping', description: '检查连接', expected: 'ok', params: {} }],
      isMutation: false,
      userIntent: ''
    };
  }

  // 总结结果
  async summarizeResult(userIntent, steps) {
    const successCount = steps.filter(s => s.success).length;
    return {
      summary: `✅ 完成 ${successCount}/${steps.length} 个步骤`,
      success: successCount === steps.length,
      key_results: {},
      next_prompt: '还需要其他操作吗？'
    };
  }
}

module.exports = OllamaAdapter;
