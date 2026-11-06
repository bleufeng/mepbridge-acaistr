// SPDX-License-Identifier: MIT
'use strict';
const crypto=require('crypto');
const {captureTarget,endpointPort}=require('./execution-coordinator');
const {identity}=require('./model-audit-engine');
const GUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const MAX_BYTES=2*1024*1024;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// These are API scalar definitions, not code-compliance interpretations.
// In particular openingWidth is NOT passage clear width; column height is NOT railing height.
const FACTS=Object.freeze({
 'wall.parameterHeight':{types:['Wall'],field:'height',unit:'m',measurement:'API_WallType.height',scope:'element-parameter'},
 'wall.parameterThickness':{types:['Wall'],field:'thickness',unit:'m',measurement:'API_WallType.thickness',scope:'element-parameter'},
 'column.parameterHeight':{types:['Column'],field:'height',unit:'m',measurement:'API_ColumnType.height',scope:'element-parameter'},
 'opening.parameterWidth':{types:['Door','Window'],field:'width',unit:'m',measurement:'API_OpeningBaseType.width',scope:'element-parameter'},
 'opening.parameterHeight':{types:['Door','Window'],field:'height',unit:'m',measurement:'API_OpeningBaseType.height',scope:'element-parameter'}
});
class ModelAuditAdapter {
 constructor({post}={}){if(typeof post!=='function')throw Error('AUDIT_POST_ADAPTER_REQUIRED');this.post=post;}
 async bind(port){const endpoint=`http://127.0.0.1:${port}`;endpointPort(endpoint);return{...await captureTarget(endpoint,this.post),saved:true};}
 async verify(project){const current=await this.bind(project.port);if(identity(current)!==identity(project))throw Error('AUDIT_PROJECT_SESSION_CHANGED');return current;}
 async read(project,commandName,parameters,signal){
  if(signal?.cancelled)throw Error('AUDIT_CANCELLED');
  if(!['GetSelectedElements','GetElementGeometry'].includes(commandName))throw Error('AUDIT_READ_COMMAND_NOT_ALLOWED');
  const endpoint=`http://127.0.0.1:${project.port}`;endpointPort(endpoint);
  const response=await this.post(endpoint,{command:'API.ExecuteAddOnCommand',parameters:{addOnCommandId:{commandNamespace:'MEPBridge',commandName},addOnCommandParameters:{_mepbridgeExecution:{sessionId:project.sessionId,parameters}}}},{timeout:5000,proxy:false,maxContentLength:MAX_BYTES});
  if(signal?.cancelled)throw Error('AUDIT_CANCELLED');
  if(Buffer.byteLength(JSON.stringify(response?.data||{}))>MAX_BYTES)throw Error('AUDIT_FACT_BYTE_QUOTA');
  const result=response?.data?.result?.addOnCommandResponse;
  if(response?.data?.succeeded!==true||result?.status!=='ok')throw Error('AUDIT_HOST_READ_FAILED');
  return result;
 }
 async selection(project){await this.verify(project);const data=await this.read(project,'GetSelectedElements',{onlyEditable:false,includeAabb:false,includeMepInfo:false});await this.verify(project);
  if(!Array.isArray(data.elements)||data.elements.length<1||data.elements.length>500)throw Error('AUDIT_SELECTION_INVALID_OR_OVER_BUDGET');
  const guids=data.elements.map(e=>typeof e.guid==='string'?e.guid.toLowerCase():'');if(guids.some(g=>!GUID.test(g))||new Set(guids).size!==guids.length||data.elements.some(e=>e.hasHeader!==true))throw Error('AUDIT_SELECTION_IDENTITY_UNCONFIRMED');return guids;
 }
 scope(project,guids,{collect=true}={}){
  const cache=new Map();let before=null;const adapter=this;
  async function collectFacts(signal){const values=[];for(const guid of guids){if(signal?.cancelled)throw Error('AUDIT_CANCELLED');const data=await adapter.read(project,'GetElementGeometry',{elementGuid:guid},signal);
    if(data.elementGuid?.toLowerCase()!==guid||!/^\d{1,20}$/.test(data.modificationStamp||'')||BigInt(data.modificationStamp)>18446744073709551615n||!data.geometry||typeof data.geometry!=='object')throw Error('AUDIT_ELEMENT_STAMP_OR_IDENTITY_MISSING');
    values.push({guid,stamp:data.modificationStamp,type:data.elementType,geometry:data.geometry});
    if(Buffer.byteLength(JSON.stringify(values))>MAX_BYTES)throw Error('AUDIT_FACT_BYTE_QUOTA');
   }return values;}
  return {
   async confirmIdentity(_,signal){const current=await adapter.verify(project);if(signal?.cancelled)throw Error('AUDIT_CANCELLED');
    const rows=collect?await collectFacts(signal):[];await adapter.verify(project);const signature=hash(rows);
    if(before===null){before=signature;for(const row of rows)cache.set(row.guid,row);}
    return{...current,revisionToken:signature};
   },
   async readFacts({guid,signal}){if(signal?.cancelled)throw Error('AUDIT_CANCELLED');const row=cache.get(guid);if(!row)return{ok:false};
    const values=Object.entries(FACTS).filter(([,d])=>d.types.includes(row.type)).map(([key,d])=>({key,value:row.geometry[d.field],unit:d.unit,measurement:d.measurement,complete:typeof row.geometry[d.field]==='number'&&Number.isFinite(row.geometry[d.field])&&row.geometry.supported!==false,source:`MEPBridge.GetElementGeometry:${guid}#${d.field}`,modificationStamp:row.stamp}));
    return{ok:true,guid,projectKey:identity(project),elementType:row.type,values};
   }
  };
 }
}
module.exports={ModelAuditAdapter,FACTS,GUID};
