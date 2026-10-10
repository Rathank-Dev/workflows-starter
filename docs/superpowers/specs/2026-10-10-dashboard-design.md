# Dashboard revamp: board icons, live presence, previews, open threads, walkthroughs

Date: 2026-10-10. Status: approved in conversation (approach C, design parts 1 and 2).

## Goal

Make the dashboard feel as complete and polished as Miro's, with Flowyard's own ideas rather than copies. Success: it looks distinctive, every control works (no placeholder buttons), it stays fast with hundreds of boards, and it fits the existing dark linework style.

Inspired by, not copied from, Miro's dashboard: where Miro gives each board a random emoji, Flowyard's icon is drawn from the board's own shapes; where Miro lists online users, Flowyard also surfaces open comment threads as a to-do signal.

## Scope

In scope, on `/dashboard` only:

1. Flow-glyph board icons
2. "Live now" presence per board
3. Grid view with board previews, and a list/grid toggle
4. Open-threads badge and a "Needs reply" filter
5. Walkthroughs view (all of the user's recordings)
6. Sidebar icons, skeleton loading, phone layout

Out of scope here (later projects, in this order):

- **Board start experience:** welcome card with an assistant prompt on new boards, a template gallery (grow from 5 to about 12 templates), assistant panel polish, board loading skeleton.
- **Sign-up:** "your board is ready" sign-in screen over a blurred preview; email sign-in links (needs `flowyard.dev` registered and an email-sending service); interface languages (which ones to be decided).

## Approach

Each board's Durable Object keeps a small summary of itself; the dashboard asks only for the boards on screen, in batches. Chosen over asking every board on each load (slow and costly with many boards) and over copying summaries into Postgres (extra writes on every save, and live presence can't come from Postgres anyway).

## Data and server

### Board summary (in `BoardDO`)

```ts
interface BoardSummary {
	/** Up to 60 shapes, largest first; positions and sizes normalized to 0..1 of the board's bounds. */
	boxes: { x: number; y: number; w: number; h: number; shape: ShapeKind | "text" | "frame"; color: ColorKey }[];
	/** Up to 80 connectors, as indexes into boxes (both ends must be kept boxes). */
	edges: [from: number, to: number][];
	/** Root comment threads not yet resolved. */
	openThreads: number;
	/** Signed-in people connected now (at most 8), and how many anonymous visitors. */
	live: { people: { id: string; name: string }[]; guests: number };
}
```

- `summarize(board)` is a pure function in `shared/` (unit-tested). It keeps the largest boxes when there are more than 60 and never includes text, labels, or names.
- The shape part is recomputed when the board saves (`saveBoard`) and stored in the object's SQLite next to the document; `openThreads` is counted from the comments table; `live` comes from the open sockets the object already tracks.
- New RPC `getSummary(): Promise<BoardSummary>`. Boards saved before this change compute their summary on first request.

### `POST /api/dashboard/summaries` `{ ids: string[] }`

- Sign-in required. At most 24 ids; each must match the board id pattern. Same-origin and body-size checks as every other POST.
- One SQL query keeps only boards the user could open from the dashboard: owner, member, or a past visit whose key matches the board's current key with link access not `none`; not in the trash. Ids that fail are left out silently, so the endpoint can't confirm that a board exists.
- Calls `getSummary()` on those boards in parallel, with a 2-second timeout per board; a board that fails or times out is omitted.
- Adds `avatarUrl` to `live.people` from the users table in one query.
- Response: `{ summaries: { [id]: BoardSummary } }`.

### `GET /api/recordings`

- Sign-in required. Returns the user's own recordings: id, title, durationMs, createdAt, boardId, boardName, and `playable` (whether the user can still open the board). Plus `used` and `limit` (5).
- Play and delete reuse the existing `/api/recordings/:id` endpoints and their access checks.

### Privacy

"Live now" shows who is on a board only to people who can already open it; the board itself already shows them ("3 people here"). Summaries carry layout and colors only, never text.

## Screens

### Board icon

A 32 px tile in the canvas color with the board's shapes drawn small in their board colors (rectangles, pills, diamonds, cylinders, notes; frames as outlines). An empty board shows a dashed outline. While its summary loads, the tile shimmers. Decorative (`aria-hidden`).

### List view (one row per board)

| Icon | Name | Live now | Last opened | Owner | ☆ | ⋯ |
| --- | --- | --- | --- | --- | --- | --- |

- Name, with "Updated …" below and, when there are any, an open-threads badge (speech bubble and count).
- Live now: up to 3 stacked avatars plus "+N", with a pulsing green dot when anyone is there. Accessible label such as "Ada and 2 others are here".

### Grid view

Toggle beside the sort control; the choice is remembered in this browser (`localStorage`, wrapped in try/catch). Cards show a large preview drawn from the summary (boxes plus straight connector lines between box centers), the name and owner beneath, live avatars in a corner, and the threads badge.

### Filters

Next to "Owned by": **Show: All boards / Needs reply**. "Needs reply" lists boards with open threads; it uses summaries already loaded and fetches the rest of the list's summaries (in batches of 24) when chosen.

### Sidebar

Icons for Home, Recent, Starred, **Walkthroughs** (new), and Trash, with counts as today.

### Walkthroughs view

- "3 of 5 free walkthroughs used" bar.
- Table: title, board (link), duration, recorded date, Play (opens the existing player dialog), Delete.
- Recordings on boards the user can no longer open show "Board unavailable": no Play, Delete still works.

### Loading and refresh

- Skeleton rows replace "Loading your boards…".
- Summaries are fetched for rows as they scroll into view (IntersectionObserver), in batches of up to 24.
- Live data refreshes every 30 s while the tab is visible.

### Phone (under 720 px)

Live now and Owner columns hide; the grid shows one or two columns.

## Errors

- A failed or missing summary: the row keeps a plain icon and no live data; no error message.
- Walkthroughs list fails: the view says so and offers Retry.
- Summaries endpoint returns 401 (signed out meanwhile): the dashboard shows its sign-in screen, as it does for the board list.

## Testing

- Unit: `summarize()` picks the largest boxes, respects the 60-box and 80-edge limits, drops edges to removed boxes, normalizes positions, and contains no text.
- Durable Object: `getSummary()` includes open threads and live people (signed-in and guest).
- Database (`test/db.test.ts`): the summaries endpoint omits trashed boards, boards whose link was reset, and other people's boards, and rejects more than 24 ids; the recordings endpoint returns only the caller's recordings, with `playable` correct.
- Browser: list and grid views, the toggle remembered, the Needs reply filter, skeleton loading, the walkthroughs view, and the phone layout.
