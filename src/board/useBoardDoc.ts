import { useCallback, useEffect, useRef, useState } from "react";
import { parseBoard, type Board } from "../../shared/board";
import { starterBoard } from "../../shared/templates";

export type SyncStatus = "connecting" | "live" | "offline";

const HISTORY_LIMIT = 200;
const SEND_EVERY_MS = 120;

function localKey(boardId: string) {
	return `linework:board:${boardId}`;
}

function loadLocal(boardId: string): Board | null {
	try {
		const raw = localStorage.getItem(localKey(boardId));
		return raw ? parseBoard(JSON.parse(raw)) : null;
	} catch {
		return null;
	}
}

function saveLocal(boardId: string, board: Board) {
	try {
		localStorage.setItem(localKey(boardId), JSON.stringify(board));
	} catch {
		// Storage full or blocked; the server copy still saves
	}
}

/**
 * Owns the board document: undo history, a local copy in this browser, and a
 * live WebSocket to the board's Durable Object.
 *
 * - `commit(fn)` makes one undoable change.
 * - `preview(fn)` changes the board without history (use while dragging),
 *   then `settle()` records everything since the first preview as one step.
 */
export function useBoardDoc(boardId: string) {
	const [board, setBoard] = useState<Board>(
		() => loadLocal(boardId) ?? (boardId === "main" ? starterBoard() : { v: 1, name: "Untitled board", elements: [] }),
	);
	const [status, setStatus] = useState<SyncStatus>("connecting");
	const [presence, setPresence] = useState(1);
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
			if (fromServer) return;
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
		const prev = past.current.pop();
		if (!prev) return;
		future.current.push(boardRef.current);
		syncHistory();
		set(prev);
	}, [set, syncHistory]);

	const redo = useCallback(() => {
		const next = future.current.pop();
		if (!next) return;
		past.current.push(boardRef.current);
		syncHistory();
		set(next);
	}, [set, syncHistory]);

	// Live connection with reconnect
	useEffect(() => {
		let closed = false;
		let attempt = 0;
		let retry: ReturnType<typeof setTimeout> | null = null;

		const connect = () => {
			setStatus((s) => (s === "live" ? "connecting" : s));
			const protocol = location.protocol === "https:" ? "wss:" : "ws:";
			const socket = new WebSocket(`${protocol}//${location.host}/ws?board=${encodeURIComponent(boardId)}`);
			ws.current = socket;

			socket.onopen = () => {
				attempt = 0;
				setStatus("live");
				setError(null);
			};
			socket.onmessage = (event) => {
				let msg: { type?: string; doc?: unknown; count?: number; message?: string };
				try {
					msg = JSON.parse(event.data);
				} catch {
					return;
				}
				if (msg.type === "doc") {
					const doc = msg.doc === null ? null : parseBoard(msg.doc);
					// Nothing saved yet, or we edited while offline: our copy wins.
					if (!doc || unsynced.current) flushSend();
					else if (!before.current) set(doc, true);
				} else if (msg.type === "presence" && typeof msg.count === "number") {
					setPresence(Math.max(1, msg.count));
				} else if (msg.type === "error" && typeof msg.message === "string") {
					setError(msg.message);
				}
			};
			socket.onclose = () => {
				if (ws.current === socket) ws.current = null;
				if (closed) return;
				setStatus("offline");
				setPresence(1);
				attempt += 1;
				retry = setTimeout(connect, Math.min(15_000, 500 * 2 ** attempt));
			};
		};
		// Deferred so React StrictMode's mount/unmount/mount opens one socket, not two.
		retry = setTimeout(connect, 0);

		return () => {
			closed = true;
			if (retry) clearTimeout(retry);
			ws.current?.close();
			ws.current = null;
		};
	}, [boardId, flushSend, set]);

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
		error,
		dismissError: () => setError(null),
	};
}

export type BoardDoc = ReturnType<typeof useBoardDoc>;
