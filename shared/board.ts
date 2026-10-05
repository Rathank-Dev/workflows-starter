/**
 * Board model shared by the editor (src/) and the Worker (worker/).
 *
 * A board is a flat, ordered list of elements. Array order is paint order:
 * later elements draw on top. Edges reference shapes by id.
 */

export type ColorKey =
	| "white"
	| "grey"
	| "red"
	| "orange"
	| "yellow"
	| "green"
	| "blue"
	| "purple";

export type ShapeKind = "rect" | "pill" | "diamond" | "cylinder" | "note";
export type TextSize = "s" | "m" | "l" | "xl";

interface Box {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ShapeEl extends Box {
	type: "shape";
	shape: ShapeKind;
	color: ColorKey;
	text: string;
	textSize: TextSize;
	bold: boolean;
}

export interface TextEl extends Box {
	type: "text";
	text: string;
	textSize: TextSize;
	bold: boolean;
}

export interface FrameEl extends Box {
	type: "frame";
	title: string;
	subtitle: string;
}

export interface EdgeEl {
	id: string;
	type: "edge";
	from: string;
	to: string;
	label: string;
	dashed: boolean;
	arrow: "end" | "both" | "none";
	/** elbow: Z-shaped; corner: one bend (L); straight: direct line */
	route: "elbow" | "corner" | "straight";
}

export type BoxEl = ShapeEl | TextEl | FrameEl;
export type BoardEl = BoxEl | EdgeEl;

export interface Board {
	v: 1;
	name: string;
	elements: BoardEl[];
}

export const COLORS: Record<ColorKey, { fill: string; stroke: string; label: string }> = {
	white: { fill: "#FFFFFF", stroke: "#B9C0CC", label: "White" },
	grey: { fill: "#E9ECF1", stroke: "#8D96A6", label: "Grey" },
	red: { fill: "#FFD6D6", stroke: "#D9484F", label: "Red" },
	orange: { fill: "#FFE1C7", stroke: "#DB7A1F", label: "Orange" },
	yellow: { fill: "#FFF0B3", stroke: "#C99A06", label: "Yellow" },
	green: { fill: "#CDEFD6", stroke: "#2E9455", label: "Green" },
	blue: { fill: "#D3E2FF", stroke: "#3D6BD6", label: "Blue" },
	purple: { fill: "#E4DCFF", stroke: "#7556D9", label: "Purple" },
};

export const COLOR_KEYS = Object.keys(COLORS) as ColorKey[];
export const SHAPE_KINDS: ShapeKind[] = ["rect", "pill", "diamond", "cylinder", "note"];
export const TEXT_SIZES: TextSize[] = ["s", "m", "l", "xl"];
export const FONT_PX: Record<TextSize, number> = { s: 12, m: 14, l: 18, xl: 28 };

export const DEFAULT_SIZE: Record<ShapeKind | "text" | "frame", { w: number; h: number }> = {
	rect: { w: 184, h: 68 },
	pill: { w: 184, h: 56 },
	diamond: { w: 168, h: 104 },
	cylinder: { w: 148, h: 104 },
	note: { w: 168, h: 168 },
	text: { w: 220, h: 36 },
	frame: { w: 720, h: 520 },
};

/** Height of the frame's title band; dragging it moves the frame. */
export const FRAME_HEADER = 72;

export const MAX_ELEMENTS = 4000;
export const MAX_TEXT = 2000;
export const MAX_DOC_BYTES = 1_500_000;

let counter = 0;
export function newId(): string {
	counter = (counter + 1) % 1_000_000;
	return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function isBox(el: BoardEl): el is BoxEl {
	return el.type !== "edge";
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export interface Point {
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export function contains(outer: Rect, inner: Rect): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.w <= outer.x + outer.w &&
		inner.y + inner.h <= outer.y + outer.h
	);
}

export function intersects(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function boundsOf(rects: Rect[]): Rect | null {
	if (rects.length === 0) return null;
	let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
	for (const r of rects) {
		x1 = Math.min(x1, r.x);
		y1 = Math.min(y1, r.y);
		x2 = Math.max(x2, r.x + r.w);
		y2 = Math.max(y2, r.y + r.h);
	}
	return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export interface EdgeGeometry {
	d: string;
	start: Point;
	end: Point;
	mid: Point;
}

/**
 * Routes an edge between two boxes, leaving and entering through the sides
 * that face each other.
 */
export function edgeGeometry(a: Rect, b: Rect, route: EdgeEl["route"]): EdgeGeometry {
	const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
	const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };

	// One bend: leave a's top or bottom, enter b's facing side. Needs the
	// boxes to be apart on both axes, otherwise fall back to an elbow.
	if (route === "corner") {
		const sx = ca.x;
		const ey = cb.y;
		const clearX = sx < b.x - 8 || sx > b.x + b.w + 8;
		const clearY = ey < a.y - 8 || ey > a.y + a.h + 8;
		if (clearX && clearY) {
			const start = { x: sx, y: ey > ca.y ? a.y + a.h : a.y };
			const end = { x: sx < cb.x ? b.x : b.x + b.w, y: ey };
			return {
				d: `M ${start.x} ${start.y} V ${end.y} H ${end.x}`,
				start,
				end,
				mid: { x: (start.x + end.x) / 2, y: end.y },
			};
		}
		route = "elbow";
	}

	const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
	const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
	const horizontal =
		gapX > 0 || gapY > 0 ? gapX > gapY : Math.abs(cb.x - ca.x) > Math.abs(cb.y - ca.y);

	let start: Point, end: Point, d: string, mid: Point;
	if (horizontal) {
		const right = cb.x > ca.x;
		start = { x: right ? a.x + a.w : a.x, y: ca.y };
		end = { x: right ? b.x : b.x + b.w, y: cb.y };
		if (route === "elbow" && Math.abs(start.y - end.y) > 1) {
			const mx = (start.x + end.x) / 2;
			d = `M ${start.x} ${start.y} H ${mx} V ${end.y} H ${end.x}`;
			mid = { x: mx, y: (start.y + end.y) / 2 };
		} else {
			d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
			mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
		}
	} else {
		const down = cb.y > ca.y;
		start = { x: ca.x, y: down ? a.y + a.h : a.y };
		end = { x: cb.x, y: down ? b.y : b.y + b.h };
		if (route === "elbow" && Math.abs(start.x - end.x) > 1) {
			const my = (start.y + end.y) / 2;
			d = `M ${start.x} ${start.y} V ${my} H ${end.x} V ${end.y}`;
			mid = { x: (start.x + end.x) / 2, y: my };
		} else {
			d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
			mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
		}
	}
	return { d, start, end, mid };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, min: number, max: number): number | null {
	return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

function str(v: unknown, max: number): string | null {
	return typeof v === "string" && v.length <= max ? v : null;
}

const COORD = 1_000_000;

function parseBox(raw: Record<string, unknown>): Box | null {
	const id = str(raw.id, 64);
	const x = num(raw.x, -COORD, COORD);
	const y = num(raw.y, -COORD, COORD);
	const w = num(raw.w, 8, 20_000);
	const h = num(raw.h, 8, 20_000);
	if (!id || x === null || y === null || w === null || h === null) return null;
	return { id, x, y, w, h };
}

/**
 * Checks untrusted input and returns a clean Board, or null if anything is
 * malformed. Edges pointing at missing shapes are dropped.
 */
export function parseBoard(input: unknown): Board | null {
	if (!isRecord(input) || input.v !== 1 || !Array.isArray(input.elements)) return null;
	const name = str(input.name, 120);
	if (name === null || input.elements.length > MAX_ELEMENTS) return null;

	const elements: BoardEl[] = [];
	const ids = new Set<string>();
	const edges: EdgeEl[] = [];

	for (const raw of input.elements) {
		if (!isRecord(raw)) return null;
		if (raw.type === "edge") {
			const id = str(raw.id, 64);
			const from = str(raw.from, 64);
			const to = str(raw.to, 64);
			const label = str(raw.label, 200);
			if (!id || !from || !to || label === null) return null;
			if (raw.arrow !== "end" && raw.arrow !== "both" && raw.arrow !== "none") return null;
			if (raw.route !== "elbow" && raw.route !== "corner" && raw.route !== "straight") return null;
			edges.push({
				id,
				type: "edge",
				from,
				to,
				label,
				dashed: raw.dashed === true,
				arrow: raw.arrow,
				route: raw.route,
			});
			continue;
		}
		const box = parseBox(raw);
		if (!box || ids.has(box.id)) return null;
		ids.add(box.id);
		if (raw.type === "shape") {
			const text = str(raw.text, MAX_TEXT);
			if (
				text === null ||
				!SHAPE_KINDS.includes(raw.shape as ShapeKind) ||
				!COLOR_KEYS.includes(raw.color as ColorKey) ||
				!TEXT_SIZES.includes(raw.textSize as TextSize)
			)
				return null;
			elements.push({
				...box,
				type: "shape",
				shape: raw.shape as ShapeKind,
				color: raw.color as ColorKey,
				text,
				textSize: raw.textSize as TextSize,
				bold: raw.bold === true,
			});
		} else if (raw.type === "text") {
			const text = str(raw.text, MAX_TEXT);
			if (text === null || !TEXT_SIZES.includes(raw.textSize as TextSize)) return null;
			elements.push({ ...box, type: "text", text, textSize: raw.textSize as TextSize, bold: raw.bold === true });
		} else if (raw.type === "frame") {
			const title = str(raw.title, 200);
			const subtitle = str(raw.subtitle, 400);
			if (title === null || subtitle === null) return null;
			elements.push({ ...box, type: "frame", title, subtitle });
		} else {
			return null;
		}
	}

	for (const e of edges) {
		if (ids.has(e.from) && ids.has(e.to) && e.from !== e.to && !ids.has(e.id)) {
			ids.add(e.id);
			elements.push(e);
		}
	}
	// Keep frames painted beneath everything else.
	elements.sort((a, b) => Number(b.type === "frame") - Number(a.type === "frame"));
	return { v: 1, name, elements };
}
