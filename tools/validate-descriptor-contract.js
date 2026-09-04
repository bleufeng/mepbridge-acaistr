'use strict';

// Descriptor 契约校验（featureArea 分类法）
//
// 背景：SYNC-2「模块归属定义」原本只是 markdown checklist 上的一个复选框，
// 全仓无任何代码执行点（同族 SYNC-3 在 server/routes/user-assets.js 有真实白名单校验）。
// 靠人工纪律维护的不变量必然漂移 —— 实证：改造前 tool-descriptors.json 的顶层
// `domain` 字段零校验、零消费方，已经漂出一个孤例值 "Modify"（mepbridge.set_layer_batch）。
//
// 本校验器给该分类法落一个真实执行点。它被公开仓 CI（.github/workflows/public-check.yml）
// 执行，因此必须位于 tools/ 且加入 Export-C2PublicRepository.ps1 的白名单 —— tools/ 是
// 逐文件白名单，tests/ 只放行 test-command-capabilities.js，放在 tests/ 下的校验 CI 跑不到。
//
// 命名说明：字段名从 `domain` 改为 `featureArea`，因为 `descriptor.domain` 与
// `descriptor.paramExtractors.domain`（MEP 参数 Piping/Ventilation/CableCarrier）在同一
// 文件内两级同名，4 条 descriptor 同时存在两者。`featureArea` 描述分类法而非所有权，
// 也避免与 modules/registry.json 的「module=沙箱插件」概念相撞。

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Cannot read ${relativePath}: ${error.message}`);
    return null;
  }
}

// 闭合枚举。新增取值必须同时更新此处与 tests/test-descriptor-contract.js 的不变量测试。
// Workspace 为跨文件/多实例能力预留（server 侧工具）。
//
// 四值定案（2026-08-23）：不采纳 attributes/view/file-io 之类的细分 —— 那些是操作维度
// 而非功能域，属性/视图/文件 IO 在建筑域与 MEP 域都存在（实测：属性类 11 条横跨
// Architecture 7 + MEP 4）。混入操作维度会重现「一个字段承载两种语义」的歧义，
// 而这正是本字段改名要消除的问题。重启条件见规划文档：出现第一个真实运行时消费方时带数据重审。
const FEATURE_AREAS = Object.freeze(['Architecture', 'MEP', 'Project', 'Workspace']);

// executionKind 决定 MCP server 如何分派该工具，必须闭合。
// 取值与 operation-plan schema 中的既有声明保持一致，外加 server-endpoint ——
// 它描述「由本地 Server 的 HTTP 端点承载、不经 Add-On」的工具。
// mepbridge_ping 事实上已属这一类（直接调 /api/ping），但目前是 executeTool 里的硬编码
// 特例而非按 executionKind 分派；跨文件/多实例批次的 server 侧工具应统一走该取值。
const EXECUTION_KINDS = Object.freeze([
  'mepbridge-addon-command',
  'official-archicad-json-command',
  'controller-composite',
  'server-endpoint',
]);

// D-4 的四个 server-endpoint 工具是 featureArea=Workspace 约定的第一批真实使用者。
// 固定名单防止后续新增/移除 server 工具时静默绕过该分类原则。
const SERVER_TOOL_NAMES = Object.freeze([
  'mepbridge.list_archicad_instances',
  'mepbridge.snapshot_elements',
  'mepbridge.compare_snapshot',
  'mepbridge.replay_snapshot',
]);

// 仅在直接执行时校验。被 require 时只导出枚举，避免测试导入常量却触发整轮校验副作用。
if (require.main === module) {
  main();
}

function main() {
const descriptorRegistry = readJson('ai-adapter/tool-descriptors.json');
const moduleRegistry = readJson('modules/registry.json');
const commandBoundary = readJson('ai-adapter/command-boundary.json');

if (descriptorRegistry) {
  const descriptors = Array.isArray(descriptorRegistry.descriptors) ? descriptorRegistry.descriptors : null;
  if (!descriptors) {
    fail('ai-adapter/tool-descriptors.json must contain a descriptors array.');
  } else {
    for (const descriptor of descriptors) {
      const name = descriptor && descriptor.name ? descriptor.name : '(unnamed descriptor)';

      if (!('featureArea' in descriptor)) {
        fail(`${name} is missing the required featureArea field.`);
        continue;
      }
      if (!FEATURE_AREAS.includes(descriptor.featureArea)) {
        fail(`${name} has featureArea '${descriptor.featureArea}', which is not one of: ${FEATURE_AREAS.join(', ')}.`);
      }
      // server 工具跨文件/多实例，把功能域混同执行通道会破坏 featureArea 与
      // executionKind 的正交性；这也是 Workspace 枚举值的既定用途。
      if (descriptor.executionKind === 'server-endpoint' && descriptor.featureArea !== 'Workspace') {
        fail(`${name} is a server-endpoint tool and must use featureArea 'Workspace'.`);
      }
      // 防回退：旧字段名不得复活，否则两级同名问题重现
      if ('domain' in descriptor) {
        fail(`${name} still carries the legacy top-level 'domain' field; use featureArea instead.`);
      }

      if (!('executionKind' in descriptor)) {
        fail(`${name} is missing the required executionKind field.`);
      } else if (!EXECUTION_KINDS.includes(descriptor.executionKind)) {
        fail(`${name} has executionKind '${descriptor.executionKind}', which is not one of: ${EXECUTION_KINDS.join(', ')}.`);
      }

      // Add-On 命令必须指名道姓；server-endpoint 类工具没有 C++ 命令，不得伪造命名空间。
      if (descriptor.executionKind === 'mepbridge-addon-command') {
        if (!descriptor.commandNamespace || !descriptor.commandName) {
          fail(`${name} is a mepbridge-addon-command but lacks commandNamespace/commandName.`);
        }
        if ('serverEndpoint' in descriptor) {
          fail(`${name} is a mepbridge-addon-command but declares serverEndpoint; that field belongs to server-endpoint tools only.`);
        }
      }

      // server-endpoint 必须声明它打哪个端点，否则 MCP server 无法分派。
      // 反之它没有 C++ 命令，携带 commandNamespace/commandName 即谎报 ——
      // NS-01 类「按命名空间计数」的断言会把 server 工具误计为 Add-On 命令。
      if (descriptor.executionKind === 'server-endpoint') {
        if ('commandNamespace' in descriptor || 'commandName' in descriptor) {
          fail(`${name} is a server-endpoint but declares commandNamespace/commandName; those describe Add-On commands it does not have.`);
        }
        const spec = descriptor.serverEndpoint;
        if (!spec || typeof spec !== 'object') {
          fail(`${name} is a server-endpoint but declares no serverEndpoint object.`);
        } else {
          if (typeof spec.path !== 'string' || !spec.path.startsWith('/api/')) {
            fail(`${name} serverEndpoint.path must be a string starting with '/api/', found: ${JSON.stringify(spec.path)}.`);
          }
          const method = String(spec.method || 'GET').toUpperCase();
          if (!['GET', 'POST', 'DELETE'].includes(method)) {
            fail(`${name} serverEndpoint.method must be GET, POST or DELETE, found: ${JSON.stringify(spec.method)}.`);
          }
        }
      }
    }
  }
}

// 不变量：featureArea 取值空间与沙箱插件 id 必须完全不相交。
// 一旦相交，「module/featureArea 指什么」就会重新变成歧义。
if (moduleRegistry) {
  const moduleIds = Array.isArray(moduleRegistry.modules)
    ? moduleRegistry.modules.map((entry) => entry && entry.id).filter(Boolean)
    : [];
  const lowerAreas = new Set(FEATURE_AREAS.map((area) => area.toLowerCase()));
  const collisions = moduleIds.filter((id) => lowerAreas.has(String(id).toLowerCase()));
  if (collisions.length > 0) {
    fail(`featureArea values collide with sandboxed module ids: ${collisions.join(', ')}.`);
  }
}

// 计数交叉校验（CNT-1）。此前由 CMakeLists.txt 承担，但 CMake 的
// `string(JSON ... LENGTH)` 只能取数组长度、无法按 executionKind 过滤，因此
// 「数组长度 == boundary.descriptors」这条断言会在新增 server 侧工具时
// FATAL_ERROR，把纯 server 改动也拖进 AC28/AC29 重编。
//
// 现改为：boundary.descriptors 只对 addon-command 计数（该值被烧入 APX 并由 Ping
// 回显，必须保持稳定）；server-endpoint 计入 boundary.serverTools（永不入 APX）。
// 交叉校验落在本校验器 —— 公开 CI 会执行它，故约束强度不降。
if (descriptorRegistry && commandBoundary && Array.isArray(descriptorRegistry.descriptors)) {
  const all = descriptorRegistry.descriptors;
  const addonCount = all.filter((d) => d.executionKind === 'mepbridge-addon-command').length;
  const serverCount = all.filter((d) => d.executionKind === 'server-endpoint').length;
  const missingServerTools = SERVER_TOOL_NAMES.filter((name) => !all.some((d) => d && d.name === name));
  if (missingServerTools.length > 0) {
    fail(`Required D-4 server tools are missing: ${missingServerTools.join(', ')}.`);
  }

  if (typeof commandBoundary.descriptors !== 'number') {
    fail('ai-adapter/command-boundary.json must declare a numeric descriptors count.');
  } else if (addonCount !== commandBoundary.descriptors) {
    fail(`command-boundary.json descriptors=${commandBoundary.descriptors} but tool-descriptors.json has ${addonCount} mepbridge-addon-command descriptors. This value is baked into the APX and echoed by Ping; changing it requires an AC28/AC29 rebuild.`);
  }

  if (typeof commandBoundary.serverTools !== 'number') {
    fail('ai-adapter/command-boundary.json must declare a numeric serverTools count.');
  } else if (serverCount !== commandBoundary.serverTools) {
    fail(`command-boundary.json serverTools=${commandBoundary.serverTools} but tool-descriptors.json has ${serverCount} server-endpoint descriptors.`);
  }

  // 总数守恒：任何未被两类之一覆盖的 executionKind 都会在此暴露，
  // 避免新增第三类执行方式时静默逃过计数。
  const covered = addonCount + serverCount;
  if (covered !== all.length) {
    fail(`Descriptor total mismatch: array length ${all.length} but addon(${addonCount}) + server(${serverCount}) = ${covered}. Every descriptor must be counted by exactly one boundary field.`);
  }
}

if (failures.length > 0) {
  console.error('Descriptor contract validation failed:');
  for (const failure of [...new Set(failures)].sort()) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

const counts = {};
const kinds = {};
for (const descriptor of descriptorRegistry.descriptors) {
  counts[descriptor.featureArea] = (counts[descriptor.featureArea] || 0) + 1;
  kinds[descriptor.executionKind] = (kinds[descriptor.executionKind] || 0) + 1;
}

console.log(JSON.stringify({
  status: 'ok',
  // 三个数字必须分开报：totalDescriptors 是数组长度，addonCommands 是烧入 APX 并由 Ping
  // 回显的那个值，serverTools 永不入 APX。混report 会让「74 是什么」重新变成歧义。
  totalDescriptors: descriptorRegistry.descriptors.length,
  addonCommands: kinds['mepbridge-addon-command'] || 0,
  serverTools: kinds['server-endpoint'] || 0,
  featureAreas: FEATURE_AREAS,
  featureAreaDistribution: counts,
  executionKinds: EXECUTION_KINDS,
  executionKindDistribution: kinds,
}, null, 2));
}

module.exports = { FEATURE_AREAS, EXECUTION_KINDS, SERVER_TOOL_NAMES };
