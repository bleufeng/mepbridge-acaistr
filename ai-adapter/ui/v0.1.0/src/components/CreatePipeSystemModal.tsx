// CreatePipeSystemModal.tsx
// 创建管道系统（主管+支管）对话框组件 — D4 V2 MEP Water 模块

import React, { useState } from 'react';
import { X, Eye, CheckCircle, Plus, Trash2 } from 'lucide-react';

interface Point3D { x: number; y: number; z: number; }

interface BranchDef {
  tapPoint: Point3D;
  endPoint: Point3D;
  diameterMm?: number;
}

interface CreatePipeSystemParams {
  mainWaypoints: Point3D[];
  branches: BranchDef[];
  diameterMm: number;
  mepSystemName: string;
}

interface CreatePipeSystemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (params: CreatePipeSystemParams) => Promise<void>;
  lang: string;
}

export const CreatePipeSystemModal: React.FC<CreatePipeSystemModalProps> = ({
  isOpen,
  onClose,
  onExecute,
  lang
}) => {
  const [params, setParams] = useState<CreatePipeSystemParams>({
    mainWaypoints: [
      { x: 0, y: 0, z: 3 },
      { x: 5, y: 0, z: 3 }
    ],
    branches: [],
    diameterMm: 22,
    mepSystemName: 'DomesticHotWater'
  });
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);

  // Helper to update a waypoint coordinate
  const updateMainWP = (idx: number, axis: keyof Point3D, val: number) => {
    setParams(prev => ({
      ...prev,
      mainWaypoints: prev.mainWaypoints.map((wp, i) =>
        i === idx ? { ...wp, [axis]: val } : wp
      )
    }));
  };

  const addMainWaypoint = () => {
    const last = params.mainWaypoints[params.mainWaypoints.length - 1];
    setParams(prev => ({
      ...prev,
      mainWaypoints: [...prev.mainWaypoints, { x: last.x + 2, y: last.y, z: last.z }]
    }));
  };

  const removeMainWaypoint = (idx: number) => {
    if (params.mainWaypoints.length <= 2) return;
    setParams(prev => ({
      ...prev,
      mainWaypoints: prev.mainWaypoints.filter((_, i) => i !== idx)
    }));
  };

  const addBranch = () => {
    const tapIdx = Math.max(0, Math.floor(params.mainWaypoints.length / 2));
    const tap = params.mainWaypoints[tapIdx];
    setParams(prev => ({
      ...prev,
      branches: [...prev.branches, {
        tapPoint: { ...tap },
        endPoint: { x: tap.x, y: tap.y + 2, z: tap.z }
      }]
    }));
  };

  const removeBranch = (idx: number) => {
    setParams(prev => ({ ...prev, branches: prev.branches.filter((_, i) => i !== idx) }));
  };

  const updateBranch = (bIdx: number, field: string, axis: keyof Point3D | null, val: any) => {
    setParams(prev => ({
      ...prev,
      branches: prev.branches.map((b, i) => {
        if (i !== bIdx) return b;
        if (field === 'diameterMm') return { ...b, [field]: Number(val) };
        if (field === 'tapPoint' || field === 'endPoint')
          return { ...b, [field]: { ...(b as any)[field], [axis!]: Number(val) } };
        return b;
      })
    }));
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
              addOnCommandId: { commandNamespace: "MEPBridge", commandName: "CreatePipeSystem" },
              addOnCommandParameters: {
                mainRoute: {
                  waypoints: params.mainWaypoints,
                  diameterMm: params.diameterMm
                },
                branches: params.branches.map(b => ({
                  tapPoint: b.tapPoint,
                  endPoint: b.endPoint,
                  diameterMm: b.diameterMm ?? params.diameterMm
                })),
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
    title: "创建管道系统",
    mainRoute: "主管路由点",
    branches: "支管",
    addBranch: "+ 添加支管",
    addPoint: "+ 添加节点",
    diameter: "主管径",
    mm: "mm",
    system: "MEP 系统",
    tapPoint: "接入点",
    endPoint: "终点",
    branchDia: "支管径",
    unit: "(米)",
    preview: "预览 (Dry-run)",
    warning: "此操作将创建多条 MEP 管道，需用户确认",
    cancel: "取消",
    previewBtn: "预览",
    confirm: "确认执行",
    loading: "加载中..."
  } : {
    title: "Create Pipe System",
    mainRoute: "Main Route Waypoints",
    branches: "Branches",
    addBranch: "+ Add Branch",
    addPoint: "+ Add Waypoint",
    diameter: "Main Diameter",
    mm: "mm",
    system: "MEP System",
    tapPoint: "Tap Point",
    endPoint: "End Point",
    branchDia: "Branch Dia",
    unit: "(m)",
    preview: "Preview (Dry-run)",
    warning: "This will create multiple MEP pipes, requires confirmation",
    cancel: "Cancel",
    previewBtn: "Preview",
    confirm: "Confirm",
    loading: "Loading..."
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[600px] max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 sticky top-0 bg-zinc-900 z-10">
          <h2 className="text-lg font-semibold text-cyan-300">💧 {t.title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded transition-colors">
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Main Route */}
          <div className="bg-zinc-800/50 border border-cyan-500/20 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-cyan-300">🛤️ {t.mainRoute} ({params.mainWaypoints.length})</div>
              <button onClick={addMainWaypoint}
                className="px-2 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 rounded text-xs text-cyan-300 transition-colors">
                {t.addPoint}
              </button>
            </div>
            {params.mainWaypoints.map((wp, idx) => (
              <div key={`wp-${idx}`} className="flex items-center gap-2 bg-zinc-900/60 rounded p-2">
                <span className="text-xs font-bold text-cyan-400 min-w-[20px]">#{idx + 1}</span>
                {(['x', 'y', 'z'] as const).map(axis => (
                  <React.Fragment key={axis}>
                    <span className="text-xs text-zinc-500 w-3">{axis.toUpperCase()}</span>
                    <input type="number" step="0.01" value={wp[axis]}
                      onChange={e => updateMainWP(idx, axis, parseFloat(e.target.value) || 0)}
                      className="w-16 bg-zinc-700 border border-zinc-600 rounded px-1.5 py-1 text-xs text-zinc-200 outline-none focus:border-cyan-500" />
                  </React.Fragment>
                ))}
                <span className="text-xs text-zinc-600 ml-1">{t.unit}</span>
                {params.mainWaypoints.length > 2 && (
                  <button onClick={() => removeMainWaypoint(idx)}
                    className="ml-auto p-1 hover:bg-red-900/30 rounded transition-colors">
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Global Parameters */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-2">
              <label className="text-sm font-semibold text-zinc-300">{t.diameter} ({t.mm})</label>
              <select value={params.diameterMm}
                onChange={e => setParams(p => ({ ...p, diameterMm: Number(e.target.value) }))}
                className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-cyan-500">
                {[15, 18, 20, 22, 25, 28, 32, 35, 40, 42, 50, 54, 63, 70, 75].map(d => (
                  <option key={d} value={d}>DN{d} ({d})</option>
                ))}
              </select>
            </div>
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 space-y-2">
              <label className="text-sm font-semibold text-zinc-300">{t.system}</label>
              <input type="text" value={params.mepSystemName}
                onChange={e => setParams(p => ({ ...p, mepSystemName: e.target.value }))}
                className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-cyan-500"
                placeholder="DomesticHotWater / Cold" />
            </div>
          </div>

          {/* Branches */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-violet-300">🔀 {t.branches} ({params.branches.length})</div>
              <button onClick={addBranch}
                className="px-2 py-1 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 rounded text-xs text-violet-300 transition-colors">
                <Plus className="w-3 h-3 inline mr-1" /> {t.addBranch}
              </button>
            </div>
            {params.branches.map((branch, bIdx) => (
              <div key={`br-${bIdx}`} className="bg-zinc-800/50 border border-violet-500/15 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-violet-400">⌖ 支管 #{bIdx + 1}</span>
                  <button onClick={() => removeBranch(bIdx)} className="p-1 hover:bg-red-900/30 rounded">
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {/* Tap Point */}
                  <div className="space-y-1">
                    <div className="text-xs text-zinc-400">{t.tapPoint}</div>
                    <div className="flex gap-1">
                      {(['x', 'y', 'z'] as const).map(axis => (
                        <React.Fragment key={`bt-${axis}`}>
                          <span className="text-[10px] text-zinc-600 w-2">{axis.toUpperCase()}</span>
                          <input type="number" step="0.01" value={branch.tapPoint[axis]}
                            onChange={e => updateBranch(bIdx, 'tapPoint', axis, e.target.value)}
                            className="w-12 bg-zinc-700 border border-zinc-600 rounded px-1 py-0.5 text-[11px] text-zinc-200 outline-none focus:border-violet-500" />
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                  {/* End Point */}
                  <div className="space-y-1">
                    <div className="text-xs text-zinc-400">{t.endPoint}</div>
                    <div className="flex gap-1">
                      {(['x', 'y', 'z'] as const).map(axis => (
                        <React.Fragment key={`be-${axis}`}>
                          <span className="text-[10px] text-zinc-600 w-2">{axis.toUpperCase()}</span>
                          <input type="number" step="0.01" value={branch.endPoint[axis]}
                            onChange={e => updateBranch(bIdx, 'endPoint', axis, e.target.value)}
                            className="w-12 bg-zinc-700 border border-zinc-600 rounded px-1 py-0.5 text-[11px] text-zinc-200 outline-none focus:border-violet-500" />
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <label className="text-xs text-zinc-400">{t.branchDia}:</label>
                  <select value={branch.diameterMm ?? params.diameterMm}
                    onChange={e => updateBranch(bIdx, 'diameterMm', null, e.target.value)}
                    className="bg-zinc-700 border border-zinc-600 rounded px-1.5 py-0.5 text-[11px] text-zinc-200">
                    {[15, 18, 20, 22, 25, 28, 32, 35, 40, 42, 50, 54, 63].map(d => (
                      <option key={d} value={d}>{t.mm}: {d}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>

          {/* Preview Result */}
          {dryRunResult && (
            <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-lg p-3 space-y-1">
              <div className="text-sm font-semibold text-indigo-300 flex items-center gap-1">
                <Eye className="w-4 h-4" /> {t.preview}
              </div>
              <pre className="text-xs text-zinc-400 overflow-auto max-h-[120px] whitespace-pre-wrap">
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
        <div className="flex items-center justify-end gap-3 p-4 border-t border-zinc-800 sticky bottom-0 bg-zinc-900">
          <button onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-sm text-zinc-300 transition-colors">
            {t.cancel}
          </button>
          <button onClick={handlePreview} disabled={isPreviewing}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 rounded text-sm text-white transition-colors disabled:opacity-50 flex items-center gap-2">
            <Eye className="w-4 h-4" /> {isPreviewing ? t.loading : t.previewBtn}
          </button>
          <button onClick={handleExecute} disabled={isLoading}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 border border-cyan-500 rounded text-sm font-semibold text-white transition-colors disabled:opacity-50 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> {isLoading ? t.loading : t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
};
