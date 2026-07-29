# Changelog

Public user-facing changes. Versions follow Semantic Versioning.

## [Unreleased]

### Added

- None in this cycle.

### Changed

- None in this cycle.

### Fixed

- None in this cycle.

### Known Boundaries

- None in this cycle.

## [0.1.1] - 2026-07-28

### Added

- 13 new C++ commands: GetFavorites, GetFavorite, CreateFromFavorite, ApplyFavorite, SaveFavorite, GetProfiles, GetViewMap, GetSectionMarkers, GetClassifications, GetLayers, FindElementsByProperty, AssignClassification, SetLayerBatch.
- CreateWall, CreateColumn, and CreateBeam now support an optional `profileGuid` parameter for cross-section profile selection.
- Semantic-index main chain integrated into the Workbench Server for natural-language command matching.
- Example preview section added to README with demonstration videos and result screenshots.
- Chinese changelog (`CHANGELOG.zh-CN.md`) and bilingual version-update instructions in the installation guide.

### Changed

- C++ command count increased from 61 to 74; descriptor/MCP tool count increased from 59 to 72.
- CopyElements empty-sourceGuids handling fixed across three layers: resolver now skips selection-set fallback when `dryRun=true` and `sourceGuids` is empty; C++ schema removed `minItems:1`; C++ `Execute()` returns a dry-run preview for empty GUIDs (APX rebuild required for the C++ portion).
- Starter shell template converted from CopyElements (GUID-dependent) to CreateWall x8 + CreateSlab x2 (10 steps, self-contained coordinates, cross-project, no GUID dependency).
- MCP status display now detects CodeBuddy, WorkBuddy, Codex, and Claude Code platforms via multiple config-path arrays; per-candidate custom markers supported.
- Claude Code MCP plugin install path corrected to `~/.claude.json` top-level `mcpServers` (not `~/.claude/mcp.json`).
- README wording refreshed (removed openBIM framing, tightened safety/disclaimer wording, updated author signature, added third-party disclaimer) and workflow diagram replaced with example preview.
- Starter sample slab and CableCarrier template coordinates reset to source element native positions (no X+20m offset), matching current AC28 story-0 read/recreate regression data.
- User-template task names render as plain text in lists, groups, selectors, management cards, and replay dialogs; per-template icons and hot markers removed.
- Package locale controls the initial Workbench language, starter assets, and built-in regional knowledge base; manual language switching preserved.
- Public `VERSION` source of truth and automated version gate for every public pull request and `main` update.
- Mandatory pull-request checklist covering changelog, version impact, bilingual docs, and Release asset impact.
- Each public repository update must add a concise `[Unreleased]` entry.
- Product version changes must increment Semantic Versioning and sync the changelog, bilingual public guides, and Server/UI package metadata.

### Fixed

- CopyElements empty-sourceGuids three-layer interception: resolver no longer reads the Archicad selection set when `dryRun=true` and `sourceGuids` is empty; C++ schema `minItems:1` removed; C++ `Execute()` returns a successful dry-run preview for empty GUIDs.
- MCP status display only showed CodeBuddy; WorkBuddy and Codex were open but not displayed. Fixed by adding WorkBuddy, supporting multiple config paths per platform, and removing false-positive matchers.
- Command-count drift across source, descriptors, MCP, and documentation corrected.
- Obsolete duplicate UI artifacts and source maps removed from the public release scope.
- AC28/AC29 package paths corrected.
- Conversation history and execution state preserved when switching to the conversation-only window.

### Known Boundaries

- `SwitchStory` and `ChangeStairGeometry` are registered C++ commands but not published as descriptor/MCP tools in v0.1.1.
- `CopyElementsCommand.cpp` schema and `Execute()` changes require an APX rebuild for the dry-run placeholder to work cross-project; the Create-type template workaround is used in the meantime.
- `GetViewMap` returns 0 views in the current test project (no View Map items in the project, not a bug).
- `CreateColumn`/`CreateBeam` `profileGuid` is parsed but not applied (memo multi-segment structure; future enhancement).
- The public source repository does not include the Graphisoft DevKit and does not promise a reproducible official APX build.
- Users are responsible for project backups, input review, and compliance with applicable requirements.

## [0.1.0] - 2026-07-20

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

- Public version identifiers unified as `0.1.0`.
- AC28 and AC29 use independent resource files and menu registration.
- Server defaults to `127.0.0.1`; network exposure requires an explicit `HOST` override.
- Runtime user data stored under `%APPDATA%\MEPBridge` by default.
- MCP tool count generated dynamically from descriptors.
- Public repository layout separates user documentation, package source files, and internal technical resources.

### Fixed

- None in this cycle.

### Known Boundaries

- `SwitchStory` and `ChangeStairGeometry` are registered C++ commands but not published as descriptor/MCP tools in v0.1.0.
- Some AC28/AC29 implementation details may continue to converge in later updates.
- The public source repository does not include the Graphisoft DevKit and does not promise a reproducible official APX build.
- Users are responsible for project backups, input review, and compliance with applicable requirements.

---

Copyright (c) 2026 Zuxai Z. Licensed under the MIT License.
