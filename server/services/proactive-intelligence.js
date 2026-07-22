// proactive-intelligence.js
// V2 H10 主动智能 — 工作流缺口检测 + 主动建议 + 预判 + 异常预警
//
// 职责：
//   H10.1 工作流缺口检测（"建了墙但没开门洞"/"布了给水管但没布排水管"）
//   H10.2 主动建议下一步（LLM 分析当前模型状态，建议"接下来应该..."）
//   H10.3 预判用户需求（用户选中墙 → 主动准备"开门洞"）
//   H10.4 异常检测 + 预警（"管线穿过结构梁"/"风管坡度不足"）
//   H10.6 主动智能开关 + 灵敏度配置（off/low/medium/aggressive 四档）
//
// 参考: RMB L4 主动智能 — 检测工作流缺口，主动建议下一步，预判用户需求

const axios = require('axios');

const { getArchicadEndpoint } = require('./archicad-endpoint');
// ARCHICAD_ENDPOINT 动态解析：AC29 实测会用 19724（非 19723）
function ARCHICAD_ENDPOINT() {
  return getArchicadEndpoint();
}

// 灵敏度档位配置
const SENSITIVITY_LEVELS = {
  off: { enabled: false, gapDetection: false, prediction: false, anomalyCheck: false },
  low: { enabled: true, gapDetection: true, prediction: false, anomalyCheck: false, maxSuggestions: 1 },
  medium: { enabled: true, gapDetection: true, prediction: true, anomalyCheck: true, maxSuggestions: 3 },
  aggressive: { enabled: true, gapDetection: true, prediction: true, anomalyCheck: true, maxSuggestions: 5, autoTrigger: true }
};

// 工作流缺口规则库（H10.1）
const GAP_RULES = [
  {
    id: 'GAP-001',
    name: '封闭空间未开门洞',
    condition: (model) => {
      // 检测：有4面以上墙形成封闭空间，但无门
      const walls = model.elements?.filter(e => e.type === 'Wall') || [];
      const doors = model.elements?.filter(e => e.type === 'Door') || [];
      return walls.length >= 4 && doors.length === 0;
    },
    suggestion: '检测到已建墙体形成封闭空间，是否需要开门洞？',
    suggestedActions: ['CreateDoor'],
    severity: 'info'
  },
  {
    id: 'GAP-002',
    name: '有墙无楼板',
    condition: (model) => {
      const walls = model.elements?.filter(e => e.type === 'Wall') || [];
      const slabs = model.elements?.filter(e => e.type === 'Slab') || [];
      return walls.length >= 4 && slabs.length === 0;
    },
    suggestion: '检测到已建墙体但无楼板，是否需要创建楼板？',
    suggestedActions: ['CreateSlab'],
    severity: 'info'
  },
  {
    id: 'GAP-003',
    name: '有给水管无排水管',
    condition: (model) => {
      const mepInfo = model.mepInfo || {};
      const hasWater = mepInfo.Piping?.Water > 0;
      const hasDrainage = mepInfo.Piping?.Drainage > 0;
      return hasWater && !hasDrainage;
    },
    suggestion: '检测到已布给水管但无排水管，是否需要补充排水管？',
    suggestedActions: ['CreatePipe'],
    severity: 'warning'
  },
  {
    id: 'GAP-004',
    name: '卫生间无排风',
    condition: (model) => {
      const ducts = model.elements?.filter(e => e.type === 'Duct') || [];
      const zones = model.elements?.filter(e => e.type === 'Zone') || [];
      // 简化：有 Zone 但无风管
      return zones.length > 0 && ducts.length === 0;
    },
    suggestion: '检测到有房间区域但无通风管，是否需要布置排风？',
    suggestedActions: ['CreateDuct'],
    severity: 'info'
  },
  {
    id: 'GAP-005',
    name: '有结构无电气',
    condition: (model) => {
      const structures = model.elements?.filter(e =>
        ['Wall', 'Column', 'Beam', 'Slab'].includes(e.type)
      ) || [];
      const cableCarriers = model.elements?.filter(e => e.type === 'CableCarrier') || [];
      return structures.length >= 4 && cableCarriers.length === 0;
    },
    suggestion: '检测到已有结构但无电气桥架，是否需要布置电气管线？',
    suggestedActions: ['CreateCableCarrier'],
    severity: 'info'
  }
];

