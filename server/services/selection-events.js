// selection-events.js
// FO-2 (2026-06-26): 选择集事件推送服务
//
// 架构：C++ SelectionChangeHandler → 写信号文件 → fs.watch → 内存状态更新 → SSE 推送给 UI
// 替代 UI 端 3s 轮询，实现 <500ms 延迟的实时选择集同步

const fs = require('fs');
const path = require('path');
const os = require('os');
const { dataPath, ensureDir } = require('./runtime-paths');

// 信号文件路径（与 C++ 端 MEPBridge.cpp 保持一致）
function getSignalFilePath() {
  if (process.env.MEPBRIDGE_SELECTION_EVENT_FILE) {
    return process.env.MEPBRIDGE_SELECTION_EVENT_FILE;
  }
  if (process.env.MEPBRIDGE_DATA_DIR) {
    const signalPath = dataPath('selection-event.json');
    ensureDir(path.dirname(signalPath));
    return signalPath;
  }
  // 与 C++ GetSelectionEventFilePath() 一致: %APPDATA%/MEPBridge/selection-event.json
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const signalPath = path.join(appData, 'MEPBridge', 'selection-event.json');
  ensureDir(path.dirname(signalPath));
  return signalPath;
}

class SelectionEventService {
  constructor() {
    this.signalPath = getSignalFilePath();
    this.latestState = {
      timestamp: null,
      count: 0,
      types: [],
      guids: [],
      source: 'none'
    };
    this.listeners = new Set();       // SSE response objects
    this.isWatching = false;
    this.watchTimer = null;
    this.lastFileMtime = null;
    this.pollIntervalMs = 500;        // 文件轮询间隔（fs.watch 在某些系统不可靠，用 poll 兜底）
    this._lastFileContentHash = '';   // 内容 hash 用于去重
  }

  // 启动文件监听
  startWatching() {
    if (this.isWatching) return;

    this.isWatching = true;
    console.log(`[SelectionEvent] Watching: ${this.signalPath}`);

    // 方案1: fs.watch（操作系统原生事件，低延迟）
    try {
      fs.watch(this.signalPath, (eventType, filename) => {
        if (eventType === 'change') {
          this._readAndBroadcast();
        }
      });
      console.log('[SelectionEvent] fs.watch registered (native OS events)');
    } catch (err) {
      console.warn('[SelectionEvent] fs.watch failed, fallback to polling:', err.message);
    }

    // 方案2: 轮询兜底（跨平台兼容，尤其 Windows 上 fs.watch 不可靠）
    this._startPolling();

    // 首次读取（C++ 可能已经写入了初始状态）
    this._readAndBroadcast();
  }

  _startPolling() {
    this.watchTimer = setInterval(() => {
      try {
        const stats = fs.statSync(this.signalPath);
        const mtime = stats.mtime.getTime();
        if (mtime !== this.lastFileMtime) {
          this.lastFileMtime = mtime;
          this._readAndBroadcast();
        }
      } catch (err) {
        // 文件不存在是正常情况（C++ Add-On 未启动或未触发选择变更）
      }
    }, this.pollIntervalMs);
  }

  // 停止监听
  stopWatching() {
    this.isWatching = false;
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  // 读取信号文件并广播
  _readAndBroadcast() {
    try {
      const raw = fs.readFileSync(this.signalPath, 'utf8');
      // 内容 hash 去重（避免重复广播同一内容）
      const hash = raw.length + '_' + raw.slice(-50); // 轻量 hash
      if (hash === this._lastFileContentHash) return;
      this._lastFileContentHash = hash;

      const data = JSON.parse(raw);
      this.latestState = {
        timestamp: data.timestamp || new Date().toISOString(),
        count: data.count || 0,
        types: data.types || [],
        guids: data.guids || [],
        triggerNeigId: data.triggerNeigId,
        source: 'cpp-selection-handler'
      };

      console.log(`[SelectionEvent] Updated: ${this.latestState.count} elements, types=[${this.latestState.types.map(t => `${t.type}(${t.count})`).join(', ')}]`);
      this._broadcast();
    } catch (err) {
      // JSON 解析失败或文件不存在 — 静默处理
      if (err.code !== 'ENOENT') {
        console.warn('[SelectionEvent] Read error:', err.message);
      }
    }
  }

  // 注册 SSE 监听器
  addListener(res) {
    this.listeners.add(res);

    // 立即发送当前状态
    res.write(`data: ${JSON.stringify({ type: 'state', ...this.latestState })}\n\n`);

    // 清理断开的连接
    res.on('close', () => {
      this.listeners.delete(res);
    });

    console.log(`[SelectionEvent] SSE client connected (total: ${this.listeners.size})`);
  }

  // 移除 SSE 监听器
  removeListener(res) {
    this.listeners.delete(res);
  }

  // 向所有 SSE 客户端广播
  _broadcast() {
    if (this.listeners.size === 0) return;

    const payload = `data: ${JSON.stringify({ type: 'change', ...this.latestState })}\n\n`;
    const deadListeners = [];

    for (const res of this.listeners) {
      try {
        res.write(payload);
      } catch (err) {
        deadListeners.push(res);
      }
    }

    // 清理死连接
    for (const res of deadListeners) {
      this.listeners.delete(res);
    }

    if (deadListeners.length > 0) {
      console.log(`[SelectionEvent] Cleaned ${deadListeners.length} dead connections (remaining: ${this.listeners.size})`);
    }
  }

  // REST API: 获取当前选择集状态（非 SSE 场景）
  getState() {
    return { ...this.latestState };
  }
}

module.exports = new SelectionEventService();
