// SPDX-License-Identifier: MIT
'use strict';
const express=require('express');
const archicadClient=require('../services/archicad-client');
// Compatibility response shape, unified admission. No hard-coded mutation list or
// unrelated MEP readback is treated as proof that a building command succeeded.
function createRouter(client=archicadClient){
 const router=express.Router();
 router.post('/',async(req,res)=>{
  try{
   const body=req.body||{}, {action,params}=body;
   if(typeof action!=='string'||!action.trim())return res.status(400).json({success:false,error:'Missing required field: action'});
   const context={...body};delete context.action;delete context.params;delete context.index;
   const result=await client.executeCommand(action,params,context);
   if(result.execution?.operationId)res.setHeader?.('X-MEPBridge-Operation-Id',result.execution.operationId);
   return res.status(result.statusCode||200).json({...result,readback:null});
  }catch(error){return res.status(error.statusCode||500).json({success:false,error:error.message,errorType:'EXEC_STEP_UNCONFIRMED'});}
 });
 return router;
}
module.exports=createRouter();module.exports.createRouter=createRouter;
