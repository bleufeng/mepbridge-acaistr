// ExtensionPanel.tsx
// 扩展功能面板 — Tab 切换 6 个子面板
// 知识库 / 学习记忆 / 审计日志 / 主动智能 / 用户模板 / 自定义命令
// 两种模式（BASE/Copilot）都显示

import { useState } from "react";
import KnowledgeBasePanel from "./KnowledgeBasePanel";
import LearningMemoryPanel from "./LearningMemoryPanel";
import AuditLogPanel from "./AuditLogPanel";
import ProactiveSuggestions from "./ProactiveSuggestions";
import ModuleCatalogPanel from "./ModuleCatalogPanel";
import type { TaskTemplate, CustomNLCommand } from "../userAssets";
import { Bookmark, Zap, Brain, FileText, Lightbulb, Database, ChevronDown, Package, Download, Upload, Save, RotateCcw, Boxes } from "lucide-react";

type ExtTab = "modules" | "knowledge" | "memory" | "audit" | "proactive" | "templates" | "commands" | "preset";

interface ExtensionPanelProps {
  lang: "zh-CN" | "en-US";
  mode?: "base" | "copilot";
  // 用户模板
  userTemplates: TaskTemplate[];
  templateSearch: string;
  setTemplateSearch: (v: string) => void;
  onReplayTemplate: (tpl: TaskTemplate) => void;
  onDeleteTemplate: (id: string) => void;
  // 自定义命令
  customCommands: CustomNLCommand[];
  onOpenCustomCommands: () => void;
  onAssetsChanged?: () => void | Promise<void>;
  // 主动智能建议点击
  onSuggestionClick?: (action: string, params?: Record<string, unknown>) => void;
  // 折叠状态（由父组件控制，切换中区命令模块时自动折叠）
  expanded: boolean;
  setExpanded: (v: boolean) => void;
}

const TAB_CONFIG: Array<{
  id: ExtTab;
  zh: string;
  en: string;
  icon: typeof Bookmark;
  color: string;
}> = [
  { id: "modules", zh: "模块", en: "Modules", icon: Boxes, color: "sky" },
  { id: "knowledge", zh: "知识库", en: "Knowledge", icon: Database, color: "amber" },
  { id: "memory", zh: "学习记忆", en: "Memory", icon: Brain, color: "indigo" },
  { id: "audit", zh: "审计日志", en: "Audit", icon: FileText, color: "rose" },
  { id: "proactive", zh: "主动智能", en: "Proactive", icon: Lightbulb, color: "violet" },
  { id: "templates", zh: "用户模板", en: "Templates", icon: Bookmark, color: "pink" },
  { id: "commands", zh: "自定义命令", en: "Commands", icon: Zap, color: "cyan" },
  { id: "preset", zh: "预设管理", en: "Preset", icon: Package, color: "emerald" },
];

const COLOR_CLASSES: Record<string, { active: string; inactive: string; border: string }> = {
  sky: { active: "text-sky-400 border-sky-500", inactive: "text-zinc-500 hover:text-sky-400/70", border: "border-sky-500/20" },
  amber: { active: "text-amber-400 border-amber-500", inactive: "text-zinc-500 hover:text-amber-400/70", border: "border-amber-500/20" },
  indigo: { active: "text-indigo-400 border-indigo-500", inactive: "text-zinc-500 hover:text-indigo-400/70", border: "border-indigo-500/20" },
  rose: { active: "text-rose-400 border-rose-500", inactive: "text-zinc-500 hover:text-rose-400/70", border: "border-rose-500/20" },
  violet: { active: "text-violet-400 border-violet-500", inactive: "text-zinc-500 hover:text-violet-400/70", border: "border-violet-500/20" },
  pink: { active: "text-pink-400 border-pink-500", inactive: "text-zinc-500 hover:text-pink-400/70", border: "border-pink-500/20" },
  cyan: { active: "text-cyan-400 border-cyan-500", inactive: "text-zinc-500 hover:text-cyan-400/70", border: "border-cyan-500/20" },
  emerald: { active: "text-emerald-400 border-emerald-500", inactive: "text-zinc-500 hover:text-emerald-400/70", border: "border-emerald-500/20" },
};

