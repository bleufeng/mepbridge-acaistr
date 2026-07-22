// SaveTemplateModal.tsx
// E.3: "存为模板" 对话框组件
// 在 Copilot 计划卡操作栏点击 "🔖 存为模板" 后弹出
// 让用户填写 name / category / icon / description，自动扫描占位符

import React, { useState, useEffect } from 'react';
import { X, Save, Sparkles } from 'lucide-react';
import type { OperationPlan } from '../types';
import {
  generateId,
  extractPlaceholders,
  type TaskTemplate,
  type TemplateCategory,
  type RiskLevel
} from '../userAssets';

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (template: TaskTemplate) => void;
  lang: string;
  plan: OperationPlan | null;
}

const CATEGORY_OPTIONS: { value: TemplateCategory; labelZh: string; labelEn: string; icon: string }[] = [
  { value: "MEPBridge-读取", labelZh: "MEP 读取", labelEn: "MEP Read", icon: "📋" },
  { value: "MEPBridge-修改", labelZh: "MEP 修改", labelEn: "MEP Modify", icon: "↕️" },
  { value: "Water", labelZh: "Water 水管", labelEn: "Water", icon: "🚿" },
  { value: "Electrical", labelZh: "Electrical 电气", labelEn: "Electrical", icon: "⚡" },
  { value: "Ventilation", labelZh: "Ventilation 暖通", labelEn: "Ventilation", icon: "🌪️" },
  { value: "Building", labelZh: "Building 建筑", labelEn: "Building", icon: "🏗️" },
  { value: "自定义", labelZh: "自定义", labelEn: "Custom", icon: "⭐" },
];

const ICON_OPTIONS = ["↕️", "✏️", "📑", "📋", "🔍", "🗑️", "🚿", "⚡", "🌪️", "🔌", "⭐", "📦"];

