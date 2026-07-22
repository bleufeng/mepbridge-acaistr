// ProactiveSuggestions.tsx
// V2 H10.5: 主动智能建议面板 — 实时建议气泡 + 灵敏度配置
//
// 功能:
//   - 综合建议列表（anomaly/gap/prediction 三类，按优先级排序）
//   - 灵敏度四档切换（off/low/medium/aggressive，H10.6）
//   - 手动刷新 + 自动轮询（medium/aggressive 档 15s 轮询）
//   - 建议点击 → 触发对应 suggestedAction 回调（供父组件执行）
//
// API 契约（见 server/routes/proactive-intelligence.js）:
//   GET  /api/proactive/suggestions        — 综合建议（anomaly+gap+prediction）
//   GET  /api/proactive/sensitivity        — 当前灵敏度
//   POST /api/proactive/sensitivity        — 设置灵敏度 body: { level }

import { useState, useEffect, useCallback, useRef } from "react";

type SensitivityLevel = "off" | "low" | "medium" | "aggressive";

interface Suggestion {
  type: "anomaly" | "gap" | "prediction";
  severity: "error" | "warning" | "info";
  title: string;
  message: string;
  elementGuid?: string;
  suggestedActions?: string[];
  suggestedAction?: string;
  suggestedParams?: Record<string, unknown>;
  confidence?: number;
}

interface ProactiveSuggestionsProps {
  lang?: "zh-CN" | "en-US";
  embedded?: boolean;
  onSuggestionClick?: (action: string, params?: Record<string, unknown>) => void;
}

const SENSITIVITY_LABELS: Record<SensitivityLevel, { zh: string; en: string; color: string; dot: string }> = {
  off: { zh: "关闭", en: "Off", color: "text-zinc-500", dot: "bg-zinc-600" },
  low: { zh: "低", en: "Low", color: "text-emerald-400", dot: "bg-emerald-500" },
  medium: { zh: "中", en: "Medium", color: "text-amber-400", dot: "bg-amber-500" },
  aggressive: { zh: "激进", en: "Aggressive", color: "text-rose-400", dot: "bg-rose-500" },
};

const SEVERITY_STYLES: Record<string, { border: string; bg: string; icon: string; label: string }> = {
  error: { border: "border-rose-700/50", bg: "bg-rose-900/15", icon: "🚨", label: "ERROR" },
  warning: { border: "border-amber-700/40", bg: "bg-amber-900/15", icon: "⚠️", label: "WARN" },
  info: { border: "border-indigo-800/40", bg: "bg-indigo-900/15", icon: "💡", label: "INFO" },
};

const TYPE_ICONS: Record<string, string> = {
  anomaly: "🚨",
  gap: "💡",
  prediction: "🔮",
};

