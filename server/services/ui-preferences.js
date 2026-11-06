// SPDX-License-Identifier: MIT
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {dataPath,ensureDataDir}=require('./runtime-paths');
const {SUPPORTED_UI_LOCALES}=require('./ui-locale');
const {resolveReleaseLocale}=require('./release-locale');
const file=dataPath('user-data','ui-preferences.json');
function read(){try{if(!fs.existsSync(file))return null;const p=JSON.parse(fs.readFileSync(file,'utf8'));if(p.version!==1||!SUPPORTED_UI_LOCALES.has(p.locale)||(!Number.isSafeInteger(p.revision) || p.revision < 1 || !['explicit','library-first-use','environment'].includes(p.source) || p.initialized !== true))throw Error('Invalid UI preferences');return p;}catch(e){return{error:e.message};}}
function get(){const p=read();if(p?.error)return{ok:false,code:'UI_PREFERENCES_LOAD_FAILED',error:p.error,locale:resolveReleaseLocale(),source:'unknown'};
 if(p)return{ok:true,...p};
 const kb=require('./knowledge-base').getAll();const supported=kb.loadState==='READY'&&SUPPORTED_UI_LOCALES.has(kb.contentLanguage);
 return{ok:true,version:1,revision:0,locale:supported?kb.contentLanguage:resolveReleaseLocale(),source:supported?'library-first-use':'environment',initialized:false};}
function set(locale,{source='explicit',expectedRevision}={}){
 if(!SUPPORTED_UI_LOCALES.has(locale)||!['explicit','library-first-use','environment'].includes(source))return{ok:false,code:'UI_INVALID_LOCALE'};
 const previous=get();if(!previous.ok)return previous;
 if(expectedRevision!==undefined&&expectedRevision!==previous.revision)return{ok:false,code:'UI_PREFERENCES_CONFLICT'};
 // First-use initialization is a compare-and-set, never overwrite a manual choice.
 if(source!=='explicit'&&previous.initialized!==false)return previous;
 const lock=file+'.lock';let fd;
 const value={version:1,locale,source,initialized:true,revision:previous.revision+1};const tmp=file+'.'+crypto.randomUUID()+'.tmp';
 let result;
 try{
  ensureDataDir('user-data');fd=fs.openSync(lock,'wx');
  const current=get();
  if(!current.ok)result=current;
  else if(current.revision!==previous.revision)result={ok:false,code:'UI_PREFERENCES_CONFLICT'};
  else{fs.writeFileSync(tmp,JSON.stringify(value,null,2),{flag:'wx'});fs.renameSync(tmp,file);result={ok:true,...value};}
 }catch(e){result={ok:false,code:e.code==='EEXIST'?'UI_PREFERENCES_CONFLICT':'UI_PREFERENCES_SAVE_FAILED',error:e.message};}
 finally{
  try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch(_){}
  if(fd!==undefined)try{fs.closeSync(fd);fs.unlinkSync(lock);}catch(e){result={ok:false,code:'UI_PREFERENCES_SAVE_FAILED',error:e.message,operationMayBeCommitted:true};}
 }
 return result;
}
module.exports={get,set};
