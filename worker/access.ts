import type { Sql, User } from "./db";
import { sameSecret } from "./http";

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
	/** True for the owner and invited members; false for people here only through the link. */
	isMember: boolean;
	/** True when the visitor came with the board's current share key. */
	viaLink: boolean;
}

/**
 * What the share link grants: the board's link access, but only with the
 * board's current key. The board id alone opens nothing, and resetting the
 * key cuts off every copy of the old link.
 */
export function linkRole(linkAccess: LinkAccess, boardKey: string, givenKey: string | null): Role | null {
	if (linkAccess === "none" || !givenKey) return null;
	return sameSecret(givenKey, boardKey) ? linkAccess : null;
}

/**
 * Someone's role on a board: owner, then the stronger of their member role
 * and what the link allows (with the right key). Signed-out visitors only get
 * the link's access.
 */
export async function boardAccess(sql: Sql, boardId: string, user: User | null, key: string | null): Promise<BoardAccess> {
	const [row] = await sql<
		{ owner_id: string; link_access: LinkAccess; link_key: string; member_role: "edit" | "view" | null }[]
	>`
		select b.owner_id, b.link_access, b.link_key, m.role as member_role
		from boards b
		left join board_members m on m.board_id = b.id and m.user_id = ${user?.id ?? null}
		where b.id = ${boardId} and b.deleted_at is null
	`;
	if (!row) return { exists: false, role: null, ownerId: null, linkAccess: "none", isMember: false, viaLink: false };
	if (user && row.owner_id === user.id) {
		return { exists: true, role: "owner", ownerId: row.owner_id, linkAccess: row.link_access, isMember: true, viaLink: false };
	}
	const fromLink = linkRole(row.link_access, row.link_key, key);
	return {
		exists: true,
		role: best(row.member_role, fromLink),
		ownerId: row.owner_id,
		linkAccess: row.link_access,
		isMember: row.member_role !== null,
		viaLink: fromLink !== null,
	};
}
