'use strict';

/**
 * semantic-fidelity-gate.js
 * V19-SEM-01: 跨入口语义保真与防静默降级门禁 (SemanticFidelityGate)
 *
 * 权威契约：
 *   - MEPBRIDGE_ARCHITECTURE_OPTIMIZATION_PLAN_20261020 §3.5.4
 *   - V019_ITERATION_PLAN_20261023 §4.3 (V19-SEM-01) 与 §5.5④
 *
 * 核心规范：
 *   1. 冻结受支持的原生建筑构件类型：
 *      Wall, Column, Beam, Slab, Roof, Window, Door, CurtainWall, Shell, Railing, Skylight, Zone, Mesh
 *   2. 严禁静默降级：
 *      来源或意图为原生建筑构件时，若目标为 CreateMorph 或 Morph，一律拦截并返回 SEMANTIC_DEGRADATION_BLOCKED。
 *   3. 显式代理许可：
 *      仅当调用方/步骤显式提供 allowProxyMorph: true 或 proxyPolicy: 'allow_proxy_morph' 时，
 *      才允许以 Morph 代理创建，并必须附加可编辑性损失警示。
 *   4. 原生对偶匹配：
 *      Wall -> CreateWall, Column -> CreateColumn, Beam -> CreateBeam, Slab -> CreateSlab,
 *      Roof -> CreateRoof, Door -> CreateDoor, Window -> CreateWindow, etc.
 *      跨原生类型错配（如意图为 Wall 却调用 CreateBeam）且未声明转换时返回 SEMANTIC_TYPE_MISMATCH。
 */

const NATIVE_ELEMENT_TYPES = new Set([
  'Wall',
  'Column',
  'Beam',
  'Slab',
  'Roof',
  'Window',
  'Door',
  'CurtainWall',
  'Shell',
  'Railing',
  'Skylight',
  'Zone',
  'Mesh'
]);

const NATIVE_COMMAND_MAP = {
  Wall: 'CreateWall',
  Column: 'CreateColumn',
  Beam: 'CreateBeam',
  Slab: 'CreateSlab',
  Roof: 'CreateRoof',
  Window: 'CreateWindow',
  Door: 'CreateDoor',
  Zone: 'CreateZone',
  Mesh: 'CreateMesh'
};

const COMMAND_TO_NATIVE_TYPE = {
  CreateWall: 'Wall',
  CreateColumn: 'Column',
  CreateBeam: 'Beam',
  CreateSlab: 'Slab',
  CreateRoof: 'Roof',
  CreateWindow: 'Window',
  CreateDoor: 'Door',
  CreateZone: 'Zone',
  CreateMesh: 'Mesh',
  CreateCurtainWall: 'CurtainWall',
  CreateShell: 'Shell',
  CreateRailing: 'Railing',
  CreateSkylight: 'Skylight'
};

function normalizeTypeName(type) {
  if (!type || typeof type !== 'string') return '';
  const trimmed = type.trim();
  if (trimmed.toLowerCase() === 'morph') return 'Morph';
  for (const native of NATIVE_ELEMENT_TYPES) {
    if (native.toLowerCase() === trimmed.toLowerCase()) return native;
  }
  return trimmed;
}

/**
 * 校验构件语义保真
 * @param {Object} options
 * @param {string} [options.sourceType] - 来源或预期构件类型 (e.g. 'Wall', 'CurtainWall')
 * @param {string} options.targetCommand - 目标调用的命令名 (e.g. 'CreateMorph', 'CreateWall')
 * @param {string} [options.targetType] - 目标元素类型 (e.g. 'Morph', 'Wall')
 * @param {boolean} [options.allowProxyMorph] - 是否显式允许 Morph 代理
 * @param {string} [options.proxyPolicy] - 代理策略
 * @param {Object} [options.metadata] - 附加元数据
 * @returns {Object} { allowed: boolean, fidelity: 'native'|'proxy', errorType?, message?, detail? }
 */
