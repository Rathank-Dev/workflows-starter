import {
	contains,
	isBox,
	newId,
	type Board,
	type BoardEl,
	type BoxEl,
	type EdgeEl,
} from "../../shared/board";

/** Pure board edits. Each returns a new Board. */

export function addElements(board: Board, els: BoardEl[]): Board {
	const frames = els.filter((e) => e.type === "frame");
	const rest = els.filter((e) => e.type !== "frame");
	// Frames go after existing frames so they paint beneath shapes.
	const lastFrame = board.elements.reduce((acc, e, i) => (e.type === "frame" ? i : acc), -1);
	const elements = [...board.elements];
	elements.splice(lastFrame + 1, 0, ...frames);
	elements.push(...rest);
	return { ...board, elements };
}

export function patchElements(board: Board, ids: Set<string>, patch: (el: BoardEl) => BoardEl): Board {
	let changed = false;
	const elements = board.elements.map((el) => {
		if (!ids.has(el.id)) return el;
		const next = patch(el);
		if (next !== el) changed = true;
		return next;
	});
	return changed ? { ...board, elements } : board;
}

/** Deletes elements and any edges attached to them. */
export function deleteElements(board: Board, ids: Set<string>): Board {
	if (ids.size === 0) return board;
	const elements = board.elements.filter(
		(el) => !ids.has(el.id) && !(el.type === "edge" && (ids.has(el.from) || ids.has(el.to))),
	);
	return elements.length === board.elements.length ? board : { ...board, elements };
}

/** Shapes and text that sit fully inside a frame move with it. */
export function frameChildren(board: Board, frameIds: Iterable<string>): string[] {
	const frames = [...frameIds]
		.map((id) => board.elements.find((e) => e.id === id))
		.filter((e): e is BoxEl => !!e && e.type === "frame");
	if (frames.length === 0) return [];
	return board.elements
		.filter((el): el is BoxEl => isBox(el) && el.type !== "frame" && frames.some((f) => contains(f, el)))
		.map((el) => el.id);
}

/**
 * Copies elements with fresh ids, offset by (dx, dy). Edges are copied only
 * when both ends are in the copy.
 */
export function cloneElements(source: BoardEl[], dx: number, dy: number): BoardEl[] {
	const map = new Map<string, string>();
	const out: BoardEl[] = [];
	for (const el of source) {
		if (!isBox(el)) continue;
		const id = newId();
		map.set(el.id, id);
		out.push({ ...el, id, x: el.x + dx, y: el.y + dy });
	}
	for (const el of source) {
		if (el.type !== "edge") continue;
		const from = map.get(el.from);
		const to = map.get(el.to);
		if (from && to) out.push({ ...el, id: newId(), from, to } satisfies EdgeEl);
	}
	return out;
}

/** The selected elements plus edges between them, for copy and duplicate. */
export function collectForCopy(board: Board, ids: Set<string>): BoardEl[] {
	const expanded = new Set(ids);
	for (const id of frameChildren(board, ids)) expanded.add(id);
	return board.elements.filter(
		(el) =>
			expanded.has(el.id) || (el.type === "edge" && expanded.has(el.from) && expanded.has(el.to)),
	);
}

export function reorder(board: Board, ids: Set<string>, toFront: boolean): Board {
	const picked = board.elements.filter((e) => ids.has(e.id) && e.type !== "frame");
	if (picked.length === 0) return board;
	const rest = board.elements.filter((e) => !picked.includes(e));
	if (toFront) return { ...board, elements: [...rest, ...picked] };
	const lastFrame = rest.reduce((acc, e, i) => (e.type === "frame" ? i : acc), -1);
	rest.splice(lastFrame + 1, 0, ...picked);
	return { ...board, elements: rest };
}
