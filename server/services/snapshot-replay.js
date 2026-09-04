// snapshot-replay.js
// D-2 元素快照与 preview-first 回放（v0.1.4 批次 D 第 3 项）。
//
// 契约权威：快照回放契约 D2_SNAPSHOT_REPLAY_CONTRACT 与
// element-snapshot-replay schema（内部文档，不在公开仓库内）。
// 本实现为服务侧第 1 步：离线可测（依赖注入），不新增 C++ 命令 / descriptor / serverTools。
//
// 硬语义（契约 §3-§5）：
//   - sourceGuid 仅来源工程内有效；跨工程创建记录 sourceGuid→targetGuid。
//   - 图层 / 分类 / 属性解析：零候选或多候选一律 fail-closed，不猜测、不隐式创建。
//   - preview 绝不 mutation；apply 绑定 preview/target/snapshot/plan，真实写入要求
//     dryRun=false 且 confirmRequired=true。
//   - completed 必须逐元素 readback；失败清理只删本次创建且有证据的 target GUID，
//     逆创建序删除并逐个确认不存在；无法确认报告 cleanup-failed。
//
// 已知边界（v1，实机矩阵前不宣称运行时完成）：
//   - 回放支持类型：Wall / Column / Beam / Slab / Zone。Stair 为已裁决的能力边界
//     （2026-08-30 第三方裁决：treadDepth 标量不驱动几何，踏面语义不可控），v1 一律
//     unsupported；Mesh/Morph/Door/Window/MEP 类型不在 v1。
//   - v0.1.4 边界（2026-09-03 维护者裁决）：只回放普通建筑构件几何与楼层映射。
//     图层、分类和构件属性保留为快照元数据，不解析、不写入、不参与 readback。
//     恢复属性回放必须先落地通用建筑构件属性回放契约与防回退测试。

'use strict';

const crypto = require('crypto');

const SCHEMA_VERSION = 'd2-1';
const DISTANCE_TOLERANCE_M = 0.001;
const PREVIEW_TTL_MS = 10 * 60 * 1000;

// 必须 <= Sources/DeleteElementsCommand.cpp 的 MaxDeleteGuids（200）。
// tests/test-batch-limit-contract.js 会 diff 两边。
//
// 为什么必须分块：executeCleanup 原先把整个 createdStack 一次性交给 DeleteElements。
// BatchCreateElements 上限 500，单次 replay 创建量完全可能超过删除上限 200，届时
// DeleteElements 返回 TOO_MANY_ELEMENT_GUIDS → 整批清理走 catch → 创建物全部残留，
// 与 D-2「失败必须清理残留」的承诺直接冲突。删除上限不因内部调用方而放宽（不可逆
// 操作的边界应严于创建），改为调用方分块。
const CLEANUP_DELETE_CHUNK = 200;

// v1 可回放类型注册表：elementType → 创建策略。
// Stair unsupported 的依据是已裁决的能力边界（THIRD_PARTY_STAIR0_SEMANTIC_ADJUDICATION_20260830 §7：
// treadDepth 标量不驱动几何、readback 1.0 为无关常量，v0.1.4 契约将 treadDepth 降为不支持字段），
// 双版实机矩阵完成前一律 unsupported，与裁决前口径行为一致。
const REPLAY_STRATEGIES = {
  Wall: {
    createCommand: 'CreateWall',
    mapGeometry: (g) => ({ start: pickPoint(g.start), end: pickPoint(g.end), thickness: g.thickness, height: g.height })
  },
  Column: {
    createCommand: 'CreateColumn',
    mapGeometry: (g) => {
      const params = { position: pickPoint(g.position), height: g.height };
      if (typeof g.rotationAngle === 'number') params.rotationAngle = g.rotationAngle;
      return params;
    }
  },
  Beam: {
    createCommand: 'CreateBeam',
    mapGeometry: (g) => ({ start: pickPoint(g.start), end: pickPoint(g.end) })
  },
  Slab: {
    createCommand: 'CreateSlab',
    mapGeometry: (g) => ({ polygon: normalizePolygon(g.polygon), thickness: g.thickness, level: g.level })
  },
  Zone: {
    createCommand: 'CreateZone',
    mapGeometry: (g) => ({
      polygon: { points: normalizePolygon(g.polygon && !Array.isArray(g.polygon) ? g.polygon.points : g.polygon) },
      height: g.height
    })
  }
};

const ALL_SUPPORTED_TYPES = Object.keys(REPLAY_STRATEGIES);

// ---------------------------------------------------------------------------
// 规范化与哈希
// ---------------------------------------------------------------------------

