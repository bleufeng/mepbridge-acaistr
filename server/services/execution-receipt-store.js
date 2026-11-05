/**
 * execution-receipt-store.js
 * V19-EXEC-01 / ACT-V19-08: 写入执行回执存储与长链路幂等状态服务
 *
 * 约束对齐（DEC-V19-16 & R-10/11）：
 * 1. 唯一操作凭据（Operation Receipt）：每个执行步骤/尝试具备确定性 receiptId。
 * 2. 状态机严格受控：
 *    PENDING -> DISPATCHED -> COMPLETED | FAILED_VERIFIED | TIMEOUT_UNVERIFIED -> COMPLETED_BY_VERIFICATION | UNKNOWN
 * 3. 超时未知防护（fail-closed）：
 *    若上次尝试为 TIMEOUT_UNVERIFIED 且未经核验证明 absent，严格禁止自动重发！
 * 4. 重启/记录丢失时一律判为 UNKNOWN，禁止盲目重发。
 */

'use strict';

const crypto = require('crypto');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}
function requestHash(step) {
  const { resolvePlanRequest } = require('./semantic-fidelity-gate');
  return crypto.createHash('sha256').update(JSON.stringify(canonical(resolvePlanRequest(step)))).digest('hex');
}
function isMutationStep(step = {}) {
  const { resolvePlanCommand } = require('./semantic-fidelity-gate');
  const command = resolvePlanCommand(step);
  const name = command.parameters?.addOnCommandId?.commandName || command.command;
  // Only registry-declared reads may bypass write protection. Caller labels do not demote a command.
  const descriptors = require('../../ai-adapter/tool-descriptors.json').descriptors;
  const descriptor = descriptors.find(d => d.commandName === name);
  return step.isMutation === true || (step.riskLevel && step.riskLevel !== 'read') || descriptor?.riskLevel !== 'read';
}
function isUncertainExecution(result = {}) {
  const text = [result.error, result.code, result.message].filter(Boolean).join(' ');
  return /timeout|timed\s*out|etimedout|econn|socket|network|ehost|enet|eai_again|enotfound|aborted/i.test(text) || Number(result.statusCode || result.httpStatus) >= 500;
}

const RECEIPT_STATUS = {
  PENDING: 'PENDING',
  DISPATCHED: 'DISPATCHED',
  COMPLETED: 'COMPLETED',
  FAILED_VERIFIED: 'FAILED_VERIFIED',
  TIMEOUT_UNVERIFIED: 'TIMEOUT_UNVERIFIED',
  COMPLETED_BY_VERIFICATION: 'COMPLETED_BY_VERIFICATION',
  UNKNOWN: 'UNKNOWN'
};

class ExecutionReceiptStore {
  constructor() {
    /** @type {Map<string, object>} receiptId -> receipt */
    this._receipts = new Map();
    /** @type {Map<string, string[]>} chainId -> receiptId[] */
    this._chainReceipts = new Map();
  }

  /**
   * 生成确定性凭据 ID
   */
  generateReceiptId(chainId, stepIndex, attempt = 0) {
    if (typeof chainId !== 'string' || !chainId || !Number.isSafeInteger(stepIndex) || stepIndex < 0 || !Number.isSafeInteger(attempt) || attempt < 0) throw new Error('INVALID_RECEIPT_ID');
    return `${chainId}_s${stepIndex}_a${attempt}`;
  }

