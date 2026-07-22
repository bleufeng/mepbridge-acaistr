// CopyElementsModal.tsx
// 复制构件交互式对话框组件（C.1.2，对接 D3 P2 CopyElements 8 步闭环）

import React, { useState, useEffect } from "react";
import { X, Copy, CheckCircle, AlertCircle } from "lucide-react";

interface CopyElementsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (params: CopyParams) => Promise<void>;
  lang: string;
}

interface CopyParams {
  x: number;
  y: number;
  z: number;
}

interface SelectionInfo {
  count: number;
  types: Record<string, number>;
  guids: string[];
}

export const CopyElementsModal: React.FC<CopyElementsModalProps> = ({
  isOpen,
  onClose,
  onExecute,
  lang
}) => {
  const [copyParams, setCopyParams] = useState<CopyParams>({ x: 3000, y: 0, z: 0 });
  const [inputStrings, setInputStrings] = useState<{ x: string; y: string; z: string }>({ x: '3000', y: '0', z: '0' });
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSelectionInfo();
      setCopyParams({ x: 3000, y: 0, z: 0 });
      setInputStrings({ x: '3000', y: '0', z: '0' });
      setDryRunResult(null);
    }
  }, [isOpen]);

  const loadSelectionInfo = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: {
            command: "API.ExecuteAddOnCommand",
            parameters: {
              addOnCommandId: { commandNamespace: "MEPBridge", commandName: "GetSelectedElements" },
              addOnCommandParameters: { onlyEditable: false, includeAabb: false, includeMepInfo: false }
            }
          }
        })
      });
      const data = await res.json();
      if (data.ok && data.response?.succeeded) {
        const resultData = data.response.result?.addOnCommandResponse || data.response.result;
        const elements = resultData?.elements || [];
        const typeCounts: Record<string, number> = {};
        const guids: string[] = [];
        elements.forEach((el: any) => {
          const type = el.type || el.elementType || "Unknown";
          typeCounts[type] = (typeCounts[type] || 0) + 1;
          if (el.guid) guids.push(el.guid);
        });
        setSelectionInfo({ count: elements.length, types: typeCounts, guids });
      }
    } catch (err) {
      console.error("Failed to load selection info:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!selectionInfo || selectionInfo.count === 0) {
      alert(lang === "zh-CN" ? "请先在 Archicad 中选择构件" : "Please select elements in Archicad first");
      return;
    }
    if (selectionInfo.count >= 10) {
      alert(lang === "zh-CN" ? "复制构件要求少于 10 个" : "CopyElements requires less than 10 elements");
      return;
    }
    setIsPreviewing(true);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: {
            command: "API.ExecuteAddOnCommand",
            parameters: {
              addOnCommandId: { commandNamespace: "MEPBridge", commandName: "CopyElements" },
              addOnCommandParameters: {
                sourceGuids: selectionInfo.guids,
                offsetMm: copyParams,
                dryRun: true,
                confirmRequired: false
              }
            }
          }
        })
      });
      const data = await res.json();
      setDryRunResult(data);
    } catch (err) {
      console.error("Preview failed:", err);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleExecute = async () => {
    setIsLoading(true);
    try {
      await onExecute(copyParams);
      onClose();
    } catch (err) {
      console.error("Execute failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  // 对指定轴施加增量（可正可负），并同步字符串显示
  const applyDelta = (axis: 'x' | 'y' | 'z', delta: number) => {
    const newVal = copyParams[axis] + delta;
    const newParams = { ...copyParams, [axis]: newVal };
    setCopyParams(newParams);
    setInputStrings({ x: String(newParams.x), y: String(newParams.y), z: String(newParams.z) });
    setDryRunResult(null);
  };

  const t = lang === "zh-CN" ? {
    title: "复制构件",
    currentSelection: "当前选择",
    elements: "个构件",
    copyParams: "复制偏移量",
    xDirection: "X 方向",
    yDirection: "Y 方向",
    zDirection: "Z 方向",
    mm: "mm",
    quickDirection: "快捷方向 (1000mm)",
    preview: "预览 (Dry-run)",
    warning: "此操作将在 Archicad 模型中复制选中构件",
    cancel: "取消",
    previewBtn: "预览",
    confirm: "确认执行",
    loading: "加载中...",
    limitWarning: "⚠️ 复制构件要求选择 1-9 个构件（当前: {count}）"
  } : {
    title: "Copy Elements",
    currentSelection: "Current Selection",
    elements: "elements",
    copyParams: "Copy Offset",
    xDirection: "X Direction",
    yDirection: "Y Direction",
    zDirection: "Z Direction",
    mm: "mm",
    quickDirection: "Quick Direction (1000mm)",
    preview: "Preview (Dry-run)",
    warning: "This operation will copy selected elements in Archicad model",
    cancel: "Cancel",
    previewBtn: "Preview",
    confirm: "Confirm",
    loading: "Loading...",
    limitWarning: "⚠️ CopyElements requires 1-9 elements selected (current: {count})"
  };

  const overLimit = selectionInfo && selectionInfo.count >= 10;
  const noSelection = !selectionInfo || selectionInfo.count === 0;

  // 统一渲染单轴输入行：[−] [输入框] [+]  (步进 100mm)
  const renderAxisInput = (axis: 'x' | 'y' | 'z', label: string) => (
    <div className="flex items-center gap-2">
      <label className="w-20 text-sm text-zinc-400">{label}</label>
      <button
        onClick={() => applyDelta(axis, -100)}
        className="px-2 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-sm text-zinc-300 transition-colors"
        title="-100mm"
      >
        −
      </button>
      <input
        type="text"
        value={inputStrings[axis]}
        onChange={(e) => {
          const val = e.target.value;
          if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
            setInputStrings({ ...inputStrings, [axis]: val });
            const numVal = val === '' || val === '-' ? 0 : parseFloat(val) || 0;
            setCopyParams({ ...copyParams, [axis]: numVal });
            setDryRunResult(null);
          }
        }}
        onBlur={() => setInputStrings({ ...inputStrings, [axis]: String(copyParams[axis]) })}
        className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-500 text-center"
      />
      <button
        onClick={() => applyDelta(axis, 100)}
        className="px-2 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-sm text-zinc-300 transition-colors"
        title="+100mm"
      >
        +
      </button>
      <span className="text-xs text-zinc-500 w-8">{t.mm}</span>
    </div>
  );

  // 6 个快捷方向按钮（步进 1000mm），与 MoveElementsModal 保持一致
  const quickDirections: Array<{ key: string; label: string; delta: Partial<CopyParams>; cls: string }> = [
    { key: 'up',    label: lang === "zh-CN" ? "↑ 上 (Z+)"   : "↑ Up (Z+)",    delta: { z:  1000 }, cls: "bg-emerald-600/20 hover:bg-emerald-600/30 border-emerald-500/30 text-emerald-300" },
    { key: 'front', label: lang === "zh-CN" ? "⬆ 前 (Y+)"   : "⬆ Front (Y+)", delta: { y:  1000 }, cls: "bg-zinc-700 hover:bg-zinc-600 border-zinc-600 text-zinc-300" },
    { key: 'down',  label: lang === "zh-CN" ? "↓ 下 (Z-)"   : "↓ Down (Z-)",  delta: { z: -1000 }, cls: "bg-emerald-600/20 hover:bg-emerald-600/30 border-emerald-500/30 text-emerald-300" },
    { key: 'left',  label: lang === "zh-CN" ? "⬅ 左 (X-)"   : "⬅ Left (X-)",  delta: { x: -1000 }, cls: "bg-zinc-700 hover:bg-zinc-600 border-zinc-600 text-zinc-300" },
    { key: 'back',  label: lang === "zh-CN" ? "⬇ 后 (Y-)"   : "⬇ Back (Y-)",  delta: { y: -1000 }, cls: "bg-zinc-700 hover:bg-zinc-600 border-zinc-600 text-zinc-300" },
    { key: 'right', label: lang === "zh-CN" ? "➡ 右 (X+)"   : "➡ Right (X+)", delta: { x:  1000 }, cls: "bg-zinc-700 hover:bg-zinc-600 border-zinc-600 text-zinc-300" }
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[500px] max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Copy className="w-5 h-5 text-amber-400" />
            {t.title}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded transition-colors">
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Current Selection */}
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3">
            <div className="text-sm font-semibold text-zinc-300 mb-2">
              📊 {t.currentSelection}: {selectionInfo?.count || 0} {t.elements}
            </div>
            {selectionInfo && selectionInfo.count > 0 && (
              <div className="text-xs text-zinc-400 pl-4">
                └─ {Object.entries(selectionInfo.types).map(([type, count]) => `${type}×${count}`).join(", ")}
              </div>
            )}
            {overLimit && (
              <div className="text-xs text-red-400 mt-2">
                {t.limitWarning.replace('{count}', String(selectionInfo?.count))}
              </div>
            )}
          </div>

          {/* Copy Parameters */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-zinc-300">📐 {t.copyParams}</div>
            {renderAxisInput('x', t.xDirection)}
            {renderAxisInput('y', t.yDirection)}
            {renderAxisInput('z', t.zDirection)}

            {/* Quick Direction Buttons - 1000mm step */}
            <div className="space-y-2 pt-2 border-t border-zinc-700">
              <div className="text-xs text-zinc-400">{t.quickDirection}:</div>
              <div className="grid grid-cols-3 gap-2">
                {quickDirections.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => applyDelta(
                      (Object.keys(d.delta)[0] as 'x' | 'y' | 'z'),
                      (Object.values(d.delta)[0] as number)
                    )}
                    className={`px-3 py-2 border rounded text-xs transition-colors ${d.cls}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Preview Results */}
          {dryRunResult && (
            <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-lg p-3 space-y-2">
              <div className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {t.preview}
              </div>
              <div className="text-xs text-zinc-400 font-mono">
                {dryRunResult.ok && dryRunResult.response?.succeeded
                  ? `✅ ${lang === "zh-CN" ? "Dry-run 成功，预览偏移: " : "Dry-run succeeded, offset: "}(${copyParams.x}, ${copyParams.y}, ${copyParams.z}) mm`
                  : `❌ ${dryRunResult.response?.result?.addOnCommandResponse?.error || dryRunResult.error || "Failed"}`
                }
              </div>
            </div>
          )}

          {/* Warning */}
          <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300">
            ⚠️ {t.warning}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-sm text-zinc-300 transition-colors"
          >
            {t.cancel}
          </button>
          <button
            onClick={handlePreview}
            disabled={isPreviewing || noSelection || overLimit}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 rounded text-sm text-white transition-colors disabled:opacity-50"
          >
            {isPreviewing ? t.loading : t.previewBtn}
          </button>
          <button
            onClick={handleExecute}
            disabled={isLoading || noSelection || overLimit}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 rounded text-sm font-semibold text-white transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <CheckCircle className="w-4 h-4" />
            {isLoading ? t.loading : t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CopyElementsModal;
