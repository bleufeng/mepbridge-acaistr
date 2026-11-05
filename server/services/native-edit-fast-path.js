// SPDX-License-Identifier: MIT
'use strict';
// Deterministic absolute edits only. Parsing does no HTTP, geometry discovery or LLM.
// Advanced/relative/ambiguous intentions return null to the existing planner.
const { performance } = require('perf_hooks');
const { isAutomaticExecution } = require('./execution-mode');
const GUID = /[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/ig;
const NUMBER = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const UNIT = '(?:mm|cm|m|毫米|厘米|米)';
function values(text, defaultUnit = 'm') {
  const units = [...text.matchAll(new RegExp(UNIT,'ig'))].map(m=>m[0].toLowerCase());
  if(new Set(units).size > 1) return null; // mixed units require explicit per-item interpretation
  const unit = units[0] || defaultUnit;
  const factor = /^(?:mm|毫米)$/.test(unit) ? .001 : /^(?:cm|厘米)$/.test(unit) ? .01 : 1;
  const trimmed = text.replace(new RegExp(UNIT,'ig'),'').replace(/[\[\]，,、;；\s]/g,'');
  // Caller has matched an entire numeric list; no arbitrary number extraction.
  if (!trimmed || /[^\d.]/.test(trimmed)) return null;
  const parts = text.replace(new RegExp(UNIT,'ig'),'').replace(/[\[\]]/g,'').trim().split(/[,，、;；\s]+/).filter(Boolean);
  const result = parts.map(p=>Number(p)*factor);
  return result.length && result.every(v=>Number.isFinite(v)&&v>0) ? result : null;
}
function recognizeNativeEdit(text, context = {}) {
  if (typeof text !== 'string') return null;
  let input = text.trim();
  if(!/(修改|调整|设置|改|设为|设成|=|：|\b(?:set|change|edit)\b)/i.test(input)) return null;
  if (!/(幕墙|curtain\s*wall|curtainwall|墙体|墙|\bwall\b)/i.test(input)) return null;
  // Do not swallow negation, conditionals, multiple actions, questions, ranges or relative edits.
  if (/(或|保留|不要|不改|别改|不能|是否|能否|可以吗|如何|怎么|如果|增加|减少|加宽|变窄|提高|降低|翻倍|原来|当前值|大约|左右|至少|至多|创建|新建|删除|复制|移动|旋转|材质|框|龙骨|板厚|颜色|路径|面板|连接件|附件|批量|所有|每个|\?|？|\b(?:with|without|but|instead|or|not|don't|can|how|if|increase|decrease|double|about|create|delete|copy|move|rotate|material|frame|panel|path|all|each)\b)/i.test(input)) return null;
  const curtain = /(幕墙|curtain\s*wall|curtainwall)/i.test(input);
  if (curtain && /墙体|\bwall\b/i.test(input.replace(/curtain\s*wall|curtainwall/ig,''))) return null;
  const guids = input.match(GUID) || [];
  const explicit = context.elementGuid || context.routeGuid;
  if (guids.length>1 || (explicit && (typeof explicit!=='string'||!new RegExp('^'+GUID.source+'$','i').test(explicit)))) return null;
  if (guids[0] && explicit && guids[0].toLowerCase()!==explicit.toLowerCase()) return null;
  const guid = guids[0] || explicit || null;
  input = input.replace(GUID,'').replace(/(?:elementGuid|guid)\s*[:=]?/ig,'');
  let logic = null;
  if (/等分|均分|bestDivision|best\s*division/i.test(input)) logic='bestDivision';
  if (/固定|fixedSizes|fixed\s*sizes/i.test(input)) { if(logic) return null; logic='fixedSizes'; }
  input=input.replace(/等分|均分|bestDivision|best\s*division|固定|fixedSizes|fixed\s*sizes/ig,'');
  const list = NUMBER+'(?:\\s*'+UNIT+')?(?:\\s*[,，、;；]\\s*'+NUMBER+'(?:\\s*'+UNIT+')?)*';
  const field = curtain ? '(列宽|列距|分格宽度|分格宽|行高|行距|分格高度|分格高|总高度|总高|高度|column\\s*(?:width|spacing)|row\\s*(?:height|spacing)|total\\s*height|height)' : '(厚度|墙厚|总高度|总高|高度|厚|高|thickness|height)';
  const re = new RegExp(field+'\\s*(?:(?:改为|改成|设为|设置为|调整为|修改为|变为|为|到|成|=|:|：|to|is)\\s*)?([\\[]?'+list+'\\s*[\\]]?\\s*(?:'+UNIT+')?)','ig');
  const edits = {}; let count=0;
  input=input.replace(re,(_m,key,raw)=>{
    count++;
    const parsed=values(raw); if(!parsed) { edits.invalid=true; return ''; }
    let name;
    if (!curtain) name=/厚|thickness/i.test(key)?'thickness':'height';
    else name=/行|row|分格高/i.test(key)?'rows':/列|column|宽|width/i.test(key)?'columns':'height';
    if (edits[name]!==undefined || ((name==='height'||name==='thickness') && parsed.length!==1)) {edits.invalid=true;return '';}
    edits[name]=parsed; return '';
  });
  if(!count||edits.invalid) return null;
  // Only explicitly understood grammar may be consumed. Unparsed values/units/actions force fallback.
  const remainder=input.replace(/幕墙|curtain\s*wall|curtainwall|墙体|墙|\bwall\b/ig,'')
    .replace(/请|把|将|当前|选中的|选中|这段|这面|这个|这一段|既有|修改|调整|设置|改|并且|同时|以及|和|并|的|\b(?:please|set|change|edit|selected|current|the|this|and)\b/ig,'')
    .replace(/[\s，,。.;；:：={}]/g,'');
  if(remainder) return null;
  if(logic && (!curtain || (!edits.columns&&!edits.rows) || (edits.columns&&edits.rows))) return null;
  const params = {};
  if(curtain) {
    if(guid)params.elementGuid=guid; else params.target='currentSelection';
    params.resultDetail='summary';
    if(edits.columns||edits.rows){params.gridScheme={};for(const name of ['columns','rows']) if(edits[name]) params.gridScheme[name]={logic:logic||'fixedSizes',spacings:edits[name]};}
  } else if(guid) params.elementGuid=guid;
  for(const name of ['height','thickness']) if(edits[name]) params[name]=edits[name][0];
  const title = curtain?'原位修改幕墙':'原位修改墙体';
  const step={action:'EditBuildingElement',commandName:'EditBuildingElement',commandNamespace:'MEPBridge',descriptorName:'mepbridge.edit_building_element',
    title,description:title+'；参数明确，直接使用原生事务与回读',expectedResult:'Requested fields read back; parent GUID preserved',riskLevel:'medium-mutation',params,
    commandJson:{command:'API.ExecuteAddOnCommand',parameters:{addOnCommandId:{commandNamespace:'MEPBridge',commandName:'EditBuildingElement'},addOnCommandParameters:{...params}}}};
  return {userIntent:text,title,isMutation:true,source:'NATIVE_EDIT_FAST_PATH',deterministic:true,requiresStepRefinement:false,confidence:1,
    fastPath:{kind:curtain?'CurtainWall':'Wall',target:guid?'EXPLICIT_GUID':curtain?'APX_CURRENT_SELECTION':'WALL_SELECTION_LOOKUP',llmCalls:0,geometryPreReads:0},steps:[step]};
}
// No shortcuts around durable session binding, native readback or unknown request protection.
async function executeNativeEditPlan(plan, context = {}, deps = {}) {
  const started = performance.now();
  const client = deps.client || require('./archicad-client');
  // Pin the mutable default once across any type/selection reads and dispatch.
  if(!context.targetPort && !context.targetInstance && !context.targetProject)
    context={...context,targetPort:(deps.getPort || require('./archicad-endpoint').getArchicadPort)()};
  const step = plan.steps[0]; let params = {...step.params};
  if(plan.fastPath.kind==='Wall' && !params.elementGuid) {
    const selected=await client.executeCommand('GetSelectedElements',{onlyEditable:false,includeAabb:false,includeMepInfo:false},context);
    const elements=selected.data?.elements||[]; const ids=[...new Set(elements.map(e=>e.guid).filter(Boolean))];
    if(!selected.success||ids.length!==1) return {success:false,errorType:'WALL_SELECTION_NOT_UNIQUE',error:'Select one wall or provide its GUID.',detail:{field:'elementGuid',modelState:'NOT_DISPATCHED',modelModified:false,actionableSuggestion:'Select one wall, or include its GUID.'},fastPath:plan.fastPath};
    params.elementGuid=ids[0];
  }
  if(params.elementGuid) {
    const types=await client.executeCommand('API.GetTypesOfElements',{elements:[{elementId:{guid:params.elementGuid}}]},context);
    if(!types.success||types.data?.typesOfElements?.[0]?.typeOfElement?.elementType!==plan.fastPath.kind)
      return {success:false,errorType:'NATIVE_EDIT_TARGET_TYPE_MISMATCH',error:'The target is not a '+plan.fastPath.kind+'.',detail:{field:'elementGuid',modelState:'NOT_DISPATCHED',modelModified:false,actionableSuggestion:'Select or supply the GUID of the requested parent '+plan.fastPath.kind+'.'},fastPath:plan.fastPath};
  }
  if(plan.fastPath.kind==='Wall') delete params.resultDetail;
  if(context.knowledgeSnapshot) {
    const kb=deps.knowledgeBase||require('./knowledge-base');
    const resolvedPlan={...plan,steps:[{...step,params}]};
    if(context.knowledgeSnapshot.automaticPlanValidation==='ON') {
      const validation=kb.validatePlan(resolvedPlan,context.knowledgeSnapshot);
      if(!validation.passed)return {success:false,errorType:'KB_VALIDATION_FAILED',error:validation.summary,detail:validation,fastPath:plan.fastPath};
    }
  }
  const executionContext={...context};delete executionContext.knowledgeSnapshot;
  const result=await client.executeCommand('EditBuildingElement',params,executionContext);
  return {...result,fastPath:{...plan.fastPath,serverTotalMs:performance.now()-started,businessMutationCalls:1},executedParams:params};
}
function automatic(context){return isAutomaticExecution(context)&&context.autoConfirm!==false;}
module.exports={recognizeNativeEdit,executeNativeEditPlan,automatic};