  /**
   * 创建新的执行凭据
   */
  createReceipt(chainId, stepIndex, attempt, stepData = {}) {
    const receiptId = this.generateReceiptId(chainId, stepIndex, attempt);
    const isMutation = Boolean(isMutationStep(stepData));
    const hash = requestHash(stepData);
    const existing = this._receipts.get(receiptId);
    if (existing) {
      if (existing.requestHash !== hash || existing.isMutation !== isMutation) throw new Error('RECEIPT_REQUEST_CONFLICT');
      return clone(existing); // Never overwrite dispatched/completed/unknown evidence.
    }
    const latest = this.getLatestStepReceipt(chainId, stepIndex);
    if (isMutation && latest && !this.evaluateRetrySafety(chainId, stepIndex, true).safe) throw new Error('RECEIPT_PREVIOUS_ATTEMPT_UNRESOLVED');
    if (isMutation && attempt > 0 && !latest) throw new Error('RECEIPT_HISTORY_MISSING_UNKNOWN');

    const receipt = {
      receiptId,
      requestHash: hash,
      chainId,
      stepIndex,
      attempt,
      action: stepData.action || 'Unknown',
      isMutation,
      status: RECEIPT_STATUS.PENDING,
      createdAt: new Date().toISOString(),
      dispatchedAt: null,
      completedAt: null,
      targetPort: stepData.targetPort || null,
      result: null,
      error: null,
      verification: null
    };

    this._receipts.set(receiptId, receipt);

    if (!this._chainReceipts.has(chainId)) {
      this._chainReceipts.set(chainId, []);
    }
    this._chainReceipts.get(chainId).push(receiptId);

    return clone(receipt);
  }

  /**
   * 标记已发出请求
   */
  markDispatched(receiptId, metadata = {}) {
    const receipt = this._receipts.get(receiptId);
    if (!receipt || receipt.status !== RECEIPT_STATUS.PENDING) return null;

    receipt.status = RECEIPT_STATUS.DISPATCHED;
    receipt.dispatchedAt = new Date().toISOString();
    if (metadata.targetPort) receipt.targetPort = metadata.targetPort;
    if (metadata.paramsSummary) receipt.paramsSummary = clone(metadata.paramsSummary);

    return clone(receipt);
  }

  /**
   * 标记执行完成（成功）
   */
  markCompleted(receiptId, result = {}) {
    const receipt = this._receipts.get(receiptId);
    if (!receipt || receipt.status !== RECEIPT_STATUS.DISPATCHED) return null;

    receipt.status = RECEIPT_STATUS.COMPLETED;
    receipt.completedAt = new Date().toISOString();
    receipt.result = clone(result);

    return clone(receipt);
  }

  /**
   * 标记执行失败
   * @param {string} receiptId
   * @param {string} error
   * @param {boolean} isTimeout - 是否因网络超时/掉线导致无法获知对端执行状态
   */
  markFailed(receiptId, error, isTimeout = false, verifiedNoEffect = false) {
    const receipt = this._receipts.get(receiptId);
    if (!receipt || receipt.status !== RECEIPT_STATUS.DISPATCHED) return null;

    receipt.completedAt = new Date().toISOString();
    receipt.error = error || 'Unknown error';

    if (isTimeout && receipt.isMutation) {
      receipt.status = RECEIPT_STATUS.TIMEOUT_UNVERIFIED;
    } else {
      receipt.status = receipt.isMutation && !verifiedNoEffect ? RECEIPT_STATUS.UNKNOWN : RECEIPT_STATUS.FAILED_VERIFIED;
    }

    return clone(receipt);
  }

  /**
   * 记录事后核验结论（V19-REC-01 联动）
   * @param {string} receiptId
   * @param {'absent'|'present'|'unknown'} state
   * @param {object} details
   */
  markVerified(receiptId, state, details = {}) {
    const receipt = this._receipts.get(receiptId);
    if (!receipt || ![RECEIPT_STATUS.TIMEOUT_UNVERIFIED, RECEIPT_STATUS.UNKNOWN].includes(receipt.status)) return null;
    if (!['absent', 'present', 'unknown'].includes(state)) state = 'unknown';

    receipt.verification = {
      state,
      verifiedAt: new Date().toISOString(),
      reason: details.reason || '',
      adoptedData: clone(details.adoptedData) || null
    };

    if (state === 'present') {
      receipt.status = RECEIPT_STATUS.COMPLETED_BY_VERIFICATION;
      if (details.adoptedData) {
        receipt.result = clone(details.adoptedData);
      }
    } else if (state === 'absent') {
      receipt.status = RECEIPT_STATUS.TIMEOUT_UNVERIFIED;
    } else if (state === 'unknown') {
      receipt.status = RECEIPT_STATUS.UNKNOWN;
    }

    return clone(receipt);
  }

