# Flowyard

An editable flow board in the style of Miro: an infinite canvas with frames, color-coded shapes, connectors, and ready-made security and architecture flows. Boards save to a Cloudflare Durable Object, and every open tab sees edits live.

## Getting started

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill it in (see below)
npm run db:migrate               # creates the tables in Postgres
npm run dev                      # homepage at http://localhost:5173, board at /board
npm test
```

`npm test` skips the database tests unless you point them at a **throwaway** Postgres (never production; they write test users and boards):

```bash
DATABASE_URL=postgres://test:test@localhost:5432/test npm run db:migrate
TEST_DATABASE_URL=postgres://test:test@localhost:5432/test npm test
```

CI does this on every pull request with a Postgres container.

Without signing in, anyone can draw; the board is saved in their browser. Creating a share link needs a sign-in (GitHub, Google, or Discord). Anyone with a share link and its key can open the board live, with the access the owner chose.

### Configuration (`.dev.vars` locally, `wrangler secret put` in production)

| Name | What it's for |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Used by `npm run db:migrate` and, locally, by Hyperdrive. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | [GitHub OAuth app](https://github.com/settings/developers). Callback: `<origin>/auth/callback/github` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | [Google OAuth client](https://console.cloud.google.com/apis/credentials) (web application). Redirect URI: `<origin>/auth/callback/google` |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | [Discord application](https://discord.com/developers/applications), OAuth2. Redirect: `<origin>/auth/callback/discord` |
| `ANTHROPIC_API_KEY` | Assistant with Claude ([console.anthropic.com](https://console.anthropic.com)). |
| `GEMINI_API_KEY` | Assistant with Google Gemini ([aistudio.google.com](https://aistudio.google.com/apikey)). |
| `DEEPSEEK_API_KEY` | Assistant with DeepSeek ([platform.deepseek.com](https://platform.deepseek.com)). |
| `GEMINI_MODEL` / `DEEPSEEK_MODEL` / `WORKERS_AI_MODEL` | Optional model overrides. Defaults: `gemini-3.8-flash`, `deepseek-flash`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. |
| `WORKERS_AI` | Workers AI runs on Cloudflare with no API key and is on by default. Set to `off` to hide it. |
| `CLOUDFLARE_ACCOUNT_ID` | Local dev only: which Cloudflare account Workers AI uses (see `npx wrangler whoami`). Without it, Workers AI is off in `npm run dev`. |

Leave a provider's pair empty to hide its button. Every assistant provider you configure shows up in the assistant's model picker. Replies from all of them pass the same validation before anything is drawn. `<origin>` is `http://localhost:5173` in development and your deployed URL in production; register both.

### Deploying

Live at **https://flowyard.khmersec.workers.dev** (Worker `flowyard`, Hyperdrive config `flowyard-db`).

**Automatic:** [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) is connected to the `flowyard` Worker and deploys every push to `main`. Merge a pull request and it ships. Set the Builds deploy command to `npx wrangler deploy` (the build command already builds; `npm run deploy` would build a second time).

**Database changes first:** if a pull request changes `db/schema.sql`, run `npm run db:migrate` against production before merging it. Migrations are written to work with the code that's already live.

**By hand**, from a machine logged in with `npx wrangler login`:

```bash
npm run deploy
```

**Production secrets** (set once, not in git):

```bash
npx wrangler secret put GITHUB_CLIENT_ID      # and the rest from the table above
```

OAuth callback URLs for production: `https://flowyard.khmersec.workers.dev/auth/callback/github` (or `google`, `discord`).

**Setting up a new environment** (only if you recreate it): create the Hyperdrive config with caching off, then put its id in `wrangler.jsonc`:

```bash
npx wrangler hyperdrive create flowyard-db --connection-string="postgres://..." \
  --sslmode require --caching-disabled --origin-connection-limit 15
```

Caching stays off so session checks and board lists are never stale. Databases with a private certificate authority (Aiven, for example) work with `sslmode=require`. To also verify the server certificate, upload the CA with `npx wrangler cert upload certificate-authority --ca-cert ca.pem --name aiven-ca` and switch Hyperdrive to `--sslmode verify-full --ca-certificate-id <id>`.

The Worker uses one Durable Object class, `BoardDO` (migration `v1`). If you ever deploy to a different, older Worker, its migration history must match, or the deploy fails with code 10064.

## Security

[SECURITY.md](SECURITY.md) has how to report a problem, what protects the app, the checklist every change goes through, and the release workflow. CI runs lint, type checks, tests, the build, and `npm audit` on every pull request.

## Using the board

- **Add things:** pick a tool on the left (box, start/end, decision, database, sticky note, text, frame), then click or drag on the canvas. Double-click empty canvas to drop a box.
- **Connect:** select a shape, then drag one of its teal dots onto another shape. Click a dot to add the next step in that direction.
- **Edit text:** double-click anything, or select it and press Enter. Double-click a frame's title to rename it, or a connector to label it.
- **Style:** the bar above a selection sets color, shape, text size, bold, line style, arrowheads, and routing (elbow, one bend, straight).
- **Templates:** OAuth 2.0 + PKCE, request lifecycle, incident response (NIST SP 800-61), secure CI/CD, and sign-in with MFA.
- **Export:** the board menu exports PNG, SVG, or a `.json` board file you can open again later.
- **Share:** creates a link after you sign in. Your shared boards are listed in the account menu, where the owner can delete them.
- **Assistant:** describe a flow and it draws it as a new frame. Select a frame first and it edits that one. Every change can be undone. Each account gets 60 requests a day.
- Press `?` in the app for all keyboard shortcuts.

## How it's built

| Path | What it does |
| --- | --- |
| `shared/board.ts` | Board model, edge routing, and validation of untrusted boards |
| `shared/templates.ts` | Built-in flows, laid out on a grid |
| `worker/board-do.ts` | `BoardDO`: one per board, stores it in SQLite and relays edits over WebSockets |
| `worker/index.ts` | Routes: sign-in, boards, assistant, live editing |
| `worker/auth.ts` | GitHub / Google / Discord OAuth and session cookies |
| `worker/ai.ts` | Assistant endpoint: prompt, usage limit, validation of every reply |
| `worker/ai-providers.ts` | One adapter each for Claude, Gemini, DeepSeek, and Workers AI |
| `db/schema.sql` | Postgres tables: users, sign-in accounts, sessions, board owners, assistant usage |
| `src/board/Editor.tsx` | Canvas interactions, shortcuts, and in-place text editing |
| `src/board/Scene.tsx` | SVG rendering, shared by the live canvas, exports, and homepage previews |
| `src/landing/` | Homepage at `/` (styled to match lineworkai.com) |

Edits sync as whole documents, last write wins. Share links are 128-bit random ids; anyone who has one can edit that board, so only share boards with people you'd give edit access to.
