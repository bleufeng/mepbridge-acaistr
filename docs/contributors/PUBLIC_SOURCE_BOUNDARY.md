# Public C2 Source Boundary

## Included

The public repository contains only the files needed to understand, develop,
review, and test the C2 Workbench layer:

- React Workbench source
- Node.js Server source
- MCP Server
- 91 Add-On-backed tool descriptors matching the exported APX boundary
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
`v0.1.8` release binaries:

- 91 registered C++ commands
- 91 Add-On descriptors
- 4 server tools
- 95 descriptor entries in total

Exposure is gated through `ai-adapter/command-boundary.json` rather than by
removing descriptors from the public registry. A command the boundary marks as
not MCP-exposed must additionally declare `status: "mcp-isolated"` in its
descriptor, so isolation is explicit and auditable. Subtype-level gating
(`allowedSubTypes`) replaces whole-command exclusion: `CreateComplexElement` is
part of the reviewed boundary and may be restricted per subtype without being
removed from the public source.

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
