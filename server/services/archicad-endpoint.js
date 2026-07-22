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

/**
 * 获取当前 Archicad JSON API 端口
 * 优先级：global.archicadPort > ARCHICAD_ENDPOINT 环境变量 > 默认 19723
 */
function getArchicadPort() {
  // 1. status.js 探测到的真实端口
  if (global.archicadPort && typeof global.archicadPort === 'number') {
    return global.archicadPort;
  }
  // 2. 环境变量
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
  // 如果环境变量显式设置了完整 URL，优先使用（保持向后兼容）
  if (process.env.ARCHICAD_ENDPOINT) {
    return process.env.ARCHICAD_ENDPOINT;
  }
  // 用 global.archicadPort 或默认端口构造
  return `http://${DEFAULT_HOST}:${getArchicadPort()}`;
}

/**
 * 强制刷新端口探测（供 status.js 之外的地方在需要时主动探测）
 * 扫描 19723-19743，找到第一个响应 API.GetProductInfo 的端口
 */
async function refreshArchicadPort(axiosInstance) {
  const axios = axiosInstance || require('axios');
  for (let port = 19723; port <= 19743; port++) {
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

module.exports = {
  DEFAULT_PORT,
  DEFAULT_HOST,
  getArchicadPort,
  getArchicadEndpoint,
  refreshArchicadPort
};
