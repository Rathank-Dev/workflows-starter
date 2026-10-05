import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boundsOf, edgeGeometry, isBox, type Board, type BoxEl } from "../../shared/board";
import { EdgeMarkers, INK, Scene } from "./Scene";

const FONT_CSS =
	"https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Onest:wght@400;500;650&display=swap";
const PAD = 48;

let fontFaceCss: Promise<string> | null = null;

/** Inlines the latin subsets of the board fonts so exports render the same off-site. */
function embeddedFonts(): Promise<string> {
	fontFaceCss ??= (async () => {
		try {
			const css = await (await fetch(FONT_CSS)).text();
			const blocks = css.split("/* ").filter((b) => b.startsWith("latin */"));
			const out: string[] = [];
			for (const block of blocks) {
				const url = block.match(/url\((https:[^)]+)\)/)?.[1];
				if (!url) continue;
				const buf = await (await fetch(url)).arrayBuffer();
				let bin = "";
				const bytes = new Uint8Array(buf);
				for (let i = 0; i < bytes.length; i += 0x8000) {
					bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
				}
				out.push(block.slice("latin */".length).replace(url, `data:font/woff2;base64,${btoa(bin)}`));
			}
			return out.join("\n");
		} catch {
			return "";
		}
	})();
	return fontFaceCss;
}

function exportBounds(board: Board) {
	const byId = new Map<string, BoxEl>();
	const rects = [];
	for (const el of board.elements) {
		if (isBox(el)) {
			byId.set(el.id, el);
			rects.push(el);
		}
	}
	// Elbow edges never leave the hull of their endpoints, so boxes are enough.
	for (const el of board.elements) {
		if (el.type !== "edge") continue;
		const a = byId.get(el.from);
		const b = byId.get(el.to);
		if (a && b) {
			const g = edgeGeometry(a, b, el.route);
			rects.push({ x: g.mid.x - 40, y: g.mid.y - 12, w: 80, h: 24 });
		}
	}
	return boundsOf(rects) ?? { x: 0, y: 0, w: 400, h: 300 };
}

export async function boardToSvg(board: Board): Promise<{ svg: string; width: number; height: number }> {
	const b = exportBounds(board);
	const width = Math.ceil(b.w + PAD * 2);
	const height = Math.ceil(b.h + PAD * 2);
	const fonts = await embeddedFonts();
	const body = renderToStaticMarkup(
		createElement(
			"g",
			{ transform: `translate(${PAD - b.x} ${PAD - b.y})` },
			createElement(EdgeMarkers),
			createElement(Scene, { board, editingId: null }),
		),
	).replaceAll("var(--board-ink)", INK);

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
		`<style>${fonts}</style>` +
		`<rect width="100%" height="100%" fill="#EEF0F4"/>` +
		body +
		`</svg>`;
	return { svg, width, height };
}

export async function boardToPng(board: Board): Promise<Blob> {
	const { svg, width, height } = await boardToSvg(board);
	// Browsers cap canvas size; shrink very large boards to fit.
	const scale = Math.min(2, 16_000 / width, 16_000 / height);
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
	try {
		const img = new Image();
		img.decoding = "async";
		img.src = url;
		await img.decode();
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(width * scale);
		canvas.height = Math.round(height * scale);
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas is unavailable in this browser.");
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed."))), "image/png"),
		);
	} finally {
		URL.revokeObjectURL(url);
	}
}

export function download(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileSafe(name: string) {
	return name.trim().replace(/[^a-zA-Z0-9-_ ]+/g, "").replace(/\s+/g, "-").toLowerCase() || "board";
}
