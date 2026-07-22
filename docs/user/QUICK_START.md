# MEPbridge ACAIstr Quick Start

## 1. Install

Download the named `MEPbridge-ACAIstr-v0.1.0-*.zip` Release asset, not GitHub's automatically generated `Source code.zip` or `Source code.tar.gz`.

1. Extract the complete v0.1.0 release ZIP.
2. Close Archicad and run `Install-MEPBridge.cmd`.
3. Restart Archicad.
4. Open **MEPbridge ACAIstr -> Open MEPbridge ACAIstr**.

See [INSTALL.md](INSTALL.md) for manual installation and MCP configuration.

## 2. Confirm the Connection

1. Open a test or backed-up PLN.
2. Confirm that the Workbench shows Archicad and MEPBridge as online.
3. Run Ping or read the current project information.
4. Confirm version `0.1.0`, 61 registered C++ commands, and 59 descriptor/MCP tools.

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

Without an LLM connection, Manual mode, imported templates, and configured local custom commands remain available.

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

## 8. Support

Contact: `aizuxa@agent.qq.com`

GitHub: `https://github.com/bleufeng`

Remove API keys, project data, PLN files, and personal information before sending feedback.
