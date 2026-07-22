// EditBuildingElementPanel.tsx
// 建筑构件编辑面板 — BASE 模式 BUILDING 模块
// 支持单个和批量编辑 12 种构件：Wall/Column/Beam/Slab/Door/Window/Roof/Stair/Object/Lamp/Mesh/Zone
// 工作流：选择目标 → 构件列表 → 编辑属性 → 应用 → 回读校验

import React, { useState, useCallback } from 'react';
import {
  Layers, Box, Minus, Square, DoorOpen, AppWindow, Triangle,
  TrendingUp, Armchair, Lightbulb, Mountain, Grid3x3,
  ChevronDown, Loader, CheckCircle, AlertTriangle
} from 'lucide-react';

type ElementType = 'Wall' | 'Column' | 'Beam' | 'Slab' | 'Door' | 'Window' | 'Roof' | 'Stair' | 'Object' | 'Lamp' | 'Mesh' | 'Zone';

interface ElementInfo {
  guid: string;
  type: string;
  floorIndex: number;
  layerName?: string;
}

interface EditParams {
  thickness?: number; height?: number; width?: number; length?: number;
  level?: number; floorIndex?: number; layerName?: string;
  sectionWidth?: number; sectionDepth?: number;
  pitchAngle?: number; baseLevel?: number;
  refPos?: number; sillHeight?: number;
  totalHeight?: number; stepNum?: number; flightWidth?: number; treadDepth?: number;
  angle?: number; libPartName?: string;
  zoneName?: string; zoneCategory?: string;
}

interface Props {
  onExecute: (commandName: string, params: any) => Promise<void>;
  lang: string;
  mepbridgeConnected: boolean;
  currentFloorIndex?: number;
}

const ELEMENT_CONFIG: Record<ElementType, { icon: React.ReactNode; zhName: string; enName: string; commandName: string }> = {
  Wall:    { icon: <Layers className="w-4 h-4" />,     zhName: '墙',   enName: 'Wall',    commandName: 'ChangeElementGeometry' },
  Column:  { icon: <Box className="w-4 h-4" />,       zhName: '柱',   enName: 'Column',  commandName: 'ChangeElementGeometry' },
  Beam:    { icon: <Minus className="w-4 h-4" />,     zhName: '梁',   enName: 'Beam',    commandName: 'ChangeElementGeometry' },
  Slab:    { icon: <Square className="w-4 h-4" />,    zhName: '板',   enName: 'Slab',    commandName: 'ChangeElementGeometry' },
  Door:    { icon: <DoorOpen className="w-4 h-4" />,  zhName: '门',   enName: 'Door',    commandName: 'ChangeOpeningGeometry' },
  Window:  { icon: <AppWindow className="w-4 h-4" />, zhName: '窗',   enName: 'Window',  commandName: 'ChangeOpeningGeometry' },
  Roof:    { icon: <Triangle className="w-4 h-4" />,  zhName: '屋顶', enName: 'Roof',    commandName: 'ChangeElementGeometry' },
  Stair:   { icon: <TrendingUp className="w-4 h-4" />,zhName: '楼梯', enName: 'Stair',   commandName: 'ChangeStairGeometry' },
  Object:  { icon: <Armchair className="w-4 h-4" />,  zhName: '对象', enName: 'Object',  commandName: 'ChangeElementGeometry' },
  Lamp:    { icon: <Lightbulb className="w-4 h-4" />, zhName: '灯具', enName: 'Lamp',    commandName: 'ChangeElementGeometry' },
  Mesh:    { icon: <Mountain className="w-4 h-4" />,  zhName: '地形', enName: 'Mesh',    commandName: 'ChangeElementGeometry' },
  Zone:    { icon: <Grid3x3 className="w-4 h-4" />,   zhName: '区域', enName: 'Zone',    commandName: 'ChangeElementGeometry' },
};

const LAYER_PATTERNS: Record<string, string[]> = {
  exterior: ['外墙', 'EXT', 'EXTERIOR', '外'],
  interior: ['内墙', 'INT', 'INTERIOR', '内'],
  bearing: ['承重', 'BEAR', 'STRUCT', '结构'],
  main: ['主梁', 'MAIN', '主'],
  secondary: ['次梁', 'SEC', '次'],
};

