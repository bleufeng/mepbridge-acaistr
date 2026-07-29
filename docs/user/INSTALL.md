# MEPbridge ACAIstr v0.1.1 Installation

This guide applies to the Windows release packages for Archicad 28 and Archicad 29.

Download `MEPbridge-ACAIstr-v0.1.1-win64-en-US.zip` for an English-first installation or `MEPbridge-ACAIstr-v0.1.1-win64-zh-CN.zip` for a Chinese-first installation. Do not use an APX-only update or GitHub's automatically generated `Source code.zip` / `Source code.tar.gz` for first-time installation.

## Requirements

- Windows x64
- Archicad 28 or Archicad 29
- Node.js 18 or later
- A writable extraction directory

The Server listens on `127.0.0.1:19780` by default. Archicad's local JSON API is detected in the `127.0.0.1:19723-19743` range.

## Package Selection

Both full language packages contain:

```text
Archicad-28\MEPBridge.apx
Archicad-29\MEPBridge.apx
```

Use only the APX matching the installed Archicad major version.

The standalone `MEPbridge-ACAIstr-v0.1.1-AC28-win64.apx` and
`MEPbridge-ACAIstr-v0.1.1-AC29-win64.apx` assets update only the native Add-On.
They do not include the Server, UI, MCP Server, production dependencies, or
installer and are intended only for an existing complete installation.

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

## Version Update

Users with a previous version installed can update as follows:

### Option 1: Full Package Update (Recommended)

Use this when the Server, UI, MCP Server, or dependencies have changed.

1. Download the new full ZIP (`win64-zh-CN.zip` or `win64-en-US.zip`) from GitHub Releases.
2. Save your work and close Archicad.
3. Extract the new ZIP to a fresh directory (keep the old directory for rollback).
4. Double-click `Install-MEPBridge.cmd` in the new directory.
5. Select the installed Archicad when prompted.
6. Restart Archicad.

The installer backs up the old APX if its hash differs and replaces it with the new version. User data (templates, custom commands, knowledge base, etc.) is stored under `%APPDATA%\MEPBridge` and is not overwritten.

### Option 2: APX-Only Update

Use this for minor updates that fix only the native Add-On without changing the Server, UI, or dependencies.

1. Download the standalone `MEPbridge-ACAIstr-vX.Y.Z-AC28-win64.apx` or `MEPbridge-ACAIstr-vX.Y.Z-AC29-win64.apx` (matching the installed Archicad major version) from GitHub Releases.
2. Save your work and close Archicad.
3. Copy the new APX to `<Archicad folder>\Add-Ons\MEPBridge\`, overwriting the old `MEPBridge.apx` (back up the old file first).
4. Restart Archicad.

> Note: APX-only updates do not include Server/UI/MCP Server changes. If the new version also updates Workbench components, use Option 1.

### Post-Update Verification

- Archicad loads the Add-On without an error.
- The MEPbridge ACAIstr menu shows three independent menu items.
- The Workbench opens at `http://127.0.0.1:19780/`.
- `/health` reports the new version number.
- Ping reports the registered command count and descriptor/MCP tool count for the new version.

### Rollback

If the new version has issues and you need to roll back:

- **Full package update**: Re-run `Install-MEPBridge.cmd` from the old directory, or restore the old APX from a backup directory.
- **APX-only update**: Overwrite the new version with the previously backed-up old `MEPBridge.apx`.

User data is generally compatible across versions; if a data format incompatibility occurs, automatic backups are available under `%APPDATA%\MEPBridge\backups\`.

## Verification

- Archicad loads the Add-On without an error.
- The MEPbridge ACAIstr menu shows three independent menu items.
- The Workbench opens at `http://127.0.0.1:19780/`.
- `/health` reports version `0.1.1`.
- Ping reports 74 registered commands and 72 descriptor/MCP tools.

Use a test or backed-up PLN before running write, delete, batch, or geometry-changing commands.
