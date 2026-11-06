// archicad-endpoint.js
// 统一的 Archicad JSON API 端点解析器
//
// 背景：
//   Archicad JSON API 端口并非固定 19723。AC28/AC29 会在 19723-19743 范围内动态选择
//   （多实例时端口递增，AC29 实测会选 19724）。
//   status.js 通过端口扫描写入 global.archicadPort，但历史上 execute.js /
//   archicad-client.js / copilot-message.js / plan-chain.js 等都硬编码 19723，
//   导致 ping 在线但执行命令报 ARCHICAD_OFFLINE。
//
// 解决方案：
//   1. 优先读 global.archicadPort（status.js 实时探测写入）
//   2. 其次读 ARCHICAD_ENDPOINT 环境变量
//   3. 最后回退到默认 19723
//
// 用法：
//   const { getArchicadEndpoint, getArchicadPort } = require('./archicad-endpoint');
//   const endpoint = getArchicadEndpoint();
//   const port = getArchicadPort();

const DEFAULT_PORT = 19723;
const DEFAULT_HOST = '127.0.0.1';

// Archicad 实例端口扫描域。与 server/services/archicad-instances.js 的 DEFAULT_PORTS
// 和 server/services/instance-targeting.js 的 [MIN_PORT, MAX_PORT] 必须一致。
const MIN_PORT = 19723;
const MAX_PORT = 19743;

/**
 * 把端口号构造成端点 URL。
 *
 * 双实例场景下 AC28 与 AC29 各占一个端口（实测 19723 / 19724），此时「当前端点」
 * 这个概念本身就不足以定位目标实例 —— 调用方必须显式指定端口。D-1 的
 * targetPort/targetProject 走的是这条路径，而不是 global.archicadPort。
 */
function endpointForPort(port) {
  const parsed = typeof port === 'number' ? port : parseInt(port, 10);
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    throw new RangeError(`Archicad port ${port} is outside the scan range [${MIN_PORT}, ${MAX_PORT}]`);
  }
  return `http://${DEFAULT_HOST}:${parsed}`;
}

/**
 * 获取当前 Archicad JSON API 端口
 * 优先级：global.archicadPort > ARCHICAD_ENDPOINT 环境变量 > 默认 19723
 */
function getArchicadPort() {
  // 1. status.js 探测到的真实端口
  if (global.archicadPort && typeof global.archicadPort === 'number') {
    return global.archicadPort;
  }
  // 2. 环境变量（支持 ARCHICAD_ENDPOINT 或 ARCHICAD_PORT）
  if (process.env.ARCHICAD_PORT) {
    const p = parseInt(process.env.ARCHICAD_PORT, 10);
    if (p > 0) return p;
  }
  if (process.env.ARCHICAD_ENDPOINT) {
    try {
      const url = new URL(process.env.ARCHICAD_ENDPOINT);
      const p = parseInt(url.port, 10);
      if (p > 0) return p;
    } catch (_) {
      // 忽略解析错误
    }
  }
  // 3. 默认
  return DEFAULT_PORT;
}

/**
 * 获取当前 Archicad JSON API 完整端点 URL
 */
function getArchicadEndpoint() {
  // The live, validated primary port must win over startup configuration.
  // Start-BaseWorkbench sets ARCHICAD_ENDPOINT as an initial preference; treating
  // it as permanently authoritative makes /api/ping and UI instance switching
  // disagree with execution after Archicad moves to another dynamic port.
  const host = process.env.ARCHICAD_HOST || DEFAULT_HOST;
  return `http://${host}:${getArchicadPort()}`;
}

/**
 * 强制刷新端口探测（供 status.js 之外的地方在需要时主动探测）
 *
 * 扫描 19723-19743。**命中首个存活端口即返回** —— 这在双实例下是刻意的：主端口必须
 * 确定性、不得在实例间跳变，否则写命令会漂移到错误的工程文件。要拿到全部存活实例
 * 请用 archicad-instances.js 的 discoverInstances；要写入特定实例请用
 * instance-targeting.js 的 targetPort/targetProject，而不是改这里的语义。
 */
async function refreshArchicadPort(axiosInstance) {
  const axios = axiosInstance || require('axios');
  for (let port = MIN_PORT; port <= MAX_PORT; port++) {
    try {
      const response = await axios.post(
        `http://${DEFAULT_HOST}:${port}`,
        { command: 'API.GetProductInfo' },
        { timeout: 800 }
      );
      if (response.data && (response.data.version || response.data.result?.version)) {
        global.archicadPort = port;
        return port;
      }
    } catch (_) {
      // 继续尝试下一个端口
    }
  }
  return null;
}

/**
 * V19-INST-01: 解析实例端点 URL。
 * 若提供显式 port 或 endpoint，解析并验证；若未提供则返回动态默认端点。
 */
function resolveInstanceEndpoint(target) {
  if (!target) return getArchicadEndpoint();
  if (typeof target === 'number' || (typeof target === 'string' && /^\d+$/.test(target.trim()))) {
    return endpointForPort(target);
  }
  if (typeof target === 'object') {
    if (target.port !== undefined) return endpointForPort(target.port);
    if (typeof target.endpoint === 'string' && target.endpoint.trim() !== '') {
      return target.endpoint.trim();
    }
  }
  return getArchicadEndpoint();
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_HOST,
  MIN_PORT,
  MAX_PORT,
  getArchicadPort,
  getArchicadEndpoint,
  endpointForPort,
  refreshArchicadPort,
  resolveInstanceEndpoint
};
