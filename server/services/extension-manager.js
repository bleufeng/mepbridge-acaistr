const fs = require('fs');
const path = require('path');
const archicadClient = require('./archicad-client');
const {
  readJsonFile,
  resolveInside,
  validateDescriptorDocument,
  validateManifest,
  validateRegistry,
  validateValueAgainstSchema,
} = require('./module-validation');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_PARAMETER_BYTES = 128 * 1024;

class ExtensionManager {
  constructor(options = {}) {
    this.modulesRoot = path.resolve(options.modulesRoot || path.join(__dirname, '../../modules'));
    this.registryPath = path.join(this.modulesRoot, 'registry.json');
    this.descriptorRegistryPath = path.resolve(
      options.descriptorRegistryPath || path.join(__dirname, '../../ai-adapter/tool-descriptors.json')
    );
    this.archicadClient = options.archicadClient || archicadClient;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxParameterBytes = options.maxParameterBytes || DEFAULT_MAX_PARAMETER_BYTES;
    this.startTimers = options.startTimers !== false;

    this.extensions = new Map();
    this.commandRegistry = new Map();
    this.statusCache = new Map();
    this.subscribers = new Set();
    this.registry = { schemaVersion: 'mepbridge-module-registry-1', modules: [] };
    this.archicadCommandCatalog = new Map();
    this.initialized = false;
    this.ready = Promise.resolve();
  }

  async initialize() {
    this.extensions.clear();
    this.commandRegistry.clear();
    this.statusCache.clear();
    this.loadArchicadCommandCatalog();

    if (!fs.existsSync(this.registryPath)) {
      console.log(`[ExtensionManager] Module registry not found: ${this.registryPath}`);
      this.initialized = true;
      return;
    }

    this.registry = readJsonFile(this.registryPath);
    this.assertValid(validateRegistry(this.registry), 'module registry');

    for (const entry of this.registry.modules) {
      if (!entry.enabled) {
        this.statusCache.set(entry.id, this.makeStatus(entry.id, 'disabled'));
        continue;
      }
      await this.loadExtension(entry);
    }

    this.initialized = true;
    this.notifyStatusChange();
    if (this.startTimers) this.startBackgroundRefresh();

    console.log(
      `[ExtensionManager] Loaded ${this.extensions.size} reviewed module(s), ` +
      `registered ${this.commandRegistry.size} module command(s)`
    );
  }

  loadArchicadCommandCatalog() {
    const registry = readJsonFile(this.descriptorRegistryPath);
    const descriptors = Array.isArray(registry.descriptors) ? registry.descriptors : [];

    for (const descriptor of descriptors) {
      if (!descriptor.commandName) continue;
      const namespace = descriptor.commandNamespace || 'MEPBridge';
      this.archicadCommandCatalog.set(descriptor.commandName, descriptor);
      this.archicadCommandCatalog.set(`${namespace}.${descriptor.commandName}`, descriptor);
    }
  }

  async loadExtension(entry) {
    const moduleRoot = resolveInside(this.modulesRoot, entry.path, `module path for ${entry.id}`);
    const manifestPath = path.join(moduleRoot, 'manifest.json');
    const manifest = readJsonFile(manifestPath);
    this.assertValid(validateManifest(manifest, entry.id), `manifest for ${entry.id}`);

    const entryPath = resolveInside(moduleRoot, manifest.entry, `entry for ${entry.id}`);
    const descriptorsPath = resolveInside(moduleRoot, manifest.descriptors, `descriptors for ${entry.id}`);
    const descriptorDocument = readJsonFile(descriptorsPath);
    this.assertValid(
      validateDescriptorDocument(descriptorDocument, entry.id),
      `descriptors for ${entry.id}`
    );

    this.validateArchicadPermissions(manifest);
    this.removeModuleCommands(entry.id);

    delete require.cache[require.resolve(entryPath)];
    const exportedModule = require(entryPath);
    const createModule = typeof exportedModule === 'function'
      ? exportedModule
      : exportedModule?.createModule;

    if (typeof createModule !== 'function') {
      throw new Error(`Module ${entry.id} must export a create function`);
    }

    const context = this.createExecutionContext(manifest);
    const instance = await createModule(context, manifest, descriptorDocument.commands);
    this.assertModuleInterface(instance, entry.id);

    const available = await this.withTimeout(
      Promise.resolve(instance.isAvailable()),
      Math.min(this.timeoutMs, 5000),
      `availability check timed out for ${entry.id}`
    );

    const status = available ? 'online' : 'offline';
    const extensionData = {
      id: entry.id,
      entry,
      manifest,
      instance,
      commands: descriptorDocument.commands,
      status,
      lastCheck: Date.now(),
    };
    this.extensions.set(entry.id, extensionData);
    this.statusCache.set(entry.id, this.makeStatus(entry.id, status, extensionData));

    if (available) this.registerCommands(extensionData);
    return extensionData;
  }

