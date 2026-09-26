const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mepbridge-localization-'));
process.env.MEPBRIDGE_DATA_DIR = TEST_DATA_DIR;

const taskTemplates = require('../services/task-templates');
const { _test: userAssetsTest } = require('../routes/user-assets');

const CJK_PATTERN = /[\u3400-\u9fff]/;
const WORKSPACE_ROOT = path.resolve(__dirname, '../..');

function readStarterAssets(locale) {
  const filePath = path.join(
    WORKSPACE_ROOT,
    'examples',
    'user-assets',
    `mepbridge-starter-user-assets.${locale}.json`
  );
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectVisibleStrings(value, parentKey = '') {
  if (typeof value === 'string') {
    if ([
      'id',
      'action',
      'command',
      'commandName',
      'commandNamespace',
      'descriptorName',
      'riskLevel',
      'schemaVersion',
      'appVersion',
      'createdAt',
      'updatedAt',
      'exportedAt',
      'version',
    ].includes(parentKey)) {
      return [];
    }
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectVisibleStrings(item, parentKey));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => collectVisibleStrings(item, key));
  }

  return [];
}

function assertNoCjk(label, value) {
  const strings = collectVisibleStrings(value);
  const offenders = strings.filter((item) => CJK_PATTERN.test(item));
  assert.deepStrictEqual(offenders, [], `${label} contains CJK text: ${offenders.join(' | ')}`);
}

function getTemplate(assets, templateId) {
  const template = assets.templates.find((item) => item.id === templateId);
  assert.ok(template, `Missing starter template: ${templateId}`);
  return template;
}

function assertVerifiedStarterMutationTemplates(label, assets) {
  // ① tpl-starter-scan-structure：读取类示例（扫描结构构件 AABB）。
  //    2026-09-18 修正：该 id 曾错位装着"创建示例楼板(CreateSlab)"，与 id/名称语义不符；
  //    楼板示例由出厂模板 SYS-004 承载，此处回归为扫描语义。
  const scan = getTemplate(assets, 'tpl-starter-scan-structure');
  assert.strictEqual(scan.plan.steps.length, 1, `${label} scan template should have one step`);
  assert.strictEqual(scan.plan.steps[0].action, 'ScanStructuralElements');
  assert.strictEqual(scan.plan.steps[0].commandJson.parameters.addOnCommandId.commandName, 'ScanStructuralElements');
  assert.deepStrictEqual(scan.plan.steps[0].params.types, ['Wall', 'Column', 'Beam']);

  // ② tpl-starter-partition-walls：两道 3m 示例隔墙（曾错位装着 CreateCableCarrier）。
  const partition = getTemplate(assets, 'tpl-starter-partition-walls');
  assert.strictEqual(partition.plan.steps.length, 2, `${label} partition template should have two steps`);
  partition.plan.steps.forEach((step) => {
    assert.strictEqual(step.action, 'CreateWall');
    assert.strictEqual(step.commandJson.parameters.addOnCommandId.commandName, 'CreateWall');
    assert.strictEqual(step.commandJson.parameters.addOnCommandParameters.dryRun, false);
    assert.strictEqual(step.params.thickness, 0.12);
    assert.strictEqual(step.params.height, 3);
    assert.strictEqual(step.params.dryRun, false);
    assert.strictEqual(step.params.confirmRequired, true);
  });

  // ③ MEP 系统标识必须由项目默认解析，不得写死（原断言只覆盖电缆桥架示例；
  //    该示例已由出厂模板承载后，规则改为对**全部** starter 步骤生效，约束不弱化）。
  for (const template of assets.templates || []) {
    for (const step of (template.plan && template.plan.steps) || []) {
      const params = step.params || {};
      const commandParams = (step.commandJson && step.commandJson.parameters
        && step.commandJson.parameters.addOnCommandParameters) || {};
      for (const key of ['mepSystemIndex', 'mepSystemName']) {
        assert.strictEqual(params[key], undefined, `${label}/${template.id} must not hardcode ${key} (project/version-specific)`);
        assert.strictEqual(commandParams[key], undefined, `${label}/${template.id} commandJson must not hardcode ${key}`);
      }
    }
  }
}

const STARTER_TEMPLATE_IDS = [
  'tpl-starter-project-overview',
  'tpl-starter-read-selection',
  'tpl-starter-room-walls',
  'tpl-starter-scan-structure',
  'tpl-starter-partition-walls',
  'tpl-starter-replicate-stair',
  'tpl-starter-create-shell-on-floors',
  'tpl-starter-create-elevated-mesh',
  'tpl-starter-create-extruded-morph',
  'tpl-starter-create-wall-from-favorite',
  'tpl-starter-create-structural-member-from-profile',
  'tpl-starter-batch-set-layer',
  'tpl-starter-assign-classification',
];

