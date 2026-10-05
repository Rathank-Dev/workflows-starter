import { LINK_ACCESS, boardAccess, type LinkAccess } from "./access";
import type { Sql, User } from "./db";
import { error, json, randomHex } from "./http";

/** Most people one board can have as members. */
const MAX_MEMBERS = 200;

function inviteUrl(origin: string, boardId: string, token: string): string {
	return `${origin}/board?board=${boardId}&invite=${token}`;
}

/** Compares two strings without exiting early on the first difference. */
function sameToken(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * GET /api/boards/:id/sharing
 * Anyone with access sees who's on the board; only the owner gets the invite
 * link and the controls.
 */
export async function getSharing(request: Request, sql: Sql, user: User | null, id: string): Promise<Response> {
	const access = await boardAccess(sql, id, user);
	if (!access.exists) return error("Board not found.", 404);
	if (!access.role) return error("You don't have access to this board.", 403);
	const [board] = await sql<{ invite_token: string | null; invite_role: "edit" | "view" }[]>`
		select invite_token, invite_role from boards where id = ${id}
	`;
	// Who's on the board is for the owner and members, not everyone who has the link
	const people = !access.isMember
		? []
		: await sql<{ id: string; name: string; avatar_url: string | null; role: string }[]>`
		select u.id, u.name, u.avatar_url, 'owner' as role, 0 as sort, b.created_at as added_at
		from boards b join users u on u.id = b.owner_id where b.id = ${id}
		union all
		select u.id, u.name, u.avatar_url, m.role, 1 as sort, m.added_at
		from board_members m join users u on u.id = m.user_id where m.board_id = ${id}
		order by sort, added_at
		limit ${MAX_MEMBERS + 1}
	`;
	const isOwner = access.role === "owner";
	return json({
		role: access.role,
		linkAccess: access.linkAccess,
		invite: isOwner
			? {
					role: board.invite_role,
					url: board.invite_token ? inviteUrl(new URL(request.url).origin, id, board.invite_token) : null,
				}
			: null,
		people: people.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatar_url, role: p.role })),
	});
}

/** PATCH /api/boards/:id/sharing  { linkAccess?, inviteRole? } — owner only. */
export async function updateSharing(request: Request, sql: Sql, env: Env, user: User, id: string): Promise<Response> {
	const body = (await request.json().catch(() => null)) as { linkAccess?: unknown; inviteRole?: unknown } | null;
	const linkAccess = LINK_ACCESS.includes(body?.linkAccess as LinkAccess) ? (body!.linkAccess as LinkAccess) : null;
	const inviteRole = body?.inviteRole === "edit" || body?.inviteRole === "view" ? body.inviteRole : null;
	if (!linkAccess && !inviteRole) return error("Nothing to change.", 400);
	const rows = await sql`
		update boards set
			link_access = coalesce(${linkAccess}, link_access),
			invite_role = coalesce(${inviteRole}, invite_role)
		where id = ${id} and owner_id = ${user.id} and deleted_at is null
		returning id
	`;
	if (!rows.length) return error("Only the board's owner can change sharing.", 403);
	// Tightening the link takes effect for people already on the board
	if (linkAccess) await env.BOARD.get(env.BOARD.idFromName(id)).refreshAccess();
	return json({ ok: true });
}

/** POST /api/boards/:id/invite — owner only. Makes a new invite link; the old one stops working. */
export async function resetInvite(request: Request, sql: Sql, user: User, id: string): Promise<Response> {
	const token = randomHex(16);
	const rows = await sql`
		update boards set invite_token = ${token}
		where id = ${id} and owner_id = ${user.id} and deleted_at is null
		returning id
	`;
	if (!rows.length) return error("Only the board's owner can create invite links.", 403);
	return json({ url: inviteUrl(new URL(request.url).origin, id, token) });
}

/** POST /api/boards/:id/join  { token } — a signed-in person accepts an invite link. */
export async function joinBoard(request: Request, sql: Sql, user: User, id: string): Promise<Response> {
	const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
	const token = typeof body?.token === "string" ? body.token : "";
	const [board] = await sql<{ owner_id: string; invite_token: string | null; invite_role: "edit" | "view" }[]>`
		select owner_id, invite_token, invite_role from boards where id = ${id} and deleted_at is null
	`;
	if (!board) return error("Board not found.", 404);
	if (board.owner_id === user.id) return json({ role: "owner" });
	if (!board.invite_token || !sameToken(token, board.invite_token)) {
		return error("This invite link has expired. Ask the board's owner for a new one.", 403);
	}
	const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from board_members where board_id = ${id}`;
	// Members joining again keep the stronger of their old role and the invite's
	const [row] = await sql<{ role: string }[]>`
		insert into board_members (board_id, user_id, role)
		select ${id}, ${user.id}, ${board.invite_role}
		where ${n} < ${MAX_MEMBERS} or exists (select 1 from board_members where board_id = ${id} and user_id = ${user.id})
		on conflict (board_id, user_id) do update
			set role = case when board_members.role = 'edit' or excluded.role = 'edit' then 'edit' else 'view' end
		returning role
	`;
	if (!row) return error("This board has the most members it can have.", 409);
	return json({ role: row.role });
}

/**
 * PATCH  /api/boards/:id/members/:userId  { role } — owner changes a member's role
 * DELETE /api/boards/:id/members/:userId           — owner removes a member, or a member leaves
 */
export async function updateMember(
	request: Request,
	sql: Sql,
	env: Env,
	user: User,
	id: string,
	memberId: string,
): Promise<Response> {
	const [board] = await sql<{ owner_id: string }[]>`select owner_id from boards where id = ${id} and deleted_at is null`;
	if (!board) return error("Board not found.", 404);
	const isOwner = board.owner_id === user.id;

	if (request.method === "DELETE") {
		if (!isOwner && memberId !== user.id) return error("Only the board's owner can remove people.", 403);
		await sql`delete from board_members where board_id = ${id} and user_id = ${memberId}`;
		// Drop it from their Recent and stars too
		await sql`delete from board_visits where board_id = ${id} and user_id = ${memberId}`;
		await sql`delete from board_stars where board_id = ${id} and user_id = ${memberId}`;
	} else {
		if (!isOwner) return error("Only the board's owner can change roles.", 403);
		const body = (await request.json().catch(() => null)) as { role?: unknown } | null;
		if (body?.role !== "edit" && body?.role !== "view") return error("Role must be edit or view.", 400);
		const rows = await sql`
			update board_members set role = ${body.role} where board_id = ${id} and user_id = ${memberId} returning user_id
		`;
		if (!rows.length) return error("That person isn't a member of this board.", 404);
	}
	await env.BOARD.get(env.BOARD.idFromName(id)).refreshAccess();
	return json({ ok: true });
}
