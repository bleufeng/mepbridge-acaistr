# Changelog

Public user-facing changes. Versions follow Semantic Versioning.

## [Unreleased]

- The v0.1.2 changes released on 2026-08-17 are recorded in the `## [0.1.2]` section below.

## [0.1.2] - 2026-08-17

### Fixed

- The installer now locates Archicad on any fixed drive instead of only `C:` and `D:`, and also searches the `ProgramFiles(x86)` and `ProgramW6432` roots.
- The installer reuses an existing MEPBridge Add-On folder when one is already present, so a repeat install no longer leaves two copies under different Add-On directories.
- The installer detects Node.js and warns when it is missing. The Add-On itself still installs and Archicad commands still work; only the Workbench Server, UI, and MCP Server require Node.js 18 or later.
- `Install-MEPBridge.cmd` no longer hides the interactive Archicad-folder prompt, so users whose Archicad is installed outside the default location can still answer it.
- ApplyFavorite, AssignClassification, CreateFromFavorite, SaveFavorite, and SetLayerBatch had their `dryRun` and `confirmRequired` parameters stripped before reaching the Add-On, so the Add-On fell back to a dry run and the write silently never happened while still reporting success. All five now pass both parameters through.
- GetViewMap always returned an empty list because it enumerated Publisher Sets instead of requesting each Navigator view map directly. It now reads the Public and My view maps by map id, and reports any map it could not open under `skippedMaps` so an empty result can be told apart from a failed query.
- CreateWall now writes the user-supplied `thickness` and `height` to the element instead of silently dropping them. The element mask was not set after `ACAPI_Element_GetDefaults`, so Archicad reused the wall-tool default thickness (0.3 m) and height (3.0 m) and ignored the request. The command now sets `API_BasicStructure` so the `thickness` field is honoured, and sets the mask for the geometry fields it changes.
- ChangeElementGeometry, ChangeStairGeometry, and ChangeOpeningGeometry passed a null element mask to `ACAPI_Element_Change`, which Archicad treats as "change nothing", so Wall/Column/Beam/Stair/Door/Window geometry edits were silently ignored. They now mask only the fields explicitly requested instead of using `SETFULL`; wall thickness edits also switch composite/profile walls to `API_BasicStructure` and write back the current building material so the scalar thickness takes effect.
- ApplyFavorite and CreateFromFavorite dry-run responses now include an explicit `applied: false` field and a `note` explaining that `confirmRequired=true` is required to actually apply. Previously a dry run reported `mode: "dry-run"` but gave no boolean flag, so callers could mistake it for a successful write.

### Changed

- Installation guides document the Node.js prerequisite, custom install paths, and a full step-by-step manual installation procedure covering administrator rights, locating the Archicad folder, choosing between Archicad 28 and 29, handling a previous build, and verifying the result.
- The registered command and descriptor counts now come from a single `ai-adapter/command-boundary.json` file that the release gate, the public repository validator, CI, and the packaging scripts all read, instead of each carrying its own copy.
- Command examples no longer contain hardcoded MEP system names or attribute indexes. Those identifiers are not stable across projects, locales, or Archicad versions, so omitting them lets the Add-On use the domain default. A static check keeps them out.
- The Archicad runtime regression now checks returned content rather than only that response fields exist, and covers the favourite, layer-batch and classification write commands end to end, each restoring what it changed.
- The internal command guide lists all 74 registered commands. It had 52, so the favourites, profile, view-map, classification and layer commands were absent along with the project and story queries. Command counts there now defer to `ai-adapter/command-boundary.json`.
- The public repository validator no longer aborts on a Markdown link containing a stray percent sign; such a link is reported as broken instead.

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
