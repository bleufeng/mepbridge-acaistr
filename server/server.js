const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const extensionManager = require('./services/extension-manager');
const { resolveReleaseLocale } = require('./services/release-locale');

const app = express();
const PORT = process.env.PORT || 19780;
const HOST = process.env.HOST || '127.0.0.1';
const APP_VERSION = '0.1.0';
const JSON_LIMIT = process.env.MEPBRIDGE_JSON_LIMIT || '1mb';
const BUILD_INFO = {
  version: APP_VERSION,
  buildDate: process.env.MEPBRIDGE_BUILD_DATE || null,
  releaseChannel: process.env.MEPBRIDGE_RELEASE_CHANNEL || 'local'
};
const RELEASE_LOCALE = resolveReleaseLocale();

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    const host = String(HOST).toLowerCase();
    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    const isSameConfiguredHost = hostname === host && String(url.port || '') === String(PORT);
    return isLoopback || isSameConfiguredHost;
  } catch (_) {
    return false;
  }
}

function getDescriptorCount() {
  try {
    const descriptorPath = path.join(__dirname, '../ai-adapter/tool-descriptors.json');
    const registry = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
    return Array.isArray(registry.descriptors) ? registry.descriptors.length : null;
  } catch (_) {
    return null;
  }
}

// 中间件
app.use(cors({
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin)) return callback(null, true);
    return callback(new Error(`CORS origin denied: ${origin}`));
  }
}));
app.use(bodyParser.json({ limit: JSON_LIMIT }));

// 日志中间件（必须在路由之前）
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// 导入路由
const statusRouter = require('./routes/status');
const generatePlanRouter = require('./routes/generate-plan');
const executeStepRouter = require('./routes/execute-step');
const executeRouter = require('./routes/execute');
const summarizeResultRouter = require('./routes/summarize-result');
const undoRouter = require('./routes/undo');
const llmConfigRouter = require('./routes/llm-config');
const extensionsRouter = require('./routes/extensions');
const copilotMessageRouter = require('./routes/copilot-message');
const userAssetsRouter = require('./routes/user-assets');
const selectionEventsRouter = require('./routes/selection-events'); // FO-2: 选择集事件推送
const planChainRouter = require('./routes/plan-chain');             // H2: 自治编排引擎
const knowledgeBaseRouter = require('./routes/knowledge-base');     // H8: 知识库建设
const learningMemoryRouter = require('./routes/learning-memory');   // H9: 学习记忆
const proactiveIntelRouter = require('./routes/proactive-intelligence'); // H10: 主动智能
const mcpStatusRouter = require('./routes/mcp-status');             // MCP host integration status

// FO-2 (2026-06-26): 启动选择集事件监听服务（C++ SelectionChangeHandler → 文件信号 → SSE）
const selectionEventService = require('./services/selection-events');

// 注册 API 路由（在静态文件之前）
app.use('/api/status', statusRouter);
app.use('/api/ping', statusRouter); // UI 使用 /api/ping 检查连接
app.use('/api/generate-plan', generatePlanRouter);
app.use('/api/execute-step', executeStepRouter);
app.use('/api/execute', executeRouter); // UI 透传 Archicad JSON API（REVIEW §3.2 方案 B）
app.use('/api/summarize-result', summarizeResultRouter);
app.use('/api/undo', undoRouter);
app.use('/api/llm-config', llmConfigRouter);
app.use('/api/extensions', extensionsRouter);
app.use('/api/copilot/message', copilotMessageRouter); // Copilot NL → Plan（D.1 断点①修复）
app.use('/api/user-assets', userAssetsRouter); // E.2 用户资产持久化（模板/自定义命令/导出导入）
app.use('/api/selection', selectionEventsRouter); // FO-2: 选择集事件推送 (SSE + REST)
app.use('/api/plan-chain', planChainRouter);       // H2: 自治编排引擎（多步执行链 + 闸门）
app.use('/api/knowledge-base', knowledgeBaseRouter); // H8: 知识库（建筑规范+MEP标准+材料规格）
app.use('/api/learning-memory', learningMemoryRouter); // H9: 学习记忆（纠正记录+模式学习）
app.use('/api/proactive', proactiveIntelRouter);      // H10: 主动智能（缺口检测+建议+预判）
app.use('/api/mcp', mcpStatusRouter);                 // MCP plugin host status

// 健康检查
app.get('/health', (req, res) => {
  const moduleStats = extensionManager.getStats();
  res.json({
    status: 'ok',
    version: APP_VERSION,
    build: BUILD_INFO,
    descriptorCount: getDescriptorCount(),
    moduleCount: moduleStats.total,
    moduleCommandCount: moduleStats.commands
  });
});

// UI 配置端点（从旧 server tools/ai-adapter-ui-server.js 迁移，TASK_PLAN A.1.3.1）
// 旧版 app.js / status.html 会 fetch("/ui-config.json") 获取语言和 Archicad 连接信息
// 注意：archicadPort 不再硬编码 19723 —— AC29 实测会用 19724
// 这里返回默认值，实际连接端口由 /api/ping (status.js) 动态扫描 global.archicadPort
const { getArchicadPort } = require('./services/archicad-endpoint');
const archicadHost = '127.0.0.1';
app.get('/ui-config.json', (req, res) => {
  res.json({
    ok: true,
    language: RELEASE_LOCALE,
    archicadHost,
    archicadPort: getArchicadPort()
  });
});

// 静态文件服务（必须在 SPA fallback 之前）
const uiPath = path.join(__dirname, '../ai-adapter/ui/v0.1.0/dist');
console.log(`📂 UI Path: ${uiPath}`);
app.use(express.static(uiPath));

// SPA fallback: 所有非 API、非静态文件请求返回 index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(uiPath, 'index.html'));
});

// API 404 不会到这里，因为已在上面的路由中处理

// 启动服务
app.listen(PORT, HOST, () => {
  console.log(`✅ MEPBridge ACAIstr Server running on http://${HOST}:${PORT}`);
  console.log(`📂 Serving UI from: ${uiPath}`);
  console.log(`🔗 Open: http://${HOST}:${PORT}`);

  // FO-2: 启动选择集事件监听（C++ Add-On 写文件 → Node.js 读文件 → SSE 推送）
  selectionEventService.startWatching();

  // 启动时主动探测 Archicad JSON API 端口（AC29 实测会用 19724，非 19723）
  // 探测结果写入 global.archicadPort，供 execute.js / archicad-client.js 等使用
  const { refreshArchicadPort } = require('./services/archicad-endpoint');
  refreshArchicadPort().then(port => {
    if (port) {
      console.log(`✅ Archicad JSON API detected on port ${port}`);
    } else {
      console.log(`⚠️  Archicad JSON API not detected on ports 19723-19743 (will retry on /api/ping)`);
    }
  }).catch(() => { /* 忽略，status.js 会持续重试 */ });
});
