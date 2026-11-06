// SPDX-License-Identifier: MIT
'use strict';
const express=require('express');
const {getModelAuditService}=require('../services/model-audit-service');
function createRouter(service=getModelAuditService){const router=express.Router();
 function handle(handler){return async(req,res)=>{try{const result={ok:true,...await handler(service(),req)};return (result.ok===false?res.status(result.httpStatus||409):res).json(result);}catch(error){const code=error.message||'AUDIT_UNKNOWN';return res.status(/STORAGE|HISTORY_MISSING|ENOENT|EACCES/.test(code)?503:409).json({ok:false,error:code,modelAuditState:'UNKNOWN'});}};}
 router.post('/bind',handle((s,r)=>s.bind(r.body?.targetPort)));
 router.get('/:contextId/preflight',handle((s,r)=>({preflight:s.preflight(r.params.contextId)})));
 router.post('/:contextId/settings',handle(async(s,r)=>({settings:await s.enable(r.params.contextId,r.body)})));
 router.post('/:contextId/selection',handle(async(s,r)=>({selection:await s.select(r.params.contextId)})));
 router.post('/:contextId/start',handle((s,r)=>s.start(r.params.contextId,r.body)));
 router.post('/:contextId/cancel',handle((s,r)=>s.cancel(r.params.contextId)));
 router.get('/:contextId/jobs/:jobId',handle((s,r)=>({job:s.job(r.params.contextId,r.params.jobId)})));
 router.get('/:contextId/history',handle((s,r)=>({history:s.history(r.params.contextId)})));
 router.get('/:contextId/runs/:runId/evidence',handle((s,r)=>s.evidence(r.params.contextId,r.params.runId)));
 router.post('/:contextId/runs/:runId/reviews',handle((s,r)=>({review:s.review(r.params.contextId,r.params.runId,r.body)})));
 router.post('/:contextId/recheck',handle((s,r)=>s.recheck(r.params.contextId,r.body)));
 router.post('/:contextId/runs/:runId/locate/preview',handle((s,r)=>s.locatePreview(r.params.contextId,r.params.runId,r.body)));
 router.post('/:contextId/runs/:runId/locate',handle((s,r)=>s.locate(r.params.contextId,r.params.runId,r.body)));
 router.post('/:contextId/manual',handle((s,r)=>s.manual(r.params.contextId,r.body)));
 return router;
}
module.exports=createRouter();module.exports.createRouter=createRouter;
