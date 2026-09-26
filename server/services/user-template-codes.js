'use strict';

// 用户模板编号（TPL-0NN）：面板展示 +「直接输入编号复现」。
//
// 编号空间约定（2026-09-18 维护者裁定）：
//   - **用户模板从 TPL-001 起，按模板列表顺序连续编号**（TPL-001、TPL-002 …），
//     即"编号 = 列表序号"，编号持久化在模板对象的 `code` 字段上。
//   - 内置任务模板（server/services/task-templates.js，id 也是 TPL-0NN）**不再预留区间**：
//     编号直达时**用户模板优先**，只有用户模板没有该编号时才回落到内置模板 id。
//   - 重复项（同 id 多条）只保留最新（updatedAt 较大者），见 dedupeTemplates()。
//
// 本文件只放纯函数（不读文件、不依赖路由），便于契约测试直接断言。

const USER_TEMPLATE_CODE_START = 1;

// 允许的输入写法：TPL-021 / TPL021 / tpl-21 / tpl 21 / 复现 TPL-021
// 前后必须有非字母数字边界；数字整段最多 3 位（"TPL-0260" 不是编号）。
const CODE_PATTERN = /(?:^|[^a-z0-9])tpl[\s_-]*(\d{1,4})(?![0-9])/i;

// 出厂（内置）模板编号前缀：SYS-014 ↔ 内置 id TPL-014（server/services/task-templates.js）。
// 用户模板用 TPL-0NN（上文），出厂模板用 SYS-0NN ⇒ 两套编号互不遮蔽，来源一眼可辨。
const BUILTIN_CODE_PREFIX = 'SYS-';
const BUILTIN_CODE_PATTERN = /(?:^|[^a-z0-9])sys[\s_-]*(\d{1,4})(?![0-9])/i;

// 与出厂模板"同一场景"的用户资产模板：面板里不再重复展示（数据保留，不删除），
// 由出厂模板（SYS-0NN）承载；映射键为资产 id，值为出厂编号。
const SUPERSEDED_BY_BUILTIN = {
  'tpl-starter-room-walls': 'SYS-001',
  'tpl-starter-replicate-stair': 'SYS-013',
  'tpl-starter-create-shell-on-floors': 'SYS-014',
  'tpl-starter-create-elevated-mesh': 'SYS-015',
  'tpl-starter-create-extruded-morph': 'SYS-016',
  'tpl-starter-create-wall-from-favorite': 'SYS-017',
  'tpl-starter-create-structural-member-from-profile': 'SYS-018',
  'tpl-starter-batch-set-layer': 'SYS-019',
  'tpl-starter-assign-classification': 'SYS-020'
};

function builtinCodeForTemplateId(templateId) {
  return (templateId && SUPERSEDED_BY_BUILTIN[templateId]) || null;
}

/** 内置模板 id（TPL-014）→ 出厂编号（SYS-014）；非内置形态返回 null */
function formatBuiltinCode(templateId) {
  if (typeof templateId !== 'string') return null;
  const n = templateCodeNumber(templateId);
  return n === null ? null : BUILTIN_CODE_PREFIX + String(n).padStart(3, '0');
}

