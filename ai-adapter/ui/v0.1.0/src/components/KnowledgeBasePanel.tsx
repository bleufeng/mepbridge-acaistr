// KnowledgeBasePanel.tsx
// V2 H8.5: 知识库管理面板 — 可查看可管理可更新
//
// 功能:
//   - 三分类切换（建筑规范/MEP标准/材料规格）
//   - 搜索过滤
//   - 条目列表（显示 id/rule/source/severity/isUserAdded 状态）
//   - 新增/编辑/删除（用户自定义物理删除，内置条目标记禁用）
//   - 导入/导出/重置

import React, { useState, useEffect, useCallback } from "react";

type Category = "buildingCode" | "mepStandard" | "material";

interface Rule {
  id: string;
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
}

interface KnowledgeBasePanelProps {
  lang?: "zh-CN" | "en-US";
  embedded?: boolean; // 在 ExtensionPanel 中嵌入时为 true，隐藏重复标题行
}

const CATEGORY_LABELS: Record<Category, { zh: string; en: string; color: string }> = {
  buildingCode: { zh: "建筑规范", en: "Building Code", color: "amber" },
  mepStandard: { zh: "MEP 标准", en: "MEP Standard", color: "cyan" },
  material: { zh: "材料规格", en: "Material Spec", color: "emerald" },
};

