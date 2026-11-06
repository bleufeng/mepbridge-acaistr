// SPDX-License-Identifier: MIT
'use strict';
// Manual annotations are append-only, self-declared opinions, never calculation verdicts.
const {ruleHash:hash}=require('./model-audit-engine');
const DISPOSITIONS=Object.freeze(['REVIEWED','WAIVER_RECORDED','REOPENED']);
const sameSet=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x));
function findRun(state,key,runId){const entry=state.runs.find(e=>e.projectFingerprint===key&&e.run.runId===runId);if(!entry)throw Error('AUDIT_REVIEW_RUN_UNKNOWN');return entry.run;}
function target(run,guid,ruleId){const matches=run.results.filter(r=>r.guid===guid&&r.ruleId===ruleId);if(matches.length!==1)throw Error('AUDIT_REVIEW_TARGET_UNKNOWN_OR_AMBIGUOUS');return matches[0];}
function text(value,max){return typeof value==='string'&&value.trim().length>0&&Buffer.byteLength(value)<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);}
function validEvent(event){return event&&typeof event.eventId==='string'&&/^[a-f0-9-]{36}$/.test(event.eventId)&&Number.isSafeInteger(event.revision)&&event.revision>0&&DISPOSITIONS.includes(event.disposition)&&text(event.reviewerLabel,200)&&text(event.reason,4000)&&event.authority==='SELF_DECLARED_NOT_AUTHENTICATED'&&event.doesNotChangeCalculation===true&&typeof event.recordedAt==='string'&&Number.isFinite(Date.parse(event.recordedAt))&&typeof event.recordedSession==='string'&&event.recordedSession.length>0&&event.recordedSession.length<=128;}
function validateManualRun(run){
 if(run.mode===undefined||run.mode==='AUTOMATIC')return;
 if(run.mode!=='MANUAL'||!Array.isArray(run.ruleSnapshots)||!Array.isArray(run.selectedGuids)||!Array.isArray(run.selectedRuleIds)||run.overallPass!==false||run.coverage!==0||run.factSnapshotHash!==undefined||!run.counts||run.counts.NOT_CHECKED!==run.results.length||['PASS','FAIL','INDETERMINATE','NOT_APPLICABLE'].some(s=>run.counts[s]!==0))throw Error('AUDIT_INVALID_MANUAL_RUN');
 if(run.taskState==='COMPLETED'&&(run.consistency!=='PROJECT_IDENTITY_ONLY_MODEL_NOT_CHECKED'||run.results.length!==run.total))throw Error('AUDIT_INVALID_MANUAL_RUN');
 if(run.ruleSnapshots.some(r=>!r||typeof r.id!=='string')||new Set(run.ruleSnapshots.map(r=>r.id)).size!==run.ruleSnapshots.length||!sameSet(run.selectedGuids,run.selectedGuids)||!sameSet(run.selectedRuleIds,run.selectedRuleIds)||run.total!==run.selectedGuids.length*run.ruleSnapshots.length)throw Error('AUDIT_INVALID_MANUAL_RUN');
 const pairs=new Set();
 for(const result of run.results){
  const original=run.ruleSnapshots.find(r=>r.id===result.ruleId),key=JSON.stringify([result.guid,result.ruleId]);
  if(!original||!run.selectedGuids.includes(result.guid)||pairs.has(key)||result.ruleHash!==hash(original)||result.sourceText!==(original.rule||original.material||'')||result.source!==(original.source||'')||result.state!=='NOT_CHECKED'||!Array.isArray(result.facts)||result.facts.length||result.definitionHash!==undefined||result.definitionVersion!==undefined||result.professionalApprovalId!==undefined||!['MANUAL_REVIEW_ONLY_NO_AUTOMATIC_VERDICT','NOT_SELECTED_OR_DISABLED'].includes(result.reason))throw Error('AUDIT_INVALID_MANUAL_RUN');
  pairs.add(key);
 }
}
function validateReviews(state){
 for(const entry of state.runs)validateManualRun(entry.run);
 if(!Array.isArray(state.reviews)||state.reviews.length>1000)throw Error('AUDIT_INVALID_REVIEW_HISTORY');
 const revisions=new Map(),ids=new Set(),hashes=new Map();
 const runHash=run=>{if(!hashes.has(run))hashes.set(run,hash(run));return hashes.get(run);};
 for(const event of state.reviews){
  if(!validEvent(event)||ids.has(event.eventId))throw Error('AUDIT_INVALID_REVIEW_HISTORY');ids.add(event.eventId);
  const run=findRun(state,event.projectFingerprint,event.runId),result=target(run,event.guid,event.ruleId);
  if(event.evidenceHash!==runHash(run)||event.resultHash!==hash(result))throw Error('AUDIT_REVIEW_EVIDENCE_CHANGED');
  const key=JSON.stringify([event.projectFingerprint,event.runId,event.guid,event.ruleId]),previous=revisions.get(key)||0;
  if(event.revision!==previous+1)throw Error('AUDIT_INVALID_REVIEW_REVISION');revisions.set(key,event.revision);
 }
 for(const entry of state.runs)if(entry.run.recheckOf){
  const parent=findRun(state,entry.projectFingerprint,entry.run.recheckOf.runId);
  if(parent===entry.run||(parent.mode||'AUTOMATIC')!==(entry.run.mode||'AUTOMATIC')||parent.libraryId!==entry.run.libraryId||entry.run.recheckOf.evidenceHash!==runHash(parent)||!sameSet(parent.selectedGuids,entry.run.selectedGuids)||!sameSet(parent.selectedRuleIds,entry.run.selectedRuleIds)||state.runs.findIndex(e=>e.run===parent)>=state.runs.indexOf(entry))throw Error('AUDIT_INVALID_RECHECK_LINK');
 }
}
function reviewView(state,key,runId){
 const run=findRun(state,key,runId),events=state.reviews.filter(e=>e.projectFingerprint===key&&e.runId===runId);
 return{runId,evidenceHash:hash(run),authority:'SELF_DECLARED_NOT_AUTHENTICATED',doesNotChangeCalculation:true,
  targets:run.results.map(r=>({guid:r.guid,ruleId:r.ruleId,resultHash:hash(r),revision:events.filter(e=>e.guid===r.guid&&e.ruleId===r.ruleId).length})),events,
  rechecks:state.runs.filter(e=>e.projectFingerprint===key&&e.run.recheckOf?.runId===runId).map(e=>({runId:e.run.runId,taskState:e.run.taskState,historyStored:true}))};
}
module.exports={DISPOSITIONS,hash,findRun,target,text,validEvent,validateReviews,reviewView,sameSet};
