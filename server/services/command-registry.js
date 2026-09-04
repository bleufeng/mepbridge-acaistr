// command-registry.js
// P1-04（AUD-2）：Gate1 命令白名单与风险等级的**唯一权威来源**。
//
// 背景：Gate1 此前只检查 action / commandNamespace 是否存在，而 commandNamespace 有
// 'MEPBridge' 默认值、永不为空 —— 于是任何字符串都能当命令名通过闸门，直到 C++ 侧才
// 因未注册而失败；同时 step.riskLevel 由 LLM 提供且被无条件采信，`riskLevel:'read'`
// 配 `DeleteElements` 会让高风险写入直接 autoRun 并跳过 Gate2/Gate3。
//
// 白名单由两处派生，不再手工维护第四份清单：
//   1. ai-adapter/tool-descriptors.json 中 executionKind='mepbridge-addon-command' 的
//      commandName（74 条），同时提供权威 riskLevel；
//   2. command-capabilities.js 的两个 mutation 集合 —— 它由 tests/test-command-capabilities.js
//      与 Sources/ 逐条比对，覆盖没有 descriptor 的 C++ 命令（如 ChangeStairGeometry）。
//
// 已知缺口：SwitchStory 既无 descriptor 也不读 dryRun，两处都不覆盖，因此会被 Gate1 拒绝。
// 这是注册表缺口而非本模块缺陷：补 descriptor 会改变 addon-command 计数并触发 APX 重编，
// 不在零 APX 窗口内处理，已登记为路线图待办。
//
// 失败取向：注册表读不出来时**拒绝一切命令**（fail-closed）并给出原因。安全闸门无法
// 查询其依据时放行等于没有闸门；此处宁可整链停摆也不静默放宽。

const fs = require('fs');
const path = require('path');

const {
  DRY_RUN_AND_CONFIRM_COMMANDS,
  CONFIRM_ONLY_COMMANDS,
} = require('./command-capabilities');

const REGISTRY_FILE = path.join(__dirname, '../../ai-adapter/tool-descriptors.json');

// 风险等级排序（从低到高）。与 plan-chain-engine 共用，避免两份顺序表漂移。
const RISK_LEVEL_ORDER = Object.freeze([
  'read',                    // 只读查询
  'create-element',          // 创建元素
  'low-mutation',            // 低风险修改
  'medium-mutation',         // 中等风险修改（旋转/镜像）
  'high-mutation',           // 高风险修改
  'batch-create',            // 批量创建
  'delete-all',              // 删除全部
  'irreversible',            // 不可逆操作
]);

// descriptor 注册表用了两个不在上表内的历史值。此前 RISK_LEVEL_ORDER.indexOf() 对它们
// 返回 -1，比 'read' 还低 —— 于是 9 条真实写命令（4 条 mutation + 5 条 write）在
// gate2/gate3 的 'high-risk' 策略下全部逃过闸门。别名映射到各自当前**有效**待遇的同级
// 或更严一级，只会更严不会更松。
const RISK_ALIASES = Object.freeze({
  mutation: 'medium-mutation',   // CreatePipe / CreateDuct / CreateCableCarrier / CreatePipeSystem
  write: 'low-mutation',         // AssignClassification / ApplyFavorite / SaveFavorite / SetLayerBatch / CreateFromFavorite
});

function canonicalRiskLevel(level) {
  if (typeof level !== 'string') return null;
  const alias = RISK_ALIASES[level];
  const resolved = alias || level;
  return RISK_LEVEL_ORDER.includes(resolved) ? resolved : null;
}

/**
 * 风险等级序号。未知值返回**最高**序号而非 -1：未知等级是"无法判断"，
 * 按最危险处理才能保证任何闸门策略都不会因为一个拼错的字符串而被绕过。
 */
function riskOrder(level) {
  const canonical = canonicalRiskLevel(level);
  if (canonical === null) return RISK_LEVEL_ORDER.length;
  return RISK_LEVEL_ORDER.indexOf(canonical);
}

/** 取两个风险等级中较高者（用于"不得降级"）。 */
function maxRiskLevel(a, b) {
  const ca = canonicalRiskLevel(a);
  const cb = canonicalRiskLevel(b);
  if (ca === null) return cb;
  if (cb === null) return ca;
  return riskOrder(ca) >= riskOrder(cb) ? ca : cb;
}

let cache = null;

function loadRegistry() {
  if (cache) return cache;

  const commands = new Map();   // commandName -> { riskLevel, descriptorName }
  let error = null;

  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    const descriptors = Array.isArray(raw.descriptors) ? raw.descriptors : [];
    if (descriptors.length === 0) {
      throw new Error('descriptors array is empty');
    }
    for (const descriptor of descriptors) {
      if (descriptor.executionKind !== 'mepbridge-addon-command') continue;
      if (!descriptor.commandName) continue;
      commands.set(descriptor.commandName, {
        riskLevel: canonicalRiskLevel(descriptor.riskLevel),
        descriptorName: descriptor.name || null,
      });
    }
  } catch (e) {
    error = `command registry unavailable (${REGISTRY_FILE}): ${e.message}`;
  }

  if (!error) {
    // 补齐没有 descriptor 但 C++ 确实注册的 mutation 命令。能力表本身受
    // tests/test-command-capabilities.js 与 Sources/ 的比对约束，是可信来源。
    for (const name of [...DRY_RUN_AND_CONFIRM_COMMANDS, ...CONFIRM_ONLY_COMMANDS]) {
      if (!commands.has(name)) {
        commands.set(name, { riskLevel: null, descriptorName: null });
      }
    }
  }

  cache = { commands, error };
  return cache;
}

/** 命令是否在注册表内。注册表不可用时返回 false（fail-closed）。 */
function isKnownCommand(commandName) {
  if (typeof commandName !== 'string' || commandName === '') return false;
  return loadRegistry().commands.has(commandName);
}

/**
 * 注册表声明的风险等级（已规范化）。未注册或注册表未声明时返回 null，
 * 由调用方回落到自身推断 —— 不返回 'read'，避免"查不到"被当成"安全"。
 */
function getRegistryRiskLevel(commandName) {
  const entry = loadRegistry().commands.get(commandName);
  return entry ? entry.riskLevel : null;
}

/** 注册表加载错误信息；正常时为 null。供闸门在拒绝时给出可诊断原因。 */
function getRegistryError() {
  return loadRegistry().error;
}

function getKnownCommandNames() {
  return [...loadRegistry().commands.keys()].sort();
}

module.exports = {
  RISK_LEVEL_ORDER,
  RISK_ALIASES,
  canonicalRiskLevel,
  riskOrder,
  maxRiskLevel,
  isKnownCommand,
  getRegistryRiskLevel,
  getRegistryError,
  getKnownCommandNames,
  _test: { REGISTRY_FILE, resetCache: () => { cache = null; } },
};
