import { useCallback, useEffect, useRef, useState } from "react";
import { parseBoard, type Board } from "../../shared/board";
import type { BoardComment, CommentOp } from "../../shared/comments";
import { withKey } from "./linkKey";
import { starterBoard } from "../../shared/templates";

export type SyncStatus = "local" | "connecting" | "live" | "offline" | "deleted" | "denied";
export type BoardRole = "owner" | "edit" | "view";
export interface Person {
	id: string;
	name: string;
}
/** Someone else's pointer, in board coordinates. `name` is null for guests. */
export interface Cursor {
	id: string;
	name: string | null;
	x: number;
	y: number;
}

const HISTORY_LIMIT = 200;
const SEND_EVERY_MS = 120;
const CURSOR_EVERY_MS = 50;

/** null is the browser-only board you get without signing in. */
function localKey(boardId: string | null) {
	return boardId ? `linework:board:${boardId}` : "linework:local";
}

function loadLocal(boardId: string | null): Board | null {
	try {
		const raw = localStorage.getItem(localKey(boardId));
		return raw ? parseBoard(JSON.parse(raw)) : null;
	} catch {
		return null;
	}
}

export function saveLocal(boardId: string | null, board: Board) {
	try {
		localStorage.setItem(localKey(boardId), JSON.stringify(board));
	} catch {
		// Storage full or blocked; the server copy still saves
	}
}

function loadRole(boardId: string): BoardRole {
	try {
		const r = localStorage.getItem(`linework:role:${boardId}`);
		return r === "owner" || r === "edit" || r === "view" ? r : "edit";
	} catch {
		return "edit";
	}
}

function saveRole(boardId: string, role: BoardRole) {
	try {
		localStorage.setItem(`linework:role:${boardId}`, role);
	} catch {
		// Storage blocked; the server still enforces the role
	}
}

/**
 * Owns the board document: undo history, a copy in this browser, and (for
 * shared boards) a live WebSocket to the board's Durable Object.
 *
 * - `commit(fn)` makes one undoable change.
 * - `preview(fn)` changes the board without history (use while dragging),
 *   then `settle()` records everything since the first preview as one step.
 */