function checkSemanticFidelity({ sourceType, targetCommand, targetType, allowProxyMorph, proxyPolicy, metadata } = {}) {
  const normSource = normalizeTypeName(sourceType);
  const normTargetType = normalizeTypeName(targetType);
  const cmd = String(targetCommand || '').trim();

  const isProxyAllowed = allowProxyMorph === true || proxyPolicy === 'allow_proxy_morph';
  const isTargetingMorph = cmd === 'CreateMorph' || normTargetType.toLowerCase() === 'morph';

  // 1. 防静默降级核心拦截：若来源是原生建筑构件，而目标是 Morph
  if (normSource && NATIVE_ELEMENT_TYPES.has(normSource) && isTargetingMorph) {
    if (!isProxyAllowed) {
      return {
        allowed: false,
        errorType: 'SEMANTIC_DEGRADATION_BLOCKED',
        message: `禁止将原生构件类型「${normSource}」静默降级为 Morph。若确需使用不可编辑的代理几何，请显式提供 allowProxyMorph: true 并记录可编辑性损失声明。`,
        detail: {
          sourceType: normSource,
          targetCommand: cmd,
          targetType: normTargetType || 'Morph',
          allowProxyMorph: false
        }
      };
    }
    return {
      allowed: true,
      fidelity: 'proxy',
      warning: `构件「${normSource}」以 Morph 代理创建，原生参数化与专属编辑能力已受损`,
      detail: {
        sourceType: normSource,
        targetCommand: cmd,
        fidelityLossAcknowledged: true
      }
    };
  }

  // 2. 原生类型错配拦截（如来源是 Wall 却调用 CreateBeam，且未标记允许转换）
  if (normSource && NATIVE_ELEMENT_TYPES.has(normSource) && (COMMAND_TO_NATIVE_TYPE[cmd] || (['BatchCreateElements', 'CreateComplexElement'].includes(cmd) && normTargetType))) {
    const expectedType = COMMAND_TO_NATIVE_TYPE[cmd] || normTargetType;
    if (expectedType !== normSource && metadata?.allowTypeConversion !== true) {
      return {
        allowed: false,
        errorType: 'SEMANTIC_TYPE_MISMATCH',
        message: `构件语义类型错配：预期类型为「${normSource}」，但调用的命令「${cmd}」针对的是「${expectedType}」`,
        detail: {
          sourceType: normSource,
          commandExpectedType: expectedType,
          targetCommand: cmd
        }
      };
    }
  }

  return {
    allowed: true,
    fidelity: 'native',
    detail: {
      sourceType: normSource || null,
      targetCommand: cmd
    }
  };
}

/**
 * 针对单个命令请求校验语义保真
 */
