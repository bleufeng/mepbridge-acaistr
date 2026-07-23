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

## Maintainer Synchronization

The public repository must remain reproducible from the reviewed public
allowlist export.

- Accepted pull-request changes are synchronized into the maintained source
  workspace before a release or later public export.
- The next allowlist export must reproduce the accepted public files. A
  public-only hotfix must not be left outside the maintained source.
- `node_modules`, generated UI `dist`, APX/ZIP files, project models, logs, and
  local user data must remain untracked.
- Public Git commits and `CHANGELOG.md` are the public update record.
- A public source or documentation update does not by itself replace an
  existing installation ZIP. Release assets change only when the packaged
  user payload changes and completes package verification.

## Version and Update Record

`VERSION` is the public product-version source of truth. The source directory
name `ai-adapter/ui/v0.1.0` is a compatibility path and is not the version
authority.

Every public pull request must:

- add a concise entry under `CHANGELOG.md` `[Unreleased]`
- classify version impact as `none`, `patch`, `minor`, or `major`
- keep `VERSION`, Server/UI package metadata, and English/Chinese public
  documents synchronized when the product version changes
- state whether GitHub Release assets remain unchanged or require replacement

Use Semantic Versioning:

- `patch`: backward-compatible fixes or small user-visible improvements
- `minor`: backward-compatible features or meaningful capability expansion
- `major`: incompatible public behavior or contract changes
- `none`: documentation, CI, repository, or collaboration changes that do not
  change the released product version

Run:

```powershell
node tools\validate-public-version.js
```

CI also compares the change with its base commit. If `VERSION` changes, the
version must increase and all required public version files must change in the
same pull request.

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
