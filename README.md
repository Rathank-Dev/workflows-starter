# Linework

An editable flow board in the style of Miro: an infinite canvas with frames, color-coded shapes, connectors, and ready-made security and architecture flows. Boards save to a Cloudflare Durable Object, and every open tab sees edits live.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run deploy
```

Open `/?board=<name>` to start a separate board. The default board, `main`, starts with three example flows.

## Using the board

- **Add things:** pick a tool on the left (box, start/end, decision, database, sticky note, text, frame), then click or drag on the canvas. Double-click empty canvas to drop a box.
- **Connect:** select a shape, then drag one of its teal dots onto another shape. Click a dot to add the next step in that direction.
- **Edit text:** double-click anything, or select it and press Enter. Double-click a frame's title to rename it, or a connector to label it.
- **Style:** the bar above a selection sets color, shape, text size, bold, line style, arrowheads, and routing (elbow, one bend, straight).
- **Templates:** OAuth 2.0 + PKCE, request lifecycle, incident response (NIST SP 800-61), secure CI/CD, and sign-in with MFA.
- **Export:** the board menu exports PNG, SVG, or a `.json` board file you can open again later.
- Press `?` in the app for all keyboard shortcuts.

## How it's built

| Path | What it does |
| --- | --- |
| `shared/board.ts` | Board model, edge routing, and validation of untrusted boards |
| `shared/templates.ts` | Built-in flows, laid out on a grid |
| `worker/board-do.ts` | `BoardDO`: one per board, stores it in SQLite and relays edits over WebSockets |
| `worker/index.ts` | `GET/PUT /api/board/:id` and `GET /ws?board=:id` |
| `src/board/Editor.tsx` | Canvas interactions, shortcuts, and in-place text editing |
| `src/board/Scene.tsx` | SVG rendering, shared by the live canvas and exports |

Edits sync as whole documents, last write wins. Anyone with a board's link can edit it, so add authentication before you store anything sensitive.
