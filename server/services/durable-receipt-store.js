// SPDX-License-Identifier: MIT
'use strict';
// Explicitly configured durable receipt adapter. Never scans, forwards or resumes a write.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const {ExecutionReceiptStore, RECEIPT_STATUS, isMutationStep, requestHash} = require('./execution-receipt-store');
const copy = value => JSON.parse(JSON.stringify(value));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320];
function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
function publishAtomic(io, source, destination) {
  for (let attempt = 0; ; attempt++) {
    try {
      io.renameSync(source, destination);
      return;
    } catch (error) {
      const retryable = TRANSIENT_RENAME_CODES.has(error?.code) && attempt < RENAME_RETRY_DELAYS_MS.length;
      if (!retryable) throw error;
      sleepSync(RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}
function targetIdentity(step) {
  const target = step.receiptTarget;
  if (!target || !Number.isInteger(target.port) || target.port < 19723 || target.port > 19743 ||
      !/^[a-f0-9]{64}$/i.test(target.projectFingerprint || '') ||
      typeof target.sessionId !== 'string' || !target.sessionId || target.sessionId.length > 128) {
    throw new Error('RECEIPT_TARGET_IDENTITY_REQUIRED');
  }
  return {port: target.port, projectFingerprint: target.projectFingerprint.toLowerCase(), sessionId: target.sessionId};
}
function privateData(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('RECEIPT_INVALID_NUMBER');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(api.?key|authorization|password|secret|access.?token|refresh.?token)$/i.test(key)) throw new Error('RECEIPT_PRIVATE_DATA_REJECTED');
    privateData(child);
  }
}
class DurableReceiptStore {
  constructor({directory, io = fs, maxBytes = 2 * 1024 * 1024, maxReceipts = 2000, verifyProof = null} = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('RECEIPT_DIRECTORY_REQUIRED');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 2 * 1024 * 1024 || !Number.isSafeInteger(maxReceipts) || maxReceipts < 1 || maxReceipts > 2000) throw new Error('RECEIPT_INVALID_QUOTA');
    this.directory = path.resolve(directory); this.file = path.join(this.directory, 'execution-receipts-v1.json');
    this.anchor = path.join(this.directory, 'execution-receipts-v1.initialized');
    this.io = io; this.maxBytes = maxBytes; this.maxReceipts = maxReceipts;
    this.session = crypto.randomUUID(); this.poisoned = false;
    this.requiresQualifiedHostBinding = true;
    this.verifyProof = typeof verifyProof === "function" ? verifyProof : () => false;
    // Constructor is side-effect free: no default user-store writes or crash-recovery replay.
  }
  _read() {
    const io = this.io;
    for (let p = this.directory; ; p = path.dirname(p)) {
      if (io.existsSync(p) && io.lstatSync(p).isSymbolicLink()) throw new Error('RECEIPT_UNSAFE_PATH');
      if (path.dirname(p) === p) break;
    }
    if (!io.existsSync(this.file)) {
      if (io.existsSync(this.anchor)) throw new Error('RECEIPT_HISTORY_MISSING_UNKNOWN');
      return {version: 1, revision: 0, receipts: [], retiredChains: []};
    }
    if (io.lstatSync(this.file).isSymbolicLink() || io.statSync(this.file).size > this.maxBytes) throw new Error('RECEIPT_INVALID_FILE');
    const bytes = io.readFileSync(this.file); if (bytes.length > this.maxBytes) throw new Error('RECEIPT_QUOTA_EXCEEDED');
    const state = JSON.parse(bytes.toString('utf8'));
    if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.receipts) || !Array.isArray(state.retiredChains) || state.receipts.length + state.retiredChains.length > this.maxReceipts) throw new Error('RECEIPT_INVALID_STATE');
    const ids = new Set();
    for (const r of state.receipts) {
      if (!r || typeof r.chainId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(r.chainId) || !Number.isSafeInteger(r.stepIndex) || r.stepIndex < 0 || !Number.isSafeInteger(r.attempt) || r.attempt < 0 || r.receiptId !== `${r.chainId}_s${r.stepIndex}_a${r.attempt}` || ids.has(r.receiptId) || !Object.values(RECEIPT_STATUS).includes(r.status) || typeof r.isMutation !== 'boolean' || !/^[a-f0-9]{64}$/.test(r.requestHash || '') || typeof r.writerSession !== 'string' || !r.writerSession) throw new Error('RECEIPT_INVALID_STATE');
      if (r.isMutation) { targetIdentity({receiptTarget:r.targetIdentity}); if (r.targetHash !== digest(JSON.stringify(targetIdentity({receiptTarget:r.targetIdentity})))) throw new Error('RECEIPT_INVALID_STATE'); }
      if (r.manualDisposition && (r.manualDisposition.kind !== 'ACCEPT_CURRENT_MODEL_BASELINE' || typeof r.manualDisposition.note !== 'string' || !r.manualDisposition.note.trim() || r.manualDisposition.note.length > 2000 || !Number.isFinite(Date.parse(r.manualDisposition.at)) || typeof r.manualDisposition.confirmedSession !== 'string' || !r.manualDisposition.confirmedSession || r.manualDisposition.confirmedSession.length > 128 || r.manualDisposition.confirmedSession === r.targetIdentity?.sessionId || r.status !== RECEIPT_STATUS.UNKNOWN)) throw new Error('RECEIPT_INVALID_MANUAL_DISPOSITION');
      if(r.workflow!==undefined)require('./snapshot-execution').validateWorkflow(r.workflow);
      ids.add(r.receiptId);
      // Even PENDING is not an automatic resume grant in another process/session.
      if (r.writerSession !== this.session && ['PENDING','DISPATCHED','TIMEOUT_UNVERIFIED'].includes(r.status)) {
        r.status = RECEIPT_STATUS.UNKNOWN; r.recoveryReason = 'RESTART_OR_OTHER_WRITER_UNCONFIRMED';
      }
    }
    if (new Set(state.retiredChains).size !== state.retiredChains.length || state.retiredChains.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id) || state.receipts.some(r=>r.chainId===id))) throw new Error('RECEIPT_INVALID_STATE');
    privateData(state); return state;
  }
  _memory(state) {
    const store = new ExecutionReceiptStore();
    for (const row of state.receipts) { store._receipts.set(row.receiptId, copy(row)); const ids = store._chainReceipts.get(row.chainId) || []; ids.push(row.receiptId); store._chainReceipts.set(row.chainId, ids); }
    return store;
  }
  _view(fn) { if (this.poisoned) throw new Error('RECEIPT_STORAGE_UNKNOWN'); return fn(this._memory(this._read())); }
  _change(fn) {
    if (this.poisoned) throw new Error('RECEIPT_STORAGE_UNKNOWN');
    const io = this.io; this._read(); io.mkdirSync(this.directory, {recursive: true});
    const lock = this.file + '.lock'; let fd, temp, renamed = false;
    try {
      fd = io.openSync(lock, 'wx'); io.writeFileSync(fd, this.session);
      const state = this._read(), store = this._memory(state), result = fn(store, state);
      state.receipts = [...store._receipts.values()]; state.revision++;
      if (state.receipts.length + state.retiredChains.length > this.maxReceipts) throw new Error('RECEIPT_QUOTA_EXCEEDED');
      privateData(state); const bytes = Buffer.from(JSON.stringify(state)); if (bytes.length > this.maxBytes) throw new Error('RECEIPT_QUOTA_EXCEEDED');
      temp = path.join(this.directory, `execution-receipts-${crypto.randomUUID()}.tmp`);
      const tempFd = io.openSync(temp, 'wx');
      try { io.writeFileSync(tempFd, bytes); io.fsyncSync(tempFd); } finally { io.closeSync(tempFd); }
      // The marker is created before first publication. If the store is later lost,
      // never treat the directory as a fresh operation history. Partial initialization
      // fails closed and requires maintenance, not silent retry.
      if (!io.existsSync(this.anchor)) {
        const anchorFd = io.openSync(this.anchor, 'wx');
        try { io.writeFileSync(anchorFd, 'MEPBridge durable history initialized\n'); io.fsyncSync(anchorFd); } finally { io.closeSync(anchorFd); }
      }
      publishAtomic(io, temp, this.file); renamed = true;
      return copy(result === undefined ? null : result);
    } catch (error) {
      if (renamed) { this.poisoned = true; error.operationMayBeCommitted = true; }
      throw error;
    } finally {
      if (temp && !renamed && io.existsSync(temp)) { try { io.unlinkSync(temp); } catch (_) {} }
      if (fd !== undefined) {
        try { io.closeSync(fd); if (io.readFileSync(lock, 'utf8') !== this.session) throw new Error('RECEIPT_LOCK_OWNER_CHANGED'); io.unlinkSync(lock); }
        catch (cause) { this.poisoned = true; const error = new Error('RECEIPT_STORAGE_UNKNOWN'); error.operationMayBeCommitted = renamed; error.cause = cause; throw error; }
      }
    }
  }
  generateReceiptId(...args) { return new ExecutionReceiptStore().generateReceiptId(...args); }
  createReceipt(chainId, stepIndex, attempt, step = {}) {
    if (typeof chainId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(chainId)) throw new Error('INVALID_RECEIPT_ID');
    privateData(step);
    const preparedBytes = Buffer.byteLength(JSON.stringify(step));
    if (preparedBytes > 128 * 1024) throw new Error("RECEIPT_REQUEST_QUOTA");
    const target = isMutationStep(step) ? targetIdentity(step) : null;
    const targetHash = target ? digest(JSON.stringify(target)) : null;
    return this._change((store, state) => {
      if (state.retiredChains.includes(chainId)) throw new Error('RECEIPT_RETIRED_CHAIN_UNKNOWN');
      const prior = store.getLatestStepReceipt(chainId, stepIndex);
      if (prior && prior.targetHash !== targetHash) throw new Error('RECEIPT_TARGET_CONFLICT');
      const r = store.createReceipt(chainId, stepIndex, attempt, step);
      const row = store._receipts.get(r.receiptId);
      if (!row.writerSession) { row.writerSession = this.session; row.targetIdentity = target; row.targetHash = targetHash; }
      return row;
    });
  }
  claimOperation(id, step) {
    privateData(step);
    if (!/^[a-f0-9]{64}$/.test(id || '') || Buffer.byteLength(JSON.stringify(step)) > 128 * 1024) throw new Error('EXEC_INVALID_OPERATION');
    const binding = targetIdentity(step), targetHash = digest(JSON.stringify(binding));
    return this._change((store, state) => {
      if (state.retiredChains.includes(id)) throw new Error('RECEIPT_RETIRED_CHAIN_UNKNOWN');
      const previous = store.getLatestStepReceipt(id, 0);
      if (previous && previous.targetHash !== targetHash) throw new Error('RECEIPT_TARGET_CONFLICT');
      if (!previous) {
        if(step.workflow){
          const priorWorkflow=[...store._receipts.values()].find(r=>r.workflow?.inputHash===step.workflow.inputHash);
          if(priorWorkflow)throw Object.assign(Error('SNAPSHOT_PREVIEW_ALREADY_ADMITTED'),{blockingOperationId:priorWorkflow.chainId});
        }
        const unresolvedRows = [...store._receipts.values()].filter(row => row.isMutation && !row.manualDisposition && row.targetIdentity?.projectFingerprint === binding.projectFingerprint && ['PENDING','DISPATCHED','TIMEOUT_UNVERIFIED','UNKNOWN'].includes(row.status));
        // AI-first allows unrelated work to continue, but an omitted-ID resend of
        // the same normalized mutation is still a blind replay and must reuse/query
        // the original operation ID instead of dispatching under a fresh one.
        const sameRequest = unresolvedRows.find(row => row.requestHash === requestHash(step));
        if (sameRequest) throw Object.assign(new Error('EXEC_SAME_REQUEST_UNRESOLVED'), {blockingOperationId:sameRequest.chainId});
        if (!step.allowUnresolved && unresolvedRows.length) {
          throw Object.assign(new Error('EXEC_TARGET_HAS_UNRESOLVED_OPERATION'), {blockingOperationId:unresolvedRows[0].chainId});
        }
      }
      const receipt = store.createReceipt(id, 0, 0, step);
      if (previous) return { claimed: false, receipt };
      const row = store._receipts.get(receipt.receiptId);
      row.writerSession = this.session; row.targetIdentity = binding; row.targetHash = targetHash;
      if(step.workflow!==undefined){require('./snapshot-execution').validateWorkflow(step.workflow);row.workflow=copy(step.workflow);}
      store.markDispatched(row.receiptId, { targetPort: binding.port });
      return { claimed: true, receipt: store.getReceipt(row.receiptId) };
    });
  }
  markDispatched(id, metadata = {}) { privateData(metadata); return this._change(store => { const row=store.getReceipt(id); if (row?.isMutation && metadata.targetPort && metadata.targetPort!==row.targetIdentity.port) throw new Error('RECEIPT_TARGET_CONFLICT'); return store.markDispatched(id, metadata); }); }
  markCompleted(...args) { privateData(args); return this._change(store => {
    const row = store._receipts.get(args[0]);
    if (row?.manualDisposition) return null; // Late writer cannot rewrite a manually accepted unknown outcome.
    if (row?.writerSession === this.session && row.status === RECEIPT_STATUS.UNKNOWN && row.recoveryReason === 'RESTART_OR_OTHER_WRITER_UNCONFIRMED') row.status = RECEIPT_STATUS.DISPATCHED;
    return store.markCompleted(...args);
  }); }
  markFailed(...args) { privateData(args); return this._change(store => store._receipts.get(args[0])?.manualDisposition ? null : store.markFailed(...args)); }
  markVerified(id, state, details = {}) {
    return this._change(store => {
      const r = store.getReceipt(id);
      if (r?.manualDisposition) return null; // Manual UNKNOWN is not a verification candidate.
      // Offline/user claims are not command-level proof; do not adopt or release a retry.
      if (state !== 'unknown' && (!r || details.requestHash !== r.requestHash || details.targetHash !== r.targetHash || this.verifyProof(details, copy(r)) !== true)) throw new Error('RECEIPT_SAME_OPERATION_PROOF_REQUIRED');
      privateData(details);
      return store.markVerified(id, state, details);
    });
  }
  getReceipt(id) { return this._view(store => store.getReceipt(id)); }
  getChainReceipts(id) { return this._view(store => [...store._receipts.values()].filter(r=>r.chainId===id).map(copy)); }
  getLatestStepReceipt(...args) { return this._view(store => store.getLatestStepReceipt(...args)); }
  evaluateRetrySafety(...args) { try { return this._view(store => store.evaluateRetrySafety(...args)); } catch (error) { return {safe:false,reason:error.message,recoveryRequired:true}; } }
  clearChain(id) { if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error("INVALID_RECEIPT_ID"); return this._change((store,state) => { const rows=[...store._receipts.values()].filter(r=>r.chainId===id); if(rows.some(r=>r.workflow))throw Error('SNAPSHOT_WORKFLOW_RETENTION_REQUIRED'); if (rows.some(r=>!['COMPLETED','COMPLETED_BY_VERIFICATION','FAILED_VERIFIED'].includes(r.status))) throw new Error('RECEIPT_UNRESOLVED_RETENTION_REQUIRED'); store.clearChain(id); if (!state.retiredChains.includes(id)) state.retiredChains.push(id); }); }
}
module.exports = {DurableReceiptStore, targetIdentity};
