// learning-memory.js
// V2 H9 学习记忆 — 纠正记录 + 模式学习 + 错误避免
//
// 职责：
//   H9.1  纠正记录存储（用户说"不对"时记录错误命令+用户纠正+上下文）
//   H9.2  纠正记录注入 LLM systemPrompt（"上次你说DN20，用户纠正为DN25"）
//   H9.3  模式学习（高频操作自动模板化）
//   H9.4  错误避免（相同上下文不重复犯错）
//   H9.6  学习记忆隐私 + 清除
//
// 存储: user-data/ai-memory/corrections.json (本地存储，不上传云端，一键清除)
//
// 参考: RMB L3 学习记忆 — 存储用户纠正记录，避免重复错误

const fs = require('fs');
const path = require('path');
const { ensureDataDir, migrateLegacyDirectory } = require('./runtime-paths');

// 用户数据统一存放到 user-data/ 目录
const USER_DATA_DIR = ensureDataDir('user-data');
const MEMORY_DIR = path.join(USER_DATA_DIR, 'ai-memory');
const CORRECTIONS_FILE = path.join(MEMORY_DIR, 'corrections.json');
const PATTERNS_FILE = path.join(MEMORY_DIR, 'patterns.json');

migrateLegacyDirectory('user-data/ai-memory', 'user-data/ai-memory');

// 确保 user-data/ai-memory/ 目录存在（新用户首次启动自动创建）
(function ensureMemoryDir() {
  try {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  } catch (e) {
    console.error('[LearningMemory] Ensure dir failed:', e.message);
  }
})();

class LearningMemory {
  constructor() {
    this._ensureDir(MEMORY_DIR);
    this.corrections = this._loadCorrections();
    this.patterns = this._loadPatterns();
  }

