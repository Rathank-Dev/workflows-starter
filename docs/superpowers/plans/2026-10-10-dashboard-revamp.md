# Dashboard Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dashboard board icons drawn from each board's shapes, live presence, grid previews, an open-threads badge with a "Needs reply" filter, and a walkthroughs view.

**Architecture:** Each board's Durable Object builds a small summary of itself (layout boxes, connector pairs, open threads, who's connected). A new Worker endpoint returns summaries for up to 24 boards the caller can open, fetched in parallel. The dashboard requests summaries only for rows that scroll into view and renders icons, previews, and presence from them. A second endpoint lists the caller's walkthroughs.

**Tech Stack:** Cloudflare Workers + Durable Objects (SQLite), Postgres via Hyperdrive (postgres.js), React 19 + Vite, Vitest with `@cloudflare/vitest-pool-workers`, Playwright (headless Chromium) for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-10-dashboard-design.md`

## Global Constraints

- Dashboard only (`/dashboard`); the board editor and homepage don't change.
- Keep the existing dark linework style and color tokens (`var(--canvas)`, `var(--chrome)`, `var(--ink)`, `var(--teal)` …); board shapes use `COLORS[color].fill` / `.stroke` from `shared/board.ts`.
- Summary: at most **60 boxes** (largest first), at most **80 edges**, positions and sizes normalized to 0..1; **no text, labels, or names** of shapes.
- `live.people`: at most **8** signed-in people, deduplicated by user id; `live.guests`: count of connected sockets with no user.
- Summaries endpoint: sign-in required, at most **24 ids** per request, ids must match `/^[a-f0-9]{32}$/`, **2-second timeout per board**, inaccessible ids omitted silently.
- Live data refreshes every **30 s** while the tab is visible.
- Free walkthrough limit is `FREE_RECORDINGS` (5) from `worker/recordings.ts`.
- Phone layout under **720 px**: hide Live now and Owner columns; grid shows 1–2 columns.
- `localStorage` reads and writes are wrapped in try/catch.
- Verification commands are judged by **exit code**, not by grepping output.
- Commit message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Empty or degenerate boards** (no shapes, a single shape, shapes with zero width, negative or very large coordinates) should give a valid summary with no `NaN` and an empty-board icon. Test added in Task 1.
2. **The same person in two tabs, plus anonymous visitors**, should count once in `people`, with guests counted separately. Test added in Task 2.
3. **A bad request body** (more than 24 ids, malformed ids, duplicates, a non-array) should get 400 for over-limit or a non-array; malformed and duplicate ids are dropped without an error. Test added in Task 3.
4. **A walkthrough on a trashed board, or on a board whose link was reset,** should still be listed with `playable: false` and stay deletable. Test added in Task 3.
5. **Trash view and boards that fail to summarize:** trash rows never request summaries, and a missing summary leaves a plain icon. Check added in Task 5's browser step.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `shared/summary.ts` (new) | `BoardSummary` types and the pure `summarize(board)` function. |
| `worker/board-do.ts` (modify) | `getSummary()` RPC: cached shape summary by revision, open-thread count, live people. |
| `worker/summaries.ts` (new) | `POST /api/dashboard/summaries` and `GET /api/recordings` handlers. |
| `worker/index.ts` (modify) | Route the two endpoints. |
| `src/dashboard/BoardGlyph.tsx` (new) | SVG rendering of a summary: `BoardIcon` (32 px) and `BoardPreview` (card). |
| `src/dashboard/LiveNow.tsx` (new) | Stacked avatars with the "here now" label. |
| `src/dashboard/useSummaries.ts` (new) | Fetch summaries for rows in view, batch, and refresh. |
| `src/dashboard/Walkthroughs.tsx` (new) | Walkthroughs view. |
| `src/dashboard/Dashboard.tsx` (modify) | Icon column, Live now column, threads badge, filter, grid toggle, sidebar icons, skeletons. |
| `src/dashboard/dashboard.css` (modify) | Styles for all of the above. |
| `src/board/icons.tsx` (modify) | `home`, `clock`, `star`, `grid`, `list` icons. |
| `src/board/walkthroughs.tsx` (modify) | `PlayerDialog` takes an optional `linkKey`. |
| `test/summary.test.ts` (new), `test/collab.test.ts`, `test/db.test.ts` (modify) | Tests. |

---

### Task 1: Board summary function

**Files:**
- Create: `shared/summary.ts`
- Test: `test/summary.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SummaryShape = ShapeKind | "text" | "frame";
  export interface SummaryBox { x: number; y: number; w: number; h: number; shape: SummaryShape; color: ColorKey }
  export interface ShapeSummary { boxes: SummaryBox[]; edges: [number, number][] }
  export interface BoardSummary extends ShapeSummary {
  	openThreads: number;
  	live: { people: { id: string; name: string; avatarUrl?: string | null }[]; guests: number };
  }
  export const MAX_SUMMARY_BOXES = 60;
  export const MAX_SUMMARY_EDGES = 80;
  export function summarize(board: Board): ShapeSummary;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Board, BoardEl } from "../shared/board";
import { MAX_SUMMARY_BOXES, MAX_SUMMARY_EDGES, summarize } from "../shared/summary";

const shape = (id: string, x: number, y: number, w = 100, h = 60, color = "blue"): BoardEl =>
	({ id, type: "shape", shape: "rect", color, text: `secret ${id}`, textSize: "m", bold: false, x, y, w, h }) as BoardEl;
const edge = (id: string, from: string, to: string): BoardEl =>
	({ id, type: "edge", from, to, label: "label text", dashed: false, arrow: "end", route: "elbow" }) as BoardEl;
const board = (elements: BoardEl[]): Board => ({ v: 1, name: "Board name", elements });