export function useBoardDoc(boardId: string | null) {
	const [board, setBoard] = useState<Board>(
		() => loadLocal(boardId) ?? (boardId ? { v: 1, name: "Untitled board", elements: [] } : starterBoard()),
	);
	const [status, setStatus] = useState<SyncStatus>(boardId ? "connecting" : "local");
	const [presence, setPresence] = useState(1);
	const [people, setPeople] = useState<Person[]>([]);
	const [cursors, setCursors] = useState<Map<string, Cursor>>(new Map());
	/**
	 * Browser-only boards are yours to edit. Shared boards start with the role
	 * last seen on this device (edit if new), so a template or offline edit made
	 * before connecting isn't lost; the server confirms the role on connect and
	 * refuses edits from viewers either way.
	 */
	const [role, setRole] = useState<BoardRole>(() => (boardId ? loadRole(boardId) : "owner"));
	const [canComment, setCanComment] = useState(false);
	const [denied, setDenied] = useState<{ signedIn: boolean } | null>(null);
	const [comments, setComments] = useState<Map<string, BoardComment>>(new Map());
	const [reconnectTick, setReconnectTick] = useState(0);
	const roleRef = useRef(role);
	roleRef.current = role;
	const [error, setError] = useState<string | null>(null);
	const [history, setHistory] = useState({ canUndo: false, canRedo: false });

	const boardRef = useRef(board);
	const past = useRef<Board[]>([]);
	const future = useRef<Board[]>([]);
	const before = useRef<Board | null>(null);
	const ws = useRef<WebSocket | null>(null);
	const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const unsynced = useRef(false);
	const alone = useRef(true);
	const cursorOut = useRef<{ x: number; y: number } | null | undefined>(undefined);
	const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const flushSend = useCallback(() => {
		sendTimer.current = null;
		const socket = ws.current;
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ type: "update", doc: boardRef.current }));
			unsynced.current = false;
		}
	}, []);

	const set = useCallback(
		(next: Board, fromServer = false) => {
			boardRef.current = next;
			setBoard(next);
			if (saveTimer.current) clearTimeout(saveTimer.current);
			saveTimer.current = setTimeout(() => saveLocal(boardId, boardRef.current), 300);
			if (fromServer || !boardId) return;
			unsynced.current = true;
			sendTimer.current ??= setTimeout(flushSend, SEND_EVERY_MS);
		},
		[boardId, flushSend],
	);

	const syncHistory = useCallback(
		() => setHistory({ canUndo: past.current.length > 0, canRedo: future.current.length > 0 }),
		[],
	);

	const pushHistory = useCallback(
		(snapshot: Board) => {
			past.current.push(snapshot);
			if (past.current.length > HISTORY_LIMIT) past.current.shift();
			future.current = [];
			syncHistory();
		},
		[syncHistory],
	);

	const commit = useCallback(
		(fn: (b: Board) => Board) => {
			if (roleRef.current === "view") return;
			const prev = before.current ?? boardRef.current;
			const next = fn(boardRef.current);
			if (next === boardRef.current) return;
			before.current = null;
			pushHistory(prev);
			set(next);
		},
		[set, pushHistory],
	);

	const preview = useCallback(
		(fn: (b: Board) => Board) => {
			if (roleRef.current === "view") return;
			before.current ??= boardRef.current;
			set(fn(boardRef.current));
		},
		[set],
	);

	const settle = useCallback(() => {
		const prev = before.current;
		before.current = null;
		if (prev && prev !== boardRef.current) pushHistory(prev);
	}, [pushHistory]);

	const undo = useCallback(() => {
		if (roleRef.current === "view") return;
		const prev = past.current.pop();
		if (!prev) return;
		future.current.push(boardRef.current);
		syncHistory();
		set(prev);
	}, [set, syncHistory]);

	const redo = useCallback(() => {
		if (roleRef.current === "view") return;
		const next = future.current.pop();
		if (!next) return;
		past.current.push(boardRef.current);
		syncHistory();
		set(next);
	}, [set, syncHistory]);

	// Live connection with reconnect (shared boards only)
	useEffect(() => {
		if (!boardId) return;
		let closed = false;
		let attempt = 0;
		let retry: ReturnType<typeof setTimeout> | null = null;

		const connect = () => {
			setStatus((s) => (s === "live" ? "connecting" : s));
			const protocol = location.protocol === "https:" ? "wss:" : "ws:";
			const socket = new WebSocket(`${protocol}//${location.host}${withKey(`/ws?board=${encodeURIComponent(boardId)}`)}`);
			ws.current = socket;

			socket.onopen = () => {
				attempt = 0;
				setStatus("live");
				setError(null);
			};
			socket.onmessage = (event) => {
				let msg: {
				type?: string;
				doc?: unknown;
				count?: number;
				message?: string;
				role?: BoardRole;
				canComment?: boolean;
				signedIn?: boolean;
				people?: Person[];
				id?: string;
				name?: string | null;
				x?: number;
				y?: number;
				items?: BoardComment[];
				comment?: BoardComment;
				ids?: string[];
			};
				try {
					msg = JSON.parse(event.data);
				} catch {
					return;
				}
				if (msg.type === "hello" && msg.role) {
					setRole(msg.role);
					saveRole(boardId, msg.role);
					setCanComment(Boolean(msg.canComment));
				} else if (msg.type === "denied") {
					closed = true;
					setDenied({ signedIn: Boolean(msg.signedIn) });
					setStatus("denied");
				} else if (msg.type === "comments" && Array.isArray(msg.items)) {
					setComments(new Map(msg.items.map((c) => [c.id, c])));
				} else if (msg.type === "comment" && msg.comment) {
					const c = msg.comment;
					setComments((m) => new Map(m).set(c.id, c));
				} else if (msg.type === "comment:removed" && Array.isArray(msg.ids)) {
					const ids = msg.ids;
					setComments((m) => {
						const next = new Map(m);
						for (const id of ids) next.delete(id);
						return next;
					});
				} else if (msg.type === "doc") {
					const doc = msg.doc === null ? null : parseBoard(msg.doc);
					// Nothing saved yet, or we edited while offline: our copy wins.
					if (!doc || unsynced.current) flushSend();
					else if (!before.current) set(doc, true);
				} else if (msg.type === "presence" && typeof msg.count === "number") {
					setPresence(Math.max(1, msg.count));
					setPeople(Array.isArray(msg.people) ? msg.people : []);
					alone.current = msg.count <= 1;
				} else if (msg.type === "cursor" && typeof msg.id === "string" && typeof msg.x === "number" && typeof msg.y === "number") {
					const c: Cursor = { id: msg.id, name: typeof msg.name === "string" ? msg.name : null, x: msg.x, y: msg.y };
					setCursors((m) => new Map(m).set(c.id, c));
				} else if (msg.type === "cursor:gone" && typeof msg.id === "string") {
					const id = msg.id;
					setCursors((m) => {
						if (!m.has(id)) return m;
						const next = new Map(m);
						next.delete(id);
						return next;
					});
				} else if (msg.type === "deleted") {
					closed = true;
					socket.close();
					setStatus("deleted");
					setError("This board was deleted by its owner.");
				} else if (msg.type === "error" && typeof msg.message === "string") {
					setError(msg.message);
				}
			};
			socket.onclose = (event) => {
				if (ws.current === socket) ws.current = null;
				if (closed) return;
				if (event.code === 4404) {
					setStatus("deleted");
					setError("This board was deleted by its owner.");
					return;
				}
				// Sharing changed: reconnect now so the new access applies
				if (event.code === 4001) {
					retry = setTimeout(connect, 50);
					return;
				}
				setStatus("offline");
				setPresence(1);
				setCursors(new Map());
				alone.current = true;
				attempt += 1;
				retry = setTimeout(connect, Math.min(15_000, 500 * 2 ** attempt));
			};
		};
		// Deferred so React StrictMode's mount/unmount/mount opens one socket, not two.
		setDenied(null);
		retry = setTimeout(connect, 0);

		return () => {
			closed = true;
			if (retry) clearTimeout(retry);
			ws.current?.close();
			ws.current = null;
			setCursors(new Map());
			alone.current = true;
		};
	}, [boardId, flushSend, set, reconnectTick]);

	/**
	 * Shares where this pointer is (board coordinates), or null when it leaves
	 * the canvas. Sends at most every CURSOR_EVERY_MS, and nothing when no one
	 * else is here to see it.
	 */
	const sendCursor = useCallback((at: { x: number; y: number } | null) => {
		cursorOut.current = at && { x: Math.round(at.x), y: Math.round(at.y) };
		if (cursorTimer.current) return;
		cursorTimer.current = setTimeout(() => {
			cursorTimer.current = null;
			const out = cursorOut.current;
			cursorOut.current = undefined;
			const socket = ws.current;
			if (out === undefined || alone.current || socket?.readyState !== WebSocket.OPEN) return;
			socket.send(JSON.stringify(out ? { type: "cursor", ...out } : { type: "cursor", x: null }));
		}, CURSOR_EVERY_MS);
	}, []);

	/** Sends a comment change. Returns false when not connected. */
	const sendComment = useCallback((op: CommentOp) => {
		const socket = ws.current;
		if (socket?.readyState !== WebSocket.OPEN) return false;
		socket.send(JSON.stringify(op));
		return true;
	}, []);

	// Keep the local copy current when the tab closes mid-debounce
	useEffect(() => {
		const onHide = () => saveLocal(boardId, boardRef.current);
		window.addEventListener("pagehide", onHide);
		return () => window.removeEventListener("pagehide", onHide);
	}, [boardId]);

	return {
		board,
		boardRef,
		commit,
		preview,
		settle,
		undo,
		redo,
		canUndo: history.canUndo,
		canRedo: history.canRedo,
		status,
		presence,
		people,
		cursors,
		sendCursor,
		role,
		canEdit: role !== "view",
		canComment,
		denied,
		comments,
		sendComment,
		/** Connect again, e.g. after accepting an invite. */
		reconnect: () => setReconnectTick((t) => t + 1),
		error,
		dismissError: () => setError(null),
	};
}

export type BoardDoc = ReturnType<typeof useBoardDoc>;
