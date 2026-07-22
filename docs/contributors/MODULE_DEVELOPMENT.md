# C2 Workbench Module Development

## Scope

C2 modules add reviewed Workbench behavior by composing commands that already
exist in `ai-adapter/tool-descriptors.json`. They do not add a C++ command and
do not change the 61 registered C++ / 59 descriptor-MCP boundary.

Use a feature request when a module needs a native Archicad capability that is
not already present. Native work must be implemented, reviewed, and accepted by
the maintainer before it becomes available to a public module.

## Module Layout

```text
modules/<module-id>/
  manifest.json
  descriptors.json
  server/index.js
  README.md
  tests/
```

`module-id` uses lowercase letters, digits, and hyphens. Every module command
must use the prefix `<module-id>.`.

## Runtime Contract

`server/index.js` exports a factory:

```js
module.exports = function createModule(context, manifest, commands) {
  return {
    async getCommands() {
      return commands;
    },
    async isAvailable() {
      return true;
    },
    async execute(commandName, parameters) {
      return { success: true, data: {} };
    },
  };
};
```

The only Archicad entry point supplied to a module is:

```js
await context.executeArchicad("MEPBridge.GetProjectInfo", {});
```

The call is rejected unless the command is both:

1. Present in the core descriptor registry.
2. Declared in `manifest.json`.

Read-only modules may call only descriptors with `riskLevel: "read"`.

## Security Rules

- Modules load only from `modules/registry.json`.
- Registry paths must equal the module ID and remain inside `modules/`.
- Public modules cannot use filesystem, process, child-process, raw network, or VM APIs.
- Public modules cannot load code from user directories or absolute paths.
- The Workbench renders module metadata and command results declaratively. A module cannot inject contributed TSX.
- Mutation modules require maintainer approval, explicit manifest review metadata, dry-run or confirmation handling, and Archicad runtime evidence.

The module loader is a reviewed-code boundary, not a sandbox for untrusted code.
Only merged, CODEOWNERS-approved modules are distributed.

## Add a Module

1. Copy the `modules/project-insights/` structure.
2. Choose a unique module ID and command names.
3. Declare only the Archicad commands the module needs.
4. Add focused module tests.
5. Add the module to `modules/registry.json`.
6. Run:

```powershell
node tools\validate-modules.js
node modules\<module-id>\tests\module.test.js
node server\tests\extension-manager.test.js
```

7. Run UI lint/build if module metadata or the module panel changes.

## Pull Request Evidence

Report separately:

- static source and validator checks
- Server API tests
- UI lint/build and screenshots
- release-package inclusion, when applicable
- Archicad runtime results, when applicable
