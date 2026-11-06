/**
 * tool-profile-registry.js
 * V19-DISC-01: 渐进式工具发现与 Profile 注册表服务
 *
 * 约束对齐：
 * 1. 严格受控于 command-boundary.json 与 mcpExposure.enabled !== false（可见上限严格为 94 个）。
 * 2. 闭包自洽性（Dependency Closure）：门窗随墙、修剪随查、复杂构件随几何、机电随系统与尺寸。
 * 3. 零 C++ APX 编译依赖。
 */

'use strict';

// 核心命令集合分类映射（包含 C++ commandName 以及服务端专有命令 name）
const PROFILE_COMMAND_SPECS = {
  // 核心轻量（日常单体建模与基本编辑，18 工具）
  core: [
    'CreateWall',
    'CreateColumn',
    'CreateBeam',
    'CreateSlab',
    'CreateDoor',
    'CreateWindow',
    'CreateRoof',
    'MoveElements',
    'RotateSelectedElements',
    'MirrorSelectedElements',
    'DeleteElements',
    'GetElementsByType',
    'GetSelectedElements',
    'GetStories',
    'GetProjectInfo',
    'Ping',
    'BatchCreateElements',
    'SetSelectedElements'
  ],

  // 纯查询与导出审阅（13 工具）
  readonly: [
    'GetProjectInfo',
    'GetStories',
    'GetLayers',
    'GetElementsByType',
    'GetElementGeometry',
    'GetSelectedElements',
    'GetLibraries',
    'GetHotlinks',
    'GetGridElements',
    'GetViewMap',
    'GetSectionMarkers',
    'GetDocumentationElements',
    'Ping'
  ],

  // 机电暖通给排水管线与设备（23 工具）
  mep: [
    'CreatePipe',
    'CreatePipeSystem',
    'CreateDuct',
    'CreateCableCarrier',
    'CreateFlexibleSegment',
    'CreateTakeOff',
    'AutoRoutePipe',
    'SolveConn',
    'ChangeMEPRouteProperties',
    'GetMEPElementInfo',
    'GetMEPAllElements',
    'DeleteMEPElements',
    'ScanStructuralElements',
    'GetAvailableSizes',
    'GetAvailableSystems',
    'FindRoutesByProperty',
    'FindRoutesByProperties',
    'SetRoutesProperties',
    'ViewportCapture',
    'GetElementMesh',
    'GetSelectedElements',
    'GetElementsByType',
    'Ping'
  ],

  // 建筑结构、开洞、幕墙、壳体、复合构件（54 工具）
  architecture: [
    'CreateWall',
    'CreateColumn',
    'CreateBeam',
    'CreateSlab',
    'CreateDoor',
    'CreateWindow',
    'CreateRoof',
    'CreateStair',
    'ChangeStairGeometry',
    'CreateObject',
    'CreateLamp',
    'CreateMesh',
    'CreateZone',
    'CreateMorph',
    'CreateComplexElement',
    'ChangeOpeningGeometry',
    'EditBuildingElement',
    'MoveBuildingElements',
    'TrimElements',
    'CreateSolidOperation',
    'MultiplyElements',
    'GetElementGeometry',
    'GetElementsByType',
    'GetSelectedElements',
    'GetStories',
    'CreateStory',
    'DeleteStory',
    'SetStories',
    'ChangeStorySettings',
    'GetLayers',
    'SetLayerBatch',
    'GetClassifications',
    'AssignClassification',
    'GetElementProperties',
    'SetElementProperty',
    'SetElementProperties',
    'FindElementsByProperty',
    'GetElementPropertyDefinitions',
    'GetProfiles',
    'GetAttributes',
    'GetFavorites',
    'GetFavorite',
    'ApplyFavorite',
    'SaveFavorite',
    'CreateFromFavorite',
    'GetGsmObjectCatalog',
    'CreateText',
    'CreateDimension',
    'CreateLabel',
    'ReadDraftingElements',
    'MoveElements',
    'EditElements',
    'Ping'
  ]
};