// Resolve the exact PlanChain payload once; never validate a parallel params object.
function resolvePlanCommand(step) {
  const payload = step.commandJson || {
    command: 'API.ExecuteAddOnCommand',
    parameters: {
      addOnCommandId: { commandNamespace: step.commandNamespace || 'MEPBridge', commandName: step.action },
      addOnCommandParameters: step.params || {}
    }
  };
  return JSON.parse(JSON.stringify(payload));
}
// Keep the step envelope separate from the exact command envelope: conflicting
// declarations must be compared, not overwritten while forwarding to /execute.
const PLAN_ENVELOPE_FIELDS = [
  'sourceType', 'originalType', 'semanticType', 'intentType', 'intent', 'elementType', 'targetType',
  'allowProxyMorph', 'proxyPolicy', 'metadata', 'targetPort', 'instancePort', 'targetProject',
  'targetInstanceId', 'instanceId', 'targetInstance', 'expectedProjectPathHash', 'projectPathHash',
  'targetFingerprint', 'expectedFingerprint', 'expectedArchicadVersion', 'archicadVersion', 'projectPath', 'projectName'
];
function resolvePlanRequest(step, payload = resolvePlanCommand(step)) {
  const request = { command: payload };
  for (const field of PLAN_ENVELOPE_FIELDS) if (step[field] !== undefined) request[field] = step[field];
  return JSON.parse(JSON.stringify(request));
}
function validatePlanStepSemanticFidelity(step) {
  const payload = resolvePlanCommand(step);
  return validateCommandSemanticFidelity(payload.parameters?.addOnCommandId?.commandName || payload.command,
    payload.parameters?.addOnCommandParameters || payload.parameters || {}, resolvePlanRequest(step, payload));
}
function validateCommandSemanticFidelity(commandName, parameters = {}, body = {}) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  parameters = object(parameters);
  const containers = [object(body), object(body.command), object(body.commandJson), object(body.params), object(body.parameters), parameters];
  const actualType = COMMAND_TO_NATIVE_TYPE[commandName] || (commandName === 'CreateMorph' ? 'Morph' : parameters.elementType);
  function check(containers) {
    const sources = containers.flatMap(obj => [obj.sourceType, obj.originalType, obj.semanticType,
      obj.intentType, typeof obj.intent === 'string' ? obj.intent : obj.intent?.elementType,
      obj.intent?.sourceType, commandName !== 'BatchCreateElements' ? obj.elementType : undefined])
      .filter(v => typeof v === 'string' && v.trim()).map(normalizeTypeName);
    if (new Set(sources).size > 1) return { allowed: false, errorType: 'SEMANTIC_TYPE_MISMATCH', message: 'Conflicting source/intent types', detail: { sources } };
    const targets = [actualType, ...containers.flatMap(obj => [obj.targetType, commandName === 'BatchCreateElements' ? obj.elementType : undefined])]
      .filter(Boolean).map(normalizeTypeName);
    if (new Set(targets).size > 1) return { allowed: false, errorType: 'SEMANTIC_TYPE_MISMATCH', message: 'Declared target differs from outbound native type', detail: { targets } };
    return checkSemanticFidelity({
      sourceType: sources[0], targetCommand: commandName, targetType: actualType || targets[0],
      allowProxyMorph: !containers.some(obj => obj.allowProxyMorph === false) && containers.some(obj => obj.allowProxyMorph === true || obj.proxyPolicy === 'allow_proxy_morph'),
      metadata: { allowTypeConversion: !containers.some(obj => obj.metadata?.allowTypeConversion === false) && containers.some(obj => obj.metadata?.allowTypeConversion === true) }
    });
  }
  // BatchCreateElements uses the ROOT elementType for every item. Never let an
  // item shadow it (or a root source declaration) just for semantic validation.
  if (commandName === 'BatchCreateElements' && Array.isArray(parameters.items) && parameters.items.length) {
    let result = { allowed: true, fidelity: 'native' };
    for (let index = 0; index < parameters.items.length; index++) {
      const decision = check([...containers, object(parameters.items[index])]);
      if (!decision.allowed) return { ...decision, detail: { ...decision.detail, itemIndex: index } };
      if (decision.warning) result = { ...decision, detail: { ...decision.detail, batch: true } };
    }
    return result;
  }
  return check(containers);
}

/**
 * 针对 AI Plan-Chain 整链或单步骤校验语义保真
 */
function validatePlanSemanticFidelity(plan, options = {}) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : (Array.isArray(plan) ? plan : [plan]);
  const issues = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const check = validatePlanStepSemanticFidelity({ ...step, action: step.action || step.command || step.commandName, params: step.params || step.parameters || {} });
    if (!check.allowed) {
      issues.push({
        stepIndex: i,
        stepName: step.name || `Step ${i + 1}`,
        errorType: check.errorType,
        message: check.message,
        detail: check.detail
      });
    }
  }

  if (issues.length > 0) {
    return {
      allowed: false,
      errorType: 'PLAN_SEMANTIC_FIDELITY_FAILED',
      message: `计划存在 ${issues.length} 处语义降级或类型违规`,
      issues
    };
  }

  return { allowed: true };
}

module.exports = {
  NATIVE_ELEMENT_TYPES,
  NATIVE_COMMAND_MAP,
  COMMAND_TO_NATIVE_TYPE,
  checkSemanticFidelity,
  validateCommandSemanticFidelity,
  validatePlanSemanticFidelity,
  normalizeTypeName,
  resolvePlanCommand,
  resolvePlanRequest,
  validatePlanStepSemanticFidelity
};
