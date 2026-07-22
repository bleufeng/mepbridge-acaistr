// AuditLogPanel.tsx
// V2 H6.2/H6.3: 审计日志查看器 — 查询历史执行链 + Before/After 差异报告
//
// 功能:
//   - 最近执行链列表（chainId/date/userIntent/totalSteps/finalStatus）
//   - 点击单条链 → 展开完整事件流（entries[]）
//   - Before/After 差异报告（H6.3: addedCount/removedCount/changedSteps）
//   - 刷新 + 限制条数控制
//
// API 契约（见 server/routes/plan-chain.js）:
//   GET /api/plan-chain/audit/recent?limit=20
//   GET /api/plan-chain/audit/:chainId
//   GET /api/plan-chain/audit/:chainId/diff

import { useState, useEffect, useCallback } from "react";

interface ChainSummary {
  chainId: string;
  date: string;
  timestamp: string;
  userIntent?: string;
  totalSteps?: number;
  finalStatus: string;
  finalStats?: Record<string, unknown>;
  entriesCount: number;
}

interface AuditEntry {
  eventType: string;
  timestamp?: string;
  chainId?: string;
  stepIndex?: number;
  step?: {
    action?: string;
    title?: string;
    status?: string;
    riskLevel?: string;
    params?: Record<string, unknown>;
  };
  chain?: {
    userIntent?: string;
    totalSteps?: number;
  };
  finalStatus?: string;
  finalStats?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  error?: string;
  data?: Record<string, unknown>;
}

interface DiffReport {
  chainId: string;
  totalSteps: number;
  changedSteps: number;
  totalAdded: number;
  totalRemoved: number;
  diffs: Array<{
    stepIndex: number;
    action?: string;
    title?: string;
    status?: string;
    changed: boolean;
    addedCount: number;
    removedCount: number;
  }>;
}

interface AuditLogPanelProps {
  lang?: "zh-CN" | "en-US";
  embedded?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "text-emerald-400 bg-emerald-900/30",
  success: "text-emerald-400 bg-emerald-900/30",
  failed: "text-rose-400 bg-rose-900/30",
  cancelled: "text-zinc-400 bg-zinc-800",
  running: "text-amber-400 bg-amber-900/30",
  paused: "text-cyan-400 bg-cyan-900/30",
};

const EVENT_LABELS: Record<string, { zh: string; en: string }> = {
  chain_start: { zh: "链启动", en: "Chain Start" },
  chain_end: { zh: "链结束", en: "Chain End" },
  step_execute: { zh: "步骤执行", en: "Step Execute" },
  step_complete: { zh: "步骤完成", en: "Step Complete" },
  step_failed: { zh: "步骤失败", en: "Step Failed" },
  gate_trigger: { zh: "闸门触发", en: "Gate Trigger" },
  rollback: { zh: "回滚", en: "Rollback" },
  visual_verify: { zh: "视觉验证", en: "Visual Verify" },
};

