// EditMEPElementPanel.tsx
// MEP 管线编辑面板 — BASE 模式 Water/Electrical/Ventilation 模块
// 支持单个和批量编辑 3 专业 MEP 路由：Piping(管道) / Ventilation(风管) / CableCarrier(桥架)
// 工作流：选择目标 → 管线列表 → 编辑属性 → 应用 → 报告

import React, { useState, useCallback } from 'react';
import {
  Wrench, Plus, GitBranch, Link,
  ChevronDown, Loader, CheckCircle, AlertTriangle, Droplet, Wind, Cable
} from 'lucide-react';

type MEPDomain = 'Piping' | 'Ventilation' | 'CableCarrier';

interface MEPElementInfo {
  guid: string;
  type: string;
  mepDomain: string;
  mepSystemIndex?: number;
  floorIndex?: number;
  layerName?: string;
}

interface MEPEditParams {
  mepSystemName?: string;
  mepSystemIndex?: number;
  offsetFromHomeStory?: number;
  layerName?: string;
}

interface Props {
  domain: MEPDomain;
  onExecute: (commandName: string, params: any) => Promise<any>;
  lang: string;
  mepbridgeConnected: boolean;
  currentFloorIndex?: number;
}

const DOMAIN_CONFIG: Record<MEPDomain, { icon: React.ReactNode; zhName: string; enName: string; color: string }> = {
  Piping:       { icon: <Droplet className="w-4 h-4" />,   zhName: '管道', enName: 'Piping',       color: 'cyan' },
  Ventilation:  { icon: <Wind className="w-4 h-4" />,     zhName: '风管', enName: 'Ventilation',  color: 'violet' },
  CableCarrier: { icon: <Cable className="w-4 h-4" />,    zhName: '桥架', enName: 'CableCarrier', color: 'yellow' },
};

// 常见 MEP 系统名识别
const MEP_SYSTEM_PATTERNS: Record<string, string[]> = {
  supply:    ['给水', 'SUPPLY', '供水'],
  drain:     ['排水', 'DRAIN', '废水'],
  hot:       ['热水', 'HOT', '供暖'],
  gas:       ['燃气', 'GAS'],
  supplyAir: ['送风', 'SUPPLY', 'SA'],
  returnAir: ['回风', 'RETURN', 'RA'],
  exhaust:   ['排风', 'EXHAUST', 'EA', '排烟'],
  power:     ['电力', 'POWER', '强电'],
  weak:      ['弱电', 'WEAK', '通讯'],
  data:      ['数据', 'DATA', '网络'],
};

function matchSystem(name: string | undefined, patterns: string[]): boolean {
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
    <input type="number" step={step} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} placeholder={placeholder || '不修改'} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono outline-none focus:border-cyan-500" />
  </div>
);

const TxtInput: React.FC<{ label: string; value: string | undefined; onChange: (v: string | undefined) => void; placeholder?: string }> = ({ label, value, onChange, placeholder }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] text-zinc-500 font-mono uppercase">{label}</label>
    <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)} placeholder={placeholder || '不修改'} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono outline-none focus:border-cyan-500" />
  </div>
);

