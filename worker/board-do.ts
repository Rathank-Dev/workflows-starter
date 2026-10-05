import { DurableObject } from "cloudflare:workers";
import { MAX_DOC_BYTES, parseBoard, type Board } from "../shared/board";

/**
 * BoardDO - one instance per board.
 *
 * - Stores the board document in SQLite (values can exceed the 128 KiB KV limit)
 * - Accepts WebSockets with the hibernation API
 * - Saves updates from one client and relays them to everyone else
 *
 * Conflicts resolve as last write wins for the whole document.
 */
/** Per-connection write budget: a steady 10 saves a second, bursts up to 30. */
const WRITE_RATE = 10;
const WRITE_BURST = 30;
/** Open sockets allowed per board; each save is re-sent to all of them. */
export const MAX_CONNECTIONS = 50;
/**
 * Per IP address, so one person can't take every slot. High enough for a
 * team sharing an office network.
 */
export const MAX_CONNECTIONS_PER_IP = 10;

export class BoardDO extends DurableObject<Env> {
	private sql: SqlStorage;
	/** Token buckets per socket. In memory only: hibernation resets them, which is fine. */
	private buckets = new WeakMap<WebSocket, { tokens: number; at: number }>();

	private allowWrite(ws: WebSocket): boolean {
		const now = Date.now();
		const b = this.buckets.get(ws) ?? { tokens: WRITE_BURST, at: now };
		b.tokens = Math.min(WRITE_BURST, b.tokens + ((now - b.at) / 1000) * WRITE_RATE);
		b.at = now;
		const ok = b.tokens >= 1;
		if (ok) b.tokens -= 1;
		this.buckets.set(ws, b);
		return ok;
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
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server, [ipTag]);

		const { doc, rev } = this.read();
		server.send(JSON.stringify({ type: "doc", doc, rev }));
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
		if (typeof data !== "object" || data === null || (data as { type?: unknown }).type !== "update") return;

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
	}

	private read(): { doc: Board | null; rev: number } {
		const row = this.sql.exec<{ doc: string; rev: number }>("SELECT doc, rev FROM board WHERE id = 1").toArray()[0];
		if (!row) return { doc: null, rev: 0 };
		return { doc: JSON.parse(row.doc) as Board, rev: row.rev };
	}

	private broadcastPresence(closing?: WebSocket): void {
		const sockets = this.ctx.getWebSockets().filter((s) => s !== closing && s.readyState === WebSocket.OPEN);
		const msg = JSON.stringify({ type: "presence", count: sockets.length });
		for (const socket of sockets) {
			try {
				socket.send(msg);
			} catch {
				// Socket already closed
			}
		}
	}
}
