const fs = require('fs');
const path = require('path');

const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9-]{1,63}\.[a-z][a-z0-9-]{1,63}$/;
const SUPPORTED_RISK_LEVELS = new Set(['read-only', 'low-mutation']);
const SUPPORTED_ARCHICAD_ACCESS = new Set(['none', 'read', 'write']);

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isPathInside(parentPath, candidatePath) {
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveInside(parentPath, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '' || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }

  const resolved = path.resolve(parentPath, relativePath);
  if (!isPathInside(parentPath, resolved)) {
    throw new Error(`${label} resolves outside its allowed directory`);
  }
  return resolved;
}

function validateRegistry(registry) {
  const errors = [];
  if (!registry || registry.schemaVersion !== 'mepbridge-module-registry-1') {
    errors.push('registry.schemaVersion must be mepbridge-module-registry-1');
  }
  if (!Array.isArray(registry?.modules)) {
    errors.push('registry.modules must be an array');
    return errors;
  }

  const ids = new Set();
  for (const entry of registry.modules) {
    if (!MODULE_ID_PATTERN.test(entry?.id || '')) {
      errors.push(`invalid module id in registry: ${String(entry?.id || '')}`);
      continue;
    }
    if (ids.has(entry.id)) errors.push(`duplicate module id in registry: ${entry.id}`);
    ids.add(entry.id);

    if (entry.path !== entry.id) {
      errors.push(`registry path must equal module id for ${entry.id}`);
    }
    if (typeof entry.enabled !== 'boolean') {
      errors.push(`registry enabled flag must be boolean for ${entry.id}`);
    }
    if (entry.trusted !== true) {
      errors.push(`registry module must be explicitly trusted: ${entry.id}`);
    }
  }
  return errors;
}

function validateManifest(manifest, expectedId) {
  const errors = [];
  if (!manifest || manifest.schemaVersion !== 'mepbridge-module-manifest-1') {
    errors.push('manifest.schemaVersion must be mepbridge-module-manifest-1');
  }
  if (!MODULE_ID_PATTERN.test(manifest?.id || '')) {
    errors.push('manifest.id is invalid');
  }
  if (expectedId && manifest?.id !== expectedId) {
    errors.push(`manifest.id must match registry id ${expectedId}`);
  }
  if (typeof manifest?.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    errors.push('manifest.version must use x.y.z');
  }
  if (manifest?.apiVersion !== '1') {
    errors.push('manifest.apiVersion must be 1');
  }
  if (!manifest?.displayName || typeof manifest.displayName !== 'object') {
    errors.push('manifest.displayName must be an object');
  }
  if (typeof manifest?.description !== 'object') {
    errors.push('manifest.description must be an object');
  }
  if (!SUPPORTED_RISK_LEVELS.has(manifest?.riskLevel)) {
    errors.push('manifest.riskLevel must be read-only or low-mutation');
  }
  if (typeof manifest?.entry !== 'string') errors.push('manifest.entry is required');
  if (typeof manifest?.descriptors !== 'string') errors.push('manifest.descriptors is required');

  const permissions = manifest?.permissions;
  if (!permissions || typeof permissions !== 'object') {
    errors.push('manifest.permissions is required');
  } else {
    const archicad = permissions.archicad;
    if (!archicad || !SUPPORTED_ARCHICAD_ACCESS.has(archicad.access)) {
      errors.push('permissions.archicad.access must be none, read, or write');
    }
    if (!Array.isArray(archicad?.commands)) {
      errors.push('permissions.archicad.commands must be an array');
    } else if (new Set(archicad.commands).size !== archicad.commands.length) {
      errors.push('permissions.archicad.commands contains duplicates');
    }
    if (permissions.filesystem !== 'none') {
      errors.push('permissions.filesystem must be none for C2 modules');
    }
    if (permissions.network !== 'none') {
      errors.push('permissions.network must be none for C2 modules');
    }
    if (archicad?.access === 'write' && manifest?.review?.nativeWriteApproved !== true) {
      errors.push('write access requires review.nativeWriteApproved=true');
    }
  }

  return errors;
}

function validateDescriptorDocument(document, moduleId) {
  const errors = [];
  if (!document || document.schemaVersion !== 'mepbridge-module-descriptors-1') {
    errors.push('descriptors.schemaVersion must be mepbridge-module-descriptors-1');
  }
  if (document?.moduleId !== moduleId) {
    errors.push(`descriptors.moduleId must be ${moduleId}`);
  }
  if (!Array.isArray(document?.commands) || document.commands.length === 0) {
    errors.push('descriptors.commands must be a non-empty array');
    return errors;
  }

  const names = new Set();
  for (const command of document.commands) {
    if (!COMMAND_NAME_PATTERN.test(command?.name || '') || !command.name.startsWith(`${moduleId}.`)) {
      errors.push(`invalid namespaced command name: ${String(command?.name || '')}`);
      continue;
    }
    if (names.has(command.name)) errors.push(`duplicate module command: ${command.name}`);
    names.add(command.name);

    if (typeof command.description !== 'object') {
      errors.push(`command description must be localized: ${command.name}`);
    }
    if (!SUPPORTED_RISK_LEVELS.has(command.riskLevel)) {
      errors.push(`unsupported risk level for ${command.name}`);
    }
    if (command.inputSchema?.type !== 'object') {
      errors.push(`inputSchema.type must be object for ${command.name}`);
    }
  }
  return errors;
}

function validateValueAgainstSchema(value, schema, valuePath = 'parameters') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${valuePath} must be one of the declared enum values`);
    return errors;
  }

  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${valuePath} must be an object`);
      return errors;
    }

    const properties = schema.properties || {};
    for (const requiredName of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, requiredName)) {
        errors.push(`${valuePath}.${requiredName} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${valuePath}.${key} is not allowed`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateValueAgainstSchema(value[key], childSchema, `${valuePath}.${key}`));
      }
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${valuePath} must be an array`);
      return errors;
    }
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      errors.push(`${valuePath} must contain at least ${schema.minItems} item(s)`);
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${valuePath} must contain at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateValueAgainstSchema(item, schema.items, `${valuePath}[${index}]`));
      });
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${valuePath} must be a string`);
      return errors;
    }
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      errors.push(`${valuePath} is shorter than ${schema.minLength} characters`);
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      errors.push(`${valuePath} is longer than ${schema.maxLength} characters`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
      errors.push(`${valuePath} does not match the required pattern`);
    }
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${valuePath} must be a finite number`);
      return errors;
    }
    if (schema.type === 'integer' && !Number.isInteger(value)) {
      errors.push(`${valuePath} must be an integer`);
    }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${valuePath} must be at least ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${valuePath} must be at most ${schema.maximum}`);
    }
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${valuePath} must be a boolean`);
  }

  return errors;
}

module.exports = {
  readJsonFile,
  isPathInside,
  resolveInside,
  validateValueAgainstSchema,
  validateDescriptorDocument,
  validateManifest,
  validateRegistry,
};
