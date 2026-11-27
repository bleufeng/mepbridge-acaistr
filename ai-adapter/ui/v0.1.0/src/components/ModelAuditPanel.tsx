import {workbenchFetch as fetch} from '../execution-recovery';
﻿import {useEffect,useRef,useState} from 'react';
type Lang='zh-CN'|'en-US';
export default function ModelAuditPanel({lang}:{lang:Lang}) {
 const zh=lang==='zh-CN',tr=(cn:string,en:string)=>zh?cn:en;
 const [port,setPort]=useState('19723'),[context,setContext]=useState<any>(null),[preflight,setPreflight]=useState<any>(null),[selection,setSelection]=useState<any>(null),[selectedRules,setSelectedRules]=useState<string[]>([]),[conditions,setConditions]=useState<Record<string,boolean>>({}),[job,setJob]=useState<any>(null),[history,setHistory]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [location,setLocation]=useState<any>(null);
 const [evidence,setEvidence]=useState<any>(null),[targetIndex,setTargetIndex]=useState('0'),[disposition,setDisposition]=useState('REVIEWED'),[reviewer,setReviewer]=useState(''),[reason,setReason]=useState(''),[exclusions,setExclusions]=useState<Record<string,string>>({});
 const gate=useRef(false),epoch=useRef(0),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
 async function api(path:string,body?:any){const response=await fetch('/api/model-audit'+path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(response.ok===false||!data.ok)throw Error(data.error||data.message||'AUDIT_UNKNOWN');return data;}
 async function act(fn:(valid:()=>boolean)=>Promise<void>){if(gate.current)return;gate.current=true;setBusy(true);setError('');const revision=epoch.current;const valid=()=>mounted.current&&epoch.current===revision;try{await fn(valid);}catch(e:any){if(valid())setError(e.message);}finally{gate.current=false;if(valid())setBusy(false);}}
 const prefix=context?'/'+context.contextId:'';
 async function bind(){setLocation(null);await act(async valid=>{const data=await api('/bind',{targetPort:Number(port)});if(valid()){setContext(data);setPreflight(data.preflight);setSelection(null);setSelectedRules([]);setExclusions({});setConditions({});setJob(null);setEvidence(null);setLocation(null);setHistory([]);}});}
 async function refresh(){await act(async valid=>{const data=await api(prefix+'/preflight');if(valid())setPreflight(data.preflight);});}
 async function enable(enabled:boolean){if(enabled&&!window.confirm(tr('只启用本项目审核入口，不自动扫描。是否确认？','Enable review for this project without automatic scanning?')))return;await act(async valid=>{if(!enabled&&valid()){setSelection(null);setPreflight((p:any)=>({...p,settings:{...p.settings,enabled:false,locallyStopped:true}}));}const data=await api(prefix+'/settings',{enabled,expectedRevision:preflight.settings.revision,confirmed:enabled});if(valid())setPreflight((p:any)=>({...p,settings:data.settings}));});}
 async function capture(){await act(async valid=>{const data=await api(prefix+'/selection',{});if(valid())setSelection(data.selection);});}
 async function start(){await act(async valid=>{const unselectedMandatory=(preflight?.rules||[]).filter((r:any)=>!r.disabled&&r.requirementLevel==='MANDATORY'&&!selectedRules.includes(r.id));for(const r of unselectedMandatory){if(!exclusions[r.id]||!exclusions[r.id].trim()){throw Error(tr(`强制项 [${r.originalRuleId||r.id}] 未选入，必须填写排除原因说明`,`Mandatory item [${r.originalRuleId||r.id}] not selected; exclusion reason required`));}}const data=await api(prefix+'/start',{selectionId:selection?.selectionId,selectedRuleIds:selectedRules,conditions,exclusions,settingsRevision:preflight.settings.revision,libraryRevision:preflight.revision,libraryId:preflight.libraryId});if(valid()){setJob(data);setEvidence(null);setSelection(null);}});}
 async function manual(){if(!window.confirm(tr('只建立人工审核批次，冻结已选GUID及当前库原文；核对项目身份但不读取几何或计算合规。所有计算项保持未检查。继续？','Create a manual batch of frozen GUIDs and library text; verify project identity only, with no geometry read or compliance computation. All calculated items remain Not checked. Continue?')))return;await act(async valid=>{const unselectedMandatory=(preflight?.rules||[]).filter((r:any)=>!r.disabled&&r.requirementLevel==='MANDATORY'&&!selectedRules.includes(r.id));for(const r of unselectedMandatory){if(!exclusions[r.id]||!exclusions[r.id].trim()){throw Error(tr(`强制项 [${r.originalRuleId||r.id}] 未选入，必须填写排除原因说明`,`Mandatory item [${r.originalRuleId||r.id}] not selected; exclusion reason required`));}}const data=await api(prefix+'/manual',{confirmed:true,selectionId:selection?.selectionId,selectedRuleIds:selectedRules,conditions:{},exclusions,settingsRevision:preflight.settings.revision,libraryRevision:preflight.revision,libraryId:preflight.libraryId});if(valid()){setJob(data);setEvidence(null);setSelection(null);}});}
 async function query(){await act(async valid=>{const data=await api(prefix+'/jobs/'+job.jobId);if(valid()){setJob(data.job);setEvidence(null);}});}
 async function cancel(){await act(async()=>{await api(prefix+'/cancel',{});});}
 async function readHistory(){await act(async valid=>{const data=await api(prefix+'/history');if(valid())setHistory(data.history);});}
 async function loadEvidence(){await act(async valid=>{const data=await api(prefix+'/runs/'+encodeURIComponent(job.runId)+'/evidence');if(valid()){setEvidence(data);setTargetIndex('0');setConditions({});setLocation(null);}});}
 async function locateTarget(){await act(async valid=>{
  setLocation(null);
  const target=evidence?.review.targets[Number(targetIndex)];if(!target)throw Error('AUDIT_LOCATE_TARGET_REQUIRED');
  const path=prefix+'/runs/'+evidence.run.runId+'/locate';
  const preview=await api(path+'/preview',{guid:target.guid,ruleId:target.ruleId,evidenceHash:evidence.review.evidenceHash,resultHash:target.resultHash});
  if(!valid())return;
  if(preview.guid?.toLowerCase()!==target.guid.toLowerCase()||preview.target?.port!==context.project.port||preview.target?.projectFingerprint!==context.project.projectFingerprint||preview.target?.sessionId!==context.project.sessionId||preview.effect!=='REPLACE_SELECTION_WITH_SAVED_RESULT_GUID')throw Error('AUDIT_LOCATE_PREVIEW_TARGET_MISMATCH');
  if(!window.confirm(tr('将实例 '+preview.target.port+' 的当前选择集替换为此审核条目的GUID（'+preview.guid+'）。不缩放、不自动恢复选择集，定位不代表重新通过规范审核，是否继续？',
   'Replace the selection in instance '+preview.target.port+' with this review GUID ('+preview.guid+')? No zoom or automatic selection restore. Locating does not revalidate code compliance.')))return;
  setSelection(null);
  const located=await api(path,{previewId:preview.previewId,previewHash:preview.previewHash,confirmed:true});
  if(located.selectionVerified!==true||located.guid?.toLowerCase()!==target.guid.toLowerCase()||located.target?.port!==context.project.port||located.target?.projectFingerprint!==context.project.projectFingerprint)throw Error('AUDIT_LOCATE_RESULT_TARGET_MISMATCH');
  if(valid()){setLocation(located);setSelection(null);}
 });}
 async function saveReview(){if(!window.confirm(tr('仅记录自报人工意见，不改变计算结论，也不构成专业批准。确认保存？','Record a self-declared opinion only, without changing the calculated verdict or granting professional approval?')))return;await act(async valid=>{const target=evidence.review.targets[Number(targetIndex)];const data=await api(prefix+'/runs/'+encodeURIComponent(evidence.run.runId)+'/reviews',{guid:target.guid,ruleId:target.ruleId,evidenceHash:evidence.review.evidenceHash,resultHash:target.resultHash,expectedRevision:target.revision,disposition,reviewerLabel:reviewer,reason,confirmed:true});if(valid()){setEvidence((e:any)=>({...e,review:data.review}));setReason('');}});}
 async function recheck(){if(!window.confirm(evidence.run.mode==='MANUAL'?tr('创建同范围的新人工批次，不读取测量事实、不自动判断或修改旧证据。请确认本次强制项排除说明。继续？','Create a new same-scope manual batch, without reading measurements, automatic verdicts or changing old evidence. Confirm the current mandatory exclusion reasons. Continue?'):tr('以重新冻结的同一GUID范围和规则、当前库修订及项目条件生成新审核，不覆盖旧记录。继续？','Create a new run for the freshly frozen same GUIDs and rules, with current library revision and conditions; keep the old evidence and confirm the current mandatory exclusion reasons?')))return;await act(async valid=>{const unselectedMandatory=(preflight?.rules||[]).filter((r:any)=>!r.disabled&&r.requirementLevel==='MANDATORY'&&!selectedRules.includes(r.id));for(const r of unselectedMandatory){if(!exclusions[r.id]?.trim())throw Error(tr(`强制项 [${r.originalRuleId||r.id}] 未选入，必须重新确认本次排除原因说明`,`Mandatory item [${r.originalRuleId||r.id}] not selected; confirm a current exclusion reason`));}const data=await api(prefix+'/recheck',{parentRunId:evidence.run.runId,evidenceHash:evidence.review.evidenceHash,confirmed:true,selectionId:selection?.selectionId,selectedRuleIds:selectedRules,exclusions,conditions:evidence.run.mode==='MANUAL'?{}:conditions,settingsRevision:preflight.settings.revision,libraryRevision:preflight.revision,libraryId:preflight.libraryId});if(valid()){setJob(data);setEvidence(null);setSelection(null);}});}
 function exportReview(){if(!evidence)return;const blob=new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`MACAI-model-review-with-notes-${evidence.run.runId}.json`;link.click();URL.revokeObjectURL(url);}
 function download(){if(!job?.result)return;const blob=new Blob([JSON.stringify(job.result,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`MACAI-model-review-${job.result.runId}.json`;link.click();URL.revokeObjectURL(url);}
 const rules=preflight?.rules||[],activeRules=rules.filter((r:any)=>!r.disabled),activeMandatoryRules=activeRules.filter((r:any)=>r.requirementLevel==='MANDATORY'),activeRecommendedRules=activeRules.filter((r:any)=>r.requirementLevel==='RECOMMENDED'),activeReferenceRules=activeRules.filter((r:any)=>r.requirementLevel==='REFERENCE'),approvedRules=activeRules.filter((r:any)=>r.approved),unselectedMandatoryRules=activeMandatoryRules.filter((r:any)=>!selectedRules.includes(r.id)),hasApproved=rules.some((r:any)=>r.approved&&selectedRules.includes(r.id));
 function selectAllValid(){setSelectedRules(activeRules.map((r:any)=>r.id));}
 function selectMandatory(){setSelectedRules(activeMandatoryRules.map((r:any)=>r.id));}
 function selectRecommended(){setSelectedRules(activeRecommendedRules.map((r:any)=>r.id));}
 function selectReference(){setSelectedRules(activeReferenceRules.map((r:any)=>r.id));}
 function selectAutoOnly(){setSelectedRules(approvedRules.map((r:any)=>r.id));}
 function clearSelection(){setSelectedRules([]);}
 const conditionKeys=[...new Set<string>(rules.filter((r:any)=>r.approved&&selectedRules.includes(r.id)&&r.applicabilityKey).map((r:any)=>r.applicabilityKey))];
 const active=job?.status==='RUNNING';
 const dispositions:Record<string,string>={REVIEWED:tr('已人工复核','Reviewed'),WAIVER_RECORDED:tr('已记录豁免说明','Waiver note recorded'),REOPENED:tr('重新提出问题／撤回先前意见','Reopened / prior opinion withdrawn')};
 const states:Record<string,string>={PASS:tr('通过','Pass'),FAIL:tr('不通过','Fail'),INDETERMINATE:tr('无法判断','Indeterminate'),NOT_APPLICABLE:tr('不适用','Not applicable'),NOT_CHECKED:tr('未检查','Not checked')};

 const btnBase = "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
 const btnPrimary = `${btnBase} bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm`;
 const btnSecondary = `${btnBase} bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700`;
 const inputCls = "bg-zinc-900 border border-zinc-700 rounded-md px-2.5 py-1 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500";

 return <section className="p-4 space-y-3.5 text-xs bg-zinc-900/60 rounded-xl border border-zinc-800 text-zinc-200">
  <div className="border-b border-zinc-800 pb-2.5">
    <h3 className="font-semibold text-sm text-zinc-100 flex items-center gap-2">{tr('模型审核（独立、默认关闭）','Model review (independent, off by default)')}</h3>
    <p className="text-zinc-400 text-xs leading-relaxed mt-1">{tr('只审核明确选择的元素；不会自动扫描、修复或调用 AI。计划校验与模型审核互不接管。','Only explicitly selected elements are reviewed. No automatic scan, repair or AI calls. Plan validation and model review are separate.')}</p>
  </div>

  <div className="flex flex-wrap items-center gap-2.5">
    <label className="flex items-center gap-2 font-medium text-zinc-300">
      {tr('目标 Archicad 端口','Target Archicad port')}
      <input aria-label={tr('审核目标端口','Review target port')} value={port} disabled={busy||active} onChange={e=>{epoch.current++;setPort(e.target.value);setContext(null);setPreflight(null);setSelection(null);setJob(null);setEvidence(null);setHistory([]);}} className={`${inputCls} w-24 font-mono`} />
    </label>
    <button className={btnPrimary} disabled={busy||active||!/^197(?:2[3-9]|3[0-9]|4[0-3])$/.test(port)} onClick={bind}>{tr('确认项目连接','Confirm project binding')}</button>
  </div>

  {error&&<p role="alert" className="text-red-400 bg-red-950/20 border border-red-800/40 p-2 rounded-md">{tr('未完成，请核对：','Not completed; check: ')}{error}</p>}
  {context&&preflight&&<div className="space-y-3 pt-1">
   <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 space-y-1.5 font-mono text-[11px] text-zinc-300">
     <p>{tr('项目指纹','Project fingerprint')}: <span className="text-zinc-100 font-semibold">{context.project.projectFingerprint}</span> · {tr('会话','Session')}: {context.project.sessionId}</p>
     <p>{tr('当前库','Current library')}: <span className="text-indigo-400">{preflight.libraryId}</span> · {tr('修订','Revision')}: {preflight.revision}</p>
     <p>{tr('实际计划拦截','Actual plan validation')}: {preflight.automaticPlanValidation} · {tr('本项目模型审核','Project model review')}: <span className={preflight.settings.enabled ? "text-emerald-400 font-bold" : "text-zinc-500"}>{preflight.settings.enabled?'ON':'OFF'}</span></p>
     {preflight.settings.reconfirmationRequired&&<p className="text-amber-400">{tr('新会话，需要重新确认启用。历史不代表正在监控。','New session: re-enable explicitly. History is not active monitoring.')}</p>}
   </div>

   <div className="flex flex-wrap items-center gap-2">
     <button className={btnSecondary} disabled={busy||active} onClick={refresh}>{tr('刷新审核预检','Refresh preflight')}</button>
     <button className={`${btnBase} ${preflight.settings.enabled ? "bg-amber-600/20 text-amber-300 border border-amber-600/40 hover:bg-amber-600/30" : "bg-emerald-600/20 text-emerald-300 border border-emerald-600/40 hover:bg-emerald-600/30"}`} disabled={busy} onClick={()=>enable(!preflight.settings.enabled)}>{preflight.settings.enabled?tr('关闭并停止本项目审核','Disable and stop project review'):tr('启用审核入口','Enable review entry')}</button>
     <button className={btnSecondary} disabled={busy||active||!preflight.settings.enabled} onClick={capture}>{tr('读取并冻结当前选择集','Read and freeze current selection')}</button>
   </div>

   {selection&&<p className="text-zinc-300 font-mono text-xs">{tr('已冻结元素数','Frozen element count')}: <span className="text-indigo-400 font-bold">{selection.guids.length}</span></p>}

   <details className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5" open>
     <summary className="cursor-pointer font-semibold text-zinc-300 hover:text-zinc-100">{tr('审查清单、规则分级与批量选择','Checklist, rule classification and batch selection')} ({rules.length})</summary>

     {/* 五项批量操作按钮 */}
     <div className="flex flex-wrap items-center gap-1.5 pt-2 pb-1">
       <button type="button" className={btnSecondary} disabled={busy||active} onClick={selectAllValid}>{tr(`全选有效项 (${activeRules.length})`,`Select all valid (${activeRules.length})`)}</button>
       <button type="button" className={btnSecondary} disabled={busy||active} onClick={selectMandatory} title={!activeMandatoryRules.length ? tr('当前活动库暂无强制项（共 0 项）','No mandatory rules in current library (0)') : undefined}>{tr(`选中强制项 (${activeMandatoryRules.length})`,`Select mandatory (${activeMandatoryRules.length})`)}</button>
       <button type="button" className={btnSecondary} disabled={busy||active} onClick={selectRecommended} title={!activeRecommendedRules.length ? tr('当前活动库暂无一般项（共 0 项）','No recommended rules in current library (0)') : undefined}>{tr(`选中一般项 (${activeRecommendedRules.length})`,`Select recommended (${activeRecommendedRules.length})`)}</button>
       <button type="button" className={btnSecondary} disabled={busy||active} onClick={selectReference} title={!activeReferenceRules.length ? tr('当前活动库暂无参考项（共 0 项）','No reference rules in current library (0)') : undefined}>{tr(`选中参考项 (${activeReferenceRules.length})`,`Select reference (${activeReferenceRules.length})`)}</button>
       <button type="button" className={btnSecondary} disabled={busy||active} onClick={clearSelection}>{tr('清空本次选择','Clear selection')}</button>
       <button type="button" className={btnSecondary} disabled={busy||active} onClick={selectAutoOnly} title={!approvedRules.length ? tr('当前暂无已批准自动检查项（共 0 项）','No approved automatic checks (0)') : undefined}>{tr(`仅选可自动检查项 (${approvedRules.length})`,`Select auto-checkable only (${approvedRules.length})`)}</button>
     </div>

     {/* 清单分级统计 */}
     <div className="text-[11px] font-mono text-zinc-400 bg-zinc-900/60 p-2 rounded border border-zinc-800/80 my-1.5 flex flex-wrap gap-x-3 gap-y-1">
       <span>{tr('已选: ','Selected: ')}<strong className="text-indigo-400">{selectedRules.length}</strong>/{rules.length}</span>
       <span>{tr('强制项: ','Mandatory: ')}<strong className="text-rose-400">{activeMandatoryRules.length}</strong></span>
       <span>{tr('一般项: ','Recommended: ')}<strong className="text-amber-400">{activeRecommendedRules.length}</strong></span>
       <span>{tr('参考项: ','Reference: ')}<strong className="text-cyan-400">{activeReferenceRules.length}</strong></span>
       <span>{tr('待确认: ','Unclassified: ')}<strong className="text-zinc-400">{rules.filter((r:any)=>!r.disabled&&(!r.requirementLevel||r.requirementLevel==='UNCLASSIFIED')).length}</strong></span>
       <span>{tr('已禁用: ','Disabled: ')}<strong className="text-zinc-500">{rules.filter((r:any)=>r.disabled).length}</strong></span>
       <span>{tr('具批准定义: ','Approved: ')}<strong className="text-emerald-400">{rules.filter((r:any)=>r.approved).length}</strong></span>
       <span>{tr('需人工复核: ','Manual: ')}<strong className="text-zinc-300">{rules.filter((r:any)=>!r.disabled&&!r.approved).length}</strong></span>
     </div>

     {/* 强制项排除留痕 */}
     {unselectedMandatoryRules.length > 0 && (
       <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-2.5 space-y-2 my-2">
         <p className="font-semibold text-amber-300 text-xs">
           {tr('强制项排除留痕（','Mandatory rule exclusions (')}
           <span className="font-bold text-amber-200">{unselectedMandatoryRules.length}</span>
           {tr(' 项强制项未选，提交批次前必须填写排除原因）：',' unselected mandatory items; exclusion reasons required before submission):')}
         </p>
         <div className="space-y-1.5 max-h-36 overflow-auto custom-scrollbar">
           {unselectedMandatoryRules.map((r:any)=>(
             <div key={r.id} className="text-[11px] bg-zinc-900/80 border border-zinc-800 rounded p-1.5 space-y-1">
               <div className="flex items-center justify-between text-zinc-300 font-mono">
                 <span>{r.originalRuleId||r.id} · {r.rule||r.material}</span>
                 <span className="text-rose-400 font-bold text-[10px]">{tr('强制项','Mandatory')}</span>
               </div>
               <input
                 className={`${inputCls} w-full`}
                 placeholder={tr('必须输入排除原因说明（例如：本项目无相关设计构件）','Exclusion reason required (e.g. not applicable to this project)')}
                 value={exclusions[r.id]||''}
                 onChange={e=>setExclusions(prev=>({...prev,[r.id]:e.target.value}))}
                 disabled={busy||active}
               />
             </div>
           ))}
         </div>
       </div>
     )}

     {/* 规则条目列表 */}
     <div className="max-h-52 overflow-auto space-y-1 mt-2 custom-scrollbar">
       {rules.map((r:any)=>{
         const levelBadge = r.requirementLevel === 'MANDATORY' ? 'bg-rose-950/80 text-rose-300 border-rose-800/40' :
                            r.requirementLevel === 'RECOMMENDED' ? 'bg-amber-950/80 text-amber-300 border-amber-800/40' :
                            r.requirementLevel === 'REFERENCE' ? 'bg-cyan-950/80 text-cyan-300 border-cyan-800/40' :
                            'bg-zinc-800 text-zinc-400 border-zinc-700';
         const levelText = r.requirementLevel === 'MANDATORY' ? tr('强制项','Mandatory') :
                           r.requirementLevel === 'RECOMMENDED' ? tr('一般项','Recommended') :
                           r.requirementLevel === 'REFERENCE' ? tr('参考项','Reference') :
                           tr('待确认','Unclassified');
         return (
           <label key={r.id} className="block border-b border-zinc-800/60 p-1.5 hover:bg-zinc-800/40 rounded transition-colors text-[11px]">
             <div className="flex items-start gap-2">
               <input type="checkbox" className="mt-0.5 accent-indigo-600" disabled={busy||active||!!r.disabled} checked={selectedRules.includes(r.id)} onChange={e=>setSelectedRules(list=>e.target.checked?[...list,r.id]:list.filter(id=>id!==r.id))}/>
               <div className="flex-1 min-w-0">
                 <div className="flex items-center gap-1.5 flex-wrap">
                   <span className="font-mono text-zinc-300 font-semibold">{r.originalRuleId}</span>
                   <span className={`text-[9px] px-1 py-0.2 rounded border font-mono ${levelBadge}`}>{levelText}</span>
                   {r.disabled && <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-500 font-mono">{tr('已禁用','Disabled')}</span>}
                   {r.approved ? <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/40 font-mono">{tr('具批准定义','Approved check')}</span> : <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-800/80 text-zinc-400 font-mono">{tr('无批准定义需人工','Manual required')}</span>}
                 </div>
                 <div className="text-zinc-200 mt-0.5">{r.rule||r.material}</div>
                 <div className="text-zinc-500 text-[10px]">{r.source}{r.requirementBasis ? ` · ${tr('依据: ','Basis: ')}${r.requirementBasis}` : ''}</div>
               </div>
             </div>
           </label>
         );
       })}
     </div>
   </details>

   {conditionKeys.length > 0 && <div className="space-y-1.5">
     {conditionKeys.map(key=><label key={key} className="flex items-center gap-2 text-zinc-300">{key} <select className={inputCls} aria-label={key} disabled={busy||active} value={conditions[key]===undefined?'unknown':String(conditions[key])} onChange={e=>setConditions(previous=>{const next={...previous};if(e.target.value==='unknown')delete next[key];else next[key]=e.target.value==='true';return next;})}><option value="unknown">{tr('适用性未确认','Applicability unknown')}</option><option value="true">{tr('明确适用','Confirmed applicable')}</option><option value="false">{tr('明确不适用','Confirmed not applicable')}</option></select></label>)}
   </div>}

   {!rules.some((r:any)=>r.approved)&&<p className="text-amber-400/90 text-[11px]">{tr('当前没有已批准自动检查定义，自动审核不可用；可建立纯人工批次，但未检查不是合规。','No approved automatic checks. You may create a manual batch; unchecked rules are not compliance evidence.')}</p>}

   <div className="flex flex-wrap items-center gap-2 pt-1">
     <button className={btnPrimary} disabled={busy||active||!preflight.settings.enabled||!selection||!hasApproved} onClick={start}>{tr('开始只读审核','Start read-only review')}</button>
     <button className={btnSecondary} disabled={busy||active||!preflight.settings.enabled||!selection||!selectedRules.length} onClick={manual}>{tr('建立纯人工审核批次','Create manual review batch')}</button>
   </div>
   <p className="text-zinc-500 text-[11px]">{tr('勾选未批准自动检查的规则仅用于人工批次；不会授予自动计算资格。','Selecting a rule without an approved check enables manual recording only, not automatic computation.')}</p>

   {job&&<div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2">
     <p>{tr('本次任务','Current run')}: <span className="font-mono font-bold text-indigo-400">{job.status}</span> · <span className="font-mono text-zinc-400">{job.runId}</span></p>
     <div className="flex flex-wrap items-center gap-2">
       {job.jobId&&<button className={btnSecondary} disabled={busy} onClick={query}>{tr('查询本次结果','Query run result')}</button>}
       {active&&<button className={`${btnBase} bg-rose-900/40 text-rose-300 border border-rose-800/40 hover:bg-rose-900/60`} disabled={busy} onClick={cancel}>{tr('取消本次审核','Cancel this review')}</button>}
     </div>
   </div>}

   {job?.error&&<p role="alert" className="text-red-400 bg-red-950/20 border border-red-800/40 p-2 rounded-md">{tr('任务未生成可保存结果：','No storable result was produced: ')}{job.error}</p>}
   {job?.result&&<div className="text-zinc-300 space-y-1 text-xs">
     <p>{tr('一致性状态','Consistency status')}: <span className="font-semibold text-zinc-100">{job.result.consistency}</span> · {tr('选择集采集于','Selection captured at')}: {job.result.selectionCapturedAt||tr('旧记录未提供','Not available in older record')} · {tr('当前有效性未复核','Current validity not rechecked')}</p>
   </div>}

   {job?.result?.mode==='MANUAL'&&<p role="status" className="p-2.5 rounded-lg border border-amber-600/30 bg-amber-600/10 text-amber-300 text-[11px] leading-relaxed">{tr('纯人工批次：完成仅表示批次建立结束，不表示复核已完成。创建过程仅尝试核对项目身份，请查看一致性状态；未读取测量事实，元素当前有效性／模型一致性未复核，计算结果均为未检查。','Manual batch: Completed means batch creation ended, not human review completion. Creation only attempts project identity verification; see the consistency status. Measurements, current element validity and model consistency were not checked. Calculated results remain Not checked.')}</p>}

   {job?.result&&<div className="space-y-2 pt-1">
     <p>{tr('本次使用库／修订','Run library / revision')}: {job.result.libraryId} / {job.result.revision} · {tr('覆盖','Coverage')}: {job.result.coverage}/{job.result.total}</p>
     <p>{tr('历史已保存','History saved')}: {String(job.result.historyStored)} {job.result.historyWarning}</p>
     <p className="text-zinc-500 text-[11px]">{tr('结果仅适用于本次范围，不是全项目合规证明。','Results apply only to this scope, not whole-project compliance.')}</p>
     <button className={btnSecondary} onClick={download}>{tr('导出本次 JSON 证据','Export run JSON evidence')}</button>
     <div className="max-h-64 overflow-auto space-y-2 pt-1">{job.result.results.map((r:any,i:number)=><article key={i} className="border border-zinc-800 bg-zinc-950/40 rounded-lg p-2.5 space-y-1">
       <div className="flex items-center gap-2">
         <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${r.state === 'PASS' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40' : r.state === 'FAIL' ? 'bg-rose-950/60 text-rose-300 border border-rose-800/40' : 'bg-amber-950/60 text-amber-300 border border-amber-800/40'}`}>{states[r.state]||r.state}</span>
         <span className="font-semibold text-zinc-200">{r.originalRuleId||r.ruleId}</span>
       </div>
       <p className="text-zinc-400">{r.sourceText}</p>
       <p className="text-zinc-500 text-[11px]">{r.source}</p>
       <p className="text-zinc-400 font-mono text-[11px]">{r.guid} · {r.reason}</p>
       {r.facts?.map((f:any,j:number)=><p key={j} className="text-zinc-500 font-mono text-[10px]">{f.value} {f.unit} · {f.measurement} · {f.source}</p>)}
     </article>)}</div>
   </div>}

   {job?.result?.historyStored&&<button className={btnSecondary} disabled={busy||active} onClick={loadEvidence}>{tr('读取已保存证据及人工记录','Load saved evidence and review notes')}</button>}

   {evidence&&<fieldset className="border border-zinc-700 bg-zinc-900/30 rounded-xl p-3.5 space-y-2.5" disabled={busy||active}>
    <legend className="font-semibold text-zinc-200 px-1">{tr('人工复核／豁免说明（独立于计算结论）','Human review / waiver notes (separate from calculated verdicts)')}</legend>
    <p className="text-zinc-400 text-[11px]">{tr('复核人是自报标签，未经身份认证。豁免记录不是专业批准，不会将不通过变为通过。','Reviewer is a self-declared, unauthenticated label. A waiver is not professional approval and never turns Fail into Pass.')}</p>
    <p className="text-zinc-300 font-mono text-[11px]">{tr('证据运行','Evidence run')}: {evidence.run.runId} · {tr('原计算状态','Original task state')}: <span className="font-semibold text-indigo-400">{evidence.run.taskState}</span></p>

    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-zinc-300">
        {tr('证据条目','Evidence item')}
        <select aria-label={tr('证据条目','Evidence item')} value={targetIndex} onChange={e=>{setTargetIndex(e.target.value);setLocation(null);}} className={inputCls}>
          {evidence.review.targets.map((r:any,i:number)=><option key={i} value={String(i)}>{r.guid} · {r.ruleId} · {states[evidence.run.results[i].state]||evidence.run.results[i].state}</option>)}
        </select>
      </label>
      <div className="pt-1">
        <button className={btnSecondary} disabled={!evidence.review.targets.length} onClick={locateTarget}>{tr('预览并确认定位GUID（替换选择集）','Preview and confirm GUID locate (replace selection)')}</button>
      </div>
      <p className="text-zinc-500 text-[11px]">{tr('定位会改变选择集，需当前元素身份及会话核验；不缩放、不切换视图、不重算历史规范结论。','Locating changes the selection and requires fresh element/session checks. It does not zoom, switch views or recalculate historical verdicts.')}</p>
      {location&&<p className="text-emerald-400 font-mono text-[11px]">{tr('选择集已回读确认（历史操作记录，不证明之后仍选中）','Selection verified (historical operation, not proof it remains selected)')}: {location.guid} · {location.execution?.operationId}</p>}
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
      <label className="flex flex-col gap-1 text-zinc-300">
        {tr('自报复核人','Self-declared reviewer')}
        <input aria-label={tr('自报复核人','Self-declared reviewer')} maxLength={200} value={reviewer} onChange={e=>setReviewer(e.target.value)} className={inputCls}/>
      </label>
      <label className="flex flex-col gap-1 text-zinc-300">
        {tr('人工处理意见','Manual disposition')}
        <select aria-label={tr('人工处理意见','Manual disposition')} value={disposition} onChange={e=>setDisposition(e.target.value)} className={inputCls}>
          <option value="REVIEWED">{tr('已人工复核','Reviewed')}</option>
          <option value="WAIVER_RECORDED">{tr('记录人工豁免说明','Record waiver note')}</option>
          <option value="REOPENED">{tr('重新提出问题／撤回先前意见','Reopen / withdraw prior opinion')}</option>
        </select>
      </label>
    </div>

    <label className="flex flex-col gap-1 text-zinc-300">
      {tr('原因／依据（必填）','Reason / basis (required)')}
      <textarea aria-label={tr('原因／依据','Reason / basis')} maxLength={4000} value={reason} onChange={e=>setReason(e.target.value)} className={`${inputCls} h-18 resize-y`} />
    </label>

    <div className="flex flex-wrap items-center gap-2 pt-1">
      <button className={btnPrimary} disabled={!reviewer.trim()||!reason.trim()||!evidence.review.targets.length} onClick={saveReview}>{tr('确认保存人工记录','Confirm and save manual note')}</button>
      <button className={btnSecondary} onClick={exportReview}>{tr('导出已读取证据及人工记录','Export loaded evidence and manual notes')}</button>
    </div>

    <div className="max-h-40 overflow-auto space-y-1 border border-zinc-800 rounded-lg p-2 bg-zinc-950/40">
      {evidence.review.events.map((e:any)=><p key={e.eventId} className="text-[11px] text-zinc-400 font-mono">{e.recordedAt} · {e.guid} · {e.ruleId} · #{e.revision} · <span className="text-zinc-200 font-semibold">{dispositions[e.disposition]||e.disposition}</span> · {e.reviewerLabel}: {e.reason}</p>)}
    </div>

    <p className="text-zinc-500 text-[11px]">{tr('复检须重新读取并冻结同一GUID选择集、勾选同一规则、重新确认当前适用条件；库修订可更新。范围变更请开始独立审核。','Recheck requires freshly freezing the same GUIDs, selecting the same rules and confirming current applicability. Library revision may change. Use a separate run for a different scope.')}</p>

    <div className="pt-1">
      <button className={btnSecondary} disabled={!selection||!(evidence.run.mode==='MANUAL'?selectedRules.length:hasApproved)||!preflight.settings.enabled} onClick={recheck}>{evidence.run.mode==='MANUAL'?tr('确认并创建关联人工批次','Confirm and create linked manual batch'):tr('确认并创建关联复检','Confirm and create linked recheck')}</button>
    </div>

    {evidence.run.recheckOf&&<p className="text-zinc-400 text-[11px]">{tr('复检来源','Recheck of')}: {evidence.run.recheckOf.runId}</p>}
    {evidence.review.rechecks.map((r:any)=><p key={r.runId} className="text-zinc-400 text-[11px]">{tr('后续复检','Linked recheck')}: {r.runId} · {r.taskState}</p>)}
   </fieldset>}

   <div className="pt-1">
     <button className={btnSecondary} disabled={busy} onClick={readHistory}>{tr('读取本项目审核历史','Load project review history')}</button>
   </div>

   <div className="max-h-36 overflow-auto space-y-1.5 pt-1">
     {history.map((r:any)=><button key={r.runId} disabled={busy||active} className="w-full text-left px-2.5 py-1.5 rounded-md border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50 text-zinc-300 text-xs font-mono transition-colors disabled:opacity-50 cursor-pointer block" onClick={()=>{setJob({status:r.taskState,result:r,runId:r.runId});setEvidence(null);setLocation(null);}}>{r.runId} · {r.taskState} · {r.libraryId} · {r.historicalSession?tr('历史会话','Historical session'):tr('当前会话','Current session')}</button>)}
   </div>
  </div>}
 </section>;
}
