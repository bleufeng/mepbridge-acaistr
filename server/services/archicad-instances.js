// Archicad 多实例发现
//
// 每个 Archicad 实例各自监听一个 JSON API 端口（19723 起递增；AC29 实测会用 19724，
// 见 server/routes/execute.js 的注释）。原先 status.js 的 checkArchicad() 命中首个端口
// 即 return，只能看到一个实例，因此无法支持「A 文件读 / B 文件写」这类跨文件场景。
//
// 本模块把发现过程独立出来并改为并行探测：串行探测 21 个端口在全部离线时最坏要 21 秒，
// 而 /api/ping 是被 UI 轮询的热路径。
//
// 端口选择必须确定：双实例下若每次扫描都取「最先响应」的端口，global.archicadPort 会在
// 两个实例间跳变，导致写命令落到错误的文件。故 pickPrimaryPort 优先沿用已知存活端口，
// 否则取最小端口号。

const DEFAULT_PORTS = Array.from({ length: 21 }, (_, i) => 19723 + i);
const PROBE_TIMEOUT_MS = 1000;
const DESCRIBE_TIMEOUT_MS = 2500;

function extractProductInfo(payload) {
  if (!payload) return null;
  const result = payload.result || payload;
  if (!result || (result.version === undefined && result.buildNumber === undefined)) return null;
  return {
    version: result.version !== undefined ? result.version : null,
    buildNumber: result.buildNumber !== undefined ? result.buildNumber : null,
    languageCode: result.languageCode !== undefined ? result.languageCode : null,
  };
}

// 探测单个端口是否有 Archicad JSON API 在监听
async function probePort(port, { post, timeout = PROBE_TIMEOUT_MS } = {}) {
  try {
    const response = await post(`http://127.0.0.1:${port}`, { command: 'API.GetProductInfo' }, { timeout });
    const productInfo = extractProductInfo(response && response.data);
    if (!productInfo) return null;
    return { port, productInfo };
  } catch (_) {
    return null;
  }
}

// 并行探测全部端口，按端口号升序返回存活实例
async function discoverInstances({ post, ports = DEFAULT_PORTS, timeout = PROBE_TIMEOUT_MS } = {}) {
  const results = await Promise.all(ports.map((port) => probePort(port, { post, timeout })));
  return results.filter(Boolean).sort((a, b) => a.port - b.port);
}

// 确定性选取主端口：已知端口仍存活则沿用，避免双实例间跳变
function pickPrimaryPort(instances, preferredPort) {
  if (!instances || instances.length === 0) return null;
  if (preferredPort && instances.some((i) => i.port === preferredPort)) return preferredPort;
  return instances[0].port;
}

// 补齐单个实例的 MEPBridge 可用性与当前打开的工程
async function describeInstance(instance, { post, timeout = DESCRIBE_TIMEOUT_MS } = {}) {
  const described = {
    port: instance.port,
    productInfo: instance.productInfo,
    mepbridge: false,
    addOnVersion: null,
    archicadVersion: null,
    projectName: null,
    projectPath: null,
    untitled: null,
    teamwork: null,
  };

  const callAddOn = async (commandName) => {
    const response = await post(
      `http://127.0.0.1:${instance.port}`,
      {
        command: 'API.ExecuteAddOnCommand',
        parameters: {
          addOnCommandId: { commandNamespace: 'MEPBridge', commandName },
          addOnCommandParameters: {},
        },
      },
      { timeout }
    );
    const data = response && response.data;
    return (data && data.result && data.result.addOnCommandResponse) || null;
  };

  // MEPBridge 未加载的实例仍应出现在列表里，只是缺少工程信息
  try {
    const ping = await callAddOn('Ping');
    if (ping && ping.status === 'ok') {
      described.mepbridge = true;
      described.addOnVersion = ping.version || null;
      described.archicadVersion = ping.archicadVersion !== undefined ? ping.archicadVersion : null;
    }
  } catch (_) { /* 保持 mepbridge=false */ }

  if (described.mepbridge) {
    try {
      const info = await callAddOn('GetProjectInfo');
      const p = info && info.projectInfo;
      if (p) {
        described.projectName = p.projectName || null;
        described.projectPath = p.projectPath || null;
        described.untitled = p.untitled !== undefined ? p.untitled : null;
        described.teamwork = p.teamwork !== undefined ? p.teamwork : null;
      }
    } catch (_) { /* 工程信息缺失不影响实例可见性 */ }
  }

  return described;
}

async function describeAllInstances({ post, ports, probeTimeout, describeTimeout } = {}) {
  const instances = await discoverInstances({ post, ports, timeout: probeTimeout });
  return Promise.all(instances.map((i) => describeInstance(i, { post, timeout: describeTimeout })));
}

module.exports = {
  DEFAULT_PORTS,
  PROBE_TIMEOUT_MS,
  DESCRIBE_TIMEOUT_MS,
  extractProductInfo,
  probePort,
  discoverInstances,
  pickPrimaryPort,
  describeInstance,
  describeAllInstances,
};
