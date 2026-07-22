// CreateDuctModal.tsx
// 创建风管对话框组件 — D5 V2 MEP Ventilation 模块

import React, { useState } from 'react';
import { X, Eye, CheckCircle } from 'lucide-react';

interface Point3D { x: number; y: number; z: number; }

interface CreateDuctParams {
  start: Point3D;
  end: Point3D;
  widthMm: number;
  heightMm: number;
  mepSystemName: string;
}

interface CreateDuctModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (params: CreateDuctParams) => Promise<void>;
  lang: string;
}

export const CreateDuctModal: React.FC<CreateDuctModalProps> = ({
  isOpen,
  onClose,
  onExecute,
  lang
}) => {
  const [params, setParams] = useState<CreateDuctParams>({
    start: { x: 0, y: 0, z: 3.2 },
    end:   { x: 6, y: 0, z: 3.2 },
    widthMm: 300,
    heightMm: 200,
    mepSystemName: 'SupplyAir'
  });
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);

  const updateStart = (axis: keyof Point3D, val: number) =>
    setParams(p => ({ ...p, start: { ...p.start, [axis]: val } }));
  const updateEnd = (axis: keyof Point3D, val: number) =>
    setParams(p => ({ ...p, end: { ...p.end, [axis]: val } }));

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
              addOnCommandId: { commandNamespace: "MEPBridge", commandName: "CreateDuct" },
              addOnCommandParameters: {
                waypoints: [params.start, params.end],
                width: params.widthMm / 1000,
                height: params.heightMm / 1000,
                crossSection: { shape: "Rectangular" },
                mepSystemName: params.mepSystemName,
                dryRun: true,
                confirmRequired: false
              }
            }
          }
        })
      });
      setDryRunResult(await res.json());
    } catch (err) {
      console.error("Preview failed:", err);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleExecute = async () => {
    setIsLoading(true);
    try {
      await onExecute(params);
      onClose();
    } catch (err) {
      console.error("Execute failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const t = lang === "zh-CN" ? {
    title: "创建风管",
    startPoint: "起点",
    endPoint: "终点",
    unit: "(米)",
    width: "宽度",
    height: "高度",
    mm: "(mm)",
    system: "MEP 系统",
    shape: "截面形状",
    preview: "预览 (Dry-run)",
    warning: "此操作将在 Archicad 中创建风管构件，需用户确认",
    cancel: "取消",
    previewBtn: "预览",
    confirm: "确认执行",
    loading: "加载中...",
    x: "X", y: "Y", z: "Z"
  } : {
    title: "Create Duct",
    startPoint: "Start Point",
    endPoint: "End Point",
    unit: "(m)",
    width: "Width",
    height: "Height",
    mm: "(mm)",
    system: "MEP System",
    shape: "Cross Section",
    preview: "Preview (Dry-run)",
    warning: "This will create a duct element in Archicad, requires confirmation",
    cancel: "Cancel",
    previewBtn: "Preview",
    confirm: "Confirm",
    loading: "Loading...",
    x: "X", y: "Y", z: "Z"
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[520px] max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-violet-300">🌪️ {t.title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded transition-colors">
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Start Point */}
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-2">
            <div className="text-sm font-semibold text-violet-300">{t.startPoint} {t.unit}</div>
            <div className="grid grid-cols-3 gap-2">
              {[['x', params.start.x], ['y', params.start.y], ['z', params.start.z]].map(([axis, v]) => (
                <div key={axis} className="flex items-center gap-1">
                  <span className="text-xs text-zinc-500 w-3">{axis.toUpperCase()}</span>
                  <input type="number" step="0.01" value={v}
                    onChange={e => updateStart(axis as keyof Point3D, parseFloat(e.target.value) || 0)}
                    className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-violet-500" />
                </div>
              ))}
            </div>
          </div>

          {/* End Point */}
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-2">
            <div className="text-sm font-semibold text-violet-300">{t.endPoint} {t.unit}</div>
            <div className="grid grid-cols-3 gap-2">
              {[['x', params.end.x], ['y', params.end.y], ['z', params.end.z]].map(([axis, v]) => (
                <div key={axis} className="flex items-center gap-1">
                  <span className="text-xs text-zinc-500 w-3">{axis.toUpperCase()}</span>
                  <input type="number" step="0.01" value={v}
                    onChange={e => updateEnd(axis as keyof Point3D, parseFloat(e.target.value) || 0)}
                    className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-violet-500" />
                </div>
              ))}
            </div>
          </div>

          {/* Duct Parameters - Rectangular Cross Section */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-2">
              <label className="text-sm font-semibold text-zinc-300">{t.width} {t.mm}</label>
              <input type="number" step="10" min="50" max="2000" value={params.widthMm}
                onChange={e => setParams(p => ({ ...p, widthMm: Number(e.target.value) || 0 }))}
                className="w-full bg-zinc-700 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-500"
                placeholder="e.g. 300" />
            </div>

            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-2">
              <label className="text-sm font-semibold text-zinc-300">{t.height} {t.mm}</label>
              <input type="number" step="10" min="50" max="2000" value={params.heightMm}
                onChange={e => setParams(p => ({ ...p, heightMm: Number(e.target.value) || 0 }))}
                className="w-full bg-zinc-700 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-500"
                placeholder="e.g. 200" />
            </div>
          </div>

          {/* Common sizes preset */}
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-2">
            <label className="text-xs font-medium text-zinc-400">{lang === "zh-CN" ? "常用尺寸预设" : "Common Size Presets"}</label>
            <div className="flex flex-wrap gap-1.5">
              {[
                { w: 150, h: 150 }, { w: 200, h: 120 }, { w: 250, h: 150 },
                { w: 300, h: 200 }, { w: 350, h: 220 }, { w: 400, h: 250 },
                { w: 500, h: 250 }, { w: 500, h: 300 }
              ].map(size => (
                <button key={`${size.w}x${size.h}`} onClick={() => setParams(p => ({ ...p, widthMm: size.w, heightMm: size.h }))}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${
                    params.widthMm === size.w && params.heightMm === size.h
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-700 text-zinc-300 hover:bg-violet-900/40'
                  }`}>
                  {size.w}x{size.h}
                </button>
              ))}
            </div>
          </div>

          {/* System Name */}
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-2">
            <label className="text-sm font-semibold text-zinc-300">{t.system}</label>
            <input type="text" value={params.mepSystemName}
              onChange={e => setParams(p => ({ ...p, mepSystemName: e.target.value }))}
              className="w-full bg-zinc-700 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-500"
              placeholder="SupplyAir / ReturnAir / ExhaustAir / FreshAir" />
          </div>

          {/* Preview Result */}
          {dryRunResult && (
            <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-lg p-3 space-y-1">
              <div className="text-sm font-semibold text-indigo-300 flex items-center gap-1">
                <Eye className="w-4 h-4" /> {t.preview}
              </div>
              <pre className="text-xs text-zinc-400 overflow-auto max-h-[150px] whitespace-pre-wrap">
                {JSON.stringify(dryRunResult, null, 2)}
              </pre>
            </div>
          )}

          {/* Warning */}
          <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300">
            ⚠️ {t.warning}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-zinc-800">
          <button onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-sm text-zinc-300 transition-colors">
            {t.cancel}
          </button>
          <button onClick={handlePreview} disabled={isPreviewing}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 rounded text-sm text-white transition-colors disabled:opacity-50 flex items-center gap-2">
            <Eye className="w-4 h-4" /> {isPreviewing ? t.loading : t.previewBtn}
          </button>
          <button onClick={handleExecute} disabled={isLoading}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 border border-violet-500 rounded text-sm font-semibold text-white transition-colors disabled:opacity-50 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> {isLoading ? t.loading : t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
};