function matchLayer(name: string | undefined, patterns: string[]): boolean {
  if (!name) return false;
  const u = name.toUpperCase();
  return patterns.some(p => u.includes(p.toUpperCase()));
}

async function callCmd(commandName: string, params: any): Promise<any> {
  const res = await fetch("/api/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: { command: "API.ExecuteAddOnCommand", parameters: { addOnCommandId: { commandNamespace: "MEPBridge", commandName }, addOnCommandParameters: params } } })
  });
  return res.json();
}

const NumInput: React.FC<{ label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number; placeholder?: string }> = ({ label, value, onChange, step = 0.01, placeholder }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] text-zinc-500 font-mono uppercase">{label}</label>
    <input type="number" step={step} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} placeholder={placeholder || '不修改'} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono outline-none focus:border-orange-500" />
  </div>
);

const TxtInput: React.FC<{ label: string; value: string | undefined; onChange: (v: string | undefined) => void; placeholder?: string }> = ({ label, value, onChange, placeholder }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] text-zinc-500 font-mono uppercase">{label}</label>
    <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)} placeholder={placeholder || '不修改'} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono outline-none focus:border-orange-500" />
  </div>
);

export const EditBuildingElementPanel: React.FC<Props> = ({ onExecute, lang, mepbridgeConnected, currentFloorIndex }) => {
  const zh = lang === 'zh-CN';
  const [selType, setSelType] = useState<ElementType>('Wall');
  const [elements, setElements] = useState<ElementInfo[]>([]);
  const [selGuids, setSelGuids] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [editParams, setEditParams] = useState<EditParams>({});
  const [applying, setApplying] = useState(false);
  const [report, setReport] = useState<any[]>([]);
  const [showSel, setShowSel] = useState(true);  // 默认展开选择面板

  const config = ELEMENT_CONFIG[selType];

  const loadByType = useCallback(async (type: ElementType) => {
    setLoading(true);
    try {
      const r = await callCmd('GetElementsByType', { elementType: type, includeAabb: false });
      const resp = r?.response?.result?.addOnCommandResponse || r?.result?.addOnCommandResponse || r?.result;
      const elemsData = resp?.elements || [];
      const elems: ElementInfo[] = elemsData.map((e: any) => ({ guid: e.guid, type: e.type, floorIndex: e.floorIndex, layerName: e.layerName }));
      setElements(elems);
      setSelGuids(new Set(elems.map(e => e.guid)));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  const loadSelected = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callCmd('GetSelectedElements', { includeAabb: false });
      const resp = r?.response?.result?.addOnCommandResponse || r?.result?.addOnCommandResponse || r?.result;
      const elemsData = resp?.elements || [];
      const elems: ElementInfo[] = elemsData.filter((e: any) => e.type !== 'MEPRoute').map((e: any) => ({ guid: e.guid, type: e.type, floorIndex: e.floorIndex, layerName: e.layerName }));
      setElements(elems);
      setSelGuids(new Set(elems.map(e => e.guid)));
      if (elems.length > 0) { const t = elems[0].type as ElementType; if (ELEMENT_CONFIG[t]) setSelType(t); }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  const filterLayer = (pattern: keyof typeof LAYER_PATTERNS) => {
    const ps = LAYER_PATTERNS[pattern];
    setSelGuids(new Set(elements.filter(e => matchLayer(e.layerName, ps)).map(e => e.guid)));
  };

  const filterFloor = () => {
    if (currentFloorIndex === undefined) return;
    setSelGuids(new Set(elements.filter(e => e.floorIndex === currentFloorIndex).map(e => e.guid)));
  };

  const switchType = (t: ElementType) => {
    setSelType(t);
    setElements([]);
    setSelGuids(new Set());
    setReport([]);
    setEditParams({});
    setShowSel(true);  // 切换类型后展开选择面板，让用户选择加载方式
  };

  const toggleGuid = (g: string) => { const n = new Set(selGuids); n.has(g) ? n.delete(g) : n.add(g); setSelGuids(n); };

  const buildParams = (guid: string, dryRun: boolean): any => {
    const cmd = config.commandName;
    if (cmd === 'ChangeElementGeometry') {
      const p: any = { elementGuid: guid, dryRun, confirmRequired: !dryRun };
      if (editParams.thickness !== undefined) p.thickness = editParams.thickness;
      if (editParams.height !== undefined) p.height = editParams.height;
      return p;
    } else if (cmd === 'ChangeOpeningGeometry') {
      const p: any = { elementGuid: guid, dryRun, confirmRequired: !dryRun };
      if (editParams.width !== undefined) p.width = editParams.width;
      if (editParams.height !== undefined) p.height = editParams.height;
      if (editParams.refPos !== undefined) p.refPos = editParams.refPos;
      if (editParams.sillHeight !== undefined) p.sillHeight = editParams.sillHeight;
      return p;
    } else if (cmd === 'ChangeStairGeometry') {
      const p: any = { elementGuid: guid, dryRun, confirmRequired: !dryRun };
      if (editParams.totalHeight !== undefined) p.totalHeight = editParams.totalHeight;
      if (editParams.stepNum !== undefined) p.stepNum = editParams.stepNum;
      if (editParams.flightWidth !== undefined) p.flightWidth = editParams.flightWidth;
      if (editParams.treadDepth !== undefined) p.treadDepth = editParams.treadDepth;
      return p;
    }
    return { elementGuid: guid, dryRun, confirmRequired: !dryRun };
  };

  const handleApply = async () => {
    const guids: string[] = Array.from(selGuids);
    if (guids.length === 0) return;
    setApplying(true); setReport([]);
    const results: any[] = [];
    for (const guid of guids) {
      try {
        const r = await callCmd(config.commandName as string, buildParams(guid, false));
        const resp = r?.response?.result?.addOnCommandResponse || r?.result?.addOnCommandResponse || r?.result;
        const ok = (r?.ok || r?.response?.succeeded) && resp?.status === 'ok';
        const elem = elements.find(e => e.guid === guid);
        results.push({ guid, layerName: elem?.layerName, status: ok ? 'success' : 'failed', detail: ok ? resp : (r?.error || r?.response?.error || resp) });
      } catch (e: any) { results.push({ guid, status: 'failed', detail: e.message }); }
    }
    setReport(results); setApplying(false);
  };

  const uniqueLayers = Array.from(new Set(elements.map(e => e.layerName).filter(Boolean))) as string[];

  return (
    <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3 shadow-lg flex flex-col gap-2.5">
      <h3 className="text-xs font-semibold font-display tracking-wider uppercase text-orange-300 flex items-center gap-2 border-b border-orange-500/20 pb-2">
        <Layers className="w-4 h-4 text-orange-400" />
        {zh ? 'BUILDING 建筑构件编辑' : 'BUILDING Element Editor'}
      </h3>

      {/* 构件类型选择器 */}
      <div className="grid grid-cols-4 gap-1.5">
        {(Object.keys(ELEMENT_CONFIG) as ElementType[]).map(t => {
          const c = ELEMENT_CONFIG[t]; const active = selType === t;
          return <button key={t} onClick={() => switchType(t)} className={`flex items-center gap-1 px-1.5 py-1.5 rounded text-[10px] font-mono font-medium transition-all border ${active ? 'bg-orange-600/20 border-orange-500/50 text-orange-300' : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'}`}>{c.icon}{zh ? c.zhName : c.enName}</button>;
        })}
      </div>

      {/* 选择目标 */}
      <div className="flex flex-col gap-1.5">
        <button onClick={() => setShowSel(!showSel)} className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 hover:border-zinc-600">
          <span className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-orange-400" />{zh ? '选择目标' : 'Select Target'}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSel ? 'rotate-180' : ''}`} />
        </button>
        {showSel && (
          <div className="bg-zinc-800/80 border border-zinc-700 rounded p-2 space-y-1">
            <button onClick={() => { loadSelected(); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-zinc-300">{zh ? '当前选中' : 'Current Selection'}</button>
            <button onClick={() => { loadByType(selType); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-zinc-300">{zh ? `所有${config.zhName}` : `All ${config.enName}s`}</button>
            {currentFloorIndex !== undefined && elements.length > 0 && <button onClick={() => { filterFloor(); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-zinc-300">{zh ? `当前楼层 (${currentFloorIndex})` : `Current Floor (${currentFloorIndex})`}</button>}
            {selType === 'Wall' && elements.length > 0 && (<>
              <div className="border-t border-zinc-700 my-1"></div>
              <button onClick={() => { filterLayer('exterior'); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-orange-300">{zh ? '所有外墙' : 'All Exterior Walls'}</button>
              <button onClick={() => { filterLayer('interior'); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-cyan-300">{zh ? '所有内墙' : 'All Interior Walls'}</button>
              <button onClick={() => { filterLayer('bearing'); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-amber-300">{zh ? '所有承重墙' : 'All Bearing Walls'}</button>
            </>)}
            {selType === 'Beam' && elements.length > 0 && (<>
              <div className="border-t border-zinc-700 my-1"></div>
              <button onClick={() => { filterLayer('main'); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-amber-300">{zh ? '所有主梁' : 'All Main Beams'}</button>
              <button onClick={() => { filterLayer('secondary'); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-cyan-300">{zh ? '所有次梁' : 'All Secondary Beams'}</button>
            </>)}
            {uniqueLayers.length > 0 && (<>
              <div className="border-t border-zinc-700 my-1"></div>
              <div className="text-[10px] text-zinc-500 font-mono uppercase px-2 pb-0.5">{zh ? '按图层' : 'By Layer'}</div>
              {uniqueLayers.map(l => <button key={l} onClick={() => { setSelGuids(new Set(elements.filter(e => e.layerName === l).map(e => e.guid))); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-zinc-300">{l} ({elements.filter(e => e.layerName === l).length})</button>)}
            </>)}
          </div>
        )}
      </div>

      {/* 构件列表 */}
      {loading ? <div className="flex items-center justify-center py-3 text-xs text-zinc-500"><Loader className="w-3.5 h-3.5 animate-spin mr-1.5" />{zh ? '加载中...' : 'Loading...'}</div> : elements.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-500 font-mono uppercase">{zh ? `构件 (${selGuids.size}/${elements.length})` : `Elements (${selGuids.size}/${elements.length})`}</span>
            <div className="flex gap-1"><button onClick={() => setSelGuids(new Set(elements.map(e => e.guid)))} className="text-[10px] text-orange-400 hover:text-orange-300 px-1">{zh ? '全选' : 'All'}</button><button onClick={() => setSelGuids(new Set())} className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1">{zh ? '取消' : 'None'}</button></div>
          </div>
          <div className="max-h-28 overflow-y-auto space-y-0.5 custom-scrollbar">
            {elements.map(e => (
              <label key={e.guid} className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-[10px] font-mono ${selGuids.has(e.guid) ? 'bg-orange-600/10 text-orange-300' : 'bg-zinc-800/30 text-zinc-500'}`}>
                <input type="checkbox" checked={selGuids.has(e.guid)} onChange={() => toggleGuid(e.guid)} className="w-3 h-3 accent-orange-500" />
                <span className="flex-1 truncate">{e.guid.substring(0, 8)}...</span>
                {e.layerName && <span className="text-zinc-600">{e.layerName}</span>}
                <span className="text-zinc-600">F{e.floorIndex}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 编辑表单 */}
      {selGuids.size > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] text-zinc-500 font-mono uppercase border-b border-zinc-700 pb-1">✏️ {selGuids.size === 1 ? (zh ? '单个编辑' : 'Single Edit') : (zh ? `批量编辑 (${selGuids.size})` : `Batch (${selGuids.size})`)}</div>
          <div className="text-[10px] text-zinc-600">{zh ? '留空 = 不修改' : 'Empty = keep'}</div>
          <div className="grid grid-cols-2 gap-2">
            {selType === 'Wall' && <><NumInput label={zh ? '厚度(m)' : 'Thick(m)'} value={editParams.thickness} onChange={v => setEditParams({...editParams, thickness: v})} placeholder="0.24" /><NumInput label={zh ? '高度(m)' : 'Height(m)'} value={editParams.height} onChange={v => setEditParams({...editParams, height: v})} placeholder="3.0" /><NumInput label={zh ? '长度(m)' : 'Length(m)'} value={editParams.length} onChange={v => setEditParams({...editParams, length: v})} placeholder="5.0" /><TxtInput label={zh ? '图层' : 'Layer'} value={editParams.layerName} onChange={v => setEditParams({...editParams, layerName: v})} placeholder="外墙" /></>}
            {selType === 'Column' && <><NumInput label={zh ? '截面宽(m)' : 'SecW(m)'} value={editParams.sectionWidth} onChange={v => setEditParams({...editParams, sectionWidth: v})} placeholder="0.4" /><NumInput label={zh ? '截面深(m)' : 'SecD(m)'} value={editParams.sectionDepth} onChange={v => setEditParams({...editParams, sectionDepth: v})} placeholder="0.4" /><NumInput label={zh ? '高度(m)' : 'Height(m)'} value={editParams.height} onChange={v => setEditParams({...editParams, height: v})} placeholder="3.0" /><TxtInput label={zh ? '图层' : 'Layer'} value={editParams.layerName} onChange={v => setEditParams({...editParams, layerName: v})} placeholder="柱" /></>}
            {selType === 'Beam' && <><NumInput label={zh ? '截面高(m)' : 'SecH(m)'} value={editParams.sectionDepth} onChange={v => setEditParams({...editParams, sectionDepth: v})} placeholder="0.5" /><NumInput label={zh ? '截面宽(m)' : 'SecW(m)'} value={editParams.sectionWidth} onChange={v => setEditParams({...editParams, sectionWidth: v})} placeholder="0.25" /><NumInput label={zh ? '长度(m)' : 'Length(m)'} value={editParams.length} onChange={v => setEditParams({...editParams, length: v})} placeholder="4.0" /><TxtInput label={zh ? '图层' : 'Layer'} value={editParams.layerName} onChange={v => setEditParams({...editParams, layerName: v})} placeholder="主梁" /></>}
            {selType === 'Slab' && <><NumInput label={zh ? '厚度(m)' : 'Thick(m)'} value={editParams.thickness} onChange={v => setEditParams({...editParams, thickness: v})} placeholder="0.12" /><NumInput label={zh ? '标高(m)' : 'Level(m)'} value={editParams.level} onChange={v => setEditParams({...editParams, level: v})} placeholder="0" /><TxtInput label={zh ? '图层' : 'Layer'} value={editParams.layerName} onChange={v => setEditParams({...editParams, layerName: v})} placeholder="楼板" /></>}
            {selType === 'Roof' && <><NumInput label={zh ? '厚度(m)' : 'Thick(m)'} value={editParams.thickness} onChange={v => setEditParams({...editParams, thickness: v})} placeholder="0.15" /><NumInput label={zh ? '坡角(°)' : 'Pitch(°)'} value={editParams.pitchAngle} onChange={v => setEditParams({...editParams, pitchAngle: v})} placeholder="30" /><NumInput label={zh ? '基标高(m)' : 'BaseL(m)'} value={editParams.baseLevel} onChange={v => setEditParams({...editParams, baseLevel: v})} placeholder="3.0" /><TxtInput label={zh ? '图层' : 'Layer'} value={editParams.layerName} onChange={v => setEditParams({...editParams, layerName: v})} placeholder="屋面" /></>}
            {(selType === 'Door' || selType === 'Window') && <><NumInput label={zh ? '宽度(m)' : 'Width(m)'} value={editParams.width} onChange={v => setEditParams({...editParams, width: v})} placeholder="0.9" /><NumInput label={zh ? '高度(m)' : 'Height(m)'} value={editParams.height} onChange={v => setEditParams({...editParams, height: v})} placeholder="2.1" /><NumInput label={zh ? '参考位(m)' : 'RefPos(m)'} value={editParams.refPos} onChange={v => setEditParams({...editParams, refPos: v})} placeholder="0" /><TxtInput label={zh ? '图层' : 'Layer'} value={editParams.layerName} onChange={v => setEditParams({...editParams, layerName: v})} placeholder="门窗" /></>}
            {selType === 'Stair' && <><NumInput label={zh ? '总高(m)' : 'TotalH(m)'} value={editParams.totalHeight} onChange={v => setEditParams({...editParams, totalHeight: v})} placeholder="3.0" /><NumInput label={zh ? '步数' : 'Steps'} value={editParams.stepNum} onChange={v => setEditParams({...editParams, stepNum: v})} step={1} placeholder="16" /><NumInput label={zh ? '梯段宽(m)' : 'FlightW(m)'} value={editParams.flightWidth} onChange={v => setEditParams({...editParams, flightWidth: v})} placeholder="1.2" /><NumInput label={zh ? '踏步深(m)' : 'TreadD(m)'} value={editParams.treadDepth} onChange={v => setEditParams({...editParams, treadDepth: v})} placeholder="0.26" /></>}
            {(selType === 'Object' || selType === 'Lamp') && <><NumInput label={zh ? '旋转(°)' : 'Angle(°)'} value={editParams.angle} onChange={v => setEditParams({...editParams, angle: v})} placeholder="0" /><TxtInput label={zh ? '图层' : 'Layer'} value={editParams.layerName} onChange={v => setEditParams({...editParams, layerName: v})} placeholder={selType === 'Object' ? '家具' : '灯具'} /></>}
            {selType === 'Mesh' && <><NumInput label={zh ? '标高(m)' : 'Level(m)'} value={editParams.level} onChange={v => setEditParams({...editParams, level: v})} placeholder="0" /><TxtInput label={zh ? '图层' : 'Layer'} value={editParams.layerName} onChange={v => setEditParams({...editParams, layerName: v})} placeholder="地形" /></>}
            {selType === 'Zone' && <><TxtInput label={zh ? '区域名' : 'ZoneName'} value={editParams.zoneName} onChange={v => setEditParams({...editParams, zoneName: v})} placeholder="客厅" /><NumInput label={zh ? '高度(m)' : 'Height(m)'} value={editParams.height} onChange={v => setEditParams({...editParams, height: v})} placeholder="2.8" /><TxtInput label={zh ? '图层' : 'Layer'} value={editParams.layerName} onChange={v => setEditParams({...editParams, layerName: v})} placeholder="区域" /></>}
          </div>
          <button onClick={handleApply} disabled={applying || !mepbridgeConnected} className="flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/40 rounded text-xs font-semibold text-orange-300 transition-colors disabled:opacity-50">
            {applying ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
            {applying ? (zh ? '执行中...' : 'Applying...') : (zh ? `应用修改 (${selGuids.size})` : `Apply (${selGuids.size})`)}
          </button>
        </div>
      )}

      {/* 修改报告 */}
      {report.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] text-zinc-500 font-mono uppercase border-b border-zinc-700 pb-1">📋 {zh ? '修改报告' : 'Report'}</div>
          <div className="max-h-32 overflow-y-auto space-y-0.5 custom-scrollbar">
            {report.map((r, i) => (
              <div key={i} className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono ${r.status === 'success' ? 'bg-green-600/10 text-green-300' : 'bg-red-600/10 text-red-300'}`}>
                {r.status === 'success' ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                <span className="flex-1 truncate">{r.guid.substring(0, 8)}...</span>
                {r.layerName && <span className="text-zinc-600">{r.layerName}</span>}
                <span>{r.status === 'success' ? '✓' : '✗'}</span>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-zinc-500">{zh ? `成功 ${report.filter(r => r.status === 'success').length} / 失败 ${report.filter(r => r.status === 'failed').length}` : `Success ${report.filter(r => r.status === 'success').length} / Failed ${report.filter(r => r.status === 'failed').length}`}</div>
        </div>
      )}
    </div>
  );
};

export default EditBuildingElementPanel;
