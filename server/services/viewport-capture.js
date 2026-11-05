// SPDX-License-Identifier: MIT
'use strict';
const crypto=require('crypto');
const {SnapshotExecution}=require('./snapshot-execution');
const {endpointForPort,getArchicadEndpoint}=require('./archicad-endpoint');
const {digest}=require('./cad-snapshot-contract');
const {hasResultFailure}=require('./bounded-result-summary');
const clone=x=>JSON.parse(JSON.stringify(x));
const fail=(code,status=409)=>{throw Object.assign(Error(code),{errorType:code,httpStatus:status});};
function port(value,required=false){if(value===undefined&&!required)return null;const p=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;if(!Number.isInteger(p)||p<19723||p>19743)fail('CAPTURE_INVALID_TARGET_PORT',400);return p;}
function options(input,query=false){
 const raw=input.maxElements, count=raw===undefined?100:query&&typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):raw;
 if(!Number.isInteger(count)||count<1||count>1000)fail('CAPTURE_INVALID_MAX_ELEMENTS',400);
 const image=input.includeImage===undefined?true:query?(input.includeImage==='true'?true:input.includeImage==='false'?false:null):input.includeImage;
 if(typeof image!=='boolean')fail('CAPTURE_INVALID_INCLUDE_IMAGE',400);
 return {maxElements:count,includeImage:image,includeAabb:true};
}
function story(value){if(!Number.isInteger(value)||value< -32768||value>32767)fail('CAPTURE_INVALID_STORY_INDEX',400);return value;}
function validateSnapshot(snapshot,params,targetStory){
 if(snapshot?.status!=='ok'||!Number.isInteger(snapshot.storyIndex)||typeof snapshot.viewType!=='string')fail('CAPTURE_READBACK_UNCONFIRMED');
 if(targetStory!==undefined&&(snapshot.storyIndex!==targetStory||snapshot.viewType!=='FloorPlan'))fail('CAPTURE_STORY_VIEW_MISMATCH');
 if(params.includeImage){
  let b64=snapshot.imageBase64;
  if(snapshot.imageError||snapshot.imageFormat!=='png'||typeof b64!=='string'||b64.length>24*1024*1024||b64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(b64))fail('CAPTURE_IMAGE_UNCONFIRMED');
  let bytes=Buffer.from(b64,'base64');
  if(bytes.length===snapshot.imageSize-1&&bytes.length>=3&&bytes.subarray(-3).equals(Buffer.from([0xae,0x42,0x60]))){
   bytes=Buffer.concat([bytes,Buffer.from([0x82])]);
   b64=bytes.toString('base64');
   snapshot.imageBase64=b64;
  }
  if(bytes.toString('base64')!==b64||bytes.length<8||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.length!==snapshot.imageSize)fail('CAPTURE_IMAGE_UNCONFIRMED');
 }
 return {viewType:snapshot.viewType,storyName:snapshot.storyName,storyIndex:snapshot.storyIndex,storyLevel:snapshot.storyLevel,
  elementCount:snapshot.elementCount,bounds:snapshot.bounds,summary:snapshot.summary,imageBase64:params.includeImage?snapshot.imageBase64:null,
  imageFormat:params.includeImage?snapshot.imageFormat:null,imageSize:params.includeImage?snapshot.imageSize:0};
}
function createViewportCaptureService({coordinator,post=coordinator?.post,now=Date.now,ttlMs=5*60*1000}={}){
 if(!coordinator||typeof post!=='function')throw Error('CAPTURE_DEPENDENCIES_REQUIRED');
 const previews=new Map(),workflow=new SnapshotExecution({coordinator,kind:'ViewportStoryCapture',requestIdentity:r=>digest(['ViewportStoryCapture',r.previewId,r.previewHash,r.targetPort])});
 const endpoint=p=>p===null?getArchicadEndpoint():endpointForPort(p);
 async function read(ep,name,params){const data=(await post(ep,{command:'API.ExecuteAddOnCommand',parameters:{addOnCommandId:{commandNamespace:'MEPBridge',commandName:name},addOnCommandParameters:params}}, {timeout:20000,proxy:false,maxContentLength:32*1024*1024})).data;
  if(data?.succeeded!==true||hasResultFailure(data)||data.result?.addOnCommandResponse?.status!=='ok')fail('CAPTURE_READ_FAILED',502);return data.result.addOnCommandResponse;
 }
 function validateStories(value,index){if(!Number.isInteger(value.actStory)||!Array.isArray(value.stories)||value.stories.length>1000||value.stories.some(s=>!s||!Number.isInteger(s.index)||typeof s.name!=='string'||!Number.isFinite(s.level))||new Set(value.stories.map(s=>s.index)).size!==value.stories.length||value.stories.filter(s=>s.index===value.actStory).length!==1||value.stories.filter(s=>s.index===index).length!==1)fail('CAPTURE_STORY_NOT_AVAILABLE');return value;}
 async function current(query={}){
  for(const key of Object.keys(query))if(!['targetPort','includeImage','maxElements','storyIndex','execution','confirmRequired'].includes(key))fail('CAPTURE_INVALID_QUERY_FIELD',400);
  if(Object.hasOwn(query,'storyIndex')||Object.hasOwn(query,'execution')||Object.hasOwn(query,'confirmRequired'))fail('CAPTURE_GET_STORY_CHANGE_FORBIDDEN',400);
  const params=options(query,true),p=port(query.targetPort),ep=endpoint(p);
  return {ok:true,...validateSnapshot(await read(ep,'ViewportCapture',params),params),targetPort:Number(new URL(ep).port),readOnly:true};
 }
 async function preview(body={}){
  for(const key of Object.keys(body))if(!['targetPort','storyIndex','includeImage','maxElements'].includes(key))fail('CAPTURE_PREVIEW_INVALID_FIELD',400);
  const p=port(body.targetPort,true),idx=story(body.storyIndex),params=options(body),ep=endpoint(p);
  const binding=await workflow.bindPreview(ep),stories=validateStories(await read(ep,'GetStories',{}),idx);
  if(JSON.stringify(binding)!==JSON.stringify(await workflow.bindPreview(ep)))fail('CAPTURE_PREVIEW_SESSION_CHANGED');
  for(const [id,v]of previews)if(v.expiresAt<=now())previews.delete(id);
  if(previews.size>=100)fail('CAPTURE_PREVIEW_CAPACITY');
  const frozen={endpoint:ep,binding,params,storyIndex:idx,previousStoryIndex:stories.actStory,storiesHash:digest(stories.stories),expiresAt:now()+ttlMs};
  const previewId=crypto.randomUUID(),previewHash=digest(frozen);previews.set(previewId,clone({...frozen,previewHash}));
  return {ok:true,previewId,previewHash,targetPort:p,expiresAt:frozen.expiresAt,target:binding,previousStoryIndex:stories.actStory,
   requestedStory:clone(stories.stories.find(s=>s.index===idx)),effect:'CHANGE_ACTIVE_STORY_AND_CAPTURE',restoresPreviousStory:false};
 }
 async function capture(body={}){
  if(body.confirmRequired!==true)fail('CAPTURE_CONFIRMATION_REQUIRED',400);
  for(const key of Object.keys(body))if(!['previewId','previewHash','targetPort','confirmRequired','execution'].includes(key))fail('CAPTURE_PREVIEW_OVERRIDE_FORBIDDEN',400);
  port(body.targetPort,true);
  if(typeof body.previewId!=='string'||typeof body.previewHash!=='string'||!/^[a-f0-9]{64}$/.test(body.previewHash))fail('CAPTURE_PREVIEW_REQUIRED',400);
  const recovered=workflow.recover(body);if(recovered)return flatten(recovered);
  const frozen=previews.get(body.previewId);
  if(!frozen||frozen.expiresAt<=now())fail('CAPTURE_PREVIEW_EXPIRED');
  if(frozen.previewHash!==body.previewHash||frozen.binding.port!==body.targetPort)fail('CAPTURE_PREVIEW_CHANGED');
  if(JSON.stringify(frozen.binding)!==JSON.stringify(await workflow.bindPreview(frozen.endpoint)))fail('CAPTURE_PREVIEW_SESSION_CHANGED');
  const live=validateStories(await read(frozen.endpoint,'GetStories',{}),frozen.storyIndex);
  if(live.actStory!==frozen.previousStoryIndex||digest(live.stories)!==frozen.storiesHash)fail('CAPTURE_PREVIEW_STORIES_CHANGED');
  let image=null;
  const output=await workflow.run({request:body,endpoint:frozen.endpoint,binding:frozen.binding},async({command,saveEvidence})=>{
   if(frozen.expiresAt<=now())fail('CAPTURE_PREVIEW_EXPIRED');
   const before=validateStories(await command(frozen.endpoint,'GetStories',{}),frozen.storyIndex);
   if(before.actStory!==frozen.previousStoryIndex||digest(before.stories)!==frozen.storiesHash)fail('CAPTURE_PREVIEW_STORIES_CHANGED');
   saveEvidence('capture-before',{actStory:before.actStory,storiesHash:frozen.storiesHash});
   if(frozen.expiresAt<=now())fail('CAPTURE_PREVIEW_EXPIRED');
   const switched=await command(frozen.endpoint,'SwitchStory',{storyIndex:frozen.storyIndex,dryRun:false,confirmRequired:true},{phase:'execute'});
   if(switched.status!=='ok'||switched.mode!=='switched'||switched.readbackVerified!==true||switched.requestedStoryIndex!==frozen.storyIndex||switched.currentStoryIndex!==frozen.storyIndex||switched.previousStoryIndex!==before.actStory||typeof switched.changed!=='boolean'||switched.changed!==(before.actStory!==frozen.storyIndex))fail('CAPTURE_SWITCH_UNCONFIRMED');
   const after=validateStories(await command(frozen.endpoint,'GetStories',{}),frozen.storyIndex);
   if(after.actStory!==frozen.storyIndex)fail('CAPTURE_SWITCH_READBACK_MISMATCH');
   const capture=validateSnapshot(await command(frozen.endpoint,'ViewportCapture',frozen.params),frozen.params,frozen.storyIndex);
   const final=validateStories(await command(frozen.endpoint,'GetStories',{}),frozen.storyIndex);
   if(final.actStory!==frozen.storyIndex||digest(final.stories)!==frozen.storiesHash)fail('CAPTURE_FINAL_STORIES_CHANGED');
   image=capture.imageBase64;
   const result={...capture,status:'completed',targetPort:frozen.binding.port,switchedStory:frozen.storyIndex,storyChanged:switched.changed===true,
    imageSha256:image?crypto.createHash('sha256').update(Buffer.from(image,'base64')).digest('hex'):null,
    imageBase64:null,imageRetained:false,imageAvailable:false,restoresPreviousStory:false};
   saveEvidence('capture-after',result);return {ok:true,result};
  });
  const result=flatten(output);
  if(output.ok&&!output.execution?.replayed)return {...result,imageBase64:image,imageAvailable:Boolean(image)};
  return result;
 }
 function flatten(output){const {result,...envelope}=output;return {...(result||{}),...envelope};}
 return {current,preview,capture,workflow};
}
let singleton;function getViewportCaptureService(){return singleton ||= createViewportCaptureService({coordinator:require('./execution-coordinator').getExecutionCoordinator()});}
module.exports={createViewportCaptureService,getViewportCaptureService};
