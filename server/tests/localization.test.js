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

function main() {
  const chinese = readStarterAssets('zh-CN');
  const english = readStarterAssets('en-US');

  assert.strictEqual(chinese.templates.length, 5);
  assert.strictEqual(chinese.commands.length, 5);
  assert.strictEqual(english.templates.length, chinese.templates.length);
  assert.strictEqual(english.commands.length, chinese.commands.length);
  assertNoCjk('English starter assets', english);

  assert.match(
    userAssetsTest.getStarterAssetsFile('en-US'),
    /mepbridge-starter-user-assets\.en-US\.json$/
  );
  assert.match(
    userAssetsTest.getStarterAssetsFile('invalid-locale'),
    /mepbridge-starter-user-assets\.zh-CN\.json$/
  );

  const localizedEnglish = userAssetsTest.localizeStarterAssets(chinese, 'en-US');
  assert.strictEqual(localizedEnglish.templates.length, 5);
  assert.strictEqual(localizedEnglish.commands.length, 5);
  assertNoCjk('Localized starter assets', localizedEnglish);

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
  ];

  for (const prompt of englishPrompts) {
    const plan = taskTemplates.tryGenerate(prompt, { locale: 'en-US' });
    assert.ok(plan, `Expected an English task template for: ${prompt}`);
    assert.ok(plan.steps.length > 0, `Expected generated steps for: ${prompt}`);
    assertNoCjk(`English task template "${prompt}"`, plan);
  }

  const englishList = taskTemplates.list('en-US');
  assert.strictEqual(englishList.length, 12);
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