  validateArchicadPermissions(manifest) {
    const archicad = manifest.permissions.archicad;
    for (const commandName of archicad.commands) {
      const descriptor = this.archicadCommandCatalog.get(commandName);
      if (!descriptor) {
        throw new Error(`Module ${manifest.id} references unknown descriptor command ${commandName}`);
      }

      if (archicad.access === 'read' && descriptor.riskLevel !== 'read') {
        throw new Error(`Read-only module ${manifest.id} cannot call ${commandName}`);
      }
    }
  }

  createExecutionContext(manifest) {
    const allowedCommands = new Set(manifest.permissions.archicad.commands);
    const access = manifest.permissions.archicad.access;

    return Object.freeze({
      executeArchicad: async (commandName, parameters = {}) => {
        if (!allowedCommands.has(commandName)) {
          return {
            success: false,
            error: `Archicad command is not declared by module ${manifest.id}`,
            errorType: 'MODULE_COMMAND_NOT_ALLOWED',
          };
        }

        const descriptor = this.archicadCommandCatalog.get(commandName);
        if (!descriptor) {
          return {
            success: false,
            error: 'Archicad command descriptor is unavailable',
            errorType: 'MODULE_DESCRIPTOR_NOT_FOUND',
          };
        }
        if (access === 'none' || (access === 'read' && descriptor.riskLevel !== 'read')) {
          return {
            success: false,
            error: `Module ${manifest.id} does not have permission for this Archicad command`,
            errorType: 'MODULE_PERMISSION_DENIED',
          };
        }

        return this.archicadClient.executeCommand(commandName, parameters);
      },
    });
  }

  registerCommands(extensionData) {
    for (const command of extensionData.commands) {
      if (this.commandRegistry.has(command.name)) {
        throw new Error(`Duplicate module command: ${command.name}`);
      }
      this.commandRegistry.set(command.name, {
        extension: extensionData.id,
        definition: command,
      });
    }
  }

  removeModuleCommands(moduleId) {
    for (const [commandName, commandInfo] of this.commandRegistry) {
      if (commandInfo.extension === moduleId) this.commandRegistry.delete(commandName);
    }
  }

  assertModuleInterface(instance, moduleId) {
    for (const method of ['getCommands', 'execute', 'isAvailable']) {
      if (typeof instance?.[method] !== 'function') {
        throw new Error(`Module ${moduleId} must implement ${method}()`);
      }
    }
  }

  assertValid(errors, label) {
    if (errors.length > 0) {
      throw new Error(`Invalid ${label}: ${errors.join('; ')}`);
    }
  }

  makeStatus(moduleId, status, extensionData = null, error = null) {
    return {
      id: moduleId,
      available: status === 'online',
      status,
      version: extensionData?.manifest?.version || null,
      displayName: extensionData?.manifest?.displayName || null,
      description: extensionData?.manifest?.description || null,
      riskLevel: extensionData?.manifest?.riskLevel || null,
      features: extensionData?.commands || [],
      lastCheck: Date.now(),
      ...(error ? { error: this.sanitizeError(error) } : {}),
    };
  }

