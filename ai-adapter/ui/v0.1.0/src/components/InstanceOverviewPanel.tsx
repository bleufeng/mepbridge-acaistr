import { useCallback, useEffect, useRef, useState } from 'react';
import { workbenchFetch as fetch } from '../execution-recovery';
export interface OverviewInstance {
  port: number; productInfo?: { version?: string | number | null; buildNumber?: string | number | null } | null;
  archicadVersion?: string | number | null; projectName?: string | null; projectPath?: string | null;
  mepbridge: boolean; addOnVersion?: string | null; untitled?: boolean | null; teamwork?: boolean | null;
}
export default function InstanceOverviewPanel({lang, active = true}: {lang: 'zh-CN' | 'en-US'; active?: boolean}) {
  const zh=lang==='zh-CN';
  const [data,setData]=useState<{instances: OverviewInstance[]; primaryPort: number|null; timestamp:string|null}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const epoch=useRef(0), gate=useRef(false);
  const load=useCallback(async()=>{
    if(gate.current || !active) return;
    gate.current=true; setBusy(true); setError(''); const id=++epoch.current;
    try {
      const response=await fetch('/api/status/instances'); const body=await response.json();
      if(!response.ok || body.ok!==true || !Array.isArray(body.instances)) throw Error(body.error||'INSTANCE_OVERVIEW_UNAVAILABLE');
      if(body.instances.some((item:any)=>!Number.isInteger(item.port)||typeof item.mepbridge!=='boolean')) throw Error('INSTANCE_OVERVIEW_INVALID');
      if(id===epoch.current) setData({instances:body.instances,primaryPort:body.primaryPort??null,timestamp:body.timestamp??null});
    } catch(e:any) { if(id===epoch.current) setError(e.message); }
    finally { if(id===epoch.current){gate.current=false;setBusy(false);} }
  },[active]);
  useEffect(()=>{setBusy(false);if(active) void load();return()=>{epoch.current++;gate.current=false;};},[active]);
  const unknown=zh?'未知／未取得':'Unknown / unavailable';
  const value=(v:unknown)=>v===null||v===undefined||v===''?unknown:String(v);
  const bool=(v:boolean|null|undefined)=>v==null?unknown:v?(zh?'是':'Yes'):(zh?'否':'No');
  const rows=data?.instances||[];
  return <section className="flex flex-col h-full min-h-0 text-zinc-200 text-xs">
    <header className="flex items-center justify-between gap-3 border-b border-zinc-800 p-3 shrink-0">
      <h2>{zh?'多实例文件概览':'Instance & Project Overview'}</h2>
      <button onClick={load} disabled={busy} className="rounded border border-teal-700 px-3 py-1">{busy?(zh?'读取中…':'Loading…'):(zh?'刷新':'Refresh')}</button>
    </header>
    <div className="p-3 overflow-auto flex-1 min-h-0 space-y-3">
      <p>{zh?'仅查看运行实例和文件基本信息；模型复现与差异输出未完整实现，暂不开放。':'Basic instance and project information only. Model reproduction and comparison are incomplete and unavailable.'}</p>
      {error && <p role="alert" className="text-amber-400">{data?(zh?'上次数据已过期：':'Previous data is stale: '):''}{error}</p>}
      {data && <p>{zh?'实例：':'Instances: '}{rows.length}{zh?' · MEPBridge 响应：':' · MEPBridge responding: '}{rows.filter(r=>r.mepbridge).length}{zh?' · 已识别不同工程路径：':' · Distinct known project paths: '}{new Set(rows.map(r=>r.projectPath).filter(Boolean)).size}{zh?' · 刷新时间：':' · Refreshed: '}{value(data.timestamp)}</p>}
      {data && !rows.length && <p>{zh?'未发现运行实例。':'No running instances discovered.'}</p>}
      {rows.map(row=><article key={row.port} className="border border-zinc-800 rounded p-3 space-y-2 break-words">
        <h3 className="font-semibold">{value(row.projectName)}{row.untitled?(zh?'（未命名）':' (Untitled)'):''} · {row.port}{row.port===data?.primaryPort?(zh?' · 当前主操作实例':' · Current primary instance'):''}</h3>
        <p>{'Archicad: '}{value(row.productInfo?.version??row.archicadVersion)}{' · Build: '}{value(row.productInfo?.buildNumber)}</p>
        <p>{'MEPBridge: '}{row.mepbridge?(zh?'已响应':'Responding'):(zh?'本次未取得有效响应':'No valid response this time')}{' · Add-On: '}{value(row.addOnVersion)}</p>
        <p>{'Teamwork: '}{bool(row.teamwork)}</p>
        <details><summary>{zh?'查看工程路径':'View project path'}</summary><p className="break-all select-text">{value(row.projectPath)}</p></details>
      </article>)}
    </div>
  </section>;
}
