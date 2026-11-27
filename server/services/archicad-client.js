// SPDX-License-Identifier: MIT
'use strict';
const axios = require('axios');
const {DynamicResolutionError,resolveDynamicCommandParameters}=require('./dynamic-command-resolver');
const {getArchicadEndpoint,endpointForPort}=require('./archicad-endpoint');
const {normalizeCommandSafetyParameters,getCommandSafetyCapabilities}=require('./command-capabilities');
const {resolveTargetInstance}=require('./instance-targeting');
const {validateCommandSemanticFidelity}=require('./semantic-fidelity-gate');
const {preflightCommandParameters}=require('./command-parameter-diagnostics');
const {getOfficialApiCapabilities}=require('./official-api-capabilities');
const {getExecutionCoordinator,captureTarget,mutation,operationId,endpointPort}=require('./execution-coordinator');
const {hasResultFailure}=require('./bounded-result-summary');
const {isAutomaticExecution}=require('./execution-mode');
const copy=value=>JSON.parse(JSON.stringify(value));
const failure=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
class ArchicadClient {
  constructor({post=(...args)=>axios.post(...args),endpoint=getArchicadEndpoint,resolve=resolveDynamicCommandParameters,target=resolveTargetInstance,identify=captureTarget,coordinator=getExecutionCoordinator}={}) {
    this.post=post;this.endpointProvider=endpoint;this.resolve=resolve;this.target=target;this.identify=identify;this.coordinator=coordinator;
  }
  get endpoint(){return this.endpointProvider();}
  // First-time mutation callers may omit the operation ID; the server supplies it
  // in the receipt. Retain and reuse that ID for retries, never blindly resend.
  async executeCommand(commandName,params={},options={}) {
    let executionId;
    try {
      if(!options||typeof options!=='object'||Array.isArray(options))throw failure('EXEC_INVALID_CLIENT_OPTIONS');
      const context=copy(options);
      if(context.execution!==undefined){
        const protocol=context.execution;
        if(!protocol||typeof protocol!=='object'||Array.isArray(protocol)||Object.keys(protocol).some(k=>k!=='operationId'))throw failure('EXEC_INVALID_PROTOCOL');
        if(protocol.operationId!==undefined)executionId=operationId(protocol.operationId);
      }
      const parsed=parseCommandName(commandName);
      let payload=parsed.isApiCommand?{command:parsed.commandName,parameters:copy(params||{})}:{command:'API.ExecuteAddOnCommand',parameters:{addOnCommandId:{commandNamespace:parsed.commandNamespace,commandName:parsed.commandName},addOnCommandParameters:copy(params||{})}};
      if(payload.command==='API.ExecuteAddOnCommand'){
        const id=payload.parameters?.addOnCommandId;
        if(id?.commandNamespace!=='MEPBridge')throw failure('EXEC_NAMESPACE_REJECTED');
        if(payload.parameters?.addOnCommandParameters?._mepbridgeExecution!==undefined)throw failure('EXEC_NESTED_ENVELOPE_REJECTED');
        payload.parameters.addOnCommandParameters=normalizeAddOnParameters(id.commandName,payload.parameters.addOnCommandParameters);
      }else{
        const capability=getOfficialApiCapabilities(payload.command);
        if(!capability?.directAllowed)throw failure('EXEC_OFFICIAL_COMMAND_NOT_ALLOWED');
        if(capability.mutation!==false)throw failure('EXEC_OFFICIAL_WRITE_USE_AUTHORIZED_EXECUTE',409);
      }
      const isMutation=mutation(payload);
      if(isMutation&&!executionId)executionId=operationId();
      // Read the mutable default ONCE, then preserve the selected endpoint through
      // resolution, identification, dispatch and recovery. Never silently retarget.
      let endpoint=this.endpoint;
      const targeting=await this.target({...context,params:payload.parameters},{post:this.post});
      if(targeting.requested){if(!targeting.ok)throw Object.assign(failure(targeting.message||targeting.errorType,409),{code:targeting.errorType,detail:targeting.detail});endpoint=endpointForPort(targeting.port);}
      endpointPort(endpoint);
      const binding=isMutation?await this.identify(endpoint,this.post):null;
      const dynamicResolution=await this.resolve(payload,endpoint);
      const action=payload.parameters?.addOnCommandId?.commandName||payload.command;
      const parameters=payload.parameters?.addOnCommandParameters||payload.parameters||{};
      const semanticFidelity=validateCommandSemanticFidelity(action,parameters,context);
      if(!semanticFidelity.allowed)return{success:false,error:semanticFidelity.message,errorType:semanticFidelity.errorType,statusCode:422,semanticFidelity};
      // C09 (W1 §48 U02): apply the existing automatic-mode defaults BEFORE
      // the preflight, so the preflight validates the FINAL native parameters
      // the add-on will receive. Manual explicit controls are untouched and no
      // new confirmation / operationId gate is introduced.
      const isAuto = isAutomaticExecution(options);
      if(isMutation){
        const nativeParams = payload.parameters?.addOnCommandParameters || parameters;
        if (nativeParams && typeof nativeParams === 'object') {
          const caps = getCommandSafetyCapabilities(action);
          if (caps.dryRun && nativeParams.dryRun === undefined && isAuto) nativeParams.dryRun = false;
          if (caps.confirmRequired && nativeParams.confirmRequired === undefined && (isAuto || nativeParams.dryRun === false)) nativeParams.confirmRequired = true;
        }
      }
      // OFF-02 (GEN-RT-DIAGNOSTICS): deterministic parameter preflight with JSON-pointer
      // diagnostics. Only reproduces hard C++ constraints; never blocks a payload the
      // add-on would accept, so the native schema remains the single source of truth.
      const parameterPreflight=preflightCommandParameters(action,parameters);
      if(!parameterPreflight.ok){
        return{success:false,error:parameterPreflight.message,errorType:parameterPreflight.errorType,
          statusCode:parameterPreflight.statusCode,parameterDiagnostics:parameterPreflight.parameterDiagnostics};
      }
      let data,execution=null;
      if(isMutation){
        const result=await this.coordinator().execute({id:executionId,command:payload,endpoint,target:binding,allowUnresolved:isAuto});
        execution=result.execution;
        if(result.error){
          const response=result.data?.result?.addOnCommandResponse || result.data;
          const detail=response?.error;
          return{success:false,error:detail?.message || result.error,errorType:result.error,statusCode:result.statusCode||409,
            data:response,detail,execution,operationMayBeCommitted:result.operationMayBeCommitted,dynamicResolution,semanticFidelity};
        }
        data=result.data;
      }else data=(await this.post(endpoint,payload,{timeout:30000})).data;
      const addOnResponse=data?.result?.addOnCommandResponse;
      if(data?.succeeded!==true||hasResultFailure(data))return{success:false,error:addOnResponse?.error?.message||addOnResponse?.error||data?.error?.message||'Command result is unconfirmed',data:addOnResponse||data,execution,dynamicResolution,semanticFidelity};
      return{success:true,data:addOnResponse||data.result,execution,dynamicResolution,semanticFidelity,...(targeting.requested?{target:{port:targeting.port,mode:targeting.mode}}:{}),verification:isMutation?'COMMAND_RESPONSE_ONLY':'READ_RESPONSE'};
    } catch(error) {
      let execution;
      if(executionId){try{execution=this.coordinator().query(executionId);}catch(_){execution={operationId:executionId,status:'UNKNOWN',recoveryRequired:true};}}
      return{success:false,error:error.message,errorType:error instanceof DynamicResolutionError?error.code:error.code||error.message,statusCode:error.statusCode||409,detail:error.detail,...(execution?{execution}:{}),blockingOperationId:error.blockingOperationId};
    }
  }
}
function parseCommandName(commandName) {
  const raw = String(commandName || '').trim();
  if (raw.startsWith('API.')) {
    return { isApiCommand: true, commandName: raw, commandNamespace: null };
  }

  if (raw.includes('.')) {
    const [commandNamespace, ...rest] = raw.split('.');
    return {
      isApiCommand: false,
      commandNamespace,
      commandName: rest.join('.')
    };
  }

  return {
    isApiCommand: false,
    commandNamespace: 'MEPBridge',
    commandName: raw
  };
}

function normalizeAddOnParameters(commandName, params) {
  const normalized = JSON.parse(JSON.stringify(params || {}));

  if (commandName === 'CreatePipe') {
    if (!Array.isArray(normalized.waypoints) && normalized.start && normalized.end) {
      normalized.waypoints = [normalizePoint(normalized.start), normalizePoint(normalized.end)];
      delete normalized.start;
      delete normalized.end;
    } else if (Array.isArray(normalized.waypoints)) {
      normalized.waypoints = normalized.waypoints.map(normalizePoint);
    }
  }

  return normalizeCommandSafetyParameters(commandName, normalized);
}

function normalizePoint(point) {
  let x;
  let y;
  let z;

  if (Array.isArray(point)) {
    [x, y, z] = point;
  } else {
    ({ x, y, z } = point || {});
  }

  const values = [Number(x || 0), Number(y || 0), Number(z || 0)];
  const looksLikeMillimeters = values.some((value) => Math.abs(value) > 100);
  const divisor = looksLikeMillimeters ? 1000 : 1;

  return {
    x: values[0] / divisor,
    y: values[1] / divisor,
    z: values[2] / divisor
  };
}

module.exports = new ArchicadClient();
module.exports.ArchicadClient = ArchicadClient;
