import type { CSSProperties } from "react";
import type { Cursor } from "./useBoardDoc";

interface Viewport {
	x: number;
	y: number;
	zoom: number;
}

/** Board palette accents, so each person keeps one color for the session. */
const COLORS = ["var(--step)", "var(--decision)", "var(--check)", "var(--deny)", "var(--pass)", "var(--teal)"];

function colorFor(id: string): string {
	let h = 0;
	for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	return COLORS[h % COLORS.length];
}

/** Other people's pointers, drawn at screen size whatever the zoom. */
export function CursorLayer({ cursors, vp }: { cursors: Map<string, Cursor>; vp: Viewport }) {
	if (cursors.size === 0) return null;
	return (
		<div className="cursor-layer" aria-hidden="true">
			{Array.from(cursors.values(), (c) => (
				<div
					key={c.id}
					className="live-cursor"
					style={
						{
							transform: `translate(${c.x * vp.zoom + vp.x}px, ${c.y * vp.zoom + vp.y}px)`,
							"--cursor": colorFor(c.id),
						} as CSSProperties
					}
				>
					<svg width="22" height="22" viewBox="0 0 18 18">
						<path d="M2 1.5 15.5 8 9 9.6 6.4 16Z" fill="var(--cursor)" stroke="var(--canvas)" strokeWidth="1.5" strokeLinejoin="round" />
					</svg>
					<span>{c.name ?? "Guest"}</span>
				</div>
			))}
		</div>
	);
}
