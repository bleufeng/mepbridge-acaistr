# MEPbridge ACAIstr v0.2.0 Quick Start

> v0.2.0 is Windows x64 only; no macOS asset is delivered. Archicad 30 passed the selected v0.2.0 acceptance scope. The Archicad 28 and 29 binaries are built and referenced, but their affected v0.2.0 cases were **not run**.

## 1. Install

Use the single bilingual `MACAI-Workbench-v0.2.0-win64.zip`. It includes the portable Node runtime, dependencies, `RELEASE_MANIFEST.json`, and `SHA256SUMS.txt`, so **no separate Node.js or npm installation is required**. Do not use APX update ZIPs or source archives for first installation.

1. Download the release ZIP and extract the complete package (Windows creates a folder named after the ZIP — this is expected).
2. Close Archicad, open the extracted folder and run `Install-MEPBridge.cmd` inside it (this folder is the Workbench runtime home — do not delete it after installation).
3. Select Archicad 28, 29, or 30 when prompted, then restart Archicad.
4. Open **MEPbridge ACAIstr -> Open MEPbridge ACAIstr**.

The interface is English by default. Chinese can be switched in the interface and the choice is remembered.

See [INSTALL.md](INSTALL.md) for manual installation, MCP configuration and Local Add-On handling.

## 2. Confirm the Connection

1. Open a test or backed-up PLN.
2. Confirm that the Workbench shows Archicad and MEPBridge as online.
3. Run Ping or read the current project information.
4. Confirm that the reported version and the Ping command / descriptor counts match the release notes of the installed version.

## 3. Manual Mode

Use Manual mode when the command and parameters are known.

1. Select a module.
2. Select a command.
3. Review parameters, units, story, and target elements.
4. Confirm mutation operations.
5. Execute and inspect the structured response and Archicad readback.

## 4. CollabAI Mode

Use CollabAI mode for natural-language requests, templates, and multi-step plans.

1. Enter the requested result.
2. Review the generated plan.
3. Confirm steps according to the selected risk policy.
4. Execute and review each result.

LLM connectivity and the saved endpoint/configuration are displayed separately; a connected state does not prove that the saved endpoint is the one in use. Without an LLM connection, Manual mode, imported templates, and configured local custom commands remain available.

## 5. Viewport Results

- AABB results show real returned position, size, and relative scale.
- Plan-only diagrams are workflow previews and are not model geometry.
- Use Archicad readback or native screenshots to confirm actual geometry.

## 6. Conversation-Only Window

The right conversation panel can open as a separate resizable window. It keeps the existing history, input, execution state, templates, and CollabAI/Manual mode state.

## 7. Safety

- Start with read-only commands.
- Use test coordinates for create operations.
- Confirm GUIDs and selection before editing or deleting.
- Treat dry-run as parameter and structural validation, not proof that a model change occurred.
- Keep project backups.

## 8. Known Limitations and Local Add-On

- Height edits of existing curtain walls are rejected before writing; creation height and verified grid edits remain available.
- Lamp GDL parameter writes and advanced MEP writes are deferred and rejected before dispatch.
- No compliance certification is claimed; no production automatic professional model-audit definition is included.
- If the installer reports `MANUAL_LOCAL_MEPBRIDGE_ACTION_REQUIRED`, close Archicad, archive or remove the exact APX path/SHA it lists manually, then rerun the installer. Nothing is overwritten, migrated, or deleted automatically.

## 9. Support

Contact: `aizuxa@agent.qq.com`

GitHub: `https://github.com/bleufeng`

Remove API keys, project data, PLN files, and personal information before sending feedback.