export default function ProactiveSuggestions({ lang = "zh-CN", embedded = false, onSuggestionClick }: ProactiveSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [sensitivity, setSensitivity] = useState<SensitivityLevel>("medium");
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [autoPoll, setAutoPoll] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 加载灵敏度
  const loadSensitivity = useCallback(async () => {
    try {
      const res = await fetch("/api/proactive/sensitivity");
      const data = await res.json();
      if (data.ok && data.level) {
        setSensitivity(data.level as SensitivityLevel);
      }
    } catch (e) {
      console.error("[Proactive] Load sensitivity failed:", e);
    }
  }, []);

  // 加载建议
  const loadSuggestions = useCallback(async () => {
    if (sensitivity === "off") {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/proactive/suggestions");
      const data = await res.json();
      if (data.ok) {
        if (data.enabled === false) {
          setSuggestions([]);
        } else {
          setSuggestions(data.suggestions || []);
        }
        setLastUpdated(new Date().toLocaleTimeString(lang === "zh-CN" ? "zh-CN" : "en-US"));
      }
    } catch (e) {
      // 静默失败，不打扰用户
      console.error("[Proactive] Load suggestions failed:", e);
    } finally {
      setLoading(false);
    }
  }, [sensitivity, lang]);

  useEffect(() => {
    loadSensitivity();
  }, [loadSensitivity]);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  // 自动轮询（medium/aggressive 档 15s）
  useEffect(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (autoPoll && (sensitivity === "medium" || sensitivity === "aggressive")) {
      pollTimer.current = setInterval(() => {
        loadSuggestions();
      }, 15000);
    }
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [autoPoll, sensitivity, loadSuggestions]);

  // 切换灵敏度
  const handleSensitivityChange = async (level: SensitivityLevel) => {
    try {
      const res = await fetch("/api/proactive/sensitivity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      });
      const data = await res.json();
      if (data.ok) {
        setSensitivity(level);
        setStatusMsg(`✅ ${lang === "zh-CN" ? "灵敏度已设为" : "Sensitivity set to"} ${SENSITIVITY_LABELS[level][lang === "zh-CN" ? "zh" : "en"]}`);
        if (level === "off") {
          setSuggestions([]);
        } else {
          loadSuggestions();
        }
      } else {
        setStatusMsg(`❌ ${data.error}`);
      }
    } catch (e: any) {
      setStatusMsg(`❌ ${e.message}`);
    }
  };

  useEffect(() => {
    if (statusMsg) {
      const timer = setTimeout(() => setStatusMsg(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMsg]);

  const handleSuggestionClick = (s: Suggestion) => {
    const action = s.suggestedAction || (s.suggestedActions && s.suggestedActions[0]);
    if (action && onSuggestionClick) {
      onSuggestionClick(action, s.suggestedParams);
    }
  };

  const isOff = sensitivity === "off";

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-200">
      {/* 顶部标题 + 灵敏度选择 */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {!embedded && (
              <span className="text-sm font-semibold font-display">
                🔮 {lang === "zh-CN" ? "主动智能" : "Proactive AI"}
              </span>
            )}
            {lastUpdated && (
              <span className="text-[10px] font-mono text-zinc-600">
                {lang === "zh-CN" ? "更新于" : "updated"} {lastUpdated}
              </span>
            )}
          </div>
          <button
            onClick={loadSuggestions}
            disabled={isOff || loading}
            className="px-2 py-0.5 text-[10px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "..." : (lang === "zh-CN" ? "刷新" : "Refresh")}
          </button>
        </div>

        {/* 灵敏度四档 */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-zinc-500 mr-1">{lang === "zh-CN" ? "灵敏度" : "Sensitivity"}:</span>
          {(Object.keys(SENSITIVITY_LABELS) as SensitivityLevel[]).map((lvl) => (
            <button
              key={lvl}
              onClick={() => handleSensitivityChange(lvl)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                sensitivity === lvl
                  ? `${SENSITIVITY_LABELS[lvl].color} bg-zinc-800 border border-zinc-700`
                  : "text-zinc-600 hover:text-zinc-400 border border-transparent"
              }`}
            >
              <span className={`inline-flex rounded-full h-1.5 w-1.5 ${SENSITIVITY_LABELS[lvl].dot}`}></span>
              {lang === "zh-CN" ? SENSITIVITY_LABELS[lvl].zh : SENSITIVITY_LABELS[lvl].en}
            </button>
          ))}
        </div>

        {/* 自动轮询开关 */}
        {!isOff && (
          <label className="flex items-center gap-1.5 mt-1.5 text-[10px] text-zinc-500 cursor-pointer">
            <input
              type="checkbox"
              checked={autoPoll}
              onChange={(e) => setAutoPoll(e.target.checked)}
              className="w-3 h-3 accent-indigo-500"
            />
            {lang === "zh-CN" ? "自动轮询（15s）" : "Auto-poll (15s)"}
          </label>
        )}
      </div>

      {statusMsg && (
        <div className="flex-shrink-0 px-4 py-1.5 text-[11px] bg-zinc-900/60 text-zinc-400 border-b border-zinc-800">
          {statusMsg}
        </div>
      )}

      {/* 建议列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isOff ? (
          <div className="text-center text-zinc-600 text-xs py-8">
            {lang === "zh-CN" ? "主动智能已关闭，切换灵敏度档位以启用" : "Proactive AI is off. Switch sensitivity to enable."}
          </div>
        ) : loading && suggestions.length === 0 ? (
          <div className="text-center text-zinc-500 text-xs py-8">
            {lang === "zh-CN" ? "分析模型状态中..." : "Analyzing model..."}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="text-center text-zinc-600 text-xs py-8">
            ✅ {lang === "zh-CN" ? "暂无主动建议，模型状态良好" : "No suggestions. Model looks good."}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {suggestions.map((s, i) => {
              const style = SEVERITY_STYLES[s.severity] || SEVERITY_STYLES.info;
              const hasAction = !!(s.suggestedAction || (s.suggestedActions && s.suggestedActions.length > 0));
              return (
                <div
                  key={i}
                  className={`rounded-lg border ${style.border} ${style.bg} p-3 ${
                    hasAction ? "cursor-pointer hover:brightness-125 transition-all" : ""
                  }`}
                  onClick={() => hasAction && handleSuggestionClick(s)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{TYPE_ICONS[s.type] || style.icon}</span>
                      <span className="text-xs font-semibold text-zinc-200">{s.title}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] px-1 py-0.5 rounded font-mono ${
                        s.severity === "error" ? "bg-rose-900/40 text-rose-400" :
                        s.severity === "warning" ? "bg-amber-900/40 text-amber-400" :
                        "bg-indigo-900/40 text-indigo-400"
                      }`}>
                        {style.label}
                      </span>
                      {s.confidence !== undefined && (
                        <span className="text-[9px] text-zinc-600 font-mono">
                          {Math.round(s.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-zinc-300">{s.message}</div>
                  {s.suggestedActions && s.suggestedActions.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {s.suggestedActions.map((a) => (
                        <span key={a} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-indigo-300 font-mono">
                          → {a}
                        </span>
                      ))}
                    </div>
                  )}
                  {s.suggestedAction && (
                    <div className="mt-1.5 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-indigo-300 font-mono inline-block">
                      → {s.suggestedAction}
                    </div>
                  )}
                  {s.elementGuid && (
                    <div className="mt-1 text-[10px] text-zinc-600 font-mono">
                      guid: {s.elementGuid.slice(0, 16)}...
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
