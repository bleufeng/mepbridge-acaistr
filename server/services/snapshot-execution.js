// SPDX-License-Identifier: MIT
'use strict';
const crypto=require('crypto');
const {hasResultFailure}=require('./bounded-result-summary');
const clone=x=>JSON.parse(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const bindingEqual=(a,b)=>a.port===b.port&&a.projectFingerprint===b.projectFingerprint&&a.sessionId===b.sessionId;
function inputIdentity(request){return hash([request.previewId,request.planHash,request.snapshotHash,request.targetFingerprint]);}
function protocol(request){const p=request.execution;if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>k!=='operationId')||!/^[a-f0-9]{64}$/.test(p.operationId||''))throw Error('SNAPSHOT_EXECUTION_ID_REQUIRED');return p.operationId;}
function validateWorkflow(w){
 if(!w||w.version!==1||!/^[a-f0-9]{64}$/.test(w.inputHash||'')||!Array.isArray(w.steps)||w.steps.length>1000)throw Error('SNAPSHOT_INVALID_WORKFLOW_HISTORY');
 if(w.kind!==undefined&&!['SnapshotReplay','LegacyRoundTrip','CadWallCreate','ViewportStoryCapture','ModelAuditLocate'].includes(w.kind))throw Error('WORKFLOW_INVALID_KIND');
 if(w.evidence!==undefined&&(!Array.isArray(w.evidence)||w.evidence.length>1000||w.evidence.some(e=>!e||typeof e.label!=='string'||!Object.hasOwn(e,'value'))))throw Error('WORKFLOW_INVALID_EVIDENCE');
 for(let i=0;i<w.steps.length;i++){const s=w.steps[i];if(s.index!==i||!/^[a-f0-9]{64}$/.test(s.operationId||'')||!/^[a-f0-9]{64}$/.test(s.requestHash||'')||typeof s.commandName!=='string'||!s.command||s.requestHash!==hash(s.command)||!['DISPATCHED','COMPLETED','UNKNOWN'].includes(s.status)||!['create','cleanup','execute','restore'].includes(s.phase))throw Error('SNAPSHOT_INVALID_WORKFLOW_HISTORY');}
}
class SnapshotExecution {
 constructor({coordinator,kind='SnapshotReplay',requestIdentity=inputIdentity}={}){this.kind=kind;this.inputHash=requestIdentity;if(!coordinator)throw Error('SNAPSHOT_COORDINATOR_REQUIRED');this.coordinator=coordinator;this.store=coordinator.store;}
 async bindPreview(endpoint,project){const binding=await this.coordinator.identify(endpoint,this.coordinator.post);if(project&&binding.projectFingerprint!==crypto.createHash('sha256').update(String(project.projectPath||'').replace(/\\/g,'/').toLowerCase()).digest('hex'))throw Error('SNAPSHOT_PREVIEW_PROJECT_CHANGED');return binding;}
 recover(request){const id=protocol(request),row=this.store.getReceipt(`${id}_s0_a0`);if(!row)return null;if(row.workflow?.inputHash!==this.inputHash(request)||(row.workflow?.kind||'SnapshotReplay')!==this.kind)throw Error('SNAPSHOT_EXECUTION_REQUEST_CONFLICT');const execution=this.coordinator.query(id);
  if(row.status==='COMPLETED')return{...clone(row.result.data),execution:{...execution,replayed:true}};
  return{ok:false,errorType:'SNAPSHOT_EXECUTION_NOT_REPLAYABLE',message:'Query the saved operation; do not restart or clean up an unconfirmed replay.',httpStatus:409,execution};
 }
 async run({request,endpoint,binding},perform){
  const id=protocol(request),recovered=this.recover(request);if(recovered)return recovered;
  const step={action:this.kind,isMutation:true,receiptTarget:binding,commandJson:{command:'SNAPSHOT_REPLAY_WORKFLOW',parameters:{inputHash:this.inputHash(request)}},workflow:{version:1,kind:this.kind,inputHash:this.inputHash(request),previewId:request.previewId,steps:[]}};
  const claim=this.store.claimOperation(id,step);if(!claim.claimed)return this.recover(request);
  const receiptId=claim.receipt.receiptId,owner=this.store.session;let uncertain=false;
  const active=row=>{if(!row||row.writerSession!==owner||row.status!=='DISPATCHED'||row.manualDisposition)throw Error('SNAPSHOT_WORKFLOW_NOT_ACTIVE');};
  const checkpoint=change=>this.store._change(memory=>{const row=memory._receipts.get(receiptId);active(row);return change(row.workflow);});
  const verify=async()=>{active(this.store.getReceipt(receiptId));if(!bindingEqual(binding,await this.coordinator.identify(endpoint,this.coordinator.post)))throw Error('SNAPSHOT_TARGET_SESSION_CHANGED');active(this.store.getReceipt(receiptId));};
  const command=async(targetEndpoint,commandName,parameters,meta={})=>{
   if(uncertain)throw Error('SNAPSHOT_PREVIOUS_CALL_UNCONFIRMED');
   let stepIndex;
   try{
    if(targetEndpoint!==endpoint)throw Error('SNAPSHOT_ENDPOINT_CHANGED');await verify();
    const payload={command:'API.ExecuteAddOnCommand',parameters:{addOnCommandId:{commandNamespace:'MEPBridge',commandName},addOnCommandParameters:clone(parameters||{})}};
    const mutation=require('./execution-coordinator').mutation(payload);
    payload.parameters.addOnCommandParameters={_mepbridgeExecution:{sessionId:binding.sessionId,parameters:payload.parameters.addOnCommandParameters}};
    if(Buffer.byteLength(JSON.stringify(payload))>128*1024)throw Error('SNAPSHOT_STEP_REQUEST_QUOTA');
    if(mutation){if(!['create','cleanup','execute','restore'].includes(meta.phase))throw Error('SNAPSHOT_UNDECLARED_WRITE_PHASE');stepIndex=checkpoint(w=>{if(w.steps.length>=1000)throw Error('SNAPSHOT_STEP_QUOTA');const index=w.steps.length;w.steps.push({index,operationId:hash([id,index,meta.phase]),commandName,phase:meta.phase,sourceGuid:meta.sourceGuid||null,command:clone(payload),requestHash:hash(payload),status:'DISPATCHED'});return index;});}
    const data=(await this.coordinator.post(endpoint,payload,{timeout:30000,proxy:false,maxContentLength:32*1024*1024,headers:{'Content-Type':'application/json'}})).data;
    await verify();const response=data?.result?.addOnCommandResponse;
    if(data?.succeeded!==true||!response||hasResultFailure(data)){const error=Error('SNAPSHOT_COMMAND_RESULT_UNCONFIRMED');error.payload=response;throw error;}
    if(commandName==='GetElementGeometry' && (typeof response.elementGuid!=='string'||response.elementGuid.toLowerCase()!==String(parameters.elementGuid).toLowerCase()||!response.geometry||typeof response.geometry!=='object'))throw Error('SNAPSHOT_READBACK_IDENTITY_UNCONFIRMED');
    if(mutation)checkpoint(w=>{w.steps[stepIndex].status='COMPLETED';w.steps[stepIndex].response=clone(response);});
    return response;
   }catch(error){
    // A structured absence read is needed by the existing cleanup verifier. All
    // other read or write failures poison this run, so no later write is allowed.
    if(stepIndex===undefined&&commandName==='GetElementGeometry'&&require('./snapshot-replay').classifyAbsenceError(error,{commandName,guid:parameters.elementGuid}).state==='absent')throw error;
    uncertain=true;error.executionUncertain=true;
    if(stepIndex!==undefined)try{checkpoint(w=>{w.steps[stepIndex].status='UNKNOWN';w.steps[stepIndex].error=error.message;});}catch(_){}
    throw error;
   }
  };
  try{
   await verify();const output=await perform({command,saveEvidence:(label,value)=>checkpoint(w=>{w.evidence ||= [];if(w.evidence.length>=1000)throw Error('WORKFLOW_EVIDENCE_QUOTA');w.evidence.push({label,value:clone(value)});})});await verify();
   if(uncertain||!output?.ok||!['completed','failed-cleaned'].includes(output.result?.status))throw Error('SNAPSHOT_FINAL_RESULT_UNCONFIRMED');
   if(!this.store.markCompleted(receiptId,{data:output}))throw Error('SNAPSHOT_COMPLETION_NOT_SAVED');
   return{...output,execution:this.coordinator.query(id)};
  }catch(error){
   try{this.store.markFailed(receiptId,error.message,true);}catch(_){}
   let execution;try{execution=this.coordinator.query(id);}catch(_){execution={operationId:id,status:'UNKNOWN',recoveryRequired:true};}
   return{ok:false,errorType:'SNAPSHOT_EXECUTION_UNCONFIRMED',message:error.message,httpStatus:409,execution,operationMayBeCommitted:true};
  }
 }
}
let singleton;function getSnapshotExecution(){return singleton||(singleton=new SnapshotExecution({coordinator:require('./execution-coordinator').getExecutionCoordinator()}));}
module.exports={SnapshotExecution,getSnapshotExecution,validateWorkflow,protocol};