export const EditMEPElementPanel: React.FC<Props> = ({ domain, onExecute, lang, mepbridgeConnected, currentFloorIndex }) => {
  const zh = lang === 'zh-CN';
  const config = DOMAIN_CONFIG[domain];
  const colorClass = domain === 'Piping' ? 'cyan' : domain === 'Ventilation' ? 'violet' : 'yellow';

  const [elements, setElements] = useState<MEPElementInfo[]>([]);
  const [selGuids, setSelGuids] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [editParams, setEditParams] = useState<MEPEditParams>({});
  const [applying, setApplying] = useState(false);
  const [report, setReport] = useState<any[]>([]);
  const [showSel, setShowSel] = useState(true);  // 默认展开选择面板

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callCmd('GetElementsByType', { elementType: 'MEPRoute', includeAabb: false });
      const resp = r?.response?.result?.addOnCommandResponse || r?.result?.addOnCommandResponse || r?.result;
      const allRoutes = resp?.elements || [];
      const filtered = allRoutes.filter((e: any) => e.mepDomain === domain);
      const elems: MEPElementInfo[] = filtered.map((e: any) => ({ guid: e.guid, type: e.type, mepDomain: e.mepDomain, mepSystemIndex: e.mepSystemIndex, floorIndex: e.floorIndex, layerName: e.layerName }));
      setElements(elems);
      setSelGuids(new Set(elems.map(e => e.guid)));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [domain]);

  const loadSelected = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callCmd('GetSelectedElements', { includeAabb: false });
      const resp = r?.response?.result?.addOnCommandResponse || r?.result?.addOnCommandResponse || r?.result;
      const allElements = resp?.elements || [];
      const filtered = allElements.filter((e: any) => e.type === 'MEPRoute' && e.mepDomain === domain);
      const elems: MEPElementInfo[] = filtered.map((e: any) => ({ guid: e.guid, type: e.type, mepDomain: e.mepDomain, mepSystemIndex: e.mepSystemIndex, floorIndex: e.floorIndex, layerName: e.layerName }));
      setElements(elems);
      setSelGuids(new Set(elems.map(e => e.guid)));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [domain]);

  const filterFloor = () => {
    if (currentFloorIndex === undefined) return;
    setSelGuids(new Set(elements.filter(e => e.floorIndex === currentFloorIndex).map(e => e.guid)));
  };

  const filterSystem = (pattern: keyof typeof MEP_SYSTEM_PATTERNS) => {
    const ps = MEP_SYSTEM_PATTERNS[pattern];
    setSelGuids(new Set(elements.filter(e => matchSystem(e.layerName, ps)).map(e => e.guid)));
  };

  const toggleGuid = (g: string) => { const n = new Set(selGuids); n.has(g) ? n.delete(g) : n.add(g); setSelGuids(n); };

  const handleApply = async () => {
    const guids = Array.from(selGuids);
    if (guids.length === 0) return;
    setApplying(true); setReport([]);
    const results: any[] = [];
    for (const guid of guids) {
      try {
        const params: any = { routeGuid: guid, dryRun: false, confirmRequired: true };
        if (editParams.mepSystemName !== undefined) params.mepSystemName = editParams.mepSystemName;
        if (editParams.mepSystemIndex !== undefined) params.mepSystemIndex = editParams.mepSystemIndex;
        if (editParams.offsetFromHomeStory !== undefined) params.offsetFromHomeStory = editParams.offsetFromHomeStory;
        const r = await callCmd('ChangeMEPRouteProperties', params);
        const resp = r?.response?.result?.addOnCommandResponse || r?.result?.addOnCommandResponse || r?.result;
        const ok = (r?.ok || r?.response?.succeeded) && resp?.status === 'ok';
        const elem = elements.find(e => e.guid === guid);
        results.push({ guid, layerName: elem?.layerName, status: ok ? 'success' : 'failed', detail: ok ? resp : (r?.error || r?.response?.error || resp) });
      } catch (e: any) { results.push({ guid, status: 'failed', detail: e.message }); }
    }
    setReport(results); setApplying(false);
  };

  const uniqueLayers = Array.from(new Set(elements.map(e => e.layerName).filter(Boolean))) as string[];

  // 常见系统快捷过滤选项
  const systemFilters: Record<MEPDomain, { key: string; zh: string; en: string }[]> = {
    Piping: [
      { key: 'supply', zh: '给水管', en: 'Supply' },
      { key: 'drain', zh: '排水管', en: 'Drain' },
      { key: 'hot', zh: '热水管', en: 'Hot' },
      { key: 'gas', zh: '燃气管', en: 'Gas' },
    ],
    Ventilation: [
      { key: 'supplyAir', zh: '送风管', en: 'Supply Air' },
      { key: 'returnAir', zh: '回风管', en: 'Return Air' },
      { key: 'exhaust', zh: '排风管', en: 'Exhaust' },
    ],
    CableCarrier: [
      { key: 'power', zh: '强电桥架', en: 'Power' },
      { key: 'weak', zh: '弱电桥架', en: 'Weak Current' },
      { key: 'data', zh: '数据桥架', en: 'Data' },
    ],
  };

  return (
    <div className={`rounded-xl border border-${colorClass}-500/20 bg-${colorClass}-500/5 p-3 shadow-lg flex flex-col gap-2.5`}>
      <h3 className={`text-xs font-semibold font-display tracking-wider uppercase text-${colorClass}-300 flex items-center gap-2 border-b border-${colorClass}-500/20 pb-2`}>
        {config.icon}
        {zh ? `${config.zhName}编辑` : `${config.enName} Editor`}
      </h3>

      {/* 选择目标 */}
      <div className="flex flex-col gap-1.5">
        <button onClick={() => { showSel ? setShowSel(false) : setShowSel(true); if (elements.length === 0) loadAll(); }} className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300 hover:border-zinc-600">
          <span className="flex items-center gap-1.5"><Wrench className={`w-3.5 h-3.5 text-${colorClass}-400`} />{zh ? '选择目标' : 'Select Target'}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSel ? 'rotate-180' : ''}`} />
        </button>
        {showSel && (
          <div className="bg-zinc-800/80 border border-zinc-700 rounded p-2 space-y-1">
            <button onClick={() => { loadSelected(); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-zinc-300">{zh ? '当前选中' : 'Current Selection'}</button>
            <button onClick={() => { loadAll(); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-zinc-300">{zh ? `所有${config.zhName}` : `All ${config.enName}`}</button>
            {currentFloorIndex !== undefined && elements.length > 0 && <button onClick={() => { filterFloor(); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-zinc-300">{zh ? `当前楼层 (${currentFloorIndex})` : `Current Floor`}</button>}
            {elements.length > 0 && (<>
              <div className="border-t border-zinc-700 my-1"></div>
              <div className="text-[10px] text-zinc-500 font-mono uppercase px-2 pb-0.5">{zh ? '按系统' : 'By System'}</div>
              {systemFilters[domain].map(sf => <button key={sf.key} onClick={() => { filterSystem(sf.key); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-zinc-300">{zh ? sf.zh : sf.en}</button>)}
            </>)}
            {uniqueLayers.length > 0 && (<>
              <div className="border-t border-zinc-700 my-1"></div>
              <div className="text-[10px] text-zinc-500 font-mono uppercase px-2 pb-0.5">{zh ? '按图层' : 'By Layer'}</div>
              {uniqueLayers.map(l => <button key={l} onClick={() => { setSelGuids(new Set(elements.filter(e => e.layerName === l).map(e => e.guid))); setShowSel(false); }} className="w-full text-left px-2 py-1.5 hover:bg-zinc-700/50 rounded text-xs text-zinc-300">{l} ({elements.filter(e => e.layerName === l).length})</button>)}
            </>)}
          </div>
        )}
      </div>

      {/* 管线列表 */}
      {loading ? <div className="flex items-center justify-center py-3 text-xs text-zinc-500"><Loader className="w-3.5 h-3.5 animate-spin mr-1.5" />{zh ? '加载中...' : 'Loading...'}</div> : elements.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-500 font-mono uppercase">{zh ? `管线 (${selGuids.size}/${elements.length})` : `Routes (${selGuids.size}/${elements.length})`}</span>
            <div className="flex gap-1"><button onClick={() => setSelGuids(new Set(elements.map(e => e.guid)))} className="text-[10px] text-cyan-400 hover:text-cyan-300 px-1">{zh ? '全选' : 'All'}</button><button onClick={() => setSelGuids(new Set())} className="text-[10px] text-zinc-500 hover:text-zinc-300 px-1">{zh ? '取消' : 'None'}</button></div>
          </div>
          <div className="max-h-28 overflow-y-auto space-y-0.5 custom-scrollbar">
            {elements.map(e => (
              <label key={e.guid} className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-[10px] font-mono ${selGuids.has(e.guid) ? `bg-${colorClass}-600/10 text-${colorClass}-300` : 'bg-zinc-800/30 text-zinc-500'}`}>
                <input type="checkbox" checked={selGuids.has(e.guid)} onChange={() => toggleGuid(e.guid)} className={`w-3 h-3 accent-${colorClass}-500`} />
                <span className="flex-1 truncate">{e.guid.substring(0, 8)}...</span>
                {e.layerName && <span className="text-zinc-600">{e.layerName}</span>}
                {e.floorIndex !== undefined && <span className="text-zinc-600">F{e.floorIndex}</span>}
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
            <TxtInput label={zh ? 'MEP系统名' : 'MEP System'} value={editParams.mepSystemName} onChange={v => setEditParams({...editParams, mepSystemName: v})} placeholder={zh ? '给水系统' : 'Supply System'} />
            <NumInput label={zh ? '楼层偏移(m)' : 'Offset(m)'} value={editParams.offsetFromHomeStory} onChange={v => setEditParams({...editParams, offsetFromHomeStory: v})} placeholder="0" />
          </div>
          <button onClick={handleApply} disabled={applying || !mepbridgeConnected} className={`flex items-center justify-center gap-1.5 px-3 py-2 bg-${colorClass}-600/20 hover:bg-${colorClass}-600/30 border border-${colorClass}-500/40 rounded text-xs font-semibold text-${colorClass}-300 transition-colors disabled:opacity-50`}>
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

export default EditMEPElementPanel;
