// ExtensionPanel.tsx
// MACAI平台中央顶置九项导航；设置归口四项。访问过的工作区保留本会话状态。

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { EXTENSION_ORDER, PREVIEW_TABS, type ExtensionTab, type SettingsSection } from "../central-navigation";
const KnowledgeBasePanel = lazy(() => import("./KnowledgeBasePanel"));
const LearningMemoryPanel = lazy(() => import("./LearningMemoryPanel"));
const AuditLogPanel = lazy(() => import("./AuditLogPanel"));
const ProactiveSuggestions = lazy(() => import("./ProactiveSuggestions"));
const ModuleCatalogPanel = lazy(() => import("./ModuleCatalogPanel"));
const ModelAuditPanel = lazy(() => import("./ModelAuditPanel"));
const ExecutionRecoveryPanel = lazy(() => import("./ExecutionRecoveryPanel"));
const InstanceOverviewPanel = lazy(() => import("./InstanceOverviewPanel"));
import type { TaskTemplate, CustomNLCommand } from "../userAssets";
import { Bookmark, Zap, Database, Package, Download, Upload, Save, RotateCcw, Boxes, Server, FileJson, Layers, Settings, ShieldCheck, X } from "lucide-react";

type ExtTab = ExtensionTab;

interface ExtensionPanelProps {
  lang: "zh-CN" | "en-US";
  activeTab: ExtTab | null;
  onNavigate: (tab: ExtTab | null) => void;
  commandEditor: ReactNode;
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
  onKnowledgeDirtyChange?: (dirty: boolean) => void;
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
  { id: "modules", zh: "功能全景", en: "Capabilities", icon: Boxes, color: "sky" },
  { id: "knowledge", zh: "知识规范", en: "Knowledge", icon: Database, color: "amber" },
  { id: "modelAudit", zh: "模型审查", en: "Model Audit", icon: ShieldCheck, color: "rose" },
  { id: "templates", zh: "用户模板", en: "Templates", icon: Bookmark, color: "pink" },
  { id: "commands", zh: "自定义指令", en: "Commands", icon: Zap, color: "cyan" },
  { id: "instances", zh: "多实例快照", en: "Instances", icon: Server, color: "teal" },
  { id: "buildingJson", zh: "Building JSON", en: "Building JSON", icon: FileJson, color: "orange" },
  { id: "cadLayers", zh: "CAD 图层", en: "CAD Layers", icon: Layers, color: "lime" },
  { id: "settings", zh: "设置", en: "Settings", icon: Settings, color: "zinc" },
];

const COLOR_CLASSES: Record<string, { active: string; inactive: string; border: string }> = {
  zinc: { active: "text-zinc-200 border-zinc-300", inactive: "text-zinc-500 hover:text-zinc-200", border: "border-zinc-600" },
  sky: { active: "text-sky-400 border-sky-500", inactive: "text-zinc-500 hover:text-sky-400/70", border: "border-sky-500/20" },
  amber: { active: "text-amber-400 border-amber-500", inactive: "text-zinc-500 hover:text-amber-400/70", border: "border-amber-500/20" },
  indigo: { active: "text-indigo-400 border-indigo-500", inactive: "text-zinc-500 hover:text-indigo-400/70", border: "border-indigo-500/20" },
  rose: { active: "text-rose-400 border-rose-500", inactive: "text-zinc-500 hover:text-rose-400/70", border: "border-rose-500/20" },
  violet: { active: "text-violet-400 border-violet-500", inactive: "text-zinc-500 hover:text-violet-400/70", border: "border-violet-500/20" },
  pink: { active: "text-pink-400 border-pink-500", inactive: "text-zinc-500 hover:text-pink-400/70", border: "border-pink-500/20" },
  cyan: { active: "text-cyan-400 border-cyan-500", inactive: "text-zinc-500 hover:text-cyan-400/70", border: "border-cyan-500/20" },
  emerald: { active: "text-emerald-400 border-emerald-500", inactive: "text-zinc-500 hover:text-emerald-400/70", border: "border-emerald-500/20" },
  teal: { active: "text-teal-400 border-teal-500", inactive: "text-zinc-500 hover:text-teal-400/70", border: "border-teal-500/20" },
  orange: { active: "text-orange-400 border-orange-500", inactive: "text-zinc-500 hover:text-orange-400/70", border: "border-orange-500/20" },
  lime: { active: "text-lime-400 border-lime-500", inactive: "text-zinc-500 hover:text-lime-400/70", border: "border-lime-500/20" },
};

