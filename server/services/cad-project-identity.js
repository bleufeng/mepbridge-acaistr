'use strict';

/**
 * cad-project-identity.js
 * C-CAD-03 (WP-01): CAD 工程身份与 projectKey 派生模块
 *
 * 权威契约：
 *   - C_CAD_REVERSE_MODELING_MASTER_PLAN_20261024 §4.3 (WP-01) 与 §4.5
 *
 * 核心逻辑：
 *   - 从 GetProjectInfo 提取 projectName 与 projectPath
 *   - 规范化绝对路径并计算稳定的 64-bit FNV-1a projectKey
 *   - projectKey 作用域不包含端口或显示名（换端口或重开仍能找回映射）
 *   - 未命名/未保存工程（untitled === true 或无路径）判定为 isIdentifiable: false，
 *     projectKey 为 null，仅允许会话级隔离草稿，严禁保存确认映射
 */

const { computeProjectPathHash } = require('./instance-registry');

/**
 * 派生 CAD 工程身份
 * @param {Object} projectInfo - 来自 GetProjectInfo 的 projectInfo 对象
 * @returns {Object} identity
 */
function deriveProjectIdentity(projectInfo) {
  const pInfo = projectInfo || {};
  const projectName = typeof pInfo.projectName === 'string' ? pInfo.projectName.trim() : '';
  const rawPath = typeof pInfo.projectPath === 'string' ? pInfo.projectPath.trim() : '';
  const isUntitled = pInfo.untitled === true || !rawPath;

  if (isUntitled) {
    return {
      isIdentifiable: false,
      projectKey: null,
      projectName: projectName || 'Untitled',
      projectPath: rawPath || '',
      teamwork: Boolean(pInfo.teamwork),
      reason: '工程未保存或缺少绝对路径，无法派生持久 projectKey，仅支持会话级草稿'
    };
  }

  const normalizedPath = rawPath.replace(/\\/g, '/').toLowerCase();
  const projectKey = computeProjectPathHash(normalizedPath);

  return {
    isIdentifiable: true,
    projectKey,
    projectName: projectName || 'Untitled',
    projectPath: rawPath,
    normalizedPath,
    teamwork: Boolean(pInfo.teamwork)
  };
}

module.exports = {
  deriveProjectIdentity
};
