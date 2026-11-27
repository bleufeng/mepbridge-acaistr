// KnowledgeBasePanel.tsx
// V2 H8.5: 知识库管理面板 — 可查看可管理可更新
//
// 功能:
//   - 三分类切换（建筑规范/MEP标准/材料规格）
//   - 搜索过滤
//   - 条目列表（显示 id/rule/source/severity/isUserAdded 状态）
//   - 新增/编辑/删除（用户自定义物理删除，内置条目标记禁用）
//   - 导入/导出/重置

import React, { useState, useEffect, useCallback, useRef } from "react";

type PhysicalCategory = "buildingCode" | "mepStandard" | "material";
type Category = PhysicalCategory | "mandatory";

interface Rule {
  id: string;
  scope?: "shared" | "library";
  libraryId?: string | null;
  rule?: string;
  material?: string;
  source?: string;
  severity?: string;
  category?: string;
  domain?: string;
  subType?: string;
  type?: string;
  thickness?: string;
  fireRating?: string;
  thermalConductivity?: number;
  field?: string;
  minValue?: number;
  maxValue?: number;
  recommendedValue?: number;
  minRange?: [number, number];
  commandAction?: string;
  isUserAdded?: boolean;
  disabled?: boolean;
  disabledAt?: string;
  addedAt?: string;
  updatedAt?: string;
  requirementLevel?: "MANDATORY" | "RECOMMENDED" | "REFERENCE" | "UNCLASSIFIED";
  requirementBasis?: string | null;
}

interface KnowledgeBasePanelProps {
  onDirtyChange?: (dirty: boolean) => void;
  lang?: "zh-CN" | "en-US";
  embedded?: boolean; // 在 ExtensionPanel 中嵌入时为 true，隐藏重复标题行
}

const CATEGORY_LABELS: Record<Category, { zh: string; en: string; color: string }> = {
  buildingCode: { zh: "建筑规范", en: "Building Code", color: "amber" },
  mepStandard: { zh: "MEP 标准", en: "MEP Standard", color: "cyan" },
  material: { zh: "材料规格", en: "Material Spec", color: "emerald" },
  mandatory: { zh: "强制项", en: "Mandatory", color: "rose" },
};

