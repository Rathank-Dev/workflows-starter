import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
	DEFAULT_SIZE,
	FONT_PX,
	FRAME_HEADER,
	boundsOf,
	contains,
	edgeGeometry,
	intersects,
	isBox,
	newId,
	parseBoard,
	type Board,
	type BoardEl,
	type BoxEl,
	type EdgeEl,
	type FrameEl,
	type Point,
	type Rect,
	type ShapeEl,
	type ShapeKind,
	type TextEl,
} from "../../shared/board";
import { buildTemplate, templateSize, type FlowTemplate } from "../../shared/templates";
import {
	BoardMenu,
	ContextBar,
	EmptyHint,
	HelpPanel,
	HistoryBar,
	ShareBar,
	TemplatesPanel,
	Toast,
	Toolbar,
	ZoomBar,
	type ContextActions,
} from "./chrome";
import { TOOL_KEYS, type Tool } from "./tools";
import { boardToPng, boardToSvg, download, fileSafe } from "./exporting";
import { addElements, cloneElements, collectForCopy, deleteElements, frameChildren, patchElements, reorder } from "./ops";
import { EdgeMarkers, Scene } from "./Scene";
import { BOARD_FONT, LINE_HEIGHT, clearTextCache, lineHeightPx, textBoxFor, wrapText } from "./text";
import { useBoardDoc } from "./useBoardDoc";

interface Viewport {
	x: number;
	y: number;
	zoom: number;
}

type Corner = "nw" | "ne" | "sw" | "se";
type Side = "n" | "e" | "s" | "w";

type Drag =
	| { mode: "pan"; sx: number; sy: number; vx: number; vy: number }
	| { mode: "move"; start: Point; origin: Map<string, Point>; moved: boolean; sx: number; sy: number }
	| { mode: "resize"; id: string; corner: Corner; start: Point; rect: Rect }
	| { mode: "marquee"; start: Point; base: Set<string> }
	| { mode: "create"; tool: "frame" | "text" | ShapeKind; start: Point }
	| { mode: "connect"; from: string; side: Side | null; start: Point; sx: number; sy: number };

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 4;
const CREATE_TOOLS = new Set<Tool>(["frame", "text", "rect", "pill", "diamond", "cylinder", "note"]);

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const normRect = (a: Point, b: Point): Rect => ({
	x: Math.min(a.x, b.x),
	y: Math.min(a.y, b.y),
	w: Math.abs(a.x - b.x),
	h: Math.abs(a.y - b.y),
});

