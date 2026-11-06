// SPDX-License-Identifier: MIT
'use strict';
const {SnapshotExecution}=require('./snapshot-execution');
const {digest}=require('./cad-snapshot-contract');
// requestId remains the CAD provenance key. The operation ID belongs to the
// common execution protocol; changing any inspected input cannot reuse it.
function requestIdentity(request){const {execution,...input}=request;return digest(input);}
function verifyCreation(response, parameters) {
 const r=response?.readback;
 const close=(a,b)=>Number.isFinite(a)&&Math.abs(a-b)<=.001;
 if(response?.status!=='ok'||response.mode!=='created'||response.geometryVerified!==true||
    !/^(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|[{][a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}[}])$/i.test(response.wallGuid||'')||
    /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(String(response.wallGuid).replace(/[{}]/g,''))||
    !r||r.floorIndex!==parameters.floorIndex||!close(r.height,parameters.height)||!close(r.thickness,parameters.thickness)||
    !['start','end'].every(k=>['x','y'].every(axis=>close(r[k]?.[axis],parameters[k][axis])))) {
   throw Object.assign(Error('CAD_CREATE_READBACK_UNCONFIRMED'),{payload:response});
 }
 return response;
}
let singleton;
function getCadWallExecution(){return singleton ||= new SnapshotExecution({
 coordinator:require('./execution-coordinator').getExecutionCoordinator(),
 kind:'CadWallCreate',requestIdentity
});}
module.exports={getCadWallExecution,requestIdentity,verifyCreation};
