// instance-targeting.js
// D-1 目标实例寻址（v0.1.4 批次 D 第 2 项）：让 /api/execute 可以显式指定写入哪个
// Archicad 实例（targetPort / targetProject），支撑「A 文件读 / B 文件写」跨文件场景。
//
// 边界与失败取向（路线图 §4.2 / §4.5.7 / §9.2 的验收切片）：
//   - 未命中、多候选、类型非法一律**显式失败**，禁止静默回落 global.archicadPort ——
//     寻址错了再回落等于把命令写进错误的工程。
//   - 参数校验与其他写入参数同级：类型/取值域在进入转发前校验，不是等到 HTTP 失败才报错。
//   - 不带这两个参数时行为完全不变（默认端点），这是零回归前提。
//   - targetPort 与 targetProject 同时给出时必须一致；矛盾即拒绝（可审计的失败优先于猜测）。

const crypto = require('crypto');
const {
  DEFAULT_PORTS,
  describeAllInstances,
  probePort,
} = require('./archicad-instances');

// 允许的实例端口域：与多实例发现的扫描窗口一致（19723..19743）。
const MIN_PORT = DEFAULT_PORTS[0];
const MAX_PORT = DEFAULT_PORTS[DEFAULT_PORTS.length - 1];

/**
 * V19-INST-01: 计算实例目标指纹 (SHA-256)
 */
