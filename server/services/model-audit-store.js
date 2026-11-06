// SPDX-License-Identifier: MIT
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const clone=x=>JSON.parse(JSON.stringify(x));
const review=require('./model-audit-review');
function projectKey(project) {
  if(project?.saved!==true || !Number.isInteger(project.port) || project.port<19723 || project.port>19743 || !/^[a-f0-9]{64}$/i.test(project.projectFingerprint||'') || typeof project.sessionId!=='string' || !project.sessionId || project.sessionId.length>128)throw Error('AUDIT_CONFIRMED_SAVED_PROJECT_REQUIRED');
  return project.projectFingerprint.toLowerCase();
}
class ModelAuditStore {
  constructor({directory,io=fs,maxBytes=4*1024*1024,maxProjects=100,maxRuns=100}={}) {
    if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('AUDIT_STORE_DIRECTORY_REQUIRED');
    for(const [value,limit]of [[maxBytes,4*1024*1024],[maxProjects,100],[maxRuns,100]])if(!Number.isSafeInteger(value)||value<1||value>limit)throw Error('AUDIT_STORE_INVALID_QUOTA');
    this.directory=path.resolve(directory);this.file=path.join(this.directory,'model-review-v1.json');this.anchor=this.file+'.initialized';this.io=io;this.maxBytes=maxBytes;this.maxProjects=maxProjects;this.maxRuns=maxRuns;this.poisoned=false;
  }
  _read() {
    if(this.poisoned)throw Error('AUDIT_STORAGE_UNKNOWN');const io=this.io;
    for(let p=this.directory;;p=path.dirname(p)){if(io.existsSync(p)&&io.lstatSync(p).isSymbolicLink())throw Error('AUDIT_UNSAFE_STORAGE_PATH');if(path.dirname(p)===p)break;}
    if(!io.existsSync(this.file)){if(io.existsSync(this.anchor))throw Error('AUDIT_HISTORY_MISSING');return{version:1,revision:0,projects:{},runs:[],reviews:[]};}
    if(io.lstatSync(this.file).isSymbolicLink()||io.statSync(this.file).size>this.maxBytes)throw Error('AUDIT_INVALID_STORAGE_FILE');
    const state=JSON.parse(io.readFileSync(this.file,'utf8'));
    if(state?.version!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!state.projects||typeof state.projects!=='object'||Array.isArray(state.projects)||!Array.isArray(state.runs)||Object.keys(state.projects).length>this.maxProjects||state.runs.length>this.maxRuns)throw Error('AUDIT_INVALID_STORAGE_STATE');
    for(const [key,setting]of Object.entries(state.projects))if(!/^[a-f0-9]{64}$/.test(key)||typeof setting?.enabled!=='boolean'||!Number.isSafeInteger(setting.revision)||setting.revision<1||typeof setting.confirmedSession!=='string'||!setting.confirmedSession)throw Error('AUDIT_INVALID_STORAGE_SETTINGS');
    const ids=new Set();for(const entry of state.runs){if(!/^[a-f0-9]{64}$/.test(entry.projectFingerprint||'')||typeof entry.sessionId!=='string'||!entry.run||!['COMPLETED','PARTIAL','CANCELLED'].includes(entry.run.taskState)||typeof entry.run.runId!=='string'||ids.has(entry.run.runId)||!Array.isArray(entry.run.results))throw Error('AUDIT_INVALID_STORAGE_HISTORY');ids.add(entry.run.runId);}
    if(state.reviews===undefined)state.reviews=[]; // Existing v1 files migrate only on an explicit write.
    review.validateReviews(state);
    return state;
  }
  _change(change) {
    const io=this.io;this._read();io.mkdirSync(this.directory,{recursive:true});const lock=this.file+'.lock',owner=crypto.randomUUID();let lockFd,temp,renamed=false;
    try {
      lockFd=io.openSync(lock,'wx');io.writeFileSync(lockFd,owner);
      const state=this._read(),result=change(state);state.revision++;
      if(Object.keys(state.projects).length>this.maxProjects||state.runs.length>this.maxRuns)throw Error('AUDIT_STORAGE_QUOTA');
      review.validateReviews(state);
      const bytes=Buffer.from(JSON.stringify(state));if(bytes.length>this.maxBytes)throw Error('AUDIT_STORAGE_QUOTA');
      temp=path.join(this.directory,`model-review-${owner}.tmp`);const fd=io.openSync(temp,'wx');try{io.writeFileSync(fd,bytes);io.fsyncSync(fd);}finally{io.closeSync(fd);}
      if(!io.existsSync(this.anchor)){const fd=io.openSync(this.anchor,'wx');try{io.writeFileSync(fd,'MEPBridge model audit initialized\n');io.fsyncSync(fd);}finally{io.closeSync(fd);}}
      io.renameSync(temp,this.file);renamed=true;return clone(result);
    }finally{
      if(temp&&!renamed&&io.existsSync(temp)){try{io.unlinkSync(temp);}catch(_){}}
      if(lockFd!==undefined){try{io.closeSync(lockFd);if(io.readFileSync(lock,'utf8')!==owner)throw Error('AUDIT_LOCK_OWNER_CHANGED');io.unlinkSync(lock);}catch(cause){this.poisoned=true;throw Object.assign(Error('AUDIT_STORAGE_UNKNOWN'),{cause,mayBeSaved:renamed});}}
    }
  }
  settings(project) {
    const key=projectKey(project),setting=this._read().projects[key];
    if(!setting)return{enabled:false,revision:0};
    if(setting.confirmedSession!==project.sessionId)return{enabled:false,revision:setting.revision,preferredEnabled:setting.enabled,reconfirmationRequired:true};
    return{enabled:setting.enabled,revision:setting.revision};
  }
  setEnabled(project,enabled,{expectedRevision=0}={}) {
    const key=projectKey(project);if(typeof enabled!=='boolean'||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('AUDIT_INVALID_SETTING');
    return this._change(state=>{const previous=state.projects[key];if((previous?.revision||0)!==expectedRevision)throw Error('AUDIT_SETTINGS_CONFLICT');const next={enabled,revision:expectedRevision+1,confirmedSession:project.sessionId};state.projects[key]=next;return{enabled,revision:next.revision};});
  }
  append(project,run) {
    const key=projectKey(project);if(!run||run.projectKey!==require('./model-audit-engine').identity(project)||typeof run.runId!=='string'||!['COMPLETED','PARTIAL','CANCELLED'].includes(run.taskState)||!Array.isArray(run.results))throw Error('AUDIT_INVALID_RUN');
    return this._change(state=>{if(state.runs.some(entry=>entry.run.runId===run.runId))throw Error('AUDIT_RUN_ALREADY_STORED');state.runs.push({projectFingerprint:key,sessionId:project.sessionId,run:clone(run)});return{stored:true};});
  }
  evidence(project,runId) {const key=projectKey(project),state=this._read();return{run:clone(review.findRun(state,key,runId)),review:clone(review.reviewView(state,key,runId))};}
  recordReview(project,{runId,guid,ruleId,evidenceHash,resultHash,expectedRevision,disposition,reviewerLabel,reason,confirmed}={}) {
    const key=projectKey(project);
    if(confirmed!==true||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!review.DISPOSITIONS.includes(disposition)||!review.text(reviewerLabel,200)||!review.text(reason,4000))throw Error('AUDIT_REVIEW_CONFIRMATION_AND_REASON_REQUIRED');
    return this._change(state=>{
      const run=review.findRun(state,key,runId),result=review.target(run,guid,ruleId),current=review.reviewView(state,key,runId);
      if(evidenceHash!==current.evidenceHash||resultHash!==review.hash(result))throw Error('AUDIT_REVIEW_EVIDENCE_CHANGED');
      const revision=current.targets.find(t=>t.guid===guid&&t.ruleId===ruleId).revision;
      if(revision!==expectedRevision)throw Error('AUDIT_REVIEW_CONFLICT');
      state.reviews.push({eventId:crypto.randomUUID(),projectFingerprint:key,runId,guid,ruleId,evidenceHash,resultHash,revision:revision+1,disposition,reviewerLabel:reviewerLabel.trim(),reason:reason.trim(),recordedAt:new Date().toISOString(),recordedSession:project.sessionId,authority:'SELF_DECLARED_NOT_AUTHENTICATED',doesNotChangeCalculation:true});
      return review.reviewView(state,key,runId);
    });
  }
  history(project) {const key=projectKey(project);return this._read().runs.filter(entry=>entry.projectFingerprint===key).map(entry=>({...clone(entry.run),historicalSession:entry.sessionId!==project.sessionId,historyStored:true}));}
}
module.exports={ModelAuditStore,projectKey};