// Pending extension previews are visible but inactive. They must not render
// panels or call their APIs until the owner confirms each feature is complete.

const PREVIEW_LABEL = {
  "zh-CN": "预告",
  "en-US": "Planned",
} as const;

export function ExtensionPanel({
  lang,
  activeTab,
  onNavigate,
  commandEditor,
  onKnowledgeDirtyChange,
  userTemplates,
  templateSearch,
  setTemplateSearch,
  onReplayTemplate,
  onDeleteTemplate,
  customCommands,
  onAssetsChanged,
  onSuggestionClick,
  expanded,
}: ExtensionPanelProps) {
  // Lazy mount once; hide later without discarding drafts or task references.
  const [visited, setVisited] = useState<ExtTab[]>([]);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [settingsVisited, setSettingsVisited] = useState<SettingsSection[]>([]);
  useEffect(() => {
    if (activeTab && !PREVIEW_TABS.has(activeTab)) setVisited(prev => prev.includes(activeTab) ? prev : [...prev, activeTab]);
  }, [activeTab]);
  useEffect(() => {
    if (settingsSection) setSettingsVisited(prev => prev.includes(settingsSection) ? prev : [...prev, settingsSection]);
  }, [settingsSection]);
  const setActiveTab = (tab: ExtTab | null) => { if(tab && PREVIEW_TABS.has(tab)) return; onNavigate(tab); };
  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if(event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const buttons=Array.from(event.currentTarget.closest('[role="tablist"]')!.querySelectorAll('[role="tab"]:not(:disabled)')) as HTMLButtonElement[];
    const index=buttons.indexOf(event.currentTarget);
    buttons[(index+(event.key === "ArrowRight" ? 1 : buttons.length-1)) % buttons.length]?.focus();
    event.preventDefault();
  };
  const assetGate = useRef(false);
  const [assetBusy,setAssetBusy] = useState(false);
  const beginAsset = () => {if(assetGate.current)return false;assetGate.current=true;setAssetBusy(true);return true;};
  const endAsset = () => {assetGate.current=false;setAssetBusy(false);};
  const [presetStatus, setPresetStatus] = useState<string>("");
  const [templateManageMode, setTemplateManageMode] = useState<boolean>(false);

  const zh = lang === "zh-CN";
  const orderedTabs = EXTENSION_ORDER.map(id => TAB_CONFIG.find(tab => tab.id === id)!);
  // 预设管理：导出
  const handlePresetExport = async () => {
    if(!beginAsset())return;
    try {
      setPresetStatus(zh ? "正在导出..." : "Exporting...");
      const res = await fetch("/api/user-assets/export");
      const data = await res.json();
      if (res.ok && data.success) {
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
    } finally {endAsset();}
  };

  // 预设管理：导入
  const handlePresetImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file || !beginAsset()) return;
      try {
        setPresetStatus(zh ? "正在导入..." : "Importing...");
        const text = await file.text();
        const bundle = JSON.parse(text);
        const fileTemplateCount = Array.isArray(bundle.templates) ? bundle.templates.length : 0;
        const fileCommandCount = Array.isArray(bundle.commands) ? bundle.commands.length : 0;
        if (!window.confirm(zh ? `导入 ${fileTemplateCount} 个模板／${fileCommandCount} 个指令；按既有 ID 合并，不执行模型操作。继续？` : `Import ${fileTemplateCount} templates / ${fileCommandCount} commands; merge by existing IDs without model execution. Continue?`)) {endAsset();return;}
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
      } finally {endAsset();}
    };
    input.click();
  };

  // 预设管理：备份
  const handlePresetBackup = async () => {
    if(!beginAsset())return;
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
    } finally {endAsset();}
  };

  // 预设管理：清除当前资产并恢复发布包 starter 示例
  const handlePresetReset = async () => {
    const ok = window.confirm(zh
      ? "将先备份当前资源，然后清除并恢复到发布包内置初始示例（5 个模板 + 5 个 NL 命令）。是否继续？"
      : "Current assets will be backed up, then reset to the packaged starter examples (5 templates + 5 NL commands). Continue?");
    if (!ok || !beginAsset()) return;

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
    } finally {endAsset();}
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
      // 支持按编号搜索（如 TPL-006 / tpl6）
      return t.name.toLowerCase().includes(q)
        || t.description.toLowerCase().includes(q)
        || (t.code || "").toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className={expanded ? "flex flex-col flex-1 min-h-0 overflow-hidden" : "flex flex-col shrink-0"}>
      <nav role="tablist" aria-label={zh ? "中央扩展功能" : "Central extensions"} className="flex shrink-0 gap-1 items-center border-b border-zinc-800 bg-zinc-900/70 py-1">
        <div className="flex flex-1 min-w-0 overflow-x-auto gap-1">
          {orderedTabs.filter(tab => tab.id !== "settings").map(tab => {
            const Icon=tab.icon, disabled=PREVIEW_TABS.has(tab.id);
            return <button key={tab.id} role="tab" aria-controls="central-extension-content" aria-selected={activeTab===tab.id} disabled={disabled} aria-disabled={disabled} title={disabled?PREVIEW_LABEL[lang]:undefined}
              onClick={()=>setActiveTab(activeTab===tab.id?null:tab.id)}
              onKeyDown={moveTabFocus}
              className={"shrink-0 whitespace-nowrap border-b-2 px-2 py-2 text-xs flex gap-1 items-center "+(disabled?"text-zinc-600 border-transparent":activeTab===tab.id?COLOR_CLASSES[tab.color].active:COLOR_CLASSES[tab.color].inactive)}>
              <Icon className="w-3 h-3"/>{zh?tab.zh:tab.en}{disabled && <span className="text-[9px]">{PREVIEW_LABEL[lang]}</span>}
            </button>;
          })}
        </div>
        <button role="tab" aria-controls="central-extension-content" onKeyDown={moveTabFocus} aria-selected={activeTab==='settings'} onClick={()=>setActiveTab(activeTab==='settings'?null:'settings')} className={"shrink-0 text-xs px-2 py-2 flex gap-1 items-center border-b-2 "+(activeTab==='settings'?COLOR_CLASSES.zinc.active:"border-transparent text-zinc-400")}><Settings className="w-3 h-3"/>{zh?'设置':'Settings'}</button>
        {expanded && <button onClick={()=>setActiveTab(null)} className="shrink-0 px-2 py-2 text-xs" aria-label={zh?'返回工作区':'Back to workspace'}><X className="w-3 h-3"/></button>}
      </nav>
      <div id="central-extension-content" role="tabpanel" hidden={!expanded} style={{ display: (!expanded) ? "none" : undefined }} className="flex-1 min-h-0 overflow-auto border border-zinc-800 rounded">
        <Suspense fallback={<p className="p-3 text-xs">{zh?'加载中…':'Loading…'}</p>}>
          {(activeTab === 'settings' || visited.includes('settings')) && <section hidden={activeTab !== 'settings'} style={{ display: (activeTab !== 'settings') ? "none" : undefined }} className="p-3 space-y-3">
            <h2 className="text-sm">{zh?'设置':'Settings'}</h2>
            <div className="flex flex-wrap gap-2">
              {([{id:'proactive',zh:'主动智能',en:'Proactive AI'},{id:'memory',zh:'学习记忆',en:'Learning Memory'},{id:'preset',zh:'预设管理',en:'Presets'},{id:'audit',zh:'审计日志',en:'Audit Log'}] as const).map(section=><button key={section.id} aria-pressed={settingsSection===section.id} onClick={()=>setSettingsSection(section.id)} className="border border-zinc-700 rounded px-3 py-1 text-xs">{zh?section.zh:section.en}</button>)}
            </div>
            {!settingsSection && <p className="text-xs text-zinc-500">{zh?'选择管理分类；进入设置不会扫描模型或改变执行策略。':'Choose a category. Opening settings does not scan the model or change execution policy.'}</p>}
          </section>}
          {(settingsSection==='proactive'||settingsVisited.includes('proactive')) && <div hidden={activeTab!=='settings'||settingsSection!=='proactive'} style={{ display: (activeTab!=='settings'||settingsSection!=='proactive') ? "none" : undefined }} className="h-full"><ProactiveSuggestions lang={lang} embedded active={activeTab==='settings'&&settingsSection==='proactive'} onSuggestionClick={onSuggestionClick}/></div>}
          {(settingsSection==='memory'||settingsVisited.includes('memory')) && <div hidden={activeTab!=='settings'||settingsSection!=='memory'} style={{ display: (activeTab!=='settings'||settingsSection!=='memory') ? "none" : undefined }} className="h-full"><LearningMemoryPanel lang={lang} embedded/></div>}
          {(settingsSection==='audit'||settingsVisited.includes('audit')) && <div hidden={activeTab!=='settings'||settingsSection!=='audit'} style={{ display: (activeTab!=='settings'||settingsSection!=='audit') ? "none" : undefined }} className="h-full"><ExecutionRecoveryPanel lang={lang}/><AuditLogPanel lang={lang} embedded/></div>}
        {(activeTab === "modules" || visited.includes("modules")) && <div hidden={activeTab !== "modules"} style={{ display: (activeTab !== "modules") ? "none" : undefined }} className="h-full min-h-0 overflow-auto"><ModuleCatalogPanel lang={lang} /></div>}

        {(activeTab === "knowledge" || visited.includes("knowledge")) && <div hidden={activeTab !== "knowledge"} style={{ display: (activeTab !== "knowledge") ? "none" : undefined }} className="h-full min-h-0"><KnowledgeBasePanel lang={lang} embedded onDirtyChange={onKnowledgeDirtyChange} /></div>}
        {(activeTab === "modelAudit" || visited.includes("modelAudit")) && <div hidden={activeTab !== "modelAudit"} style={{ display: (activeTab !== "modelAudit") ? "none" : undefined }} className="h-full overflow-auto"><ModelAuditPanel lang={lang} /></div>}



        {(activeTab === "templates" || visited.includes("templates")) && (
          <div hidden={activeTab !== "templates"} style={{ display: (activeTab !== "templates") ? "none" : undefined }} className="flex flex-col h-full bg-zinc-950 text-zinc-200">
            {/* 搜索栏（移除分类下拉框，远期再设分类） */}
            <div className="flex-shrink-0 px-4 py-2.5 border-b border-zinc-800 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={templateSearch}
                  onChange={e => setTemplateSearch(e.target.value)}
                  placeholder={zh ? "搜索模板（名称或编号，如 TPL-026）..." : "Search (name or code, e.g. TPL-026)..."}
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
              <div className="text-[10px] text-zinc-600">
                {zh
                  ? "在聊天框直接输入编号即可复现模板（如 TPL-001）；官方配方可在聊天中用 SYS-0NN（如 SYS-014）或自然语言触发"
                  : "Type a code in the chat to replay a template (e.g. TPL-001); factory recipes stay chat-only: SYS-0NN (e.g. SYS-014) or natural language"}
              </div>
            </div>

            {/* 模板列表 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 custom-scrollbar">
              <div className="text-[10px] font-semibold text-pink-300 mb-1.5">
                {zh ? "我的模板（TPL-0NN · 可编辑）" : "My templates (TPL-0NN · editable)"}
              </div>
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
                    return (
                    <div
                      key={tpl.id}
                      className={`rounded-lg border p-2.5 transition-colors ${templateManageMode ? "border-red-500/25 bg-red-500/5" : "border-pink-500/20 bg-pink-500/5 hover:bg-pink-500/10"}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {tpl.code && (
                            <span
                              className="text-[9px] font-mono px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-pink-200 whitespace-nowrap"
                              title={zh ? "在聊天框输入该编号即可复现" : "Type this code in the chat to replay"}
                            >
                              {tpl.code}
                            </span>
                          )}
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
                      <div className="text-[10px] text-zinc-500 truncate" title={tpl.description}>{tpl.description}</div>
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
                      {customCommands.some(c => c.templateId === tpl.id) && (
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          <span className="text-[8px] text-cyan-400 font-mono">NL:</span>
                          {customCommands
                            .filter(c => c.templateId === tpl.id)
                            .flatMap(c => c.triggers)
                            .map((trig, i) => (
                              <span key={i} className="text-[8px] px-1 py-0.2 rounded bg-cyan-950/70 border border-cyan-800/40 text-cyan-300 font-mono">
                                {trig}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}

            </div>
          </div>
        )}

        {(activeTab === "commands" || visited.includes("commands")) && <div hidden={activeTab !== "commands"} style={{ display: (activeTab !== "commands") ? "none" : undefined }} className="h-full min-h-0">{commandEditor}</div>}

        {(activeTab === "instances" || visited.includes("instances")) && (
          <div hidden={activeTab !== "instances"} style={{ display: (activeTab !== "instances") ? "none" : undefined }} className="flex flex-col h-full bg-zinc-950 text-zinc-200">
            <InstanceOverviewPanel lang={lang} active={activeTab === "instances"} />
          </div>
        )}

        {(settingsSection === "preset" || settingsVisited.includes("preset")) && (
          <div hidden={activeTab !== "settings" || settingsSection !== "preset"} style={{ display: (activeTab !== "settings" || settingsSection !== "preset") ? "none" : undefined }} className="flex flex-col h-full bg-zinc-950 text-zinc-200">
            {/* 预设管理 — 模板 + 命令 的统一导入导出入口 */}
            <div className="flex-shrink-0 px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-[10px] text-zinc-500 font-mono">
                {zh ? `模板 ${userTemplates.length} · 命令 ${customCommands.length}` : `${userTemplates.length} templates · ${customCommands.length} commands`}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handlePresetImport}
                  disabled={assetBusy}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 transition-colors flex items-center gap-1"
                  title={zh ? "导入资源（JSON 文件）" : "Import resources (JSON file)"}
                >
                  <Upload className="w-3 h-3" />
                  {zh ? "导入" : "Import"}
                </button>
                <button
                  onClick={handlePresetExport}
                  disabled={assetBusy}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 transition-colors flex items-center gap-1"
                  title={zh ? "导出全部资源（JSON）" : "Export all resources"}
                >
                  <Download className="w-3 h-3" />
                  {zh ? "导出" : "Export"}
                </button>
                <button
                  onClick={handlePresetBackup}
                  disabled={assetBusy}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 transition-colors flex items-center gap-1"
                  title={zh ? "备份到 user-data/backups/" : "Backup to user-data/backups/"}
                >
                  <Save className="w-3 h-3" />
                  {zh ? "备份" : "Backup"}
                </button>
                <button
                  onClick={handlePresetReset}
                  disabled={assetBusy}
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
                  <div
                    onClick={() => setActiveTab("templates")}
                    className="rounded-lg border border-pink-500/20 bg-pink-500/5 p-2.5 cursor-pointer hover:bg-pink-500/15 hover:border-pink-500/40 transition-all group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <Bookmark className="w-3 h-3 text-pink-400" />
                        <span className="text-[11px] font-semibold text-pink-200">{zh ? "用户模板" : "Templates"}</span>
                      </div>
                      <span className="text-[9px] text-pink-400 group-hover:translate-x-0.5 transition-transform">
                        {zh ? "查看全部 →" : "View all →"}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      <span className="font-semibold text-pink-300 font-mono text-xs">{userTemplates.length}</span> {zh ? " 个 · 点击进入管理或重放" : " items · click to manage / replay"}
                    </div>
                  </div>
                  <div
                    onClick={() => setActiveTab("commands")}
                    className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5 cursor-pointer hover:bg-cyan-500/15 hover:border-cyan-500/40 transition-all group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-cyan-400" />
                        <span className="text-[11px] font-semibold text-cyan-200">{zh ? "自定义命令" : "Commands"}</span>
                      </div>
                      <span className="text-[9px] text-cyan-400 group-hover:translate-x-0.5 transition-transform">
                        {zh ? "配置命令 →" : "Manage →"}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      <span className="font-semibold text-cyan-300 font-mono text-xs">{customCommands.length}</span> {zh ? " 个 · 点击管理 NL 触发短语" : " items · click to manage triggers"}
                    </div>
                  </div>
                </div>

                {/* 模板与自定义命令资产概览 */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                      <Bookmark className="w-3.5 h-3.5 text-pink-400" />
                      {zh ? "已保存的用户模板概览" : "Saved User Templates Overview"}
                    </span>
                    <span className="text-[9px] text-zinc-500 font-mono">
                      {userTemplates.length} {zh ? "个就绪" : "ready"}
                    </span>
                  </div>

                  {userTemplates.length === 0 ? (
                    <div className="text-[10px] text-zinc-600 font-mono py-2 text-center">
                      {zh ? "暂无模板资产，请从上方导入或由执行计划保存" : "No templates yet. Import or save from plan."}
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                      {userTemplates.map((tpl) => {
                        const boundCmds = customCommands.filter((c) => c.templateId === tpl.id);
                        return (
                          <div
                            key={tpl.id}
                            className="rounded border border-zinc-800/80 bg-zinc-950/60 p-2 hover:border-pink-500/30 transition-colors flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-pink-500/15 text-pink-300 font-semibold">
                                  {tpl.code || tpl.id.slice(0, 10)}
                                </span>
                                <span className="text-[11px] font-medium text-zinc-200 truncate">
                                  {tpl.name}
                                </span>
                                <span className="text-[9px] text-zinc-500 font-mono">
                                  {tpl.plan?.steps?.length || 0} {zh ? "步" : "steps"}
                                </span>
                              </div>
                              {tpl.description && (
                                <p className="text-[9px] text-zinc-500 truncate mt-0.5">
                                  {tpl.description}
                                </p>
                              )}
                              {boundCmds.length > 0 && (
                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                  <span className="text-[8px] text-cyan-400 font-mono">NL:</span>
                                  {boundCmds.flatMap((c) => c.triggers).slice(0, 3).map((trig, i) => (
                                    <span key={i} className="text-[8px] px-1 rounded bg-cyan-950/60 border border-cyan-800/40 text-cyan-300 font-mono">
                                      {trig}
                                    </span>
                                  ))}
                                  {boundCmds.flatMap((c) => c.triggers).length > 3 && (
                                    <span className="text-[8px] text-zinc-600 font-mono">+{boundCmds.flatMap((c) => c.triggers).length - 3}</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onReplayTemplate(tpl);
                              }}
                              className="flex-shrink-0 px-2 py-1 rounded bg-pink-600/20 hover:bg-pink-600/40 text-pink-300 border border-pink-500/30 text-[10px] font-mono transition-colors"
                              title={zh ? "载入此模板到执行区并重放" : "Load plan and replay"}
                            >
                              {zh ? "重放" : "Replay"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 自定义 NL 指令概览 */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-cyan-400" />
                      {zh ? "已启用的自然语言指令 (NL Commands)" : "Active NL Commands"}
                    </span>
                    <button
                      onClick={() => setActiveTab("commands")}
                      className="text-[9px] text-cyan-400 hover:text-cyan-300 font-mono transition-colors"
                    >
                      {zh ? "添加 / 编辑 →" : "Add / Edit →"}
                    </button>
                  </div>

                  {customCommands.length === 0 ? (
                    <div className="text-[10px] text-zinc-600 font-mono py-2 text-center">
                      {zh ? "暂无自定义命令" : "No custom commands"}
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                      {customCommands.map((cmd) => (
                        <div
                          key={cmd.id}
                          className="rounded border border-zinc-800/80 bg-zinc-950/60 p-2 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-medium text-zinc-200">
                                {cmd.description || cmd.triggers[0] || cmd.id}
                              </span>
                              <span className="text-[8px] font-mono px-1 rounded bg-zinc-800 text-zinc-400">
                                {cmd.templateId ? (zh ? "绑定模板" : "Template") : (zh ? "单步命令" : "Action")}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              {cmd.triggers.map((t, idx) => (
                                <span key={idx} className="text-[8px] px-1 py-0.2 rounded bg-cyan-900/30 text-cyan-300 font-mono">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                          <span className="text-[9px] text-zinc-500 font-mono flex-shrink-0">
                            {cmd.templateId ? cmd.templateId : (cmd.singleStep?.action || "")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
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

        </Suspense>
      </div>
    </div>
  );
}