function canonicalize (value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function stableStringify (value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex (text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function computeContentHash (snapshot) {
  const copy = { ...snapshot };
  delete copy.contentHash;
  return sha256Hex(stableStringify(copy));
}

function computePlanHash (preview) {
  const copy = { ...preview };
  delete copy.planHash;
  return sha256Hex(stableStringify(copy));
}

function targetFingerprint (target) {
  const path = String(target.projectPath || '').trim().toLowerCase();
  const name = String(target.projectName || '').trim().toLowerCase();
  return sha256Hex(`${target.port}|${name}|${path}`);
}

function pickPoint (point) {
  if (!point || typeof point !== 'object') return undefined;
  const out = {};
  if (typeof point.x === 'number') out.x = point.x;
  if (typeof point.y === 'number') out.y = point.y;
  if (typeof point.z === 'number') out.z = point.z;
  return out;
}

function normalizePolygon (polygon) {
  if (Array.isArray(polygon)) return polygon.map(pickPoint);
  if (polygon && Array.isArray(polygon.points)) return polygon.points.map(pickPoint);
  return undefined;
}

function numbersClose (a, b, tolerance = DISTANCE_TOLERANCE_M) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function pointsClose (a, b, tolerance = DISTANCE_TOLERANCE_M) {
  if (!a || !b) return false;
  const ax = Number(a.x); const ay = Number(a.y);
  const bx = Number(b.x); const by = Number(b.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return false;
  if (Math.abs(ax - bx) > tolerance || Math.abs(ay - by) > tolerance) return false;
  if (a.z !== undefined && b.z !== undefined && Math.abs(Number(a.z) - Number(b.z)) > tolerance) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 服务工厂
// ---------------------------------------------------------------------------

/**
 * @param {Object} deps
 *   callCommand: async (endpoint, commandName, params) => addOnCommandResponse payload
 *                （失败时抛错：外层 succeeded:false 或 payload.status==='error'）
 *   resolveInstance: async ({port?, project?}) => {ok:true, port} | {ok:false, errorType, message}
 *   getEndpoint: () => string —— 未显式寻址时动态解析的默认端点
 *   now: () => number                      （测试注入）
 *   randomId: () => string                 （测试注入）
 */
function createSnapshotReplayService (deps = {}) {
  const callCommand = deps.callCommand;
  if (typeof callCommand !== 'function') {
    throw new Error('snapshot-replay requires an injectable callCommand(endpoint, commandName, params)');
  }
  const resolveInstance = deps.resolveInstance;
  if (typeof resolveInstance !== 'function') {
    throw new Error('snapshot-replay requires an injectable resolveInstance({port, project})');
  }
  const getEndpoint = deps.getEndpoint || (() => '');
  const now = deps.now || (() => Date.now());
  const randomId = deps.randomId || (() => crypto.randomUUID());

  // previewId -> { preview, snapshot, targetEndpoint, createdAt, expiresAtMs }
  const previewStore = new Map();

  function failure (errorType, message, detail, httpStatus = 400) {
    return { ok: false, errorType, message, detail, httpStatus };
  }

  async function resolveEndpoint (spec, label) {
    if (spec.port === undefined && spec.project === undefined) {
      return { ok: true, endpoint: getEndpoint() };
    }
    const resolved = await resolveInstance({ port: spec.port, project: spec.project });
    if (!resolved.ok) {
      const unreachable = resolved.errorType === 'TARGET_PORT_NOT_LIVE' || resolved.errorType === 'NO_ARCHICAD_INSTANCES';
      return failure(
        resolved.errorType || `${label}_RESOLVE_FAILED`,
        `${label} 实例解析失败：${resolved.message || 'unknown'}`,
        resolved.detail,
        unreachable ? 503 : 400
      );
    }
    return { ok: true, endpoint: `http://127.0.0.1:${resolved.port}`, port: resolved.port };
  }

  // -------------------------------------------------------------------------
  // 1. 快照采集
  // -------------------------------------------------------------------------

  async function captureSnapshot (request) {
    const selectionMode = request && request.selectionMode;
    const validModes = ['selection', 'explicit-guids', 'types', 'all-supported'];
    if (!validModes.includes(selectionMode)) {
      return failure('INVALID_SELECTION_MODE', `selectionMode 必须是 ${validModes.join('/')}，实际为 ${JSON.stringify(selectionMode)}`);
    }
    if (selectionMode === 'types'
      && (!Array.isArray(request.requestedTypes) || request.requestedTypes.length === 0)) {
      return failure('INVALID_REQUESTED_TYPES', 'selectionMode=types 需要非空 requestedTypes 数组');
    }
    if (selectionMode === 'explicit-guids'
      && (!Array.isArray(request.requestedGuids) || request.requestedGuids.length === 0)) {
      return failure('INVALID_REQUESTED_GUIDS', 'selectionMode=explicit-guids 需要非空 requestedGuids 数组');
    }

    const endpointResult = await resolveEndpoint(
      { port: request.sourcePort, project: request.sourceProject },
      'SOURCE'
    );
    if (!endpointResult.ok) return endpointResult;
    const endpoint = endpointResult.endpoint;

    let ping;
    let projectInfo;
    try {
      ping = await callCommand(endpoint, 'Ping', {});
      projectInfo = await callCommand(endpoint, 'GetProjectInfo', {});
    } catch (error) {
      return failure('SOURCE_UNREACHABLE', `来源实例读取失败：${error.message}`, undefined, 503);
    }
    if (ping.status !== 'ok') {
      return failure('SOURCE_PING_FAILED', `来源实例 Ping 异常：${JSON.stringify(ping).slice(0, 200)}`, undefined, 502);
    }
    const info = projectInfo.projectInfo || {};
    if (!info.projectName || !info.projectPath || info.untitled === true) {
      return failure('SOURCE_PROJECT_UNNAMED', '来源工程未保存或缺少 projectName/projectPath，无法建立可校验的快照身份');
    }

    // 楼层表：快照必须携带来源楼层身份，跨工程回放时按名称+标高映射到目标楼层。
    const storiesPayload = await callCommand(endpoint, 'GetStories', {});
    const sourceStories = [];
    const floorsByIndex = new Map();
    for (const story of storiesPayload.stories || []) {
      const sourceStory = { index: story.index, name: story.name, elevation: story.level };
      sourceStories.push(sourceStory);
      floorsByIndex.set(story.index, sourceStory);
    }

    // Attribute metadata is best-effort in v0.1.4. Geometry replay must not be
    // blocked because a source project cannot expose optional attribute data.
    let layersPayload = { layers: [] };
    try {
      layersPayload = await callCommand(endpoint, 'GetLayers', {});
    } catch (error) {
      captureWarnings.push(`来源图层元数据读取失败：${error.message}`);
    }
    const layersByName = new Map();
    const duplicateLayerNames = new Set();
    for (const layer of layersPayload.layers || []) {
      const name = String(layer.name || '');
      if (!name) continue;
      if (layersByName.has(name)) duplicateLayerNames.add(name);
      layersByName.set(name, layer.guid);
    }

    let systemsPayload = { systems: [] };
    try {
      systemsPayload = await callCommand(endpoint, 'GetClassifications', { includeRootItems: true });
    } catch (error) {
      captureWarnings.push(`来源分类元数据读取失败：${error.message}`);
    }
    const systemsByGuid = new Map();
    const systemsByName = new Map();
    for (const system of systemsPayload.systems || []) {
      systemsByGuid.set(system.guid, system);
      if (!systemsByName.has(system.name)) systemsByName.set(system.name, []);
      systemsByName.get(system.name).push(system);
    }

    // —— 元素枚举 ——
    let candidates = [];
    try {
      if (selectionMode === 'selection') {
        const selected = await callCommand(endpoint, 'GetSelectedElements', {});
        candidates = (selected.elements || []).map((e) => ({ guid: e.guid, type: e.type || e.elementType }));
      } else if (selectionMode === 'types') {
        for (const type of request.requestedTypes) {
          const listed = await callCommand(endpoint, 'GetElementsByType', { elementType: type, includeAabb: true });
          for (const e of listed.elements || []) {
            candidates.push({ guid: e.guid, type: e.type || type, layerName: e.layerName, aabb: e.aabb });
          }
        }
      } else if (selectionMode === 'all-supported') {
        for (const type of ALL_SUPPORTED_TYPES) {
          const listed = await callCommand(endpoint, 'GetElementsByType', { elementType: type, includeAabb: true });
          for (const e of listed.elements || []) {
            candidates.push({ guid: e.guid, type: e.type || type, layerName: e.layerName, aabb: e.aabb });
          }
        }
      } else {
        candidates = request.requestedGuids.map((guid) => ({ guid, type: undefined }));
      }
    } catch (error) {
      return failure('SOURCE_ENUMERATION_FAILED', `元素枚举失败：${error.message}`);
    }

    const succeeded = [];
    const failed = [];
    const skipped = [];
    const elements = [];
    const captureWarnings = [];

    for (const candidate of candidates) {
      const guid = String(candidate.guid || '');
      if (!guid) {
        skipped.push({ sourceGuid: '(missing)', reason: '枚举结果缺少 guid' });
        continue;
      }

      let listEntry = candidate;
      if (selectionMode === 'explicit-guids' || !candidate.type) {
        // explicit-guids 模式没有类型信息，也没有 layerName/aabb —— 通过 GetElementsByType 逐类型定位，
        // 或直接读取几何（GetElementGeometry 会返回 elementType）。
        listEntry = { guid };
      }

      let geometryPayload;
      try {
        geometryPayload = await callCommand(endpoint, 'GetElementGeometry', { elementGuid: guid });
      } catch (error) {
        failed.push({ sourceGuid: guid, reason: `GetElementGeometry 失败：${error.message}` });
        continue;
      }

      const elementType = geometryPayload.elementType || listEntry.type;
      if (!elementType) {
        failed.push({ sourceGuid: guid, reason: '无法确定 elementType' });
        continue;
      }

      // layerName：优先用枚举结果，否则逐类型扫描太贵 —— v1 要求枚举结果带 layerName（types/all-supported/
      // selection 模式均提供）；explicit-guids 模式通过 GetElementsByType(elementType) 单次查询补齐。
      let layerName = listEntry.layerName;
      let aabb = listEntry.aabb;
      if (layerName === undefined || aabb === undefined) {
        try {
          const listed = await callCommand(endpoint, 'GetElementsByType', { elementType, includeAabb: true });
          const hit = (listed.elements || []).find((e) => String(e.guid) === guid);
          if (hit) {
            layerName = hit.layerName;
            aabb = hit.aabb;
          }
        } catch (_) { /* fallthrough：layerName 缺失会在下方 fail-closed */ }
      }

      const layerGuid = layerName ? layersByName.get(layerName) : undefined;
      if (layerName && duplicateLayerNames.has(layerName)) {
        captureWarnings.push(`元素 ${guid} 的图层名「${layerName}」在来源工程中不唯一，仅保留为元数据`);
      }
      if (layerName && !layerGuid) {
        captureWarnings.push(`元素 ${guid} 的图层「${layerName}」未出现在 GetLayers 结果中，仅保留图层名`);
      }

      const floorIndex = geometryPayload.floorIndex;
      const floor = floorsByIndex.get(floorIndex) || { index: floorIndex };

      // 属性元数据：非默认 + hasValue + 可编辑。v0.1.4 不把它当作可回放能力。
      let properties = [];
      try {
        const propsPayload = await callCommand(endpoint, 'GetElementProperties', { elementGuid: guid });
        properties = (propsPayload.properties || [])
          .filter((p) => p.status === 'hasValue'
            && p.isDefault === false
            && p.definition
            && p.definition.isValueEditable === true)
          .map((p) => ({
            definitionGuid: p.definitionGuid,
            group: p.groupName,
            name: p.name,
            valueType: (p.definition && p.definition.valueType) || (p.value && p.value.singleValue && p.value.singleValue.type) || 'unknown',
            value: p.value && p.value.singleValue ? p.value.singleValue.value : p.valueString
          }));
      } catch (error) {
        properties = [];
        captureWarnings.push(`元素 ${guid} 的属性元数据读取失败：${error.message}`);
      }

      // 分类元数据（读取模式）
      let classifications = [];
      try {
        const clsPayload = await callCommand(endpoint, 'AssignClassification', { elementGuid: guid });
        classifications = (clsPayload.classifications || []).map((c) => {
          const system = systemsByGuid.get(c.systemGuid);
          return {
            systemGuid: c.systemGuid,
            itemGuid: c.itemGuid,
            systemName: system ? system.name : c.systemGuid,
            itemName: c.itemCode || c.itemGuid,
            path: c.itemCode || c.itemGuid
          };
        });
        if ((clsPayload.classifications || []).some((c) => !systemsByGuid.has(c.systemGuid))) {
          captureWarnings.push(`元素 ${guid} 存在无法解析系统名称的分类条目`);
        }
      } catch (error) {
        classifications = [];
        captureWarnings.push(`元素 ${guid} 的分类元数据读取失败：${error.message}`);
      }

      // 回放支持判定
      const strategy = REPLAY_STRATEGIES[elementType];
      const replay = strategy
        ? { supported: true, strategy: `${elementType}->${strategy.createCommand}`, createCommand: strategy.createCommand }
        : { supported: false, strategy: 'unsupported-v1', unsupportedReason: `${elementType} 不在 v1 回放支持类型（${ALL_SUPPORTED_TYPES.join('/')}）内` };

      const aabbBox = aabb && aabb.min && aabb.max
        ? {
            min: [aabb.min.x, aabb.min.y, aabb.min.z],
            max: [aabb.max.x, aabb.max.y, aabb.max.z]
          }
        : { min: [0, 0, 0], max: [0, 0, 0] };

      elements.push({
        sourceGuid: guid,
        sourceGuidScope: 'source-project-only',
        elementType,
        floor,
        layer: { guid: layerGuid || '', name: layerName || '' },
        geometry: {
          kind: elementType,
          aabb: aabbBox,
          payload: geometryPayload.geometry || {}
        },
        properties,
        classifications,
        replay
      });
      succeeded.push(guid);
    }

    const snapshot = {
      documentType: 'element-snapshot',
      schemaVersion: SCHEMA_VERSION,
      snapshotId: `snap-${randomId()}`,
      createdAt: new Date(now()).toISOString(),
      source: {
        port: endpointResult.port !== undefined ? endpointResult.port : inferPort(endpoint),
        projectName: info.projectName,
        projectPath: info.projectPath,
        archicadVersion: String(ping.archicadVersion)
      },
      coordinateSystem: {
        unit: 'm',
        space: 'archicad-project',
        axis: 'right-handed, X east / Y north / Z up',
        distanceToleranceM: DISTANCE_TOLERANCE_M
      },
      capture: {
        selectionMode,
        requestedTypes: request.requestedTypes || [],
        requestedGuids: request.requestedGuids || [],
        succeeded,
        failed,
        skipped
      },
      stories: sourceStories,
      elements,
      contentHash: ''
    };
    snapshot.contentHash = computeContentHash(snapshot);

    return { ok: true, snapshot, warnings: captureWarnings };
  }

  function inferPort (endpoint) {
    const match = /:(\d{2,5})$/.exec(String(endpoint || ''));
    return match ? Number(match[1]) : 0;
  }

  function resolveStoryMapping (sourceStory, targetStories) {
    const sourceName = String(sourceStory.name || '').trim().toLowerCase();
    const sourceElevation = Number(sourceStory.elevation);
    if (!sourceName || !Number.isFinite(sourceElevation)) {
      return {
        ok: false,
        error: `来源楼层「${sourceStory.name || sourceStory.index}」缺少可校验的名称或标高，拒绝映射`
      };
    }

    const byName = targetStories.filter((story) => String(story.name || '').trim().toLowerCase() === sourceName);
    if (byName.length === 1) {
      const target = byName[0];
      return {
        ok: true,
        mapping: {
          source: { index: sourceStory.index, name: sourceStory.name, elevation: sourceStory.elevation },
          target: { index: target.index, name: target.name, elevation: target.level },
          resolution: 'story-name'
        }
      };
    }
    if (byName.length > 1) {
      return {
        ok: false,
        error: `目标工程楼层名「${sourceStory.name}」不唯一，无法安全映射`
      };
    }

    const byElevation = targetStories.filter((story) => numbersClose(story.level, sourceElevation));
    if (byElevation.length === 1) {
      const target = byElevation[0];
      return {
        ok: true,
        mapping: {
          source: { index: sourceStory.index, name: sourceStory.name, elevation: sourceStory.elevation },
          target: { index: target.index, name: target.name, elevation: target.level },
          resolution: 'story-elevation'
        }
      };
    }

    return {
      ok: false,
      error: `来源楼层「${sourceStory.name}」无法在目标工程按唯一名称或标高映射（名称候选 ${byName.length}，标高候选 ${byElevation.length}），且不隐式创建楼层`
    };
  }

  function findMappedStory (storyMappings, sourceIndex) {
    return storyMappings.find((mapping) => mapping.source.index === sourceIndex)?.target || null;
  }

  function resolveMappedFloorIndex (storyMappings, sourceIndex) {
    const target = findMappedStory(storyMappings, sourceIndex);
    if (!target || !Number.isInteger(target.index)) {
      throw new Error(`来源楼层 index=${sourceIndex} 缺少已验证的目标楼层映射`);
    }
    return target.index;
  }

  // -------------------------------------------------------------------------
  // 2. Preview
  // -------------------------------------------------------------------------

  async function buildPreview (request) {
    const snapshot = request && request.snapshot;
    if (!snapshot || snapshot.documentType !== 'element-snapshot') {
      return failure('INVALID_SNAPSHOT', 'preview 请求必须携带 documentType=element-snapshot 的快照文档');
    }
    const recomputed = computeContentHash(snapshot);
    if (recomputed !== snapshot.contentHash) {
      return failure('SNAPSHOT_HASH_MISMATCH', '快照 contentHash 与内容不一致，拒绝生成 preview', {
        declared: snapshot.contentHash,
        recomputed
      });
    }

    // preview 请求禁止携带任何 mutation 通道
    for (const forbidden of ['commandJson', 'mutation', 'applyOverride', 'operations']) {
      if (request[forbidden] !== undefined) {
        return failure('PREVIEW_FORBIDDEN_FIELD', `preview 请求不允许携带 ${forbidden}`);
      }
    }

    const endpointResult = await resolveEndpoint(
      { port: request.targetPort, project: request.targetProject },
      'TARGET'
    );
    if (!endpointResult.ok) return endpointResult;
    const targetEndpoint = endpointResult.endpoint;

    let targetInfo;
    try {
      targetInfo = await callCommand(targetEndpoint, 'GetProjectInfo', {});
    } catch (error) {
      return failure('TARGET_UNREACHABLE', `目标实例读取失败：${error.message}`, undefined, 503);
    }
    const tInfo = targetInfo.projectInfo || {};
    if (!tInfo.projectName || !tInfo.projectPath || tInfo.untitled === true) {
      return failure('TARGET_PROJECT_UNNAMED', '目标工程未保存或缺少 projectName/projectPath');
    }
    const targetPort = endpointResult.port !== undefined ? endpointResult.port : inferPort(targetEndpoint);
    const target = { port: targetPort, projectName: tInfo.projectName, projectPath: tInfo.projectPath };
    const fingerprint = targetFingerprint(target);

    // A/B is instance-level, not Archicad-version-level. A captured snapshot may
    // only be replayed to another live instance; same-port replay is rejected even
    // if the caller bypasses the Workbench UI.
    if (snapshot.source && snapshot.source.port === targetPort) {
      return failure(
        'SOURCE_AND_TARGET_SAME_INSTANCE',
        '几何复现必须发生在两个不同的 Archicad 实例之间：来源与目标端口相同，已拒绝 preview',
        { sourcePort: snapshot.source.port, targetPort }
      );
    }

    const operations = [];
    const unsupportedElements = [];
    const warnings = [];
    const blockingErrors = [];

    // v0.1.4 only resolves the target story table. Layer, classification and
    // property replay are preview capabilities, not v0.1.4 capabilities.
    let targetStoriesPayload;
    try {
      targetStoriesPayload = await callCommand(targetEndpoint, 'GetStories', {});
    } catch (error) {
      return failure('TARGET_READ_FAILED', `目标工程楼层读取失败：${error.message}`, undefined, 502);
    }

    const storyMappings = [];
    if (!Array.isArray(snapshot.stories)) {
      blockingErrors.push('快照缺少来源楼层表 stories，无法安全映射目标楼层；请重新采集快照');
    } else {
      const targetStories = Array.isArray(targetStoriesPayload.stories) ? targetStoriesPayload.stories : [];
      for (const sourceStory of snapshot.stories) {
        const mapping = resolveStoryMapping(sourceStory, targetStories);
        if (mapping.ok) {
          storyMappings.push(mapping.mapping);
        } else {
          blockingErrors.push(mapping.error);
        }
      }
    }

    const storyMappingBlocked = blockingErrors.length > 0;

    for (const element of snapshot.elements || []) {
      if (storyMappingBlocked) continue;

      const strategy = REPLAY_STRATEGIES[element.elementType];
      if (!strategy) {
        unsupportedElements.push({
          sourceGuid: element.sourceGuid,
          elementType: element.elementType,
          reason: (element.replay && element.replay.unsupportedReason)
            || `${element.elementType} 不在 v1 回放支持类型内`
        });
        continue;
      }

      operations.push({
        sourceGuid: element.sourceGuid,
        elementType: element.elementType,
        strategy: `${element.elementType}->${strategy.createCommand}`,
        createParameters: {
          ...strategy.mapGeometry(element.geometry.payload),
          floorIndex: resolveMappedFloorIndex(storyMappings, element.floor.index)
        },
        resolvedFloor: {
          source: element.floor,
          target: findMappedStory(storyMappings, element.floor.index)
        }
      });
    }

    if ((snapshot.capture && snapshot.capture.failed && snapshot.capture.failed.length > 0)) {
      warnings.push(`来源采集时有 ${snapshot.capture.failed.length} 个元素读取失败，详见快照 capture.failed`);
    }

    const createdAt = now();
    const expiresAtMs = createdAt + PREVIEW_TTL_MS;
    const previewId = `prev-${randomId()}`;

    const preview = {
      documentType: 'replay-preview',
      previewId,
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.contentHash,
      target,
      targetFingerprint: fingerprint,
      operations,
      storyMappings,
      unsupportedElements,
      warnings,
      blockingErrors,
      estimatedCreateCount: operations.length,
      attributeReplay: {
        supported: false,
        status: 'preview',
        scope: ['layer', 'classification', 'elementProperties'],
        reason: 'v0.1.4 geometry-only replay'
      },
      cleanupPlan: { deleteOnlyCreated: true, order: 'reverse-create-order' },
      planHash: '',
      expiresAt: new Date(expiresAtMs).toISOString(),
      canApply: unsupportedElements.length === 0 && blockingErrors.length === 0
    };
    preview.planHash = computePlanHash(preview);

    previewStore.set(previewId, {
      preview,
      snapshot,
      targetEndpoint,
      createdAtMs: createdAt,
      expiresAtMs
    });
    pruneExpiredPreviews();

    return { ok: true, preview };
  }

  function pruneExpiredPreviews () {
    const current = now();
    for (const [id, entry] of previewStore) {
      if (entry.expiresAtMs < current) previewStore.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Apply
  // -------------------------------------------------------------------------

  const APPLY_FORBIDDEN_FIELDS = ['operations', 'commandJson', 'confirmed', 'mutation', 'applyOverride'];

  async function applyReplay (request) {
    if (!request || request.documentType !== 'replay-apply-request') {
      return failure('INVALID_APPLY_REQUEST', 'apply 请求必须是 documentType=replay-apply-request');
    }
    for (const forbidden of APPLY_FORBIDDEN_FIELDS) {
      if (request[forbidden] !== undefined) {
        return failure('APPLY_FORBIDDEN_FIELD', `apply 请求不允许携带 ${forbidden}`);
      }
    }
    if (typeof request.dryRun !== 'boolean' || typeof request.confirmRequired !== 'boolean') {
      return failure('INVALID_APPLY_REQUEST', 'apply 请求必须携带布尔 dryRun 与 confirmRequired');
    }
    if (request.dryRun === false && request.confirmRequired !== true) {
      return failure('CONFIRM_REQUIRED', '真实写入要求 dryRun=false 且 confirmRequired=true');
    }

    pruneExpiredPreviews();
    const entry = previewStore.get(request.previewId);
    if (!entry) {
      return failure('PREVIEW_NOT_FOUND', 'previewId 不存在或已过期，必须重新 preview', undefined, 404);
    }
    const { preview, snapshot, targetEndpoint } = entry;

    if (request.planHash !== preview.planHash) {
      return failure('PLAN_HASH_MISMATCH', 'planHash 与服务端 preview 不一致', undefined, 409);
    }
    if (request.snapshotHash !== preview.snapshotHash) {
      return failure('SNAPSHOT_HASH_MISMATCH', 'snapshotHash 与服务端 preview 不一致', undefined, 409);
    }
    const recomputed = computeContentHash(snapshot);
    if (recomputed !== preview.snapshotHash) {
      return failure('SNAPSHOT_CONTENT_CHANGED', '服务端快照内容与快照哈希不一致', undefined, 409);
    }
    if (request.targetFingerprint !== preview.targetFingerprint) {
      return failure('TARGET_FINGERPRINT_MISMATCH', 'targetFingerprint 与服务端 preview 不一致', undefined, 409);
    }

    // 目标重解析 + 指纹复核：目标工程被切换/关闭必须拒绝。
    let targetInfo;
    try {
      targetInfo = await callCommand(targetEndpoint, 'GetProjectInfo', {});
    } catch (error) {
      return failure('TARGET_UNREACHABLE', `目标实例读取失败：${error.message}`, undefined, 503);
    }
    const tInfo = targetInfo.projectInfo || {};
    const targetPort = inferPort(targetEndpoint);
    const liveTarget = { port: targetPort, projectName: tInfo.projectName, projectPath: tInfo.projectPath };
    if (targetFingerprint(liveTarget) !== preview.targetFingerprint) {
      return failure('TARGET_CHANGED', '目标工程身份已变化（切换/关闭），必须重新 preview', undefined, 409);
    }

    if (!preview.canApply) {
      return failure('PREVIEW_NOT_APPLICABLE', 'preview canApply=false（存在 unsupported 元素或 blocking error），禁止执行', undefined, 409);
    }

    const baseResult = {
      documentType: 'replay-result',
      previewId: preview.previewId,
      snapshotHash: preview.snapshotHash,
      target: preview.target,
      targetFingerprint: preview.targetFingerprint
    };

    if (request.dryRun === true) {
      return {
        ok: true,
        result: {
          ...baseResult,
          status: 'confirmed',
          mappings: [],
          readback: [],
          readbackVerified: false,
          cleanup: { status: 'not-needed', deletedTargetGuids: [], verifiedAbsentTargetGuids: [] },
          errors: []
        }
      };
    }

    // —— 执行 ——
    const mappings = [];
    const createdStack = []; // 逆创建序清理的操作对象
    const errors = [];

    for (const operation of preview.operations) {
      const strategy = REPLAY_STRATEGIES[operation.elementType];
      try {
        const createPayload = await callCommand(targetEndpoint, strategy.createCommand, {
          ...operation.createParameters,
          dryRun: false,
          confirmRequired: true
        });
        const targetGuid = extractCreatedGuid(createPayload);
        if (!targetGuid) {
          throw new Error(`创建响应缺少目标 GUID：${JSON.stringify(createPayload).slice(0, 200)}`);
        }
        mappings.push({ sourceGuid: operation.sourceGuid, targetGuid });
        createdStack.push({ operation, targetGuid });
      } catch (error) {
        errors.push(`元素 ${operation.sourceGuid}（${operation.elementType}）写入失败：${error.message}`);
        const cleanup = await executeCleanup(targetEndpoint, createdStack);
        return {
          ok: true,
          result: {
            ...baseResult,
            status: cleanup.status === 'deleted-and-verified' ? 'failed-cleaned' : 'cleanup-failed',
            mappings,
            readback: [],
            readbackVerified: false,
            cleanup,
            errors
          }
        };
      }
    }

    // —— 逐元素 readback ——
    const readback = [];
    let allVerified = true;
    const mismatchErrors = [];

    for (const { operation, targetGuid } of createdStack) {
      const sourceElement = (snapshot.elements || []).find((e) => e.sourceGuid === operation.sourceGuid);
      const entry = { sourceGuid: operation.sourceGuid, targetGuid, verified: false, mismatches: [] };

      try {
        const geometryPayload = await callCommand(targetEndpoint, 'GetElementGeometry', { elementGuid: targetGuid });
        const mismatches = await compareElement({
          sourceElement,
          geometryPayload,
          callCommand,
          targetEndpoint,
          expectedFloorIndex: resolveMappedFloorIndex(preview.storyMappings, sourceElement.floor.index)
        });
        entry.mismatches = mismatches;
        entry.verified = mismatches.length === 0;
        if (!entry.verified) {
          mismatchErrors.push(`元素 ${operation.sourceGuid} readback 不一致：${mismatches.map((m) => m.field).join('/')}`);
        }
      } catch (error) {
        mismatchErrors.push(`元素 ${operation.sourceGuid} readback 异常：${error.message}`);
      }

      if (!entry.verified) allVerified = false;
      readback.push(entry);
    }

    if (!allVerified) {
      const cleanup = await executeCleanup(targetEndpoint, createdStack);
      return {
        ok: true,
        result: {
          ...baseResult,
          status: cleanup.status === 'deleted-and-verified' ? 'failed-cleaned' : 'cleanup-failed',
          mappings,
          readback,
          readbackVerified: false,
          cleanup,
          errors: [...errors, ...mismatchErrors]
        }
      };
    }

    return {
      ok: true,
      result: {
        ...baseResult,
        status: 'completed',
        mappings,
        readback,
        readbackVerified: true,
        cleanup: { status: 'not-needed', deletedTargetGuids: [], verifiedAbsentTargetGuids: [] },
        errors: []
      }
    };
  }

  function extractCreatedGuid (payload) {
    const containers = [payload, payload && payload.data];
    const guidKeys = ['elementGuid', 'guid', 'wallGuid', 'columnGuid', 'beamGuid', 'slabGuid', 'zoneGuid', 'meshGuid', 'morphGuid', 'stairGuid', 'objectGuid'];
    for (const container of containers) {
      if (!container || typeof container !== 'object') continue;
      for (const key of guidKeys) {
        if (typeof container[key] === 'string' && container[key]) return container[key];
      }
    }
    return null;
  }

  async function executeCleanup (targetEndpoint, createdStack) {
    if (createdStack.length === 0) {
      return { status: 'not-needed', deletedTargetGuids: [], verifiedAbsentTargetGuids: [] };
    }
    // 逆创建序删除本次创建且有证据的 target GUID
    const reverse = [...createdStack].reverse();
    const guids = reverse.map((item) => item.targetGuid);

    // 按 DeleteElements 的上限分块：整批一次性提交会在超限时被 Add-On 拒绝，
    // 导致本该被清理的创建物全部残留。分块后单块失败不影响其余块继续清理，
    // 剩余残留由后续逐个 confirmAbsent 如实报出。
    const chunks = [];
    for (let i = 0; i < guids.length; i += CLEANUP_DELETE_CHUNK) {
      chunks.push(guids.slice(i, i + CLEANUP_DELETE_CHUNK));
    }

    const deleted = [];
    const chunkErrors = [];
    for (const chunk of chunks) {
      try {
        await callCommand(targetEndpoint, 'DeleteElements', {
          guids: chunk,
          dryRun: false,
          confirmRequired: true
        });
        deleted.push(...chunk);
      } catch (error) {
        // 不中断：后续块仍尝试删除，避免一块失败就放弃整批清理
        chunkErrors.push(error.message);
      }
    }

    // 无论删除调用成败，都逐个核实实际现状，不以调用返回值代替证据
    const verifiedAbsent = [];
    for (const guid of guids) {
      if (await confirmAbsent(targetEndpoint, guid)) verifiedAbsent.push(guid);
    }

    if (verifiedAbsent.length !== guids.length) {
      const residualCount = guids.length - verifiedAbsent.length;
      const detail = chunkErrors.length > 0
        ? `DeleteElements 分块失败：${chunkErrors.join('; ')}`
        : '部分已创建元素删除后仍可读取，无法确认清理完成';
      return {
        status: 'failed',
        deletedTargetGuids: deleted,
        verifiedAbsentTargetGuids: verifiedAbsent,
        chunkCount: chunks.length,
        residualCount,
        error: `${detail}（残留 ${residualCount} 个）`
      };
    }

    return {
      status: 'deleted-and-verified',
      deletedTargetGuids: deleted,
      verifiedAbsentTargetGuids: verifiedAbsent,
      chunkCount: chunks.length,
      residualCount: 0
    };
  }

  async function confirmAbsent (targetEndpoint, guid) {
    try {
      await callCommand(targetEndpoint, 'GetElementGeometry', { elementGuid: guid });
      return false; // 仍存在
    } catch (_) {
      return true; // 读取失败 → 不存在
    }
  }

  // v0.1.4 readback compares geometry and the mapped target floor only.
  async function compareElement ({ sourceElement, geometryPayload, expectedFloorIndex }) {
    const mismatches = [];
    const requested = sourceElement.geometry.payload || {};
    const actual = geometryPayload.geometry || {};

    // elementType
    if (geometryPayload.elementType !== sourceElement.elementType) {
      mismatches.push({ field: 'elementType', requested: sourceElement.elementType, actual: geometryPayload.elementType });
    }

    // floorIndex
    const expectedFloor = Number.isInteger(expectedFloorIndex) ? expectedFloorIndex : sourceElement.floor.index;
    if (geometryPayload.floorIndex !== expectedFloor) {
      mismatches.push({ field: 'floorIndex', requested: expectedFloor, actual: geometryPayload.floorIndex });
    }

    // geometry per type
    const type = sourceElement.elementType;
    const geometryChecks = {
      Wall: [['point', 'start'], ['point', 'end'], ['number', 'thickness'], ['number', 'height']],
      Column: [['point', 'position'], ['number', 'height']],
      Beam: [['point', 'start'], ['point', 'end']],
      Slab: [['polygon', 'polygon'], ['number', 'thickness'], ['number', 'level']],
      Zone: [['polygon', 'polygon'], ['number', 'height']]
    }[type] || [];

    for (const [kind, field] of geometryChecks) {
      if (kind === 'point') {
        if (!pointsClose(requested[field], actual[field])) {
          mismatches.push({ field, requested: requested[field], actual: actual[field] });
        }
      } else if (kind === 'number') {
        if (requested[field] === undefined || actual[field] === undefined
          || !numbersClose(requested[field], actual[field])) {
          mismatches.push({ field, requested: requested[field], actual: actual[field] });
        }
      } else if (kind === 'polygon') {
        const req = normalizePolygon(requested[field]);
        const act = normalizePolygon(actual[field]);
        if (!Array.isArray(req) || !Array.isArray(act) || req.length !== act.length
          || req.some((p, i) => !pointsClose(p, act[i]))) {
          mismatches.push({
            field,
            requested: { vertexCount: Array.isArray(req) ? req.length : null },
            actual: { vertexCount: Array.isArray(act) ? act.length : null }
          });
        }
      }
    }

    return mismatches;
  }

  return {
    captureSnapshot,
    buildPreview,
    applyReplay,
    // 暴露给测试：预览存储检视
    _previewStoreSize: () => previewStore.size
  };
}

module.exports = {
  createSnapshotReplayService,
  computeContentHash,
  computePlanHash,
  targetFingerprint,
  canonicalize,
  stableStringify,
  REPLAY_STRATEGIES,
  ALL_SUPPORTED_TYPES,
  SCHEMA_VERSION,
  CLEANUP_DELETE_CHUNK
};
