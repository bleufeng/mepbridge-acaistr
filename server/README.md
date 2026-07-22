# MEPBridge ACAIstr Server

Node.js Express backend for MEPbridge ACAIstr v0.1.0.

## Start

```powershell
npm install
npm start
```

The Server listens on `127.0.0.1:19780` by default. Override with:

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "19780"
$env:MEPBRIDGE_DATA_DIR = "$env:APPDATA\MEPBridge"
npm start
```

Runtime user data is written under `%APPDATA%\MEPBridge` by default, not inside the release folder.

## Key Endpoints

- `GET /health`: Server health, version, descriptor count, and reviewed module counts.
- `GET /api/ping`: Archicad/MEPBridge connection status. Scans local Archicad JSON API ports `19723-19743`.
- `POST /api/execute`: Main Archicad JSON API proxy path.
- `POST /api/copilot/message`: Natural-language planning and execution entry.
- `GET/POST /api/user-assets/*`: User templates and custom natural-language commands.
- `GET/POST /api/knowledge-base/*`: Local knowledge-base rules.
- `GET/POST /api/learning-memory/*`: Local learning memory.
- `GET/POST /api/proactive/*`: Proactive suggestions.
- `GET /api/mcp/*`: MCP host integration status.
- `GET /api/extensions/catalog`: Reviewed Workbench module catalog.
- `POST /api/extensions/commands/:commandName/execute`: Execute a namespaced reviewed module command.

## Reviewed Modules

Modules load only from `modules/registry.json`. Every module must have a
validated manifest and namespaced commands. The runtime rejects undeclared
Archicad calls, oversized parameters, invalid input schemas, duplicate command
names, timeouts, and unconfirmed mutation requests.

```powershell
npm run validate:modules
npm run test:modules
```

## Release Notes

- Public version: `0.1.0`.
- C++ Add-On: 61 registered commands.
- Descriptor/MCP tools: 59 generated tools.
- Reviewed Workbench modules: generated from `modules/registry.json`.
- Default network exposure: local machine only.
- Official release entry: `node server\server.js` from the release root.
