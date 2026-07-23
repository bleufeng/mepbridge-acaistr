## Summary

Describe the user-visible Workbench or module change.

## Change Type

- [ ] Reviewed module
- [ ] React Workbench
- [ ] Node Server
- [ ] MCP or descriptor correction
- [ ] Documentation or example

## Version and Update Record

- [ ] `CHANGELOG.md` contains a concise entry under `[Unreleased]`.
- [ ] Version impact is selected: `none` / `patch` / `minor` / `major`.
- [ ] If `VERSION` changed, the new version is greater and all English/Chinese
      public version documents and Server/UI package metadata were updated.
- [ ] GitHub Release assets are classified: unchanged / replace after package
      verification / not applicable.

## Safety Boundary

- [ ] No arbitrary user-directory code loading
- [ ] No filesystem, process, child-process, raw network, or VM access
- [ ] Module commands are namespaced
- [ ] Archicad calls are declared in the module manifest
- [ ] No unavailable native C++ command was added

## Verification

- Module validator:
- Module tests:
- Server checks:
- Version/update record check:
- UI lint/build:
- Package checks:
- Archicad runtime checks:

## Screenshots

Required for visible UI changes.