export default function KnowledgeBasePanel({ lang = "zh-CN", embedded = false, onDirtyChange }: KnowledgeBasePanelProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("buildingCode");
  const [rules, setRules] = useState<Rule[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [totals, setTotals] = useState<any>(null);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{ zh: string; en: string }>({ zh: "", en: "" });
  const statusMsg = lang === "zh-CN" ? statusNotice.zh : statusNotice.en;
  const setStatusMsg = (message: string | ((locale: "zh-CN" | "en-US") => string)) => {
    if (!mounted.current) return;
    setStatusNotice(typeof message === "function" ? { zh: message("zh-CN"), en: message("en-US") } : { zh: message, en: message });
  };

  const [libraryState, setLibraryState] = useState<any>(null);
  const [libraries, setLibraries] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<any>(null);
  const epoch = useRef(0);
  const totalsEpoch = useRef(0);
  const mounted = useRef(true);
  const mutationPending = useRef(false);
  const beginMutation = () => { if (!mounted.current || mutationPending.current) return false; mutationPending.current = true; setBusy(true); return true; };
  const endMutation = () => { mutationPending.current = false; if (mounted.current) setBusy(false); };
  const acceptedRevision = useRef(-1);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; totalsEpoch.current++; }; }, []);
  useEffect(() => { onDirtyChange?.(Boolean(editingRule || isAddingNew)); }, [editingRule, isAddingNew, onDirtyChange]);
  useEffect(() => { if(typeof window === "undefined") return; const guard=(event:BeforeUnloadEvent)=>{if(editingRule || isAddingNew){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard); },[editingRule,isAddingNew]);
  const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en;

  const resolveTargetCategory = (cat: Category, rule?: Rule | null): PhysicalCategory => {
    if (cat !== "mandatory") return cat as PhysicalCategory;
    if (rule?.category && (rule.category === "buildingCode" || rule.category === "mepStandard" || rule.category === "material")) {
      return rule.category as PhysicalCategory;
    }
    if (rule?.id?.startsWith("BC-")) return "buildingCode";
    if (rule?.id?.startsWith("MEP-")) return "mepStandard";
    if (rule?.id?.startsWith("MAT-")) return "material";
    return "buildingCode";
  };

  // 加载分类数据
  const loadCategory = useCallback(async (cat: Category) => {
    const request = ++epoch.current;
    setLoading(true);
    try {
      const res = await fetch("/api/knowledge-base");
      const data = await res.json();
      if (data.ok && request === epoch.current && mounted.current && Number.isSafeInteger(data.revision) && data.revision >= acceptedRevision.current) {
        acceptedRevision.current = data.revision;
        if (cat === "mandatory") {
          const aggregated: Rule[] = [
            ...(data.buildingCode || []).map((r: Rule) => ({ ...r, category: "buildingCode" })),
            ...(data.mepStandard || []).map((r: Rule) => ({ ...r, category: "mepStandard" })),
            ...(data.material || []).map((r: Rule) => ({ ...r, category: "material" })),
          ].filter((r: Rule) => r.requirementLevel === "MANDATORY");
          setRules(aggregated);
        } else {
          setRules(data[cat] || []);
        }
        setTotals(data.totals);
        setLibraryState((previous: any) => previous?.revision > data.revision ? previous : data);
      }
    } catch (e) {
      console.error("[KB] Load failed:", e);
    } finally {
      if (request === epoch.current && mounted.current) setLoading(false);
    }
  }, []);

  // 加载统计
  const loadTotals = useCallback(async () => {
    const request = ++totalsEpoch.current;
    try {
      const res = await fetch("/api/knowledge-base");
      const data = await res.json();
      if (data.ok && request === totalsEpoch.current && mounted.current && Number.isSafeInteger(data.revision) && data.revision >= acceptedRevision.current) {
        acceptedRevision.current = data.revision;
        setTotals(data.totals);
        setLibraryState((previous: any) => previous?.revision > data.revision ? previous : data);
        const registry = await fetch("/api/knowledge-base/libraries").then(r => r.json());
        if (request === totalsEpoch.current && mounted.current && registry.ok && Number.isSafeInteger(registry.revision) && registry.revision >= acceptedRevision.current) setLibraries(registry.libraries);
      }
    } catch (e) {
      console.error("[KB] Load totals failed:", e);
    }
  }, []);

  useEffect(() => {
    loadCategory(activeCategory);
  }, [activeCategory, loadCategory]);

  useEffect(() => {
    loadTotals();
  }, [loadTotals]);

  // 搜索
  const filteredRules = rules.filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return JSON.stringify(r).toLowerCase().includes(q);
  });

  // 新增条目
  const handleAdd = () => {
    setEditingRule({
      id: "",
      rule: "",
      source: "",
      severity: activeCategory === "mandatory" ? "error" : "warning",
      category: activeCategory === "mandatory" ? "buildingCode" : activeCategory,
      requirementLevel: activeCategory === "mandatory" ? "MANDATORY" : "RECOMMENDED",
      isUserAdded: true,
    });
    setIsAddingNew(true);
  };

  // 保存（新增或更新）
  const handleSave = async (rule: Rule) => {
    if (!beginMutation()) return;
    try {
      const targetCat = resolveTargetCategory(activeCategory, rule);
      if (isAddingNew) {
        const { id, isUserAdded, addedAt, ...ruleData } = rule;
        const res = await fetch(`/api/knowledge-base/${targetCat}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...ruleData, expectedRevision: libraryState?.revision }),
        });
        const data = await res.json();
        if (data.ok) {
          setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `✅ ${tr("新增成功", "Added")}: ${data.rule.id}`; });
          loadCategory(activeCategory);
          loadTotals();
        } else {
          setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `❌ ${tr("新增失败", "Add failed")}: ${data.code || data.error}`; });
          return;
        }
      } else {
        const res = await fetch(`/api/knowledge-base/${targetCat}/${rule.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...rule, expectedRevision: libraryState?.revision }),
        });
        const data = await res.json();
        if (data.ok) {
          setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `✅ ${tr("更新成功", "Updated")}: ${rule.id}`; });
          loadTotals();
          loadCategory(activeCategory);
        } else {
          setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `❌ ${tr("更新失败", "Update failed")}: ${data.code || data.error}`; });
          return;
        }
      }
      setEditingRule(null);
      setIsAddingNew(false);
    } catch (e: any) {
      setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `❌ ${tr("保存失败", "Save failed")}: ${e.message}`; });
    } finally { endMutation(); }
  };

  // 删除/禁用
  const handleDelete = async (rule: Rule) => {
    if (busy) return;
    if (!confirm(`${tr("确认操作条目", "Confirm rule operation")} ${rule.id}?`)) return;
    if (!beginMutation()) return;
    try {
      const targetCat = resolveTargetCategory(activeCategory, rule);
      const res = await fetch(`/api/knowledge-base/${targetCat}/${rule.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: libraryState?.revision }) });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `✅ ${data.action === "deleted" ? tr("已删除", "Deleted") : tr("已禁用", "Disabled")}: ${rule.id}`; });
        loadCategory(activeCategory);
        loadTotals();
      } else {
        setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `❌ ${tr("操作失败", "Operation failed")}: ${data.code || data.error}`; });
      }
    } catch (e: any) {
      setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `❌ ${tr("删除失败", "Delete failed")}: ${e.message}`; });
    } finally { endMutation(); }
  };

  // 恢复禁用
  const handleEnable = async (rule: Rule) => {
    if (!beginMutation()) return;
    try {
      const targetCat = resolveTargetCategory(activeCategory, rule);
      const res = await fetch(`/api/knowledge-base/${targetCat}/${rule.id}/enable`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: libraryState?.revision }) });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `✅ ${tr("已恢复", "Enabled")}: ${rule.id}`; });
        loadCategory(activeCategory);
        loadTotals();
      } else { setStatusMsg(`❌ ${data.code || data.error}`); }
    } catch (e: any) {
      setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `❌ ${tr("恢复失败", "Enable failed")}: ${e.message}`; });
    } finally { endMutation(); }
  };

  // 导出
  const handleExport = async () => {
    try {
      const res = await fetch("/api/knowledge-base/export");
      const data = await res.json();
      if (!data.ok) throw Error(data.code || data.error);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `knowledge-base-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return tr("✅ 已导出", "✅ Exported"); });
    } catch (e: any) {
      setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `❌ ${tr("导出失败", "Export failed")}: ${e.message}`; });
    }
  };

  // 导入
  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file || !beginMutation()) return;
      if (file.size > 2 * 1024 * 1024) { setStatusMsg(locale => locale === "zh-CN" ? "文件超过2MB" : "File exceeds 2MB"); endMutation(); return; }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const res = await fetch("/api/knowledge-base/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, overwrite: true, expectedRevision: libraryState?.revision }),
        });
        const result = await res.json();
        if (result.ok) {
          setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `✅ ${lang === "zh-CN" ? "导入成功" : "Import OK"}: +${result.stats.buildingCode} ${lang === "zh-CN" ? "建筑" : "building"}, +${result.stats.mepStandard} MEP, +${result.stats.material} ${lang === "zh-CN" ? "材料" : "material"}`; });
          loadCategory(activeCategory);
          loadTotals();
        } else {
          setStatusMsg(`❌ ${result.code || result.error}`);
        }
      } catch (e: any) {
        setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `❌ ${lang === "zh-CN" ? "导入失败（JSON 格式错误）" : "Import failed (invalid JSON)"}: ${e.message}`; });
      }
      finally { endMutation(); }
    };
    input.click();
  };

  // 重置
  const handleReset = async () => {
    if (!confirm(tr("确认清除所有库的用户规则、覆盖与禁用状态？已加载规范库文件保留。", "Clear user rules, overrides and disabled states across all libraries? Loaded libraries are retained."))) return;
    if (!beginMutation()) return;
    try {
      const res = await fetch("/api/knowledge-base/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: libraryState?.revision }) });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return tr("✅ 已重置", "✅ Reset"); });
        loadCategory(activeCategory);
        loadTotals();
      } else { setStatusMsg(`❌ ${data.code || data.error}`); }
    } catch (e: any) {
      setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return `❌ ${tr("重置失败", "Reset failed")}: ${e.message}`; });
    } finally { endMutation(); }
  };

  const activate = async (libraryId: string) => {
    if (busy || libraryId === libraryState?.activeLibraryId) return;
    if (editingRule && !confirm(tr("切库将放弃未保存草稿，继续？", "Switching library discards the unsaved draft. Continue?"))) return;
    if (!beginMutation()) return;
    epoch.current++; totalsEpoch.current++;
    try {
      const data = await fetch("/api/knowledge-base/activation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ libraryId, expectedRevision: libraryState?.revision }) }).then(r => r.json());
      if (!data.ok) throw Error(data.code || data.error);
      setEditingRule(null); setIsAddingNew(false);
      setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return tr("✅ 已切库，界面语言保持不变", "✅ Library changed; UI language unchanged"); });
      await Promise.all([loadCategory(activeCategory), loadTotals()]);
    } catch (e: any) { setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return tr("❌ 未切换，仍使用原库: ", "❌ Not switched; previous library retained: ") + e.message; }); }
    finally { endMutation(); }
  };
  const chooseLibrary = () => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024) { setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return tr("❌ 文件超过2MB", "❌ File exceeds 2MB"); }); return; }
      if (!beginMutation()) return;
      try {
        const library = JSON.parse(await file.text());
        const preview = await fetch("/api/knowledge-base/libraries/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ library }) }).then(r => r.json());
        if (!preview.ok) throw Error(preview.code || preview.error);
        setCandidate(preview);
      } catch (e: any) { setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return tr("❌ 规范库预览失败: ", "❌ Library preview failed: ") + e.message; }); }
      finally { endMutation(); }
    }; input.click();
  };
  const commitLibrary = async () => {
    if (!candidate || !beginMutation()) return;
    try {
      const result = await fetch("/api/knowledge-base/libraries/load", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ library: candidate.library, expectedRevision: candidate.revision }) }).then(r => r.json());
      if (!result.ok) throw Error(result.code || result.error);
      setCandidate(null); await loadTotals(); setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return tr("✅ 已加载；请在列表中选择激活", "✅ Loaded; select from the list to activate"); });
    } catch (e: any) { setStatusMsg((lang: "zh-CN" | "en-US") => { const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en; return tr("❌ 未加载: ", "❌ Not loaded: ") + e.message; }); }
    finally { endMutation(); }
  };

  // 切换 [拦截/提醒] 开关
  const toggleValidation = async () => {
    if (busy || !beginMutation()) return;
    const currentOn = libraryState?.automaticPlanValidation === "ON";
    const nextVal = currentOn ? "OFF" : "ON";
    try {
      const res = await fetch("/api/knowledge-base/validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextVal === "ON", expectedRevision: libraryState?.revision })
      });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg((lang: "zh-CN" | "en-US") => {
          const tr = (zh: string, en: string) => lang === "zh-CN" ? zh : en;
          return nextVal === "ON"
            ? tr("✅ [拦截/提醒] 已开启：计划参数阻断强制项、操作提醒一般项、不拦截参考项", "✅ Interception/Alerts ON: block on mandatory, warn on recommended, pass reference")
            : tr("✅ [拦截/提醒] 已关闭：全部不拦截及提醒", "✅ Interception/Alerts OFF: no blocking or warnings");
        });
        await loadTotals();
      } else {
        setStatusMsg(`❌ ${data.code || data.error}`);
      }
    } catch (e: any) {
      setStatusMsg(`❌ ${e.message}`);
    } finally {
      endMutation();
    }
  };

  // 3 秒后清除状态消息
  useEffect(() => {
    if (statusMsg) {
      const timer = setTimeout(() => setStatusMsg(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [statusNotice]);

  const catLabel = CATEGORY_LABELS[activeCategory];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-200">
      {/* 顶部标题 + 统计（embedded 时隐藏标题文字，只保留统计和操作按钮） */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!embedded && (
            <span className="text-sm font-semibold font-display">📚 {lang === "zh-CN" ? "知识库管理" : "Knowledge Base"}</span>
          )}
          {totals && (
            <span className="text-[10px] font-mono text-zinc-500">
              ({lang === "zh-CN" ? "共" : "total"} {totals.total}{lang === "zh-CN" ? "条" : ""})
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button onClick={handleExport} className="px-2 py-0.5 text-[10px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer">
            {lang === "zh-CN" ? "导出" : "Export"}
          </button>
          <button disabled={busy} onClick={handleImport} className="px-2 py-0.5 text-[10px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer">
            {lang === "zh-CN" ? "导入" : "Import"}
          </button>
          <button disabled={busy} onClick={handleReset} className="px-2 py-0.5 text-[10px] rounded bg-red-900/30 hover:bg-red-900/50 text-red-400 cursor-pointer">
            {lang === "zh-CN" ? "重置" : "Reset"}
          </button>
        </div>
      </div>

      {/* 全局 [拦截/提醒] 总开关卡片 */}
      <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/40 text-[11px] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-300">🛡️ {tr("[拦截/提醒] 开关", "[Interception/Alert] Toggle")}:</span>
          <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
            libraryState?.automaticPlanValidation === "ON"
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-zinc-800 text-zinc-500 border border-zinc-700"
          }`}>
            {libraryState?.automaticPlanValidation === "ON" ? tr("开启中 (ON)", "ENABLED (ON)") : tr("已关闭 (OFF)", "DISABLED (OFF)")}
          </span>
          <span className="text-[10px] text-zinc-400">
            {libraryState?.automaticPlanValidation === "ON"
              ? tr("规则联动：计划参数阻断（强制项）/ 操作提醒（一般项）/ 不拦截（参考项）", "Active: Block (Mandatory) / Warn (Recommended) / Pass (Reference)")
              : tr("全部不拦截及提醒", "All checks bypassed (no blocking or warnings)")}
          </span>
        </div>
        <button
          disabled={busy}
          onClick={toggleValidation}
          className={`px-3 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer border ${
            libraryState?.automaticPlanValidation === "ON"
              ? "bg-amber-900/30 text-amber-300 border-amber-800/50 hover:bg-amber-900/50"
              : "bg-emerald-600/30 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600/50"
          }`}
        >
          {libraryState?.automaticPlanValidation === "ON"
            ? tr("关闭拦截与提醒", "Turn OFF Interception")
            : tr("开启拦截与提醒", "Turn ON Interception")}
        </button>
      </div>

      {/* 条文分级汇总统计 */}
      {totals?.requirementLevels && (
        <div className="px-4 py-1 border-b border-zinc-800/80 bg-zinc-950/60 text-[10px] font-mono text-zinc-400 flex flex-wrap gap-x-4 gap-y-1 items-center">
          <span>{tr("强制项: ", "Mandatory: ")}<strong className="text-rose-400">{totals.requirementLevels.MANDATORY}</strong></span>
          <span>{tr("一般项: ", "Recommended: ")}<strong className="text-amber-400">{totals.requirementLevels.RECOMMENDED}</strong></span>
          <span>{tr("参考项: ", "Reference: ")}<strong className="text-cyan-400">{totals.requirementLevels.REFERENCE}</strong></span>
          <span>{tr("待确认: ", "Unclassified: ")}<strong className="text-zinc-500">{totals.requirementLevels.UNCLASSIFIED}</strong></span>
        </div>
      )}

      <div className="px-4 py-2 border-b border-zinc-800 text-[10px] space-y-1">
        <div className="flex gap-2 items-center">
          <span>{tr("活动规范库", "Active library")}</span>
          <select aria-label={tr("活动规范库", "Active library")} disabled={busy || !libraryState || libraryState.loadState !== "READY"} value={libraryState?.activeLibraryId || ""} onChange={e => activate(e.target.value)} className="bg-zinc-900 max-w-[260px]">
            {libraries.map(lib => <option key={lib.id} value={lib.id}>{lang === "en-US" ? lib.nameEn : lib.name} [{lib.region}/{lib.contentLanguage}]</option>)}
          </select>
          <button disabled={busy} onClick={chooseLibrary}>{tr("加载规范库JSON", "Load library JSON")}</button>
        </div>
        <div>{tr("库修订", "Revision")}: {libraryState?.revision ?? "UNKNOWN"} · {tr("计划自动拦截", "Automatic plan validation")}: {libraryState?.automaticPlanValidation || "UNKNOWN"} · {tr("模型审核", "Model audit")}: {tr("清单关联就绪（自动检查定义待核准）", "Checklist link ready (Definitions pending approval)")}</div>
        {candidate && <div className="p-2 border border-zinc-700">
          <div>{candidate.library.name} [{candidate.library.region}/{candidate.library.contentLanguage}] v{candidate.library.version}</div>
          <div>{candidate.library.sources.join("; ")}</div>
          <div>{Object.entries(candidate.counts).map(([key,value]) => (CATEGORY_LABELS[key as Category]?.[lang === "zh-CN" ? "zh" : "en"] || key) + ": " + value).join(" · ")}</div>
          <button disabled={busy} onClick={commitLibrary}>{tr("确认加载（不激活）", "Confirm load (not activation)")}</button> · <button onClick={() => setCandidate(null)}>{tr("取消", "Cancel")}</button>
        </div>}
      </div>
      {/* 分类切换 */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 flex gap-1">
        {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => {
          const label = CATEGORY_LABELS[cat];
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              disabled={busy}
              onClick={() => { if (editingRule && !confirm(tr("放弃未保存草稿？", "Discard unsaved draft?"))) return; setEditingRule(null); setActiveCategory(cat); }}
              className={`px-3 py-1 rounded text-[11px] font-medium transition-all cursor-pointer border ${
                isActive
                  ? `bg-${label.color}-500/20 text-${label.color}-400 border-${label.color}-500/40`
                  : "bg-transparent text-zinc-500 border-transparent hover:text-zinc-300"
              }`}
            >
              {lang === "zh-CN" ? label.zh : label.en}
              {totals && (
                <span className="ml-1 text-[9px] opacity-60">
                  {cat === "mandatory" ? (totals.requirementLevels?.MANDATORY ?? 0) : totals[cat]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 搜索 + 新增 */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={lang === "zh-CN" ? "搜索..." : "Search..."}
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-1 text-[11px] rounded bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer whitespace-nowrap"
        >
          + {lang === "zh-CN" ? "新增" : "Add"}
        </button>
      </div>

      {/* 状态消息 */}
      {statusMsg && (
        <div className="flex-shrink-0 px-4 py-1 bg-zinc-900/50 border-b border-zinc-800">
          <span className="text-[10px] font-mono text-zinc-400">{statusMsg}</span>
        </div>
      )}

      {/* 条目列表 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
        {loading ? (
          <div className="text-center text-zinc-500 text-xs py-8">{lang === "zh-CN" ? "加载中..." : "Loading..."}</div>
        ) : filteredRules.length === 0 ? (
          <div className="text-center text-zinc-600 text-xs py-8">
            {lang === "zh-CN" ? "暂无条目" : "No items"}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredRules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                category={activeCategory}
                lang={lang}
                onEdit={() => { if (busy) return; setEditingRule(rule); setIsAddingNew(false); }}
                onDelete={() => { void handleDelete(rule); }}
                onEnable={() => { void handleEnable(rule); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 编辑模态 */}
      {editingRule && (
        <RuleEditor
          rule={editingRule}
          category={activeCategory}
          lang={lang}
          isNew={isAddingNew}
          onSave={handleSave}
          onCancel={() => { setEditingRule(null); setIsAddingNew(false); }}
        />
      )}
    </div>
  );
}

// ─── 单条规则卡片 ───
export const RuleCard: React.FC<{
  rule: Rule;
  category: Category;
  lang: "zh-CN" | "en-US";
  onEdit: () => void;
  onDelete: () => void;
  onEnable: () => void;
  busy?: boolean;
}> = ({
  rule, category, lang, onEdit, onDelete, onEnable, busy
}) => {
  const isDisabled = !!rule.disabled;
  const effectiveCategory = category === "mandatory" ? (rule.category || (rule.id?.startsWith("MAT-") ? "material" : rule.id?.startsWith("MEP-") ? "mepStandard" : "buildingCode")) : category;
  const severityColor =
    rule.severity === "error" ? "text-red-400 bg-red-500/10" :
    rule.severity === "warning" ? "text-amber-400 bg-amber-500/10" :
    "text-zinc-400 bg-zinc-500/10";

  const mainText = rule.rule || rule.material || "";
  const subText = rule.source || rule.type || "";

  return (
    <div className={`rounded border border-zinc-800 bg-zinc-900/50 p-2 hover:border-zinc-700 transition-colors ${isDisabled ? "opacity-40" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9px] font-mono text-zinc-500">{rule.id}</span>
            {category === "mandatory" && (
              <span className="text-[8px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-300 font-mono">
                {effectiveCategory === "buildingCode" ? (lang === "zh-CN" ? "建筑" : "Building") :
                 effectiveCategory === "mepStandard" ? "MEP" :
                 (lang === "zh-CN" ? "材料" : "Material")}
              </span>
            )}
            {(() => {
              const level = rule.requirementLevel || "UNCLASSIFIED";
              const badgeCls =
                level === "MANDATORY" ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" :
                level === "RECOMMENDED" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                level === "REFERENCE" ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" :
                "bg-zinc-700/50 text-zinc-400 border border-zinc-600/30";
              const label =
                level === "MANDATORY" ? (lang === "zh-CN" ? "强制项" : "Mandatory") :
                level === "RECOMMENDED" ? (lang === "zh-CN" ? "一般项" : "Recommended") :
                level === "REFERENCE" ? (lang === "zh-CN" ? "参考项" : "Reference") :
                (lang === "zh-CN" ? "待确认" : "Unclassified");
              return (
                <span className={`text-[8px] px-1.5 py-0.2 rounded font-mono font-semibold ${badgeCls}`}>
                  {label}
                </span>
              );
            })()}
            {rule.isUserAdded && (
              <span className="text-[8px] px-1 rounded bg-violet-500/20 text-violet-400 font-mono">{lang === "zh-CN" ? "用户" : "User"}</span>
            )}
            {isDisabled && (
              <span className="text-[8px] px-1 rounded bg-zinc-700 text-zinc-500 font-mono">{lang === "zh-CN" ? "已禁用" : "Disabled"}</span>
            )}
          </div>
          <div className="text-[11px] text-zinc-200 leading-tight">{mainText}</div>
          {subText && (
            <div className="text-[9px] text-zinc-500 mt-0.5">{lang === "zh-CN" ? "来源: " : "Source: "}{subText}</div>
          )}
          {rule.requirementBasis && (
            <div className="text-[9px] text-zinc-400 mt-0.5 font-mono">
              <span className="text-zinc-500">{lang === "zh-CN" ? "依据: " : "Basis: "}</span>{rule.requirementBasis}
            </div>
          )}
          {/* 材料类额外字段 */}
          {effectiveCategory === "material" && (
            <div className="text-[9px] text-zinc-500 mt-0.5 flex gap-2 flex-wrap">
              {rule.thickness && <span>{lang === "zh-CN" ? "厚度: " : "Thickness: "}{rule.thickness}</span>}
              {rule.fireRating && <span>{lang === "zh-CN" ? "防火" : "Fire rating"}: {rule.fireRating}</span>}
              {rule.thermalConductivity !== undefined && <span>{lang === "zh-CN" ? "导热: " : "Thermal conductivity: "}{rule.thermalConductivity}</span>}
            </div>
          )}
          {/* 规范类额外字段 */}
          {effectiveCategory !== "material" && rule.field && (
            <div className="text-[9px] text-zinc-500 mt-0.5">
              {lang === "zh-CN" ? "字段" : "Field"}: {rule.field}
              {rule.minValue !== undefined && ` ≥ ${rule.minValue}`}
              {rule.maxValue !== undefined && ` ≤ ${rule.maxValue}`}
              {rule.recommendedValue !== undefined && ` (${lang === "zh-CN" ? "推荐" : "Recommended"} ${rule.recommendedValue})`}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <button
            disabled={busy} onClick={onEdit}
            className="px-1.5 py-0.5 text-[9px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 cursor-pointer"
            title={lang === "zh-CN" ? "编辑" : "Edit"}
          >
            ✎
          </button>
          {isDisabled ? (
            <button
              disabled={busy} onClick={onEnable}
              className="px-1.5 py-0.5 text-[9px] rounded bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 cursor-pointer"
              title={lang === "zh-CN" ? "恢复" : "Enable"}
            >
              ↺
            </button>
          ) : (
            <button
              disabled={busy} onClick={onDelete}
              className="px-1.5 py-0.5 text-[9px] rounded bg-red-900/30 hover:bg-red-900/50 text-red-400 cursor-pointer"
              title={lang === "zh-CN" ? (rule.isUserAdded ? "删除" : "禁用") : (rule.isUserAdded ? "Delete" : "Disable")}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 规则编辑器模态 ───
export function RuleEditor({
  rule, category, lang, isNew, busy, onSave, onCancel
}: {
  rule: Rule;
  category: Category;
  lang: "zh-CN" | "en-US";
  isNew: boolean;
  busy?: boolean;
  onSave: (rule: Rule) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<Rule>({ ...rule });

  const handleFieldChange = (field: string, value: any) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      if (field === "requirementLevel") {
        if (value === "MANDATORY") next.severity = "error";
        else if (value === "RECOMMENDED") next.severity = "warning";
        else if (value === "REFERENCE") next.severity = "info";
      }
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((formData.requirementLevel === "MANDATORY" || formData.requirementLevel === "RECOMMENDED") &&
        (!formData.requirementBasis || !formData.requirementBasis.trim())) {
      alert(lang === "zh-CN" ? "强制项和一般项需要填写非空分级依据（如条款引用或项目约定说明）" : "Mandatory and Recommended rules require a non-empty requirement basis.");
      return;
    }
    if (!busy) onSave(formData);
  };

  // New rules default to current library; explicit shared scope is independent of UI locale.
  // 根据分类显示不同字段
  const effectiveCategory = category === "mandatory" ? (formData.category || (formData.id?.startsWith("MAT-") ? "material" : formData.id?.startsWith("MEP-") ? "mepStandard" : "buildingCode")) : category;
  const isMaterial = effectiveCategory === "material";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 w-[480px] max-h-[80vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-zinc-200 mb-1">
          {isNew ? (lang === "zh-CN" ? "新增条目" : "Add Rule") : (lang === "zh-CN" ? "编辑条目" : "Edit Rule")}
          {!isNew && <span className="ml-2 text-[10px] font-mono text-zinc-500">{rule.id}</span>}
        </h3>
        <p className="text-[10px] text-zinc-400 mb-3">
          {lang === "zh-CN"
            ? "💡 全局 [拦截/提醒] 开启时：强制项违规将触发【计划参数阻断】，一般项违规将触发【操作提醒】，参考项【不拦截】。仅校验支持的计划参数，不执行全模型审查；开关修改从下一任务生效。"
            : "💡 When [Interception/Alert] is ON: Mandatory rules trigger Plan Parameter Block, Recommended rules trigger Operation Alert, Reference rules are not blocked. Only supported plan parameters are checked, not the whole model; toggle changes apply to subsequent tasks."}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2"><fieldset disabled={busy} className="contents">
          {category === "mandatory" && isNew && (
            <Field label={lang === "zh-CN" ? "归属专业分类" : "Target Domain"}>
              <select
                value={formData.category || "buildingCode"}
                onChange={(e) => handleFieldChange("category", e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
              >
                <option value="buildingCode">{lang === "zh-CN" ? "建筑规范" : "Building Code"}</option>
                <option value="mepStandard">{lang === "zh-CN" ? "MEP 标准" : "MEP Standard"}</option>
                <option value="material">{lang === "zh-CN" ? "材料规格" : "Material Spec"}</option>
              </select>
            </Field>
          )}
              <div className="grid grid-cols-2 gap-2">
                <Field label={lang === "zh-CN" ? "条文级别" : "Requirement Level"}>
                  <select
                    value={formData.requirementLevel || "UNCLASSIFIED"}
                    onChange={(e) => handleFieldChange("requirementLevel", e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                  >
                    <option value="UNCLASSIFIED">{lang === "zh-CN" ? "待确认 (UNCLASSIFIED)" : "Unclassified"}</option>
                    <option value="MANDATORY">{lang === "zh-CN" ? "强制项 (MANDATORY)" : "Mandatory"}</option>
                    <option value="RECOMMENDED">{lang === "zh-CN" ? "一般项 (RECOMMENDED)" : "Recommended"}</option>
                    <option value="REFERENCE">{lang === "zh-CN" ? "参考项 (REFERENCE)" : "Reference"}</option>
                  </select>
                </Field>
                <Field label={lang === "zh-CN" ? "分级依据 (强制/一般必填)" : "Requirement Basis"}>
                  <input
                    type="text"
                    value={formData.requirementBasis || ""}
                    onChange={(e) => handleFieldChange("requirementBasis", e.target.value)}
                    placeholder={lang === "zh-CN" ? "条款引用 / 项目约定" : "Clause / Project convention"}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                  />
                </Field>
              </div>
          {!isMaterial ? (
            <>
              <Field label={lang === "zh-CN" ? "作用域" : "Scope"}>
                <select disabled={!isNew && (!rule.isUserAdded || (rule as any).isBuiltinOverride)} value={formData.scope || "library"} onChange={e => handleFieldChange("scope", e.target.value)} className="bg-zinc-950 text-zinc-200">
                  <option value="library">{lang === "zh-CN" ? "当前库" : "Current library"}</option>
                  <option value="shared">{lang === "zh-CN" ? "跨库共享候选" : "Shared candidate"}</option>
                </select>
              </Field>
              <Field label={lang === "zh-CN" ? "规范条文" : "Rule"}>
                <textarea
                  value={formData.rule || ""}
                  onChange={(e) => handleFieldChange("rule", e.target.value)}
                  required
                  rows={2}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                />
              </Field>
              <Field label={lang === "zh-CN" ? "来源" : "Source"}>
                <input
                  type="text"
                  value={formData.source || ""}
                  onChange={(e) => handleFieldChange("source", e.target.value)}
                  placeholder="GB 50096"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={lang === "zh-CN" ? "校验字段" : "Field"}>
                  <input
                    type="text"
                    value={formData.field || ""}
                    onChange={(e) => handleFieldChange("field", e.target.value)}
                    placeholder="thickness / height / width / diameterMm"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                  />
                </Field>
                <Field label={lang === "zh-CN" ? "最小值" : "Min Value"}>
                  <input
                    type="number"
                    step="0.001"
                    value={formData.minValue ?? ""}
                    onChange={(e) => handleFieldChange("minValue", e.target.value ? parseFloat(e.target.value) : undefined)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                  />
                </Field>
              </div>
              {effectiveCategory === "mepStandard" && (
                <Field label={lang === "zh-CN" ? "关联命令" : "Command Action"}>
                  <input
                    type="text"
                    value={formData.commandAction || ""}
                    onChange={(e) => handleFieldChange("commandAction", e.target.value)}
                    placeholder="CreatePipe / CreateDuct / CreateCableCarrier"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                  />
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label={lang === "zh-CN" ? "材料名称" : "Material"}>
                <input
                  type="text"
                  value={formData.material || ""}
                  onChange={(e) => handleFieldChange("material", e.target.value)}
                  required
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={lang === "zh-CN" ? "类型" : "Type"}>
                  <select
                    value={formData.type || "Wall"}
                    onChange={(e) => handleFieldChange("type", e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                  >
                    <option value="Wall">{lang === "zh-CN" ? "墙" : "Wall"}</option>
                    <option value="Slab">{lang === "zh-CN" ? "板" : "Slab"}</option>
                    <option value="Roof">{lang === "zh-CN" ? "屋顶" : "Roof"}</option>
                    <option value="Door">{lang === "zh-CN" ? "门" : "Door"}</option>
                    <option value="Window">{lang === "zh-CN" ? "窗" : "Window"}</option>
                    <option value="Pipe">{lang === "zh-CN" ? "管道" : "Pipe"}</option>
                  </select>
                </Field>
                <Field label={lang === "zh-CN" ? "厚度" : "Thickness"}>
                  <input
                    type="text"
                    value={formData.thickness || ""}
                    onChange={(e) => handleFieldChange("thickness", e.target.value)}
                    placeholder="200mm"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={lang === "zh-CN" ? "防火等级" : "Fire Rating"}>
                  <input
                    type="text"
                    value={formData.fireRating || ""}
                    onChange={(e) => handleFieldChange("fireRating", e.target.value)}
                    placeholder="A1 / A2 / B1 / B2"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                  />
                </Field>
                <Field label={lang === "zh-CN" ? "导热系数" : "Thermal Conductivity"}>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.thermalConductivity ?? ""}
                    onChange={(e) => handleFieldChange("thermalConductivity", e.target.value ? parseFloat(e.target.value) : undefined)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                  />
                </Field>
              </div>
              <Field label={lang === "zh-CN" ? "来源标准" : "Source"}>
                <input
                  type="text"
                  value={formData.source || ""}
                  onChange={(e) => handleFieldChange("source", e.target.value)}
                  placeholder="GB/T 11968"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                />
              </Field>
            </>
          )}

          <div className="flex gap-2 mt-3 justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 cursor-pointer"
            >
              {lang === "zh-CN" ? "取消" : "Cancel"}
            </button>
            <button
              type="submit"
              className="px-3 py-1 text-[11px] rounded bg-violet-600 hover:bg-violet-500 text-white cursor-pointer"
            >
              {lang === "zh-CN" ? "保存" : "Save"}
            </button>
          </div>
        </fieldset></form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}