  _ensureDir(dir) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error('[LearningMemory] Mkdir failed:', e.message);
    }
  }

  // ─── H9.1: 纠正记录存储 ───

  _loadCorrections() {
    try {
      if (fs.existsSync(CORRECTIONS_FILE)) {
        return JSON.parse(fs.readFileSync(CORRECTIONS_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('[LearningMemory] Load corrections failed:', e.message);
    }
    return { corrections: [], version: 1 };
  }

  _saveCorrections() {
    try {
      fs.writeFileSync(CORRECTIONS_FILE, JSON.stringify(this.corrections, null, 2));
    } catch (e) {
      console.error('[LearningMemory] Save corrections failed:', e.message);
    }
  }

  /**
   * 记录用户纠正
   * @param {Object} correction - {
   *   originalCommand, originalParams, userCorrection, correctedParams,
   *   context: { selection, module, userIntent }, pattern
   * }
   */
  recordCorrection(correction) {
    const entry = {
      id: `COR-${String(this.corrections.corrections.length + 1).padStart(3, '0')}`,
      timestamp: new Date().toISOString(),
      originalCommand: correction.originalCommand,
      originalParams: correction.originalParams || {},
      userCorrection: correction.userCorrection || '',
      correctedParams: correction.correctedParams || {},
      context: correction.context || {},
      pattern: correction.pattern || ''
    };
    this.corrections.corrections.push(entry);
    // 最多保留 100 条（基础版限制，避免无限增长）
    if (this.corrections.corrections.length > 100) {
      this.corrections.corrections = this.corrections.corrections.slice(-100);
    }
    this._saveCorrections();
    console.log(`[LearningMemory][H9.1] Recorded correction ${entry.id}: ${entry.originalCommand} → ${entry.userCorrection}`);

    // H9.3: 检测高频模式
    this._detectPattern(entry);
    return entry;
  }

  // ─── H9.2: 纠正记录注入 LLM ───

  /**
   * 获取纠正记录摘要（注入 LLM systemPrompt）
   * @param {Object} context - 当前上下文（用于匹配相关纠正）
   */
  getCorrectionsSummary(context = {}) {
    if (this.corrections.corrections.length === 0) return '';

    // 找出与当前上下文相关的纠正记录
    let relevant = this.corrections.corrections;
    if (context.userIntent) {
      // 按命令匹配
      const intent = context.userIntent.toLowerCase();
      relevant = relevant.filter(c =>
        intent.includes(c.originalCommand?.toLowerCase()) ||
        c.pattern?.toLowerCase().includes(intent.slice(0, 10))
      );
    }
    // 取最近 5 条
    const recent = relevant.slice(-5);

    if (recent.length === 0) return '';

    const lines = recent.map(c => {
      const params = Object.entries(c.correctedParams)
        .map(([k, v]) => `${k}=${v}`).join(', ');
      return `- 上次 ${c.originalCommand} 用户纠正：${c.userCorrection}（正确: ${params}）`;
    });

    return `\n## 学习记忆（H9.2 用户纠正记录）\n${lines.join('\n')}\n\n**重要**: 根据以上纠正记录调整参数，避免重复犯错。\n`;
  }

  // ─── H9.3: 模式学习 ───

  _loadPatterns() {
    try {
      if (fs.existsSync(PATTERNS_FILE)) {
        return JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8'));
      }
    } catch (e) { /* ignore */ }
    return { patterns: [], version: 1 };
  }

  _savePatterns() {
    try {
      fs.writeFileSync(PATTERNS_FILE, JSON.stringify(this.patterns, null, 2));
    } catch (e) {
      console.error('[LearningMemory] Save patterns failed:', e.message);
    }
  }

  /**
   * 检测高频模式（连续3次相同流程 → 自动建议存为模板）
   */
  _detectPattern(correction) {
    // 简化：记录相同 originalCommand 的纠正次数
    const cmd = correction.originalCommand;
    const count = this.corrections.corrections.filter(c => c.originalCommand === cmd).length;

    if (count >= 3) {
      // 检查是否已有该模式
      const existing = this.patterns.patterns.find(p => p.command === cmd);
      if (!existing) {
        const pattern = {
          id: `PAT-${String(this.patterns.patterns.length + 1).padStart(3, '0')}`,
          command: cmd,
          detectedAt: new Date().toISOString(),
          occurrence: count,
          pattern: correction.pattern || `用户在 ${cmd} 上有偏好`,
          suggestedParams: correction.correctedParams
        };
        this.patterns.patterns.push(pattern);
        this._savePatterns();
        console.log(`[LearningMemory][H9.3] Pattern detected: ${pattern.id} (${cmd} ×${count})`);
      } else {
        existing.occurrence = count;
        existing.lastSeen = new Date().toISOString();
        this._savePatterns();
      }
    }
  }

  /**
   * 获取模式建议（注入 LLM）
   */
  getPatternSuggestions(context = {}) {
    if (this.patterns.patterns.length === 0) return '';

    const relevant = this.patterns.patterns.filter(p =>
      context.steps?.some(s => s.action === p.command)
    );

    if (relevant.length === 0) return '';

    const lines = relevant.map(p => {
      const params = Object.entries(p.suggestedParams || {})
        .map(([k, v]) => `${k}=${v}`).join(', ');
      return `- ${p.command}: 用户偏好参数 ${params}（基于 ${p.occurrence} 次纠正）`;
    });

    return `\n## 模式学习（H9.3 用户偏好）\n${lines.join('\n')}\n\n**重要**: 优先使用上述用户偏好参数。\n`;
  }

  // ─── H9.4: 错误避免 ───

  /**
   * 检查当前计划是否可能触发历史错误
   * @returns {Object} { hasRisk: bool, warnings: [] }
   */
  checkPlanAgainstHistory(plan) {
    const warnings = [];
    const steps = plan.steps || [];

    for (const step of steps) {
      const relevantCorrections = this.corrections.corrections.filter(
        c => c.originalCommand === step.action
      );

      for (const correction of relevantCorrections) {
        // 检查参数是否与历史错误参数相同
        const sameParams = Object.entries(correction.originalParams).some(([k, v]) =>
          step.params?.[k] === v
        );

        if (sameParams) {
          warnings.push({
            stepAction: step.action,
            risk: '历史纠正',
            message: `上次 ${step.action} 用相同参数被纠正：${correction.userCorrection}`,
            suggestedParams: correction.correctedParams
          });
        }
      }
    }

    return {
      hasRisk: warnings.length > 0,
      warnings
    };
  }

  // ─── H9.5: 查看管理 ───

  listCorrections(limit = 50) {
    return this.corrections.corrections.slice(-limit).reverse();
  }

  listPatterns() {
    return this.patterns.patterns;
  }

  // ─── H9.6: 隐私清除 ───

  clearAll() {
    this.corrections = { corrections: [], version: 1 };
    this.patterns = { patterns: [], version: 1 };
    this._saveCorrections();
    this._savePatterns();
    console.log('[LearningMemory][H9.6] All learning memory cleared');
    return { cleared: true, timestamp: new Date().toISOString() };
  }

  deleteCorrection(id) {
    const before = this.corrections.corrections.length;
    this.corrections.corrections = this.corrections.corrections.filter(c => c.id !== id);
    this._saveCorrections();
    return { deleted: before > this.corrections.corrections.length };
  }
}

module.exports = new LearningMemory();
