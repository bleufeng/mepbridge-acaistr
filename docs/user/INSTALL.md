# MEPbridge ACAIstr v0.1.9 Installation

> This guide covers v0.1.9. Download the approved ZIP from the GitHub Release. The complete package carries `RELEASE_MANIFEST.json` and `SHA256SUMS.txt` for payload verification.

This guide applies to Archicad 28, 29, and 30 on Windows x64.

For a first installation or cross-component upgrade, download the single bilingual `MACAI-Workbench-v0.1.9-win64.zip`. Do not use an APX update ZIP or GitHub-generated source archive as a full installer.

## Requirements

- Windows x64
- Archicad 28, 29, or 30
- A writable extraction directory
- Permission to approve installer elevation

**No separate Node.js or npm installation is required.** The full package includes a pinned Windows x64 Node portable runtime and Server production dependencies. Workbench components use only the bundled runtime and do not fall back to system Node.

The Server listens on `127.0.0.1:19780`; Archicad JSON API is detected in `127.0.0.1:19723-19743`.

### Portable runtime requirement

Keep the complete extraction directory, including `runtime`. If the runtime is missing, invalid, or cannot start, download and fully extract the package again; do not install system Node as a workaround. Environment-free means no separate Node.js/npm install; supported Windows, matching Archicad, and normal permissions are still required.

## Release Asset Selection

The full package contains:

```text
Archicad-28\MEPBridge.apx
Archicad-29\MEPBridge.apx
Archicad-30\MEPBridge.apx
runtime\node\node.exe
runtime\runtime-manifest.json
```

The installer deploys the matching APX. Existing complete installations may use these APX update ZIPs only when the Release explicitly allows an APX-only update:

```text
MEPbridge-apx-AC28-v0.1.9-win64.zip
MEPbridge-apx-AC29-v0.1.9-win64.zip
MEPbridge-apx-AC30-v0.1.9-win64.zip
```

Each update ZIP contains one root-level `MEPBridge.apx` and no Workbench, runtime, dependencies, or installer. First installations must use the full package.

## Choosing Between an APX-Only Update and a Full Package Update

Each release states its upgrade type in the release notes. Read that first; the
rules below explain what the two types mean and why the distinction matters.

**APX-only update** — replace `MEPBridge.apx` and restart Archicad. Nothing else
changes. Eligible only when the release changes the native Add-On alone: no new
command, no change to the registered command count or the descriptor/MCP tool
count, and no change to the Server, MCP Server, UI, task templates or installer.

**Full package update** — reinstall from the complete ZIP. Required when the
release touches anything outside the Add-On, including the Server or MCP Server,
the descriptor/MCP tool registry, the UI, task templates, starter assets, or the
installer. It is also required whenever the registered command count or the
descriptor count changes, because both numbers are compiled into the APX and
reported by Ping; updating only one side leaves Ping disagreeing with the files
actually installed.

Two rules apply to both types:

- Never mix an APX from one release with a package from another. The Add-On and
  the Server agree on a single command boundary per release; crossing releases is
  unsupported even when the files load without an error.
- Never use an APX-only asset for a first-time installation. It contains no
  Server, no dependencies and no installer.

### Performing an APX-Only Update

1. Save your work and exit Archicad completely. A running Archicad locks the APX
   file and the copy silently fails or has no effect.
2. Back up the existing `MEPBridge.apx` in the Add-On folder.
3. Extract the matching APX update ZIP and copy its `MEPBridge.apx` over the installed file.
4. Confirm the folder contains exactly one active `.apx` file.
5. Start Archicad and run Ping. The reported version must equal the new release
   version, and the command and descriptor counts must match the release notes.
   If the version still shows the old value, Archicad loaded a cached copy or the
   file was locked during the copy — repeat from step 1.

> The upgrade type of each release is stated in its GitHub Release notes; whenever anything
> beyond the Add-On changes (Server / MCP Server / descriptor registry / command-count change),
> a full package update is required.

## Automatic Installation

1. Extract the complete ZIP to a normal directory (Windows creates a folder named after the ZIP — this is expected).
2. Save your work and close Archicad.
3. Open the extracted folder and double-click `Install-MEPBridge.cmd` inside it (the installer locates everything relative to this file; the folder name does not matter).
4. Approve the Windows administrator prompt.
5. Select the Archicad installation when prompted.
6. Restart Archicad.

> Note: the extracted folder is the permanent runtime home of the Workbench Server/UI — do not delete or move it after installation. When upgrading, extract into a fresh directory instead of mixing files with an older version.

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

In Archicad, open Help → About Archicad; the title states Archicad 28, 29, or 30. **Install the matching APX** — another major version will not load.

### Step 2: Locate the Archicad install folder

Most reliable route: find the Archicad icon in the Start menu, right-click → More → Open file location, then right-click the shortcut → Properties. The Target field holds the full path to `Archicad.exe`; drop the trailing `\Archicad.exe` to get the install folder.

Typical paths:

```text
C:\Program Files\GRAPHISOFT\Archicad 28
D:\Program Files\GRAPHISOFT\Archicad 29
D:\Program Files\GRAPHISOFT\Archicad 30
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
Archicad-30\MEPBridge.apx   → for Archicad 30
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
3. Click "Version Info" and confirm the dialog reports the same version you installed.

Passing these three means the native Add-On is installed and Archicad JSON commands are available.

To use the Workbench, keep the portable runtime in place and create the local menu configuration. Manual APX copying does not write it, so run this once from the package root:

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
powershell -NoProfile -ExecutionPolicy Bypass -File tools\Start-BaseWorkbench.ps1 -Action Serve
```

4. Keep the terminal open and browse to `http://127.0.0.1:19780/`.
5. Press `Ctrl+C` to stop the Server.

