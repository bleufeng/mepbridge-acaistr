'use strict';

/**
 * SPDX-License-Identifier: MIT
 * MEPbridge ACAIstr - Instance Identity & Registry Service
 * Task C-INS-01 (v0.1.8 Foundation / v0.1.9 Alignment)
 *
 * Responsibilities:
 * 1. Session-level Archicad instance identity management and discovery caching
 * 2. BigInt 64-bit FNV-1a path/project hashing (fnv1a64:...)
 * 3. Mode A (sequential switch verification) & Mode B (dual-instance distinctness verification)
 * 4. Synthesizes standardized sourceInstance metadata without requiring deferred C++ commands
 */

const {
  DEFAULT_PORTS,
  describeAllInstances,
  describeInstance,
} = require('./archicad-instances');
const {
  resolveTargetInstance,
  coerceTargetPort,
} = require('./instance-targeting');

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * 64-bit FNV-1a Hash implementation
 * @param {string} str
 * @returns {string} fnv1a64:<16-hex>
 */
function fnv1a64(str) {
  if (typeof str !== 'string') {
    str = String(str || '');
  }
  const buf = Buffer.from(str, 'utf8');
  let hash = FNV_OFFSET_BASIS_64;
  for (let i = 0; i < buf.length; i++) {
    hash = (hash ^ BigInt(buf[i])) & MASK_64;
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  const hex = hash.toString(16).padStart(16, '0');
  return `fnv1a64:${hex}`;
}

/**
 * Normalize and compute deterministic projectPathHash
 */
function computeProjectPathHash(projectPathOrName) {
  if (!projectPathOrName || typeof projectPathOrName !== 'string') {
    return fnv1a64('');
  }
  const normalized = projectPathOrName.trim().replace(/\\/g, '/').toLowerCase();
  return fnv1a64(normalized);
}

// In-memory instance registry cache for session tracking
const instanceRegistryCache = new Map();

/**
 * Register or update an instance in the cache
 */
function registerInstance(instanceData) {
  if (!instanceData || typeof instanceData.instanceId !== 'string') {
    throw new Error('registerInstance: instanceData must contain instanceId string');
  }
  instanceRegistryCache.set(instanceData.instanceId, {
    ...instanceData,
    registeredAt: new Date().toISOString(),
  });
  return instanceData;
}

/**
 * Get instance by instanceId
 */
function getInstance(instanceId) {
  return instanceRegistryCache.get(instanceId) || null;
}

/**
 * List all registered instances
 */
function listInstances() {
  return Array.from(instanceRegistryCache.values());
}

/**
 * Clear the registry
 */
function clearRegistry() {
  instanceRegistryCache.clear();
}

/**
 * Synthesizes standardized sourceInstance metadata block
 * @param {Object} describedInstance
 * @param {Object} options
 * @returns {Object} sourceInstance
 */
function synthesizeInstanceIdentity(describedInstance, options = {}) {
  const port = describedInstance.port || 19723;
  const acVer = describedInstance.archicadVersion ||
    (describedInstance.productInfo && describedInstance.productInfo.version) ||
    29;
  const instanceId = options.instanceId || `ac${acVer}-port-${port}`;

  const projectName = describedInstance.projectName || options.projectName || 'Untitled';
  const projectPath = describedInstance.projectPath || options.projectPath || '';
  const projectPathHash = options.projectPathHash || computeProjectPathHash(projectPath || projectName);

  const northAngleDeg = Number.isFinite(Number(options.northAngleDeg)) ? Number(options.northAngleDeg) : 0.0;
  const originOffset = options.originOffset && typeof options.originOffset === 'object'
    ? {
        x: Number.isFinite(Number(options.originOffset.x)) ? Number(options.originOffset.x) : 0.0,
        y: Number.isFinite(Number(options.originOffset.y)) ? Number(options.originOffset.y) : 0.0,
        z: Number.isFinite(Number(options.originOffset.z)) ? Number(options.originOffset.z) : 0.0,
      }
    : { x: 0.0, y: 0.0, z: 0.0 };

  return {
    instanceId,
    port,
    projectName,
    projectPath,
    projectPathHash,
    archicadVersion: String(acVer),
    addOnVersion: describedInstance.addOnVersion || options.addOnVersion || '0.1.8',
    coordSystem: 'archicad_world',
    lengthUnit: 'm',
    quantization: 0.0001,
    projectLocation: {
      northAngleDeg,
      originOffset,
    },
  };
}

/**
 * Mode A: Verify that the project was actually switched before triggering sequential diff
 * Prevents unintentional self-comparison (A vs A)
 */
function verifySequentialSwitch(prevInstance, currInstance) {
  if (!prevInstance || !currInstance) {
    return { ok: true };
  }

  const prevPath = (prevInstance.projectPath || '').trim().toLowerCase();
  const currPath = (currInstance.projectPath || '').trim().toLowerCase();
  const prevName = (prevInstance.projectName || '').trim().toLowerCase();
  const currName = (currInstance.projectName || '').trim().toLowerCase();

  // If path is specified on both and identical, or names are identical (and non-empty)
  const pathSame = prevPath && currPath && prevPath === currPath;
  const nameSame = prevName && currName && prevName === currName;

  if (pathSame || (nameSame && !prevPath && !currPath)) {
    return {
      ok: false,
      errorType: 'SELF_DIFF_DETECTED',
      message: '检测到同一工程文件自比对。请在 Archicad 中打开对比版本后再提取，或使用历史快照进行对比。',
    };
  }

  return { ok: true };
}

/**
 * Mode B: Verify two distinct instances are provided
 */
function verifyDistinctInstances(instA, instB) {
  if (!instA || !instB) {
    return {
      ok: false,
      errorType: 'MISSING_INSTANCE_PAIR',
      message: '双实例对比模式必须提供两个有效的 Archicad 实例',
    };
  }

  if (instA.port === instB.port) {
    return {
      ok: false,
      errorType: 'DUAL_INSTANCE_PORT_CONFLICT',
      message: `双实例对比模式要求两个不同端口的 Archicad 实例，但当前两个端口均为 ${instA.port}`,
    };
  }

  return { ok: true };
}

module.exports = {
  FNV_OFFSET_BASIS_64,
  FNV_PRIME_64,
  fnv1a64,
  computeProjectPathHash,
  registerInstance,
  getInstance,
  listInstances,
  clearRegistry,
  synthesizeInstanceIdentity,
  verifySequentialSwitch,
  verifyDistinctInstances,
};
