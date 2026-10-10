import { DurableObject } from "cloudflare:workers";
import { MAX_DOC_BYTES, parseBoard, type Board } from "../shared/board";
import { parseCommentOp, type BoardComment, MAX_COMMENTS } from "../shared/comments";
import type { Role } from "./access";

/**
 * BoardDO - one instance per board.
 *
 * - Stores the board document in SQLite (values can exceed the 128 KiB KV limit)
 * - Accepts WebSockets with the hibernation API
 * - Saves updates from one client and relays them to everyone else
 * - Keeps comment threads in their own table, so document saves never drop them
 * - Relays live cursors between sockets without storing them
 *
 * Conflicts resolve as last write wins for the whole document.
 *
 * The Worker decides who may connect and passes the result in headers it sets
 * itself (ROLE_HEADER and friends); this object trusts them and nothing else.
 */
/** Per-connection write budget: a steady 10 saves a second, bursts up to 30. */
const WRITE_RATE = 10;
const WRITE_BURST = 30;
/** Cursor moves per socket: clients send about 20 a second; extras are dropped silently. */
const CURSOR_RATE = 30;
const CURSOR_BURST = 60;
/** Cursors further out than this are junk, not a place on the board. */
const CURSOR_LIMIT = 1_000_000;
/** Open sockets allowed per board; each save is re-sent to all of them. */
export const MAX_CONNECTIONS = 50;
/**
 * Per IP address, so one person can't take every slot. High enough for a
 * team sharing an office network.
 */
export const MAX_CONNECTIONS_PER_IP = 10;

export const ROLE_HEADER = "X-Flowyard-Role";
export const USER_HEADER = "X-Flowyard-User";
export const NAME_HEADER = "X-Flowyard-Name";

/** Who is on the other end of a socket. Survives hibernation. */
interface Peer {
	role: Role;
	userId: string | null;
	name: string | null;
	/** Short per-socket id for cursors. Missing on sockets from before cursors existed. */
	sid?: string;
}

function peerOf(ws: WebSocket): Peer {
	const p = ws.deserializeAttachment() as Peer | null;
	// Sockets from before roles existed can only look
	return p ?? { role: "view", userId: null, name: null };
}

/** Token bucket: refills at `rate` a second up to `burst`. Returns whether one token was taken. */
function take(
	buckets: WeakMap<WebSocket, { tokens: number; at: number }>,
	ws: WebSocket,
	rate: number,
	burst: number,
): boolean {
	const now = Date.now();
	const b = buckets.get(ws) ?? { tokens: burst, at: now };
	b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
	b.at = now;
	const ok = b.tokens >= 1;
	if (ok) b.tokens -= 1;
	buckets.set(ws, b);
	return ok;
}

function send(ws: WebSocket, data: unknown): void {
	try {
		ws.send(JSON.stringify(data));
	} catch {
		// Socket already closed
	}
}

export class BoardDO extends DurableObject<Env> {
	private sql: SqlStorage;
	/** Token buckets per socket. In memory only: hibernation resets them, which is fine. */
	private buckets = new WeakMap<WebSocket, { tokens: number; at: number }>();
	private cursorBuckets = new WeakMap<WebSocket, { tokens: number; at: number }>();