  /**
   * 获取凭据
   */
  getReceipt(receiptId) {
    return clone(this._receipts.get(receiptId)) || null;
  }

  /**
   * 获取指定链路某步骤的最新凭据
   */
  getLatestStepReceipt(chainId, stepIndex) {
    const ids = this._chainReceipts.get(chainId) || [];
    let latest = null;

    for (const id of ids) {
      const r = this._receipts.get(id);
      if (r && r.stepIndex === stepIndex) {
        if (!latest || r.attempt > latest.attempt) {
          latest = r;
        }
      }
    }

    return clone(latest);
  }

  /**
   * 校验当前步骤是否允许重发（防重复创建与盲目重试）
   * @param {string} chainId
   * @param {number} stepIndex
   * @param {boolean} isMutation
   * @returns {{ safe: boolean, reason?: string, adopted?: boolean, adoptedData?: object }}
   */
  evaluateRetrySafety(chainId, stepIndex, isMutation) {
    // 只读操作不受防重复写入限制
    if (!isMutation) {
      return { safe: true };
    }

    const latest = this.getLatestStepReceipt(chainId, stepIndex);
    if (!latest) {
      // 无记录可查时，如果被要求重发，严禁盲目放行
      return { safe: false, reason: '未找到前序执行凭据，状态未知 (UNKNOWN)，禁止盲目重发' };
    }

    // 若已经由后验确认已生效，直接采纳结果，无需且不得重发
    if (latest.status === RECEIPT_STATUS.COMPLETED || latest.status === RECEIPT_STATUS.COMPLETED_BY_VERIFICATION) {
      return {
        safe: false,
        adopted: true,
        adoptedData: latest.result || (latest.verification && latest.verification.adoptedData),
        reason: '构件或操作已被后验确认为已存在 (present)，直接采纳结果，跳过重发'
      };
    }

    // 若处于超时未核验状态
    if (latest.status === RECEIPT_STATUS.TIMEOUT_UNVERIFIED) {
      if (latest.verification && latest.verification.state === 'absent') {
        return { safe: true, reason: '经三态核验证明构件不存在 (absent)，允许受控重试' };
      }
      return {
        safe: false,
        reason: `操作发生网络超时，当前对端状态为 ${latest.verification ? latest.verification.state : '未核验'}，禁止盲目重发`
      };
    }

    // 处于 UNKNOWN 状态严格 fail-closed
    if (latest.status === RECEIPT_STATUS.UNKNOWN) {
      return { safe: false, reason: '操作状态未知 (UNKNOWN)，禁止自动重发' };
    }

    // 经确证失败（如对端明确返回参数错误），可允许受控重发/调参
    if (latest.status === RECEIPT_STATUS.FAILED_VERIFIED) {
      return { safe: true };
    }

    return { safe: false, reason: '操作尚待派发或已在执行中，禁止并发重发' };
  }

  /**
   * 清除指定 chain 的记录（释放内存）
   */
  clearChain(chainId) {
    const ids = this._chainReceipts.get(chainId) || [];
    for (const id of ids) {
      this._receipts.delete(id);
    }
    this._chainReceipts.delete(chainId);
  }
}

// 导出全局单例及常量
const receiptStore = new ExecutionReceiptStore();

module.exports = {
  RECEIPT_STATUS,
  ExecutionReceiptStore,
  receiptStore,
  isMutationStep,
  isUncertainExecution,
  requestHash
};