function main() {
  const chinese = readStarterAssets('zh-CN');
  const english = readStarterAssets('en-US');

  assert.deepStrictEqual(
    chinese.templates.map((template) => template.id),
    STARTER_TEMPLATE_IDS
  );
  assert.strictEqual(chinese.commands.length, 5);
  assert.deepStrictEqual(
    english.templates.map((template) => template.id),
    STARTER_TEMPLATE_IDS
  );
  assert.strictEqual(english.commands.length, chinese.commands.length);
  assertNoCjk('English starter assets', english);
  assertVerifiedStarterMutationTemplates('Chinese starter assets', chinese);
  assertVerifiedStarterMutationTemplates('English starter assets', english);

  assert.match(
    userAssetsTest.getStarterAssetsFile('en-US'),
    /mepbridge-starter-user-assets\.en-US\.json$/
  );
  assert.match(
    userAssetsTest.getStarterAssetsFile('invalid-locale'),
    /mepbridge-starter-user-assets\.zh-CN\.json$/
  );

  const localizedEnglish = userAssetsTest.localizeStarterAssets(chinese, 'en-US');
  assert.deepStrictEqual(
    localizedEnglish.templates.map((template) => template.id),
    STARTER_TEMPLATE_IDS
  );
  assert.strictEqual(localizedEnglish.commands.length, 5);
  assertNoCjk('Localized starter assets', localizedEnglish);
  assertVerifiedStarterMutationTemplates('Localized English starter assets', localizedEnglish);

  // 2026-09-18: 用户对内置模板的修改不得被发布包 starter 静默回滚。
  // 回归来源：更新「在第 2/3 层创建外墙与楼板」的楼板/墙高后，/api/user-assets/load 仍返回旧版。
  const editedId = 'tpl-starter-create-shell-on-floors';
  const userEdited = JSON.parse(JSON.stringify(chinese));
  const editedTemplate = userEdited.templates.find((template) => template.id === editedId);
  editedTemplate.updatedAt = '2030-01-01T00:00:00.000Z';
  editedTemplate.plan = { ...editedTemplate.plan, steps: [{ id: 'user-edited', action: 'GetStories', params: {} }] };
  const keepEdited = userAssetsTest.localizeStarterAssets(userEdited, 'zh-CN');
  assert.strictEqual(
    keepEdited.templates.find((template) => template.id === editedId).plan.steps.length,
    1,
    'user-edited starter template must survive starter localisation (newer updatedAt wins)'
  );

  // 反向：发布包更新（starter 更新）仍应下发给用户，不能被旧存储值挡住。
  const staleStored = JSON.parse(JSON.stringify(chinese));
  const staleTemplate = staleStored.templates.find((template) => template.id === editedId);
  staleTemplate.updatedAt = '2000-01-01T00:00:00.000Z';
  staleTemplate.plan = { ...staleTemplate.plan, steps: [{ id: 'stale', action: 'GetStories', params: {} }] };
  const refreshed = userAssetsTest.localizeStarterAssets(staleStored, 'zh-CN');
  assert.ok(
    refreshed.templates.find((template) => template.id === editedId).plan.steps.length > 1,
    'packaged starter updates must still reach users when the stored copy is older'
  );

  const englishPrompts = [
    'sample house',
    'ground floor duct',
    'sample stair',
    'create slab',
    'create roof',
    'create pipe',
    'create duct',
    'cable tray',
    'create column',
    'create beam',
    'move selected elements',
    'rotate selected elements',
    'create shell on floors',
  ];

  for (const prompt of englishPrompts) {
    const plan = taskTemplates.tryGenerate(prompt, { locale: 'en-US' });
    assert.ok(plan, `Expected an English task template for: ${prompt}`);
    assert.ok(plan.steps.length > 0, `Expected generated steps for: ${prompt}`);
    assertNoCjk(`English task template "${prompt}"`, plan);
  }

  const englishList = taskTemplates.list('en-US');
  assert.strictEqual(englishList.length, 20);
  assertNoCjk('English task template catalog', englishList);

  const chinesePlan = taskTemplates.tryGenerate('创建楼板', { locale: 'zh-CN' });
  assert.ok(chinesePlan);
  assert.match(chinesePlan.userIntent, CJK_PATTERN);
}

try {
  main();
  console.log('localization test passed');
} finally {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}
