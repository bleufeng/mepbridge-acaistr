// CustomCommandsPanel.tsx
// E.5: 自定义 NL 命令管理面板
// 在设置页 LLM 配置入口旁加"自定义命令"分区

import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, ToggleLeft, ToggleRight, Zap } from 'lucide-react';
import type { CustomNLCommand, RiskLevel, TaskTemplate } from '../userAssets';
import { generateId } from '../userAssets';

interface CustomCommandsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  lang: string;
}

export const CustomCommandsPanel: React.FC<CustomCommandsPanelProps> = ({
  isOpen,
  onClose,
  onSaved,
  lang
}) => {
  const [commands, setCommands] = useState<CustomNLCommand[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // 新建命令表单状态
  const [newTriggers, setNewTriggers] = useState("");
  const [newBindType, setNewBindType] = useState<"template" | "singleStep">("singleStep");
  const [newTemplateId, setNewTemplateId] = useState("");
  const [newAction, setNewAction] = useState("");
  const [newParams, setNewParams] = useState("{}");
  const [newRiskLevel, setNewRiskLevel] = useState<RiskLevel>("read");

  useEffect(() => {
    if (isOpen) {
      loadCommands();
    }
  }, [isOpen, lang]);

  const loadCommands = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/user-assets/load?locale=${encodeURIComponent(lang)}`);
      const data = await res.json();
      if (data.success) {
        if (Array.isArray(data.commands)) {
          setCommands(data.commands);
        }
        if (Array.isArray(data.templates)) {
          setTemplates(data.templates);
        }
      }
    } catch (err) {
      console.error("[CustomCommandsPanel] Load error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = async () => {
    const triggers = newTriggers.split("\n").map(t => t.trim()).filter(t => t.length > 0);
    if (triggers.length === 0) return;

    if (newBindType === "template" && !newTemplateId.trim()) return;
    if (newBindType === "singleStep" && !newAction.trim()) return;

    const command: CustomNLCommand = {
      id: generateId(),
      triggers,
      priority: 100,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    if (newBindType === "template") {
      command.templateId = newTemplateId.trim();
    } else {
      let params = {};
      try {
        params = JSON.parse(newParams);
      } catch {
        params = {};
      }
      command.singleStep = {
        action: newAction.trim(),
        params,
        riskLevel: newRiskLevel,
      };
    }

    try {
      const res = await fetch("/api/user-assets/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const data = await res.json();
      if (data.success) {
        setNewTriggers("");
        setNewTemplateId("");
        setNewAction("");
        setNewParams("{}");
        setShowAddForm(false);
        loadCommands();
        if (onSaved) onSaved();
      }
    } catch (err) {
      console.error("[CustomCommandsPanel] Add error:", err);
    }
  };

  const handleToggle = async (cmd: CustomNLCommand) => {
    const updated = { ...cmd, enabled: !cmd.enabled };
    try {
      await fetch("/api/user-assets/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      loadCommands();
    } catch (err) {
      console.error("[CustomCommandsPanel] Toggle error:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/user-assets/commands/${id}`, { method: "DELETE" });
      loadCommands();
    } catch (err) {
      console.error("[CustomCommandsPanel] Delete error:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold font-display tracking-wider uppercase text-zinc-200 flex items-center gap-2">
            <Zap className="w-4 h-4 text-indigo-400" />
            {lang === "zh-CN" ? "自定义 NL 命令" : "Custom NL Commands"}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 flex flex-col gap-4">
          {/* 说明 */}
          <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-indigo-300/80">
            {lang === "zh-CN"
              ? "自定义命令在 Copilot 输入时本地短路匹配（<200ms），命中后直接重放绑定的模板或单步命令，不调 LLM。常用意图建议建命令，偶发/模糊意图仍由 Copilot LLM 处理。"
              : "Custom commands are matched locally (<200ms) before calling LLM. Matched triggers replay the bound template or single step. Build commands for frequent intents; LLM handles occasional/fuzzy intents."}
          </div>

          {/* 命令列表 */}
          {isLoading ? (
            <div className="text-center py-8 text-zinc-500 text-sm">
              {lang === "zh-CN" ? "加载中..." : "Loading..."}
            </div>
          ) : commands.length === 0 ? (
            <div className="text-center py-8 text-zinc-500 text-sm">
              {lang === "zh-CN" ? "还没有自定义命令" : "No custom commands yet"}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {commands.map((cmd) => (
                <div key={cmd.id} className="rounded-lg border border-zinc-700 bg-zinc-800/30 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {/* Triggers */}
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {cmd.triggers.map((t, i) => (
                          <span key={i} className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 rounded text-xs text-indigo-300">
                            {t}
                          </span>
                        ))}
                      </div>
                      {/* Binding */}
                      <div className="text-xs text-zinc-400">
                        {cmd.templateId ? (
                          <span>→ {lang === "zh-CN" ? "模板" : "Template"}: <code className="text-pink-300">{cmd.templateId}</code></span>
                        ) : cmd.singleStep ? (
                          <span>→ {lang === "zh-CN" ? "单步" : "Step"}: <code className="text-emerald-300">{cmd.singleStep.action}</code>
                            <span className={`ml-2 px-1.5 py-0.5 rounded ${cmd.singleStep.riskLevel === "low-mutation" ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                              {cmd.singleStep.riskLevel}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleToggle(cmd)}
                        className={`transition-colors ${cmd.enabled ? "text-emerald-400 hover:text-emerald-300" : "text-zinc-600 hover:text-zinc-500"}`}
                        title={cmd.enabled ? (lang === "zh-CN" ? "已启用" : "Enabled") : (lang === "zh-CN" ? "已禁用" : "Disabled")}
                      >
                        {cmd.enabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => handleDelete(cmd.id)}
                        className="text-zinc-600 hover:text-red-400 transition-colors"
                        title={lang === "zh-CN" ? "删除" : "Delete"}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 新建命令表单 */}
          {showAddForm ? (
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4 flex flex-col gap-3">
              <div className="text-xs font-semibold text-indigo-300">
                {lang === "zh-CN" ? "新建自定义命令" : "New Custom Command"}
              </div>

              {/* Triggers */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-400">
                  {lang === "zh-CN" ? "触发词（每行一个）" : "Triggers (one per line)"}
                </label>
                <textarea
                  value={newTriggers}
                  onChange={(e) => setNewTriggers(e.target.value)}
                  placeholder={lang === "zh-CN" ? "把管子抬高\n上移水管" : "raise pipe\nmove pipe up"}
                  rows={2}
                  className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none transition-colors resize-none"
                />
              </div>

              {/* Bind Type */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-400">
                  {lang === "zh-CN" ? "绑定类型" : "Bind Type"}
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setNewBindType("singleStep")}
                    className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                      newBindType === "singleStep" ? "bg-indigo-500/20 border-indigo-500 text-indigo-300" : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}
                  >
                    {lang === "zh-CN" ? "单步命令" : "Single Step"}
                  </button>
                  <button
                    onClick={() => setNewBindType("template")}
                    className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                      newBindType === "template" ? "bg-pink-500/20 border-pink-500 text-pink-300" : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}
                  >
                    {lang === "zh-CN" ? "模板" : "Template"}
                  </button>
                </div>
              </div>

              {newBindType === "template" ? (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-zinc-400">
                    {lang === "zh-CN" ? "选择模板" : "Select Template"}
                  </label>
                  {templates.length === 0 ? (
                    <div className="text-xs text-zinc-500 italic">
                      {lang === "zh-CN" ? "暂无已保存模板，请先在 Copilot 中存为模板" : "No templates saved yet, save one from Copilot first"}
                    </div>
                  ) : (
                    <select
                      value={newTemplateId}
                      onChange={(e) => setNewTemplateId(e.target.value)}
                      className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:border-pink-500 focus:outline-none transition-colors"
                    >
                      <option value="">{lang === "zh-CN" ? "-- 选择模板 --" : "-- Select template --"}</option>
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.icon || "📋"} {tpl.name} ({tpl.riskLevel})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-zinc-400">
                      {lang === "zh-CN" ? "命令 action（对齐 tool-descriptors）" : "Action (aligns with tool-descriptors)"}
                    </label>
                    <input
                      type="text"
                      value={newAction}
                      onChange={(e) => setNewAction(e.target.value)}
                      placeholder="MoveSelectedElements"
                      className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-zinc-400">
                      {lang === "zh-CN" ? "参数 (JSON)" : "Params (JSON)"}
                    </label>
                    <textarea
                      value={newParams}
                      onChange={(e) => setNewParams(e.target.value)}
                      rows={2}
                      className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none transition-colors resize-none font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-zinc-400">
                      {lang === "zh-CN" ? "风险等级" : "Risk Level"}
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setNewRiskLevel("read")}
                        className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                          newRiskLevel === "read" ? "bg-emerald-500/20 border-emerald-500 text-emerald-300" : "bg-zinc-800 border-zinc-700 text-zinc-400"
                        }`}
                      >
                        read
                      </button>
                      <button
                        onClick={() => setNewRiskLevel("low-mutation")}
                        className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                          newRiskLevel === "low-mutation" ? "bg-amber-500/20 border-amber-500 text-amber-300" : "bg-zinc-800 border-zinc-700 text-zinc-400"
                        }`}
                      >
                        low-mutation
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-5 py-3">
          <div className="text-[10px] text-zinc-500 leading-relaxed max-w-xs">
            {lang === "zh-CN"
              ? "导入、导出、备份和清除重置统一在中区「预设管理」执行。"
              : "Import, export, backup, and reset are centralized in Preset Management."}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-3.5 py-1.5 text-xs font-semibold text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/10 rounded cursor-pointer transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              {showAddForm ? (lang === "zh-CN" ? "取消" : "Cancel") : (lang === "zh-CN" ? "新建命令" : "New Command")}
            </button>
            {showAddForm && (
              <button
                onClick={handleAdd}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded flex items-center gap-2 cursor-pointer transition-all"
              >
                {lang === "zh-CN" ? "保存命令" : "Save Command"}
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold text-zinc-400 border border-zinc-700 hover:bg-zinc-800 rounded cursor-pointer transition-colors"
            >
              {lang === "zh-CN" ? "关闭" : "Close"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
