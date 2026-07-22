# MEPbridge ACAIstr v0.1.0 Installation

This guide applies to the Windows release packages for Archicad 28 and Archicad 29.

Download the named `MEPbridge-ACAIstr-v0.1.0-*.zip` asset from GitHub Releases. Do not use GitHub's automatically generated `Source code.zip` or `Source code.tar.gz`; they are not installation packages and do not contain the complete APX and runtime dependencies.

## Requirements

- Windows x64
- Archicad 28 or Archicad 29
- Node.js 18 or later
- A writable extraction directory

The Server listens on `127.0.0.1:19780` by default. Archicad's local JSON API is detected in the `127.0.0.1:19723-19743` range.

## Package Selection

The combined package contains:

```text
Archicad-28\MEPBridge.apx
Archicad-29\MEPBridge.apx
```

Use only the APX matching the installed Archicad major version.

## Automatic Installation

1. Extract the complete ZIP to a normal directory.
2. Save your work and close Archicad.
3. Double-click `Install-MEPBridge.cmd`.
4. Approve the Windows administrator prompt.
5. Select the Archicad installation when prompted.
6. Restart Archicad.

The installer copies the matching APX to:

```text
<Archicad folder>\Add-Ons\MEPBridge\MEPBridge.apx
```

It also writes the local Workbench menu configuration. Existing APX files with different hashes are backed up before replacement.

## Manual Installation

1. Close Archicad.
2. Copy the matching `MEPBridge.apx` from `Archicad-28` or `Archicad-29`.
3. Place it under `<Archicad folder>\Add-Ons\MEPBridge\`.
4. Ensure the folder contains only one active `MEPBridge.apx`.
5. Restart Archicad.

## Start the Workbench

Preferred method:

1. Open Archicad.
2. Open the MEPbridge ACAIstr menu.
3. Select **Open MEPbridge ACAIstr**.

The Add-On starts the local Server when needed and opens the Workbench.

Manual fallback:

1. Open the extracted package root in File Explorer.
2. Click the address bar, type `powershell`, and press Enter. Alternatively, right-click an empty area and choose **Open in Terminal**.
3. Run:

```powershell
node server\server.js
```

4. Keep the terminal open and browse to `http://127.0.0.1:19780/`.
5. Press `Ctrl+C` to stop the Server.

## MCP Configuration

Start the Workbench Server first. Configure the MCP host to run:

```text
node <package-root>\tools\mepbridge-mcp-server.js
```

Example:

```json
{
  "mcpServers": {
    "mepbridge-acaistr": {
      "command": "node",
      "args": ["D:\\MEPbridge-ACAIstr\\tools\\mepbridge-mcp-server.js"],
      "env": {
        "MEPBRIDGE_ENDPOINT": "http://127.0.0.1:19780"
      }
    }
  }
}
```

## Runtime Data

User templates, custom commands, LLM configuration, learning memory, and audit data are stored under:

```text
%APPDATA%\MEPBridge
```

Use `MEPBRIDGE_DATA_DIR` to select another writable location. Do not store user data in the Archicad installation folder or extracted release directory.

## Uninstall

1. Save your work and close Archicad.
2. Double-click `Uninstall-MEPBridge.cmd`.
3. Select the Archicad installation when prompted.

The default uninstall removes the APX but preserves user data. Workbench menu configuration can be removed with the PowerShell `-RemoveWorkbenchConfig` option.

## Verification

- Archicad loads the Add-On without an error.
- The MEPbridge ACAIstr menu shows three independent menu items.
- The Workbench opens at `http://127.0.0.1:19780/`.
- `/health` reports version `0.1.0`.
- Ping reports 61 registered commands and 59 descriptor/MCP tools.

Use a test or backed-up PLN before running write, delete, batch, or geometry-changing commands.
