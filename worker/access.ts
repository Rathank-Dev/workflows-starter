import type { Sql, User } from "./db";

/** What someone can do on a board. */
export type Role = "owner" | "edit" | "view";
export type LinkAccess = "edit" | "view" | "none";

export const LINK_ACCESS: LinkAccess[] = ["edit", "view", "none"];

const RANK: Record<Role, number> = { view: 1, edit: 2, owner: 3 };

export function canEdit(role: Role | null): boolean {
	return role === "owner" || role === "edit";
}

/** The stronger of two roles. */
function best(a: Role | null, b: Role | null): Role | null {
	if (!a) return b;
	if (!b) return a;
	return RANK[a] >= RANK[b] ? a : b;
}

export interface BoardAccess {
	/** False when the board doesn't exist or is in the trash. */
	exists: boolean;
	role: Role | null;
	ownerId: string | null;
	linkAccess: LinkAccess;
}

/**
 * Someone's role on a board: owner, then the stronger of their member role
 * and what the link allows. Signed-out visitors only get the link's access.
 */
export async function boardAccess(sql: Sql, boardId: string, user: User | null): Promise<BoardAccess> {
	const [row] = await sql<{ owner_id: string; link_access: LinkAccess; member_role: "edit" | "view" | null }[]>`
		select b.owner_id, b.link_access, m.role as member_role
		from boards b
		left join board_members m on m.board_id = b.id and m.user_id = ${user?.id ?? null}
		where b.id = ${boardId} and b.deleted_at is null
	`;
	if (!row) return { exists: false, role: null, ownerId: null, linkAccess: "none" };
	if (user && row.owner_id === user.id) {
		return { exists: true, role: "owner", ownerId: row.owner_id, linkAccess: row.link_access };
	}
	const linkRole: Role | null = row.link_access === "none" ? null : row.link_access;
	return { exists: true, role: best(row.member_role, linkRole), ownerId: row.owner_id, linkAccess: row.link_access };
}
