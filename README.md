# MEPbridge ACAIstr (MACAI)

> MEPbridge ACAIstr (MACAI) is a native Add-On and local MCP / Workbench collaboration system centered on Archicad workflows. Its initial focus is safe, controlled two-way interaction between large language models and building 3D design software, providing natural-language interaction, structured command execution, and autonomous AI Loop capabilities for design work. The system provides `CollabAI Smart` and `Manual` as its two operation entry points; manual commands, fixed templates, and configured custom NL commands remain available without an LLM.
>
> The exploration path uses two-way MCP data exchange to progressively form an AI Loop of task planning, model execution, model-feedback readback, and corrective iteration. Design instructions connect with AI algorithms through data, driving Archicad execution via the local Workbench / MCP layer and reading back structured results to close the loop. The initial version focuses on reliable model read/write access, risk confirmation, and result readback. Drawing interpretation, compliance checking, and multidisciplinary end-to-end design automation are expected to continue expanding.

[![Archicad](https://img.shields.io/badge/Archicad-28%20%7C%2029%20%7C%2030-blue.svg)]()
[![Version](https://img.shields.io/badge/version-0.1.9-orange.svg)]()
[![OPENBIM](https://img.shields.io/badge/OPENBIM-Workflow-0F766E.svg)]()
[![Archicad JSON API](https://img.shields.io/badge/ARCHICAD-JSON%20API-2563EB.svg)]()
[![C++ Add-On](https://img.shields.io/badge/C%2B%2B-Add--On-00599C.svg)]()
[![Node.js](https://img.shields.io/badge/Node.js-Server-339933.svg)]()
[![React](https://img.shields.io/badge/React-Workbench-149ECA.svg)]()
[![AI Loop](https://img.shields.io/badge/AI-Loop-7C3AED.svg)]()
[![MCP Server](https://img.shields.io/badge/MCP-Server-D97706.svg)]()
[![Local First](https://img.shields.io/badge/Local-First-374151.svg)]()

[中文说明](README.zh-CN.md) | [Installation](docs/user/INSTALL.md) | [Quick Start](docs/user/QUICK_START.md) | [Support](.github/SUPPORT.md)

<p align="center">
  <img src=".github/assets/mepbridge-acaistr-workflow.png" alt="MEPbridge ACAIstr workflow: natural-language commands and extensible user templates, safe orchestration, Workbench and MCP Server, Archicad execution, and result readback" width="100%">
</p>

Natural-language tasks and extensible user templates pass through planning and risk controls, connecting design instructions with AI algorithms through data, driving Archicad execution via the local Workbench / MCP layer, and reading back structured results to form a closed loop.

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

## Release Scope

- Version: `v0.1.9`
- 91 registered C++ commands
- 91 Add-On descriptor/MCP tools
- 4 local Workbench Server tools
- Direct-only C++ commands: None
- Archicad 28, 29, and 30 Windows builds
- Server default: `127.0.0.1:19780`
- Archicad JSON API discovery: local `127.0.0.1:19723-19743`

Public update history: [CHANGELOG.md](CHANGELOG.md).

First installations and cross-component upgrades for v0.1.9 use the single bilingual package:

- `MACAI-Workbench-v0.1.9-win64.zip`

It contains AC28/AC29/AC30 APXs, Workbench, bilingual UI, MCP Server, dependencies, and a bundled Node runtime; users do not install Node.js/npm separately. The three APX ZIPs are only for Release-approved updates to an existing complete installation. Generated source archives are not installers.

The public repository provides the C2 Workbench collaboration surface: React Workbench, Node.js Server, MCP Server, core descriptors, reviewed module SDK and schema, examples, and public documentation. Contributors can build reviewed modules, compose existing Archicad commands into new workflows, extend UI panels and Server services, improve MCP integrations, and contribute examples or documentation.

The repository focuses on Workbench development and extension rather than independent APX builds. End users should install the signed-off release ZIP instead of cloning source.

## Development Layers and the DevKit / C++ Boundary

- **Two layers**: the native Add-On layer is `MEPBridge.apx`, written in C++ and built against the Archicad API and the Archicad API Development Kit (DevKit) published by Graphisoft, communicating with the host through the Archicad JSON API. The Workbench layer is the React UI, Node.js Server, and MCP Server, written in TypeScript/JavaScript and built without the DevKit.
- **Public repository scope**: only the collaboratively open Workbench layer plus its command descriptors, modules, examples, and documentation. It does **not** contain native C++ sources, Archicad resource files, Graphisoft DevKit/SDK samples, APX binaries, or build output. The public repository is therefore **not a reproducible APX build source**.
- **Contribution threshold**: extending the Workbench, Server, UI, MCP surface, or reviewed modules requires **neither the DevKit nor a C++ toolchain**. The native layer is built by the maintainers in an internal environment with the matching DevKit and MSVC, produced separately for Archicad 28/29/30, and shipped in the release ZIP.
- **DevKit provenance**: the DevKit is a Graphisoft release governed by its own license. This project does not download or redistribute it; internal native-layer work requires obtaining the matching DevKit from Graphisoft and complying with its license.

## Main Capabilities

- General building elements: walls, columns, beams, slabs, roofs, doors, windows, stairs, objects, lamps, meshes, zones, and grids
- MEP domains: pipe, duct, cable carrier, flexible segment, take-off, systems, sizes, and route operations
- Model editing: move, rotate, mirror, copy, multiply, geometry changes, batch creation, selection, and deletion
- Project queries: project information, stories, libraries, hotlinks, properties, geometry, attributes, documentation elements, mesh, and viewport capture
- `CollabAI Smart` and `Manual` operation modes with risk classification, confirmation gates, and result readback
- MCP tools generated dynamically from `ai-adapter/tool-descriptors.json`
- Local user templates, custom commands, knowledge base, learning memory, and audit logs
- Reviewed Workbench modules loaded from `modules/registry.json`
- AC28/AC29 support with preview, confirmation, result readback, and failure handling according to operation risk

### Operation Modes

| Mode or asset | Primary use | Typical flow |
| --- | --- | --- |
| **CollabAI Smart** | Natural-language tasks, template tasks, and AI Loop | Enter a goal -> match an NL command or template -> generate a plan -> confirm risk -> execute and read back |
| **Manual** | Explicit commands, parameter control, and verification | Select a command module -> enter parameters -> confirm execution -> inspect structured results |
| **User templates** | Save and replay multi-step plans | Save, search, replay, manage, and delete verified plans |
| **Custom NL commands** | Extend local natural-language triggers | Map a trigger phrase to a single command or user template |
| **Preset management** | Manage templates and custom-command assets | Import, export, back up, and reset the `user-asset-1` bundle |

`CollabAI Smart` provides `Auto`, `Supervised`, and `Manual` execution strategies. Auto can run reads, low-risk mutations, and single-element creation directly, while higher-risk and batch operations require confirmation. Supervised always previews the plan and confirms mutation operations. Manual automatically runs only read steps and confirms the remaining steps individually. Without an LLM, `Manual`, fixed templates, and configured custom NL commands remain available; model-dependent interpretation and automatic plan generation are unavailable.

## Architecture

The vertical flow below represents one complete operation. Workbench and MCP share the Node.js Server, guarded execution entry point, and Archicad command chain before results return to the UI or MCP client.

```mermaid
flowchart TB
    A["User / AI Agent<br/>Enter a goal or explicit command"] --> B{"Choose an operation entry"}
    B --> C["CollabAI Smart<br/>Natural language / Templates / AI Loop"]
    B --> D["Manual<br/>Command selection / Parameters"]
    B --> E["MCP client"]
    E --> F["MCP stdio Server"]
    C --> G["Plan generation or template matching"]
    D --> H["Structured command and parameters"]
    G --> I["Guarded orchestration<br/>Schema validation / Risk classification / Confirmation"]
    H --> I
    F --> I
    I --> J["Node.js Workbench Server<br/>127.0.0.1:19780 / api/execute"]
    J --> K["Archicad JSON API<br/>127.0.0.1:19723-19743"]
    K --> L["MEPBridge.apx<br/>MEPBridge.* commands"]
    L --> M["Archicad 28/29<br/>Real 3D model"]
    M --> N["Structured result / Status / Audit record"]
    N -. "Return to Workbench or MCP" .-> B
```

UI and MCP model operations pass through `/api/execute`. Runtime data such as user templates, learning memory, and audit logs is stored under `%APPDATA%\MEPBridge` by default and can be overridden with `MEPBRIDGE_DATA_DIR`.

## Install

1. Download `MACAI-Workbench-v0.1.9-win64.zip` from the GitHub Release; do not use an APX update ZIP or generated source archive as the full installer. The package contains `RELEASE_MANIFEST.json` and `SHA256SUMS.txt` for payload verification.
2. Extract it to a normal writable directory (Windows creates a folder named after the ZIP — this is expected).
3. Close Archicad, open the extracted folder and run `Install-MEPBridge.cmd` inside it (this folder is the Workbench runtime home — do not delete it after installation).
4. Restart Archicad.
5. Use the MEPbridge ACAIstr menu to open the Workbench.

Manual Server startup is also available from a Command Prompt or PowerShell window opened in the extracted package root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\Start-BaseWorkbench.ps1 -Action Serve
```

Then open `http://127.0.0.1:19780/`.

See [INSTALL.md](docs/user/INSTALL.md) for complete installation and MCP instructions.

**v0.1.9 limitation:** Height edits of existing curtain walls are unsupported and rejected before writing. Creation height and verified grid edits remain available; see [installation limitations](docs/user/INSTALL.md#v019-capability-limitation).

## Public Source Layout

```text
ai-adapter/tool-descriptors.json
ai-adapter/ui/v0.1.0/          React UI source
server/                        Node.js Workbench Server
tools/mepbridge-mcp-server.js  MCP stdio server
tools/validate-modules.js      Reviewed module validator
modules/                       C2 module registry, SDK schema, and modules
docs/user/                     Public user documentation
docs/contributors/             Public contribution boundary
```

The open-source extension surface supports Workbench modules, UI workflows, Server routes and services, MCP integrations, descriptor-based orchestration, validation, examples, and documentation.

When a feature needs a new native Archicad command, submit a feature request describing the intended behavior, parameter contract, safety requirements, and expected AC28/AC29 results. A future release can expose the accepted capability through a reviewed descriptor.

## Workbench Development

Public Workbench requirements:

- Node.js 18+
- A release installation of MEPbridge ACAIstr for live Archicad testing

UI checks:

```powershell
cd ai-adapter\ui\v0.1.0
npm ci
npm run lint
npm run build
```

Server:

```powershell
node server\server.js
```

The Server binds to `127.0.0.1` unless `HOST` is explicitly set.

Module checks:

```powershell
node tools\validate-modules.js
node modules\project-insights\tests\module.test.js
node server\tests\extension-manager.test.js
```

See [MODULE_DEVELOPMENT.md](docs/contributors/MODULE_DEVELOPMENT.md) and [PUBLIC_SOURCE_BOUNDARY.md](docs/contributors/PUBLIC_SOURCE_BOUNDARY.md).

## Safety and Disclaimer

Use a test or backed-up PLN for write, delete, batch, and geometry-changing commands, and review target GUIDs, units, story context, and confirmation prompts before execution.

Users are responsible for ensuring that their use of the Add-On complies with applicable requirements and for their model files, input parameters, backups, and all results produced by this project.

Installing or using this project constitutes acceptance of the associated risks and disclaimer.

## License

Licensed under the [MIT License](LICENSE). See [NOTICE](NOTICE), [SECURITY.md](.github/SECURITY.md), and [SUPPORT.md](.github/SUPPORT.md). This project is a third-party Add-On and is not affiliated with Archicad or Graphisoft.

Use, modification, and distribution are permitted under the MIT License, provided that the original copyright and license notice are retained.

**MEPbridge ACAIstr (MACAI)** — Made by Zuxai Z.(Zhong)
&copy; 2026 Zuxai Z. &middot; MIT License