// 异常检测规则库（H10.4）
const ANOMALY_RULES = [
  {
    id: 'ANM-001',
    name: '墙厚过薄',
    check: (element) => element.type === 'Wall' && element.thickness && element.thickness < 0.1,
    message: '墙厚 < 0.1m，可能不满足结构要求',
    severity: 'warning'
  },
  {
    id: 'ANM-002',
    name: '层高不足',
    check: (element) => element.type === 'Wall' && element.height && element.height < 2.2,
    message: '墙高 < 2.2m，低于住宅最低层高要求',
    severity: 'warning'
  },
  {
    id: 'ANM-003',
    name: '门宽过窄',
    check: (element) => (element.type === 'Door') && element.width && element.width < 0.7,
    message: '门宽 < 0.7m，低于无障碍设计要求',
    severity: 'warning'
  },
  {
    id: 'ANM-004',
    name: '管径过小',
    check: (element) => element.type === 'Pipe' && element.diameterMm && element.diameterMm < 15,
    message: '管径 < DN15，低于给水管最小管径',
    severity: 'error'
  }
];

class ProactiveIntelligence {
  constructor() {
    this.sensitivity = 'medium';  // 默认中等灵敏度
  }

  setSensitivity(level) {
    if (SENSITIVITY_LEVELS[level]) {
      this.sensitivity = level;
      console.log(`[ProactiveIntel] Sensitivity set to: ${level}`);
      return true;
    }
    return false;
  }

  getSensitivity() {
    return {
      level: this.sensitivity,
      config: SENSITIVITY_LEVELS[this.sensitivity]
    };
  }

  /**
   * 获取当前模型状态（用于缺口检测和异常检测）
   */
  async _getModelState() {
    try {
      const response = await axios.post(ARCHICAD_ENDPOINT(), {
        command: 'API.ExecuteAddOnCommand',
        parameters: {
          addOnCommandId: { commandNamespace: 'MEPBridge', commandName: 'ScanStructuralElements' },
          addOnCommandParameters: {}
        }
      }, { timeout: 5000 });

      const result = response.data?.result?.addOnCommandResponse;
      if (result?.status === 'ok') {
        const elements = result.elements || [];
        const typeCounts = {};
        for (const el of elements) {
          typeCounts[el.type] = (typeCounts[el.type] || 0) + 1;
        }
        return { elements, typeCounts, count: result.count };
      }
    } catch (e) {
      console.log('[ProactiveIntel] Get model state failed:', e.message);
    }
    return null;
  }

  /**
   * H10.1: 工作流缺口检测
   * 分析当前模型状态，检测未完成的工作流缺口
   */
  async detectGaps() {
    const config = SENSITIVITY_LEVELS[this.sensitivity];
    if (!config.enabled || !config.gapDetection) return { gaps: [] };

    const model = await this._getModelState();
    if (!model) return { gaps: [], error: '无法获取模型状态' };

    const gaps = [];
    for (const rule of GAP_RULES) {
      try {
        if (rule.condition(model)) {
          gaps.push({
            id: rule.id,
            name: rule.name,
            suggestion: rule.suggestion,
            suggestedActions: rule.suggestedActions,
            severity: rule.severity
          });
        }
      } catch (e) { /* skip rule */ }
    }

    return {
      gaps: gaps.slice(0, config.maxSuggestions || 3),
      modelSummary: `${model.count} 个元素`
    };
  }

