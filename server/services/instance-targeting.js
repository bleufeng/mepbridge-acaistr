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

const {
  DEFAULT_PORTS,
  describeAllInstances,
  probePort,
} = require('./archicad-instances');

// 允许的实例端口域：与多实例发现的扫描窗口一致（19723..19743）。
const MIN_PORT = DEFAULT_PORTS[0];
const MAX_PORT = DEFAULT_PORTS[DEFAULT_PORTS.length - 1];

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
    if (typeof inst.projectName === 'string' && inst.projectName !== ''
      && inst.projectName.trim().toLowerCase() === needle) return true;
    return false;
  });
  return hits;
}

/**
 * 解析目标实例。
 * @param {Object} body - /api/execute 的请求体（顶层 targetPort / targetProject）
 * @param {Object} deps - 可注入依赖（post / ports / 探测函数），供离线测试替身
 * @returns Promise<{requested:false} |
 *                 {requested:true, ok:true, mode:'port'|'project'|'both', port:number,
 *                  instance?:object, candidates?:object[]} |
 *                 {requested:true, ok:false, errorType:string, message:string, detail?:object}>
 */
async function resolveTargetInstance(body, deps = {}) {
  const rawPort = body ? body.targetPort : undefined;
  const rawProject = body ? body.targetProject : undefined;

  if (rawPort === undefined && rawProject === undefined) {
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

  if (rawProject !== undefined && (typeof rawProject !== 'string' || rawProject.trim() === '')) {
    return {
      requested: true,
      ok: false,
      errorType: 'INVALID_TARGET_PROJECT',
      message: `targetProject 必须是非空字符串（工程名或工程路径），实际为 ${JSON.stringify(rawProject)}`,
    };
  }

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

  // —— 仅 targetPort：单点探测即可，不做全量扫描（热路径延迟考虑）——
  if (rawPort !== undefined && rawProject === undefined) {
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

  // —— 涉及 targetProject：需要工程名，做全量发现 + 描述 ——
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
      message: '当前没有任何存活实例可供 targetProject 匹配',
    };
  }

  let matched;
  if (rawProject !== undefined) {
    matched = matchByProject(instances, rawProject);
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
    if (matched.length > 1) {
      return {
        ...base,
        ok: false,
        errorType: 'TARGET_PROJECT_AMBIGUOUS',
        message: `「${rawProject}」命中 ${matched.length} 个实例，必须消除歧义后重试（用 targetPort 或更精确的 projectPath）`,
        detail: {
          candidates: matched.map((i) => ({
            port: i.port,
            projectName: i.projectName,
            projectPath: i.projectPath,
          })),
        },
      };
    }
  }

  const byProject = rawProject !== undefined ? matched[0] : null;

  // —— 双参数：一致性强制 ——
  if (wantedPort !== null && byProject) {
    if (byProject.port !== wantedPort) {
      return {
        ...base,
        ok: false,
        errorType: 'TARGET_CONFLICT',
        message: `targetPort ${wantedPort} 与 targetProject「${rawProject}」（端口 ${byProject.port}）指向不同实例`,
        detail: {
          candidates: [{ port: byProject.port, projectName: byProject.projectName, projectPath: byProject.projectPath }],
        },
      };
    }
    return { ...base, ok: true, mode: 'both', port: wantedPort, instance: byProject };
  }

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
};
