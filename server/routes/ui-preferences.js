// SPDX-License-Identifier: MIT
'use strict';
const router=require('express').Router(),preferences=require('../services/ui-preferences');
function reply(res,value){return res.status(value.ok?200:value.code==='UI_PREFERENCES_CONFLICT'?409:value.code==='UI_INVALID_LOCALE'?400:503).json(value);}
router.get('/',(req,res)=>reply(res,preferences.get()));
router.put('/',(req,res)=>reply(res,preferences.set(req.body?.locale,{source:req.body?.source||'explicit',expectedRevision:req.body?.expectedRevision})));
module.exports=router;
