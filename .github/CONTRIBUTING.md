# Contributing to MEPbridge ACAIstr Workbench

## Public Boundary

This repository accepts contributions to:

- React Workbench UI
- Node.js Server
- MCP Server integration
- Descriptor corrections that do not add an unavailable native command
- Reviewed modules under `modules/`
- Public documentation and examples

Native C++ Add-On source, Graphisoft DevKits, APX build engineering, internal
test models, and release signing are outside this public collaboration scope.

## Module Contributions

New Workbench features should normally be submitted as a namespaced module:

```text
modules/<module-id>/
  manifest.json
  descriptors.json
  server/index.js
  README.md
  tests/
```

Modules are loaded only when listed in `modules/registry.json` with
`trusted: true`. Registry changes and module runtime changes require maintainer
review through CODEOWNERS.

Public modules must not:

- execute code from a user directory or arbitrary absolute path
- import filesystem, process, child-process, raw network, or VM APIs
- bypass `/api/execute` or the reviewed module execution context
- add a new native Archicad command that is absent from the 59 core descriptors
- render arbitrary contributed React/TSX inside the Workbench

See `docs/contributors/MODULE_DEVELOPMENT.md`.

## Checks

```powershell
node tools\validate-modules.js
node modules\project-insights\tests\module.test.js
node server\tests\extension-manager.test.js

cd ai-adapter\ui\v0.1.0
npm ci
npm run lint
npm run build
```

Also run `node --check` for changed JavaScript files and `git diff --check`.

## Pull Requests

- Keep one user-visible change per pull request.
- Explain the public module or Workbench behavior.
- List source, Server, UI, package, and Archicad runtime verification separately.
- Include screenshots for UI changes.
- State any validation that was not completed.
- Do not submit PLN files, API keys, user data, unredacted logs, APX files, or DevKits.

If a proposal needs a new native Archicad command, open a feature request first.
The maintainer will decide whether to implement and validate the native
capability before exposing it through a reviewed descriptor.