// 依赖闭包规则字典：[TriggerCommand] -> [RequiredCommands]
const DEPENDENCY_CLOSURE_RULES = {
  // 门窗洞口强依赖墙体与构件查询
  CreateDoor: ['CreateWall', 'GetElementsByType'],
  CreateWindow: ['CreateWall', 'GetElementsByType'],
  ChangeOpeningGeometry: ['CreateWall', 'GetElementsByType'],

  // 天窗/壳体强依赖屋顶与几何查询
  CreateSkylight: ['CreateRoof', 'GetElementGeometry'],

  // 复杂构件与建筑构件编辑强依赖网格/几何查询
  EditBuildingElement: ['GetElementGeometry', 'GetElementsByType'],
  CreateComplexElement: ['GetElementGeometry'],

  // 布尔运算与修剪强依赖构件或选中查询
  CreateSolidOperation: ['GetElementsByType', 'GetSelectedElements'],
  TrimElements: ['GetElementsByType', 'GetSelectedElements'],

  // 机电管道与风管强依赖可用尺寸与系统定义
  CreatePipe: ['GetAvailableSizes', 'GetAvailableSystems'],
  CreateDuct: ['GetAvailableSizes', 'GetAvailableSystems'],
  AutoRoutePipe: ['GetAvailableSizes', 'GetAvailableSystems'],
  CreateFlexibleSegment: ['GetAvailableSizes', 'GetAvailableSystems'],
  CreateTakeOff: ['GetAvailableSizes', 'GetAvailableSystems']
};

/**
 * 获取描述符的主标识符（优先 commandName，次选 name 纯名）
 * @param {object} desc
 * @returns {string}
 */
function getDescriptorIdentifier(desc) {
  if (!desc) return '';
  if (desc.commandName) return desc.commandName;
  if (desc.name) {
    const parts = desc.name.split('.');
    return parts[parts.length - 1];
  }
  return '';
}

/**
 * 过滤出受控的可见描述符（严格排除 mcpExposure.enabled === false 的隔离命令）
 * 95 注册清单 -> 94 可见清单
 * @param {Array<object>} descriptors
 * @returns {Array<object>}
 */
function getVisibleDescriptors(descriptors = []) {
  return descriptors.filter(d => {
    if (!d) return false;
    if (!d.commandName && !d.name) return false;
    return d.mcpExposure?.enabled !== false;
  });
}

/**
 * 应用依赖闭包算法
 * @param {Set<string>|Array<string>} commandNames
 * @returns {Set<string>}
 */
function applyDependencyClosure(commandNames) {
  const result = new Set(commandNames);
  let changed = true;

  while (changed) {
    changed = false;
    for (const cmd of Array.from(result)) {
      const deps = DEPENDENCY_CLOSURE_RULES[cmd];
      if (deps && Array.isArray(deps)) {
        for (const dep of deps) {
          if (!result.has(dep)) {
            result.add(dep);
            changed = true;
          }
        }
      }
    }
  }

  return result;
}

/**
 * 获取指定 Profile 的可见描述符清单
 * @param {string} profileName - 'full' | 'architecture' | 'mep' | 'core' | 'readonly'
 * @param {Array<object>} allDescriptors
 * @returns {Array<object>}
 */
function getProfileDescriptors(profileName = 'full', allDescriptors = []) {
  const visible = getVisibleDescriptors(allDescriptors);
  const normalizedProfile = (profileName || 'full').toLowerCase();

  // full 模式直接返回全量可见集合（严格 94 个）
  if (normalizedProfile === 'full') {
    return visible;
  }

  const specCmds = PROFILE_COMMAND_SPECS[normalizedProfile];
  if (!specCmds) {
    console.warn(`[ProfileRegistry] Unknown profile "${profileName}", falling back to full.`);
    return visible;
  }

  // 展开依赖闭包
  const closedCommands = applyDependencyClosure(specCmds);

  const known = new Set(visible.map(getDescriptorIdentifier));
  const unknown = [...closedCommands].filter(name => !known.has(name));
  if (unknown.length) throw new Error(`Invalid profile references: ${unknown.join(', ')}`);

  // 从 visible 描述符中筛选（匹配 commandName 或 name）
  return visible.filter(d => {
    if (d.commandName && closedCommands.has(d.commandName)) return true;
    if (d.name) {
      if (closedCommands.has(d.name)) return true;
      const stripped = d.name.replace(/^mepbridge\./, '');
      if (closedCommands.has(stripped)) return true;
    }
    return false;
  });
}

