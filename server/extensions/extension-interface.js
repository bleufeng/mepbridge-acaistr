/**
 * Reviewed C2 Workbench module interface.
 *
 * Modules are loaded only through modules/registry.json. The runtime passes a
 * capability-limited context; modules must not load user-directory code.
 */
class ExtensionPlugin {
  constructor({ manifest, commands } = {}) {
    this.manifest = manifest || null;
    this.commands = commands || [];
  }

  async getCommands() {
    return this.commands;
  }

  async execute() {
    throw new Error('execute() must be implemented');
  }

  async isAvailable() {
    return true;
  }

  getInfo() {
    return {
      id: this.manifest?.id || '',
      version: this.manifest?.version || '',
      displayName: this.manifest?.displayName || {},
      riskLevel: this.manifest?.riskLevel || 'read-only',
    };
  }
}

module.exports = { ExtensionPlugin };
