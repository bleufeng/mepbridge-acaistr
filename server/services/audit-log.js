// audit-log.js
// V2 H6.2 审计日志持久化服务
//
// 职责：
//   - 记录每次 PlanChain 执行的完整日志（步骤/结果/失败/回滚/视觉验证）
//   - 持久化到文件系统（JSON 格式，按日期分目录）
//   - 提供查询接口（最近 N 条 / 按 chainId 查询 / 按时间范围）
//   - Before/After 差异快照（H6.3）
//
// 存储路径: .audit-logs/YYYY-MM-DD/chain_<chainId>.json

const fs = require('fs');
const path = require('path');
const { migrateLegacyDirectory } = require('./runtime-paths');

const AUDIT_LOG_DIR = migrateLegacyDirectory('.audit-logs', 'audit-logs');

class AuditLogger {
  constructor() {
    this._ensureDir(AUDIT_LOG_DIR);
  }

  _ensureDir(dir) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (e) {
      console.error('[AuditLogger] Failed to create dir:', dir, e.message);
    }
  }

  _getDateDir() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return path.join(AUDIT_LOG_DIR, `${yyyy}-${mm}-${dd}`);
  }

  /**
   * 记录一条链执行日志（链开始/结束/步骤事件）
   * @param {Object} entry - { chainId, eventType, stepIndex, step, data, timestamp }
   */
  log(entry) {
    try {
      const dateDir = this._getDateDir();
      this._ensureDir(dateDir);

      const fileName = `chain_${entry.chainId}.json`;
      const filePath = path.join(dateDir, fileName);

      // 追加模式：读取现有数组 → push → 写回
      let logArray = [];
      if (fs.existsSync(filePath)) {
        try {
          logArray = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (!Array.isArray(logArray)) logArray = [];
        } catch (e) {
          logArray = [];
        }
      }

      logArray.push({
        ...entry,
        timestamp: entry.timestamp || new Date().toISOString()
      });

      fs.writeFileSync(filePath, JSON.stringify(logArray, null, 2));
    } catch (e) {
      console.error('[AuditLogger] Log write failed:', e.message);
    }
  }

  /**
   * 记录链开始（含初始计划 + 上下文快照）
   */
  logChainStart(chainId, chain, contextSnapshot) {
    this.log({
      chainId,
      eventType: 'chain_start',
      chain: {
        id: chain.id,
        userIntent: chain.userIntent,
        reasoning: chain.reasoning,
        summary: chain.summary,
        mode: chain.mode,
        totalSteps: chain.steps.length,
        steps: chain.steps.map(s => ({
          id: s.id, action: s.action, title: s.title,
          riskLevel: s.riskLevel, dependsOn: s.dependsOn || []
        }))
      },
      contextSnapshot: contextSnapshot ? {
        selectionCount: contextSnapshot.selectionCount,
        modelSnapshot: contextSnapshot.modelSnapshot,
        projectContext: contextSnapshot.projectContext
      } : null
    });
  }

  /**
   * 记录步骤执行（含 Before/After 快照 H6.3）
   */
  logStepExecution(chainId, stepIndex, step, execResult, preState, postCheck) {
    this.log({
      chainId,
      eventType: 'step_execute',
      stepIndex,
      step: {
        id: step.id, action: step.action, title: step.title,
        riskLevel: step.riskLevel, params: step.params,
        status: step.status, _retryCount: step._retryCount
      },
      execResult: {
        ok: execResult.ok,
        error: execResult.error,
        // 截断响应避免日志过大
        response: execResult.response ? JSON.stringify(execResult.response).slice(0, 500) : null
      },
      before: preState ? {
        selectedGuids: preState.selectedGuids ? preState.selectedGuids.slice(0, 10) : null,
        aabb: preState.aabb || null
      } : null,
      after: postCheck ? {
        changed: postCheck.changed,
        addedGuids: (postCheck.addedGuids || []).slice(0, 10),
        removedGuids: (postCheck.removedGuids || []).slice(0, 10),
        aabb: postCheck.aabb || null
      } : null,
      visualFeedback: step.visualVerified !== undefined ? {
        verified: step.visualVerified,
        issues: step.visualIssues,
        suggestions: step.visualSuggestions
      } : null
    });
  }

  /**
   * 记录链结束（含最终统计）
   */
  logChainEnd(chainId, finalStats, finalStatus) {
    this.log({
      chainId,
      eventType: 'chain_end',
      finalStatus,
      finalStats,
      duration: finalStats.duration || null
    });
  }

  /**
   * 记录回滚事件
   */
  logRollback(chainId, stepIndex, rolledBackSteps) {
    this.log({
      chainId,
      eventType: 'rollback',
      stepIndex,
      data: { rolledBackSteps }
    });
  }

  /**
   * 查询指定 chainId 的完整日志
   */
  getChainLog(chainId) {
    try {
      // 在所有日期目录中查找
      if (!fs.existsSync(AUDIT_LOG_DIR)) return null;
      const dateDirs = fs.readdirSync(AUDIT_LOG_DIR).filter(d =>
        fs.statSync(path.join(AUDIT_LOG_DIR, d)).isDirectory()
      );

      for (const dateDir of dateDirs.reverse()) {  // 从最新开始查
        const filePath = path.join(AUDIT_LOG_DIR, dateDir, `chain_${chainId}.json`);
        if (fs.existsSync(filePath)) {
          return {
            chainId,
            date: dateDir,
            entries: JSON.parse(fs.readFileSync(filePath, 'utf8'))
          };
        }
      }
      return null;
    } catch (e) {
      console.error('[AuditLogger] getChainLog failed:', e.message);
      return null;
    }
  }

  /**
   * 列出最近的审计日志（按日期倒序）
   * @param {number} limit - 返回条数
   */
  listRecentChains(limit = 20) {
    try {
      if (!fs.existsSync(AUDIT_LOG_DIR)) return [];
      const dateDirs = fs.readdirSync(AUDIT_LOG_DIR)
        .filter(d => fs.statSync(path.join(AUDIT_LOG_DIR, d)).isDirectory())
        .sort()
        .reverse();

      const results = [];
      for (const dateDir of dateDirs) {
        const files = fs.readdirSync(path.join(AUDIT_LOG_DIR, dateDir))
          .filter(f => f.startsWith('chain_') && f.endsWith('.json'));

        for (const file of files) {
          try {
            const entries = JSON.parse(
              fs.readFileSync(path.join(AUDIT_LOG_DIR, dateDir, file), 'utf8')
            );
            const startEntry = entries.find(e => e.eventType === 'chain_start');
            const endEntry = entries.find(e => e.eventType === 'chain_end');
            if (startEntry) {
              results.push({
                chainId: startEntry.chainId,
                date: dateDir,
                timestamp: startEntry.timestamp,
                userIntent: startEntry.chain?.userIntent,
                totalSteps: startEntry.chain?.totalSteps,
                finalStatus: endEntry?.finalStatus || 'running',
                finalStats: endEntry?.finalStats,
                entriesCount: entries.length
              });
            }
          } catch (e) { /* skip malformed */ }
        }
        if (results.length >= limit) break;
      }
      return results.slice(0, limit);
    } catch (e) {
      console.error('[AuditLogger] listRecentChains failed:', e.message);
      return [];
    }
  }

  /**
   * 生成 Before/After 差异报告（H6.3）
   */
  generateDiffReport(chainId) {
    const log = this.getChainLog(chainId);
    if (!log) return null;

    const stepExecs = log.entries.filter(e => e.eventType === 'step_execute');
    const diffs = stepExecs.map(se => ({
      stepIndex: se.stepIndex,
      action: se.step?.action,
      title: se.step?.title,
      status: se.step?.status,
      before: se.before,
      after: se.after,
      changed: se.after?.changed || false,
      addedCount: se.after?.addedGuids?.length || 0,
      removedCount: se.after?.removedGuids?.length || 0
    }));

    return {
      chainId,
      totalSteps: stepExecs.length,
      changedSteps: diffs.filter(d => d.changed).length,
      totalAdded: diffs.reduce((sum, d) => sum + d.addedCount, 0),
      totalRemoved: diffs.reduce((sum, d) => sum + d.removedCount, 0),
      diffs
    };
  }
}

module.exports = new AuditLogger();