## MCP Configuration

Start the Workbench Server first. Configure the MCP host to run the bundled executable:

```text
<package-root>\runtime\node\node.exe <package-root>\tools\mepbridge-mcp-server.js
```

Do not configure system `node`.

Example:

```json
{
  "mcpServers": {
    "mepbridge-acaistr": {
      "command": "D:\\MACAI-Workbench-v0.1.9-win64\\runtime\\node\\node.exe",
      "args": ["D:\\MACAI-Workbench-v0.1.9-win64\\tools\\mepbridge-mcp-server.js"],
      "env": {
        "MEPBRIDGE_ENDPOINT": "http://127.0.0.1:19780"
      }
    }
  }
}
```

### Point the path to your own extraction folder

`D:\MEPbridge-ACAIstr\` in the example is a placeholder. Replace it with your own extraction
directory, for example
`D:\\MACAI-Workbench-v0.1.9-win64\\tools\\mepbridge-mcp-server.js` (use the actual
extracted folder name). Note that Windows
backslashes inside JSON must be escaped as `\\`.

### Where common MCP clients keep their configuration

| Client | How to configure |
| --- | --- |
| Doubao (desktop) | In Doubao desktop's MCP / extensions settings, add a custom MCP server: paste the JSON above, or fill the form with the bundled `runtime\node\node.exe` absolute path as command and the script absolute path as argument, and the `MEPBRIDGE_ENDPOINT` environment variable |
| Cursor | Write the JSON into `%USERPROFILE%\.cursor\mcp.json` (project scope: `<project>\.cursor\mcp.json`), then restart Cursor |
| Claude Desktop | Merge the JSON into `%APPDATA%\Claude\claude_desktop_config.json`, then restart Claude Desktop |
| CodeBuddy | Write the JSON into the project `.codebuddy\.mcp.json` or the user-level `~\.codebuddy\.mcp.json`, then restart the IDE |
| Codex CLI | Append to `%USERPROFILE%\.codex\config.toml` (TOML format): `[mcp_servers.mepbridge]`, `command = "<extraction-dir>/runtime/node/node.exe"`, `args = ["<extraction-dir>/tools/mepbridge-mcp-server.js"]`, `env = { MEPBRIDGE_ENDPOINT = "http://127.0.0.1:19780" }` |
| Antigravity CLI (formerly Gemini CLI) | Merge the JSON into the top-level `mcpServers` object of `%USERPROFILE%\.gemini\settings.json`, then start a new session |
| Google Antigravity | Write the JSON into `%USERPROFILE%\.gemini\config\mcp_config.json`, then restart Antigravity |

> **Antigravity CLI and Google Antigravity both live under `~/.gemini/`, but they read different files.**
> Antigravity CLI (`agy`) reads `~/.gemini/settings.json`; Google Antigravity reads
> `~/.gemini/config/mcp_config.json`. Writing to the wrong one has no effect.

### Check the connection status in the UI

The left sidebar of the workbench shows an **MCP Integrations** section that lists every
configured host, refreshed every 10 seconds. It distinguishes two states:

- **Connected** — the host completed the MCP `initialize` handshake, so the tools are live.
- **Configured** — the configuration file contains MEPBridge and the host process is running.
  This does *not* prove the connection works; restart the host if the tools do not appear.

### Other MCP hosts (not listed above)

Any host that supports **stdio-transport MCP** can be connected. Provide the same three
elements in its MCP settings:

1. Command: `<your-extraction-dir>\runtime\node\node.exe`
2. Argument: `<your-extraction-dir>\tools\mepbridge-mcp-server.js`
3. Environment variable: `MEPBRIDGE_ENDPOINT=http://127.0.0.1:19780`

The script speaks stdio JSON-RPC 2.0 and depends only on Node.js built-in modules — no extra
installation steps. If a client cannot configure custom stdio commands (for example a pure
web-based client), it cannot be connected; support depends on that client's own MCP
capabilities.

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

**Upgrading from v0.1.8 or earlier to v0.1.9 requires a full-package update.** v0.1.9 introduces the single bilingual package, bundled runtime, and AC30 asset. Do not update only the APX or overwrite an old extraction directory.

Users with a previous version installed can update as follows:

### Option 1: Full Package Update (Recommended)

Use this when the Server, UI, MCP Server, or dependencies have changed.

1. Download `MACAI-Workbench-v0.1.9-win64.zip` from the GitHub Release. After extraction, retain and use the included `RELEASE_MANIFEST.json` and `SHA256SUMS.txt` for payload verification.
2. Save your work and close Archicad.
3. Extract the new ZIP to a fresh directory (keep the old directory for rollback).
4. Double-click `Install-MEPBridge.cmd` in the new directory.
5. Select the installed Archicad when prompted.
6. Restart Archicad.

The installer backs up the old APX if its hash differs and replaces it with the new version. User data (templates, custom commands, knowledge base, etc.) is stored under `%APPDATA%\MEPBridge` and is not overwritten.

### Option 2: APX-Only Update

Use this for minor updates that fix only the native Add-On without changing the Server, UI, or dependencies.

1. Only when the Release explicitly says “APX-only update,” download and extract the matching `MEPbridge-apx-AC<host>-vX.Y.Z-win64.zip`.
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
- `/health` reports the same version you installed.
- Ping reports registered C++ command and Add-On descriptor/MCP tool counts that match the
  release notes of the installed version.

Use a test or backed-up PLN before running write, delete, batch, or geometry-changing commands.

## v0.1.9 capability limitation

v0.1.9 does **not support height edits of existing curtain walls**. Height-only or combined height/grid requests are rejected before writing, with no automatic delete/recreate fallback. **Creation height and verified grid edits remain available.** Installing a separate Node.js runtime or DevKit does not enable this capability.