export default function KnowledgeBasePanel({ lang = "zh-CN", embedded = false }: KnowledgeBasePanelProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("buildingCode");
  const [rules, setRules] = useState<Rule[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [totals, setTotals] = useState<any>(null);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");

  // 加载分类数据
  const loadCategory = useCallback(async (cat: Category) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/knowledge-base/${cat}`);
      const data = await res.json();
      if (data.ok) {
        setRules(data.items || []);
      }
    } catch (e) {
      console.error("[KB] Load failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载统计
  const loadTotals = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-base");
      const data = await res.json();
      if (data.ok) {
        setTotals(data.totals);
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
      severity: "warning",
      isUserAdded: true,
    });
    setIsAddingNew(true);
  };

  // 保存（新增或更新）
  const handleSave = async (rule: Rule) => {
    try {
      if (isAddingNew) {
        const { id, isUserAdded, addedAt, ...ruleData } = rule;
        const res = await fetch(`/api/knowledge-base/${activeCategory}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ruleData),
        });
        const data = await res.json();
        if (data.ok) {
          setStatusMsg(`✅ 新增成功: ${data.rule.id}`);
          loadCategory(activeCategory);
          loadTotals();
        } else {
          setStatusMsg(`❌ 新增失败: ${data.error}`);
        }
      } else {
        const res = await fetch(`/api/knowledge-base/${activeCategory}/${rule.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rule),
        });
        const data = await res.json();
        if (data.ok) {
          setStatusMsg(`✅ 更新成功: ${rule.id}`);
          loadCategory(activeCategory);
        } else {
          setStatusMsg(`❌ 更新失败: ${data.error}`);
        }
      }
      setEditingRule(null);
      setIsAddingNew(false);
    } catch (e: any) {
      setStatusMsg(`❌ 保存失败: ${e.message}`);
    }
  };

  // 删除/禁用
  const handleDelete = async (rule: Rule) => {
    if (!confirm(`确定${rule.isUserAdded ? "删除" : "禁用"}条目 ${rule.id}？${rule.isUserAdded ? "" : "（内置条目仅禁用，可恢复）"}`)) return;
    try {
      const res = await fetch(`/api/knowledge-base/${activeCategory}/${rule.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg(`✅ ${data.action === "deleted" ? "已删除" : "已禁用"}: ${rule.id}`);
        loadCategory(activeCategory);
        loadTotals();
      } else {
        setStatusMsg(`❌ 操作失败: ${data.error}`);
      }
    } catch (e: any) {
      setStatusMsg(`❌ 删除失败: ${e.message}`);
    }
  };

  // 恢复禁用
  const handleEnable = async (rule: Rule) => {
    try {
      const res = await fetch(`/api/knowledge-base/${activeCategory}/${rule.id}/enable`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg(`✅ 已恢复: ${rule.id}`);
        loadCategory(activeCategory);
      }
    } catch (e: any) {
      setStatusMsg(`❌ 恢复失败: ${e.message}`);
    }
  };

  // 导出
  const handleExport = async () => {
    try {
      const res = await fetch("/api/knowledge-base/export");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `knowledge-base-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg("✅ 已导出");
    } catch (e: any) {
      setStatusMsg(`❌ 导出失败: ${e.message}`);
    }
  };

  // 导入
  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const res = await fetch("/api/knowledge-base/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, overwrite: true }),
        });
        const result = await res.json();
        if (result.ok) {
          setStatusMsg(`✅ ${lang === "zh-CN" ? "导入成功" : "Import OK"}: +${result.stats.buildingCode} ${lang === "zh-CN" ? "建筑" : "building"}, +${result.stats.mepStandard} MEP, +${result.stats.material} ${lang === "zh-CN" ? "材料" : "material"}`);
          loadCategory(activeCategory);
          loadTotals();
        } else {
          setStatusMsg(`❌ ${result.error}`);
        }
      } catch (e: any) {
        setStatusMsg(`❌ ${lang === "zh-CN" ? "导入失败（JSON 格式错误）" : "Import failed (invalid JSON)"}: ${e.message}`);
      }
      setTimeout(() => setStatusMsg(""), 5000);
    };
    input.click();
  };

  // 重置
  const handleReset = async () => {
    if (!confirm("确定重置为内置知识库？所有用户自定义条目将被清除。")) return;
    try {
      const res = await fetch("/api/knowledge-base/reset", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setStatusMsg("✅ 已重置为内置知识库");
        loadCategory(activeCategory);
        loadTotals();
      }
    } catch (e: any) {
      setStatusMsg(`❌ 重置失败: ${e.message}`);
    }
  };

  // 3 秒后清除状态消息
  useEffect(() => {
    if (statusMsg) {
      const timer = setTimeout(() => setStatusMsg(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMsg]);

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
          <button onClick={handleImport} className="px-2 py-0.5 text-[10px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer">
            {lang === "zh-CN" ? "导入" : "Import"}
          </button>
          <button onClick={handleReset} className="px-2 py-0.5 text-[10px] rounded bg-red-900/30 hover:bg-red-900/50 text-red-400 cursor-pointer">
            {lang === "zh-CN" ? "重置" : "Reset"}
          </button>
        </div>
      </div>

      {/* 分类切换 */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800 flex gap-1">
        {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => {
          const label = CATEGORY_LABELS[cat];
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1 rounded text-[11px] font-medium transition-all cursor-pointer border ${
                isActive
                  ? `bg-${label.color}-500/20 text-${label.color}-400 border-${label.color}-500/40`
                  : "bg-transparent text-zinc-500 border-transparent hover:text-zinc-300"
              }`}
            >
              {lang === "zh-CN" ? label.zh : label.en}
              {totals && (
                <span className="ml-1 text-[9px] opacity-60">
                  {totals[cat]}
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
                onEdit={() => { setEditingRule(rule); setIsAddingNew(false); }}
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
const RuleCard: React.FC<{
  rule: Rule;
  category: Category;
  lang: "zh-CN" | "en-US";
  onEdit: () => void;
  onDelete: () => void;
  onEnable: () => void;
}> = ({
  rule, category, lang, onEdit, onDelete, onEnable
}) => {
  const isDisabled = !!rule.disabled;
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
            {rule.severity && (
              <span className={`text-[8px] px-1 rounded font-mono ${severityColor}`}>
                {rule.severity === "error" ? "⚠必须" : rule.severity === "warning" ? "建议" : rule.severity}
              </span>
            )}
            {rule.isUserAdded && (
              <span className="text-[8px] px-1 rounded bg-violet-500/20 text-violet-400 font-mono">用户</span>
            )}
            {isDisabled && (
              <span className="text-[8px] px-1 rounded bg-zinc-700 text-zinc-500 font-mono">已禁用</span>
            )}
          </div>
          <div className="text-[11px] text-zinc-200 leading-tight">{mainText}</div>
          {subText && (
            <div className="text-[9px] text-zinc-500 mt-0.5">来源: {subText}</div>
          )}
          {/* 材料类额外字段 */}
          {category === "material" && (
            <div className="text-[9px] text-zinc-500 mt-0.5 flex gap-2 flex-wrap">
              {rule.thickness && <span>厚度: {rule.thickness}</span>}
              {rule.fireRating && <span>防火: {rule.fireRating}</span>}
              {rule.thermalConductivity !== undefined && <span>导热: {rule.thermalConductivity}</span>}
            </div>
          )}
          {/* 规范类额外字段 */}
          {category !== "material" && rule.field && (
            <div className="text-[9px] text-zinc-500 mt-0.5">
              字段: {rule.field}
              {rule.minValue !== undefined && ` ≥ ${rule.minValue}`}
              {rule.maxValue !== undefined && ` ≤ ${rule.maxValue}`}
              {rule.recommendedValue !== undefined && ` (推荐 ${rule.recommendedValue})`}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <button
            onClick={onEdit}
            className="px-1.5 py-0.5 text-[9px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 cursor-pointer"
            title={lang === "zh-CN" ? "编辑" : "Edit"}
          >
            ✎
          </button>
          {isDisabled ? (
            <button
              onClick={onEnable}
              className="px-1.5 py-0.5 text-[9px] rounded bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 cursor-pointer"
              title={lang === "zh-CN" ? "恢复" : "Enable"}
            >
              ↺
            </button>
          ) : (
            <button
              onClick={onDelete}
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
function RuleEditor({
  rule, category, lang, isNew, onSave, onCancel
}: {
  rule: Rule;
  category: Category;
  lang: "zh-CN" | "en-US";
  isNew: boolean;
  onSave: (rule: Rule) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState<Rule>({ ...rule });

  const handleFieldChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  // 根据分类显示不同字段
  const isMaterial = category === "material";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 w-[480px] max-h-[80vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">
          {isNew ? (lang === "zh-CN" ? "新增条目" : "Add Rule") : (lang === "zh-CN" ? "编辑条目" : "Edit Rule")}
          {!isNew && <span className="ml-2 text-[10px] font-mono text-zinc-500">{rule.id}</span>}
        </h3>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          {!isMaterial ? (
            <>
              <Field label={lang === "zh-CN" ? "规范条文" : "Rule"}>
                <textarea
                  value={formData.rule || ""}
                  onChange={(e) => handleFieldChange("rule", e.target.value)}
                  required
                  rows={2}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={lang === "zh-CN" ? "来源" : "Source"}>
                  <input
                    type="text"
                    value={formData.source || ""}
                    onChange={(e) => handleFieldChange("source", e.target.value)}
                    placeholder="GB 50096"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                  />
                </Field>
                <Field label={lang === "zh-CN" ? "严重级别" : "Severity"}>
                  <select
                    value={formData.severity || "warning"}
                    onChange={(e) => handleFieldChange("severity", e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:border-violet-500 focus:outline-none"
                  >
                    <option value="error">error（必须）</option>
                    <option value="warning">warning（建议）</option>
                    <option value="info">info（提示）</option>
                  </select>
                </Field>
              </div>
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
              {category === "mepStandard" && (
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
                    <option value="Wall">Wall</option>
                    <option value="Slab">Slab</option>
                    <option value="Roof">Roof</option>
                    <option value="Door">Door</option>
                    <option value="Window">Window</option>
                    <option value="Pipe">Pipe</option>
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
        </form>
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
