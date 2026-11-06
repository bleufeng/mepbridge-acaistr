// SPDX-License-Identifier: MIT
'use strict';
const crypto=require('crypto');
const {ModelAuditEngine,identity,ruleHash}=require('./model-audit-engine');
const {FACTS,GUID}=require('./model-audit-adapter');
const clone=x=>JSON.parse(JSON.stringify(x));
const token=()=>crypto.randomBytes(32).toString('hex');
const categories=['buildingCode','mepStandard','material'];
function snapshot(kb){const view=kb.createSnapshot();if(view.loadState!=='READY')throw Error('AUDIT_KB_NOT_READY');return{activeLibraryId:view.activeLibraryId,revision:view.revision,rules:categories.flatMap(category=>(view[category]||[]).map(rule=>({...clone(rule),id:`${category}:${rule.id}`,originalRuleId:rule.id,category})))};}
class ModelAuditService {
 constructor({adapter,store,kb,definitions=[],now=Date.now,locator=null}={}){
  this.adapter=adapter;this.store=store;this.kb=kb;this.now=now;this.contexts=new Map();this.jobs=new Map();this.running=new Map();this.stopped=new Set();
  this.locator=locator;
  this.definitions=clone(definitions);
  for(const d of this.definitions){const fact=FACTS[d.factKey];if(!fact||d.measurement!==fact.measurement||d.unit!==fact.unit||!Array.isArray(d.elementTypes)||d.elementTypes.some(t=>!fact.types.includes(t))||!d.professionalApprovalId||!d.version||!d.applicabilityKey||!['min','max'].includes(d.operator)||!Number.isFinite(d.threshold)||!/^[a-f0-9]{64}$/.test(d.ruleHash||''))throw Error('AUDIT_UNQUALIFIED_DEFINITION');}
 }
 prune(){for(const [id,c]of this.contexts)if(c.expires<this.now()&&!this.running.has(identity(c.project)))this.contexts.delete(id);}
 context(id){const c=this.contexts.get(id);if(!c)throw Error('AUDIT_CONTEXT_UNKNOWN_REBIND');if(c.expires<this.now()&&!this.running.has(identity(c.project)))throw Error('AUDIT_CONTEXT_EXPIRED_REBIND');return c;}
 settings(project){const setting=this.store.settings(project);return this.stopped.has(identity(project))?{...setting,enabled:false,locallyStopped:true}:setting;}
 async bind(port){if(!Number.isInteger(port)||port<19723||port>19743)throw Error('AUDIT_INVALID_PORT');this.prune();if(this.contexts.size>=100)throw Error('AUDIT_CONTEXT_QUOTA');const project=await this.adapter.bind(port);const id=token();this.contexts.set(id,{project,expires:this.now()+30*60*1000,selection:null});return{contextId:id,project,settings:this.settings(project),preflight:this.preflight(id)};}
 preflight(id){const c=this.context(id),library=snapshot(this.kb);return{libraryId:library.activeLibraryId,revision:library.revision,settings:this.settings(c.project),automaticPlanValidation:this.kb.getStatus().automaticPlanValidation,rules:library.rules.map(rule=>{const definition=this.definitions.find(d=>d.libraryId===library.activeLibraryId&&d.ruleId===rule.id&&d.ruleHash===ruleHash(rule));return{...rule,approved:!!definition&&!rule.disabled,definitionVersion:definition?.version,applicabilityKey:definition?.applicabilityKey,reason:rule.disabled?'RULE_DISABLED':definition?'APPROVED_CHECK':'NO_APPROVED_CHECK_DEFINITION'};}),runningJobId:this.running.get(identity(c.project))||null};}
 async enable(id,{enabled,expectedRevision,confirmed=false}={}){
  const c=this.context(id),key=identity(c.project);if(typeof enabled!=='boolean')throw Error('AUDIT_INVALID_SETTING');
  if(!enabled){this.stopped.add(key);this.cancel(id);c.selection=null;}else{if(confirmed!==true)throw Error('AUDIT_ENABLE_CONFIRMATION_REQUIRED');await this.adapter.verify(c.project);}
  const result=this.store.setEnabled(c.project,enabled,{expectedRevision});if(enabled)this.stopped.delete(key);return result;
 }
 async select(id){const c=this.context(id);if(!this.settings(c.project).enabled)throw Error('AUDIT_DISABLED');const guids=await this.adapter.selection(c.project);if(!this.settings(c.project).enabled)throw Error('AUDIT_DISABLED');const selectionId=token();c.selection={selectionId,guids,capturedAt:new Date(this.now()).toISOString(),expires:this.now()+5*60*1000};return clone(c.selection);}
 start(id,{selectionId,selectedRuleIds,conditions={},settingsRevision,libraryRevision,libraryId}={},recheckOf=null,mode='AUTOMATIC'){
  if(!['AUTOMATIC','MANUAL'].includes(mode))throw Error('AUDIT_INVALID_MODE');
  const c=this.context(id),key=identity(c.project),library=snapshot(this.kb),setting=this.settings(c.project);
  if(!setting.enabled||setting.revision!==settingsRevision)throw Error('AUDIT_DISABLED_OR_STALE_START');
  if(this.running.has(key))throw Error('AUDIT_ALREADY_RUNNING');
  if(!c.selection||c.selection.selectionId!==selectionId||c.selection.expires<this.now())throw Error('AUDIT_SELECTION_EXPIRED_OR_UNKNOWN');
  if(libraryRevision!==library.revision||libraryId!==library.activeLibraryId)throw Error('AUDIT_LIBRARY_CHANGED_REVIEW_AGAIN');
  if(!Array.isArray(selectedRuleIds)||!selectedRuleIds.length||new Set(selectedRuleIds).size!==selectedRuleIds.length||selectedRuleIds.some(id=>!library.rules.some(r=>r.id===id&&!r.disabled)))throw Error('AUDIT_RULE_SELECTION_INVALID');
  const approved=mode==='MANUAL'?[]:this.definitions.filter(d=>d.libraryId===library.activeLibraryId&&library.rules.some(r=>r.id===d.ruleId&&!r.disabled&&selectedRuleIds.includes(r.id)&&ruleHash(r)===d.ruleHash));
  if(mode==='AUTOMATIC'&&!approved.length)throw Error('AUDIT_NO_APPROVED_CHECKS');
  if(!conditions||typeof conditions!=='object'||Array.isArray(conditions)||Object.keys(conditions).length>100||Object.entries(conditions).some(([k,v])=>!approved.some(d=>d.applicabilityKey===k)||typeof v!=='boolean'))throw Error('AUDIT_INVALID_PROJECT_CONDITIONS');
  if(c.selection.guids.length*library.rules.length>5000)throw Error('AUDIT_RESULT_QUOTA');
  if(this.jobs.size>=100)throw Error('AUDIT_JOB_RETENTION_QUOTA');
  const project={...clone(c.project),conditions:clone(conditions)},guids=clone(c.selection.guids),scope=this.adapter.scope(project,guids,{collect:mode==='AUTOMATIC'}),engine=new ModelAuditEngine({...scope,store:this.store,approvedDefinitions:approved});
  const selectionCapturedAt=c.selection.capturedAt;
  const jobId=token(),runId=crypto.randomUUID();const job={jobId,contextId:id,runId,projectKey:key,engine,status:'RUNNING',result:null};this.jobs.set(jobId,job);this.running.set(key,jobId);c.selection=null;
  job.promise=engine.start({project,librarySnapshot:library,selectedGuids:guids,selectedRuleIds,settingsRevision,runId,recheckOf,mode,selectionCapturedAt}).then(result=>{job.status=result.taskState;job.result=result;}).catch(error=>{job.status='PARTIAL';job.error=error.message;}).finally(()=>{this.running.delete(key);job.engine=null;});
  return{jobId,runId,mode,status:'RUNNING',selectedCount:guids.length};
 }
 manual(id,input={}){if(input.confirmed!==true)throw Error('AUDIT_MANUAL_CONFIRMATION_REQUIRED');return this.start(id,input,null,'MANUAL');}
 job(id,jobId){const c=this.context(id),job=this.jobs.get(jobId);if(!job||job.projectKey!==identity(c.project))throw Error('AUDIT_JOB_UNKNOWN');return{jobId,runId:job.runId,status:job.status,result:clone(job.result),error:job.error};}
 cancel(id){const c=this.context(id),job=this.jobs.get(this.running.get(identity(c.project)));if(job?.engine)job.engine.cancel(c.project);return{cancelRequested:!!job};}
 evidence(id,runId){return this.store.evidence(this.context(id).project,runId);}
 review(id,runId,input){return this.store.recordReview(this.context(id).project,{...input,runId});}
 recheck(id,input={}){
  const c=this.context(id),parent=this.store.evidence(c.project,input.parentRunId),{sameSet}=require('./model-audit-review');
  if(input.confirmed!==true)throw Error('AUDIT_RECHECK_CONFIRMATION_REQUIRED');
  if(input.evidenceHash!==parent.review.evidenceHash)throw Error('AUDIT_REVIEW_EVIDENCE_CHANGED');
  if(!sameSet(parent.run.selectedGuids,c.selection?.guids)||!sameSet(parent.run.selectedRuleIds,input.selectedRuleIds)||input.libraryId!==parent.run.libraryId)throw Error('AUDIT_RECHECK_SCOPE_CHANGED_START_NEW_RUN');
  // The normal admission path checks fresh selection, settings/library revisions and approvals.
  // Automatic mode rereads facts; manual mode verifies identity only. Neither inherits opinions.
  return this.start(id,input,{runId:parent.run.runId,evidenceHash:parent.review.evidenceHash},parent.run.mode==='MANUAL'?'MANUAL':'AUTOMATIC');
 }
 location(){return this.locator ||= new (require('./model-audit-locate').ModelAuditLocate)({adapter:this.adapter,store:this.store,coordinator:require('./execution-coordinator').getExecutionCoordinator(),now:this.now});}
 async locatePreview(id,runId,input){const c=this.context(id);if(this.running.has(identity(c.project)))throw Error('AUDIT_LOCATE_JOB_RUNNING');return this.location().preview(c.project,runId,input);}
 async locate(id,runId,input){const c=this.context(id);if(this.running.has(identity(c.project)))throw Error('AUDIT_LOCATE_JOB_RUNNING');const result=await this.location().locate(c.project,runId,input);c.selection=null;return result;}
 history(id){return this.store.history(this.context(id).project);}
}
let singleton;
function getModelAuditService(){if(!singleton){const {ModelAuditAdapter}=require('./model-audit-adapter'),{ModelAuditStore}=require('./model-audit-store');singleton=new ModelAuditService({adapter:new ModelAuditAdapter({post:(...args)=>require('axios').post(...args)}),store:new ModelAuditStore({directory:require('./runtime-paths').dataPath('model-review')}),kb:require('./knowledge-base'),definitions:require('./model-audit-definitions').approvedDefinitions});}return singleton;}
module.exports={ModelAuditService,getModelAuditService,snapshot};