function isTypingTarget(t: EventTarget | null) {
	return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

/** Height a text element needs for its wrapped lines. */
function fitTextHeight(el: TextEl): number {
	return Math.ceil(wrapText(el.text || " ", el.w, el.textSize, el.bold).length * lineHeightPx(el.textSize)) + 4;
}

export function Editor({ boardId }: { boardId: string }) {
	const doc = useBoardDoc(boardId);
	const { board, boardRef } = doc;

	const svgRef = useRef<SVGSVGElement>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
	const vpRef = useRef(vp);

	const [tool, setTool] = useState<Tool>("select");
	const [selection, setSelection] = useState<Set<string>>(new Set());
	const selectionRef = useRef(selection);
	useLayoutEffect(() => {
		vpRef.current = vp;
		selectionRef.current = selection;
	});
	const [editingId, setEditingId] = useState<string | null>(null);
	const [marquee, setMarquee] = useState<Rect | null>(null);
	const [createDraft, setCreateDraft] = useState<Rect | null>(null);
	const [connectDraft, setConnectDraft] = useState<{ from: string; to: Point; target: string | null } | null>(null);
	const [spaceHeld, setSpaceHeld] = useState(false);
	const [panning, setPanning] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [templatesOpen, setTemplatesOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [, setFontsTick] = useState(0);

	const drag = useRef<Drag | null>(null);
	const clipboard = useRef<BoardEl[]>([]);
	const pasteCount = useRef(0);
	const fitted = useRef(false);

	const byId = useMemo(() => new Map(board.elements.map((e) => [e.id, e])), [board]);
	const selected = useMemo(
		() => [...selection].map((id) => byId.get(id)).filter((e): e is BoardEl => !!e),
		[selection, byId],
	);

	const say = useCallback((msg: string) => {
		setToast(msg);
		window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2400);
	}, []);

	useEffect(() => {
		if (doc.error) say(doc.error);
	}, [doc.error, say]);

	// Re-measure text once web fonts arrive
	useEffect(() => {
		document.fonts?.ready.then(() => {
			clearTextCache();
			setFontsTick((t) => t + 1);
		});
	}, []);

	// Track canvas size
	useLayoutEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		const ro = new ResizeObserver(([entry]) => {
			setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
		});
		ro.observe(svg);
		return () => ro.disconnect();
	}, []);

	/* -------------------------------------------------------------- */
	/* Viewport                                                        */
	/* -------------------------------------------------------------- */

	const toWorld = useCallback((clientX: number, clientY: number): Point => {
		const r = svgRef.current!.getBoundingClientRect();
		const v = vpRef.current;
		return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
	}, []);

	const zoomAt = useCallback((sx: number, sy: number, zoom: number) => {
		setVp((v) => {
			const z = clampZoom(zoom);
			const wx = (sx - v.x) / v.zoom;
			const wy = (sy - v.y) / v.zoom;
			return { zoom: z, x: sx - wx * z, y: sy - wy * z };
		});
	}, []);

	const zoomBy = useCallback(
		(factor: number) => zoomAt(size.w / 2, size.h / 2, vpRef.current.zoom * factor),
		[zoomAt, size],
	);

	const fitTo = useCallback(
		(rect: Rect | null) => {
			if (!rect || size.w === 0) return;
			const pad = 80;
			const zoom = clampZoom(Math.min((size.w - pad * 2) / rect.w, (size.h - pad * 2) / rect.h, 1.25));
			setVp({
				zoom,
				x: size.w / 2 - (rect.x + rect.w / 2) * zoom,
				y: size.h / 2 - (rect.y + rect.h / 2) * zoom,
			});
		},
		[size],
	);

	const fitBoard = useCallback(() => {
		fitTo(boundsOf(boardRef.current.elements.filter(isBox)));
	}, [fitTo, boardRef]);

	useEffect(() => {
		if (fitted.current || size.w === 0) return;
		fitted.current = true;
		fitBoard();
	}, [size, fitBoard]);

	// Wheel: pan, or zoom with Ctrl/Cmd (trackpad pinch sends ctrlKey)
	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			if (e.ctrlKey || e.metaKey) {
				const r = svg.getBoundingClientRect();
				const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
				zoomAt(e.clientX - r.left, e.clientY - r.top, vpRef.current.zoom * factor);
			} else {
				const k = e.deltaMode === 1 ? 16 : 1;
				const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
				const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
				setVp((v) => ({ ...v, x: v.x - dx * k, y: v.y - dy * k }));
			}
		};
		svg.addEventListener("wheel", onWheel, { passive: false });
		return () => svg.removeEventListener("wheel", onWheel);
	}, [zoomAt]);

	/* -------------------------------------------------------------- */
	/* Edits                                                           */
	/* -------------------------------------------------------------- */

	const insert = useCallback(
		(els: BoardEl[], select: string[] = els.filter(isBox).map((e) => e.id)) => {
			doc.commit((b) => addElements(b, els));
			setSelection(new Set(select));
		},
		[doc],
	);

	const removeSelected = useCallback(() => {
		const ids = selectionRef.current;
		if (ids.size === 0) return;
		doc.commit((b) => deleteElements(b, ids));
		setSelection(new Set());
	}, [doc]);

	const duplicateSelected = useCallback(() => {
		const els = collectForCopy(boardRef.current, selectionRef.current);
		if (els.length === 0) return;
		const copies = cloneElements(els, 32, 32);
		insert(copies);
	}, [boardRef, insert]);

	const patchSelected = useCallback(
		(patch: (el: BoardEl) => BoardEl) => doc.commit((b) => patchElements(b, selectionRef.current, patch)),
		[doc],
	);

	const contextActions: ContextActions = useMemo(
		() => ({
			setColor: (color) => patchSelected((el) => (el.type === "shape" ? { ...el, color } : el)),
			setShape: (shape) => patchSelected((el) => (el.type === "shape" ? { ...el, shape } : el)),
			setTextSize: (textSize) =>
				patchSelected((el) => {
					if (el.type === "shape") return { ...el, textSize };
					if (el.type === "text") {
						const next = { ...el, textSize };
						return { ...next, h: fitTextHeight(next) };
					}
					return el;
				}),
			toggleBold: () => {
				const first = selectionRef.current.values().next().value;
				const el = first ? boardRef.current.elements.find((e) => e.id === first) : undefined;
				const bold = !(el && (el.type === "shape" || el.type === "text") && el.bold);
				patchSelected((e) => (e.type === "shape" || e.type === "text" ? { ...e, bold } : e));
			},
			setEdge: (patch) => patchSelected((el) => (el.type === "edge" ? { ...el, ...patch } : el)),
			duplicate: duplicateSelected,
			remove: removeSelected,
			toFront: () => doc.commit((b) => reorder(b, selectionRef.current, true)),
			toBack: () => doc.commit((b) => reorder(b, selectionRef.current, false)),
		}),
		[patchSelected, duplicateSelected, removeSelected, doc, boardRef],
	);

	const makeShape = useCallback((kind: ShapeKind, center: Point, from?: ShapeEl): ShapeEl => {
		const s = from && from.shape === kind ? { w: from.w, h: from.h } : DEFAULT_SIZE[kind];
		return {
			id: newId(),
			type: "shape",
			shape: kind,
			color: from?.color ?? (kind === "note" ? "yellow" : kind === "diamond" ? "yellow" : "white"),
			text: "",
			textSize: "m",
			bold: kind === "pill",
			x: Math.round(center.x - s.w / 2),
			y: Math.round(center.y - s.h / 2),
			w: s.w,
			h: s.h,
		};
	}, []);

	const newEdge = (from: string, to: string): EdgeEl => ({
		id: newId(),
		type: "edge",
		from,
		to,
		label: "",
		dashed: false,
		arrow: "end",
		route: "elbow",
	});

	const insertTemplate = useCallback(
		(t: FlowTemplate) => {
			const s = templateSize(t);
			const v = vpRef.current;
			const cx = (size.w / 2 - v.x) / v.zoom;
			const cy = (size.h / 2 - v.y) / v.zoom;
			let origin = { x: Math.round(cx - s.w / 2), y: Math.round(cy - s.h / 2) };
			// Never drop a template on top of existing work: go to the right of it.
			const boxes = boardRef.current.elements.filter(isBox);
			if (boxes.some((el) => intersects(el, { ...origin, ...s }))) {
				const all = boundsOf(boxes)!;
				origin = { x: Math.round(all.x + all.w + 120), y: Math.round(all.y) };
			}
			const els = buildTemplate(t, origin);
			insert(els, [els[0].id]);
			setTemplatesOpen(false);
			fitTo(els[0] as FrameEl);
			say(`Added “${t.title}”`);
		},
		[insert, fitTo, size, say, boardRef],
	);

	/* -------------------------------------------------------------- */
	/* Pointer                                                         */
	/* -------------------------------------------------------------- */

	const hitAt = (clientX: number, clientY: number, exclude?: string): string | null => {
		const els = document.elementsFromPoint(clientX, clientY);
		for (const node of els) {
			const id = node.closest("[data-id]")?.getAttribute("data-id");
			if (!id || id === exclude) continue;
			const el = boardRef.current.elements.find((e) => e.id === id);
			if (el && (el.type === "shape" || el.type === "text")) return id;
		}
		return null;
	};

	const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
		if (editingId) {
			(document.activeElement as HTMLElement | null)?.blur();
		}
		setTemplatesOpen(false);
		const target = e.target as Element;
		e.currentTarget.setPointerCapture(e.pointerId);
		const p = toWorld(e.clientX, e.clientY);

		if (e.button === 1 || (e.button === 0 && (spaceHeld || tool === "hand"))) {
			const v = vpRef.current;
			drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
			setPanning(true);
			return;
		}
		if (e.button !== 0) return;

		if (CREATE_TOOLS.has(tool)) {
			drag.current = { mode: "create", tool: tool as "frame" | "text" | ShapeKind, start: p };
			return;
		}

		const hitId = target.closest("[data-id]")?.getAttribute("data-id") ?? null;
		const hit = hitId ? byId.get(hitId) : undefined;

		if (tool === "connect") {
			if (hit && (hit.type === "shape" || hit.type === "text")) {
				drag.current = { mode: "connect", from: hit.id, side: null, start: p, sx: e.clientX, sy: e.clientY };
				setConnectDraft({ from: hit.id, to: p, target: null });
			}
			return;
		}

		const handle = target.closest("[data-handle]")?.getAttribute("data-handle") as Corner | null;
		if (handle && selected.length === 1 && isBox(selected[0])) {
			const el = selected[0];
			drag.current = { mode: "resize", id: el.id, corner: handle, start: p, rect: { x: el.x, y: el.y, w: el.w, h: el.h } };
			setDragging(true);
			return;
		}

		const knob = target.closest("[data-knob]")?.getAttribute("data-knob") as Side | null;
		if (knob && selected.length === 1) {
			drag.current = { mode: "connect", from: selected[0].id, side: knob, start: p, sx: e.clientX, sy: e.clientY };
			setConnectDraft({ from: selected[0].id, to: p, target: null });
			return;
		}

		if (hit) {
			let sel = selection;
			if (e.shiftKey) {
				sel = new Set(selection);
				if (sel.has(hit.id)) {
					sel.delete(hit.id);
					setSelection(sel);
					return;
				}
				sel.add(hit.id);
			} else if (!selection.has(hit.id)) {
				sel = new Set([hit.id]);
			}
			setSelection(sel);
			if (hit.type === "edge") return;

			const b = boardRef.current;
			const ids = new Set([...sel].filter((id) => byId.get(id)?.type !== "edge"));
			for (const id of frameChildren(b, ids)) ids.add(id);
			const origin = new Map<string, Point>();
			for (const id of ids) {
				const el = byId.get(id);
				if (el && isBox(el)) origin.set(id, { x: el.x, y: el.y });
			}
			drag.current = { mode: "move", start: p, origin, moved: false, sx: e.clientX, sy: e.clientY };
			setDragging(true);
			return;
		}

		// Empty canvas or a frame's body
		const base = e.shiftKey ? new Set(selection) : new Set<string>();
		if (!e.shiftKey) setSelection(base);
		drag.current = { mode: "marquee", start: p, base };
	};

	const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
		const d = drag.current;
		if (!d) return;
		const p = toWorld(e.clientX, e.clientY);

		switch (d.mode) {
			case "pan":
				setVp((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
				break;
			case "move": {
				if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
				d.moved = true;
				const dx = Math.round(p.x - d.start.x);
				const dy = Math.round(p.y - d.start.y);
				doc.preview((b) =>
					patchElements(b, new Set(d.origin.keys()), (el) => {
						const o = d.origin.get(el.id);
						return o && isBox(el) ? { ...el, x: o.x + dx, y: o.y + dy } : el;
					}),
				);
				break;
			}
			case "resize": {
				const el = byId.get(d.id);
				if (!el || !isBox(el)) return;
				const min = el.type === "frame" ? { w: 200, h: FRAME_HEADER + 40 } : { w: 32, h: 24 };
				const r = d.rect;
				const dx = p.x - d.start.x;
				const dy = p.y - d.start.y;
				let { x, y, w, h } = r;
				if (d.corner.includes("e")) w = Math.max(min.w, r.w + dx);
				if (d.corner.includes("s")) h = Math.max(min.h, r.h + dy);
				if (d.corner.includes("w")) {
					w = Math.max(min.w, r.w - dx);
					x = r.x + r.w - w;
				}
				if (d.corner.includes("n")) {
					h = Math.max(min.h, r.h - dy);
					y = r.y + r.h - h;
				}
				const next = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
				doc.preview((b) =>
					patchElements(b, new Set([d.id]), (el) => {
						if (!isBox(el)) return el;
						const resized = { ...el, ...next };
						return resized.type === "text" ? { ...resized, h: Math.max(next.h, fitTextHeight(resized)) } : resized;
					}),
				);
				break;
			}
			case "marquee": {
				const r = normRect(d.start, p);
				setMarquee(r);
				const sel = new Set(d.base);
				for (const el of boardRef.current.elements) {
					if (!isBox(el)) continue;
					if (el.type === "frame" ? contains(r, el) : intersects(r, el)) sel.add(el.id);
				}
				setSelection(sel);
				break;
			}
			case "create":
				setCreateDraft(normRect(d.start, p));
				break;
			case "connect":
				setConnectDraft({ from: d.from, to: p, target: hitAt(e.clientX, e.clientY, d.from) });
				break;
		}
	};

	const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
		const d = drag.current;
		drag.current = null;
		if (!d) return;
		const p = toWorld(e.clientX, e.clientY);

		switch (d.mode) {
			case "pan":
				setPanning(false);
				break;
			case "move":
			case "resize":
				setDragging(false);
				doc.settle();
				break;
			case "marquee":
				setMarquee(null);
				break;
			case "create": {
				setCreateDraft(null);
				const r = normRect(d.start, p);
				const dragged = r.w * vpRef.current.zoom > 6 && r.h * vpRef.current.zoom > 6;
				const def = DEFAULT_SIZE[d.tool];
				const rect = dragged
					? { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(32, Math.round(r.w)), h: Math.max(24, Math.round(r.h)) }
					: { x: Math.round(d.start.x - def.w / 2), y: Math.round(d.start.y - def.h / 2), ...def };
				let el: BoxEl;
				if (d.tool === "frame") {
					el = { id: newId(), type: "frame", ...rect, title: "New frame", subtitle: "" };
				} else if (d.tool === "text") {
					el = { id: newId(), type: "text", ...rect, text: "", textSize: "m", bold: false };
				} else {
					el = { ...makeShape(d.tool, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }), ...rect };
				}
				insert([el]);
				setTool("select");
				setEditingId(el.id);
				break;
			}
			case "connect": {
				setConnectDraft(null);
				const target = hitAt(e.clientX, e.clientY, d.from);
				const source = boardRef.current.elements.find((x) => x.id === d.from);
				if (!source || !isBox(source)) break;
				if (target) {
					const exists = boardRef.current.elements.some(
						(x) => x.type === "edge" && x.from === d.from && x.to === target,
					);
					if (!exists) {
						const edge = newEdge(d.from, target);
						doc.commit((b) => addElements(b, [edge]));
					}
					setSelection(new Set([target]));
					break;
				}
				if (!d.side) break;
				// Dropped on empty canvas, or clicked a dot: add the next step there.
				const tmpl = source.type === "shape" ? source : undefined;
				const kind = tmpl?.shape ?? "rect";
				const clicked = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4;
				let center = p;
				if (clicked) {
					const s = tmpl ? { w: tmpl.w, h: tmpl.h } : DEFAULT_SIZE[kind];
					const gap = 64;
					const c = { x: source.x + source.w / 2, y: source.y + source.h / 2 };
					center = {
						n: { x: c.x, y: source.y - gap - s.h / 2 },
						s: { x: c.x, y: source.y + source.h + gap + s.h / 2 },
						e: { x: source.x + source.w + gap + s.w / 2, y: c.y },
						w: { x: source.x - gap - s.w / 2, y: c.y },
					}[d.side];
				}
				const shape = makeShape(kind, center, tmpl);
				insert([shape, newEdge(source.id, shape.id)], [shape.id]);
				setEditingId(shape.id);
				break;
			}
		}
	};

	const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
		if (tool !== "select") return;
		const target = e.target as Element;
		if (target.closest("[data-handle],[data-knob]")) return;
		const hitId = target.closest("[data-id]")?.getAttribute("data-id");
		if (hitId) {
			setSelection(new Set([hitId]));
			setEditingId(hitId);
			return;
		}
		const shape = makeShape("rect", toWorld(e.clientX, e.clientY));
		insert([shape]);
		setEditingId(shape.id);
	};

	/* -------------------------------------------------------------- */
	/* Keyboard                                                        */
	/* -------------------------------------------------------------- */

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (isTypingTarget(e.target)) return;
			const mod = e.metaKey || e.ctrlKey;
			const key = e.key.toLowerCase();

			if (e.key === " ") {
				e.preventDefault();
				setSpaceHeld(true);
				return;
			}
			if (mod && key === "z") {
				e.preventDefault();
				if (e.shiftKey) doc.redo();
				else doc.undo();
				return;
			}
			if (mod && key === "y") {
				e.preventDefault();
				doc.redo();
				return;
			}
			if (mod && (key === "=" || key === "+")) {
				e.preventDefault();
				zoomBy(1.25);
				return;
			}
			if (mod && key === "-") {
				e.preventDefault();
				zoomBy(0.8);
				return;
			}
			if (mod && key === "0") {
				e.preventDefault();
				zoomAt(size.w / 2, size.h / 2, 1);
				return;
			}
			if (mod && key === "a") {
				e.preventDefault();
				setSelection(new Set(boardRef.current.elements.filter(isBox).map((x) => x.id)));
				return;
			}
			if (mod && (key === "c" || key === "x")) {
				const els = collectForCopy(boardRef.current, selectionRef.current);
				if (els.length === 0) return;
				clipboard.current = els;
				pasteCount.current = 0;
				if (key === "x") removeSelected();
				else say(`Copied ${els.filter(isBox).length} item${els.filter(isBox).length === 1 ? "" : "s"}`);
				return;
			}
			if (mod && key === "v") {
				if (clipboard.current.length === 0) return;
				pasteCount.current += 1;
				const off = 32 * pasteCount.current;
				insert(cloneElements(clipboard.current, off, off));
				return;
			}
			if (mod && key === "d") {
				e.preventDefault();
				duplicateSelected();
				return;
			}
			if (mod && key === "b") {
				e.preventDefault();
				contextActions.toggleBold();
				return;
			}
			if (mod) return;

			if (e.key === "Delete" || e.key === "Backspace") {
				e.preventDefault();
				removeSelected();
			} else if (e.key === "Escape") {
				setSelection(new Set());
				setTool("select");
				setTemplatesOpen(false);
				setHelpOpen(false);
			} else if (e.key === "Enter") {
				const only = selectionRef.current.size === 1 ? [...selectionRef.current][0] : null;
				if (only) {
					e.preventDefault();
					setEditingId(only);
				}
			} else if (e.key.startsWith("Arrow")) {
				const step = e.shiftKey ? 10 : 1;
				const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
				const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
				const ids = new Set(selectionRef.current);
				if (ids.size === 0) return;
				e.preventDefault();
				for (const id of frameChildren(boardRef.current, ids)) ids.add(id);
				doc.commit((b) => patchElements(b, ids, (el) => (isBox(el) ? { ...el, x: el.x + dx, y: el.y + dy } : el)));
			} else if (e.key === "!" || (e.shiftKey && e.code === "Digit1")) {
				fitBoard();
			} else if (e.key === "?") {
				setHelpOpen((o) => !o);
			} else if (e.key === "]") {
				contextActions.toFront();
			} else if (e.key === "[") {
				contextActions.toBack();
			} else if (!e.shiftKey && !e.altKey && TOOL_KEYS[key]) {
				setTool(TOOL_KEYS[key]);
			}
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key === " ") setSpaceHeld(false);
		};
		const onBlur = () => setSpaceHeld(false);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
		};
	}, [doc, zoomBy, zoomAt, size, boardRef, removeSelected, duplicateSelected, insert, contextActions, fitBoard, say]);

	/* -------------------------------------------------------------- */
	/* Menu actions                                                    */
	/* -------------------------------------------------------------- */

	const exportPng = async () => {
		try {
			download(await boardToPng(boardRef.current), `${fileSafe(boardRef.current.name)}.png`);
			say("Exported PNG");
		} catch (err) {
			say(err instanceof Error ? err.message : "PNG export failed.");
		}
	};
	const exportSvg = async () => {
		const { svg } = await boardToSvg(boardRef.current);
		download(new Blob([svg], { type: "image/svg+xml" }), `${fileSafe(boardRef.current.name)}.svg`);
		say("Exported SVG");
	};
	const exportJson = () => {
		download(
			new Blob([JSON.stringify(boardRef.current, null, "\t")], { type: "application/json" }),
			`${fileSafe(boardRef.current.name)}.json`,
		);
	};
	const importJson = async (file: File) => {
		try {
			const parsed = parseBoard(JSON.parse(await file.text()));
			if (!parsed) {
				say("That file isn’t a Linework board.");
				return;
			}
			doc.commit(() => parsed);
			setSelection(new Set());
			fitted.current = false;
			setSize((s) => ({ ...s }));
			say(`Opened “${parsed.name}”`);
		} catch {
			say("That file isn’t valid JSON.");
		}
	};
	const newBoard = () => {
		// The link is the only key to a board, so make it unguessable (128 bits).
		const bytes = crypto.getRandomValues(new Uint8Array(16));
		const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
		window.location.search = `?board=${id}`;
	};
	const share = async () => {
		try {
			await navigator.clipboard.writeText(window.location.href);
			say("Link copied. Anyone with it can edit this board.");
		} catch {
			say(`Copy this link: ${window.location.href}`);
		}
	};

	/* -------------------------------------------------------------- */
	/* Render                                                          */
	/* -------------------------------------------------------------- */

	const z = vp.zoom;
	const single = selected.length === 1 ? selected[0] : null;
	const selectionBounds = boundsOf(
		selected.flatMap((el): Rect[] => {
			if (isBox(el)) return [el];
			const a = byId.get(el.from);
			const b = byId.get(el.to);
			if (!a || !b || !isBox(a) || !isBox(b)) return [];
			const g = edgeGeometry(a, b, el.route);
			return [normRect(g.start, g.end)];
		}),
	);
	const showContext = selected.length > 0 && !editingId && !dragging && !marquee && !connectDraft;
	const contextPos = selectionBounds
		? {
				left: Math.min(Math.max(12, selectionBounds.x * z + vp.x + (selectionBounds.w * z) / 2), size.w - 12),
				top: (() => {
					const above = selectionBounds.y * z + vp.y - 60;
					const below = (selectionBounds.y + selectionBounds.h) * z + vp.y + 16;
					return above >= 76 ? above : below < size.h - 120 ? below : 76;
				})(),
			}
		: null;

	const cursor = panning
		? "grabbing"
		: spaceHeld || tool === "hand"
			? "grab"
			: CREATE_TOOLS.has(tool) || tool === "connect"
				? "crosshair"
				: "default";

	const editing = editingId ? byId.get(editingId) : undefined;

	return (
		<div className="editor">
			<svg
				ref={svgRef}
				className="canvas"
				style={{ cursor }}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onDoubleClick={onDoubleClick}
				role="application"
				aria-label="Board canvas"
			>
				<defs>
					<pattern
						id="lw-grid"
						width={24 * z}
						height={24 * z}
						patternUnits="userSpaceOnUse"
						x={vp.x % (24 * z)}
						y={vp.y % (24 * z)}
					>
						<circle cx={1} cy={1} r={z > 0.4 ? 1 : 0.6} fill="var(--grid)" />
					</pattern>
				</defs>
				<rect width="100%" height="100%" fill="url(#lw-grid)" />
				<g transform={`translate(${vp.x} ${vp.y}) scale(${z})`}>
					<EdgeMarkers />
					<Scene board={board} editingId={editingId} />

					{/* Selection overlay */}
					<g className="overlay">
						{selected.map((el) => {
							if (isBox(el)) {
								return (
									<rect
										key={el.id}
										x={el.x - 3 / z}
										y={el.y - 3 / z}
										width={el.w + 6 / z}
										height={el.h + 6 / z}
										rx={4 / z}
										fill="none"
										stroke="var(--select)"
										strokeWidth={2 / z}
									/>
								);
							}
							const a = byId.get(el.from);
							const b = byId.get(el.to);
							if (!a || !b || !isBox(a) || !isBox(b)) return null;
							return (
								<path
									key={el.id}
									d={edgeGeometry(a, b, el.route).d}
									fill="none"
									stroke="var(--select)"
									strokeWidth={3.5 / z}
									strokeOpacity={0.6}
								/>
							);
						})}
						{single && isBox(single) && !editingId && (
							<g>
								{(["nw", "ne", "sw", "se"] as Corner[]).map((c) => {
									const hx = c.includes("w") ? single.x - 3 / z : single.x + single.w + 3 / z;
									const hy = c.includes("n") ? single.y - 3 / z : single.y + single.h + 3 / z;
									const s = 10 / z;
									return (
										<rect
											key={c}
											data-handle={c}
											x={hx - s / 2}
											y={hy - s / 2}
											width={s}
											height={s}
											rx={2 / z}
											fill="var(--chrome)"
											stroke="var(--select)"
											strokeWidth={1.5 / z}
											style={{ cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize", pointerEvents: "all" }}
										/>
									);
								})}
								{single.type !== "frame" &&
									(["n", "e", "s", "w"] as Side[]).map((sd) => {
										const off = 20 / z;
										const cx =
											sd === "e" ? single.x + single.w + off : sd === "w" ? single.x - off : single.x + single.w / 2;
										const cy =
											sd === "s" ? single.y + single.h + off : sd === "n" ? single.y - off : single.y + single.h / 2;
										return (
											<g key={sd} data-knob={sd} className="knob" style={{ pointerEvents: "all" }}>
												<circle cx={cx} cy={cy} r={11 / z} fill="transparent" />
												<circle cx={cx} cy={cy} r={6 / z} fill="var(--select)" stroke="var(--chrome)" strokeWidth={2 / z} />
											</g>
										);
									})}
							</g>
						)}
						{marquee && (
							<rect
								x={marquee.x}
								y={marquee.y}
								width={marquee.w}
								height={marquee.h}
								fill="var(--select)"
								fillOpacity={0.08}
								stroke="var(--select)"
								strokeWidth={1 / z}
							/>
						)}
						{createDraft && (
							<rect
								x={createDraft.x}
								y={createDraft.y}
								width={createDraft.w}
								height={createDraft.h}
								rx={tool === "frame" ? 8 : 10}
								fill="var(--select)"
								fillOpacity={0.06}
								stroke="var(--select)"
								strokeDasharray={`${6 / z} ${4 / z}`}
								strokeWidth={1.5 / z}
							/>
						)}
						{connectDraft &&
							(() => {
								const from = byId.get(connectDraft.from);
								if (!from || !isBox(from)) return null;
								const target = connectDraft.target ? byId.get(connectDraft.target) : undefined;
								const d =
									target && isBox(target)
										? edgeGeometry(from, target, "elbow").d
										: `M ${from.x + from.w / 2} ${from.y + from.h / 2} L ${connectDraft.to.x} ${connectDraft.to.y}`;
								return (
									<g>
										{target && isBox(target) && (
											<rect
												x={target.x - 4 / z}
												y={target.y - 4 / z}
												width={target.w + 8 / z}
												height={target.h + 8 / z}
												rx={6 / z}
												fill="none"
												stroke="var(--select)"
												strokeWidth={2 / z}
											/>
										)}
										<path
											d={d}
											fill="none"
											stroke="var(--select)"
											strokeWidth={2 / z}
											strokeDasharray={`${6 / z} ${4 / z}`}
										/>
									</g>
								);
							})()}
					</g>
				</g>
			</svg>

			{editing && (
				<TextEditor
					key={editing.id}
					el={editing}
					board={board}
					vp={vp}
					onDone={(patch) => {
						setEditingId(null);
						if (!patch) return;
						if (editing.type === "text" && !String(patch.text ?? "").trim()) {
							setSelection(new Set());
							doc.commit((b) => deleteElements(b, new Set([editing.id])));
							return;
						}
						doc.commit((b) => {
							const el = b.elements.find((x) => x.id === editing.id);
							if (!el) return b;
							return patchElements(b, new Set([el.id]), (x) => {
								const next = { ...x, ...patch } as BoardEl;
								return next.type === "text" ? { ...next, h: fitTextHeight(next) } : next;
							});
						});
					}}
				/>
			)}

			<BoardMenu
				name={board.name}
				onRename={(name) => doc.commit((b) => ({ ...b, name }))}
				onExportPng={exportPng}
				onExportSvg={exportSvg}
				onExportJson={exportJson}
				onImportJson={importJson}
				onNewBoard={newBoard}
			/>
			<ShareBar status={doc.status} presence={doc.presence} onShare={share} />
			<Toolbar
				tool={tool}
				onTool={(t) => {
					setTool(t);
					setTemplatesOpen(false);
				}}
				templatesOpen={templatesOpen}
				onTemplates={() => setTemplatesOpen((o) => !o)}
			/>
			{templatesOpen && <TemplatesPanel onInsert={insertTemplate} onClose={() => setTemplatesOpen(false)} />}
			{helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
			<HistoryBar canUndo={doc.canUndo} canRedo={doc.canRedo} onUndo={doc.undo} onRedo={doc.redo} />
			<ZoomBar
				zoom={z}
				onZoomIn={() => zoomBy(1.25)}
				onZoomOut={() => zoomBy(0.8)}
				onReset={() => zoomAt(size.w / 2, size.h / 2, 1)}
				onFit={fitBoard}
				onHelp={() => setHelpOpen((o) => !o)}
			/>
			{showContext && contextPos && (
				<ContextBar selected={selected} left={contextPos.left} top={contextPos.top} actions={contextActions} />
			)}
			<EmptyHint board={board} />
			<Toast message={toast} />
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* In-place text editing                                               */
/* ------------------------------------------------------------------ */

type TextPatch = Partial<Pick<ShapeEl, "text"> & Pick<FrameEl, "title" | "subtitle"> & Pick<EdgeEl, "label">>;

function TextEditor({
	el,
	board,
	vp,
	onDone,
}: {
	el: BoardEl;
	board: Board;
	vp: Viewport;
	onDone: (patch: TextPatch | null) => void;
}) {
	const z = vp.zoom;
	const [text, setText] = useState(() =>
		el.type === "frame" ? el.title : el.type === "edge" ? el.label : el.text,
	);
	const [subtitle, setSubtitle] = useState(el.type === "frame" ? el.subtitle : "");
	const areaRef = useRef<HTMLTextAreaElement>(null);
	const done = useRef(false);

	const finish = (save: boolean) => {
		if (done.current) return;
		done.current = true;
		if (!save) return onDone(null);
		if (el.type === "frame") onDone({ title: text.trim() || "Untitled frame", subtitle: subtitle.trim() });
		else if (el.type === "edge") onDone({ label: text.trim().slice(0, 200) });
		else onDone({ text: text.slice(0, 2000) });
	};

	useLayoutEffect(() => {
		const a = areaRef.current;
		if (a) {
			a.focus();
			a.select();
		}
	}, []);

	// Grow the textarea with its content
	useLayoutEffect(() => {
		const a = areaRef.current;
		if (!a) return;
		a.style.height = "0px";
		a.style.height = `${a.scrollHeight}px`;
	}, [text, z]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		e.stopPropagation();
		if (e.key === "Escape") finish(true);
		else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) finish(true);
		else if (e.key === "Enter" && (el.type === "edge" || el.type === "frame") && !e.shiftKey) {
			e.preventDefault();
			finish(true);
		}
	};

	const screen = (x: number, y: number) => ({ left: x * z + vp.x, top: y * z + vp.y });

	if (el.type === "frame") {
		const pos = screen(el.x + 20, el.y + 12);
		return (
			<div
				className="frame-editor"
				style={{ ...pos, width: (el.w - 40) * z, fontSize: 24 * z }}
				onBlur={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node)) finish(true);
				}}
			>
				<textarea
					ref={areaRef}
					rows={1}
					value={text}
					aria-label="Frame title"
					maxLength={200}
					onChange={(e) => setText(e.target.value.replace(/\n/g, ""))}
					onKeyDown={onKeyDown}
				/>
				<input
					value={subtitle}
					aria-label="Frame subtitle"
					placeholder="Add a subtitle"
					maxLength={400}
					style={{ fontSize: 13 * z }}
					onChange={(e) => setSubtitle(e.target.value)}
					onKeyDown={onKeyDown}
				/>
			</div>
		);
	}

	if (el.type === "edge") {
		const a = board.elements.find((x) => x.id === el.from);
		const b = board.elements.find((x) => x.id === el.to);
		if (!a || !b || !isBox(a) || !isBox(b)) return null;
		const mid = edgeGeometry(a, b, el.route).mid;
		const w = 160;
		const pos = screen(mid.x, mid.y);
		return (
			<div className="label-editor" style={{ left: pos.left - (w * z) / 2, top: pos.top - 14 * z, width: w * z }}>
				<textarea
					ref={areaRef}
					rows={1}
					value={text}
					aria-label="Connector label"
					placeholder="Label"
					maxLength={200}
					style={{ fontSize: 12 * z }}
					onChange={(e) => setText(e.target.value.replace(/\n/g, ""))}
					onKeyDown={onKeyDown}
					onBlur={() => finish(true)}
				/>
			</div>
		);
	}

	const isText = el.type === "text";
	const px = FONT_PX[el.textSize] * z;
	const box = el.type === "shape" ? textBoxFor(el) : { w: el.w, cy: el.y + el.h / 2 };
	const left = isText ? el.x : el.x + (el.w - box.w) / 2;
	const pos = screen(left, el.y);
	return (
		<div
			className="shape-editor"
			data-align={isText ? "start" : "center"}
			style={{
				left: pos.left,
				top: isText ? pos.top : pos.top,
				width: box.w * z,
				height: isText ? undefined : el.h * z,
				paddingTop: el.type === "shape" ? (box.cy - (el.y + el.h / 2)) * 2 * z : 0,
			}}
		>
			<textarea
				ref={areaRef}
				rows={1}
				value={text}
				aria-label="Text"
				placeholder={isText ? "Type something" : ""}
				maxLength={2000}
				style={{
					fontSize: px,
					lineHeight: LINE_HEIGHT,
					fontWeight: el.bold ? 650 : 400,
					fontFamily: BOARD_FONT,
					textAlign: isText ? "left" : "center",
					color: isText ? "var(--board-ink)" : "#1D2330",
				}}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={onKeyDown}
				onBlur={() => finish(true)}
			/>
		</div>
	);
}
