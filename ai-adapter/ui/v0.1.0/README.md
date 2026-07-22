# MEPbridge ACAIstr UI

React and Vite frontend for the local MEPbridge ACAIstr Workbench.

## Requirements

- Node.js 18+
- The project Server running at `127.0.0.1:19780` for full API behavior

## Development

```powershell
npm ci
npm run dev
```

The development entry uses `server.ts`.

## Verification

```powershell
npm run lint
npm run build
```

Production output is written to `dist/`. The release package copies this compiled directory and serves it through `server/server.js`.

## Runtime Rules

- UI model operations must use `/api/execute`.
- Do not call Archicad's JSON API directly from React components.
- User data and LLM configuration are managed by the Server and stored outside the release directory.
- The application must remain usable in Manual mode without an LLM connection.
- Public static pages are maintained under `public/`.
