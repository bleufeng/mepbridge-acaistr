# Public C2 Source Boundary

## Included

The public repository contains only the files needed to understand, develop,
review, and test the C2 Workbench layer:

- React Workbench source
- Node.js Server source
- MCP Server
- 59 core tool descriptors
- reviewed module registry, schema, modules, and module tests
- public examples and user documentation
- GitHub issue, pull-request, CODEOWNERS, security, and CI files
- MIT license, notice, changelog, and bilingual README files

## Excluded

The public repository does not contain:

- native C++ Add-On source or Archicad resource files
- Graphisoft DevKits, MDID material, or proprietary SDK examples
- internal command contracts, audits, handoff history, or release scripts
- internal tests, test models, PLN files, or runtime evidence
- APX files, build output, release staging, ZIP files, or source maps
- user data, templates created by users, logs, API keys, or local LLM settings

The public repository is not a reproducible APX build source.

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
