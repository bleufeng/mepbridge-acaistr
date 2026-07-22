// SimpleInputDialog.tsx
// 通用输入对话框 — 替代 AC 内嵌浏览器中不支持的 prompt()/confirm()
// 支持显示当前选择集信息（构件分类汇总）
import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

interface SelectionInfo {
  count: number;
  types: Record<string, number>;
}

interface SimpleInputDialogProps {
  isOpen: boolean;
  title: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  options?: string[];
  confirmText?: string;
  cancelText?: string;
  isConfirm?: boolean; // true 时只确认（无输入框）
  selectionInfo?: SelectionInfo | null; // 选择集信息（分类汇总）
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export const SimpleInputDialog: React.FC<SimpleInputDialogProps> = ({
  isOpen,
  title,
  label,
  defaultValue = "",
  placeholder = "",
  options,
  confirmText = "确认",
  cancelText = "取消",
  isConfirm = false,
  selectionInfo,
  onConfirm,
  onCancel
}) => {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (isOpen) setValue(defaultValue);
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[420px]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button onClick={onCancel} className="p-1 hover:bg-zinc-800 rounded transition-colors">
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* 选择集信息（构件分类汇总） */}
          {selectionInfo && (
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-2.5">
              <div className="text-xs font-semibold text-zinc-300 mb-1">
                📊 {selectionInfo.count > 0
                  ? `已选中 ${selectionInfo.count} 个构件`
                  : "未选中任何构件"}
              </div>
              {selectionInfo.count > 0 && Object.keys(selectionInfo.types).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(selectionInfo.types).map(([type, count]) => (
                    <span
                      key={type}
                      className="inline-block px-1.5 py-0.5 bg-zinc-700/60 rounded text-[10px] text-zinc-300"
                    >
                      {type} ×{count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 输入区 */}
          {!isConfirm && (
            <>
              <label className="block text-xs text-zinc-400">{label}</label>
              {options ? (
                <select
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-500"
                >
                  {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder={placeholder}
                  autoFocus
                  className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-500"
                />
              )}
            </>
          )}
          {isConfirm && (
            <p className="text-sm text-zinc-300">{label}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-zinc-800">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs text-zinc-300 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => onConfirm(value)}
            disabled={selectionInfo && selectionInfo.count === 0}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded text-xs text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
