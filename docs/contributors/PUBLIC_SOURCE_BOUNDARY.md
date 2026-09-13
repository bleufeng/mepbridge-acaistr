# Public C2 Source Boundary

## Included

The public repository contains only the files needed to understand, develop,
review, and test the C2 Workbench layer:

- React Workbench source
- Node.js Server source
- MCP Server
- 88 Add-On-backed tool descriptors matching the `v0.1.5` released APX boundary
- 4 server-side tools that run in the Node.js Server and never require an APX rebuild
- reviewed module registry, schema, modules, and module tests
- the narrowly scoped public command-safety regression test at `tests/test-command-capabilities.js`
- public examples and user documentation
- GitHub issue, pull-request, CODEOWNERS, security, and CI files
- MIT license, notice, changelog, and bilingual README files

## Excluded

The public repository does not contain:

- native C++ Add-On source or Archicad resource files
- Graphisoft DevKits, MDID material, or proprietary SDK examples
- internal command contracts, audits, handoff history, or release scripts
- all other top-level internal tests, test models, PLN files, or runtime evidence
- APX files, build output, release staging, ZIP files, or source maps
- user data, templates created by users, logs, API keys, or local LLM settings

The public repository is not a reproducible APX build source.

## Capability Boundary

The public repository declares the same command boundary as the reviewed
`v0.1.5` release binaries:

- 89 registered C++ commands
- 88 Add-On descriptors
- 4 server tools
- 92 descriptor entries in total

Development commands that exist in the engineering source but are not part of
the reviewed binary release are filtered out during the public export. The
`CreateComplexElement` command is therefore intentionally absent from this
repository until its native implementation is compiled and live-validated in a
later release.

## Contribution Boundary

Contributors may implement new Workbench modules using existing descriptor
commands. Maintainers review registry changes and runtime code through
CODEOWNERS and CI.

Contributors cannot add a real native Archicad capability solely in the public
repository. Such a request must first pass maintainer review and native
implementation validation, then be exposed through a reviewed descriptor.

## Installation Boundary

End users install MEPbridge ACAIstr from the official release ZIP. Cloning the
public repository is optional and intended for Workbench development or review.