export function ExtensionPanel({
  lang,
  mode = "copilot",
  userTemplates,
  templateSearch,
  setTemplateSearch,
  onReplayTemplate,
  onDeleteTemplate,
  customCommands,
  onOpenCustomCommands,
  onAssetsChanged,
  onSuggestionClick,
  expanded,
  setExpanded,
}: ExtensionPanelProps) {
  // contentShown: 是否已点击某个 Tab 显示内容（展开后先只显示 Tab 行）
  const [activeTab, setActiveTab] = useState<ExtTab | null>(null);
  const [presetStatus, setPresetStatus] = useState<string>("");
  const [templateManageMode, setTemplateManageMode] = useState<boolean>(false);

  const zh = lang === "zh-CN";
  const orderedTabs = (mode === "copilot"
    ? ["modules", "templates", "commands", "preset", "proactive", "knowledge", "memory", "audit"]
    : ["modules", "commands", "templates", "preset", "audit", "knowledge", "memory", "proactive"]
  ).map((id) => TAB_CONFIG.find((tab) => tab.id === id)).filter(Boolean) as typeof TAB_CONFIG;
  const modeBadge = mode === "copilot"
    ? (zh ? "AI 自动模式" : "AI Auto")
    : (zh ? "手动基础模式" : "Manual Base");
  const modeHint = mode === "copilot"
    ? (zh ? "优先管理智能场景任务模板、NL 触发命令和预设导入导出。" : "Prioritizes smart task templates, NL command triggers, and preset import/export.")
    : (zh ? "优先管理手动单步命令、常用操作模板和预设备份。" : "Prioritizes manual single-step commands, common operation templates, and preset backup.");

  // 预设管理：导出
  const handlePresetExport = async () => {
    try {
      setPresetStatus(zh ? "正在导出..." : "Exporting...");
      const res = await fetch("/api/user-assets/export");
      const data = await res.json();
      if (data.success) {
        const blob = new Blob([JSON.stringify(data.bundle, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `mepbridge-assets-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setPresetStatus(zh ? `✅ 已导出 ${data.bundle.templates?.length || 0} 模板, ${data.bundle.commands?.length || 0} 命令` : `✅ Exported`);
      } else {
        setPresetStatus(`❌ ${data.error}`);
      }
    } catch (e: any) {
      setPresetStatus(`❌ ${e.message}`);
    }
    setTimeout(() => setPresetStatus(""), 4000);
  };

  // 预设管理：导入
  const handlePresetImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        setPresetStatus(zh ? "正在导入..." : "Importing...");
        const text = await file.text();
        const bundle = JSON.parse(text);
        const fileTemplateCount = Array.isArray(bundle.templates) ? bundle.templates.length : 0;
        const fileCommandCount = Array.isArray(bundle.commands) ? bundle.commands.length : 0;
        const res = await fetch("/api/user-assets/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bundle),
        });
        const data = await res.json();
        if (data.success) {
          const summary = data.summary || {};
          await onAssetsChanged?.();
          setPresetStatus(zh
            ? `✅ 导入完成: 文件 ${fileTemplateCount} 模板/${fileCommandCount} 命令；新增 +${summary.templatesAdded || 0}/+${summary.commandsAdded || 0}，已存在跳过 ${summary.templatesSkipped || 0}/${summary.commandsSkipped || 0}`
            : `✅ Import done: file ${fileTemplateCount} templates/${fileCommandCount} commands; added +${summary.templatesAdded || 0}/+${summary.commandsAdded || 0}, skipped ${summary.templatesSkipped || 0}/${summary.commandsSkipped || 0}`);
        } else {
          setPresetStatus(`❌ ${data.error}`);
        }
      } catch (e: any) {
        setPresetStatus(`❌ ${e.message}`);
      }
      setTimeout(() => setPresetStatus(""), 8000);
    };
    input.click();
  };

  // 预设管理：备份
  const handlePresetBackup = async () => {
    try {
      setPresetStatus(zh ? "正在备份..." : "Backing up...");
      const res = await fetch("/api/user-assets/backup", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setPresetStatus(zh ? `✅ 已备份到 user-data/backups/${data.backupFile}` : `✅ Backup: ${data.backupFile}`);
      } else {
        setPresetStatus(`❌ ${data.error}`);
      }
    } catch (e: any) {
      setPresetStatus(`❌ ${e.message}`);
    }
    setTimeout(() => setPresetStatus(""), 5000);
  };

  // 预设管理：清除当前资产并恢复发布包 starter 示例
  const handlePresetReset = async () => {
    const ok = window.confirm(zh
      ? "将先备份当前资源，然后清除并恢复到发布包内置初始示例（5 个模板 + 5 个 NL 命令）。是否继续？"
      : "Current assets will be backed up, then reset to the packaged starter examples (5 templates + 5 NL commands). Continue?");
    if (!ok) return;

    try {
      setPresetStatus(zh ? "正在清除并恢复初始示例..." : "Resetting to starter examples...");
      const res = await fetch("/api/user-assets/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: lang }),
      });
      const data = await res.json();
      if (data.success) {
        await onAssetsChanged?.();
        setPresetStatus(zh
          ? `✅ 已重置为初始示例：${data.stats?.templates || 0} 模板 / ${data.stats?.commands || 0} 命令；旧资源已备份到 user-data/backups/${data.backupFile}`
          : `✅ Reset: ${data.stats?.templates || 0} templates / ${data.stats?.commands || 0} commands; backup: ${data.backupFile}`);
      } else {
        setPresetStatus(`❌ ${data.error}`);
      }
    } catch (e: any) {
      setPresetStatus(`❌ ${e.message}`);
    }
    setTimeout(() => setPresetStatus(""), 9000);
  };

  // 模板按使用热度排序：最近使用优先 → 使用次数降序 → 名称
  // （远期再考虑分类，当前模板数量少，热度排序更直观）
  const sortedTemplates = [...userTemplates].sort((a, b) => {
    const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
    const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    const aCount = a.usageCount || 0;
    const bCount = b.usageCount || 0;
    if (aCount !== bCount) return bCount - aCount;
    return a.name.localeCompare(b.name);
  });
  const filteredTemplates = sortedTemplates.filter(t => {
    if (templateSearch) {
      const q = templateSearch.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 shadow-lg overflow-hidden flex flex-col">
      {/* 标题栏 — 点击折叠/展开 */}
      <button
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          // 折叠时重置 activeTab，下次展开只显示 Tab 行，不显示内容
          if (!next) setActiveTab(null);
        }}
        className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900/60 transition-colors cursor-pointer w-full text-left"
      >
        <h3 className="text-xs font-semibold font-display tracking-wider uppercase text-zinc-300 flex items-center gap-2">
          <span className="text-zinc-400">🧩</span>
          {zh ? "扩展功能" : "Extensions"}
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-mono normal-case text-zinc-500">{modeBadge}</span>
          {expanded && activeTab && (
            <span className="text-[10px] text-zinc-600 font-mono">
              · {TAB_CONFIG.find(t => t.id === activeTab)?.[zh ? "zh" : "en"]}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {!expanded && (
            <span className="text-[10px] text-zinc-600 font-mono">
              {zh ? "点击展开" : "Click to expand"}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Tab 切换栏 — 仅展开时显示 */}
      {expanded && (
      <div className="flex items-center gap-1 px-3 pt-2 border-b border-zinc-800 overflow-x-auto custom-scrollbar">
        {orderedTabs.map(tab => {
          const Icon = tab.icon;
          const colors = COLOR_CLASSES[tab.color];
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); }}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold border-b-2 transition-all whitespace-nowrap ${
                isActive ? colors.active : `border-transparent ${colors.inactive}`
              }`}
            >
              <Icon className="w-3 h-3" />
              {zh ? tab.zh : tab.en}
            </button>
          );
        })}
      </div>
      )}

      {expanded && activeTab === null && (
        <div className="px-4 py-3 text-[11px] text-zinc-500 border-b border-zinc-800 bg-zinc-950/30">
          {modeHint}
        </div>
      )}

      {/* 面板内容区 — 展开且已点击 Tab 时显示 */}
      {expanded && activeTab !== null && (
      <div className="flex-1 overflow-hidden" style={{ minHeight: "380px", maxHeight: "520px" }}>
        {activeTab === "modules" && <ModuleCatalogPanel lang={lang} />}

        {activeTab === "knowledge" && <KnowledgeBasePanel lang={lang} embedded />}

        {activeTab === "memory" && <LearningMemoryPanel lang={lang} embedded />}

        {activeTab === "audit" && <AuditLogPanel lang={lang} embedded />}

        {activeTab === "proactive" && (
          <ProactiveSuggestions lang={lang} embedded onSuggestionClick={onSuggestionClick} />
        )}

        {activeTab === "templates" && (
          <div className="flex flex-col h-full bg-zinc-950 text-zinc-200">
            {/* 搜索栏（移除分类下拉框，远期再设分类） */}
            <div className="flex-shrink-0 px-4 py-2.5 border-b border-zinc-800 flex items-center gap-2">
              <input
                type="text"
                value={templateSearch}
                onChange={e => setTemplateSearch(e.target.value)}
                placeholder={zh ? "搜索模板（按热度排序）..." : "Search (sorted by usage)..."}
                className="flex-1 text-xs bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-300 placeholder:text-zinc-600"
              />
              <span className="text-[10px] font-mono text-zinc-500">
                {userTemplates.length}{zh ? "个" : ""}
              </span>
              <button
                onClick={() => setTemplateManageMode(prev => !prev)}
                className={`px-2.5 py-1 text-[11px] rounded font-semibold transition-colors flex items-center gap-1 ${templateManageMode ? "bg-red-600/25 hover:bg-red-600/40 text-red-200" : "bg-pink-600/30 hover:bg-pink-600/50 text-pink-200"}`}
              >
                <Bookmark className="w-3 h-3" />
                {templateManageMode ? (zh ? "完成" : "Done") : (zh ? "管理模板" : "Manage")}
              </button>
            </div>

            {/* 模板列表 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 custom-scrollbar">
              {userTemplates.length === 0 ? (
                <div className="text-center py-8 flex flex-col items-center gap-2">
                  <Bookmark className="w-8 h-8 text-zinc-700" />
                  <div className="text-zinc-500 text-sm">{zh ? "还没有用户模板" : "No templates yet"}</div>
                  <div className="text-xs text-zinc-600 max-w-sm text-center">
                    {zh ? "执行计划后点 🔖 存为模板创建快捷任务" : "Execute a plan then click 🔖 to save template"}
                  </div>
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="text-center py-8 text-zinc-600 text-sm">
                  {zh ? "没有匹配的模板" : "No matching templates"}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {filteredTemplates.map(tpl => {
                    const usageCount = tpl.usageCount || 0;
                    const isHot = usageCount >= 3;
                    return (
                    <div
                      key={tpl.id}
                      className={`rounded-lg border p-2.5 transition-colors ${templateManageMode ? "border-red-500/25 bg-red-500/5" : "border-pink-500/20 bg-pink-500/5 hover:bg-pink-500/10"}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          {isHot && <span className="text-[10px]" title={zh ? "热门" : "Hot"}>🔥</span>}
                          <span className="text-sm">{tpl.icon || "📋"}</span>
                          <span className="text-xs font-semibold text-zinc-200 truncate">{tpl.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={`text-[9px] px-1 py-0.5 rounded ${tpl.riskLevel === "low-mutation" ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                            {tpl.riskLevel}
                          </span>
                          <button
                            onClick={() => onReplayTemplate(tpl)}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-pink-600/30 hover:bg-pink-600/50 text-pink-200 transition-colors"
                          >
                            {zh ? "重放" : "Replay"}
                          </button>
                          {templateManageMode && (
                            <button
                              onClick={() => {
                                const ok = window.confirm(zh ? `确认删除模板「${tpl.name}」？` : `Delete template "${tpl.name}"?`);
                                if (ok) onDeleteTemplate(tpl.id);
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 hover:bg-red-900/60 text-red-300 transition-colors"
                            >
                              {zh ? "删除" : "Delete"}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-[10px] text-zinc-500 truncate">{tpl.description}</div>
                      {templateManageMode && (
                        <div className="text-[9px] text-zinc-600 font-mono truncate mt-1">ID: {tpl.id}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] text-zinc-600">{tpl.plan.steps.length} {zh ? "步" : "steps"}</span>
                        {tpl.placeholders && tpl.placeholders.length > 0 && (
                          <span className="text-[9px] text-pink-400/70">{tpl.placeholders.length} {zh ? "参数" : "params"}</span>
                        )}
                        <span className="text-[9px] text-zinc-600">
                          {zh ? `用过 ${usageCount} 次` : `Used ${usageCount}x`}
                        </span>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "commands" && (
          <div className="flex flex-col h-full bg-zinc-950 text-zinc-200">
            <div className="flex-shrink-0 px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-[10px] text-zinc-500 font-mono">
                {customCommands.length} {zh ? "个自定义命令" : "custom commands"}
              </span>
              <button
                onClick={onOpenCustomCommands}
                className="px-2.5 py-1 text-[11px] bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 rounded font-semibold transition-colors flex items-center gap-1"
              >
                <Zap className="w-3 h-3" />
                {zh ? "管理命令" : "Manage"}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 custom-scrollbar">
              {customCommands.length === 0 ? (
                <div className="text-center py-8 flex flex-col items-center gap-2">
                  <Zap className="w-8 h-8 text-zinc-700" />
                  <div className="text-zinc-500 text-sm">{zh ? "还没有自定义命令" : "No custom commands"}</div>
                  <div className="text-xs text-zinc-600 max-w-sm text-center">
                    {zh ? "创建 NL 触发短语，在 Copilot 输入框打字自动匹配命令" : "Create NL trigger phrases for quick command execution in Copilot"}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {customCommands.map(cmd => (
                    <div
                      key={cmd.id}
                      className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Zap className="w-3 h-3 text-cyan-400" />
                        <div className="flex flex-wrap gap-1">
                          {cmd.triggers.map((t, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300 font-mono">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {cmd.templateId
                          ? (zh ? `→ 模板: ${cmd.templateId}` : `→ Template: ${cmd.templateId}`)
                          : cmd.singleStep
                            ? (zh ? `→ 命令: ${cmd.singleStep.action}` : `→ Action: ${cmd.singleStep.action}`)
                            : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "preset" && (
          <div className="flex flex-col h-full bg-zinc-950 text-zinc-200">
            {/* 预设管理 — 模板 + 命令 的统一导入导出入口 */}
            <div className="flex-shrink-0 px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-[10px] text-zinc-500 font-mono">
                {zh ? `模板 ${userTemplates.length} · 命令 ${customCommands.length}` : `${userTemplates.length} templates · ${customCommands.length} commands`}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handlePresetImport}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 transition-colors flex items-center gap-1"
                  title={zh ? "导入资源（JSON 文件）" : "Import resources (JSON file)"}
                >
                  <Upload className="w-3 h-3" />
                  {zh ? "导入" : "Import"}
                </button>
                <button
                  onClick={handlePresetExport}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 transition-colors flex items-center gap-1"
                  title={zh ? "导出全部资源（JSON）" : "Export all resources"}
                >
                  <Download className="w-3 h-3" />
                  {zh ? "导出" : "Export"}
                </button>
                <button
                  onClick={handlePresetBackup}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 transition-colors flex items-center gap-1"
                  title={zh ? "备份到 user-data/backups/" : "Backup to user-data/backups/"}
                >
                  <Save className="w-3 h-3" />
                  {zh ? "备份" : "Backup"}
                </button>
                <button
                  onClick={handlePresetReset}
                  className="text-[10px] px-2 py-1 rounded bg-red-600/20 hover:bg-red-600/40 text-red-300 transition-colors flex items-center gap-1"
                  title={zh ? "备份后清除并恢复内置初始示例" : "Backup, clear, and restore starter examples"}
                >
                  <RotateCcw className="w-3 h-3" />
                  {zh ? "清除重置" : "Reset"}
                </button>
              </div>
            </div>

            {/* 预设管理说明 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 custom-scrollbar">
              {presetStatus && (
                <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[10px] text-emerald-300">
                  {presetStatus}
                </div>
              )}
              <div className="space-y-3">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Package className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-emerald-200">
                      {zh ? "预设资源统一管理" : "Unified Preset Resource Management"}
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-400 leading-relaxed space-y-1">
                    <p>{zh ? "此处集中管理「用户模板」和「自定义命令」的导入、导出和备份。" : "Manage templates and custom commands: import, export, backup."}</p>
                    <p className="text-zinc-500">{zh ? "知识库和学习记忆的导入导出请在各自 Tab 内操作。" : "Knowledge base and learning memory I/O are in their own tabs."}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-pink-500/20 bg-pink-500/5 p-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Bookmark className="w-3 h-3 text-pink-400" />
                      <span className="text-[11px] font-semibold text-pink-200">{zh ? "用户模板" : "Templates"}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {userTemplates.length} {zh ? "个 · 按热度排序 · 可重放多步计划" : "items · sorted by usage · replay multi-step plans"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Zap className="w-3 h-3 text-cyan-400" />
                      <span className="text-[11px] font-semibold text-cyan-200">{zh ? "自定义命令" : "Commands"}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {customCommands.length} {zh ? "个 · NL 触发短语 · 可绑定模板或单步" : "items · NL triggers · bind to template or single step"}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
                  <div className="text-[10px] text-zinc-500 mb-1.5">{zh ? "当前导入策略" : "Current Import Strategy"}</div>
                  <div className="space-y-1 text-[10px] text-zinc-400">
                    <div className="flex items-center gap-1.5"><span className="text-emerald-400">●</span> {zh ? "按资源 ID 合并新增" : "Merge new assets by resource ID"}</div>
                    <div className="flex items-center gap-1.5"><span className="text-amber-400">●</span> {zh ? "已存在 ID 自动跳过，保留本地" : "Existing IDs are skipped, local assets kept"}</div>
                    <div className="flex items-center gap-1.5"><span className="text-cyan-400">●</span> {zh ? "导入后刷新模板和 NL 命令列表" : "Refresh templates and NL commands after import"}</div>
                  </div>
                </div>

                <div className="text-[9px] text-zinc-600 text-center pt-2">
                  {zh ? "💡 备份按钮会保存当前资源到 user-data/backups/；导入本身写入 user-data/assets.json" : "💡 Backup saves to user-data/backups/; import writes to user-data/assets.json"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