  getExtensionStatus() {
    const status = {};
    for (const [id, value] of this.statusCache) status[id] = { ...value };

    status.mepbridge = {
      available: true,
      status: 'online',
      version: '0.1.0',
      features: [],
      lastCheck: Date.now(),
    };
    return status;
  }

  getCatalog() {
    return Array.from(this.extensions.values()).map((extensionData) => ({
      id: extensionData.id,
      version: extensionData.manifest.version,
      apiVersion: extensionData.manifest.apiVersion,
      displayName: extensionData.manifest.displayName,
      description: extensionData.manifest.description,
      riskLevel: extensionData.manifest.riskLevel,
      status: extensionData.status,
      available: extensionData.status === 'online',
      permissions: extensionData.manifest.permissions,
      commands: extensionData.commands,
    }));
  }

  getAllCommands() {
    return Array.from(this.commandRegistry.entries()).map(([name, info]) => ({
      ...info.definition,
      name,
      extension: info.extension,
    }));
  }

  getExtensionInfo(name) {
    const id = this.resolveExtensionId(name);
    if (!id) return null;
    const extensionData = this.extensions.get(id);
    if (!extensionData) return this.statusCache.get(id) || null;

    return {
      id,
      name: id,
      status: extensionData.status,
      version: extensionData.manifest.version,
      available: extensionData.status === 'online',
      displayName: extensionData.manifest.displayName,
      description: extensionData.manifest.description,
      riskLevel: extensionData.manifest.riskLevel,
      features: extensionData.commands,
      lastCheck: extensionData.lastCheck,
      config: { enabled: extensionData.entry.enabled, trusted: extensionData.entry.trusted },
    };
  }

  resolveExtensionId(name) {
    const requested = String(name || '').toLowerCase();
    for (const id of this.statusCache.keys()) {
      if (id.toLowerCase() === requested) return id;
    }
    return null;
  }

  async executeCommand(commandName, parameters = {}, expectedExtension = null) {
    const commandInfo = this.commandRegistry.get(commandName);
    if (!commandInfo) {
      return {
        success: false,
        error: `Module command not found: ${commandName}`,
        errorType: 'MODULE_COMMAND_NOT_FOUND',
      };
    }
    if (expectedExtension && commandInfo.extension !== expectedExtension) {
      return {
        success: false,
        error: `Command ${commandName} does not belong to module ${expectedExtension}`,
        errorType: 'MODULE_COMMAND_MISMATCH',
      };
    }

    const extensionData = this.extensions.get(commandInfo.extension);
    if (!extensionData || extensionData.status !== 'online') {
      return {
        success: false,
        error: `Module is offline: ${commandInfo.extension}`,
        errorType: 'MODULE_OFFLINE',
      };
    }

    let payloadBytes;
    try {
      payloadBytes = Buffer.byteLength(JSON.stringify(parameters || {}), 'utf8');
    } catch (_) {
      return {
        success: false,
        error: 'Module parameters must be JSON serializable',
        errorType: 'MODULE_PARAMETERS_INVALID',
      };
    }
    if (payloadBytes > this.maxParameterBytes) {
      return {
        success: false,
        error: `Module parameters exceed ${this.maxParameterBytes} bytes`,
        errorType: 'MODULE_PARAMETERS_TOO_LARGE',
      };
    }

    const parameterErrors = validateValueAgainstSchema(
      parameters || {},
      commandInfo.definition.inputSchema
    );
    if (parameterErrors.length > 0) {
      return {
        success: false,
        error: parameterErrors.join('; '),
        errorType: 'MODULE_PARAMETER_VALIDATION_ERROR',
      };
    }

    if (
      commandInfo.definition.riskLevel !== 'read-only' &&
      parameters?.dryRun !== true &&
      parameters?.confirmRequired !== true
    ) {
      return {
        success: false,
        error: 'Mutation module commands require dryRun=true or confirmRequired=true',
        errorType: 'MODULE_CONFIRMATION_REQUIRED',
      };
    }

    try {
      const result = await this.withTimeout(
        Promise.resolve(extensionData.instance.execute(commandName, parameters || {})),
        this.timeoutMs,
        `Module command timed out: ${commandName}`
      );

      if (!result || typeof result !== 'object' || typeof result.success !== 'boolean') {
        return {
          success: false,
          error: 'Module returned an invalid result',
          errorType: 'MODULE_RESULT_INVALID',
        };
      }
      return result;
    } catch (error) {
      console.error(`[ExtensionManager] ${commandName} failed:`, error.message);
      return {
        success: false,
        error: this.sanitizeError(error),
        errorType: error.code || 'MODULE_EXECUTION_FAILED',
      };
    }
  }

