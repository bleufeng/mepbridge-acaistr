# MEPbridge ACAIstr (MACAI)

> MEPbridge ACAIstr (MACAI) bridges large language models (GPT / Claude / Gemini / Deepseek, etc.) and Archicad industrial-grade 3D design software for safe two-way interaction and an AI Loop collaborative workbench. It provides `CollabAI Smart` (natural-language task planning and autonomous loops) and `Manual` (precise workflow control) entry points.

[![Archicad](https://img.shields.io/badge/Archicad-28%20%7C%2029%20%7C%2030-blue.svg)](docs/user/INSTALL.md)
[![Version](https://img.shields.io/badge/version-0.1.9-orange.svg)](https://github.com/bleufeng/mepbridge-acaistr/releases/tag/v0.1.9)
[![Tools](https://img.shields.io/badge/MCP%20Tools-95%20Total-0F766E.svg)](ai-adapter/tool-descriptors.json)
[![API Scale](https://img.shields.io/badge/Atomic%20APIs-162%20Covered-2563EB.svg)](ai-adapter/command-boundary.json)
[![Rollback Rate](https://img.shields.io/badge/Atomic%20Rollback-99.8%25%20(Zero--Dirty)-7C3AED.svg)](CHANGELOG.md)
[![Snapshot](https://img.shields.io/badge/Snapshot-0.1mm%20Precision-10B981.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-374151.svg)](LICENSE)

[中文说明](README.zh-CN.md) | [Installation](docs/user/INSTALL.md) | [Quick Start](docs/user/QUICK_START.md) | [Support](.github/SUPPORT.md)

<p align="center">
  <img src=".github/assets/mepbridge-acaistr-workflow.png" alt="MEPbridge ACAIstr workflow: natural-language commands and extensible user templates, safe orchestration, Workbench and MCP Server, Archicad execution, and result readback" width="100%">
</p>

Natural-language tasks and extensible user templates pass through safety orchestration and risk gates, connecting design instructions with AI algorithms through structured data, driving Archicad execution via the local Workbench / MCP layer, and reading back structured results to form a closed loop.

## Top Capability Panorama Dashboard

According to the project capability panorama ledger, the system establishes five core measurement dimensions for industrial-grade capabilities:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        MEPBridge ACAIstr Capability Panorama Dashboard                 │
├─────────────────────┬─────────────────────┬─────────────────────┬──────────────────────┤
│ 1. Contract Tools   │ 2. Atomic API Scale │ 3. Official Coverage│ 4. Q1–Q4 Lifecycle   │
│    95 Items         │    162 APIs (Max 189)│    46 / 73 Items    │    Full-depth Verified│
├─────────────────────┴─────────────────────┴─────────────────────┴──────────────────────┤
│ 5. Model Rollback Rate: 99.8% (147 live scenarios PASS, Zero-Dirty-Model guarantee)    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Contract Tool Boundary (95 Items)**: 91 C++ native Add-On commands (bound to DevKit C++ lineages) and 4 local Server orchestration tools;
2. **Atomic API Scale (162 APIs, max 189)**: 95 unified, cohesive contracts polymorphically cover 8 official functional domains, preventing command bloat;
3. **Official JSON API Pool (46 / 73 Items)**: 28 C++ superset extensions (enhanced performance with geometry) + 18 non-geometric whitelisted proxies;
4. **Q1–Q4 Lifecycle Depth**: Covers construction/creation (Q1), readback/inspection (Q2), in-place GUID-preserved mutation (Q3, curtain wall live-verified), and topological solving (Q4);
5. **Model Transaction Rollback Rate (99.8%)**: In-transaction 1mm geometry readback tolerance with kernel-level rollback and orphan element cleanup, achieving zero dirty model residue across 147 live tests.

## Release Scope & Evolution Milestones

- Version: `v0.1.9` (expanded from single-version support to **full coverage of Archicad 28, 29, and 30**);
- **Capability Scale Evolution**: Grew from ~20 APIs in v0.1.0 and 80+ in v0.1.6 to **162 official atomic API capabilities** today;
- **Transaction Safety Evolution**: Upgraded from raw calls without rollback to unified RAII guards and a **99.8% transaction rollback guard**;
- **Spatial Inspection Precision**: Introduced **0.1mm quantized spatial model snapshots**, A/B diff inspection, and automated revision clouding;
- **Complex Element Depth**: Completed **in-place curtain wall live verification** (GUID-preserved 1.5m equal divisions, 20mm slim frames, and custom panels);
- **Network Endpoints**: Server default `127.0.0.1:19780`; Archicad JSON API local discovery `127.0.0.1:19723-19743`;
- **Package Delivery**: Single complete bilingual package `MACAI-Workbench-v<version>-win64.zip` (includes matching AC28/29/30 APXs, Workbench, and bundled Node runtime; no separate Node.js/npm setup needed).
- **Registered release boundary**: 91 registered C++ commands, 91 Add-On descriptor tools, and 4 local Workbench Server tools (95 tools total).

Public update history: [CHANGELOG.md](CHANGELOG.md).

## Development Layers and the DevKit / C++ Boundary

- **Two Layers**: The native Add-On layer is `MEPBridge.apx`, written in C++ and built against Graphisoft Archicad API and DevKit, communicating via the Archicad JSON API. The Workbench layer is the React UI, Node.js Server, and MCP Server, written in TypeScript/JavaScript without the DevKit.
- **Public Repository Scope**: Only provides the open Workbench layer, tool descriptors, extension modules, examples, and documentation. It does **not** contain native C++ sources, Archicad resources, Graphisoft DevKit samples, APX binaries, or build outputs. The public repository is **not a reproducible APX build source**.
- **Contribution Threshold**: Extending the Workbench, Server, UI, MCP surface, or reviewed modules requires **neither the DevKit nor a C++ toolchain**. The native layer is built internally by maintainers and shipped in the release ZIP.
- **DevKit Provenance**: The DevKit is governed by Graphisoft's license. This project does not distribute it; internal native development requires obtaining the matching DevKit from Graphisoft.

## Example Preview

<table border="0" cellpadding="0" cellspacing="0">
  <tr>
    <td width="50%" align="center">
      <video src="https://github.com/user-attachments/assets/dd0671dd-3e2c-4b34-950c-6cafdf272182" controls muted width="480"></video>
    </td>
    <td width="50%" align="center">
      <video src="https://github.com/user-attachments/assets/ab30744b-9342-4bf5-9e65-189c8fd8b5db" controls muted width="480"></video>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src=".github/assets/exmpl-01door.png" alt="Door element creation result" width="480">
    </td>
    <td width="50%" align="center">
      <img src=".github/assets/exmpl-02line.png" alt="Line drawing result" width="480">
    </td>
  </tr>
</table>

## Main Capabilities

- **Building Elements & Complex Systems**: Walls, columns, beams, slabs, roofs, doors, windows, stairs, meshes, zones, morphs; in-place curtain wall mutation (GUID-preserved 1.5m divisions, slim frames, custom panel materials)
- **Transforms & Solid Operations (SEO)**: Move, rotate, mirror, multiply; SEO solid operations (subtraction, union, intersection), roof trimming, in-place thickness changes; dual-mode batch engine
- **MEP Engineering Domains**: Piping, ducting, cable carriers, transitions, take-offs; precise nominal diameter matching; spatial collision avoidance with adaptive fitting topology solving
- **Properties & Classification**: 9 attribute families, story management, 224+ property graceful fallback extraction, standard classification assignments (UniFormat)
- **Drafting Perception & Inspection**: Penetrative extraction of 6 2D drafting primitive types (lines, arcs, texts, etc.); 0.1mm spatial model snapshot diffing with automated revision clouding
- **Safety Gates & Result Readback**: `CollabAI Smart` and `Manual` dual entry points, execution strategies (Auto/Supervised/Manual), 1mm tolerance gates, atomic rollback, and structured result readback

### Operation Modes

| Mode or Asset | Primary Use | Typical Flow |
| :--- | :--- | :--- |
| **CollabAI Smart** | Natural-language tasks, template tasks, and AI Loop | Enter goal → Match NL command/template → Generate plan → Confirm risk → Execute & read back |
| **Manual** | Explicit commands, workflow control, and verification | Select command module → Enter parameters → Confirm execution → Inspect structured results |
| **User Templates** | Save and replay verified multi-step plans | Save, search, replay, manage, and delete verified plans |
| **Custom NL Commands** | Extend local natural-language triggers | Map a trigger phrase to a single command or user template |
| **Preset Management** | Manage templates and custom command assets | Import, export, back up, and reset `user-asset-1` bundles |

## Architecture

The system forms a closed AI Loop spanning "intent parsing ➔ plan orchestration ➔ model execution ➔ readback/inspection ➔ corrective iteration":

```mermaid
flowchart TB
    A["User / AI Agent<br/>GPT / Claude / Gemini / Deepseek / Cursor"] --> B{"Choose Operation Entry"}
    B --> C["CollabAI Smart<br/>Natural Language / Templates / AI Loop"]
    B --> D["Manual<br/>Structured Commands / Precise Workflow Control"]
    B --> E["MCP Client<br/>Standard MCP Client"]
    E --> F["MCP Stdio Server"]
    C --> G["Task Planning & Template Matching"]
    D --> H["Structured Parameter Payload"]
    G --> I["Safety Orchestration Gates<br/>Schema Validation / Risk Levels / Confirmation"]
    H --> I
    F --> I
    I --> J["Node.js Workbench Server<br/>127.0.0.1:19780 · /api/execute"]
    J --> K["Archicad JSON API<br/>127.0.0.1:19723-19743"]
    K --> L["MEPBridge.apx<br/>C++ Native Add-On (1mm Rollback Guard)"]
    L --> M["Archicad 28 / 29 / 30<br/>Real 3D Architectural & MEP Model"]
    M --> N["Structured Result / 0.1mm Diff Snapshot / Audit Trail"]
    N -. "Readback & Self-Healing Loop" .-> B
```

UI and MCP model operations pass through `/api/execute`. Runtime data (templates, learning memory, audit logs) is stored in `%APPDATA%\MEPBridge` by default.

## Install

1. Download the latest complete package `MACAI-Workbench-v<version>-win64.zip` from [GitHub Releases](https://github.com/bleufeng/mepbridge-acaistr/releases) (contains matching AC28/29/30 APXs, Workbench, and bundled Node runtime; no separate Node.js/npm setup required);
2. Extract to a writable folder (this folder is the Workbench runtime home — do not delete after install);
3. Exit Archicad, open the extracted folder, and run `Install-MEPBridge.cmd`;
4. Restart Archicad;
5. Open Workbench from the Archicad menu, or point your MCP client to `tools/mepbridge-mcp-server.js`.

Manual Server startup is also available from the extracted folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\Start-BaseWorkbench.ps1 -Action Serve
```

Then visit `http://127.0.0.1:19780/`. See [INSTALL.md](docs/user/INSTALL.md) for full instructions.

## Public Source & Development Extension

The public repository focuses on extending the Workbench UI, Node.js services, and MCP ecosystem.

### Source Layout Overview

```text
ai-adapter/
├── tool-descriptors.json     # 95 lightweight tool descriptor contracts
└── ui/v0.1.0/                # React Workbench source code
server/                       # Node.js Workbench Server (127.0.0.1:19780)
tools/
├── mepbridge-mcp-server.js   # MCP stdio server
└── validate-modules.js       # Module contract validator
modules/                      # Reviewed extension modules & SDK schema
docs/                         # Public user and contributor documentation
```

### Local Development Quick Commands

```powershell
# 1. UI lint and build
cd ai-adapter\ui\v0.1.0
npm ci
npm run lint
npm run build

# 2. Start local Workbench Server
node server\server.js

# 3. Validate extension modules
node tools\validate-modules.js
```

> For full module authoring guidelines, see [MODULE_DEVELOPMENT.md](docs/contributors/MODULE_DEVELOPMENT.md) and [PUBLIC_SOURCE_BOUNDARY.md](docs/contributors/PUBLIC_SOURCE_BOUNDARY.md).

## Safety and Disclaimer

Use a test or backed-up PLN for write, delete, batch, and geometry-changing commands, and review target GUIDs, units, story context, and confirmation prompts before execution.

Users are responsible for ensuring that their use of the Add-On complies with applicable requirements and for their model files, input parameters, backups, and all results produced by this project.

Installing or using this project constitutes acceptance of the associated risks and disclaimer.

## License

Licensed under the [MIT License](LICENSE). See [NOTICE](NOTICE), [SECURITY.md](.github/SECURITY.md), and [SUPPORT.md](.github/SUPPORT.md). This project is a third-party Add-On and is not affiliated with Archicad or Graphisoft.

Use, modification, and distribution are permitted under the MIT License, provided that the original copyright and license notice are retained.

**MEPbridge ACAIstr (MACAI)** — Made by Zuxai Z.(Zhong)<br>
&copy; 2026 Zuxai Z. &middot; MIT License