  /**
   * H10.3: 预判用户需求
   * 根据当前选择集，预判用户可能的下一步操作
   */
  predictNextAction(selection) {
    const config = SENSITIVITY_LEVELS[this.sensitivity];
    if (!config.enabled || !config.prediction) return { predictions: [] };

    if (!selection || selection.count === 0) {
      return { predictions: [] };
    }

    const predictions = [];

    // 选中墙 → 可能开门洞/开窗洞
    if (selection.types?.some(t => t.type === 'Wall')) {
      predictions.push({
        trigger: '选中墙',
        predictedAction: 'CreateDoor',
        confidence: 0.6,
        message: '检测到选中墙，是否需要开门洞？',
        suggestedParams: { width: 0.9, height: 2.1 }
      });
      predictions.push({
        trigger: '选中墙',
        predictedAction: 'CreateWindow',
        confidence: 0.4,
        message: '或开窗洞？',
        suggestedParams: { width: 1.2, height: 1.5, sillHeight: 0.9 }
      });
    }

    // 选中管道 → 可能延伸/修改
    if (selection.types?.some(t => t.type === 'MEPRoute' || t.type === 'Pipe')) {
      predictions.push({
        trigger: '选中管道',
        predictedAction: 'CreatePipe',
        confidence: 0.5,
        message: '检测到选中管道，是否需要延伸？',
        suggestedParams: {}
      });
    }

    // 选中多个元素 → 可能移动/复制/旋转
    if (selection.count > 1) {
      predictions.push({
        trigger: '选中多个元素',
        predictedAction: 'MoveSelectedElements',
        confidence: 0.4,
        message: '检测到多选，是否需要移动？',
        suggestedParams: {}
      });
    }

    return {
      predictions: predictions.slice(0, config.maxSuggestions || 3)
    };
  }

  /**
   * H10.4: 异常检测 + 预警
   * 检测模型中的异常（墙厚过薄/层高不足/管径过小等）
   */
  async detectAnomalies() {
    const config = SENSITIVITY_LEVELS[this.sensitivity];
    if (!config.enabled || !config.anomalyCheck) return { anomalies: [] };

    const model = await this._getModelState();
    if (!model) return { anomalies: [], error: '无法获取模型状态' };

    const anomalies = [];
    for (const element of model.elements) {
      for (const rule of ANOMALY_RULES) {
        try {
          if (rule.check(element)) {
            anomalies.push({
              id: rule.id,
              name: rule.name,
              elementGuid: element.guid,
              elementType: element.type,
              message: rule.message,
              severity: rule.severity
            });
          }
        } catch (e) { /* skip */ }
      }
    }

    return {
      anomalies,
      errorCount: anomalies.filter(a => a.severity === 'error').length,
      warningCount: anomalies.filter(a => a.severity === 'warning').length
    };
  }

  /**
   * H10.2: 主动建议下一步（综合缺口+预判+异常）
   */
  async generateSuggestions(selection = null) {
    const config = SENSITIVITY_LEVELS[this.sensitivity];
    if (!config.enabled) return { suggestions: [], enabled: false };

    // 并行检测
    const [gapsResult, anomaliesResult] = await Promise.all([
      this.detectGaps(),
      this.detectAnomalies()
    ]);
    const predictionsResult = this.predictNextAction(selection);

    // 合并建议（异常优先级最高，其次是缺口，最后是预判）
    const suggestions = [];

    // 异常预警（高优先级）
    for (const anomaly of anomaliesResult.anomalies) {
      suggestions.push({
        type: 'anomaly',
        severity: anomaly.severity,
        title: anomaly.severity === 'error' ? '⚠ 异常预警' : '注意',
        message: anomaly.message,
        elementGuid: anomaly.elementGuid
      });
    }

    // 工作流缺口
    for (const gap of gapsResult.gaps) {
      suggestions.push({
        type: 'gap',
        severity: gap.severity,
        title: '💡 工作流建议',
        message: gap.suggestion,
        suggestedActions: gap.suggestedActions
      });
    }

    // 预判需求
    for (const pred of predictionsResult.predictions) {
      suggestions.push({
        type: 'prediction',
        severity: 'info',
        title: '🔮 预判操作',
        message: pred.message,
        suggestedAction: pred.predictedAction,
        suggestedParams: pred.suggestedParams,
        confidence: pred.confidence
      });
    }

    return {
      suggestions: suggestions.slice(0, config.maxSuggestions || 5),
      enabled: true,
      sensitivity: this.sensitivity,
      summary: `${suggestions.length} 条建议（${anomaliesResult.anomalies.length} 异常 + ${gapsResult.gaps.length} 缺口 + ${predictionsResult.predictions.length} 预判）`
    };
  }
}

module.exports = new ProactiveIntelligence();