function computeTargetFingerprint(target) {
  if (!target) return '';
  const port = target.port || '';
  const name = String(target.projectName || '').trim().toLowerCase();
  const path = String(target.projectPath || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(`${port}|${name}|${path}`, 'utf8').digest('hex').toUpperCase();
}

/**
 * V19-INST-01: 计算工程路径/名称 64-bit FNV-1a 哈希
 */
function computeProjectPathHash(projectPathOrName) {
  const { computeProjectPathHash: hashFn } = require('./instance-registry');
  return hashFn(projectPathOrName);
}

/**
 * 归一化 targetPort：接受整数或纯数字字符串。返回 {ok,port} 或 {ok:false,errorType,message}。
 * 数组/对象/小数/越界都是硬错误 —— 静默纠正会让"打错端口"变成"打到错误工程"。
 */
function coerceTargetPort(value) {
  let port = value;
  if (typeof port === 'string' && /^-?\d+$/.test(port.trim())) {
    port = Number(port.trim());
  }
  if (typeof port !== 'number' || !Number.isInteger(port)) {
    return { ok: false, errorType: 'INVALID_TARGET_PORT', message: `targetPort 必须是整数，实际为 ${JSON.stringify(value)}` };
  }
  if (port < MIN_PORT || port > MAX_PORT) {
    return { ok: false, errorType: 'INVALID_TARGET_PORT', message: `targetPort ${port} 超出实例扫描域 [${MIN_PORT}, ${MAX_PORT}]` };
  }
  return { ok: true, port };
}

/**
 * targetProject 匹配：按 projectName 全等或 projectPath 全等（不区分大小写；
 * Windows 路径大小写不稳）。未命名/未保存工程（untitled）只允许被 projectPath 命中，
 * 用名字匹配空名会把所有未命名工程都当成候选。
 */
function matchByProject(instances, projectSpec) {
  const needle = String(projectSpec).trim().toLowerCase();
  const hits = instances.filter((inst) => {
    if (typeof inst.projectPath === 'string'
      && inst.projectPath.trim().toLowerCase() === needle) return true;
    if (inst.untitled !== true && typeof inst.projectName === 'string' && inst.projectName !== ''
      && inst.projectName.trim().toLowerCase() === needle) return true;
    return false;
  });
  return hits;
}

/**
 * 解析目标实例。
 * V19-INST-01 增强：
 *   - 兼容顶层、command、commandJson、parameters、targetInstance 内的 targetPort/instancePort/targetProject
 *   - 支持 expectedProjectPathHash、targetFingerprint、expectedArchicadVersion 强校验
 *   - 严禁目标失效或端口复用时静默转投；不一致或不可达时一律 fail-closed
 *
 * @param {Object} body - 请求体
 * @param {Object} deps - 可注入依赖（post / ports / 探测函数），供离线测试替身
 * @returns Promise<{requested:false} |
 *                 {requested:true, ok:true, mode:'port'|'project'|'both', port:number,
 *                  instance?:object, candidates?:object[]} |
 *                 {requested:true, ok:false, errorType:string, message:string, detail?:object}>
 */
async function resolveTargetInstance(body, deps = {}) {
  // Follow only the supported request-envelope edges, never arbitrary model data.
  // In particular /api/execute accepts {action, params}; ignoring that envelope
  // must not silently fall back to the global instance.
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const containers = [];
  const targetContainers = new Set();
  const seen = new Set();
  const pending = [{ value: body, depth: 0 }];
  while (pending.length) {
    const { value, depth } = pending.shift();
    if (!isRecord(value) || seen.has(value)) continue;
    seen.add(value);
    containers.push(value);
    if (Object.prototype.hasOwnProperty.call(value, 'targetInstance')) {
      if (depth >= 6) return { requested: true, ok: false, errorType: 'INVALID_TARGET_CONSTRAINT', message: 'Target envelope exceeds supported depth' };
      if (!isRecord(value.targetInstance)) {
        return { requested: true, ok: false, errorType: 'INVALID_TARGET_CONSTRAINT', message: 'targetInstance must be an object' };
      }
      targetContainers.add(value.targetInstance);
      pending.push({ value: value.targetInstance, depth: depth + 1 });
    }
    for (const key of ['command', 'commandJson', 'parameters', 'params', 'addOnCommandParameters']) {
      if (!isRecord(value[key])) continue;
      if (depth >= 6) return { requested: true, ok: false, errorType: 'INVALID_TARGET_CONSTRAINT', message: 'Target envelope exceeds supported depth' };
      pending.push({ value: value[key], depth: depth + 1 });
    }
  }
  // Validate every occurrence, not only the chosen value. String coercion must
  // not make [28] equivalent to 28 or allow an instanceId to repair a bad port.
  for (const obj of containers) {
    for (const name of ['targetPort', 'instancePort', ...(targetContainers.has(obj) ? ['port'] : [])]) {
      if (obj[name] !== undefined && !coerceTargetPort(obj[name]).ok) {
        return { requested: true, ok: false, errorType: 'INVALID_TARGET_PORT', message: 'Invalid target port constraint: ' + name };
      }
    }
    for (const name of ['expectedArchicadVersion', 'archicadVersion']) {
      if (obj[name] !== undefined && ![28, 29, 30, '28', '29', '30'].includes(obj[name])) {
        return { requested: true, ok: false, errorType: 'INVALID_TARGET_CONSTRAINT', message: 'Expected Archicad version 28/29/30' };
      }
    }
    for (const name of ['expectedProjectPathHash', 'projectPathHash', 'targetFingerprint', 'expectedFingerprint', 'targetInstanceId', 'instanceId']) {
      if (obj[name] !== undefined && (typeof obj[name] !== 'string' || !obj[name].trim())) {
        return { requested: true, ok: false, errorType: name.includes('Id') ? 'INVALID_TARGET_INSTANCE_ID' : 'INVALID_TARGET_CONSTRAINT', message: 'Invalid target constraint: ' + name };
      }
    }
  }
  const projectConstraints = containers.flatMap(obj => [obj.targetProject, obj.projectPath, obj.projectName]).filter(v => v !== undefined);
  const pick = names => {
    const values = containers.flatMap(obj => names.filter(k => obj[k] !== undefined).map(k => obj[k]));
    if (new Set(values.map(String)).size > 1) throw Object.assign(new Error('Conflicting target constraints: ' + names.join('/')), { errorType: 'TARGET_CONFLICT' });
    return values[0];
  };
  let rawPort, rawProject, targetInstanceId, expectedHash, expectedFingerprint, expectedAcVer;
  try {
    rawPort = pick(['targetPort', 'instancePort']);
    for (const target of targetContainers) {
      if (target.port === undefined) continue;
      if (rawPort !== undefined && String(rawPort) !== String(target.port)) throw new Error('Conflicting target port');
      rawPort = target.port;
    }
    rawProject = pick(['targetProject']);
    if (rawProject === undefined) rawProject = projectConstraints[0];
    targetInstanceId = pick(['targetInstanceId', 'instanceId']);
    expectedHash = pick(['expectedProjectPathHash', 'projectPathHash']);
    expectedFingerprint = pick(['targetFingerprint', 'expectedFingerprint']);
    expectedAcVer = pick(['expectedArchicadVersion', 'archicadVersion']);
    if (targetInstanceId !== undefined) {
      const m = typeof targetInstanceId === 'string' && /^ac(28|29|30)-port-(\d+)$/.exec(targetInstanceId);
      if (!m) return { requested: true, ok: false, errorType: 'INVALID_TARGET_INSTANCE_ID', message: 'Expected ac28/29/30-port-<port>' };
      if ((rawPort !== undefined && Number(rawPort) !== Number(m[2])) ||
          (expectedAcVer !== undefined && String(expectedAcVer) !== m[1])) throw new Error('Instance ID conflicts with target port/version');
      rawPort = Number(m[2]);
      expectedAcVer = m[1];
    }
  } catch (error) {
    return { requested: true, ok: false, errorType: 'TARGET_CONFLICT', message: error.message };
  }

  if (rawPort === undefined && rawProject === undefined && targetInstanceId === undefined && expectedHash === undefined && expectedFingerprint === undefined && expectedAcVer === undefined) {
    return { requested: false };
  }

  // —— 类型/取值域先行校验（fail-closed）——
  let wantedPort = null;
  if (rawPort !== undefined) {
    const coerced = coerceTargetPort(rawPort);
    if (!coerced.ok) {
      return { requested: true, ok: false, errorType: coerced.errorType, message: coerced.message };
    }
    wantedPort = coerced.port;
  }

  if (projectConstraints.some(value => typeof value !== 'string' || !value.trim())) {
    return {
      requested: true,
      ok: false,
      errorType: 'INVALID_TARGET_PROJECT',
      message: `targetProject 必须是非空字符串（工程名或工程路径），实际为 ${JSON.stringify(rawProject)}`,
    };
  }

  if ((expectedHash !== undefined && (typeof expectedHash !== 'string' || !expectedHash.trim())) ||
      (expectedFingerprint !== undefined && (typeof expectedFingerprint !== 'string' || !expectedFingerprint.trim())) ||
      (expectedAcVer !== undefined && ![28, 29, 30, '28', '29', '30'].includes(expectedAcVer))) {
    return { requested: true, ok: false, errorType: 'INVALID_TARGET_CONSTRAINT', message: 'Expected non-empty hash/fingerprint and Archicad version 28/29/30' };
  }
  const matchesAllProjects = instances => projectConstraints.reduce((matched, value) => matchByProject(matched, value), instances);
  const post = deps.post;
  if (typeof post !== 'function') {
    return {
      requested: true,
      ok: false,
      errorType: 'INSTANCE_DISCOVERY_UNAVAILABLE',
      message: '实例发现通道不可用（缺少 post 依赖），无法校验寻址目标',
    };
  }

  const base = { requested: true };
  const hasConstraints = (rawProject !== undefined) || (expectedHash !== undefined) || (expectedFingerprint !== undefined) || (expectedAcVer !== undefined);

  // —— 仅 targetPort 且无任何工程/哈希/版本约束：单点探测即可（热路径延迟考虑）——
  if (wantedPort !== null && !hasConstraints) {
    const inst = await probePort(wantedPort, { post, timeout: deps.probeTimeout });
    if (!inst) {
      return {
        ...base,
        ok: false,
        errorType: 'TARGET_PORT_NOT_LIVE',
        message: `targetPort ${wantedPort} 上没有存活的 Archicad JSON API 实例`,
        detail: { port: wantedPort },
      };
    }
    return { ...base, ok: true, mode: 'port', port: wantedPort, instance: inst };
  }

  // —— 涉及 targetProject 或有约束：做全量发现 + 描述 ——
  const instances = await describeAllInstances({
    post,
    ports: deps.ports,
    probeTimeout: deps.probeTimeout,
    describeTimeout: deps.describeTimeout,
  });

  if (instances.length === 0) {
    return {
      ...base,
      ok: false,
      errorType: 'NO_ARCHICAD_INSTANCES',
      message: '当前没有任何存活实例可供目标匹配',
    };
  }

  // —— 若指定了 wantedPort，必须校验其存在性与附加约束 ——
  if (wantedPort !== null) {
    const instOnPort = instances.find((i) => i.port === wantedPort);
    if (!instOnPort) {
      return {
        ...base,
        ok: false,
        errorType: 'TARGET_PORT_NOT_LIVE',
        message: `targetPort ${wantedPort} 上没有存活的 Archicad JSON API 实例`,
        detail: { port: wantedPort },
      };
    }

    if (expectedAcVer !== undefined) {
      const liveVer = instOnPort.archicadVersion ?? instOnPort.productInfo?.version;
      if (String(liveVer) !== String(expectedAcVer)) {
        return {
          ...base,
          ok: false,
          errorType: 'TARGET_VERSION_MISMATCH',
          message: `targetPort ${wantedPort} 的 Archicad 版本为 ${liveVer}，与预期 ${expectedAcVer} 不一致`,
          detail: { port: wantedPort, actual: liveVer, expected: expectedAcVer },
        };
      }
    }

    if ((expectedHash !== undefined || expectedFingerprint !== undefined) &&
        (!instOnPort.projectPath && !instOnPort.projectName)) {
      return { ...base, ok: false, errorType: 'TARGET_PROJECT_CHANGED', message: 'Project identity unavailable; placeholder hashes cannot establish identity' };
    }

    if (expectedHash !== undefined) {
      const liveHash = computeProjectPathHash(instOnPort.projectPath || instOnPort.projectName);
      if (liveHash !== expectedHash) {
        return {
          ...base,
          ok: false,
          errorType: 'TARGET_PROJECT_CHANGED',
          message: `目标实例已切换工程（当前哈希 ${liveHash} 与预期 ${expectedHash} 不一致）`,
          detail: { port: wantedPort, liveHash, expectedHash },
        };
      }
    }

    if (expectedFingerprint !== undefined) {
      const liveFingerprint = computeTargetFingerprint({
        port: wantedPort,
        projectName: instOnPort.projectName,
        projectPath: instOnPort.projectPath,
      });
      if (liveFingerprint !== expectedFingerprint) {
        return {
          ...base,
          ok: false,
          errorType: 'TARGET_FINGERPRINT_MISMATCH',
          message: `目标实例指纹已变化（当前指纹 ${liveFingerprint} 与预期 ${expectedFingerprint} 不一致）`,
          detail: { port: wantedPort, liveFingerprint, expectedFingerprint },
        };
      }
    }

    // 双参数一致性强制
    if (rawProject !== undefined) {
      const matches = matchesAllProjects([instOnPort]);
      if (matches.length === 0) {
        const otherMatch = matchesAllProjects(instances);
        const otherPort = otherMatch.length > 0 ? otherMatch[0].port : '未找到';
        return {
          ...base,
          ok: false,
          errorType: 'TARGET_CONFLICT',
          message: `targetPort ${wantedPort} 与 targetProject「${rawProject}」（端口 ${otherPort}）指向不同实例`,
          detail: {
            candidates: otherMatch.map((i) => ({ port: i.port, projectName: i.projectName, projectPath: i.projectPath })),
          },
        };
      }
      return { ...base, ok: true, mode: 'both', port: wantedPort, instance: instOnPort };
    }

    return { ...base, ok: true, mode: 'port', port: wantedPort, instance: instOnPort };
  }

  // —— 仅 targetProject / 约束（无 wantedPort）——
  let matched = instances;
  if (rawProject !== undefined) {
    matched = matchesAllProjects(matched);
    if (matched.length === 0) {
      return {
        ...base,
        ok: false,
        errorType: 'TARGET_PROJECT_NOT_FOUND',
        message: `没有实例打开着「${rawProject}」（按 projectName 或 projectPath 匹配）`,
        detail: {
          discovered: instances.map((i) => ({
            port: i.port,
            projectName: i.projectName,
            projectPath: i.projectPath,
          })),
        },
      };
    }
  }

  if (expectedHash !== undefined) {
    matched = matched.filter((i) => (i.projectPath || i.projectName) && computeProjectPathHash(i.projectPath || i.projectName) === expectedHash);
  }

  if (expectedFingerprint !== undefined) {
    matched = matched.filter((i) => (i.projectPath || i.projectName) && computeTargetFingerprint(i) === expectedFingerprint);
  }

  if (expectedAcVer !== undefined) {
    matched = matched.filter((i) => String(i.archicadVersion || i.productInfo?.version) === String(expectedAcVer));
  }

  if (matched.length === 0) {
    return {
      ...base,
      ok: false,
      errorType: 'TARGET_PROJECT_NOT_FOUND',
      message: `没有实例满足附加工程约束（已发现 ${instances.length} 个实例均不匹配）`,
      detail: {
        discovered: instances.map((i) => ({
          port: i.port,
          projectName: i.projectName,
          projectPath: i.projectPath,
        })),
      },
    };
  }

  if (matched.length > 1) {
    return {
      ...base,
      ok: false,
      errorType: 'TARGET_PROJECT_AMBIGUOUS',
      message: `「${rawProject || '目标工程'}」命中 ${matched.length} 个实例，必须消除歧义后重试（用 targetPort 或更精确的 projectPath）`,
      detail: {
        candidates: matched.map((i) => ({
          port: i.port,
          projectName: i.projectName,
          projectPath: i.projectPath,
        })),
      },
    };
  }

  const byProject = matched[0];
  return {
    ...base,
    ok: true,
    mode: 'project',
    port: byProject.port,
    instance: byProject,
  };
}

module.exports = {
  MIN_PORT,
  MAX_PORT,
  coerceTargetPort,
  matchByProject,
  resolveTargetInstance,
  computeTargetFingerprint,
  computeProjectPathHash,
};
