// TemplateReplayModal.tsx
// E.4: 模板重放对话框组件
// 点击模板卡片后弹出，让用户填写占位符，然后按当前模式执行

import React, { useState, useEffect } from 'react';
import { X, Play, AlertTriangle } from 'lucide-react';
import type { OperationPlan } from '../types';
import {
  fillPlaceholders,
  validatePlaceholderValue,
  type TaskTemplate
} from '../userAssets';

interface TemplateReplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReplay: (filledPlan: OperationPlan | null) => void;
  lang: string;
  template: TaskTemplate | null;
}

export const TemplateReplayModal: React.FC<TemplateReplayModalProps> = ({
  isOpen,
  onClose,
  onReplay,
  lang,
  template
}) => {
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen && template?.placeholders) {
      const initialValues: Record<string, string> = {};
      for (const p of template.placeholders) {
        initialValues[p.key] = p.defaultValue || '';
      }
      setPlaceholderValues(initialValues);
      setErrors({});
    }
  }, [isOpen, template]);

  if (!isOpen || !template) return null;

  const handleReplay = () => {
    // 校验所有占位符
    const newErrors: Record<string, string> = {};
    if (template.placeholders) {
      for (const p of template.placeholders) {
        const value = placeholderValues[p.key] || '';
        const err = validatePlaceholderValue(p, value);
        if (err) {
          newErrors[p.key] = err;
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // 填充占位符
    const filledPlan = fillPlaceholders(template.plan, placeholderValues);
    onReplay(filledPlan);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold font-display tracking-wider uppercase text-zinc-200 flex items-center gap-2">
            <span className="text-lg">{template.icon || "📋"}</span>
            {template.name}
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
          {/* Template Info */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3">
            {template.description && (
              <div className="text-sm text-zinc-300 mb-2">{template.description}</div>
            )}
            <div className="flex items-center gap-3 text-xs">
              <span className={`px-2 py-0.5 rounded ${
                template.riskLevel === "low-mutation"
                  ? "bg-amber-500/10 text-amber-400"
                  : "bg-emerald-500/10 text-emerald-400"
              }`}>
                riskLevel: {template.riskLevel}
              </span>
              <span className="text-zinc-500">
                {template.plan.steps.length} {lang === "zh-CN" ? "步" : "steps"}
              </span>
              <span className="text-zinc-600">
                {template.category}
              </span>
            </div>
          </div>

          {/* Mutation Warning */}
          {template.riskLevel === "low-mutation" && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-400/80">
                {lang === "zh-CN"
                  ? "此模板包含修改操作，将按左区自动模式设置执行：自动模式直接执行，监督/手动模式需确认。"
                  : "This template contains mutations and follows the left-panel mode: auto executes directly; supervised/manual modes require confirmation."}
              </div>
            </div>
          )}

          {/* Placeholders */}
          {template.placeholders && template.placeholders.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="text-xs font-semibold text-pink-300 flex items-center gap-1.5">
                {lang === "zh-CN" ? "填写参数" : "Fill Parameters"}
              </div>
              {template.placeholders.map((p) => (
                <div key={p.key} className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-zinc-400 flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-pink-500/10 border border-pink-500/20 rounded text-pink-300 font-mono text-xs">
                      {`{{${p.key}}}`}
                    </span>
                    {p.label}
                    {p.validate && (
                      <span className="text-zinc-600 text-xs">({p.validate})</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={placeholderValues[p.key] || ''}
                    onChange={(e) => {
                      setPlaceholderValues({ ...placeholderValues, [p.key]: e.target.value });
                      if (errors[p.key]) {
                        const newErrors = { ...errors };
                        delete newErrors[p.key];
                        setErrors(newErrors);
                      }
                    }}
                    placeholder={p.defaultValue || ''}
                    className={`px-3 py-2 bg-zinc-800 border rounded text-sm text-zinc-200 focus:outline-none transition-colors ${
                      errors[p.key]
                        ? "border-red-500 focus:border-red-500"
                        : "border-zinc-700 focus:border-pink-500"
                    }`}
                  />
                  {errors[p.key] && (
                    <div className="text-xs text-red-400">{errors[p.key]}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-zinc-500 text-center py-4">
              {lang === "zh-CN" ? "此模板无需参数，可直接重放" : "No parameters needed, ready to replay"}
            </div>
          )}

          {/* Steps Preview */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-800/20 p-3">
            <div className="text-xs font-semibold text-zinc-400 mb-2">
              {lang === "zh-CN" ? "执行步骤预览" : "Steps Preview"}
            </div>
            <div className="flex flex-col gap-1.5">
              {template.plan.steps.map((step, idx) => (
                <div key={step.id || idx} className="flex items-center gap-2 text-xs">
                  <span className="w-5 h-5 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-400 font-mono">
                    {idx + 1}
                  </span>
                  <span className="text-zinc-300">{step.title || step.action || `Step ${idx + 1}`}</span>
                </div>
              ))}
            </div>
          </div>
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
            onClick={handleReplay}
            className="px-4 py-2 text-xs font-semibold text-white bg-pink-600 hover:bg-pink-500 rounded flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition-all"
          >
            <Play className="w-3.5 h-3.5" />
            {lang === "zh-CN" ? "按当前模式继续" : "Continue by Mode"}
          </button>
        </div>
      </div>
    </div>
  );
};
