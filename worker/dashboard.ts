import { DELETION_GRACE_DAYS, TRASH_DAYS, boardStore, disconnectEverywhere, requestDeletion } from "./account";
import { remainingUses, DAILY_LIMIT } from "./ai";
import type { Sql, User } from "./db";
import { SESSION_COOKIE } from "./auth";
import { error, json, setCookie } from "./http";

export interface DashboardBoard {
	id: string;
	name: string;
	is_owner: boolean;
	owner_name: string;
	starred: boolean;
	created_at: Date;
	updated_at: Date;
	last_opened_at: Date | null;
	deleted_at: Date | null;
}

/**
 * GET /api/dashboard
 * Boards the user owns (including trashed ones) plus boards they opened from
 * someone else's link. The client derives Home / Recent / Starred / Trash.
 */
export async function listDashboard(sql: Sql, user: User): Promise<Response> {
	const boards = await sql<DashboardBoard[]>`
		select b.id, b.name, b.created_at, b.updated_at, b.deleted_at,
			(b.owner_id = ${user.id}) as is_owner,
			u.name as owner_name,
			v.last_opened_at,
			(s.board_id is not null) as starred
		from boards b
		join users u on u.id = b.owner_id
		left join board_visits v on v.board_id = b.id and v.user_id = ${user.id}
		left join board_stars s on s.board_id = b.id and s.user_id = ${user.id}
		-- Other people's boards only while the user can still open them: as a
		-- member, or as a past visitor while the link isn't locked
		where b.owner_id = ${user.id}
			or (b.deleted_at is null and (
				exists (select 1 from board_members m where m.board_id = b.id and m.user_id = ${user.id})
				or (v.user_id is not null and b.link_access <> 'none')))
		order by coalesce(v.last_opened_at, b.updated_at) desc
		limit 500
	`;
	return json({ boards, trashDays: TRASH_DAYS });
}

/** POST /api/boards/:id/star  { starred: boolean } — any board the user can see. */
export async function setStar(request: Request, sql: Sql, user: User, id: string): Promise<Response> {
	const body = (await request.json().catch(() => null)) as { starred?: unknown } | null;
	if (typeof body?.starred !== "boolean") return error("Say whether to star the board.", 400);
	if (!body.starred) {
		await sql`delete from board_stars where user_id = ${user.id} and board_id = ${id}`;
		return json({ starred: false });
	}
	const rows = await sql`
		insert into board_stars (user_id, board_id)
		select ${user.id}, b.id from boards b
		where b.id = ${id} and b.deleted_at is null
			and (b.owner_id = ${user.id}
				or exists (select 1 from board_members m where m.board_id = b.id and m.user_id = ${user.id})
				or (b.link_access <> 'none'
					and exists (select 1 from board_visits v where v.board_id = b.id and v.user_id = ${user.id})))
		on conflict do nothing
		returning board_id
	`;
	if (!rows.length) {
		const [already] = await sql`select 1 from board_stars where user_id = ${user.id} and board_id = ${id}`;
		if (!already) return error("Board not found.", 404);
	}
	return json({ starred: true });
}

/** POST /api/boards/:id/trash — owner only. Disconnects anyone viewing it; content is kept. */
export async function trashBoard(sql: Sql, env: Env, user: User, id: string): Promise<Response> {
	const rows = await sql`
		update boards set deleted_at = now()
		where id = ${id} and owner_id = ${user.id} and deleted_at is null
		returning id
	`;
	if (!rows.length) return error("Only the board's owner can move it to the trash.", 403);
	await boardStore(env).disconnectAll(id);
	return json({ ok: true, trashDays: TRASH_DAYS });
}

/** POST /api/boards/:id/restore — owner only. */
export async function restoreBoard(sql: Sql, user: User, id: string): Promise<Response> {
	const rows = await sql`
		update boards set deleted_at = null, updated_at = now()
		where id = ${id} and owner_id = ${user.id} and deleted_at is not null
		returning id
	`;
	return rows.length ? json({ ok: true }) : error("Only the board's owner can restore it.", 403);
}

/** GET /api/profile */
export async function getProfile(sql: Sql, user: User): Promise<Response> {
	const [details] = await sql<{ created_at: Date; email: string | null }[]>`
		select created_at, email from users where id = ${user.id}
	`;
	const accounts = await sql<{ provider: string; created_at: Date }[]>`
		select provider, created_at from oauth_accounts where user_id = ${user.id} order by created_at
	`;
	const [{ boards }] = await sql<{ boards: number }[]>`
		select count(*)::int as boards from boards where owner_id = ${user.id} and deleted_at is null
	`;
	const [{ sessions }] = await sql<{ sessions: number }[]>`
		select count(*)::int as sessions from sessions where user_id = ${user.id} and expires_at > now()
	`;
	return json({
		user: { id: user.id, name: user.name, email: details?.email ?? null, avatarUrl: user.avatar_url, createdAt: details?.created_at },
		accounts,
		plan: { id: "free", name: "Free" },
		usage: { boards, aiRemaining: await remainingUses(sql, user.id), aiDailyLimit: DAILY_LIMIT, sessions },
	});
}

/** POST /auth/logout-all — ends every session for this user, on every device, including open boards. */
export async function logoutEverywhere(sql: Sql, env: Env, user: User): Promise<Response> {
	await sql`delete from sessions where user_id = ${user.id}`;
	await disconnectEverywhere(sql, boardStore(env), user.id);
	return new Response(null, { status: 204, headers: { "Set-Cookie": setCookie(SESSION_COOKIE, "", { maxAge: 0 }) } });
}

/**
 * DELETE /api/account  { confirm: "DELETE" }
 * Schedules deletion in 30 days: logs out everywhere and trashes the user's
 * boards. Signing in again before then cancels it.
 */
export async function deleteAccount(request: Request, sql: Sql, env: Env, user: User): Promise<Response> {
	const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
	if (body?.confirm !== "DELETE") return error("Type DELETE to confirm.", 400);
	const deleteAt = await requestDeletion(sql, boardStore(env), user.id);
	return json(
		{ deleteAt, graceDays: DELETION_GRACE_DAYS },
		200,
		{ "Set-Cookie": setCookie(SESSION_COOKIE, "", { maxAge: 0 }) },
	);
}
