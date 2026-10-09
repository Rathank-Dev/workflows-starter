import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boardAccess } from "../worker/access";
import { disconnectEverywhere } from "../worker/account";
import { connect, type Sql } from "../worker/db";
import { randomHex, randomToken, sha256Hex } from "../worker/http";

/**
 * Runs the Worker against a real Postgres. Needs TEST_DATABASE_URL pointing at
 * a throwaway database with db/schema.sql applied (CI starts one); skipped
 * otherwise. Every run makes its own users and boards.
 */
const enabled = (env as unknown as { DB_TESTS?: string }).DB_TESTS === "1";
const ORIGIN = "https://example.com";

describe.skipIf(!enabled)("with Postgres", () => {
	// One connection per test: the runtime doesn't let a socket outlive the test that opened it
	let sql: Sql;
	beforeEach(() => {
		sql = connect(env);
	});
	afterEach(() => sql.end({ timeout: 5 }));

	async function user(name: string) {
		const [u] = await sql<{ id: string }[]>`insert into users (name) values (${name}) returning id`;
		const token = randomToken();
		await sql`insert into sessions (id, user_id, expires_at) values (${await sha256Hex(token)}, ${u.id}, now() + interval '30 days')`;
		return { id: u.id, name, email: null, avatar_url: null, token, cookie: `__Host-lw_session=${token}` };
	}

	async function board(ownerId: string, linkAccess: "edit" | "view" | "none" = "edit") {
		const id = randomHex(16);
		const key = randomHex(16);
		await sql`insert into boards (id, owner_id, name, link_key, link_access) values (${id}, ${ownerId}, 'Test', ${key}, ${linkAccess})`;
		return { id, key };
	}

	const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.1`;

	it("grants link access only with the current key", async () => {
		const owner = await user("Owner");
		const viewer = await user("Viewer");
		const b = await board(owner.id);
		await sql`insert into board_members (board_id, user_id, role) values (${b.id}, ${viewer.id}, 'view')`;

		expect((await boardAccess(sql, b.id, owner, null)).role).toBe("owner");
		expect((await boardAccess(sql, b.id, null, b.key)).role).toBe("edit");
		expect((await boardAccess(sql, b.id, null, null)).role).toBeNull();
		expect((await boardAccess(sql, b.id, null, randomHex(16))).role).toBeNull();
		// A member needs no key, and keeps their own role without one
		expect((await boardAccess(sql, b.id, viewer, null)).role).toBe("view");

		await sql`update boards set link_access = 'none' where id = ${b.id}`;
		expect((await boardAccess(sql, b.id, null, b.key)).role).toBeNull();
	});

	it("sends the share link only to the owner, and resetting it locks the old one out", async () => {
		const owner = await user("Owner");
		const member = await user("Member");
		const b = await board(owner.id);
		await sql`insert into board_members (board_id, user_id, role) values (${b.id}, ${member.id}, 'view')`;
		const sharing = (u: { cookie: string }) =>
			SELF.fetch(`${ORIGIN}/api/boards/${b.id}/sharing`, { headers: { Cookie: u.cookie, "CF-Connecting-IP": ip() } }).then(
				(r) => r.json() as Promise<{ linkUrl: string | null }>,
			);
		expect((await sharing(owner)).linkUrl).toBe(`${ORIGIN}/board?board=${b.id}&key=${b.key}`);
		expect((await sharing(member)).linkUrl).toBeNull();

		const reset = await SELF.fetch(`${ORIGIN}/api/boards/${b.id}/link`, {
			method: "POST",
			headers: { Cookie: owner.cookie, Origin: ORIGIN, "Content-Length": "0", "CF-Connecting-IP": ip() },
		});
		const { key } = (await reset.json()) as { key: string };
		expect(key).not.toBe(b.key);
		expect((await boardAccess(sql, b.id, null, b.key)).role).toBeNull();
		expect((await boardAccess(sql, b.id, null, key)).role).toBe("edit");

		const notOwner = await SELF.fetch(`${ORIGIN}/api/boards/${b.id}/link`, {
			method: "POST",
			headers: { Cookie: member.cookie, Origin: ORIGIN, "Content-Length": "0", "CF-Connecting-IP": ip() },
		});
		expect(notOwner.status).toBe(403);
	});

	it("records a visit with its key after opening a board, and drops it from Recent once the link is reset", async () => {
		const owner = await user("Owner");
		const visitor = await user("Visitor");
		const b = await board(owner.id);
		const res = await SELF.fetch(`${ORIGIN}/ws?board=${b.id}&key=${b.key}`, {
			headers: { Upgrade: "websocket", Origin: ORIGIN, Cookie: visitor.cookie, "CF-Connecting-IP": ip() },
		});
		expect(res.status).toBe(101);
		res.webSocket!.accept();
		const hello = await new Promise<string>((resolve) => res.webSocket!.addEventListener("message", (e) => resolve(e.data as string)));
		expect(JSON.parse(hello)).toMatchObject({ type: "hello", role: "edit" });
		res.webSocket!.close(1000);

		// The bookkeeping runs after the socket is handed back
		let visit: { link_key: string | null } | undefined;
		for (let i = 0; i < 20 && !visit; i++) {
			[visit] = await sql<{ link_key: string | null }[]>`
				select link_key from board_visits where user_id = ${visitor.id} and board_id = ${b.id}
			`;
			if (!visit) await new Promise((r) => setTimeout(r, 50));
		}
		expect(visit?.link_key).toBe(b.key);

		const dashboard = async () =>
			(
				(await SELF.fetch(`${ORIGIN}/api/dashboard`, { headers: { Cookie: visitor.cookie, "CF-Connecting-IP": ip() } }).then((r) =>
					r.json(),
				)) as { boards: { id: string; key: string | null }[] }
			).boards.find((x) => x.id === b.id);
		expect(await dashboard()).toMatchObject({ key: b.key });
		await sql`update boards set link_key = ${randomHex(16)} where id = ${b.id}`;
		expect(await dashboard()).toBeUndefined();
	});

	it("ends sessions after 7 days unused, and refreshes use at most hourly", async () => {
		const u = await user("Idle");
		const me = async () =>
			((await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: u.cookie, "CF-Connecting-IP": ip() } }).then((r) => r.json())) as {
				user: { id: string } | null;
			}).user;
		const id = await sha256Hex(u.token);

		await sql`update sessions set last_used_at = now() - interval '2 hours' where id = ${id}`;
		expect((await me())?.id).toBe(u.id);
		const [{ fresh }] = await sql<{ fresh: boolean }[]>`select last_used_at > now() - interval '1 minute' as fresh from sessions where id = ${id}`;
		expect(fresh).toBe(true);

		await sql`update sessions set last_used_at = now() - interval '8 days' where id = ${id}`;
		expect(await me()).toBeNull();
	});

	it("finds every board to disconnect on sign-out: owned and visited", async () => {
		const u = await user("Leaver");
		const other = await user("Other");
		const own = await board(u.id);
		const visited = await board(other.id);
		await sql`insert into board_visits (user_id, board_id) values (${u.id}, ${visited.id})`;
		const dropped: string[] = [];
		await disconnectEverywhere(sql, {
			deleteBoard: async () => {},
			disconnectAll: async () => {},
			deleteFiles: async () => {},
			disconnectUser: async (boardId) => {
				dropped.push(boardId);
			},
		}, u.id);
		expect(dropped.sort()).toEqual([own.id, visited.id].sort());
	});
});