  async reloadExtension(name) {
    const id = this.resolveExtensionId(name) || String(name || '');
    const entry = this.registry.modules.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Module registry entry not found: ${name}`);

    const extensionData = await this.loadExtension(entry);
    this.notifyStatusChange();
    return extensionData;
  }

  clearCache(name) {
    if (!name) return;
    const id = this.resolveExtensionId(name);
    if (!id) return;
    const extensionData = this.extensions.get(id);
    if (typeof extensionData?.instance?.clearCache === 'function') {
      extensionData.instance.clearCache();
    }
  }

  getMemoryUsage() {
    return {
      extensions: this.extensions.size,
      commands: this.commandRegistry.size,
      cachedStatus: this.statusCache.size,
      subscribers: this.subscribers.size,
    };
  }

  getStats() {
    const values = Array.from(this.extensions.values());
    return {
      total: values.length,
      online: values.filter((entry) => entry.status === 'online').length,
      offline: values.filter((entry) => entry.status === 'offline').length,
      commands: this.commandRegistry.size,
      subscribers: this.subscribers.size,
    };
  }

  onStatusChange(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notifyStatusChange() {
    const status = this.getExtensionStatus();
    for (const subscriber of this.subscribers) {
      try {
        subscriber(status);
      } catch (error) {
        console.error('[ExtensionManager] Subscriber failed:', error.message);
      }
    }
  }

  startBackgroundRefresh() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.refreshInterval = setInterval(async () => {
      for (const extensionData of this.extensions.values()) {
        try {
          const available = await this.withTimeout(
            Promise.resolve(extensionData.instance.isAvailable()),
            Math.min(this.timeoutMs, 5000),
            `availability check timed out for ${extensionData.id}`
          );
          const nextStatus = available ? 'online' : 'offline';
          if (nextStatus !== extensionData.status) {
            extensionData.status = nextStatus;
            extensionData.lastCheck = Date.now();
            this.removeModuleCommands(extensionData.id);
            if (available) this.registerCommands(extensionData);
            this.statusCache.set(
              extensionData.id,
              this.makeStatus(extensionData.id, nextStatus, extensionData)
            );
            this.notifyStatusChange();
          }
        } catch (error) {
          extensionData.status = 'offline';
          this.removeModuleCommands(extensionData.id);
          this.statusCache.set(
            extensionData.id,
            this.makeStatus(extensionData.id, 'offline', extensionData, error)
          );
        }
      }
    }, 30000);
    this.refreshInterval.unref?.();
  }

  shutdown() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.refreshInterval = null;
  }

  withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(message);
        error.code = 'MODULE_TIMEOUT';
        reject(error);
      }, timeoutMs);
      timer.unref?.();

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  sanitizeError(error) {
    const message = String(error?.message || error || 'Module operation failed');
    return message
      .replace(/[A-Za-z]:\\[^\r\n]+/g, '[local path]')
      .replace(/\/(?:home|Users|private|tmp)\/[^\r\n]+/g, '[local path]')
      .slice(0, 500);
  }
}

const extensionManager = new ExtensionManager();
extensionManager.ready = extensionManager.initialize();
extensionManager.ready.catch((error) => {
  console.error('[ExtensionManager] Initialization failed:', error.message);
});

module.exports = extensionManager;
module.exports.ExtensionManager = ExtensionManager;
