// SPDX-License-Identifier: MIT
'use strict';
// Independent model audit engine. No HTTP route, no default scanning, no model writes or LLM.
const crypto=require('crypto');
const clone=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const STATES=['PASS','FAIL','INDETERMINATE','NOT_APPLICABLE','NOT_CHECKED'];
function identity(project){
 if(!project||project.saved!==true||!Number.isInteger(project.port)||project.port<19723||project.port>19743||!/^[a-f0-9]{64}$/i.test(project.projectFingerprint||'')||typeof project.sessionId!=='string'||!project.sessionId||project.sessionId.length>128)throw Error('AUDIT_CONFIRMED_SAVED_PROJECT_REQUIRED');
 return hash([project.port,project.projectFingerprint.toLowerCase(),project.sessionId]);
}
class ModelAuditEngine {
 constructor({readFacts,confirmIdentity,approvedDefinitions=[],store=null,maxElements=500,maxResults=5000,maxBytes=2*1024*1024,maxMillis=30000}={}) {
  if(typeof readFacts!=='function'||typeof confirmIdentity!=='function')throw Error('AUDIT_READ_ADAPTER_REQUIRED');
  for(const [value,limit]of [[maxElements,500],[maxResults,5000],[maxBytes,2*1024*1024],[maxMillis,30000]])if(!Number.isSafeInteger(value)||value<1||value>limit)throw Error('AUDIT_INVALID_QUOTA');
  this.readFacts=readFacts;this.confirmIdentity=confirmIdentity;this.definitions=freeze(clone(approvedDefinitions));
  this.maxElements=maxElements;this.maxResults=maxResults;this.maxBytes=maxBytes;this.maxMillis=maxMillis;
  this.settings=new Map();this.running=new Map();this.history=[];
  this.store=store;
 }
 setEnabled(project,enabled,{expectedRevision=0}={}) {
  if(typeof enabled!=='boolean')throw Error('AUDIT_INVALID_SETTING');const key=identity(project);
  if(!enabled)this.cancel(project); // Stop in-flight reads even if the settings file is unreadable.
  const current=this.status(project);
  if(expectedRevision!==current.revision)throw Error('AUDIT_SETTINGS_CONFLICT');
  if(this.store)return this.store.setEnabled(project,enabled,{expectedRevision});
  const next={enabled,revision:current.revision+1};this.settings.set(key,next);return clone(next);
 }

