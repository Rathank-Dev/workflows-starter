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
export class BoardDO extends DurableObject<Env> {
	private sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.sql.exec(
			"CREATE TABLE IF NOT EXISTS board (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL, rev INTEGER NOT NULL)",
		);
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket", { status: 426 });
		}
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server);

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
		ws.close(code, reason);
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
