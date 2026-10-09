import { MAX_DOC_BYTES, parseBoard } from "../shared/board";
import { DAILY_LIMIT, handleAi, remainingUses } from "./ai";
import { publicOptions } from "./ai-providers";
import { currentUser, enabledProviders, finishLogin, logout, startLogin } from "./auth";
import {
	deleteAccount,
	getProfile,
	listDashboard,
	logoutEverywhere,
	restoreBoard,
	setStar,
	trashBoard,
} from "./dashboard";
import { connect, type Sql } from "./db";
import { boardAccess, canEdit } from "./access";
import { NAME_HEADER, ROLE_HEADER, USER_HEADER } from "./board-do";
import {
	MAX_RECORDING_BYTES,
	RECORDING_PATH,
	deleteBoardRecordings,
	deleteRecording,
	listRecordings,
	playRecording,
	uploadRecording,
} from "./recordings";
import { getReferral, referralLanding } from "./referrals";
import { getSharing, joinBoard, resetInvite, updateMember, updateSharing } from "./sharing";
import { SECURITY_HEADERS, error, json, randomHex, sameOrigin } from "./http";

export { BoardDO } from "./board-do";
import { boardStore, purgeDue } from "./account";

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
 * - GET    /ws?board=:id     Live editing, as owner, member, or whatever the link allows
 *
 * Sharing
 * - GET|PATCH    /api/boards/:id/sharing            Link access, invite link, people
 * - POST         /api/boards/:id/invite             New invite link (owner)
 * - POST         /api/boards/:id/join               Accept an invite link
 * - PATCH|DELETE /api/boards/:id/members/:userId    Change a role, remove someone, or leave
 *
 * Walkthroughs (video in R2)
 * - GET|POST   /api/boards/:id/recordings
 * - GET|DELETE /api/recordings/:id
 *
 * Invite rewards
 * - GET /r/:code         Referral link; remembers the inviter
 * - GET /api/referral    Your referral link and count
 *
 * Assistant
 * - POST /api/ai             Sign-in required
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (path.startsWith("/api/") || path.startsWith("/auth/") || path === "/ws" || path.startsWith("/r/")) {
			const ip = request.headers.get("CF-Connecting-IP") ?? "local";
			if (await limited(env.REQUEST_LIMITER, ip)) {
				return withSecurityHeaders(
					error("Too many requests. Wait a minute and try again.", 429, { "Retry-After": "60" }),
				);
			}
		}

		if (path.startsWith("/r/") && request.method === "GET") {
			return withSecurityHeaders(referralLanding(path.slice("/r/".length)));
		}
		if (path.startsWith("/auth/login/") && request.method === "GET") {
			return withSecurityHeaders(startLogin(request, env, path.slice("/auth/login/".length)));
		}

		if (request.method !== "GET" && request.method !== "HEAD") {
			if (!sameOrigin(request)) return error("Cross-site request blocked.", 403);
			// Refuse oversized bodies before anything buffers them. A body without a
			// declared length (chunked upload) can't be checked up front, so refuse it;
			// browsers always send Content-Length for this app's requests.
			const declared = request.headers.get("Content-Length");
			if (request.body !== null && declared === null) return error("Send a Content-Length header.", 411);
			const length = Number(declared ?? "0");
			// Walkthrough videos stream straight to storage, so they get a larger cap
			const cap = request.method === "POST" && RECORDING_PATH.test(path) ? MAX_RECORDING_BYTES : MAX_BODY_BYTES;
			if (!Number.isFinite(length) || length > cap) return error("Request is too large.", 413);
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
	/** Daily (Cron Trigger): finish 30-day account deletions, empty old trash, drop old counters. */
	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		const sql = connect(env);
		try {
			const done = await purgeDue(sql, boardStore(env));
			console.log("Daily cleanup", done);
		} finally {
			ctx.waitUntil(sql.end({ timeout: 5 }));
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
	if (path === "/auth/logout-all" && method === "POST") {
		const user = await currentUser(request, db());
		return user ? logoutEverywhere(db(), env, user) : error("Sign in first.", 401);
	}

	if (path === "/api/dashboard" && method === "GET") {
		const user = await currentUser(request, db());
		return user ? listDashboard(db(), user) : error("Sign in to see your dashboard.", 401);
	}
	if (path === "/api/profile" && method === "GET") {
		const user = await currentUser(request, db());
		return user ? getProfile(db(), user) : error("Sign in to see your profile.", 401);
	}
	if (path === "/api/account" && method === "DELETE") {
		const user = await currentUser(request, db());
		return user ? deleteAccount(request, db(), env, user) : error("Sign in first.", 401);
	}

	if (path === "/api/referral" && method === "GET") {
		const user = await currentUser(request, db());
		return user ? getReferral(request, db(), user) : error("Sign in to get your invite link.", 401);
	}

	// Sharing
	const sharing = path.match(/^\/api\/boards\/([a-f0-9]{32})\/(sharing|invite|join)$/);
	if (sharing) {
		const [, id, verb] = sharing;
		const user = await currentUser(request, db());
		if (verb === "sharing" && method === "GET") return getSharing(request, db(), user, id);
		if (!user) return error("Sign in first.", 401);
		if (verb === "sharing" && method === "PATCH") return updateSharing(request, db(), env, user, id);
		if (verb === "invite" && method === "POST") return resetInvite(request, db(), user, id);
		if (verb === "join" && method === "POST") return joinBoard(request, db(), user, id);
		return error("Method not allowed", 405);
	}
	const member = path.match(/^\/api\/boards\/([a-f0-9]{32})\/members\/([0-9a-f-]{36})$/);
	if (member && (method === "PATCH" || method === "DELETE")) {
		const user = await currentUser(request, db());
		return user ? updateMember(request, db(), env, user, member[1], member[2]) : error("Sign in first.", 401);
	}

	// Walkthroughs
	const recs = path.match(RECORDING_PATH);
	if (recs) {
		const user = await currentUser(request, db());
		if (method === "GET") return listRecordings(db(), user, recs[1]);
		if (method === "POST") {
			return user ? uploadRecording(request, db(), env, user, recs[1]) : error("Sign in to record a walkthrough.", 401);
		}
		return error("Method not allowed", 405);
	}
	const rec = path.match(/^\/api\/recordings\/([a-f0-9]{32})$/);
	if (rec) {
		const user = await currentUser(request, db());
		if (method === "GET") return playRecording(request, db(), env, user, rec[1]);
		if (method === "DELETE") return user ? deleteRecording(db(), env, user, rec[1]) : error("Sign in first.", 401);
		return error("Method not allowed", 405);
	}

	// Board actions: /api/boards/:id/star | trash | restore
	const action = path.match(/^\/api\/boards\/([a-f0-9]{32})\/(star|trash|restore)$/);
	if (action && method === "POST") {
		const user = await currentUser(request, db());
		if (!user) return error("Sign in first.", 401);
		const [, id, verb] = action;
		if (verb === "star") return setStar(request, db(), user, id);
		if (verb === "trash") return trashBoard(db(), env, user, id);
		return restoreBoard(db(), user, id);
	}

	if (path === "/api/me" && method === "GET") {
		const user = await currentUser(request, db());
		return json(
			{
				user: user && { id: user.id, name: user.name, avatarUrl: user.avatar_url },
				// Assistant uses left today for the signed-in user
				aiRemaining: user ? await remainingUses(db(), user.id) : null,
				aiDailyLimit: DAILY_LIMIT,
				providers: enabledProviders(env),
				// Assistant options as neutral ids/labels; provider and model stay server-side
				assistant: publicOptions(env),
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
				select id, name, updated_at from boards where owner_id = ${user.id} and deleted_at is null
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
			// Anyone who can edit can rename (the name is part of the board), so the dashboard stays in step
			if (!canEdit((await boardAccess(db(), id, user)).role)) return error("You can't rename this board.", 403);
			await db()`update boards set name = ${name}, updated_at = now() where id = ${id}`;
			return json({ ok: true });
		}
		if (method === "DELETE") {
			const rows = await db()`delete from boards where id = ${id} and owner_id = ${user.id} returning id`;
			if (!rows.length) return error("Only the board's owner can delete it.", 403);
			await env.BOARD.get(env.BOARD.idFromName(id)).deleteBoard();
			await deleteBoardRecordings(env, id);
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
		return handleAi(request, env, db(), user, request.headers.get("CF-Connecting-IP") ?? "unknown");
	}

	if (path === "/ws") {
		const id = url.searchParams.get("board") ?? "";
		if (!BOARD_ID.test(id)) return new Response("Board not found", { status: 404 });
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected Upgrade: websocket", { status: 426 });
		}
		// Browsers always send Origin on WebSockets; refuse other sites opening one with our cookies
		const origin = request.headers.get("Origin");
		if (origin !== null && origin !== url.origin) return new Response("Cross-site connection blocked", { status: 403 });
		// Only boards someone signed in to create, and not in the trash, open live.
		const visitor = await currentUser(request, db());
		const access = await boardAccess(db(), id, visitor);
		// Say so over the socket: a failed upgrade would just look like being offline
		if (!access.exists) return closedSocket({ type: "deleted" }, 4404, "Board not found");
		if (!access.role) return closedSocket({ type: "denied", signedIn: visitor !== null }, 4403, "No access");
		await db()`update boards set updated_at = now() where id = ${id}`;
		// Remember it for the signed-in visitor's Recent and "Shared with me"
		if (visitor) {
			await db()`
				insert into board_visits (user_id, board_id) values (${visitor.id}, ${id})
				on conflict (user_id, board_id) do update set last_opened_at = now()
			`;
		}
		// Tell the board who this is. Always set (or cleared) here, so a client can't supply its own.
		const headers = new Headers(request.headers);
		headers.set(ROLE_HEADER, access.role);
		if (visitor) {
			headers.set(USER_HEADER, visitor.id);
			headers.set(NAME_HEADER, encodeURIComponent(visitor.name));
		} else {
			headers.delete(USER_HEADER);
			headers.delete(NAME_HEADER);
		}
		return env.BOARD.get(env.BOARD.idFromName(id)).fetch(new Request(request, { headers }));
	}

	return error("Not Found", 404);
}

/**
 * A browser can't read why a WebSocket upgrade failed, so a refusal is sent as
 * a socket that says why and closes.
 */
function closedSocket(message: unknown, code: number, reason: string): Response {
	const [client, server] = Object.values(new WebSocketPair());
	server.accept();
	server.send(JSON.stringify(message));
	server.close(code, reason);
	return new Response(null, { status: 101, webSocket: client });
}