 status(project){const key=identity(project);if(this.store)return this.store.settings(project);return clone(this.settings.get(key)||{enabled:false,revision:0});}
 cancel(project){const token=this.running.get(identity(project));if(token)token.cancelled=true;}
 async start({project,librarySnapshot,selectedGuids,selectedRuleIds,settingsRevision,runId,recheckOf,mode='AUTOMATIC',selectionCapturedAt}) {
  if(!['AUTOMATIC','MANUAL'].includes(mode))throw Error('AUDIT_INVALID_MODE');
  const key=identity(project),setting=this.status(project);
  if(!setting.enabled||setting.revision!==settingsRevision)throw Error('AUDIT_DISABLED_OR_STALE_START');
  if(this.running.has(key))throw Error('AUDIT_ALREADY_RUNNING');
  if(!Array.isArray(selectedGuids)||!selectedGuids.length||selectedGuids.length>this.maxElements||selectedGuids.some(g=>typeof g!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(g))||new Set(selectedGuids).size!==selectedGuids.length)throw Error('AUDIT_SELECTION_INVALID_OR_OVER_BUDGET');
  if(!librarySnapshot||typeof librarySnapshot.activeLibraryId!=='string'||!Number.isSafeInteger(librarySnapshot.revision)||!Array.isArray(librarySnapshot.rules)||!Array.isArray(selectedRuleIds)||new Set(selectedRuleIds).size!==selectedRuleIds.length)throw Error('AUDIT_LIBRARY_SNAPSHOT_REQUIRED');
  if(selectedGuids.length*librarySnapshot.rules.length>this.maxResults)throw Error('AUDIT_RESULT_QUOTA');
  const snapshot=freeze(clone({project,librarySnapshot,selectedGuids,selectedRuleIds,settingsRevision,mode,selectionCapturedAt}));
  if (Buffer.byteLength(JSON.stringify(snapshot)) > this.maxBytes) throw Error("AUDIT_SNAPSHOT_QUOTA");
  if (librarySnapshot.rules.some(r=>!r||typeof r.id!=="string"||!r.id)||new Set(librarySnapshot.rules.map(r=>r.id)).size!==librarySnapshot.rules.length||selectedRuleIds.some(id=>typeof id!=="string"||!librarySnapshot.rules.some(r=>r.id===id))) throw Error("AUDIT_RULE_IDENTITIES_INVALID");
  const token={cancelled:false},started=Date.now(),results=[];
  const run={runId:runId||crypto.randomUUID(),projectKey:key,startedAt:new Date(started).toISOString(),snapshotHash:hash(snapshot),libraryId:snapshot.librarySnapshot.activeLibraryId,revision:snapshot.librarySnapshot.revision,taskState:'RUNNING',consistency:'UNCONFIRMED',results,coverage:0,total:snapshot.selectedGuids.length*snapshot.librarySnapshot.rules.length};
  run.mode=mode;run.selectionCapturedAt=selectionCapturedAt||null;
  if(mode==='MANUAL')run.ruleSnapshots=clone(snapshot.librarySnapshot.rules);
  run.selectedGuids=snapshot.selectedGuids;run.selectedRuleIds=snapshot.selectedRuleIds;run.projectConditions=snapshot.project.conditions||{};run.settingsRevision=snapshot.settingsRevision;
  if(recheckOf)run.recheckOf=clone(recheckOf);
  if(Buffer.byteLength(JSON.stringify(run))>this.maxBytes-1024)throw Error('AUDIT_SNAPSHOT_QUOTA');
  this.running.set(key,token);
  const check=()=>{if(token.cancelled)throw Error('AUDIT_CANCELLED');if(Date.now()-started>this.maxMillis)throw Error('AUDIT_TIME_QUOTA');};
  const bounded = fn => {
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('AUDIT_TIME_QUOTA')), Math.max(1, this.maxMillis - (Date.now() - started))); });
    return Promise.race([Promise.resolve().then(fn), deadline]).finally(() => clearTimeout(timer));
  };
  try {
   check();const before=await bounded(() => this.confirmIdentity(snapshot.project,token));check();if(identity(before)!==key||typeof before.revisionToken!=='string'||!before.revisionToken)throw Error('AUDIT_IDENTITY_OR_CONSISTENCY_UNKNOWN');
   for(const guid of snapshot.selectedGuids) {
    check();const hasApproved = mode==='AUTOMATIC'&&snapshot.librarySnapshot.rules.some(rule => !rule.disabled && snapshot.selectedRuleIds.includes(rule.id) && this.definitions.some(d => d.libraryId===snapshot.librarySnapshot.activeLibraryId && d.ruleId===rule.id && d.ruleHash===hash(rule) && d.professionalApprovalId && d.version));
    const facts=hasApproved ? await bounded(() => this.readFacts({project:snapshot.project,guid,signal:token})) : null;check();
    for(const rule of snapshot.librarySnapshot.rules) {
     const result={guid,ruleId:rule.id,ruleHash:hash(rule),category:rule.category||null,originalRuleId:rule.originalRuleId||rule.id,sourceText:rule.rule||rule.material||'',source:rule.source||'',severity:rule.severity||'info',state:'NOT_CHECKED',reason:'NOT_SELECTED_OR_DISABLED',facts:[]};
     if(mode==='MANUAL'){result.reason=snapshot.selectedRuleIds.includes(rule.id)&&!rule.disabled?'MANUAL_REVIEW_ONLY_NO_AUTOMATIC_VERDICT':'NOT_SELECTED_OR_DISABLED';}
     if(mode==='AUTOMATIC'&&snapshot.selectedRuleIds.includes(rule.id)&&!rule.disabled) {
      const definition=this.definitions.find(d=>d.libraryId===snapshot.librarySnapshot.activeLibraryId&&d.ruleId===rule.id&&d.ruleHash===hash(rule)&&d.professionalApprovalId&&d.version);
      if(definition){result.definitionVersion=definition.version;result.definitionHash=hash(definition);result.professionalApprovalId=definition.professionalApprovalId;}
      if(!definition)result.reason='NO_APPROVED_CHECK_DEFINITION';
      else if(!facts||facts.ok!==true||facts.guid!==guid||facts.projectKey!==key||!Array.isArray(facts.values)){result.state='INDETERMINATE';result.reason='FACT_READ_FAILED_OR_WRONG_IDENTITY';}
      else if(!definition.elementTypes?.includes(facts.elementType)){result.reason='UNSUPPORTED_ELEMENT_TYPE';}
      else {
       // Applicability is a confirmed explicit project condition, never guessed from UI locale/region.
       const applicability=definition.applicabilityKey&&snapshot.project.conditions?.[definition.applicabilityKey];
       if(applicability===false){result.state='NOT_APPLICABLE';result.reason='CONFIRMED_PROJECT_CONDITION';}
       else if(applicability!==true){result.state='INDETERMINATE';result.reason='APPLICABILITY_NOT_CONFIRMED';}
       else {
        const fact=facts.values.find(v=>v.key===definition.factKey);
        if(!fact||fact.complete!==true||fact.measurement!==definition.measurement||fact.unit!==definition.unit||typeof fact.value!=='number'||!Number.isFinite(fact.value)||!fact.source){result.state='INDETERMINATE';result.reason='MISSING_OR_UNQUALIFIED_MEASUREMENT';}
        else if(!['min','max'].includes(definition.operator)||!Number.isFinite(definition.threshold)){result.reason='CHECKER_UNSUPPORTED';}
        else {result.state=(definition.operator==='min'?fact.value>=definition.threshold:fact.value<=definition.threshold)?'PASS':'FAIL';result.reason='DETERMINISTIC_PARAMETER_CHECK';result.facts=[{key:fact.key,value:fact.value,unit:fact.unit,measurement:fact.measurement,source:String(fact.source),modificationStamp:fact.modificationStamp||null,complete:true}];result.definitionVersion=definition.version;}
       }
      }
     }
     if(Buffer.byteLength(JSON.stringify({...run,results:[...results,result]}))>this.maxBytes-1024)throw Error('AUDIT_BYTE_QUOTA');results.push(result);
    }
   }
   check();const after=await bounded(() => this.confirmIdentity(snapshot.project,token));check();if(identity(after)!==key||after.revisionToken!==before.revisionToken)throw Error('AUDIT_MODEL_CHANGED_OR_UNCONFIRMED');
   run.consistency=mode==='MANUAL'?'PROJECT_IDENTITY_ONLY_MODEL_NOT_CHECKED':'CONFIRMED_FOR_SELECTED_READ_SCOPE';
   if(mode==='AUTOMATIC')run.factSnapshotHash=before.revisionToken;
   run.taskState='COMPLETED';
  } catch(error) {run.taskState=error.message==='AUDIT_CANCELLED'?'CANCELLED':'PARTIAL';run.error=error.message;for(const result of results)if(result.state==='PASS'){result.state='INDETERMINATE';result.reason='RUN_NOT_CONFIRMED';}}
  finally{token.cancelled = true; this.running.delete(key);}
  run.finishedAt=new Date().toISOString();
  run.coverage=results.filter(r=>['PASS','FAIL','NOT_APPLICABLE'].includes(r.state)).length;
  run.counts=Object.fromEntries(STATES.map(state=>[state,results.filter(r=>r.state===state).length]));
  run.overallPass=run.taskState==='COMPLETED'&&run.total>0&&results.length===run.total&&run.counts.PASS>0&&run.counts.PASS+run.counts.NOT_APPLICABLE===run.total;
  if(this.store) {
    try { this.store.append(snapshot.project,run);run.historyStored=true; }
    catch(error) { run.historyStored=false;run.historyWarning=error.message; }
    return clone(run);
  }
  // Bounded process-local history; persistence and UI activation are separate integration gates.
  const frozen=freeze(clone(run));
  run.historyStored = Buffer.byteLength(JSON.stringify([...this.history,frozen])) <= this.maxBytes;
  if (run.historyStored) this.history.push(frozen); else run.historyWarning = "AUDIT_HISTORY_QUOTA_EXPLICIT_EXPORT_REQUIRED";
  return clone(run);
 }
 getHistory(project){const key=identity(project);if(this.store)return this.store.history(project);return clone(this.history.filter(r=>r.projectKey===key));}
}
module.exports={ModelAuditEngine,identity,ruleHash:hash,STATES};
