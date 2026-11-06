import {workbenchFetch as fetch} from '../execution-recovery';
﻿import {useEffect,useRef,useState} from 'react';
type Lang='zh-CN'|'en-US';
export default function ModelAuditPanel({lang}:{lang:Lang}) {
 const zh=lang==='zh-CN',tr=(cn:string,en:string)=>zh?cn:en;
 const [port,setPort]=useState('19723'),[context,setContext]=useState<any>(null),[preflight,setPreflight]=useState<any>(null),[selection,setSelection]=useState<any>(null),[selectedRules,setSelectedRules]=useState<string[]>([]),[conditions,setConditions]=useState<Record<string,boolean>>({}),[job,setJob]=useState<any>(null),[history,setHistory]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [location,setLocation]=useState<any>(null);
 const [evidence,setEvidence]=useState<any>(null),[targetIndex,setTargetIndex]=useState('0'),[disposition,setDisposition]=useState('REVIEWED'),[reviewer,setReviewer]=useState(''),[reason,setReason]=useState('');
 const gate=useRef(false),epoch=useRef(0),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
 async function api(path:string,body?:any){const response=await fetch('/api/model-audit'+path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(response.ok===false||!data.ok)throw Error(data.error||data.message||'AUDIT_UNKNOWN');return data;}
 async function act(fn:(valid:()=>boolean)=>Promise<void>){if(gate.current)return;gate.current=true;setBusy(true);setError('');const revision=epoch.current;const valid=()=>mounted.current&&epoch.current===revision;try{await fn(valid);}catch(e:any){if(valid())setError(e.message);}finally{gate.current=false;if(valid())setBusy(false);}}
 const prefix=context?'/'+context.contextId:'';
 async function bind(){setLocation(null);await act(async valid=>{const data=await api('/bind',{targetPort:Number(port)});if(valid()){setContext(data);setPreflight(data.preflight);setSelection(null);setSelectedRules([]);setConditions({});setJob(null);setEvidence(null);setLocation(null);setHistory([]);}});}
 async function refresh(){await act(async valid=>{const data=await api(prefix+'/preflight');if(valid())setPreflight(data.preflight);});}
 async function enable(enabled:boolean){if(enabled&&!window.confirm(tr('只启用本项目审核入口，不自动扫描。是否确认？','Enable review for this project without automatic scanning?')))return;await act(async valid=>{if(!enabled&&valid()){setSelection(null);setPreflight((p:any)=>({...p,settings:{...p.settings,enabled:false,locallyStopped:true}}));}const data=await api(prefix+'/settings',{enabled,expectedRevision:preflight.settings.revision,confirmed:enabled});if(valid())setPreflight((p:any)=>({...p,settings:data.settings}));});}
 async function capture(){await act(async valid=>{const data=await api(prefix+'/selection',{});if(valid())setSelection(data.selection);});}
 async function start(){await act(async valid=>{const data=await api(prefix+'/start',{selectionId:selection?.selectionId,selectedRuleIds:selectedRules,conditions,settingsRevision:preflight.settings.revision,libraryRevision:preflight.revision,libraryId:preflight.libraryId});if(valid()){setJob(data);setEvidence(null);setSelection(null);}});}
 async function manual(){if(!window.confirm(tr('只建立人工审核批次，冻结已选GUID及当前库原文；核对项目身份但不读取几何或计算合规。所有计算项保持未检查。继续？','Create a manual batch of frozen GUIDs and library text; verify project identity only, with no geometry read or compliance computation. All calculated items remain Not checked. Continue?')))return;await act(async valid=>{const data=await api(prefix+'/manual',{confirmed:true,selectionId:selection?.selectionId,selectedRuleIds:selectedRules,conditions:{},settingsRevision:preflight.settings.revision,libraryRevision:preflight.revision,libraryId:preflight.libraryId});if(valid()){setJob(data);setEvidence(null);setSelection(null);}});}
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
 async function recheck(){if(!window.confirm(evidence.run.mode==='MANUAL'?tr('创建同范围的新人工批次，不读取测量事实、不自动判断或修改旧证据。继续？','Create a new same-scope manual batch, without reading measurements, automatic verdicts or changing old evidence. Continue?'):tr('以重新冻结的同一GUID范围和规则、当前库修订及项目条件生成新审核，不覆盖旧记录。继续？','Create a new run for the freshly frozen same GUIDs and rules, with current library revision and conditions; keep the old evidence?')))return;await act(async valid=>{const data=await api(prefix+'/recheck',{parentRunId:evidence.run.runId,evidenceHash:evidence.review.evidenceHash,confirmed:true,selectionId:selection?.selectionId,selectedRuleIds:selectedRules,conditions:evidence.run.mode==='MANUAL'?{}:conditions,settingsRevision:preflight.settings.revision,libraryRevision:preflight.revision,libraryId:preflight.libraryId});if(valid()){setJob(data);setEvidence(null);setSelection(null);}});}
 function exportReview(){if(!evidence)return;const blob=new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`MACAI-model-review-with-notes-${evidence.run.runId}.json`;link.click();URL.revokeObjectURL(url);}
 function download(){if(!job?.result)return;const blob=new Blob([JSON.stringify(job.result,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`MACAI-model-review-${job.result.runId}.json`;link.click();URL.revokeObjectURL(url);}
 const rules=preflight?.rules||[],hasApproved=rules.some((r:any)=>r.approved&&selectedRules.includes(r.id));
 const conditionKeys=[...new Set<string>(rules.filter((r:any)=>r.approved&&selectedRules.includes(r.id)&&r.applicabilityKey).map((r:any)=>r.applicabilityKey))];
 const active=job?.status==='RUNNING';
 const dispositions:Record<string,string>={REVIEWED:tr('已人工复核','Reviewed'),WAIVER_RECORDED:tr('已记录豁免说明','Waiver note recorded'),REOPENED:tr('重新提出问题／撤回先前意见','Reopened / prior opinion withdrawn')};
 const states:Record<string,string>={PASS:tr('通过','Pass'),FAIL:tr('不通过','Fail'),INDETERMINATE:tr('无法判断','Indeterminate'),NOT_APPLICABLE:tr('不适用','Not applicable'),NOT_CHECKED:tr('未检查','Not checked')};
 return <section className="border-b border-zinc-800 p-3 space-y-2 text-xs">
  <h3 className="font-semibold">{tr('模型审核（独立、默认关闭）','Model review (independent, off by default)')}</h3>
  <p>{tr('只审核明确选择的元素；不会自动扫描、修复或调用 AI。计划校验与模型审核互不接管。','Only explicitly selected elements are reviewed. No automatic scan, repair or AI calls. Plan validation and model review are separate.')}</p>
  <label>{tr('目标 Archicad 端口','Target Archicad port')} <input aria-label={tr('审核目标端口','Review target port')} value={port} disabled={busy||active} onChange={e=>{epoch.current++;setPort(e.target.value);setContext(null);setPreflight(null);setSelection(null);setJob(null);setEvidence(null);setHistory([]);}} className="bg-zinc-900 w-24" /></label>
  <button disabled={busy||active||!/^197(?:2[3-9]|3[0-9]|4[0-3])$/.test(port)} onClick={bind}>{tr('确认项目连接','Confirm project binding')}</button>
  {error&&<p role="alert" className="text-red-400">{tr('未完成，请核对：','Not completed; check: ')}{error}</p>}
  {context&&preflight&&<>
   <p>{tr('项目指纹','Project fingerprint')}: {context.project.projectFingerprint} · {tr('会话','Session')}: {context.project.sessionId}</p>
   <p>{tr('当前库','Current library')}: {preflight.libraryId} · {tr('修订','Revision')}: {preflight.revision}</p>
   <p>{tr('实际计划拦截','Actual plan validation')}: {preflight.automaticPlanValidation} · {tr('本项目模型审核','Project model review')}: {preflight.settings.enabled?'ON':'OFF'}</p>
   {preflight.settings.reconfirmationRequired&&<p>{tr('新会话，需要重新确认启用。历史不代表正在监控。','New session: re-enable explicitly. History is not active monitoring.')}</p>}
   <button disabled={busy||active} onClick={refresh}>{tr('刷新审核预检','Refresh preflight')}</button>
   <button disabled={busy} onClick={()=>enable(!preflight.settings.enabled)}>{preflight.settings.enabled?tr('关闭并停止本项目审核','Disable and stop project review'):tr('启用审核入口','Enable review entry')}</button>
   <button disabled={busy||active||!preflight.settings.enabled} onClick={capture}>{tr('读取并冻结当前选择集','Read and freeze current selection')}</button>
   {selection&&<p>{tr('已冻结元素数','Frozen element count')}: {selection.guids.length}</p>}
   <details><summary>{tr('规则、原文与可执行资格','Rules, original text and eligibility')} ({rules.length})</summary><div className="max-h-48 overflow-auto">{rules.map((r:any)=><label key={r.id} className="block border-b border-zinc-800 p-1"><input type="checkbox" disabled={busy||active||!!r.disabled} checked={selectedRules.includes(r.id)} onChange={e=>setSelectedRules(list=>e.target.checked?[...list,r.id]:list.filter(id=>id!==r.id))}/>{r.originalRuleId} · {r.rule||r.material} · {r.source} · {r.approved?tr('已批准检查定义','Approved check definition'):tr('无批准检查定义或已禁用；不自动判断','No approved check or disabled; no automatic verdict')}</label>)}</div></details>
   {conditionKeys.map(key=><label key={key} className="block">{key} <select aria-label={key} disabled={busy||active} value={conditions[key]===undefined?'unknown':String(conditions[key])} onChange={e=>setConditions(previous=>{const next={...previous};if(e.target.value==='unknown')delete next[key];else next[key]=e.target.value==='true';return next;})}><option value="unknown">{tr('适用性未确认','Applicability unknown')}</option><option value="true">{tr('明确适用','Confirmed applicable')}</option><option value="false">{tr('明确不适用','Confirmed not applicable')}</option></select></label>)}
   {!rules.some((r:any)=>r.approved)&&<p>{tr('当前没有已批准自动检查定义，自动审核不可用；可建立纯人工批次，但未检查不是合规。','No approved automatic checks. You may create a manual batch; unchecked rules are not compliance evidence.')}</p>}
   <button disabled={busy||active||!preflight.settings.enabled||!selection||!hasApproved} onClick={start}>{tr('开始只读审核','Start read-only review')}</button>
   <button disabled={busy||active||!preflight.settings.enabled||!selection||!selectedRules.length} onClick={manual}>{tr('建立纯人工审核批次','Create manual review batch')}</button>
   <p>{tr('勾选未批准自动检查的规则仅用于人工批次；不会授予自动计算资格。','Selecting a rule without an approved check enables manual recording only, not automatic computation.')}</p>
   {job&&<><p>{tr('本次任务','Current run')}: {job.status} · {job.runId}</p>{job.jobId&&<button disabled={busy} onClick={query}>{tr('查询本次结果','Query run result')}</button>}{active&&<button disabled={busy} onClick={cancel}>{tr('取消本次审核','Cancel this review')}</button>}</>}
   {job?.error&&<p role="alert">{tr('任务未生成可保存结果：','No storable result was produced: ')}{job.error}</p>}
   {job?.result&&<p>{tr('一致性状态','Consistency status')}: {job.result.consistency} · {tr('选择集采集于','Selection captured at')}: {job.result.selectionCapturedAt||tr('旧记录未提供','Not available in older record')} · {tr('当前有效性未复核','Current validity not rechecked')}</p>}
   {job?.result?.mode==='MANUAL'&&<p role="status">{tr('纯人工批次：完成仅表示批次建立结束，不表示复核已完成。创建过程仅尝试核对项目身份，请查看一致性状态；未读取测量事实，元素当前有效性／模型一致性未复核，计算结果均为未检查。','Manual batch: Completed means batch creation ended, not human review completion. Creation only attempts project identity verification; see the consistency status. Measurements, current element validity and model consistency were not checked. Calculated results remain Not checked.')}</p>}
   {job?.result&&<><p>{tr('本次使用库／修订','Run library / revision')}: {job.result.libraryId} / {job.result.revision} · {tr('覆盖','Coverage')}: {job.result.coverage}/{job.result.total}</p><p>{tr('历史已保存','History saved')}: {String(job.result.historyStored)} {job.result.historyWarning}</p><p>{tr('结果仅适用于本次范围，不是全项目合规证明。','Results apply only to this scope, not whole-project compliance.')}</p><button onClick={download}>{tr('导出本次 JSON 证据','Export run JSON evidence')}</button><div className="max-h-64 overflow-auto">{job.result.results.map((r:any,i:number)=><article key={i} className="border-b border-zinc-800 p-1"><strong>{states[r.state]||r.state}</strong> · {r.originalRuleId||r.ruleId}<p>{r.sourceText}</p><p>{r.source}</p><p>{r.guid} · {r.reason}</p>{r.facts?.map((f:any,j:number)=><p key={j}>{f.value} {f.unit} · {f.measurement} · {f.source}</p>)}</article>)}</div></>}
   {job?.result?.historyStored&&<button disabled={busy||active} onClick={loadEvidence}>{tr('读取已保存证据及人工记录','Load saved evidence and review notes')}</button>}
   {evidence&&<fieldset className="border border-zinc-700 p-2 space-y-2" disabled={busy||active}>
    <legend>{tr('人工复核／豁免说明（独立于计算结论）','Human review / waiver notes (separate from calculated verdicts)')}</legend>
    <p>{tr('复核人是自报标签，未经身份认证。豁免记录不是专业批准，不会将不通过变为通过。','Reviewer is a self-declared, unauthenticated label. A waiver is not professional approval and never turns Fail into Pass.')}</p>
    <p>{tr('证据运行','Evidence run')}: {evidence.run.runId} · {tr('原计算状态','Original task state')}: {evidence.run.taskState}</p>
    <label>{tr('证据条目','Evidence item')} <select aria-label={tr('证据条目','Evidence item')} value={targetIndex} onChange={e=>{setTargetIndex(e.target.value);setLocation(null);}}>{evidence.review.targets.map((r:any,i:number)=><option key={i} value={String(i)}>{r.guid} · {r.ruleId} · {states[evidence.run.results[i].state]||evidence.run.results[i].state}</option>)}</select></label>
    <button disabled={!evidence.review.targets.length} onClick={locateTarget}>{tr('预览并确认定位GUID（替换选择集）','Preview and confirm GUID locate (replace selection)')}</button>
    <p>{tr('定位会改变选择集，需当前元素身份及会话核验；不缩放、不切换视图、不重算历史规范结论。','Locating changes the selection and requires fresh element/session checks. It does not zoom, switch views or recalculate historical verdicts.')}</p>
    {location&&<p>{tr('选择集已回读确认（历史操作记录，不证明之后仍选中）','Selection verified (historical operation, not proof it remains selected)')}: {location.guid} · {location.execution?.operationId}</p>}
    <label>{tr('自报复核人','Self-declared reviewer')} <input aria-label={tr('自报复核人','Self-declared reviewer')} maxLength={200} value={reviewer} onChange={e=>setReviewer(e.target.value)}/></label>
    <label>{tr('人工处理意见','Manual disposition')} <select aria-label={tr('人工处理意见','Manual disposition')} value={disposition} onChange={e=>setDisposition(e.target.value)}><option value="REVIEWED">{tr('已人工复核','Reviewed')}</option><option value="WAIVER_RECORDED">{tr('记录人工豁免说明','Record waiver note')}</option><option value="REOPENED">{tr('重新提出问题／撤回先前意见','Reopen / withdraw prior opinion')}</option></select></label>
    <label>{tr('原因／依据（必填）','Reason / basis (required)')} <textarea aria-label={tr('原因／依据','Reason / basis')} maxLength={4000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button disabled={!reviewer.trim()||!reason.trim()||!evidence.review.targets.length} onClick={saveReview}>{tr('确认保存人工记录','Confirm and save manual note')}</button>
    <div className="max-h-40 overflow-auto">{evidence.review.events.map((e:any)=><p key={e.eventId}>{e.recordedAt} · {e.guid} · {e.ruleId} · #{e.revision} · {dispositions[e.disposition]||e.disposition} · {e.reviewerLabel}: {e.reason}</p>)}</div>
    <button onClick={exportReview}>{tr('导出已读取证据及人工记录','Export loaded evidence and manual notes')}</button>
    <p>{tr('复检须重新读取并冻结同一GUID选择集、勾选同一规则、重新确认当前适用条件；库修订可更新。范围变更请开始独立审核。','Recheck requires freshly freezing the same GUIDs, selecting the same rules and confirming current applicability. Library revision may change. Use a separate run for a different scope.')}</p>
    <button disabled={!selection||!(evidence.run.mode==='MANUAL'?selectedRules.length:hasApproved)||!preflight.settings.enabled} onClick={recheck}>{evidence.run.mode==='MANUAL'?tr('确认并创建关联人工批次','Confirm and create linked manual batch'):tr('确认并创建关联复检','Confirm and create linked recheck')}</button>
    {evidence.run.recheckOf&&<p>{tr('复检来源','Recheck of')}: {evidence.run.recheckOf.runId}</p>}
    {evidence.review.rechecks.map((r:any)=><p key={r.runId}>{tr('后续复检','Linked recheck')}: {r.runId} · {r.taskState}</p>)}
   </fieldset>}
   <button disabled={busy} onClick={readHistory}>{tr('读取本项目审核历史','Load project review history')}</button>
   <div className="max-h-32 overflow-auto">{history.map((r:any)=><button key={r.runId} disabled={busy||active} className="block" onClick={()=>{setJob({status:r.taskState,result:r,runId:r.runId});setEvidence(null);setLocation(null);}}>{r.runId} · {r.taskState} · {r.libraryId} · {r.historicalSession?tr('历史会话','Historical session'):tr('当前会话','Current session')}</button>)}</div>
  </>}
 </section>;
}
