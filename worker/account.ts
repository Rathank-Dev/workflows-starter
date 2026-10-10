import type { Sql } from "./db";
import { deleteBoardRecordings } from "./recordings";

/** Days between asking to delete an account and it being deleted for good. */
export const DELETION_GRACE_DAYS = 30;
/** Trashed boards are deleted for good after this many days. */
export const TRASH_DAYS = 30;
/** A session ends after this many days without use (and 30 days after sign-in regardless). */
export const SESSION_IDLE_DAYS = 7;

/** Minimal Durable Object access, so this module also runs outside the Worker (tests, scripts). */
export interface BoardStore {
	/** Erases the board's content, comments, and walkthrough videos. */
	deleteBoard(id: string): Promise<void>;
	disconnectAll(id: string): Promise<void>;
	/** Closes one person's live connections to a board. */
	disconnectUser(id: string, userId: string): Promise<void>;
	/** Deletes stored files (walkthrough videos) by key. */
	deleteFiles(keys: string[]): Promise<void>;
}

export function boardStore(env: Env): BoardStore {
	const stub = (id: string) => env.BOARD.get(env.BOARD.idFromName(id));
	return {
		deleteBoard: async (id) => {
			await stub(id).deleteBoard();
			await deleteBoardRecordings(env, id);
		},
		disconnectAll: (id) => stub(id).disconnectAll(),
		disconnectUser: (id, userId) => stub(id).disconnectUser(userId),
		deleteFiles: async (keys) => {
			for (let i = 0; i < keys.length; i += 1000) await env.RECORDINGS.delete(keys.slice(i, i + 1000));
		},
	};
}

/** How many boards to disconnect from at once when sessions are revoked. */
const DISCONNECT_BATCH = 20;

/**
 * Sessions were revoked: close the person's live connections everywhere.
 * A board socket is authorized once, when it opens, so without this an open
 * tab (perhaps on a stolen session) keeps editing after "Log out everywhere".
 * Every signed-in connection is recorded in board_visits, owners included.
 */
export async function disconnectEverywhere(sql: Sql, store: BoardStore, userId: string): Promise<void> {
	const boards = await sql<{ id: string }[]>`
		select board_id as id from board_visits where user_id = ${userId}
		union
		select id from boards where owner_id = ${userId}
	`;
	for (let i = 0; i < boards.length; i += DISCONNECT_BATCH) {
		await Promise.all(boards.slice(i, i + DISCONNECT_BATCH).map((b) => store.disconnectUser(b.id, userId)));
	}
}

/**
 * Schedules deletion: ends every session, moves the user's live boards to the
 * trash (flagged so they come back if the user returns), and records when.
 * Returns the date the account will be deleted.
 */
export async function requestDeletion(sql: Sql, store: BoardStore, userId: string): Promise<Date> {
	const { trashed, deleteAt } = await sql.begin(async (tx) => {
		const [u] = await tx<{ at: Date }[]>`
			update users set deletion_requested_at = coalesce(deletion_requested_at, now())
			where id = ${userId}
			returning deletion_requested_at + make_interval(days => ${DELETION_GRACE_DAYS}) as at
		`;
		const rows = await tx<{ id: string }[]>`
			update boards set deleted_at = now(), trashed_with_account = true
			where owner_id = ${userId} and deleted_at is null
			returning id
		`;
		await tx`delete from sessions where user_id = ${userId}`;
		return { trashed: rows.map((r) => r.id), deleteAt: u.at };
	});
	// Close live connections so shared links stop working right away
	for (const id of trashed) await store.disconnectAll(id);
	// And their own open tabs on other people's boards
	await disconnectEverywhere(sql, store, userId);
	return deleteAt;
}

/**
 * Called when someone signs in. If their account was scheduled for deletion,
 * cancels it and restores the boards that deletion trashed. Returns whether
 * anything was cancelled.
 */
export async function cancelPendingDeletion(sql: Sql, userId: string): Promise<boolean> {
	return sql.begin(async (tx) => {
		const [u] = await tx`
			update users set deletion_requested_at = null
			where id = ${userId} and deletion_requested_at is not null
			returning id
		`;
		if (!u) return false;
		await tx`
			update boards set deleted_at = null, trashed_with_account = false, updated_at = now()
			where owner_id = ${userId} and trashed_with_account
		`;
		return true;
	}) as Promise<boolean>;
}

/**
 * Daily cleanup (Cron Trigger): deletes accounts past their grace period,
 * boards past their time in the trash, and old usage counters.
 */
export async function purgeDue(sql: Sql, store: BoardStore): Promise<{ accounts: number; boards: number }> {
	const users = await sql<{ id: string }[]>`
		select id from users
		where deletion_requested_at < now() - make_interval(days => ${DELETION_GRACE_DAYS})
	`;
	let boards = 0;
	for (const { id } of users) {
		const owned = await sql<{ id: string }[]>`select id from boards where owner_id = ${id}`;
		for (const b of owned) await store.deleteBoard(b.id);
		boards += owned.length;
		// Their walkthroughs on other people's boards
		const recs = await sql<{ id: string; board_id: string }[]>`select id, board_id from recordings where user_id = ${id}`;
		await store.deleteFiles(recs.map((r) => `recordings/${r.board_id}/${r.id}`));
		// Cascades to boards, sign-ins, sessions, stars, visits, and usage
		await sql`delete from users where id = ${id}`;
	}
	const expired = await sql<{ id: string }[]>`
		delete from boards where deleted_at < now() - make_interval(days => ${TRASH_DAYS})
		returning id
	`;
	for (const b of expired) await store.deleteBoard(b.id);
	boards += expired.length;
	// Usage counters only matter for today
	await sql`delete from ai_usage where day < current_date - 7`;
	await sql`delete from ai_ip_usage where day < current_date - 7`;
	await sql`
		delete from sessions
		where expires_at < now() or last_used_at < now() - make_interval(days => ${SESSION_IDLE_DAYS})
	`;
	return { accounts: users.length, boards };
}
