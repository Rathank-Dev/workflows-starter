import { boardAccess, canEdit } from "./access";
import type { Sql, User } from "./db";
import { SECURITY_HEADERS, error, json, randomHex } from "./http";

/** Largest walkthrough upload: about 5 minutes of screen video at typical browser bitrates. */
export const MAX_RECORDING_BYTES = 80 * 1024 * 1024;
export const MAX_RECORDING_MS = 5 * 60 * 1000;
/** Walkthroughs each person can keep on the Free plan. Deleting one frees a slot. */
export const FREE_RECORDINGS = 5;

const TYPES = ["video/webm", "video/mp4"] as const;
type VideoType = (typeof TYPES)[number];

export const RECORDING_PATH = /^\/api\/boards\/([a-f0-9]{32})\/recordings$/;

function objectKey(boardId: string, id: string): string {
	return `recordings/${boardId}/${id}`;
}

/** Every R2 key for one board, for deleting a board for good. */
export function boardRecordingsPrefix(boardId: string): string {
	return `recordings/${boardId}/`;
}

/** WebM starts with the EBML magic number; MP4 has "ftyp" at byte 4. */
function looksLike(type: VideoType, head: Uint8Array): boolean {
	if (type === "video/webm") return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
	return head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

async function remaining(sql: Sql, userId: string): Promise<number> {
	const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from recordings where user_id = ${userId}`;
	return Math.max(0, FREE_RECORDINGS - n);
}

/** GET /api/boards/:id/recordings — anyone with access to the board. */
export async function listRecordings(sql: Sql, user: User | null, boardId: string): Promise<Response> {
	const access = await boardAccess(sql, boardId, user);
	if (!access.exists) return error("Board not found.", 404);
	if (!access.role) return error("You don't have access to this board.", 403);
	const items = await sql<
		{ id: string; title: string; duration_ms: number; created_at: Date; author_id: string; author_name: string }[]
	>`
		select r.id, r.title, r.duration_ms, r.created_at, r.user_id as author_id, u.name as author_name
		from recordings r join users u on u.id = r.user_id
		where r.board_id = ${boardId}
		order by r.created_at desc
		limit 100
	`;
	return json({
		items: items.map((r) => ({
			id: r.id,
			title: r.title,
			durationMs: r.duration_ms,
			createdAt: r.created_at,
			authorName: r.author_name,
			canDelete: user !== null && (r.author_id === user.id || access.role === "owner"),
		})),
		remaining: user ? await remaining(sql, user.id) : null,
		limit: FREE_RECORDINGS,
		canRecord: user !== null && canEdit(access.role),
	});
}

/**
 * POST /api/boards/:id/recordings?title=…&duration=…  (body: the video)
 * Signed-in editors only, within the Free plan's limit.
 */
export async function uploadRecording(request: Request, sql: Sql, env: Env, user: User, boardId: string): Promise<Response> {
	const access = await boardAccess(sql, boardId, user);
	if (!access.exists) return error("Board not found.", 404);
	if (!canEdit(access.role)) return error("Only people who can edit this board can record walkthroughs.", 403);

	const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase() as VideoType;
	if (!TYPES.includes(type)) return error("Upload a WebM or MP4 video.", 415);
	const bytes = Number(request.headers.get("Content-Length") ?? "0");
	if (!Number.isInteger(bytes) || bytes < 1024 || !request.body) return error("The recording is empty.", 400);
	if (bytes > MAX_RECORDING_BYTES) return error("The recording is too large. Keep walkthroughs under 5 minutes.", 413);

	const url = new URL(request.url);
	const duration = Math.round(Number(url.searchParams.get("duration") ?? "0"));
	if (!Number.isFinite(duration) || duration < 1000 || duration > MAX_RECORDING_MS + 5000) {
		return error("Walkthroughs can be up to 5 minutes long.", 400);
	}
	const title = (url.searchParams.get("title") ?? "").trim().slice(0, 120) || "Walkthrough";

	if ((await remaining(sql, user.id)) <= 0) {
		return error(`You've used all ${FREE_RECORDINGS} walkthroughs on the Free plan. Delete one to record another.`, 402);
	}

	const id = randomHex(16);
	const key = objectKey(boardId, id);
	await env.RECORDINGS.put(key, request.body, { httpMetadata: { contentType: type } });
	// Check the file really is the video type it claims before keeping it
	const head = await env.RECORDINGS.get(key, { range: { offset: 0, length: 12 } });
	const headBytes = head ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array();
	if (!looksLike(type, headBytes)) {
		await env.RECORDINGS.delete(key);
		return error("That file isn't a playable video.", 415);
	}
	// Re-check the limit after the upload, so two uploads at once can't both slip in
	const [row] = await sql<{ id: string }[]>`
		insert into recordings (id, board_id, user_id, title, duration_ms, bytes, content_type)
		select ${id}, ${boardId}, ${user.id}, ${title}, ${duration}, ${bytes}, ${type}
		where (select count(*) from recordings where user_id = ${user.id}) < ${FREE_RECORDINGS}
		returning id
	`;
	if (!row) {
		await env.RECORDINGS.delete(key);
		return error(`You've used all ${FREE_RECORDINGS} walkthroughs on the Free plan. Delete one to record another.`, 402);
	}
	return json({ id, remaining: await remaining(sql, user.id) }, 201);
}