describe("summarize", () => {
	it("normalizes positions into 0..1, centered, keeping the aspect ratio", () => {
		const s = summarize(board([shape("a", 0, 0, 100, 50), shape("b", 300, 50, 100, 50)]));
		expect(s.boxes).toHaveLength(2);
		for (const b of s.boxes) {
			for (const v of [b.x, b.y, b.w, b.h]) {
				expect(Number.isFinite(v)).toBe(true);
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(1);
			}
		}
		// Bounds are 400 x 100: width fills 0..1, height is centered (0.375..0.625)
		const xs = s.boxes.map((b) => [b.x, b.x + b.w]).flat();
		const ys = s.boxes.map((b) => [b.y, b.y + b.h]).flat();
		expect(Math.min(...xs)).toBeCloseTo(0);
		expect(Math.max(...xs)).toBeCloseTo(1);
		expect(Math.min(...ys)).toBeCloseTo(0.375);
		expect(Math.max(...ys)).toBeCloseTo(0.625);
	});

	it("keeps the largest boxes and drops edges to boxes it dropped", () => {
		const els: BoardEl[] = [shape("big", 0, 0, 1000, 1000)];
		// s0 is the largest of the small ones, s99 the smallest: s0..s58 are kept, s59..s99 dropped
		for (let i = 0; i < 100; i++) els.push(shape(`s${i}`, i * 300, 2000, 200 - i, 200 - i));
		els.push(edge("e-kept", "big", "s0"), edge("e-gone", "s98", "s99"));
		const s = summarize(board(els));
		expect(s.boxes).toHaveLength(MAX_SUMMARY_BOXES);
		expect(s.boxes[0].w).toBeGreaterThan(s.boxes[1].w);
		// Only big → s0 survives, as indexes into boxes (big is 0, s0 is 1)
		expect(s.edges).toEqual([[0, 1]]);
	});

	it("caps edges", () => {
		const els: BoardEl[] = [shape("a", 0, 0), shape("b", 200, 0)];
		for (let i = 0; i < 200; i++) els.push(edge(`e${i}`, "a", "b"));
		expect(summarize(board(els)).edges).toHaveLength(MAX_SUMMARY_EDGES);
	});

	it("never includes text, labels, or names", () => {
		const s = summarize(board([shape("a", 0, 0), shape("b", 200, 0), edge("e", "a", "b")]));
		const json = JSON.stringify(s);
		expect(json).not.toContain("secret");
		expect(json).not.toContain("label text");
		expect(json).not.toContain("Board name");
	});

	it("maps text and frames to their own shapes with neutral colors", () => {
		const s = summarize(
			board([
				{ id: "t", type: "text", text: "hi", textSize: "m", bold: false, x: 0, y: 0, w: 50, h: 20 } as BoardEl,
				{ id: "f", type: "frame", title: "T", subtitle: "", x: 0, y: 0, w: 500, h: 400 } as BoardEl,
			]),
		);
		expect(s.boxes.find((b) => b.shape === "frame")?.color).toBe("white");
		expect(s.boxes.find((b) => b.shape === "text")?.color).toBe("grey");
	});

	// Review Focus 1
	it("handles empty, single, zero-size, and far-away shapes without NaN", () => {
		expect(summarize(board([]))).toEqual({ boxes: [], edges: [] });
		const one = summarize(board([shape("a", -5000, 900000, 0, 0)]));
		expect(one.boxes).toHaveLength(1);
		for (const v of Object.values(one.boxes[0]).filter((v) => typeof v === "number")) expect(Number.isFinite(v)).toBe(true);
		const far = summarize(board([shape("a", -1e6, -1e6, 10, 10), shape("b", 1e6, 1e6, 10, 10)]));
		for (const b of far.boxes) expect(Number.isFinite(b.x + b.y + b.w + b.h)).toBe(true);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/summary.test.ts`
Expected: FAIL, `Failed to resolve import "../shared/summary"`.

- [ ] **Step 3: Implement `shared/summary.ts`**

```ts
import { isBox, type Board, type BoxEl, type ColorKey, type ShapeKind } from "./board";

/**
 * A board's layout in miniature, for dashboard icons and previews: boxes and
 * which ones connect, never any text. Built by the board's Durable Object.
 */
export type SummaryShape = ShapeKind | "text" | "frame";

export interface SummaryBox {
	/** Position and size as fractions (0..1) of the board's bounds, centered, aspect kept. */
	x: number;
	y: number;
	w: number;
	h: number;
	shape: SummaryShape;
	color: ColorKey;
}

export interface ShapeSummary {
	boxes: SummaryBox[];
	/** Connectors, as indexes into `boxes`. */
	edges: [number, number][];
}

export interface BoardSummary extends ShapeSummary {
	/** Root comment threads not yet resolved. */
	openThreads: number;
	/** Who's connected now. The Worker adds avatarUrl. */
	live: { people: { id: string; name: string; avatarUrl?: string | null }[]; guests: number };
}

export const MAX_SUMMARY_BOXES = 60;
export const MAX_SUMMARY_EDGES = 80;

function look(el: BoxEl): { shape: SummaryShape; color: ColorKey } {
	if (el.type === "shape") return { shape: el.shape, color: el.color };
	if (el.type === "frame") return { shape: "frame", color: "white" };
	return { shape: "text", color: "grey" };
}

export function summarize(board: Board): ShapeSummary {
	const all = board.elements.filter(isBox);
	if (all.length === 0) return { boxes: [], edges: [] };
	// Largest first, so a crowded board keeps its structure
	const kept = [...all].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MAX_SUMMARY_BOXES);

	const minX = Math.min(...kept.map((b) => b.x));
	const minY = Math.min(...kept.map((b) => b.y));
	const maxX = Math.max(...kept.map((b) => b.x + Math.max(0, b.w)));
	const maxY = Math.max(...kept.map((b) => b.y + Math.max(0, b.h)));
	const bw = maxX - minX;
	const bh = maxY - minY;
	// One scale for both axes keeps the aspect ratio; a zero-size board scales by 1
	const scale = Math.max(bw, bh) || 1;
	const offX = (1 - bw / scale) / 2;
	const offY = (1 - bh / scale) / 2;
	const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;

	const index = new Map<string, number>();
	const boxes = kept.map((el, i): SummaryBox => {
		index.set(el.id, i);
		return {
			x: round((el.x - minX) / scale + offX),
			y: round((el.y - minY) / scale + offY),
			w: round(Math.max(0, el.w) / scale),
			h: round(Math.max(0, el.h) / scale),
			...look(el),
		};
	});

	const edges: [number, number][] = [];
	for (const el of board.elements) {
		if (el.type !== "edge") continue;
		const a = index.get(el.from);
		const b = index.get(el.to);
		if (a === undefined || b === undefined) continue;
		edges.push([a, b]);
		if (edges.length === MAX_SUMMARY_EDGES) break;
	}
	return { boxes, edges };
}
```

Check that `isBox` is exported from `shared/board.ts` (it is used by `src/board/exporting.ts`). If its signature differs, adapt the filter, not the export.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/summary.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/summary.ts test/summary.test.ts
git commit -m "Add a text-free layout summary of a board for the dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `getSummary()` on the board's Durable Object

**Files:**
- Modify: `worker/board-do.ts` (`ensureTable`, new `getSummary`, a `livePeople` helper next to `broadcastPresence`)
- Test: `test/collab.test.ts`

**Interfaces:**
- Consumes: `summarize`, `BoardSummary`, `ShapeSummary` from `shared/summary.ts` (Task 1).
- Produces: `BoardDO.getSummary(): Promise<BoardSummary>`, where `live.people` has no `avatarUrl` yet (Task 3 adds it).

Design note: the spec says the shape summary is "recomputed when the board saves". This plan computes it on the first `getSummary()` after a save and caches it by revision: the same result, without adding work to every save, and boards saved before this change are covered automatically.

- [ ] **Step 1: Write the failing test**

Append to `test/collab.test.ts`, which already defines `join`, `doc`, and `settle`:

```ts
describe("board summary", () => {
	it("summarizes shapes, open threads, and who's here: people once each, guests counted", async () => {
		const { env } = await import("cloudflare:test");
		const name = `summary-${Date.now()}`;
		const stub = env.BOARD.get(env.BOARD.idFromName(name));
		const shapes = [
			{ id: "a", type: "shape", shape: "rect", color: "blue", text: "secret", textSize: "m", bold: false, x: 0, y: 0, w: 100, h: 60 },
			{ id: "b", type: "shape", shape: "diamond", color: "yellow", text: "", textSize: "m", bold: false, x: 300, y: 0, w: 80, h: 80 },
			{ id: "e", type: "edge", from: "a", to: "b", label: "", dashed: false, arrow: "end", route: "elbow" },
		];
		expect(await stub.saveBoard({ v: 1, name: "S", elements: shapes })).toBe(1);

		const ada = await join(name, "edit", { id: "u-ada", name: "Ada" });
		const adaTab = await join(name, "edit", { id: "u-ada", name: "Ada" });
		const guest = await join(name, "view");
		await Promise.all([ada.next("hello"), adaTab.next("hello"), guest.next("hello")]);
		ada.ws!.send(JSON.stringify({ type: "comment:add", x: 1, y: 2, text: "Open question" }));
		await ada.next("comment");
		const before = ada.messages.length;
		ada.ws!.send(JSON.stringify({ type: "comment:add", x: 5, y: 6, text: "Done one" }));
		const done = (await ada.next("comment", before))?.comment as { id: string };
		ada.ws!.send(JSON.stringify({ type: "comment:resolve", id: done.id, resolved: true }));
		await settle();

		const s = await stub.getSummary();
		expect(s.boxes.map((b) => b.shape).sort()).toEqual(["diamond", "rect"]);
		expect(s.edges).toEqual([[s.boxes.findIndex((b) => b.shape === "rect"), s.boxes.findIndex((b) => b.shape === "diamond")]]);
		expect(s.openThreads).toBe(1);
		// Review Focus 2: Ada's two tabs count once; the anonymous viewer is a guest
		expect(s.live).toEqual({ people: [{ id: "u-ada", name: "Ada" }], guests: 1 });
		expect(JSON.stringify(s)).not.toContain("secret");

		// A new save is reflected (cache is keyed by revision)
		await stub.saveBoard({ v: 1, name: "S", elements: [] });
		expect((await stub.getSummary()).boxes).toEqual([]);
		for (const c of [ada, adaTab, guest]) c.ws!.close(1000);
	});

	it("is empty for a board never saved", async () => {
		const { env } = await import("cloudflare:test");
		const s = await env.BOARD.get(env.BOARD.idFromName(`summary-empty-${Date.now()}`)).getSummary();
		expect(s).toEqual({ boxes: [], edges: [], openThreads: 0, live: { people: [], guests: 0 } });
	});
});
```

The existing `next(type, after)` helper returns the first message of that type after index `after`; capturing `before` ahead of the send finds the second comment's broadcast, not the first.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/collab.test.ts -t "board summary"`
Expected: FAIL, `stub.getSummary is not a function`.

- [ ] **Step 3: Implement**

In `worker/board-do.ts`:

1. Import at the top:
   ```ts
   import { summarize, type BoardSummary, type ShapeSummary } from "../shared/summary";
   ```
2. In `ensureTable()`, add:
   ```ts
   // The dashboard's layout summary, cached by the board revision it was built from
   this.sql.exec("CREATE TABLE IF NOT EXISTS summary (id INTEGER PRIMARY KEY CHECK (id = 1), shapes TEXT NOT NULL, rev INTEGER NOT NULL)");
   ```
3. After `getBoard()`, add:
   ```ts
   /** For the dashboard: the board's layout in miniature, open threads, and who's here. */
   async getSummary(): Promise<BoardSummary> {
   	const { doc, rev } = this.read();
   	let shapes: ShapeSummary = { boxes: [], edges: [] };
   	if (doc) {
   		const cached = this.sql
   			.exec<{ shapes: string; rev: number }>("SELECT shapes, rev FROM summary WHERE id = 1")
   			.toArray()[0];
   		if (cached?.rev === rev) {
   			shapes = JSON.parse(cached.shapes) as ShapeSummary;
   		} else {
   			shapes = summarize(doc);
   			this.sql.exec(
   				"INSERT INTO summary (id, shapes, rev) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET shapes = excluded.shapes, rev = excluded.rev",
   				JSON.stringify(shapes),
   				rev,
   			);
   		}
   	}
   	const [{ n }] = this.sql
   		.exec<{ n: number }>("SELECT count(*) AS n FROM comments WHERE parent IS NULL AND resolved = 0")
   		.toArray();
   	return { ...shapes, openThreads: n, live: this.livePeople() };
   }
   ```
4. Replace the people-collecting part of `broadcastPresence` with a shared helper, so both use one definition. Add above `broadcastPresence`:
   ```ts
   /** Signed-in people connected now (once each, at most `limit`), and anonymous sockets. */
   private livePeople(closing?: WebSocket, limit = 8): { people: { id: string; name: string }[]; guests: number } {
   	const people = new Map<string, string>();
   	let guests = 0;
   	for (const s of this.ctx.getWebSockets()) {
   		if (s === closing || s.readyState !== WebSocket.OPEN) continue;
   		const p = peerOf(s);
   		if (p.userId && p.name) people.set(p.userId, p.name);
   		else guests += 1;
   	}
   	return { people: Array.from(people, ([id, name]) => ({ id, name })).slice(0, limit), guests };
   }
   ```
   and in `broadcastPresence`, replace the `people` map loop and the `people:` field with `people: this.livePeople(closing, 50).people,` (keep `count: sockets.length`).
5. In `deleteBoard()`, the existing `deleteAll()` already removes the `summary` table; `ensureTable()` recreates it. No change needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/collab.test.ts`
Expected: PASS, all collab tests including the 2 new ones and the existing presence tests.

- [ ] **Step 5: Commit**

```bash
git add worker/board-do.ts test/collab.test.ts
git commit -m "Let a board summarize itself for the dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Summaries and walkthroughs endpoints

**Files:**
- Create: `worker/summaries.ts`
- Modify: `worker/index.ts` (routes and doc comment)
- Test: `test/db.test.ts`, `test/security.test.ts`

**Interfaces:**
- Consumes: `BoardDO.getSummary()` (Task 2); `BoardSummary` (Task 1); `FREE_RECORDINGS` from `worker/recordings.ts`.
- Produces:
  - `POST /api/dashboard/summaries` with body `{ ids: string[] }`, returning `{ summaries: Record<string, BoardSummary> }` where `live.people[].avatarUrl` is set.
  - `GET /api/recordings`, returning `{ items: MyRecording[]; used: number; limit: number }`:
    ```ts
    interface MyRecording { id: string; title: string; durationMs: number; createdAt: string; boardId: string; boardName: string; playable: boolean; boardKey: string | null }
    ```
    `boardKey` is set only when the user reaches the board through its share link (not owner or member), so the client can play it with `?key=`.

- [ ] **Step 1: Write the failing tests**

In `test/security.test.ts`, append (no database needed: these are rejected before any query):

```ts
describe("dashboard summaries", () => {
	it("needs sign-in, and refuses cross-site requests", async () => {
		const post = (origin: string) =>
			SELF.fetch(`${ORIGIN}/api/dashboard/summaries`, {
				method: "POST",
				headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "10.6.0.1" },
				body: JSON.stringify({ ids: [] }),
			});
		expect((await post(ORIGIN)).status).toBe(401);
		expect((await post("https://evil.example")).status).toBe(403);
	});
});
```

In `test/db.test.ts`, inside the `describe.skipIf(!enabled)("with Postgres", …)` block, append:

```ts
	it("returns summaries only for boards the user can open, with avatars for who's here", async () => {
		const me = await user("Me");
		const other = await user("Other");
		const mine = await board(me.id);
		const trashed = await board(me.id);
		await sql`update boards set deleted_at = now() where id = ${trashed.id}`;
		const theirs = await board(other.id);
		const visited = await board(other.id);
		await sql`insert into board_visits (user_id, board_id, link_key) values (${me.id}, ${visited.id}, ${visited.key})`;
		const reset = await board(other.id);
		await sql`insert into board_visits (user_id, board_id, link_key) values (${me.id}, ${reset.id}, ${reset.key})`;
		await sql`update boards set link_key = ${randomHex(16)} where id = ${reset.id}`;
		await sql`update users set avatar_url = 'https://avatars.githubusercontent.com/u/1' where id = ${me.id}`;

		// Me is connected to my own board, so "live" has a person to add an avatar to
		const ws = await SELF.fetch(`${ORIGIN}/ws?board=${mine.id}`, {
			headers: { Upgrade: "websocket", Origin: ORIGIN, Cookie: me.cookie, "CF-Connecting-IP": ip() },
		});
		ws.webSocket!.accept();

		const ask = (ids: unknown) =>
			SELF.fetch(`${ORIGIN}/api/dashboard/summaries`, {
				method: "POST",
				headers: { Cookie: me.cookie, Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": ip() },
				body: JSON.stringify({ ids }),
			});
		const res = await ask([mine.id, trashed.id, theirs.id, visited.id, reset.id, mine.id, "not-an-id"]);
		expect(res.status).toBe(200);
		const { summaries } = (await res.json()) as { summaries: Record<string, { live: { people: { id: string; avatarUrl?: string | null }[] } }> };
		expect(Object.keys(summaries).sort()).toEqual([mine.id, visited.id].sort());
		expect(summaries[mine.id].live.people).toEqual([{ id: me.id, name: "Me", avatarUrl: "https://avatars.githubusercontent.com/u/1" }]);
		ws.webSocket!.close(1000);

		// Review Focus 3
		expect((await ask(Array.from({ length: 25 }, () => randomHex(16)))).status).toBe(400);
		expect((await ask("nope")).status).toBe(400);
	});

	it("lists only my walkthroughs, and marks ones I can no longer play", async () => {
		const me = await user("Recorder");
		const other = await user("Someone");
		const mine = await board(me.id);
		const trashed = await board(me.id);
		const linked = await board(other.id);
		await sql`insert into board_visits (user_id, board_id, link_key) values (${me.id}, ${linked.id}, ${linked.key})`;
		const rec = async (boardId: string, userId: string, title: string) => {
			const id = randomHex(16);
			await sql`insert into recordings (id, board_id, user_id, title, duration_ms, bytes, content_type) values (${id}, ${boardId}, ${userId}, ${title}, 65000, 2048, 'video/webm')`;
			return id;
		};
		const a = await rec(mine.id, me.id, "On my board");
		const b = await rec(trashed.id, me.id, "On a trashed board");
		const c = await rec(linked.id, me.id, "Through a link");
		await rec(mine.id, other.id, "Not mine");
		await sql`update boards set deleted_at = now() where id = ${trashed.id}`;

		const list = async () =>
			(await SELF.fetch(`${ORIGIN}/api/recordings`, { headers: { Cookie: me.cookie, "CF-Connecting-IP": ip() } }).then((r) => r.json())) as {
				items: { id: string; playable: boolean; boardKey: string | null; boardName: string; durationMs: number }[];
				used: number;
				limit: number;
			};
		let body = await list();
		expect(body.used).toBe(3);
		expect(body.limit).toBe(5);
		const by = (id: string) => body.items.find((i) => i.id === id)!;
		expect(body.items.map((i) => i.id).sort()).toEqual([a, b, c].sort());
		expect(by(a)).toMatchObject({ playable: true, boardKey: null, durationMs: 65000 });
		// Review Focus 4
		expect(by(b).playable).toBe(false);
		expect(by(c)).toMatchObject({ playable: true, boardKey: linked.key });

		await sql`update boards set link_key = ${randomHex(16)} where id = ${linked.id}`;
		body = await list();
		expect(by(c)).toMatchObject({ playable: false, boardKey: null });

		const signedOut = await SELF.fetch(`${ORIGIN}/api/recordings`, { headers: { "CF-Connecting-IP": ip() } });
		expect(signedOut.status).toBe(401);
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Start a throwaway Postgres if one isn't running (see `README.md`), apply the schema, then:

Run: `npx vitest run test/security.test.ts -t "dashboard summaries"` and `TEST_DATABASE_URL=postgres://test:test@127.0.0.1:55432/postgres npx vitest run test/db.test.ts`
Expected: FAIL; the summaries request returns 404 (no route) instead of 401/200.

- [ ] **Step 3: Implement `worker/summaries.ts`**

```ts
import type { Sql, User } from "./db";
import { error, json } from "./http";
import { FREE_RECORDINGS } from "./recordings";
import type { BoardSummary } from "../shared/summary";

const BOARD_ID = /^[a-f0-9]{32}$/;
const MAX_IDS = 24;
const SUMMARY_TIMEOUT_MS = 2000;

/**
 * Boards this user can open from the dashboard: their own, ones they're a
 * member of, or ones they visited with the board's current share key while the
 * link is on. Never trashed. Same rule as the dashboard list (worker/dashboard.ts).
 */
function openable(sql: Sql, userId: string) {
	return sql`
		(b.owner_id = ${userId}
			or exists (select 1 from board_members m where m.board_id = b.id and m.user_id = ${userId})
			or (b.link_access <> 'none' and exists (
				select 1 from board_visits v where v.board_id = b.id and v.user_id = ${userId} and v.link_key = b.link_key)))
	`;
}

/** POST /api/dashboard/summaries  { ids } — layout, open threads, and who's here, for up to 24 boards. */
export async function boardSummaries(request: Request, sql: Sql, env: Env, user: User): Promise<Response> {
	const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
	if (!Array.isArray(body?.ids) || body.ids.length > MAX_IDS) return error(`Send up to ${MAX_IDS} board ids.`, 400);
	const wanted = [...new Set(body.ids.filter((id): id is string => typeof id === "string" && BOARD_ID.test(id)))];
	if (wanted.length === 0) return json({ summaries: {} });

	const rows = await sql<{ id: string }[]>`
		select b.id from boards b
		where b.id = any(${wanted}) and b.deleted_at is null and ${openable(sql, user.id)}
	`;

	const results = await Promise.all(
		rows.map(async ({ id }) => {
			const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), SUMMARY_TIMEOUT_MS));
			const summary = env.BOARD.get(env.BOARD.idFromName(id))
				.getSummary()
				.catch(() => null);
			return [id, await Promise.race([summary, timeout])] as const;
		}),
	);
	const summaries: Record<string, BoardSummary> = {};
	for (const [id, s] of results) if (s) summaries[id] = s as BoardSummary;

	// Avatars for everyone who's here, in one query
	const peopleIds = [...new Set(Object.values(summaries).flatMap((s) => s.live.people.map((p) => p.id)))];
	if (peopleIds.length) {
		const avatars = new Map(
			(await sql<{ id: string; avatar_url: string | null }[]>`select id, avatar_url from users where id = any(${peopleIds})`).map((u) => [
				u.id,
				u.avatar_url,
			]),
		);
		for (const s of Object.values(summaries)) {
			s.live.people = s.live.people.map((p) => ({ ...p, avatarUrl: avatars.get(p.id) ?? null }));
		}
	}
	return json({ summaries });
}

/** GET /api/recordings — the user's own walkthroughs across every board. */
export async function myRecordings(sql: Sql, user: User): Promise<Response> {
	const items = await sql<
		{ id: string; title: string; duration_ms: number; created_at: Date; board_id: string; board_name: string; playable: boolean; via_link: boolean; link_key: string }[]
	>`
		select r.id, r.title, r.duration_ms, r.created_at, b.id as board_id, b.name as board_name, b.link_key,
			(b.deleted_at is null and ${openable(sql, user.id)}) as playable,
			(b.owner_id <> ${user.id}
				and not exists (select 1 from board_members m where m.board_id = b.id and m.user_id = ${user.id})) as via_link
		from recordings r join boards b on b.id = r.board_id
		where r.user_id = ${user.id}
		order by r.created_at desc
	`;
	return json({
		items: items.map((r) => ({
			id: r.id,
			title: r.title,
			durationMs: r.duration_ms,
			createdAt: r.created_at,
			boardId: r.board_id,
			boardName: r.board_name,
			playable: r.playable,
			boardKey: r.playable && r.via_link ? r.link_key : null,
		})),
		used: items.length,
		limit: FREE_RECORDINGS,
	});
}
```

postgres.js composes the `openable(...)` fragment into the outer query as SQL (fragments made with the same `sql` tag nest), and `any(${array})` passes the array as one parameter.

In `worker/index.ts`:

1. Import: `import { boardSummaries, myRecordings } from "./summaries";`
2. In the routes doc comment under "Walkthroughs", add ` * - GET  /api/recordings          Your walkthroughs across boards` and under the dashboard block ` * - POST /api/dashboard/summaries  Board icons, previews, live people (up to 24)`.
3. After the `/api/dashboard` GET route, add:
   ```ts
   if (path === "/api/dashboard/summaries" && method === "POST") {
   	const user = await currentUser(request, db());
   	return user ? boardSummaries(request, db(), env, user) : error("Sign in to see your dashboard.", 401);
   }
   if (path === "/api/recordings" && method === "GET") {
   	const user = await currentUser(request, db());
   	return user ? myRecordings(db(), user) : error("Sign in to see your walkthroughs.", 401);
   }
   ```
   `/api/recordings` (no id) must be matched before the `/api/recordings/:id` route; the id route uses a regex that requires the id, so ordering only matters for readability. Keep these new routes next to `/api/dashboard`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run` (no database) → exit 0, db tests skipped.
Run: `TEST_DATABASE_URL=postgres://test:test@127.0.0.1:55432/postgres npx vitest run` → exit 0, all pass.
Run: `npx tsc -b && npx eslint .` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add worker/summaries.ts worker/index.ts test/db.test.ts test/security.test.ts
git commit -m "Add dashboard summaries and a list of your walkthroughs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Glyph, preview, and live-now components

**Files:**
- Create: `src/dashboard/BoardGlyph.tsx`, `src/dashboard/LiveNow.tsx`
- Modify: `src/board/icons.tsx` (add icons), `src/dashboard/dashboard.css`

**Interfaces:**
- Consumes: `BoardSummary`, `ShapeSummary`, `SummaryBox` (Task 1); `COLORS` from `shared/board.ts`; `Avatar` from `src/board/account.tsx`.
- Produces:
  ```tsx
  export function BoardIcon(props: { summary: ShapeSummary | null | undefined }): JSX.Element  // 32 px tile; undefined = loading shimmer, null = plain
  export function BoardPreview(props: { summary: ShapeSummary | null | undefined }): JSX.Element  // fills its container
  export function LiveNow(props: { live: BoardSummary["live"] | undefined; max?: number }): JSX.Element | null
  // icons.tsx additions:
  Icons.home, Icons.clock, Icons.star, Icons.grid, Icons.list
  ```

There's no React component test setup in this repo (Vitest runs in the Workers pool). These components are checked by type-checking here and in the browser in Task 5.

- [ ] **Step 1: Add icons to `src/board/icons.tsx`**

Inside the `Icons` object, after `link`:

```tsx
	home: () => (
		<Icon>
			<path d="M4 11l8-6.5 8 6.5M6 9.5V19h4.5v-5h3v5H18V9.5" />
		</Icon>
	),
	clock: () => (
		<Icon>
			<circle cx="12" cy="12" r="8" />
			<path d="M12 7.5V12l3 2" />
		</Icon>
	),
	star: () => (
		<Icon>
			<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
		</Icon>
	),
	grid: () => (
		<Icon>
			<rect x="4" y="4" width="7" height="7" rx="1.5" />
			<rect x="13" y="4" width="7" height="7" rx="1.5" />
			<rect x="4" y="13" width="7" height="7" rx="1.5" />
			<rect x="13" y="13" width="7" height="7" rx="1.5" />
		</Icon>
	),
	list: () => (
		<Icon>
			<path d="M9 6.5h11M9 12h11M9 17.5h11" />
			<circle cx="5" cy="6.5" r="1" fill="currentColor" stroke="none" />
			<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
			<circle cx="5" cy="17.5" r="1" fill="currentColor" stroke="none" />
		</Icon>
	),
```

- [ ] **Step 2: Create `src/dashboard/BoardGlyph.tsx`**

```tsx
import { COLORS } from "../../shared/board";
import type { ShapeSummary, SummaryBox } from "../../shared/summary";

/** One box in the summary's 0..1 space, drawn as its shape in its board colors. */
function Shape({ b }: { b: SummaryBox }) {
	const { fill, stroke } = COLORS[b.color];
	const common = { fill, stroke, strokeWidth: 1, vectorEffect: "non-scaling-stroke" as const };
	const r = Math.min(b.w, b.h);
	switch (b.shape) {
		case "frame":
			return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="var(--ink-soft)" strokeOpacity={0.5} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
		case "text":
			return <rect x={b.x} y={b.y + b.h * 0.4} width={b.w} height={Math.max(b.h * 0.2, 0.004)} fill="var(--ink-soft)" opacity={0.6} />;
		case "diamond": {
			const cx = b.x + b.w / 2;
			const cy = b.y + b.h / 2;
			return <polygon points={`${cx},${b.y} ${b.x + b.w},${cy} ${cx},${b.y + b.h} ${b.x},${cy}`} {...common} />;
		}
		case "pill":
			return <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={r / 2} {...common} />;
		case "cylinder":
			return (
				<g>
					<rect x={b.x} y={b.y} width={b.w} height={b.h} rx={r * 0.15} {...common} />
					<ellipse cx={b.x + b.w / 2} cy={b.y + b.h * 0.15} rx={b.w / 2} ry={b.h * 0.15} {...common} />
				</g>
			);
		default:
			return <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={r * 0.12} {...common} />;
	}
}

function Drawing({ summary, lines }: { summary: ShapeSummary; lines: boolean }) {
	// Frames first so shapes sit on top of them
	const order = summary.boxes.map((b, i) => [b, i] as const).sort(([a], [b]) => Number(b.shape === "frame") - Number(a.shape === "frame"));
	return (
		<svg viewBox="-0.04 -0.04 1.08 1.08" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
			{lines &&
				summary.edges.map(([a, b], i) => {
					const p = summary.boxes[a];
					const q = summary.boxes[b];
					return (
						<line
							key={i}
							x1={p.x + p.w / 2}
							y1={p.y + p.h / 2}
							x2={q.x + q.w / 2}
							y2={q.y + q.h / 2}
							stroke="var(--ink-soft)"
							strokeOpacity={0.55}
							strokeWidth={1}
							vectorEffect="non-scaling-stroke"
						/>
					);
				})}
			{order.map(([b, i]) => (
				<Shape key={i} b={b} />
			))}
		</svg>
	);
}

/**
 * A board's icon: its own shapes in miniature. `undefined` while loading
 * (shimmers), `null` when there's no summary (plain tile).
 */
export function BoardIcon({ summary }: { summary: ShapeSummary | null | undefined }) {
	if (summary === undefined) return <span className="board-icon" data-loading aria-hidden="true" />;
	if (!summary || summary.boxes.length === 0) return <span className="board-icon" data-empty aria-hidden="true" />;
	return (
		<span className="board-icon" aria-hidden="true">
			<Drawing summary={summary} lines={false} />
		</span>
	);
}

/** A larger picture of the board for grid cards, with its connectors. */
export function BoardPreview({ summary }: { summary: ShapeSummary | null | undefined }) {
	if (summary === undefined) return <span className="board-preview" data-loading aria-hidden="true" />;
	if (!summary || summary.boxes.length === 0) {
		return (
			<span className="board-preview" data-empty aria-hidden="true">
				<span>Empty board</span>
			</span>
		);
	}
	return (
		<span className="board-preview" aria-hidden="true">
			<Drawing summary={summary} lines />
		</span>
	);
}
```

- [ ] **Step 3: Create `src/dashboard/LiveNow.tsx`**

```tsx
import type { BoardSummary } from "../../shared/summary";
import { Avatar } from "../board/account";

/** "Ada and 2 others are here" */
function label(live: BoardSummary["live"]): string {
	const names = live.people.map((p) => p.name);
	const total = names.length + live.guests;
	if (total === 0) return "";
	const first = names[0] ?? "A guest";
	return total === 1 ? `${first} is here` : `${first} and ${total - 1} ${total - 1 === 1 ? "other" : "others"} are here`;
}

/** Who's on a board right now: up to `max` avatars, then "+N". Nothing when it's empty. */
export function LiveNow({ live, max = 3 }: { live: BoardSummary["live"] | undefined; max?: number }) {
	if (!live) return null;
	const total = live.people.length + live.guests;
	if (total === 0) return null;
	const shown = live.people.slice(0, max);
	const more = total - shown.length;
	return (
		<span className="live-now" role="img" aria-label={label(live)} title={label(live)}>
			<span className="live-dot" aria-hidden="true" />
			<span className="live-faces" aria-hidden="true">
				{shown.map((p) => (
					<Avatar key={p.id} user={{ name: p.name, avatarUrl: p.avatarUrl ?? null }} size={24} />
				))}
				{more > 0 && <span className="live-more">+{more}</span>}
			</span>
		</span>
	);
}
```

- [ ] **Step 4: Add styles to `src/dashboard/dashboard.css`**

Append:

```css
/* ─── Board icons, previews, presence ─────────── */

.board-icon {
	display: inline-grid;
	place-items: center;
	width: 32px;
	height: 32px;
	flex: none;
	border: 1px solid var(--chrome-line);
	border-radius: 6px;
	background: var(--canvas);
	overflow: hidden;
}

.board-icon svg,
.board-preview svg {
	width: 100%;
	height: 100%;
}

.board-icon[data-empty] {
	border-style: dashed;
}

.board-preview {
	display: grid;
	place-items: center;
	width: 100%;
	aspect-ratio: 16 / 10;
	border-bottom: 1px solid var(--chrome-line);
	background:
		radial-gradient(circle, var(--grid) 1px, transparent 1px) 0 0 / 14px 14px,
		var(--canvas);
	color: var(--ink-soft);
	font-size: 13px;
}

.board-icon[data-loading],
.board-preview[data-loading],
.skeleton {
	background: linear-gradient(90deg, var(--chrome) 0%, var(--chrome-hover) 50%, var(--chrome) 100%) 0 0 / 200% 100%;
	animation: shimmer 1.4s ease-in-out infinite;
}

@keyframes shimmer {
	to {
		background-position: -200% 0;
	}
}

.live-now {
	display: inline-flex;
	align-items: center;
	gap: 8px;
}

.live-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #2e9455;
	box-shadow: 0 0 0 0 rgb(46 148 85 / 0.6);
	animation: live-pulse 2s ease-out infinite;
}

@keyframes live-pulse {
	70% {
		box-shadow: 0 0 0 6px rgb(46 148 85 / 0);
	}
	100% {
		box-shadow: 0 0 0 0 rgb(46 148 85 / 0);
	}
}

.live-faces {
	display: inline-flex;
}

.live-faces > * {
	margin-left: -6px;
	border: 2px solid var(--chrome);
	border-radius: 50%;
	width: 24px;
	height: 24px;
}

.live-faces > :first-child {
	margin-left: 0;
}

.live-more {
	display: inline-grid;
	place-items: center;
	background: var(--chrome-hover);
	color: var(--ink-soft);
	font-size: 11px;
	font-weight: 600;
}

.threads-badge {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	margin-left: 8px;
	padding: 1px 7px 1px 5px;
	border-radius: 999px;
	background: var(--select-soft);
	color: var(--teal);
	font-size: 11.5px;
	font-weight: 600;
	vertical-align: 1px;
}

.threads-badge svg {
	width: 13px;
	height: 13px;
}

@media (prefers-reduced-motion: reduce) {
	.board-icon[data-loading],
	.board-preview[data-loading],
	.skeleton,
	.live-dot {
		animation: none;
	}
}
```

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc -b && npx eslint .` → exit 0.

```bash
git add src/dashboard/BoardGlyph.tsx src/dashboard/LiveNow.tsx src/board/icons.tsx src/dashboard/dashboard.css
git commit -m "Add board icon, preview, and live-now components

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Summaries in the list view, threads badge, Needs reply filter, skeletons

**Files:**
- Create: `src/dashboard/useSummaries.ts`
- Modify: `src/dashboard/Dashboard.tsx`, `src/dashboard/dashboard.css`

**Interfaces:**
- Consumes: `POST /api/dashboard/summaries` (Task 3); `BoardIcon`, `LiveNow` (Task 4); `BoardSummary` (Task 1).
- Produces:
  ```ts
  export function useSummaries(enabled: boolean): {
  	summaries: Map<string, BoardSummary | null>;   // null = asked, not available
  	observe: (id: string) => (el: Element | null) => void;  // ref callback for a row
  	request: (ids: string[]) => void;               // fetch these now (e.g. for Needs reply)
  };
  ```

- [ ] **Step 1: Create `src/dashboard/useSummaries.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardSummary } from "../../shared/summary";

const BATCH = 24;
const REFRESH_MS = 30_000;

/**
 * Board summaries for the dashboard, fetched for rows as they scroll into view,
 * in batches of up to 24. While the tab is visible, rows in view refresh every
 * 30 s so "Live now" stays current.
 */
export function useSummaries(enabled: boolean) {
	const [summaries, setSummaries] = useState<Map<string, BoardSummary | null>>(new Map());
	const queued = useRef(new Set<string>());
	const inView = useRef(new Set<string>());
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const nodes = useRef(new Map<Element, string>());
	const observer = useRef<IntersectionObserver | null>(null);

	const flush = useCallback(async () => {
		timer.current = null;
		const ids = [...queued.current];
		queued.current.clear();
		for (let i = 0; i < ids.length; i += BATCH) {
			const batch = ids.slice(i, i + BATCH);
			try {
				const res = await fetch("/api/dashboard/summaries", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ ids: batch }),
				});
				// Signed out meanwhile: reload, and the dashboard shows its sign-in screen
				if (res.status === 401) {
					window.location.assign("/dashboard");
					return;
				}
				const data = res.ok ? ((await res.json()) as { summaries: Record<string, BoardSummary> }) : { summaries: {} };
				setSummaries((m) => {
					const next = new Map(m);
					// Asked and not returned: a plain icon, no error
					for (const id of batch) next.set(id, data.summaries[id] ?? null);
					return next;
				});
			} catch {
				setSummaries((m) => {
					const next = new Map(m);
					for (const id of batch) if (!next.has(id)) next.set(id, null);
					return next;
				});
			}
		}
	}, []);

	const request = useCallback(
		(ids: string[]) => {
			for (const id of ids) queued.current.add(id);
			timer.current ??= setTimeout(flush, 80);
		},
		[flush],
	);

	useEffect(() => {
		if (!enabled) return;
		observer.current = new IntersectionObserver((entries) => {
			const fresh: string[] = [];
			for (const e of entries) {
				const id = nodes.current.get(e.target);
				if (!id) continue;
				if (e.isIntersecting) {
					inView.current.add(id);
					fresh.push(id);
				} else inView.current.delete(id);
			}
			setSummaries((m) => {
				const missing = fresh.filter((id) => !m.has(id));
				if (missing.length) request(missing);
				return m;
			});
		});
		for (const el of nodes.current.keys()) observer.current.observe(el);
		const refresh = setInterval(() => {
			if (document.visibilityState === "visible" && inView.current.size) request([...inView.current]);
		}, REFRESH_MS);
		return () => {
			observer.current?.disconnect();
			observer.current = null;
			clearInterval(refresh);
		};
	}, [enabled, request]);

	const observe = useCallback(
		(id: string) => (el: Element | null) => {
			for (const [node, nodeId] of nodes.current) {
				if (nodeId === id && node !== el) {
					observer.current?.unobserve(node);
					nodes.current.delete(node);
				}
			}
			if (!el) return;
			nodes.current.set(el, id);
			observer.current?.observe(el);
		},
		[],
	);

	return { summaries, observe, request };
}
```

- [ ] **Step 2: Wire it into `Dashboard.tsx`**

1. Imports:
   ```ts
   import { BoardIcon } from "./BoardGlyph";
   import { LiveNow } from "./LiveNow";
   import { useSummaries } from "./useSummaries";
   ```
2. New state after `sort`:
   ```ts
   type Show = "all" | "reply";
   const [show, setShow] = useState<Show>("all");
   const { summaries, observe, request } = useSummaries(Boolean(session.user) && view !== "trash");
   ```
   Declare `type Show = "all" | "reply";` next to the other type aliases at the top of the file, not inside the component.
3. In `visible`, after the owner filters, add:
   ```ts
   if (show === "reply") list = list.filter((r) => (summaries.get(r.id)?.openThreads ?? 0) > 0);
   ```
   and add `show, summaries` to its dependency array.
4. When "Needs reply" is chosen, fetch summaries for the whole list (the filter needs them):
   ```ts
   useEffect(() => {
   	if (show !== "reply" || !rows) return;
   	request(rows.filter((r) => !r.deleted_at && !summaries.has(r.id)).map((r) => r.id));
   	// eslint-disable-next-line react-hooks/exhaustive-deps -- run when the filter turns on or rows change, not on every summary
   }, [show, rows, request]);
   ```
5. In the filters, before "Owned by" (only when `view !== "trash"`):
   ```tsx
   <label>
   	<span>Show</span>
   	<select value={show} onChange={(e) => setShow(e.target.value as Show)}>
   		<option value="all">All boards</option>
   		<option value="reply">Needs reply</option>
   	</select>
   </label>
   ```
6. Table head: add an icon column after the star column and a Live now column after Name:
   ```tsx
   <th scope="col" className="col-icon"><span className="sr-only">Icon</span></th>
   …
   <th scope="col">Name</th>
   {view !== "trash" && <th scope="col" className="col-live">Live now</th>}
   ```
   and add `col-owner` to the Owner `<th>` and its `<td>`.
7. Each row: attach the observer (not in trash) and render the new cells:
   ```tsx
   <tr key={r.id} ref={view === "trash" ? undefined : observe(r.id)}>
   	<td className="col-star">…unchanged…</td>
   	<td className="col-icon">
   		<BoardIcon summary={view === "trash" ? null : summaries.get(r.id)} />
   	</td>
   	<td>
   		…in the non-trash link, after <strong>{r.name}</strong>:
   		{(summaries.get(r.id)?.openThreads ?? 0) > 0 && (
   			<span className="threads-badge" aria-label={`${summaries.get(r.id)!.openThreads} open comment threads`}>
   				<Icons.comment />
   				{summaries.get(r.id)!.openThreads}
   			</span>
   		)}
   	</td>
   	{view !== "trash" && (
   		<td className="col-live">
   			<LiveNow live={summaries.get(r.id)?.live} />
   		</td>
   	)}
   	…Last opened, Owner (with className="col-owner"), actions unchanged…
   </tr>
   ```
   Put the badge inside the `<strong>` line's parent so it sits next to the name: change `<strong>{r.name}</strong>` to `<strong>{r.name}{badge}</strong>` where `badge` is the JSX above.
8. Empty state for the filter: in the empty block, before the `query` branch, add `show === "reply" ? <p>No boards need a reply. Open threads show up here.</p> :`.
9. Replace `{!rows && !loadError && <p className="dash-note">Loading your boards…</p>}` with skeleton rows:
   ```tsx
   {!rows && !loadError && (
   	<div className="dash-skeleton" aria-busy="true" aria-label="Loading your boards">
   		{Array.from({ length: 5 }, (_, i) => (
   			<div key={i} className="dash-skeleton-row">
   				<span className="skeleton" />
   				<span className="skeleton" />
   				<span className="skeleton" />
   			</div>
   		))}
   	</div>
   )}
   ```

- [ ] **Step 3: Styles**

Append to `src/dashboard/dashboard.css`:

```css
.dash-table .col-icon {
	width: 44px;
	padding-right: 0;
}

.dash-table .col-live {
	width: 150px;
}

.dash-skeleton-row {
	display: grid;
	grid-template-columns: 32px minmax(0, 1fr) 120px;
	gap: 16px;
	align-items: center;
	padding: 14px 0;
	border-bottom: 1px solid var(--chrome-line);
}

.dash-skeleton-row .skeleton {
	height: 14px;
	border-radius: 4px;
}

.dash-skeleton-row .skeleton:first-child {
	height: 32px;
	border-radius: 6px;
}

@media (max-width: 720px) {
	.dash-table .col-live,
	.dash-table .col-owner {
		display: none;
	}
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc -b && npx eslint . && npm run build && npm test` → each exit 0.

Browser check: write a Playwright script in the session scratchpad and run it against `npm run dev` started with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://x:x@127.0.0.1:1/x` (so no real database is touched), mocking `/api/me`, `/api/dashboard`, and `/api/dashboard/summaries` with `page.route`. Mock 5 boards; summaries for 4 of them (one with `openThreads: 2` and two live people, one with an empty `boxes`); the 5th missing. Assert:
- 5 rows; 3 icons drawn (`.board-icon svg`), 1 empty (`[data-empty]`), 1 plain (no svg, not loading);
- a summaries response of 401 sends the page to `/dashboard`;
- the threads badge reads 2 on the right row; `.live-now` has `aria-label` "Ada and 1 other are here";
- choosing **Show: Needs reply** leaves 1 row;
- in **Trash**, no request to `/api/dashboard/summaries` is made (Review Focus 5);
- before `/api/dashboard` resolves (delay the mock 1 s), `.dash-skeleton` is visible;
- at 390 px wide, `.col-live` and `.col-owner` aren't visible and there's no horizontal scroll;
- no page errors.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/useSummaries.ts src/dashboard/Dashboard.tsx src/dashboard/dashboard.css
git commit -m "Show board icons, live presence, and open threads on the dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Grid view and the list/grid toggle

**Files:**
- Modify: `src/dashboard/Dashboard.tsx`, `src/dashboard/dashboard.css`

**Interfaces:**
- Consumes: `BoardPreview`, `LiveNow` (Task 4); `summaries`, `observe` (Task 5); `Icons.grid`, `Icons.list`, `Icons.comment` (Task 4 / existing).

- [ ] **Step 1: Layout state, remembered in this browser**

Near the other helpers at the top of `Dashboard.tsx`:

```ts
type Layout = "list" | "grid";
const LAYOUT_KEY = "flowyard:dashboard-layout";

function storedLayout(): Layout {
	try {
		return localStorage.getItem(LAYOUT_KEY) === "grid" ? "grid" : "list";
	} catch {
		return "list";
	}
}
```

In the component:

```ts
const [layout, setLayoutState] = useState<Layout>(storedLayout);
const setLayout = (l: Layout) => {
	setLayoutState(l);
	try {
		localStorage.setItem(LAYOUT_KEY, l);
	} catch {
		// Storage blocked: the choice lasts for this visit
	}
};
```

- [ ] **Step 2: The toggle**

At the end of `.dash-filters` (outside the trash condition, so it's always present except in trash):

```tsx
<div className="layout-toggle" role="group" aria-label="Layout">
	<button type="button" className="icon-btn" aria-pressed={layout === "list"} aria-label="List" onClick={() => setLayout("list")}>
		<Icons.list />
	</button>
	<button type="button" className="icon-btn" aria-pressed={layout === "grid"} aria-label="Grid" onClick={() => setLayout("grid")}>
		<Icons.grid />
	</button>
</div>
```

- [ ] **Step 3: The grid**

Render the grid instead of the table when `layout === "grid" && view !== "trash" && visible.length > 0` (trash always uses the table):

```tsx
<ul className="board-grid">
	{visible.map((r) => {
		const s = summaries.get(r.id);
		return (
			<li key={r.id} ref={observe(r.id)} className="board-card">
				<a href={boardPath(r.id, r.key)} className="board-card-link">
					<BoardPreview summary={s} />
					<span className="board-card-body">
						<strong>
							{r.name}
							{(s?.openThreads ?? 0) > 0 && (
								<span className="threads-badge" aria-label={`${s!.openThreads} open comment threads`}>
									<Icons.comment />
									{s!.openThreads}
								</span>
							)}
						</strong>
						<span>
							{r.is_owner ? "You" : r.owner_name} · {when(r.last_opened_at ?? r.updated_at)}
						</span>
					</span>
				</a>
				<span className="board-card-live">
					<LiveNow live={s?.live} />
				</span>
				<span className="board-card-actions">
					<button
						type="button"
						className="star-btn"
						aria-pressed={r.starred}
						aria-label={r.starred ? `Unstar ${r.name}` : `Star ${r.name}`}
						onClick={() => act(r, r.starred ? "unstar" : "star")}
					>
						<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
								fill={r.starred ? "currentColor" : "none"}
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinejoin="round"
							/>
						</svg>
					</button>
					<RowMenu row={r} view={view} onAction={(a) => act(r, a)} />
				</span>
			</li>
		);
	})}
</ul>
```

The star button markup duplicates the table's; extract it into a small `StarButton({ row, onToggle })` component in the same file and use it in both places.

- [ ] **Step 4: Styles**

```css
.layout-toggle {
	display: inline-flex;
	gap: 2px;
	padding: 2px;
	border: 1px solid var(--chrome-line);
	border-radius: 4px;
}

.layout-toggle .icon-btn[aria-pressed="true"] {
	background: var(--select-soft);
	color: var(--teal);
}

.board-grid {
	list-style: none;
	margin: 0;
	padding: 0;
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
	gap: 16px;
}

.board-card {
	position: relative;
	border: 1px solid var(--chrome-line);
	border-radius: 6px;
	background: var(--chrome);
	overflow: hidden;
	transition: border-color 0.15s;
}

.board-card:hover,
.board-card:focus-within {
	border-color: var(--teal);
}

.board-card-link {
	display: block;
	color: inherit;
	text-decoration: none;
}

.board-card-body {
	display: grid;
	gap: 4px;
	padding: 12px 84px 14px 14px;
}

.board-card-body strong {
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.board-card-body > span {
	color: var(--ink-soft);
	font-size: 13px;
}

.board-card-live {
	position: absolute;
	top: 10px;
	right: 10px;
	padding: 4px 6px;
	border-radius: 999px;
	background: rgb(13 18 24 / 0.75);
}

.board-card-live:empty {
	display: none;
}

.board-card-actions {
	position: absolute;
	right: 8px;
	bottom: 10px;
	display: inline-flex;
	align-items: center;
}

@media (max-width: 720px) {
	.board-grid {
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
	}
}

@media (max-width: 380px) {
	.board-grid {
		grid-template-columns: 1fr;
	}
}
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc -b && npx eslint . && npm run build && npm test` → each exit 0.

Browser check (same mocks as Task 5): click **Grid**; assert `.board-card` count equals rows, previews draw lines for the board with edges (`.board-preview line`), the empty board shows "Empty board"; reload and assert grid is still selected; at 390 px the grid has at most 2 columns and no horizontal scroll; Trash still shows the table.

```bash
git add src/dashboard/Dashboard.tsx src/dashboard/dashboard.css
git commit -m "Add a grid view with board previews

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Walkthroughs view and sidebar icons

**Files:**
- Create: `src/dashboard/Walkthroughs.tsx`
- Modify: `src/dashboard/Dashboard.tsx`, `src/board/walkthroughs.tsx`, `src/dashboard/dashboard.css`

**Interfaces:**
- Consumes: `GET /api/recordings` (Task 3); `PlayerDialog` and `Recording` from `src/board/walkthroughs.tsx`; `boardPath`; `Icons.home/clock/star/video/trash`.
- Produces: `export function Walkthroughs({ say }: { say: (msg: string) => void }): JSX.Element`; `PlayerDialog` gains `linkKey?: string | null`.

- [ ] **Step 1: Let `PlayerDialog` play with an explicit key**

In `src/board/walkthroughs.tsx`, add `linkKey` to the props:

```tsx
export function PlayerDialog({
	recording,
	linkKey,
	onDeleted,
	onClose,
}: {
	recording: Recording;
	/** For pages without a key in their address (the dashboard); otherwise the page's key is used. */
	linkKey?: string | null;
	onDeleted: () => void;
	onClose: () => void;
}) {
```

and change the video `src`:

```tsx
src={linkKey ? `/api/recordings/${recording.id}?key=${linkKey}` : withKey(`/api/recordings/${recording.id}`)}
```

- [ ] **Step 2: Create `src/dashboard/Walkthroughs.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { boardPath } from "../board/linkKey";
import { Icons } from "../board/icons";
import { PlayerDialog } from "../board/walkthroughs";

interface MyRecording {
	id: string;
	title: string;
	durationMs: number;
	createdAt: string;
	boardId: string;
	boardName: string;
	playable: boolean;
	boardKey: string | null;
}

const clock = (ms: number) => {
	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Every walkthrough you've recorded, on any board, with your free-plan slots. */
export function Walkthroughs({ say }: { say: (msg: string) => void }) {
	const [data, setData] = useState<{ items: MyRecording[]; used: number; limit: number } | null>(null);
	const [failed, setFailed] = useState(false);
	const [playing, setPlaying] = useState<MyRecording | null>(null);

	const load = useCallback(async () => {
		setFailed(false);
		try {
			const res = await fetch("/api/recordings");
			if (!res.ok) throw new Error();
			setData(await res.json());
		} catch {
			setFailed(true);
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	const remove = async (r: MyRecording) => {
		if (!window.confirm(`Delete “${r.title}”? This frees a walkthrough slot.`)) return;
		const res = await fetch(`/api/recordings/${r.id}`, { method: "DELETE" });
		if (!res.ok) {
			say("Couldn't delete the walkthrough.");
			return;
		}
		setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== r.id), used: d.used - 1 } : d));
		say("Walkthrough deleted.");
	};

	if (failed) {
		return (
			<div className="dash-empty">
				<p>Couldn't load your walkthroughs.</p>
				<button type="button" className="ghost-btn" onClick={load}>
					Retry
				</button>
			</div>
		);
	}
	if (!data) return <div className="dash-skeleton" aria-busy="true" aria-label="Loading walkthroughs" />;

	return (
		<>
			<div className="walk-quota" role="img" aria-label={`${data.used} of ${data.limit} free walkthroughs used`}>
				<span className="walk-quota-bar">
					<span style={{ width: `${Math.min(100, (data.used / data.limit) * 100)}%` }} />
				</span>
				<span>
					{data.used} of {data.limit} free walkthroughs used
				</span>
			</div>
			{data.items.length === 0 ? (
				<div className="dash-empty">
					<p>No walkthroughs yet.</p>
					<p>Open a board and press the video button to record one.</p>
				</div>
			) : (
				<table className="dash-table">
					<thead>
						<tr>
							<th scope="col">Title</th>
							<th scope="col">Board</th>
							<th scope="col">Length</th>
							<th scope="col" className="col-owner">Recorded</th>
							<th scope="col" className="col-actions">
								<span className="sr-only">Actions</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{data.items.map((r) => (
							<tr key={r.id}>
								<td>
									<strong>{r.title}</strong>
								</td>
								<td>
									{r.playable ? (
										<a className="text-link" href={boardPath(r.boardId, r.boardKey)}>
											{r.boardName}
										</a>
									) : (
										<span className="muted">Board unavailable</span>
									)}
								</td>
								<td>{clock(r.durationMs)}</td>
								<td className="col-owner">{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
								<td className="col-actions walk-actions">
									{r.playable && (
										<button type="button" className="icon-btn" aria-label={`Play ${r.title}`} onClick={() => setPlaying(r)}>
											<Icons.video />
										</button>
									)}
									<button type="button" className="icon-btn" aria-label={`Delete ${r.title}`} onClick={() => remove(r)}>
										<Icons.trash />
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			{playing && (
				<PlayerDialog
					recording={{ id: playing.id, title: playing.title, durationMs: playing.durationMs, createdAt: playing.createdAt, authorName: "You", canDelete: true }}
					linkKey={playing.boardKey}
					onDeleted={() => {
						setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== playing.id), used: d.used - 1 } : d));
						setPlaying(null);
					}}
					onClose={() => setPlaying(null)}
				/>
			)}
		</>
	);
}
```

- [ ] **Step 3: Sidebar icons and the new view in `Dashboard.tsx`**

1. `type View = "home" | "recent" | "starred" | "walkthroughs" | "trash";`, and `VIEW_TITLE.walkthroughs = "Your walkthroughs"`; `viewFromUrl` accepts `"walkthroughs"`.
2. Sidebar nav: replace the label ternary with a table and render the icon:
   ```tsx
   const NAV: { view: View; label: string; icon: () => ReactNode }[] = [
   	{ view: "home", label: "Home", icon: Icons.home },
   	{ view: "recent", label: "Recent", icon: Icons.clock },
   	{ view: "starred", label: "Starred", icon: Icons.star },
   	{ view: "walkthroughs", label: "Walkthroughs", icon: Icons.video },
   	{ view: "trash", label: "Trash", icon: Icons.trash },
   ];
   ```
   (top level of the file), and in the nav:
   ```tsx
   {NAV.map((n) => (
   	<button key={n.view} type="button" data-active={view === n.view || undefined} onClick={() => go(n.view)}>
   		{n.icon()}
   		<span>{n.label}</span>
   		{rows && n.view !== "walkthroughs" && <span className="dash-count">{counts[n.view as Exclude<View, "walkthroughs">]}</span>}
   	</button>
   ))}
   ```
3. In `<main>`, when `view === "walkthroughs"`, render the heading and `<Walkthroughs say={say} />` instead of the boards section:
   ```tsx
   {view === "walkthroughs" ? (
   	<section className="dash-boards" aria-label="Your walkthroughs">
   		<div className="dash-boards-head">
   			<h1>
   				<Accented text={VIEW_TITLE.walkthroughs} />
   			</h1>
   		</div>
   		<Walkthroughs say={say} />
   	</section>
   ) : (
   	…the existing boards <section>…
   )}
   ```
4. `useSummaries` must be disabled in walkthroughs too: `useSummaries(Boolean(session.user) && view !== "trash" && view !== "walkthroughs")`.

- [ ] **Step 4: Styles**

```css
.dash-nav button svg {
	width: 18px;
	height: 18px;
	flex: none;
	color: var(--ink-soft);
}

.dash-nav button[data-active] svg {
	color: var(--teal);
}

.walk-quota {
	display: flex;
	align-items: center;
	gap: 12px;
	margin: 0 0 18px;
	color: var(--ink-soft);
	font-size: 14px;
}

.walk-quota-bar {
	width: 160px;
	height: 6px;
	border-radius: 999px;
	background: var(--chrome-line);
	overflow: hidden;
}

.walk-quota-bar > span {
	display: block;
	height: 100%;
	background: var(--teal);
}

.walk-actions {
	white-space: nowrap;
}
```

Check `.dash-nav button` is a flex row with a gap in `dashboard.css`; if it isn't, add `display: flex; align-items: center; gap: 10px;` to `.dash-nav button` and keep `.dash-count` pushed right with `margin-left: auto`.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc -b && npx eslint . && npm run build && npm test` → each exit 0.

Browser check: mock `/api/recordings` with 3 items (one `playable: false`); open **Walkthroughs** from the sidebar; assert the quota reads "3 of 5 free walkthroughs used", the unplayable one shows "Board unavailable" and has no Play button, clicking Play opens the video dialog with `src` ending in `?key=<boardKey>` for the linked one; make the mock fail and assert the Retry button appears and reloads; every sidebar item has an icon.

```bash
git add src/dashboard/Walkthroughs.tsx src/dashboard/Dashboard.tsx src/board/walkthroughs.tsx src/dashboard/dashboard.css
git commit -m "Add a walkthroughs view and sidebar icons to the dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Whole-branch verification and pull request

**Files:** none new.

- [ ] **Step 1: Full checks by exit code**

```bash
npx tsc -b; echo "tsc $?"
npx eslint .; echo "lint $?"
npm run build >/dev/null; echo "build $?"
npm test >/dev/null; echo "test $?"
TEST_DATABASE_URL=postgres://test:test@127.0.0.1:55432/postgres npx vitest run >/dev/null; echo "db tests $?"
npx wrangler deploy --dry-run >/dev/null; echo "dry-run $?"
```

Expected: every line ends in `0`.

- [ ] **Step 2: Re-run every browser check from Tasks 5–7 together, plus the existing smoke checks** (all pages load without errors, no horizontal scroll at 390 px), and take screenshots of the list view, grid view, and walkthroughs view at 1440 px and 390 px to look at.

- [ ] **Step 3: Push and open a PR** titled "Dashboard: board icons, live presence, grid previews, open threads, walkthroughs", with the spec linked, a Testing section listing the commands and browser checks with their results, the note that there's **no database migration** in this change, and the trailer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
