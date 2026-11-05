// SPDX-License-Identifier: MIT
'use strict';
const crypto = require('crypto');
const {getOfficialApiCapabilities} = require('./official-api-capabilities');
const descriptors = require('../../ai-adapter/tool-descriptors.json').descriptors;
const {DurableReceiptStore} = require('./durable-receipt-store');
const {hasResultFailure} = require('./bounded-result-summary');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const OP_ID = /^[a-f0-9]{64}$/;
function operationId(input) {
  if (input === undefined) return crypto.randomBytes(32).toString('hex');
  if (typeof input !== 'string' || !OP_ID.test(input)) throw Object.assign(Error('EXEC_INVALID_OPERATION_ID'), {statusCode:400});
  return input;
}
function mutation(command) {
  if (command.command !== 'API.ExecuteAddOnCommand') return getOfficialApiCapabilities(command.command)?.mutation !== false;
  const id = command.parameters?.addOnCommandId;
  if (id?.commandNamespace !== 'MEPBridge') throw Object.assign(Error('EXEC_NAMESPACE_REJECTED'), {statusCode:400});
  const descriptor = descriptors.find(row => row.commandName === id.commandName);
  if (!descriptor) throw Object.assign(Error('EXEC_UNKNOWN_COMMAND'), {statusCode:400});
  return descriptor.riskLevel !== 'read' && command.parameters?.addOnCommandParameters?.dryRun !== true;
}
function endpointPort(endpoint) {
  const url = new URL(endpoint);
  const port = Number(url.port);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !Number.isInteger(port) || port<19723 || port>19743) throw Error('EXEC_INVALID_LOCAL_ENDPOINT');
  return port;
}
async function captureTarget(endpoint, post) {
  const port = endpointPort(endpoint);
  const result = await post(endpoint, {command:'API.ExecuteAddOnCommand', parameters:{addOnCommandId:{commandNamespace:'MEPBridge',commandName:'GetProjectInfo'},addOnCommandParameters:{}}}, {timeout:5000});
  const payload = result?.data, response = payload?.result?.addOnCommandResponse, project = response?.projectInfo;
  if (payload?.succeeded !== true || response?.status !== 'ok' || project?.teamwork !== false || project?.sessionIdentityAvailable !== true || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(project?.sessionId || '')) throw Error('EXEC_SAVED_PROJECT_SESSION_REQUIRED');
  const sessionId = project.sessionId.toLowerCase();
  if (project.untitled === true) {
    return {port, projectKind:'UNTITLED', projectFingerprint:digest('untitled-session:' + sessionId), sessionId};
  }
  if (typeof project.projectPath !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/)/.test(project.projectPath)) throw Error('EXEC_SAVED_PROJECT_SESSION_REQUIRED');
  return {port, projectKind:'SAVED', projectFingerprint:digest(String(project.projectPath).replace(/\\/g,'/').toLowerCase()), sessionId};
}
function sameTarget(a,b) {
  if (!a || !b) return false;
  return a.port === b.port && a.projectFingerprint === b.projectFingerprint && a.sessionId === b.sessionId;
}
function publicReceipt(row) {
  if (!row) return null;
  return {operationId:row.chainId, status:row.status, action:row.action, createdAt:row.createdAt,
    completedAt:row.completedAt, requestHash:row.requestHash, target:row.targetIdentity,
    result:row.result, ...(row.workflow ? {workflow:row.workflow} : {}), manualDisposition:row.manualDisposition || null, recoveryRequired:!row.manualDisposition && ['UNKNOWN','TIMEOUT_UNVERIFIED','DISPATCHED','PENDING'].includes(row.status),
    recoveryReason:row.recoveryReason || null, note:row.recoveryNote || null};
}
class ExecutionCoordinator {
  constructor({store,post,identify=captureTarget}={}) {
    if (!store || typeof post !== 'function') throw Error('EXEC_COORDINATOR_DEPENDENCIES_REQUIRED');
    this.store=store;this.post=post;this.identify=identify;
  }
  query(id) { if (id === undefined) throw Object.assign(Error('EXEC_INVALID_OPERATION_ID'),{statusCode:400}); operationId(id); const receipt=publicReceipt(this.store.getReceipt(`${id}_s0_a0`)); return receipt || {operationId:id,status:'UNKNOWN',recoveryRequired:true,recoveryReason:'NO_DURABLE_RECEIPT'}; }
  annotate(id,note) {
    operationId(id);
    if(typeof note!=='string'||!note.trim()||note.length>2000)throw Object.assign(Error('EXEC_INVALID_RECOVERY_NOTE'),{statusCode:400});
    return this.store._change(store=>{const row=store._receipts.get(`${id}_s0_a0`);if(!row)throw Error('EXEC_RECEIPT_NOT_FOUND');row.recoveryNote={text:note,at:new Date().toISOString()};return publicReceipt(row);});
  }
  async settle(id,{confirmed,note}={}) {
    operationId(id);
    if (confirmed !== true || typeof note !== 'string' || !note.trim() || note.length>2000) throw Object.assign(Error('EXEC_MANUAL_SETTLEMENT_CONFIRMATION_REQUIRED'),{statusCode:400});
    const original=this.store.getReceipt(`${id}_s0_a0`);
    if (!original || !['UNKNOWN','TIMEOUT_UNVERIFIED','DISPATCHED','PENDING'].includes(original.status)) throw Error('EXEC_UNRESOLVED_RECEIPT_REQUIRED');
    const current=await this.identify(`http://127.0.0.1:${original.targetIdentity.port}`,this.post);
    const isUntitled = original.targetIdentity.projectKind === 'UNTITLED';
    if (isUntitled) {
      if (current.sessionId === original.targetIdentity.sessionId) throw Error('EXEC_NEW_CONFIRMED_PROJECT_SESSION_REQUIRED');
    } else {
      if (current.projectFingerprint!==original.targetIdentity.projectFingerprint || current.sessionId===original.targetIdentity.sessionId) throw Error('EXEC_NEW_CONFIRMED_PROJECT_SESSION_REQUIRED');
    }
    return this.store._change(store=>{
      const row=store._receipts.get(original.receiptId);
      if(!row || row.manualDisposition || row.requestHash!==original.requestHash || !['UNKNOWN','TIMEOUT_UNVERIFIED','DISPATCHED','PENDING'].includes(row.status))throw Error('EXEC_RECOVERY_STATE_CHANGED');
      row.status='UNKNOWN'; // The new baseline is not proof of the original command outcome.
      row.manualDisposition={kind:'ACCEPT_CURRENT_MODEL_BASELINE',at:new Date().toISOString(),note,confirmedSession:current.sessionId};
      return publicReceipt(row); // keep computed UNKNOWN, do not fabricate completion or permit replay
    });
  }
  async execute({id:providedId,command,endpoint,target,complete,allowUnresolved}={}) {
    const id=operationId(providedId), frozen=copy(command);
    if (!mutation(frozen)) return {data:(await this.post(endpoint,frozen,{timeout:30000})).data,execution:null};
    const binding=target || await this.identify(endpoint,this.post);
    if (frozen.parameters?.addOnCommandParameters?._mepbridgeExecution !== undefined) throw Object.assign(Error('EXEC_NESTED_ENVELOPE_REJECTED'),{statusCode:400});
    if(binding.port!==endpointPort(endpoint))throw Error('EXEC_TARGET_ENDPOINT_CONFLICT');
    if (frozen.command !== 'API.ExecuteAddOnCommand') throw Object.assign(Error('EXEC_OFFICIAL_MUTATION_BINDING_UNSUPPORTED'),{statusCode:409});
    const wire = copy(frozen);
    wire.parameters.addOnCommandParameters = {_mepbridgeExecution:{sessionId:binding.sessionId,parameters:wire.parameters.addOnCommandParameters || {}}};
    const step={action:frozen.parameters?.addOnCommandId?.commandName || frozen.command,commandJson:wire,receiptTarget:binding,isMutation:true,...(allowUnresolved ? {allowUnresolved:true} : {})};
    // Creation and DISPATCHED are one durable transaction. Existing receipts are never dispatched again.
    const claim=this.store.claimOperation(id,step);
    if(!claim.claimed) {
      const existing=publicReceipt(claim.receipt);
      if(existing.status==='COMPLETED')return {data:existing.result?.data,completion:existing.result?.completion,execution:{...existing,replayed:true}};
      return {data:null,execution:{...existing,replayed:false},error:'EXEC_OPERATION_NOT_REPLAYABLE',statusCode:409};
    }
    const receiptId=claim.receipt.receiptId;
    try {
      const current=await this.identify(endpoint,this.post);
      if(!sameTarget(binding,current)) {
        this.store.markFailed(receiptId,'EXEC_TARGET_CHANGED_BEFORE_DISPATCH',false,true);
        return {data:null,error:'EXEC_TARGET_CHANGED_BEFORE_DISPATCH',execution:this.query(id),statusCode:409};
      }
    } catch(error) {
      try{this.store.markFailed(receiptId,error.message,false,true);}catch(_){/* durable ambiguity remains queryable */}
      return {data:null,error:error.message,execution:this.query(id),statusCode:409};
    }
    let data,completion;
    try {
      data=(await this.post(endpoint,wire,{headers:{'Content-Type':'application/json'},timeout:30000})).data;
      if(data?.succeeded!==true || hasResultFailure(data)) {
        const addOnResp = data?.result?.addOnCommandResponse;
        const errObj = addOnResp?.error || data?.error;
        const modelState = errObj?.modelState || addOnResp?.modelState;
        // Error names alone do not prove rollback. Require a terminal, consistent native response.
        // Outcome classification only: AI-first admission and allowUnresolved are unchanged.
        const verifiedNoEffect = data?.succeeded === true && addOnResp?.status === 'error' &&
          ['NOT_DISPATCHED','ROLLED_BACK'].includes(modelState) && errObj?.modelModified === false &&
          (!addOnResp?.modelState || addOnResp.modelState === modelState) &&
          (addOnResp?.modifiedCount === undefined || addOnResp.modifiedCount === 0) &&
          addOnResp?.modelModified !== true &&
          !(Array.isArray(addOnResp?.modifiedGuids) && addOnResp.modifiedGuids.length) &&
          !(Array.isArray(addOnResp?.results) && addOnResp.results.some(r => r?.status === 'ok' || r?.modelModified === true));
        this.store.markFailed(receiptId, errObj?.code || errObj?.message || 'EXEC_REMOTE_RESULT_UNCONFIRMED', false, verifiedNoEffect);
        return {data, error: errObj?.code || 'EXEC_REMOTE_RESULT_UNCONFIRMED', execution: this.query(id), statusCode: verifiedNoEffect ? 400 : 409};
      }
      const after=await this.identify(endpoint,this.post);
      if(!sameTarget(binding,after))throw Error('EXEC_TARGET_CHANGED_AFTER_DISPATCH');
      completion=complete?await complete(data):null;
      if(completion?.ok===false)throw Error('EXEC_READBACK_UNCONFIRMED');
      const updated=this.store.markCompleted(receiptId,{data,completion});
      if(!updated)throw Error('EXEC_COMPLETION_RECEIPT_UNCONFIRMED');
      return {data,completion,execution:publicReceipt(updated)};
    } catch(error) {
      try{this.store.markFailed(receiptId,error.message,true);}catch(_){/* do not retry mutation or hide completed-file uncertainty */}
      let receipt;try{receipt=this.query(id);}catch(_){receipt={operationId:id,status:'UNKNOWN',recoveryRequired:true};}
      return {data:null,error:error.message,execution:receipt,operationMayBeCommitted:true,statusCode:409};
    }
  }
}
let singleton;
function getExecutionCoordinator() {
  if(!singleton)singleton=new ExecutionCoordinator({store:new DurableReceiptStore({directory:require('./runtime-paths').dataPath('execution')}),post:(...args)=>require('axios').post(...args)});
  return singleton;
}
module.exports={ExecutionCoordinator,getExecutionCoordinator,captureTarget,mutation,operationId,endpointPort};
