# MEPbridge ACAIstr v0.1.2 Installation

This guide applies to the Windows release packages for Archicad 28 and Archicad 29.

Download `MEPbridge-ACAIstr-v0.1.2-win64-en-US.zip` for an English-first installation or `MEPbridge-ACAIstr-v0.1.2-win64-zh-CN.zip` for a Chinese-first installation. Do not use an APX-only update or GitHub's automatically generated `Source code.zip` / `Source code.tar.gz` for first-time installation.

## Requirements

- Windows x64
- Archicad 28 or Archicad 29
- Node.js 18 or later
- A writable extraction directory

The Server listens on `127.0.0.1:19780` by default. Archicad's local JSON API is detected in the `127.0.0.1:19723-19743` range.

### Node.js requirement

The native Add-On (`MEPBridge.apx`) works without Node.js, but the **Workbench Server, UI, and MCP Server all require Node.js 18 or later**. If Node.js is missing, the installer still installs the APX and prints a warning; the Archicad commands remain usable, but the Workbench will not start until Node.js is installed.

Verify Node.js is available before or after installation:

```powershell
node --version
```

If the command is not found, download and install the LTS release from <https://nodejs.org/>, then reopen the MEPbridge ACAIstr menu to start the Workbench.

## Package Selection

Both full language packages contain:

```text
Archicad-28\MEPBridge.apx
Archicad-29\MEPBridge.apx
```

Use only the APX matching the installed Archicad major version.

The standalone `MEPbridge-ACAIstr-v0.1.2-AC28-win64.apx` and
`MEPbridge-ACAIstr-v0.1.2-AC29-win64.apx` assets update only the native Add-On.
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

If a previous MEPBridge Add-On is already installed, the installer detects and reuses that location automatically, so you will not end up with two copies under different Add-On folders.

### Custom install paths

Most users can double-click `Install-MEPBridge.cmd`. If Archicad is installed on a non-system drive (for example `E:\`) or you want to choose the Add-On folder yourself, run the PowerShell installer directly:

```powershell
powershell -File tools\Install-MEPBridgePackage.ps1 -ArchicadRoot "E:\GRAPHISOFT\Archicad 28" -AddOnRelativeDir "Add-Ons\MEPBridge"
```

- `-ArchicadRoot` points at the folder that contains `Archicad.exe`.
- `-AddOnRelativeDir` is the Add-On subfolder under the Archicad root (default `Add-Ons\MEPBridge`).

When the automatic detection cannot find Archicad, the installer prompts you to type the install folder; you can also pass `-ArchicadRoot` to skip the prompt.

## Manual Installation

Use this when the automatic installer fails, or when you want full control over every step. The whole procedure needs administrator rights because the target folder is under `Program Files`.

### Step 1: Confirm your Archicad major version

In Archicad, open Help → About Archicad; the title states either Archicad 28 or Archicad 29. The install folder name works too (Step 2 uses it). **You must install the APX matching your major version** — Archicad refuses to load an Add-On built for the other version.

### Step 2: Locate the Archicad install folder

Most reliable route: find the Archicad icon in the Start menu, right-click → More → Open file location, then right-click the shortcut → Properties. The Target field holds the full path to `Archicad.exe`; drop the trailing `\Archicad.exe` to get the install folder.

Typical paths:

```text
C:\Program Files\GRAPHISOFT\Archicad 28
D:\Program Files\GRAPHISOFT\Archicad 29
```

The folder is correct when `Archicad.exe` sits directly inside it.

### Step 3: Close Archicad

Save your work and exit Archicad completely. A running Archicad locks the APX file and the copy will fail.

### Step 4: Prepare the target folder

Open `<Archicad folder>\Add-Ons\` and check for a `MEPBridge` subfolder:

- Absent: create a folder named `MEPBridge`. Windows prompts for administrator permission; choose Continue.
- Present: open it and handle any previous build in Step 6.

The final target path is:

```text
<Archicad folder>\Add-Ons\MEPBridge\
```

### Step 5: Copy the matching APX

From the extracted release package, pick the source file for your major version:

```text
Archicad-28\MEPBridge.apx   → for Archicad 28
Archicad-29\MEPBridge.apx   → for Archicad 29
```

Copy it into the Step 4 folder. Choose Continue if Windows asks for administrator permission, and "Replace the file in the destination" if a file with the same name already exists.

### Step 6: Ensure only one active APX remains

The folder must contain **exactly one** file named `MEPBridge.apx`. Archicad loads every `.apx` in that folder, and multiple active APX files cause duplicate command registration or a load failure.

- A previous build also named `MEPBridge.apx` was already overwritten in Step 5; nothing more to do.
- Any other `.apx` file (for example a hand-renamed `MEPBridge-old.apx`) must be moved out of the folder or deleted.
- Backup files such as `MEPBridge.apx.bak-20260729-093423` do **not** count as active APX files (their extension is not `.apx`). Keep or delete them as you prefer.

### Step 7: Restart Archicad

Archicad loads the Add-On during startup.

### Step 8: Verify the installation

Check in order:

1. No Add-On load error appears during startup.
2. The menu bar shows the **MEPbridge ACAIstr** menu with three items: "Open MEPbridge ACAIstr", "Usage Guide", and "Version Info".
3. Click "Version Info" and confirm the dialog reports `Version: 0.1.2`.

Passing these three means the native Add-On is installed and Archicad JSON commands are available.

Using the Workbench (Server / UI / MCP Server) additionally requires Node.js plus the local menu configuration. Manual installation does not write that configuration, so run this once from the release package root:

```powershell
powershell -File tools\Start-BaseWorkbench.ps1 -Action InstallConfig
```

The "Open MEPbridge ACAIstr" menu item then starts everything in one click; see the next section for the manual alternative.

### Common failure causes

| Symptom | Cause and fix |
| --- | --- |
| "You need permission to perform this action" while copying | Administrator rights were not granted. Choose Continue in the prompt, or reopen File Explorer as administrator and copy again. |
| The file is reported as in use | Archicad is still running, possibly as a background process. Confirm `Archicad.exe` has ended in Task Manager. |
| No MEPbridge ACAIstr menu appears | The APX is in the wrong folder, or the major version does not match. Recheck Steps 2, 4, and 5. |
| A menu item reports that the menu configuration is missing | `Start-BaseWorkbench.ps1 -Action InstallConfig` has not been run. See Step 8. |
| "Version Info" reports an unexpected version | A previous APX is still in the folder, or the copy did not actually replace it. Return to Step 6. |

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
- `/health` reports version `0.1.2`.
- Ping reports 74 registered commands and 72 descriptor/MCP tools.

Use a test or backed-up PLN before running write, delete, batch, or geometry-changing commands.
