// SPDX-License-Identifier: MIT
'use strict';
// Deterministic data dependencies only. No host I/O, LLM calls or approval waits.
const GUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SLOTS={
 GetElementGeometry:{key:'elementGuid',aliases:['guid']},GetElementProperties:{key:'elementGuid',aliases:['guid']},
 GetMEPElementInfo:{key:'routeGuid',aliases:['elementGuid','guid']},
 GetElementMesh:{key:'guids',aliases:['elementGuid','guid'],many:true},
 MoveElements:{key:'guids',aliases:['guid','elementGuid'],many:true},DeleteElements:{key:'guids',aliases:['guid','elementGuid'],many:true}
};
const clone=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(a)?.toLowerCase()===JSON.stringify(b)?.toLowerCase();
const literal=v=>typeof v==='string'&&GUID.test(v);
function slot(step){return SLOTS[step.action];}
function values(step){const spec=slot(step);if(!spec)return[];const carriers=[step.params,step.commandJson?.parameters?.addOnCommandParameters];
 return carriers.flatMap((c,carrier)=>c&&typeof c==='object'&&!Array.isArray(c)?[spec.key,...spec.aliases].filter(k=>c[k]!==undefined&&c[k]!==null).map(k=>({carrier,key:k,value:spec.many&&!Array.isArray(c[k])?[c[k]]:c[k]})):[]);
}
function conflict(step){const vals=values(step),explicit=vals.filter(x=>Array.isArray(x.value)?x.value.length>0&&x.value.every(literal):literal(x.value));
 if(explicit.some(v=>!same(v.value,explicit[0].value)))return'TARGET_PARAMETER_CONFLICT';return null;
}
function sourceFor(token,consumerIndex,steps){
 if(typeof token!=='string')return null;
 const match=token.match(/^\$\{([^}]+)\}$|^\{\{([^}]+)\}\}$/);if(!match)return null;const ref=(match[1]||match[2]).trim();
 const named=ref.match(/^(?:steps\.)?([A-Za-z0-9_-]+)\.(?:guid|guids|elementGuid|routeGuid|createdGuid|result\.(?:guid|guids))$/);
 if(named){const matches=steps.map((s,i)=>(s.id===named[1]||s._sourceStepId===named[1])?i:-1).filter(i=>i>=0);return matches.length===1&&matches[0]<consumerIndex?matches[0]:-1;}
 if(/^(prev(?:ious)?(?:Guid|Guids)?|上一步(?:获得的.*GUID|结果)?)$/i.test(ref))return consumerIndex-1;
 if(/^(createdGuid|createdGuids)$/i.test(ref)){for(let i=consumerIndex-1;i>=0;i--)if(/^Create/.test(steps[i].action))return i;return -1;}
 return -1;
}
function extract(step,result){
 if(result?.ok!==true||result.response?.succeeded===false)return{state:'UNAVAILABLE'};
 const response=result.addOnResponse||result.response?.result?.addOnCommandResponse;
 if(!response||typeof response!=='object'||response.status!=='ok')return{state:'UNAVAILABLE'};
 let guids;
 if(step.action==='GetSelectedElements'){
  if(!Array.isArray(response.elements))return{state:'UNAVAILABLE'};
  guids=response.elements.map(e=>e?.guid);if(!guids.length)return{state:'EMPTY_SELECTION',guids:[]};
 }else if(/^Create/.test(step.action)){
  const aliases=['guid','wallGuid','columnGuid','beamGuid','slabGuid','elementGuid'].map(k=>response[k]).filter(v=>v!==undefined);
  if(aliases.some(v=>!literal(v))||new Set(aliases.map(g=>g.toLowerCase())).size>1)return{state:'UNAVAILABLE'};
  guids=response.journal?.createdGuids||(aliases.length?[aliases[0]]:[]);
  if(aliases.length&&Array.isArray(guids)&&!guids.some(g=>same(g,aliases[0])))return{state:'UNAVAILABLE'};
 }else return{state:'UNAVAILABLE'};
 if(!Array.isArray(guids)||!guids.length||guids.some(g=>!literal(g))||new Set(guids.map(g=>g.toLowerCase())).size!==guids.length)return{state:'UNAVAILABLE'};
 return{state:'READY',guids};
}
function resolve(step,index,steps,results){
 const spec=slot(step);if(!spec)return{ok:true};const bad=conflict(step);if(bad)return{ok:false,code:bad};
 const entries=values(step);if(!entries.length)return{ok:true};
 if(!spec.many&&entries.some(e=>Array.isArray(e.value)))return{ok:false,code:'TARGET_RESULT_AMBIGUOUS'};
 let emptySource=null;
 function bind(value){
  if(literal(value))return{ok:true,value};
  const source=sourceFor(value,index,steps);if(source===null)return{ok:false,code:'TARGET_GUID_INVALID'};
  if(source<0)return{ok:false,code:'TARGET_RESULT_REFERENCE_UNRESOLVED'};
  const outcome=extract(steps[source],results.get(source)||steps[source].result);
  if(outcome.state==='EMPTY_SELECTION'){emptySource=source;return{ok:false,code:'TARGET_SELECTION_EMPTY'};}
  if(outcome.state!=='READY')return{ok:false,code:'TARGET_RESULT_UNAVAILABLE'};
  if(!spec.many&&outcome.guids.length!==1)return{ok:false,code:'TARGET_RESULT_AMBIGUOUS'};
  return{ok:true,value:spec.many?outcome.guids:outcome.guids[0]};
 }
 // An explicit carrier is authoritative, but contradictory concrete items in a
 // mixed carrier must never disappear during normalization.
 const concrete=entries.find(e=>Array.isArray(e.value)?e.value.length&&e.value.every(literal):literal(e.value));
 const resolved=[];
 for(const entry of entries){
  const list=Array.isArray(entry.value)?entry.value:[entry.value];let out=[];
  for(const v of list){const b=bind(v);if(!b.ok){
    if(concrete&&typeof v==='string'&&sourceFor(v,index,steps)!==null)continue;
    return{ok:false,code:b.code,emptySource};
   }out.push(...(Array.isArray(b.value)?b.value:[b.value]));}
  const final=spec.many?out:out[0];resolved.push(final);
 }
 let final=concrete?.value||resolved[0];
 if(concrete){for(let i=0;i<entries.length;i++){const entry=entries[i],items=Array.isArray(entry.value)?entry.value:[entry.value];for(const v of items.filter(literal))if(!(Array.isArray(final)?final:[final]).some(g=>same(g,v)))return{ok:false,code:'TARGET_PARAMETER_CONFLICT'};if(items.some(literal)&&!same(resolved[i],final))return{ok:false,code:'TARGET_PARAMETER_CONFLICT'};}}
 else if(resolved.some(v=>!same(v,final)))return{ok:false,code:'TARGET_PARAMETER_CONFLICT'};
 if((spec.many&&(!Array.isArray(final)||!final.length))||(!spec.many&&!literal(final)))return{ok:false,code:'TARGET_GUID_INVALID'};
 step.params||={};const carriers=[step.params,step.commandJson?.parameters?.addOnCommandParameters];for(const c of carriers)if(c){c[spec.key]=clone(final);for(const alias of spec.aliases)delete c[alias];}
 return{ok:true};
}
function protectedChange(before,after){
 const existing=values(before),candidate=values(after);if(!slot(before))return null;
 if(!existing.length&&candidate.length)return'TARGET_REFINEMENT_CHANGE_REJECTED';
 for(const item of existing){const originalItems=Array.isArray(item.value)?item.value:[item.value];const concrete=originalItems.filter(literal);
  if(originalItems.some(v=>!literal(v))){const proposed=candidate.find(c=>c.carrier===item.carrier&&c.key===item.key);if(!proposed||!same(item.value,proposed.value))return'TARGET_REFINEMENT_CHANGE_REJECTED';}
  if(!concrete.length)continue;
  const corresponding=candidate.find(c=>c.carrier===item.carrier&&c.key===item.key)||candidate.find(c=>c.carrier===item.carrier);
  if(!corresponding)return'TARGET_REFINEMENT_CHANGE_REJECTED';
  const proposed=Array.isArray(corresponding.value)?corresponding.value:[corresponding.value];
  if(concrete.some(g=>!proposed.some(v=>same(g,v))))return'TARGET_REFINEMENT_CHANGE_REJECTED';
  if((Array.isArray(item.value)?item.value.every(literal):literal(item.value))&&!same(item.value,corresponding.value))return'TARGET_REFINEMENT_CHANGE_REJECTED';
 }
 return conflict(after);
}
module.exports={resolve,conflict,protectedChange,extract,sourceFor,values};