/** 出厂编号（SYS-014）→ 内置模板 id（TPL-014）；非出厂形态返回 null */
function builtinIdFromCode(code) {
  if (typeof code !== 'string') return null;
  const match = code.match(/^sys[\s_-]*0*(\d{1,3})$/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? 'TPL-' + String(n).padStart(3, '0') : null;
}

/** 从文本里提取出厂编号（归一为 SYS-0NN）；未命中返回 null */
function extractBuiltinCode(text) {
  if (typeof text !== 'string' || !text) return null;
  const match = text.match(BUILTIN_CODE_PATTERN);
  if (!match) return null;
  const digits = match[1];
  if (digits.length > 3) return null;
  return BUILTIN_CODE_PREFIX + String(Number(digits)).padStart(3, '0');
}

/**
 * 统一编号解析：先认用户编号（TPL-0NN，用户模板优先），再认出厂编号（SYS-0NN）。
 * @returns {{kind: 'user'|'builtin'|null, code: string|null, builtinId: string|null}}
 */
function parseTemplateCodeRequest(text) {
  const userCode = extractTemplateCode(text);
  if (userCode) return { kind: 'user', code: userCode, builtinId: null };
  const builtinCode = extractBuiltinCode(text);
  if (builtinCode) return { kind: 'builtin', code: builtinCode, builtinId: builtinIdFromCode(builtinCode) };
  return { kind: null, code: null, builtinId: null };
}

function formatTemplateCode(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return 'TPL-' + String(Math.trunc(n)).padStart(3, '0');
}

function templateCodeNumber(code) {
  if (typeof code !== 'string') return null;
  const match = code.match(/^tpl[\s_-]*0*(\d{1,3})$/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 从任意文本里提取模板编号（归一为 TPL-0NN）；未命中返回 null */
function extractTemplateCode(text) {
  if (typeof text !== 'string' || !text) return null;
  const match = text.match(CODE_PATTERN);
  if (!match) return null;
  const digits = match[1];
  if (digits.length > 3) return null; // 例如 TPL-0260 不是合法编号
  return formatTemplateCode(Number(digits));
}

/**
 * 按列表顺序**重排编号**：TPL-001、TPL-002 …（就地修改，返回变更个数）。
 * 这是"编号 = 列表序号"的落地：新增模板落到末尾，删除后自动补齐连续。
 * 编号全量连续 ⇒ 不可能出现重复编号。
 */
function renumberTemplateCodes(templates) {
  if (!Array.isArray(templates)) return 0;
  let changed = 0;
  let cursor = USER_TEMPLATE_CODE_START;
  for (const tpl of templates) {
    if (!tpl || typeof tpl !== 'object') continue;
    const next = formatTemplateCode(cursor);
    if (tpl.code !== next) {
      tpl.code = next;
      changed += 1;
    }
    cursor += 1;
  }
  return changed;
}

/**
 * 去重：同 id 只保留最新（updatedAt 较大者）；无法比较时间时保留靠后的。
 * 返回 { templates, removed }（不就地修改入参，便于调用方决定是否落盘）。
 */
function dedupeTemplates(templates) {
  if (!Array.isArray(templates)) return { templates: [], removed: [] };
  const byId = new Map();
  const removed = [];
  for (const tpl of templates) {
    if (!tpl || typeof tpl !== 'object' || !tpl.id) continue;
    const existing = byId.get(tpl.id);
    if (!existing) {
      byId.set(tpl.id, tpl);
      continue;
    }
    const existingAt = Date.parse(existing.updatedAt || '') || 0;
    const currentAt = Date.parse(tpl.updatedAt || '') || 0;
    // 只保留最新：新条目更新时间 >= 旧条目时替换
    if (currentAt >= existingAt) {
      byId.set(tpl.id, tpl);
      removed.push(existing);
    } else {
      removed.push(tpl);
    }
  }
  return { templates: Array.from(byId.values()), removed };
}

/**
 * 为缺少 code 的模板就地分配编号（返回被赋值的个数）。
 * 注意：需要"编号 = 列表序号"语义时请用 renumberTemplateCodes()。
 * @param {Array} templates 模板数组（会被就地修改）
 * @param {Array<string>} reservedCodes 需要避开的编号/id
 */
function assignTemplateCodes(templates, reservedCodes = []) {
  if (!Array.isArray(templates)) return 0;

  const used = new Set();
  for (const raw of reservedCodes) {
    const code = typeof raw === 'string' && /^\d{1,3}$/.test(raw) ? formatTemplateCode(raw) : raw;
    const normalized = typeof code === 'string' ? code.toUpperCase() : null;
    if (normalized) used.add(normalized);
  }
  for (const tpl of templates) {
    if (tpl && typeof tpl.code === 'string' && tpl.code) used.add(tpl.code.toUpperCase());
  }

  let assigned = 0;
  let cursor = USER_TEMPLATE_CODE_START;
  for (const tpl of templates) {
    if (!tpl || typeof tpl !== 'object') continue;
    if (typeof tpl.code === 'string' && tpl.code) continue;
    let next = formatTemplateCode(cursor);
    while (used.has(next)) {
      cursor += 1;
      next = formatTemplateCode(cursor);
    }
    tpl.code = next;
    used.add(next);
    cursor += 1;
    assigned += 1;
  }
  return assigned;
}

/** 按编号（大小写/分隔符不敏感）查找模板 */
function findTemplateByCode(templates, code) {
  const wanted = templateCodeNumber(code);
  if (wanted === null || !Array.isArray(templates)) return null;
  return templates.find((tpl) => tpl && templateCodeNumber(tpl.code) === wanted) || null;
}

/** 列出可用编号（用于"编号不存在"时的提示） */
function listTemplateCodes(templates) {
  if (!Array.isArray(templates)) return [];
  return templates
    .filter((tpl) => tpl && typeof tpl.code === 'string' && tpl.code)
    .map((tpl) => ({ code: tpl.code, name: tpl.name || tpl.id }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * 把用户模板转成聊天/计划链可消费的 plan（与 taskTemplates.tryGenerate 返回结构对齐）。
 * 模板步骤是"采集时固化"的，直接原样回放；不经过 LLM。
 */
function buildPlanFromTemplate(template) {
  if (!template || typeof template !== 'object' || !template.plan || !Array.isArray(template.plan.steps)) {
    return null;
  }
  if (template.plan.steps.length === 0) return null;

  return {
    userIntent: template.plan.userIntent || template.description || template.name || template.id,
    steps: template.plan.steps.map((step, index) => ({
      id: step.id || `step_${index + 1}`,
      title: step.title || step.action || `Step ${index + 1}`,
      action: step.action || '',
      description: step.description || '',
      expectedResult: step.expectedResult || '',
      params: step.params || {},
      commandJson: step.commandJson || null,
      commandNamespace: step.commandNamespace || 'MEPBridge',
      commandName: step.commandName || step.action || '',
      descriptorName: step.descriptorName || null,
      riskLevel: step.riskLevel || 'create-element',
      status: 'pending'
    })),
    source: 'user-template-code',
    templateId: template.id,
    templateCode: template.code || null
  };
}

/**
 * 从消息里解析出"编号直达"的模板计划。
 * @param {string} message 用户输入
 * @param {Array} templates 已合并（含发布包 starter）的用户模板列表
 * @returns {{plan: Object|null, code: string|null, found: boolean}}
 *   code 为 null 表示消息里没有编号；found=false 表示有编号但没找到对应模板（调用方应给出可用编号提示）
 */
function resolveTemplateCodeRequest(message, templates) {
  const code = extractTemplateCode(message);
  if (!code) return { plan: null, code: null, found: false };
  const template = findTemplateByCode(templates, code);
  if (!template) return { plan: null, code, found: false };
  const plan = buildPlanFromTemplate(template);
  if (!plan) return { plan: null, code, found: true };
  plan.templateName = template.name;
  return { plan, code, found: true };
}

module.exports = {
  USER_TEMPLATE_CODE_START,
  CODE_PATTERN,
  BUILTIN_CODE_PREFIX,
  BUILTIN_CODE_PATTERN,
  SUPERSEDED_BY_BUILTIN,
  formatTemplateCode,
  templateCodeNumber,
  extractTemplateCode,
  assignTemplateCodes,
  renumberTemplateCodes,
  dedupeTemplates,
  findTemplateByCode,
  listTemplateCodes,
  buildPlanFromTemplate,
  resolveTemplateCodeRequest,
  builtinCodeForTemplateId,
  formatBuiltinCode,
  builtinIdFromCode,
  extractBuiltinCode,
  parseTemplateCodeRequest
};
