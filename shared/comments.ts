/** Comment threads pinned to a point on the board. Stored in the board's Durable Object. */
export interface BoardComment {
	id: string;
	/** null for the first comment of a thread; otherwise the thread it replies to. */
	parent: string | null;
	/** Board coordinates of the pin (replies copy their thread's). */
	x: number;
	y: number;
	text: string;
	authorId: string;
	authorName: string;
	/** Milliseconds since the epoch. */
	at: number;
	/** Only meaningful on a thread's first comment. */
	resolved: boolean;
}

export const MAX_COMMENTS = 1000;
export const MAX_COMMENT_CHARS = 2000;
const MAX_COORD = 1_000_000;

export type CommentOp =
	| { type: "comment:add"; x: number; y: number; text: string }
	| { type: "comment:reply"; parent: string; text: string }
	| { type: "comment:resolve"; id: string; resolved: boolean }
	| { type: "comment:move"; id: string; x: number; y: number }
	| { type: "comment:delete"; id: string };

const coord = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_COORD;
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

function text(v: unknown): string | null {
	if (typeof v !== "string") return null;
	const t = v.trim();
	return t && t.length <= MAX_COMMENT_CHARS ? t : null;
}

/** Validates a comment message from a client. Returns null if anything is off. */
export function parseCommentOp(input: unknown): CommentOp | null {
	if (typeof input !== "object" || input === null) return null;
	const o = input as Record<string, unknown>;
	switch (o.type) {
		case "comment:add": {
			const t = text(o.text);
			return t && coord(o.x) && coord(o.y) ? { type: o.type, x: o.x, y: o.y, text: t } : null;
		}
		case "comment:reply": {
			const t = text(o.text);
			return t && id(o.parent) ? { type: o.type, parent: o.parent, text: t } : null;
		}
		case "comment:resolve":
			return id(o.id) && typeof o.resolved === "boolean" ? { type: o.type, id: o.id, resolved: o.resolved } : null;
		case "comment:move":
			return id(o.id) && coord(o.x) && coord(o.y) ? { type: o.type, id: o.id, x: o.x, y: o.y } : null;
		case "comment:delete":
			return id(o.id) ? { type: o.type, id: o.id } : null;
		default:
			return null;
	}
}