/**
 * 根据用户自然语言输入智能探测建议的 Profile（仅作为提示，不作为硬切断）
 * @param {string} text
 * @returns {string} profileName
 */
function detectProfileFromIntent(text = '') {
  if (!text || typeof text !== 'string') return 'full';
  const t = text.toLowerCase();

  // MEP 关键词
  const mepKeywords = [
    '管道', '风管', '桥架', '给排水', '暖通', '弯头', '三通', '管径', '系统类型', '软管',
    'pipe', 'duct', 'cablecarrier', 'takeoff', 'hvac', 'plumbing', 'mep'
  ];
  if (mepKeywords.some(k => t.includes(k))) {
    return 'mep';
  }

  // 纯审阅/查询关键词
  const readonlyKeywords = [
    '查看', '查询', '导出', '项目信息', '图层列表', '楼层列表', '构件数量', '审阅', '质检',
    'get stories', 'list layers', 'check elements', 'inspect'
  ];
  if (readonlyKeywords.some(k => t.includes(k)) && !t.includes('建') && !t.includes('改') && !t.includes('删除')) {
    return 'readonly';
  }

  // 建筑专修关键词
  const archKeywords = [
    '墙', '柱', '梁', '板', '屋顶', '门', '窗', '幕墙', '壳体', '栏杆', '楼梯', '修剪', '布尔',
    'wall', 'column', 'beam', 'slab', 'roof', 'door', 'window', 'curtainwall', 'shell', 'railing', 'stair'
  ];
  if (archKeywords.some(k => t.includes(k))) {
    return 'architecture';
  }

  return 'full';
}

/**
 * 校验生成的计划步骤是否超出当前 Profile 范围
 * @param {object} plan
 * @param {Array<object>} profileDescriptors
 * @returns {{ valid: boolean, missingCommands: string[] }}
 */
function validatePlanAgainstProfile(plan, profileDescriptors = []) {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { valid: false, missingCommands: ['<empty-plan>'] };
  }
  const { resolvePlanCommand } = require('./semantic-fidelity-gate');
  const allowed = new Set(getVisibleDescriptors(profileDescriptors).map(getDescriptorIdentifier));
  const missing = [];
  for (const step of plan.steps) {
    if (!step || typeof step !== 'object') { missing.push('<invalid-step>'); continue; }
    const payload = resolvePlanCommand(step);
    const id = payload?.parameters?.addOnCommandId;
    const name = payload?.command === 'API.ExecuteAddOnCommand' ? id?.commandName : payload?.command;
    const alias = value => typeof value === 'string' ? value.replace(/^mepbridge\./, '') : value;
    if (!name || !allowed.has(alias(name)) || (id && id.commandNamespace !== 'MEPBridge') ||
        (step.action && alias(step.action) !== alias(name)) ||
        (step.commandName && alias(step.commandName) !== alias(name)) ||
        (step.commandNamespace && id && step.commandNamespace !== id.commandNamespace)) missing.push(name || '<missing-command>');
  }
  return { valid: missing.length === 0, missingCommands: [...new Set(missing)] };
}

module.exports = {
  PROFILE_COMMAND_SPECS,
  DEPENDENCY_CLOSURE_RULES,
  getDescriptorIdentifier,
  getVisibleDescriptors,
  applyDependencyClosure,
  getProfileDescriptors,
  detectProfileFromIntent,
  validatePlanAgainstProfile
};