/** GET /api/recordings/:id — streams the video (with Range support) to anyone with access to its board. */
export async function playRecording(request: Request, sql: Sql, env: Env, user: User | null, id: string): Promise<Response> {
	const [rec] = await sql<{ board_id: string; content_type: VideoType }[]>`
		select board_id, content_type from recordings where id = ${id}
	`;
	if (!rec) return error("Recording not found.", 404);
	const access = await boardAccess(sql, rec.board_id, user);
	if (!access.role) return error("Recording not found.", 404);

	const object = await env.RECORDINGS.get(objectKey(rec.board_id, id), { range: request.headers });
	if (!object) return error("Recording not found.", 404);
	const headers = new Headers(SECURITY_HEADERS);
	headers.set("Content-Type", rec.content_type);
	headers.set("Accept-Ranges", "bytes");
	headers.set("Cache-Control", "private, max-age=3600");
	headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
	const range = object.range as { offset?: number; length?: number } | undefined;
	if (request.headers.has("Range") && range && range.offset !== undefined) {
		const length = range.length ?? object.size - range.offset;
		headers.set("Content-Range", `bytes ${range.offset}-${range.offset + length - 1}/${object.size}`);
		headers.set("Content-Length", String(length));
		return new Response(object.body, { status: 206, headers });
	}
	headers.set("Content-Length", String(object.size));
	return new Response(object.body, { status: 200, headers });
}

/** DELETE /api/recordings/:id — its author or the board's owner. */
export async function deleteRecording(sql: Sql, env: Env, user: User, id: string): Promise<Response> {
	const [rec] = await sql<{ board_id: string; user_id: string; owner_id: string }[]>`
		select r.board_id, r.user_id, b.owner_id from recordings r join boards b on b.id = r.board_id where r.id = ${id}
	`;
	if (!rec) return error("Recording not found.", 404);
	if (rec.user_id !== user.id && rec.owner_id !== user.id) {
		return error("Only the person who recorded it or the board's owner can delete it.", 403);
	}
	await sql`delete from recordings where id = ${id}`;
	await env.RECORDINGS.delete(objectKey(rec.board_id, id));
	return json({ ok: true, remaining: await remaining(sql, user.id) });
}

/** Deletes every video stored for a board (board deleted for good). */
export async function deleteBoardRecordings(env: Env, boardId: string): Promise<void> {
	let cursor: string | undefined;
	do {
		const page = await env.RECORDINGS.list({ prefix: boardRecordingsPrefix(boardId), cursor });
		if (page.objects.length) await env.RECORDINGS.delete(page.objects.map((o) => o.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
}
