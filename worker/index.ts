import { MAX_DOC_BYTES, parseBoard } from "../shared/board";
import { handleAi } from "./ai";
import { availableProviders } from "./ai-providers";
import { currentUser, enabledProviders, finishLogin, logout, startLogin } from "./auth";
import { connect, type Sql } from "./db";
import { SECURITY_HEADERS, error, json, randomHex, sameOrigin } from "./http";

export { BoardDO } from "./board-do";

const BOARD_ID = /^[a-f0-9]{32}$/;
const BOARDS_PER_DAY = 30;
/** Largest request body any route accepts: a full board plus JSON overhead. */
const MAX_BODY_BYTES = MAX_DOC_BYTES + 64 * 1024;

/** Adds the standard headers to responses that don't set them (redirects, plain text). */
function withSecurityHeaders(res: Response): Response {
	if (res.status === 101 || res.webSocket) return res;
	const out = new Response(res.body, res);
	for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
	return out;
}

/** True when this caller is over the limit. Missing bindings (some test setups) never limit. */
async function limited(limiter: RateLimit | undefined, key: string): Promise<boolean> {
	if (!limiter) return false;
	const { success } = await limiter.limit({ key });
	return !success;
}

/**
 * Routes
 *
 * Auth
 * - GET  /auth/login/:provider     Start GitHub / Google / Discord sign-in
 * - GET  /auth/callback/:provider  Provider redirects back here
 * - POST /auth/logout
 * - GET  /api/me                   Signed-in user, available providers, assistant status
 *
 * Boards (content in BoardDO, ownership in Postgres)
 * - POST   /api/boards       Create a shared board from a local one (sign-in required)
 * - GET    /api/boards       Boards you own (sign-in required)
 * - PATCH  /api/boards/:id   Rename (owner only)
 * - DELETE /api/boards/:id   Delete (owner only)
 * - GET    /ws?board=:id     Live editing; anyone with the link
 *
 * Assistant
 * - POST /api/ai             Sign-in required
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (path.startsWith("/api/") || path.startsWith("/auth/") || path === "/ws") {
			const ip = request.headers.get("CF-Connecting-IP") ?? "local";
			if (await limited(env.REQUEST_LIMITER, ip)) {
				return withSecurityHeaders(
					error("Too many requests. Wait a minute and try again.", 429, { "Retry-After": "60" }),
				);
			}
		}

		if (path.startsWith("/auth/login/") && request.method === "GET") {
			return withSecurityHeaders(startLogin(request, env, path.slice("/auth/login/".length)));
		}

		if (request.method !== "GET" && request.method !== "HEAD") {
			if (!sameOrigin(request)) return error("Cross-site request blocked.", 403);
			// Refuse oversized bodies before anything buffers them
			const length = Number(request.headers.get("Content-Length") ?? "0");
			if (!Number.isFinite(length) || length > MAX_BODY_BYTES) return error("Request is too large.", 413);
		}

		let sql: Sql | null = null;
		const db = () => (sql ??= connect(env));
		try {
			return withSecurityHeaders(await route(request, env, url, db));
		} catch (err) {
			console.error("Unhandled error", path, err);
			return error("Something went wrong on the server. Try again.", 500);
		} finally {
			if (sql) ctx.waitUntil((sql as Sql).end({ timeout: 5 }));
		}
	},
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL, db: () => Sql): Promise<Response> {
	const path = url.pathname;
	const method = request.method;

	if (path.startsWith("/auth/callback/") && method === "GET") {
		return finishLogin(request, env, db(), path.slice("/auth/callback/".length));
	}
	if (path === "/auth/logout" && method === "POST") {
		return logout(request, db());
	}

	if (path === "/api/me" && method === "GET") {
		const user = await currentUser(request, db());
		return json(
			{
				user: user && { id: user.id, name: user.name, avatarUrl: user.avatar_url },
				providers: enabledProviders(env),
				// Providers the assistant can use: [{ id, label, model }]
				assistant: availableProviders(env),
			},
			200,
			{ "Cache-Control": "no-store" },
		);
	}

	if (path === "/api/boards") {
		const user = await currentUser(request, db());
		if (!user) return error("Sign in to share boards.", 401);

		if (method === "GET") {
			const boards = await db()<{ id: string; name: string; updated_at: Date }[]>`
				select id, name, updated_at from boards where owner_id = ${user.id}
				order by updated_at desc limit 200
			`;
			return json({ boards });
		}
		if (method === "POST") {
			const text = await request.text();
			if (text.length > MAX_DOC_BYTES + 1024) return error("Board is too large to share.", 413);
			let body: unknown;
			try {
				body = JSON.parse(text);
			} catch {
				return error("Body must be JSON.", 400);
			}
			const doc = parseBoard((body as { doc?: unknown })?.doc);
			if (!doc) return error("Board is malformed.", 422);

			const [{ n }] = await db()<{ n: number }[]>`
				select count(*)::int as n from boards
				where owner_id = ${user.id} and created_at > now() - interval '1 day'
			`;
			if (n >= BOARDS_PER_DAY) {
				return error(`You can share up to ${BOARDS_PER_DAY} new boards a day. Try again tomorrow.`, 429);
			}

			const id = randomHex(16);
			await db()`insert into boards (id, owner_id, name) values (${id}, ${user.id}, ${doc.name})`;
			const rev = await env.BOARD.get(env.BOARD.idFromName(id)).saveBoard(doc);
			if (rev === null) {
				await db()`delete from boards where id = ${id}`;
				return error("Board is malformed or too large.", 422);
			}
			return json({ id }, 201);
		}
		return error("Method not allowed", 405);
	}

	if (path.startsWith("/api/boards/")) {
		const id = path.slice("/api/boards/".length);
		if (!BOARD_ID.test(id)) return error("Board not found.", 404);
		const user = await currentUser(request, db());
		if (!user) return error("Sign in first.", 401);

		if (method === "PATCH") {
			const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
			const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
			if (!name) return error("Give the board a name.", 400);
			const rows = await db()`
				update boards set name = ${name}, updated_at = now()
				where id = ${id} and owner_id = ${user.id} returning id
			`;
			return rows.length ? json({ ok: true }) : error("Only the board's owner can rename it.", 403);
		}
		if (method === "DELETE") {
			const rows = await db()`delete from boards where id = ${id} and owner_id = ${user.id} returning id`;
			if (!rows.length) return error("Only the board's owner can delete it.", 403);
			await env.BOARD.get(env.BOARD.idFromName(id)).deleteBoard();
			return json({ ok: true });
		}
		return error("Method not allowed", 405);
	}

	if (path === "/api/ai" && method === "POST") {
		const user = await currentUser(request, db());
		if (!user) return error("Sign in to use the assistant.", 401);
		if (await limited(env.AI_LIMITER, user.id)) {
			return error("You're sending requests quickly. Wait a few seconds and try again.", 429, { "Retry-After": "10" });
		}
		return handleAi(request, env, db(), user);
	}

	if (path === "/ws") {
		const id = url.searchParams.get("board") ?? "";
		if (!BOARD_ID.test(id)) return new Response("Board not found", { status: 404 });
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected Upgrade: websocket", { status: 426 });
		}
		// Only boards someone signed in to create can be opened live.
		const [row] = await db()`select 1 from boards where id = ${id}`;
		if (!row) return new Response("Board not found", { status: 404 });
		await db()`update boards set updated_at = now() where id = ${id}`;
		return env.BOARD.get(env.BOARD.idFromName(id)).fetch(request);
	}

	return error("Not Found", 404);
}
