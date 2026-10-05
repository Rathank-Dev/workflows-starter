export { BoardDO } from "./board-do";

const BOARD_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Main Worker fetch handler
 *
 * - GET /api/board/:id - Read a board (null doc if never saved)
 * - PUT /api/board/:id - Replace a board
 * - GET /ws?board=:id  - WebSocket for live edits on a board
 */
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/api/board/")) {
			const id = url.pathname.slice("/api/board/".length);
			if (!BOARD_ID.test(id)) {
				return Response.json({ error: "Board id can use letters, numbers, - and _ only." }, { status: 400 });
			}
			const stub = env.BOARD.get(env.BOARD.idFromName(id));

			if (request.method === "GET") {
				return Response.json(await stub.getBoard());
			}
			if (request.method === "PUT") {
				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return Response.json({ error: "Body must be JSON." }, { status: 400 });
				}
				const rev = await stub.saveBoard(body);
				if (rev === null) {
					return Response.json({ error: "Board is malformed or too large." }, { status: 422 });
				}
				return Response.json({ rev });
			}
			return Response.json({ error: "Method not allowed" }, { status: 405 });
		}

		if (url.pathname === "/ws") {
			const id = url.searchParams.get("board") ?? "";
			if (!BOARD_ID.test(id)) {
				return new Response("board query parameter required", { status: 400 });
			}
			if (request.headers.get("Upgrade") !== "websocket") {
				return new Response("Expected Upgrade: websocket", { status: 426 });
			}
			return env.BOARD.get(env.BOARD.idFromName(id)).fetch(request);
		}

		return Response.json({ error: "Not Found" }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