export default function AuditLogPanel({ lang = "zh-CN", embedded = false }: AuditLogPanelProps) {
  const [chains, setChains] = useState<ChainSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(20);
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [diff, setDiff] = useState<DiffReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");

  const loadChains = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/plan-chain/audit/recent?limit=${limit}`);
      const data = await res.json();
      if (data.ok) {
        setChains(data.chains || []);
      } else {
        setStatusMsg(`❌ ${data.error || "load failed"}`);
      }
    } catch (e: any) {
      setStatusMsg(`❌ ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    loadChains();
  }, [loadChains]);

  // 加载单条链详情 + 差异报告
  const loadChainDetail = async (chainId: string) => {
    if (selectedChainId === chainId) {
      // 再次点击折叠
      setSelectedChainId(null);
      setEntries([]);
      setDiff(null);
      return;
    }
    setSelectedChainId(chainId);
    setDetailLoading(true);
    setEntries([]);
    setDiff(null);
    try {
      const [logRes, diffRes] = await Promise.all([
        fetch(`/api/plan-chain/audit/${chainId}`).then(r => r.json()),
        fetch(`/api/plan-chain/audit/${chainId}/diff`).then(r => r.json()).catch(() => ({ ok: false })),
      ]);
      if (logRes.ok) {
        setEntries(logRes.entries || []);
      }
      if (diffRes.ok) {
        setDiff({
          chainId: diffRes.chainId,
          totalSteps: diffRes.totalSteps,
          changedSteps: diffRes.changedSteps,
          totalAdded: diffRes.totalAdded,
          totalRemoved: diffRes.totalRemoved,
          diffs: diffRes.diffs || [],
        });
      }
    } catch (e: any) {
      setStatusMsg(`❌ ${e.message}`);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (statusMsg) {
      const timer = setTimeout(() => setStatusMsg(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMsg]);

  const formatTime = (ts?: string) => {
    if (!ts) return "-";
    try {
      return new Date(ts).toLocaleString(lang === "zh-CN" ? "zh-CN" : "en-US");
    } catch {
      return ts;
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-200">
      {/* 顶部标题 + 刷新 */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!embedded && (
            <span className="text-sm font-semibold font-display">
              📋 {lang === "zh-CN" ? "审计日志" : "Audit Log"}
            </span>
          )}
          <span className="text-[10px] font-mono text-zinc-500">
            ({chains.length} {lang === "zh-CN" ? "条链" : "chains"})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="text-[10px] bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-300"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <button
            onClick={loadChains}
            className="px-2 py-0.5 text-[10px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
          >
            {lang === "zh-CN" ? "刷新" : "Refresh"}
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="flex-shrink-0 px-4 py-1.5 text-[11px] bg-zinc-900/60 text-zinc-400 border-b border-zinc-800">
          {statusMsg}
        </div>
      )}

      {/* 链列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="text-center text-zinc-500 text-xs py-8">
            {lang === "zh-CN" ? "加载中..." : "Loading..."}
          </div>
        ) : chains.length === 0 ? (
          <div className="text-center text-zinc-600 text-xs py-8">
            {lang === "zh-CN" ? "暂无审计日志（执行 PlanChain 后自动记录）" : "No audit logs yet (recorded after PlanChain execution)"}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {chains.map((c) => (
              <div key={c.chainId} className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
                {/* 链摘要 */}
                <button
                  onClick={() => loadChainDetail(c.chainId)}
                  className="w-full text-left p-3 hover:bg-zinc-900/60 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-indigo-400">
                        {c.chainId.slice(0, 12)}...
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_COLORS[c.finalStatus] || "text-zinc-400 bg-zinc-800"}`}>
                        {c.finalStatus}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-600">{formatTime(c.timestamp)}</span>
                  </div>
                  <div className="text-xs text-zinc-300 truncate">
                    {c.userIntent || (lang === "zh-CN" ? "(无意图)" : "(no intent)")}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 flex gap-3">
                    <span>{lang === "zh-CN" ? "步骤" : "Steps"}: {c.totalSteps || 0}</span>
                    <span>{lang === "zh-CN" ? "事件" : "Events"}: {c.entriesCount}</span>
                    <span>{lang === "zh-CN" ? "日期" : "Date"}: {c.date}</span>
                  </div>
                </button>

                {/* 展开详情 */}
                {selectedChainId === c.chainId && (
                  <div className="border-t border-zinc-800 p-3 bg-zinc-950/60">
                    {detailLoading ? (
                      <div className="text-center text-zinc-500 text-[11px] py-4">
                        {lang === "zh-CN" ? "加载详情..." : "Loading detail..."}
                      </div>
                    ) : (
                      <>
                        {/* 差异报告 */}
                        {diff && (
                          <div className="mb-3 rounded border border-cyan-900/40 bg-cyan-900/10 p-2">
                            <div className="text-[10px] font-semibold text-cyan-300 uppercase tracking-wider mb-1">
                              {lang === "zh-CN" ? "H6.3 差异报告" : "H6.3 Diff Report"}
                            </div>
                            <div className="flex gap-3 text-[11px]">
                              <span className="text-zinc-400">
                                {lang === "zh-CN" ? "变更步骤" : "Changed"}: <span className="text-amber-400">{diff.changedSteps}/{diff.totalSteps}</span>
                              </span>
                              <span className="text-emerald-400">+{diff.totalAdded}</span>
                              <span className="text-rose-400">-{diff.totalRemoved}</span>
                            </div>
                          </div>
                        )}

                        {/* 事件流 */}
                        <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                          {lang === "zh-CN" ? "事件流" : "Event Stream"} ({entries.length})
                        </div>
                        <div className="max-h-64 overflow-y-auto flex flex-col gap-1">
                          {entries.length === 0 ? (
                            <div className="text-[11px] text-zinc-600 py-2">{lang === "zh-CN" ? "无事件记录" : "No events"}</div>
                          ) : (
                            entries.map((e, i) => {
                              const label = EVENT_LABELS[e.eventType] || { zh: e.eventType, en: e.eventType };
                              const isFail = e.eventType === "step_failed" || e.eventType === "rollback";
                              return (
                                <div key={i} className={`rounded border px-2 py-1 text-[10px] font-mono ${
                                  isFail ? "border-rose-900/40 bg-rose-900/10" : "border-zinc-800 bg-zinc-900/40"
                                }`}>
                                  <div className="flex items-center justify-between">
                                    <span className={isFail ? "text-rose-400" : "text-zinc-300"}>
                                      {isFail ? "❌" : "•"} {lang === "zh-CN" ? label.zh : label.en}
                                      {e.stepIndex !== undefined && ` #${e.stepIndex}`}
                                    </span>
                                    <span className="text-zinc-600">{formatTime(e.timestamp)}</span>
                                  </div>
                                  {e.step?.title && (
                                    <div className="text-zinc-500 mt-0.5">{e.step.title}</div>
                                  )}
                                  {e.step?.action && (
                                    <div className="text-indigo-400/70">action: {e.step.action}</div>
                                  )}
                                  {e.error && (
                                    <div className="text-rose-400 mt-0.5">error: {e.error}</div>
                                  )}
                                  {e.finalStatus && (
                                    <div className="text-emerald-400 mt-0.5">finalStatus: {e.finalStatus}</div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
