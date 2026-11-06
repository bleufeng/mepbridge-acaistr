// SPDX-License-Identifier: MIT
'use strict';
const crypto=require('crypto');
const {SnapshotExecution}=require('./snapshot-execution');
const {digest}=require('./cad-snapshot-contract');
const {GUID}=require('./model-audit-adapter');
const {target}=require('./model-audit-review');
const clone=x=>JSON.parse(JSON.stringify(x));
function fail(code){throw Object.assign(Error(code),{httpStatus:409});}
function selected(data){
 if(data?.status!=='ok'||!Array.isArray(data.elements)||data.elements.length>500||data.elements.some(e=>!e||e.hasHeader!==true||!GUID.test(e.guid||'')))fail('AUDIT_LOCATE_SELECTION_UNCONFIRMED');
 const guids=data.elements.map(e=>e.guid.toLowerCase());if(new Set(guids).size!==guids.length)fail('AUDIT_LOCATE_SELECTION_UNCONFIRMED');return guids.sort();
}
function element(data,guid){
 if(data?.status!=='ok'||data.elementGuid?.toLowerCase()!==guid||typeof data.elementType!=='string'||!data.elementType||!/^\d{1,20}$/.test(data.modificationStamp||'')||BigInt(data.modificationStamp)>18446744073709551615n)fail('AUDIT_LOCATE_ELEMENT_IDENTITY_UNCONFIRMED');
 return {guid,elementType:data.elementType,modificationStamp:data.modificationStamp};
}
class ModelAuditLocate {
 constructor({coordinator,adapter,store,now=Date.now,ttlMs=5*60*1000}={}){
  this.adapter=adapter;this.store=store;this.now=now;this.ttlMs=ttlMs;this.previews=new Map();
  this.workflow=new SnapshotExecution({coordinator,kind:'ModelAuditLocate',requestIdentity:r=>digest(['ModelAuditLocate',r.projectFingerprint,r.targetPort,r.runId,r.previewId,r.previewHash])});
 }
 evidence(project,runId,body){
  const ev=this.store.evidence(project,runId);
  if(ev.review.evidenceHash!==body.evidenceHash)fail('AUDIT_LOCATE_EVIDENCE_CHANGED');
  if(typeof body.guid!=='string'||!GUID.test(body.guid)||/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(body.guid)||!ev.run.selectedGuids?.includes(body.guid))fail('AUDIT_LOCATE_GUID_NOT_IN_SAVED_SCOPE');
  const item=target(ev.run,body.guid,body.ruleId);
  if(require('./model-audit-review').hash(item)!==body.resultHash)fail('AUDIT_LOCATE_RESULT_CHANGED');
  return ev;
 }
 async preview(project,runId,body={}){
  for(const k of Object.keys(body))if(!['guid','ruleId','evidenceHash','resultHash'].includes(k))fail('AUDIT_LOCATE_PREVIEW_INVALID_FIELD');
  const ev=this.evidence(project,runId,body),guid=body.guid.toLowerCase(),endpoint='http://127.0.0.1:'+project.port;
  await this.adapter.verify(project);const binding=await this.workflow.bindPreview(endpoint);
  if(binding.projectFingerprint!==project.projectFingerprint||binding.sessionId!==project.sessionId)fail('AUDIT_LOCATE_TARGET_CHANGED');
  const live=element(await this.adapter.read(project,'GetElementGeometry',{elementGuid:guid}),guid);
  const before=selected(await this.adapter.read(project,'GetSelectedElements',{onlyEditable:false,includeAabb:false,includeMepInfo:false}));
  const again=element(await this.adapter.read(project,'GetElementGeometry',{elementGuid:guid}),guid);
  await this.adapter.verify(project);if(digest(live)!==digest(again))fail('AUDIT_LOCATE_ELEMENT_CHANGED');
  this.evidence(project,runId,body);
  for(const [id,p]of this.previews)if(p.expiresAt<=this.now())this.previews.delete(id);
  if(this.previews.size>=100)fail('AUDIT_LOCATE_PREVIEW_CAPACITY');
  const previewId=crypto.randomUUID(),frozen={project:clone(project),binding,endpoint,runId,guid,ruleId:body.ruleId,evidenceHash:body.evidenceHash,resultHash:body.resultHash,
   live,before,expiresAt:this.now()+this.ttlMs},previewHash=digest(frozen);
  this.previews.set(previewId,{...frozen,previewHash});
  return {ok:true,previewId,previewHash,expiresAt:frozen.expiresAt,target:binding,runId,guid,elementType:live.elementType,modificationStamp:live.modificationStamp,
   previousSelectionCount:before.length,effect:'REPLACE_SELECTION_WITH_SAVED_RESULT_GUID',changesModelGeometry:false,restoresPreviousSelection:false,
   reviewValidity:'CURRENT_ELEMENT_IDENTITY_ONLY_NOT_RECHECKED',historicalSession:ev.run.projectKey!==require('./model-audit-engine').identity(project)};
 }
 async locate(project,runId,body={}){
  if(body.confirmed!==true)fail('AUDIT_LOCATE_CONFIRMATION_REQUIRED');
  for(const k of Object.keys(body))if(!['previewId','previewHash','confirmed','execution'].includes(k))fail('AUDIT_LOCATE_OVERRIDE_FORBIDDEN');
  if(typeof body.previewId!=='string'||!/^[a-f0-9]{64}$/.test(body.previewHash||''))fail('AUDIT_LOCATE_PREVIEW_REQUIRED');
  const request={...body,runId,projectFingerprint:project.projectFingerprint,targetPort:project.port};const saved=this.workflow.recover(request);if(saved)return this.flatten(saved);
  const frozen=this.previews.get(body.previewId);
  if(!frozen||frozen.expiresAt<=this.now())fail('AUDIT_LOCATE_PREVIEW_EXPIRED');
  if(frozen.previewHash!==body.previewHash||frozen.runId!==runId||require('./model-audit-engine').identity(project)!==require('./model-audit-engine').identity(frozen.project))fail('AUDIT_LOCATE_PREVIEW_TARGET_CHANGED');
  this.evidence(project,runId,frozen);await this.adapter.verify(project);
  const output=await this.workflow.run({request,endpoint:frozen.endpoint,binding:frozen.binding},async({command,saveEvidence})=>{
   this.evidence(project,runId,frozen);
   const before=selected(await command(frozen.endpoint,'GetSelectedElements',{onlyEditable:false,includeAabb:false,includeMepInfo:false}));
   const live=element(await command(frozen.endpoint,'GetElementGeometry',{elementGuid:frozen.guid}),frozen.guid);
   if(digest(before)!==digest(frozen.before))fail('AUDIT_LOCATE_SELECTION_CHANGED');
   if(digest(live)!==digest(frozen.live))fail('AUDIT_LOCATE_ELEMENT_CHANGED');
   if(frozen.expiresAt<=this.now())fail('AUDIT_LOCATE_PREVIEW_EXPIRED');
   saveEvidence('audit-locate-before',{runId,guid:frozen.guid,ruleId:frozen.ruleId,evidenceHash:frozen.evidenceHash,resultHash:frozen.resultHash,element:live,selection:before});
   const applied=await command(frozen.endpoint,'SetSelectedElements',{guids:[frozen.guid],mode:'replace',dryRun:false,confirmRequired:true},{phase:'execute'});
   if(applied.status!=='ok'||applied.mode!=='applied'||applied.selectionMode!=='replace'||applied.requestedCount!==1||applied.validCount!==1||applied.selectedCount!==1)fail('AUDIT_LOCATE_APPLY_UNCONFIRMED');
   const after=selected(await command(frozen.endpoint,'GetSelectedElements',{onlyEditable:false,includeAabb:false,includeMepInfo:false}));
   if(after.length!==1||after[0]!==frozen.guid)fail('AUDIT_LOCATE_SELECTION_READBACK_MISMATCH');
   const final=element(await command(frozen.endpoint,'GetElementGeometry',{elementGuid:frozen.guid}),frozen.guid);
   if(digest(final)!==digest(frozen.live))fail('AUDIT_LOCATE_ELEMENT_CHANGED_AFTER_SELECTION');
   this.evidence(project,runId,frozen);
   const result={status:'completed',runId,guid:frozen.guid,ruleId:frozen.ruleId,target:frozen.binding,selectedGuids:after,elementIdentity:final,
    selectionVerified:true,reviewValidity:'CURRENT_ELEMENT_IDENTITY_ONLY_NOT_RECHECKED',changesModelGeometry:false,restoresPreviousSelection:false,zoomed:false};
   saveEvidence('audit-locate-after',result);return {ok:true,result};
  });return this.flatten(output);
 }
 flatten(output){const {result,...envelope}=output;return {...(result||{}),...envelope};}
}
module.exports={ModelAuditLocate};
