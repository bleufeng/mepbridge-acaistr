// MoveElementsModal.tsx
// 移动构件交互式对话框组件

import React, { useState, useEffect } from 'react';
import { X, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Eye, CheckCircle } from 'lucide-react';

interface MoveElementsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (params: MoveParams) => Promise<void>;
  lang: string;
}

interface MoveParams {
  x: number;
  y: number;
  z: number;
}

interface SelectionInfo {
  count: number;
  types: Record<string, number>;
  elements: any[];
}

interface AABBInfo {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export const MoveElementsModal: React.FC<MoveElementsModalProps> = ({
  isOpen,
  onClose,
  onExecute,
  lang
}) => {
  const [moveParams, setMoveParams] = useState<MoveParams>({ x: 0, y: 0, z: 0 });
  // 字符串显示值，解决负数输入问题（输入 "-" 时不会被重置为 0）
  const [inputStrings, setInputStrings] = useState<{ x: string; y: string; z: string }>({ x: '0', y: '0', z: '0' });
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Load selection info when modal opens
  useEffect(() => {
    if (isOpen) {
      loadSelectionInfo();
      setMoveParams({ x: 0, y: 0, z: 0 });
      setInputStrings({ x: '0', y: '0', z: '0' });
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
              addOnCommandParameters: {}
            }
          }
        })
      });
      const data = await res.json();

      if (data.ok && data.response?.succeeded) {
        const resultData = data.response.result?.addOnCommandResponse || data.response.result;
        const elements = resultData?.elements || resultData?.selectedElements || [];

        const typeCounts: Record<string, number> = {};
        elements.forEach((el: any) => {
          const type = el.type || el.elementType || "Unknown";
          typeCounts[type] = (typeCounts[type] || 0) + 1;
        });

        setSelectionInfo({
          count: elements.length,
          types: typeCounts,
          elements: elements
        });
      }
    } catch (err) {
      console.error("Failed to load selection info:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreview = async () => {
    setIsPreviewing(true);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: {
            command: "API.ExecuteAddOnCommand",
            parameters: {
              addOnCommandId: { commandNamespace: "MEPBridge", commandName: "MoveSelectedElements" },
              addOnCommandParameters: {
                useCurrentSelection: true,
                deltaMm: moveParams,
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
      await onExecute(moveParams);
      onClose();
    } catch (err) {
      console.error("Execute failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDirection = (direction: string) => {
    const step = 100; // 改为 100mm
    let newParams = { ...moveParams };
    switch (direction) {
      case 'up':
        newParams = { ...moveParams, z: moveParams.z + step };
        break;
      case 'down':
        newParams = { ...moveParams, z: moveParams.z - step };
        break;
      case 'left':
        newParams = { ...moveParams, x: moveParams.x - step };
        break;
      case 'right':
        newParams = { ...moveParams, x: moveParams.x + step };
        break;
    }
    setMoveParams(newParams);
    setInputStrings({ x: String(newParams.x), y: String(newParams.y), z: String(newParams.z) });
    // 清除预览结果，因为参数已改变
    setDryRunResult(null);
  };

  if (!isOpen) return null;

  const t = lang === "zh-CN" ? {
    title: "移动构件",
    currentSelection: "当前选择",
    elements: "个构件",
    selectionReading: "选集读取",
    moveParams: "移动参数",
    xDirection: "X 方向",
    yDirection: "Y 方向",
    zDirection: "Z 方向",
    mm: "mm",
    quickDirection: "或使用快捷方向",
    up: "向上",
    down: "向下",
    left: "向左",
    right: "向右",
    preview: "预览 (Dry-run)",
    beforeAABB: "Before AABB",
    plannedAfterAABB: "Planned After AABB",
    warning: "此操作将修改 Archicad 模型",
    cancel: "取消",
    previewBtn: "预览",
    confirm: "确认执行",
    loading: "加载中..."
  } : {
    title: "Move Elements",
    currentSelection: "Current Selection",
    elements: "elements",
    selectionReading: "Selection Reading",
    moveParams: "Move Parameters",
    xDirection: "X Direction",
    yDirection: "Y Direction",
    zDirection: "Z Direction",
    mm: "mm",
    quickDirection: "Quick Direction",
    up: "Up",
    down: "Down",
    left: "Left",
    right: "Right",
    preview: "Preview (Dry-run)",
    beforeAABB: "Before AABB",
    plannedAfterAABB: "Planned After AABB",
    warning: "This operation will modify Archicad model",
    cancel: "Cancel",
    previewBtn: "Preview",
    confirm: "Confirm",
    loading: "Loading..."
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[500px] max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-100">{t.title}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
          >
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
            {selectionInfo && (
              <div className="text-xs text-zinc-400 pl-4">
                └─ {t.selectionReading}: {Object.entries(selectionInfo.types).map(([type, count]) => `${type}×${count}`).join(", ")}
              </div>
            )}
          </div>

          {/* Move Parameters */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-zinc-300">📐 {t.moveParams}</div>

            {/* X Input */}
            <div className="flex items-center gap-2">
              <label className="w-20 text-sm text-zinc-400">{t.xDirection}</label>
              <button
                onClick={() => {
                  const newVal = moveParams.x - 100;
                  setMoveParams({ ...moveParams, x: newVal });
                  setInputStrings({ ...inputStrings, x: String(newVal) });
                  setDryRunResult(null);
                }}
                className="px-2 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-sm text-zinc-300 transition-colors"
              >
                −
              </button>
              <input
                type="text"
                value={inputStrings.x}
                onChange={(e) => {
                  const val = e.target.value;
                  // 允许空字符串、负号开头、或有效数字（含小数）
                  if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                    setInputStrings({ ...inputStrings, x: val });
                    const numVal = val === '' || val === '-' ? 0 : parseFloat(val) || 0;
                    setMoveParams({ ...moveParams, x: numVal });
                    setDryRunResult(null);
                  }
                }}
                onBlur={() => {
                  // 失去焦点时规范化显示（确保是有效数字）
                  setInputStrings({ ...inputStrings, x: String(moveParams.x) });
                }}
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500 text-center"
              />
              <button
                onClick={() => {
                  const newVal = moveParams.x + 100;
                  setMoveParams({ ...moveParams, x: newVal });
                  setInputStrings({ ...inputStrings, x: String(newVal) });
                  setDryRunResult(null);
                }}
                className="px-2 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-sm text-zinc-300 transition-colors"
              >
                +
              </button>
              <span className="text-xs text-zinc-500 w-8">{t.mm}</span>
            </div>

            {/* Y Input */}
            <div className="flex items-center gap-2">
              <label className="w-20 text-sm text-zinc-400">{t.yDirection}</label>
              <button
                onClick={() => {
                  const newVal = moveParams.y - 100;
                  setMoveParams({ ...moveParams, y: newVal });
                  setInputStrings({ ...inputStrings, y: String(newVal) });
                  setDryRunResult(null);
                }}
                className="px-2 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-sm text-zinc-300 transition-colors"
              >
                −
              </button>
              <input
                type="text"
                value={inputStrings.y}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                    setInputStrings({ ...inputStrings, y: val });
                    const numVal = val === '' || val === '-' ? 0 : parseFloat(val) || 0;
                    setMoveParams({ ...moveParams, y: numVal });
                    setDryRunResult(null);
                  }
                }}
                onBlur={() => {
                  setInputStrings({ ...inputStrings, y: String(moveParams.y) });
                }}
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500 text-center"
              />
              <button
                onClick={() => {
                  const newVal = moveParams.y + 100;
                  setMoveParams({ ...moveParams, y: newVal });
                  setInputStrings({ ...inputStrings, y: String(newVal) });
                  setDryRunResult(null);
                }}
                className="px-2 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-sm text-zinc-300 transition-colors"
              >
                +
              </button>
              <span className="text-xs text-zinc-500 w-8">{t.mm}</span>
            </div>

            {/* Z Input */}
            <div className="flex items-center gap-2">
              <label className="w-20 text-sm text-zinc-400">{t.zDirection}</label>
              <button
                onClick={() => {
                  const newVal = moveParams.z - 100;
                  setMoveParams({ ...moveParams, z: newVal });
                  setInputStrings({ ...inputStrings, z: String(newVal) });
                  setDryRunResult(null);
                }}
                className="px-2 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-sm text-zinc-300 transition-colors"
              >
                −
              </button>
              <input
                type="text"
                value={inputStrings.z}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
                    setInputStrings({ ...inputStrings, z: val });
                    const numVal = val === '' || val === '-' ? 0 : parseFloat(val) || 0;
                    setMoveParams({ ...moveParams, z: numVal });
                    setDryRunResult(null);
                  }
                }}
                onBlur={() => {
                  setInputStrings({ ...inputStrings, z: String(moveParams.z) });
                }}
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500 text-center"
              />
              <button
                onClick={() => {
                  const newVal = moveParams.z + 100;
                  setMoveParams({ ...moveParams, z: newVal });
                  setInputStrings({ ...inputStrings, z: String(newVal) });
                  setDryRunResult(null);
                }}
                className="px-2 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-sm text-zinc-300 transition-colors"
              >
                +
              </button>
              <span className="text-xs text-zinc-500 w-8">{t.mm}</span>
            </div>

            {/* Quick Direction Buttons - 1000mm step */}
            <div className="space-y-2 pt-2 border-t border-zinc-700">
              <div className="text-xs text-zinc-400">{lang === "zh-CN" ? "快捷方向 (1000mm):" : "Quick Direction (1000mm):"}</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    const newParams = { ...moveParams, z: moveParams.z + 1000 };
                    setMoveParams(newParams);
                    setInputStrings({ x: String(newParams.x), y: String(newParams.y), z: String(newParams.z) });
                    setDryRunResult(null);
                  }}
                  className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 rounded text-xs text-emerald-300 transition-colors"
                >
                  ↑ {lang === "zh-CN" ? "上 (Z+)" : "Up (Z+)"}
                </button>
                <button
                  onClick={() => {
                    const newParams = { ...moveParams, y: moveParams.y + 1000 };
                    setMoveParams(newParams);
                    setInputStrings({ x: String(newParams.x), y: String(newParams.y), z: String(newParams.z) });
                    setDryRunResult(null);
                  }}
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-xs text-zinc-300 transition-colors"
                >
                  ⬆ {lang === "zh-CN" ? "前 (Y+)" : "Front (Y+)"}
                </button>
                <button
                  onClick={() => {
                    const newParams = { ...moveParams, z: moveParams.z - 1000 };
                    setMoveParams(newParams);
                    setInputStrings({ x: String(newParams.x), y: String(newParams.y), z: String(newParams.z) });
                    setDryRunResult(null);
                  }}
                  className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 rounded text-xs text-emerald-300 transition-colors"
                >
                  ↓ {lang === "zh-CN" ? "下 (Z-)" : "Down (Z-)"}
                </button>

                <button
                  onClick={() => {
                    const newParams = { ...moveParams, x: moveParams.x - 1000 };
                    setMoveParams(newParams);
                    setInputStrings({ x: String(newParams.x), y: String(newParams.y), z: String(newParams.z) });
                    setDryRunResult(null);
                  }}
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-xs text-zinc-300 transition-colors"
                >
                  ⬅ {lang === "zh-CN" ? "左 (X-)" : "Left (X-)"}
                </button>
                <button
                  onClick={() => {
                    const newParams = { ...moveParams, y: moveParams.y - 1000 };
                    setMoveParams(newParams);
                    setInputStrings({ x: String(newParams.x), y: String(newParams.y), z: String(newParams.z) });
                    setDryRunResult(null);
                  }}
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-xs text-zinc-300 transition-colors"
                >
                  ⬇ {lang === "zh-CN" ? "后 (Y-)" : "Back (Y-)"}
                </button>
                <button
                  onClick={() => {
                    const newParams = { ...moveParams, x: moveParams.x + 1000 };
                    setMoveParams(newParams);
                    setInputStrings({ x: String(newParams.x), y: String(newParams.y), z: String(newParams.z) });
                    setDryRunResult(null);
                  }}
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 rounded text-xs text-zinc-300 transition-colors"
                >
                  ➡ {lang === "zh-CN" ? "右 (X+)" : "Right (X+)"}
                </button>
              </div>
            </div>
          </div>

          {/* Preview Results */}
          {dryRunResult && (
            <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-lg p-3 space-y-2">
              <div className="text-sm font-semibold text-indigo-300">🔍 {t.preview}</div>
              {dryRunResult.ok && dryRunResult.response?.succeeded && (
                <div className="text-xs text-zinc-400 space-y-1 font-mono">
                  {dryRunResult.response.result.addOnCommandResponse?.elements?.map((el: any, idx: number) => (
                    <div key={idx} className="space-y-1">
                      <div>{t.beforeAABB}:</div>
                      <div className="pl-4 text-zinc-500">
                        [{el.beforeAabb?.min.x.toFixed(1)}, {el.beforeAabb?.min.y.toFixed(1)}, {el.beforeAabb?.min.z.toFixed(1)}] →
                        [{el.beforeAabb?.max.x.toFixed(1)}, {el.beforeAabb?.max.y.toFixed(1)}, {el.beforeAabb?.max.z.toFixed(1)}]
                      </div>
                      <div className="text-emerald-400">{t.plannedAfterAABB}:</div>
                      <div className="pl-4 text-emerald-300">
                        [{el.plannedAfterAabb?.min.x.toFixed(1)}, {el.plannedAfterAabb?.min.y.toFixed(1)}, {el.plannedAfterAabb?.min.z.toFixed(1)}] →
                        [{el.plannedAfterAabb?.max.x.toFixed(1)}, {el.plannedAfterAabb?.max.y.toFixed(1)}, {el.plannedAfterAabb?.max.z.toFixed(1)}]
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
            disabled={isPreviewing}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 rounded text-sm text-white transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Eye className="w-4 h-4" />
            {isPreviewing ? t.loading : t.previewBtn}
          </button>
          <button
            onClick={handleExecute}
            disabled={isLoading}
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
