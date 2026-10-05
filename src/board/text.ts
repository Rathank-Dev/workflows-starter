import { FONT_PX, type ShapeEl, type TextSize } from "../../shared/board";

export const BOARD_FONT = `Onest, "Segoe UI", system-ui, sans-serif`;
export const LINE_HEIGHT = 1.32;

let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, string[]>();

function font(px: number, bold: boolean) {
	return `${bold ? 650 : 400} ${px}px ${BOARD_FONT}`;
}

/** Fonts arrive after first paint; call this once they load so lines re-measure. */
export function clearTextCache() {
	cache.clear();
}

/** Breaks text into lines that fit `maxWidth`, honoring explicit newlines. */
export function wrapText(text: string, maxWidth: number, size: TextSize, bold: boolean): string[] {
	const px = FONT_PX[size];
	const key = `${px}|${bold}|${Math.round(maxWidth)}|${text}`;
	const hit = cache.get(key);
	if (hit) return hit;

	ctx ??= document.createElement("canvas").getContext("2d");
	if (!ctx) return text.split("\n");
	ctx.font = font(px, bold);
	const measure = (s: string) => ctx!.measureText(s).width;

	const lines: string[] = [];
	// A word wider than the box: hard-break it. Binary search keeps this at
	// O(n log n) measurements, so a long word from a shared board can't stall the tab.
	const breakLong = (s: string): string => {
		while (s.length > 1 && measure(s) > maxWidth) {
			let lo = 1;
			let hi = s.length - 1;
			while (lo < hi) {
				const mid = (lo + hi + 1) >> 1;
				if (measure(s.slice(0, mid)) <= maxWidth) lo = mid;
				else hi = mid - 1;
			}
			lines.push(s.slice(0, lo));
			s = s.slice(lo);
		}
		return s;
	};
	for (const para of text.split("\n")) {
		const words = para.split(/(\s+)/).filter((w) => w.length > 0);
		let line = "";
		for (const word of words) {
			const next = line + word;
			if (measure(next) <= maxWidth || !line.trim()) {
				line = breakLong(next);
			} else {
				lines.push(line.trimEnd());
				line = breakLong(word.trimStart());
			}
		}
		lines.push(line.trimEnd());
	}
	if (cache.size > 5000) cache.clear();
	cache.set(key, lines);
	return lines;
}

export function lineHeightPx(size: TextSize) {
	return FONT_PX[size] * LINE_HEIGHT;
}

/** Inner text box per shape, inset from its outline. */
export function textBoxFor(el: ShapeEl): { w: number; cy: number } {
	switch (el.shape) {
		case "diamond":
			return { w: el.w * 0.66, cy: el.y + el.h / 2 };
		case "cylinder":
			return { w: el.w - 20, cy: el.y + el.h / 2 + 6 };
		case "pill":
			return { w: el.w - el.h * 0.6, cy: el.y + el.h / 2 };
		default:
			return { w: el.w - 24, cy: el.y + el.h / 2 };
	}
}