	private allowWrite(ws: WebSocket): boolean {
		return take(this.buckets, ws, WRITE_RATE, WRITE_BURST);
	}

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.ensureTable();
	}

	private ensureTable(): void {
		this.sql.exec(
			"CREATE TABLE IF NOT EXISTS board (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL, rev INTEGER NOT NULL)",
		);
		this.sql.exec(
			`CREATE TABLE IF NOT EXISTS comments (
				id TEXT PRIMARY KEY, parent TEXT, x REAL NOT NULL, y REAL NOT NULL, text TEXT NOT NULL,
				author_id TEXT NOT NULL, author_name TEXT NOT NULL, at INTEGER NOT NULL, resolved INTEGER NOT NULL DEFAULT 0
			)`,
		);
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket", { status: 426 });
		}
		if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) {
			return new Response("This board has too many open connections.", { status: 429 });
		}
		// The Worker forwards the original request, so Cloudflare's client IP header is intact
		const ipTag = `ip:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`.slice(0, 200);
		if (this.ctx.getWebSockets(ipTag).length >= MAX_CONNECTIONS_PER_IP) {
			return new Response("Too many open connections to this board from your network.", { status: 429 });
		}
		const role = request.headers.get(ROLE_HEADER);
		if (role !== "owner" && role !== "edit" && role !== "view") {
			return new Response("Forbidden", { status: 403 });
		}
		const userId = request.headers.get(USER_HEADER);
		const rawName = request.headers.get(NAME_HEADER);
		const peer: Peer = {
			role,
			userId: userId || null,
			name: rawName ? decodeURIComponent(rawName).slice(0, 120) : null,
			sid: crypto.randomUUID().slice(0, 8),
		};

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server, [ipTag]);
		server.serializeAttachment(peer);

		const { doc, rev } = this.read();
		server.send(JSON.stringify({ type: "hello", role, canComment: peer.userId !== null }));
		server.send(JSON.stringify({ type: "doc", doc, rev }));
		server.send(JSON.stringify({ type: "comments", items: this.comments() }));
		this.broadcastPresence();

		return new Response(null, { status: 101, webSocket: client });
	}

	/** Returns the stored board, or null if nothing has been saved yet. */
	async getBoard(): Promise<{ doc: Board | null; rev: number }> {
		return this.read();
	}

	/** Validates and saves a board. Returns the new revision, or null if rejected. */
	async saveBoard(input: unknown): Promise<number | null> {
		const board = parseBoard(input);
		if (!board) return null;
		const json = JSON.stringify(board);
		if (json.length > MAX_DOC_BYTES) return null;
		const rev = this.read().rev + 1;
		this.sql.exec(
			"INSERT INTO board (id, doc, rev) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, rev = excluded.rev",
			json,
			rev,
		);
		return rev;
	}

	/**
	 * Sharing changed: drop everyone except the owner. Their clients reconnect
	 * straight away and the Worker checks their access again.
	 */
	async refreshAccess(): Promise<void> {
		for (const socket of this.ctx.getWebSockets()) {
			if (peerOf(socket).role === "owner") continue;
			try {
				socket.close(4001, "Access changed");
			} catch {
				// Already closed
			}
		}
	}

	/**
	 * The person's sessions were revoked (signed out everywhere, or account
	 * deleted): drop their sockets, the owner's too. Their clients reconnect
	 * and the Worker checks access again without the old session.
	 */
	async disconnectUser(userId: string): Promise<void> {
		for (const socket of this.ctx.getWebSockets()) {
			if (peerOf(socket).userId !== userId) continue;
			try {
				socket.close(4001, "Signed out");
			} catch {
				// Already closed
			}
		}
	}

	/** Disconnects everyone viewing (board moved to trash). Content is kept for restore. */
	async disconnectAll(): Promise<void> {
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(JSON.stringify({ type: "deleted" }));
				socket.close(4404, "Board moved to trash");
			} catch {
				// Already closed
			}
		}
	}

	/** Erases the board and disconnects everyone viewing it. */
	async deleteBoard(): Promise<void> {
		for (const socket of this.ctx.getWebSockets()) {
			try {
				// Say so explicitly too: proxies don't always pass close codes through.
				socket.send(JSON.stringify({ type: "deleted" }));
				socket.close(4404, "Board deleted");
			} catch {
				// Already closed
			}
		}
		await this.ctx.storage.deleteAll();
		this.ensureTable();
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message !== "string" || message.length > MAX_DOC_BYTES + 1024) {
			ws.send(JSON.stringify({ type: "error", message: "Board is too large to save." }));
			return;
		}
		let data: unknown;
		try {
			data = JSON.parse(message);
		} catch {
			return;
		}
		if (typeof data !== "object" || data === null) return;
		const type = (data as { type?: unknown }).type;
		if (typeof type === "string" && type.startsWith("comment:")) {
			this.onComment(ws, data);
			return;
		}
		if (type === "cursor") {
			this.onCursor(ws, data as { x?: unknown; y?: unknown });
			return;
		}
		if (type !== "update") return;

		const peer = peerOf(ws);
		if (peer.role !== "owner" && peer.role !== "edit") {
			send(ws, { type: "error", message: "You can view this board but not edit it." });
			return;
		}
		if (!this.allowWrite(ws)) {
			ws.send(JSON.stringify({ type: "error", message: "Edits are arriving too fast. Some were skipped; keep going and they'll catch up." }));
			return;
		}
		const doc = (data as { doc?: unknown }).doc;
		const rev = await this.saveBoard(doc);
		if (rev === null) {
			ws.send(JSON.stringify({ type: "error", message: "Board was rejected because it is malformed." }));
			return;
		}
		const out = JSON.stringify({ type: "doc", doc: parseBoard(doc), rev });
		for (const socket of this.ctx.getWebSockets()) {
			if (socket === ws) continue;
			try {
				socket.send(out);
			} catch {
				// Socket already closed
			}
		}
		ws.send(JSON.stringify({ type: "ack", rev }));
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		// 1005/1006/1015 describe how a socket closed and may not be sent back
		const sendable = code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000;
		try {
			ws.close(sendable, reason);
		} catch {
			// Already closed
		}
		this.broadcastPresence(ws);
		const { sid } = peerOf(ws);
		if (sid) this.broadcast({ type: "cursor:gone", id: sid }, ws);
	}

	/** `{x, y}` in board coordinates moves this socket's cursor; `{x: null}` hides it. */
	private onCursor(ws: WebSocket, data: { x?: unknown; y?: unknown }): void {
		const peer = peerOf(ws);
		if (!peer.sid) return;
		const { x, y } = data;
		const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= CURSOR_LIMIT;
		const hide = x === null;
		if (!hide && (!valid(x) || !valid(y))) return;
		// Hides fan out to everyone too, so they share the budget
		if (!take(this.cursorBuckets, ws, CURSOR_RATE, CURSOR_BURST)) return;
		if (hide) {
			this.broadcast({ type: "cursor:gone", id: peer.sid }, ws);
			return;
		}
		this.broadcast({ type: "cursor", id: peer.sid, name: peer.name, x, y }, ws);
	}

	private onComment(ws: WebSocket, data: object): void {
		const peer = peerOf(ws);
		if (!peer.userId || !peer.name) {
			send(ws, { type: "error", message: "Sign in to comment." });
			return;
		}
		if (!this.allowWrite(ws)) {
			send(ws, { type: "error", message: "Slow down a little; that comment wasn't saved." });
			return;
		}
		const op = parseCommentOp(data);
		if (!op) {
			send(ws, { type: "error", message: "That comment couldn't be saved." });
			return;
		}
		if (op.type === "comment:add" || op.type === "comment:reply") {
			const [{ n }] = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM comments").toArray();
			if (n >= MAX_COMMENTS) {
				send(ws, { type: "error", message: "This board has reached its comment limit. Resolve and delete old threads to add more." });
				return;
			}
			let x = 0;
			let y = 0;
			let parent: string | null = null;
			if (op.type === "comment:reply") {
				const thread = this.comment(op.parent);
				if (!thread || thread.parent !== null) {
					send(ws, { type: "error", message: "That thread was deleted." });
					return;
				}
				parent = thread.id;
				x = thread.x;
				y = thread.y;
			} else {
				x = op.x;
				y = op.y;
			}
			const c: BoardComment = {
				id: crypto.randomUUID(),
				parent,
				x,
				y,
				text: op.text,
				authorId: peer.userId,
				authorName: peer.name,
				at: Date.now(),
				resolved: false,
			};
			this.sql.exec(
				"INSERT INTO comments (id, parent, x, y, text, author_id, author_name, at, resolved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
				c.id,
				c.parent,
				c.x,
				c.y,
				c.text,
				c.authorId,
				c.authorName,
				c.at,
			);
			this.broadcast({ type: "comment", comment: c });
			return;
		}
		const target = this.comment(op.id);
		if (!target) return;
		if (op.type === "comment:resolve") {
			if (target.parent !== null) return;
			this.sql.exec("UPDATE comments SET resolved = ? WHERE id = ?", op.resolved ? 1 : 0, target.id);
			this.broadcast({ type: "comment", comment: { ...target, resolved: op.resolved } });
			return;
		}
		if (op.type === "comment:move") {
			if (target.parent !== null || (target.authorId !== peer.userId && peer.role !== "owner")) return;
			this.sql.exec("UPDATE comments SET x = ?, y = ? WHERE id = ? OR parent = ?", op.x, op.y, target.id, target.id);
			for (const c of this.comments().filter((c) => c.id === target.id || c.parent === target.id)) {
				this.broadcast({ type: "comment", comment: c });
			}
			return;
		}
		// Delete: the author, or the board owner. Deleting a thread removes its replies.
		if (target.authorId !== peer.userId && peer.role !== "owner") {
			send(ws, { type: "error", message: "Only the comment's author or the board owner can delete it." });
			return;
		}
		const ids = this.sql
			.exec<{ id: string }>("SELECT id FROM comments WHERE id = ? OR parent = ?", target.id, target.id)
			.toArray()
			.map((r) => r.id);
		this.sql.exec("DELETE FROM comments WHERE id = ? OR parent = ?", target.id, target.id);
		this.broadcast({ type: "comment:removed", ids });
	}

	private comment(id: string): BoardComment | null {
		return this.comments(id)[0] ?? null;
	}

	private comments(id?: string): BoardComment[] {
		const rows = (
			id
				? this.sql.exec<CommentRow>("SELECT * FROM comments WHERE id = ?", id)
				: this.sql.exec<CommentRow>("SELECT * FROM comments ORDER BY at")
		).toArray();
		return rows.map((r) => ({
			id: r.id,
			parent: r.parent,
			x: r.x,
			y: r.y,
			text: r.text,
			authorId: r.author_id,
			authorName: r.author_name,
			at: r.at,
			resolved: r.resolved === 1,
		}));
	}

	/** Sends to every open socket, except `skip` when given. */
	private broadcast(data: unknown, skip?: WebSocket): void {
		const msg = JSON.stringify(data);
		for (const socket of this.ctx.getWebSockets()) {
			if (socket === skip) continue;
			try {
				socket.send(msg);
			} catch {
				// Socket already closed
			}
		}
	}

	private read(): { doc: Board | null; rev: number } {
		const row = this.sql.exec<{ doc: string; rev: number }>("SELECT doc, rev FROM board WHERE id = 1").toArray()[0];
		if (!row) return { doc: null, rev: 0 };
		return { doc: JSON.parse(row.doc) as Board, rev: row.rev };
	}

	private broadcastPresence(closing?: WebSocket): void {
		const sockets = this.ctx.getWebSockets().filter((s) => s !== closing && s.readyState === WebSocket.OPEN);
		// Signed-in people by name, once each, for "here now"
		const people = new Map<string, string>();
		for (const s of sockets) {
			const p = peerOf(s);
			if (p.userId && p.name) people.set(p.userId, p.name);
		}
		const msg = JSON.stringify({
			type: "presence",
			count: sockets.length,
			people: Array.from(people, ([id, name]) => ({ id, name })).slice(0, 50),
		});
		for (const socket of sockets) {
			try {
				socket.send(msg);
			} catch {
				// Socket already closed
			}
		}
	}
}

type CommentRow = {
	id: string;
	parent: string | null;
	x: number;
	y: number;
	text: string;
	author_id: string;
	author_name: string;
	at: number;
	resolved: number;
};