export const SaveTemplateModal: React.FC<SaveTemplateModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  lang,
  plan
}) => {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("MEPBridge-修改");
  const [icon, setIcon] = useState("↕️");
  const [description, setDescription] = useState("");
  const [detectedPlaceholders, setDetectedPlaceholders] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  // Modal 打开时重置状态并扫描占位符
  useEffect(() => {
    if (isOpen && plan) {
      setName("");
      setCategory(plan.isMutation ? "MEPBridge-修改" : "MEPBridge-读取");
      setIcon("↕️");
      setDescription("");
      setSaveResult(null);

      // 自动扫描 plan 中的 {{xxx}} 占位符
      const placeholders = extractPlaceholders(plan);
      setDetectedPlaceholders(placeholders.map(p => p.key));
    }
  }, [isOpen, plan]);

  // 推断 riskLevel
  const inferRiskLevel = (plan: OperationPlan | null): RiskLevel => {
    if (!plan) return "read";
    return plan.isMutation ? "low-mutation" : "read";
  };

  const handleSave = async () => {
    if (!plan) return;
    if (!name.trim()) {
      setSaveResult({ success: false, message: lang === "zh-CN" ? "请输入模板名称" : "Please enter template name" });
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const placeholders = extractPlaceholders(plan);
      const template: TaskTemplate = {
        id: generateId(),
        name: name.trim(),
        category,
        icon,
        description: description.trim() || plan.title,
        plan,
        placeholders: placeholders.length > 0 ? placeholders : undefined,
        riskLevel: inferRiskLevel(plan),
        createdAt: now,
        updatedAt: now,
      };

      const res = await fetch("/api/user-assets/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(template),
      });
      const data = await res.json();

      if (data.success) {
        setSaveResult({ success: true, message: lang === "zh-CN" ? "模板保存成功" : "Template saved successfully" });
        if (onSaved) onSaved(template);
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setSaveResult({ success: false, message: data.error || "Save failed" });
      }
    } catch (err) {
      console.error("[SaveTemplateModal] Save error:", err);
      setSaveResult({ success: false, message: String(err) });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold font-display tracking-wider uppercase text-zinc-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-pink-400" />
            {lang === "zh-CN" ? "存为模板" : "Save as Template"}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 flex flex-col gap-4">
          {/* Plan Preview */}
          {plan && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3">
              <div className="text-xs text-zinc-500 mb-1">
                {lang === "zh-CN" ? "源计划" : "Source Plan"}
              </div>
              <div className="text-sm font-semibold text-zinc-200">{plan.title}</div>
              <div className="text-xs text-zinc-400 mt-1">
                {plan.steps.length} {lang === "zh-CN" ? "步" : "steps"}
                {plan.isMutation && (
                  <span className="ml-2 text-amber-400">⚠ {lang === "zh-CN" ? "包含修改操作" : "Mutation"}</span>
                )}
              </div>
            </div>
          )}

          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400">
              {lang === "zh-CN" ? "模板名称 *" : "Template Name *"}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={lang === "zh-CN" ? "如：标准水管上移200" : "e.g. Standard pipe up 200"}
              className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:border-pink-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400">
              {lang === "zh-CN" ? "分类" : "Category"}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {CATEGORY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setCategory(opt.value); setIcon(opt.icon); }}
                  className={`px-2 py-1.5 rounded text-xs font-semibold transition-colors border ${
                    category === opt.value
                      ? "bg-pink-500/20 border-pink-500 text-pink-300"
                      : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  <span className="mr-1">{opt.icon}</span>
                  {lang === "zh-CN" ? opt.labelZh : opt.labelEn}
                </button>
              ))}
            </div>
          </div>

          {/* Icon */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400">
              {lang === "zh-CN" ? "图标" : "Icon"}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ICON_OPTIONS.map((ic) => (
                <button
                  key={ic}
                  onClick={() => setIcon(ic)}
                  className={`w-8 h-8 rounded text-base flex items-center justify-center transition-colors border ${
                    icon === ic
                      ? "bg-pink-500/20 border-pink-500"
                      : "bg-zinc-800 border-zinc-700 hover:border-zinc-600"
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-400">
              {lang === "zh-CN" ? "描述" : "Description"}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={lang === "zh-CN" ? "可选，描述这个模板的用途" : "Optional, describe the template purpose"}
              rows={2}
              className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:border-pink-500 focus:outline-none transition-colors resize-none"
            />
          </div>

          {/* Detected Placeholders */}
          {detectedPlaceholders.length > 0 && (
            <div className="rounded-lg border border-pink-500/20 bg-pink-500/5 p-3">
              <div className="text-xs font-semibold text-pink-300 mb-1.5 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                {lang === "zh-CN" ? `检测到 ${detectedPlaceholders.length} 个占位符` : `${detectedPlaceholders.length} placeholders detected`}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {detectedPlaceholders.map((key) => (
                  <span key={key} className="px-2 py-0.5 bg-pink-500/10 border border-pink-500/20 rounded text-xs text-pink-300 font-mono">
                    {`{{${key}}}`}
                  </span>
                ))}
              </div>
              <div className="text-xs text-pink-400/60 mt-1.5">
                {lang === "zh-CN" ? "重放模板时会弹窗让用户填写这些值" : "User will be prompted to fill these values on replay"}
              </div>
            </div>
          )}

          {/* Risk Level Info */}
          <div className="text-xs text-zinc-500 flex items-center gap-1.5">
            <span className={`px-2 py-0.5 rounded ${inferRiskLevel(plan) === "low-mutation" ? "bg-amber-500/10 text-amber-400" : "bg-emerald-500/10 text-emerald-400"}`}>
              riskLevel: {inferRiskLevel(plan)}
            </span>
          </div>

          {/* Save Result */}
          {saveResult && (
            <div className={`rounded-lg p-3 text-sm ${saveResult.success ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
              {saveResult.message}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-5 py-3">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold text-zinc-400 border border-zinc-700 hover:bg-zinc-800 rounded cursor-pointer transition-colors"
          >
            {lang === "zh-CN" ? "取消" : "Cancel"}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="px-4 py-2 text-xs font-semibold text-white bg-pink-600 hover:bg-pink-500 rounded flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Save className="w-3.5 h-3.5" />
            {isSaving ? (lang === "zh-CN" ? "保存中..." : "Saving...") : (lang === "zh-CN" ? "保存模板" : "Save Template")}
          </button>
        </div>
      </div>
    </div>
  );
};
