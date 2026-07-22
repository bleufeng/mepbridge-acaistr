// user-tiers.js
// 用户级别配置 — 控制各功能模块的数量上限
// 用于测试版限制和未来商业化分级管理
//
// 级别说明：
//   trial   — 基础版（当前默认，满足日常使用）
//   standard — 标准版（扩展容量，适用高频用户）
//   pro     — 专业版（无限制，适用团队/企业）

const USER_TIERS = {
  trial: {
    label: '基础版',
    labelEn: 'Basic',
    limits: {
      templates: 20,           // 用户模板最大数量
      commands: 20,            // 自定义命令最大数量
      knowledgeRules: 100,     // 用户自定义知识库规则最大数量
      learningMemory: 100,     // 学习记忆纠正记录最大数量
      backupFiles: 10          // 备份文件最大保留数量
    }
  },
  standard: {
    label: '标准版',
    labelEn: 'Standard',
    limits: {
      templates: 100,
      commands: 50,
      knowledgeRules: 100,
      learningMemory: 500,
      backupFiles: 20
    }
  },
  pro: {
    label: '专业版',
    labelEn: 'Pro',
    limits: {
      templates: -1,           // -1 表示无限制
      commands: -1,
      knowledgeRules: -1,
      learningMemory: -1,
      backupFiles: -1
    }
  }
};

// 当前激活的级别（测试阶段硬编码为 trial，未来从许可证文件读取）
const CURRENT_TIER = process.env.MEPBRIDGE_TIER || 'trial';

/**
 * 获取当前用户级别配置
 */
function getCurrentTier() {
  return USER_TIERS[CURRENT_TIER] || USER_TIERS.trial;
}

/**
 * 获取指定功能的数量上限
 * @param {string} feature - templates | commands | knowledgeRules | learningMemory | backupFiles
 * @returns {number} -1 表示无限制
 */
function getLimit(feature) {
  const tier = getCurrentTier();
  return tier.limits[feature] ?? -1;
}

/**
 * 检查是否可以新增条目
 * @param {string} feature - 功能名
 * @param {number} currentCount - 当前数量
 * @returns {{ allowed: boolean, limit: number, remaining: number }}
 */
function checkLimit(feature, currentCount) {
  const limit = getLimit(feature);
  if (limit === -1) {
    return { allowed: true, limit: -1, remaining: -1 };
  }
  const remaining = Math.max(0, limit - currentCount);
  return {
    allowed: currentCount < limit,
    limit,
    remaining
  };
}

module.exports = {
  USER_TIERS,
  CURRENT_TIER,
  getCurrentTier,
  getLimit,
  checkLimit
};
