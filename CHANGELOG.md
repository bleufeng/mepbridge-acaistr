# Changelog

This file records public user-facing changes. Versions follow Semantic Versioning.

## 0.1.0 - 2026-07-20

### Added

- Archicad 28 and Archicad 29 Windows Add-Ons.
- 61 registered C++ commands and 59 descriptor/MCP tools.
- General building and MEP element creation, query, editing, property, selection, and project-environment operations.
- Local Node.js Workbench Server and React UI.
- Manual and CollabAI modes with confirmation policies and result readback.
- MCP stdio Server compatible with common MCP hosts.
- Local templates, custom commands, knowledge base, learning memory, proactive suggestions, and audit logs.
- Windows installation and uninstallation entry points.
- Release manifest and per-file SHA256 checksums.

### Changed

- Public version identifiers are unified as `0.1.0`.
- AC28 and AC29 use independent resource files and menu registration.
- Server defaults to `127.0.0.1`; network exposure requires an explicit `HOST` override.
- Runtime user data is stored under `%APPDATA%\MEPBridge` by default.
- MCP tool count is generated dynamically from descriptors.
- Public repository layout now separates user documentation, package source files, and internal technical resources.

### Fixed

- Corrected command-count drift across source, descriptors, MCP, and documentation.
- Removed obsolete duplicate UI artifacts and source maps from the public release scope.
- Corrected AC28/AC29 package paths.
- Preserved conversation history and execution state when switching to the conversation-only window.

### Known Boundaries

- `SwitchStory` and `ChangeStairGeometry` are registered C++ commands but are not published as descriptor/MCP tools in v0.1.0.
- Some AC28/AC29 implementation details may continue to converge in later updates.
- The public source repository does not include the Graphisoft DevKit and does not promise a reproducible official APX build.
- Users are responsible for project backups, input review, and compliance with applicable requirements.

---

Copyright (c) 2026 Zuxai Z. Licensed under the MIT License.
