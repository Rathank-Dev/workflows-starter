import { memo } from "react";
import {
	COLORS,
	FONT_PX,
	edgeGeometry,
	isBox,
	type Board,
	type BoxEl,
	type EdgeEl,
	type FrameEl,
	type ShapeEl,
	type TextEl,
	type TextSize,
} from "../../shared/board";
import { BOARD_FONT, lineHeightPx, textBoxFor, wrapText } from "./text";

/**
 * Board content as plain SVG with literal colors, so the same markup works
 * live and in exported SVG/PNG files. Free text uses --board-ink so it stays
 * readable on a dark canvas; export swaps it for a literal.
 */

export const EDGE_COLOR = "#475062";
export const INK = "#1D2330";
const INK_SOFT = "#5A6476";
const FRAME_LINE = "#D3D8E0";
export const DISPLAY_FONT = `"Bricolage Grotesque", ${BOARD_FONT}`;

function Lines({
	lines,
	cx,
	cy,
	x,
	size,
	bold,
	anchor,
	fill,
}: {
	lines: string[];
	cx: number;
	cy: number;
	x?: number;
	size: TextSize;
	bold: boolean;
	anchor: "middle" | "start";
	fill: string;
}) {
	const lh = lineHeightPx(size);
	const px = FONT_PX[size];
	const top = cy - (lines.length * lh) / 2 + lh / 2;
	const tx = anchor === "middle" ? cx : x!;
	return (
		<text
			x={tx}
			fontFamily={BOARD_FONT}
			fontSize={px}
			fontWeight={bold ? 650 : 400}
			fill={fill}
			textAnchor={anchor}
			dominantBaseline="central"
		>
			{lines.map((line, i) => (
				<tspan key={i} x={tx} y={top + i * lh}>
					{line || " "}
				</tspan>
			))}
		</text>
	);
}

function ShapeOutline({ el }: { el: ShapeEl }) {
	const { fill, stroke } = COLORS[el.color];
	const { x, y, w, h } = el;
	switch (el.shape) {
		case "pill":
			return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} stroke={stroke} strokeWidth={1.5} />;
		case "diamond":
			return (
				<polygon
					points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`}
					fill={fill}
					stroke={stroke}
					strokeWidth={1.5}
					strokeLinejoin="round"
				/>
			);
		case "cylinder": {
			const ry = Math.min(14, h / 5);
			const rx = w / 2;
			return (
				<g fill={fill} stroke={stroke} strokeWidth={1.5}>
					<path
						d={`M ${x} ${y + ry} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} Z`}
					/>
					<path d={`M ${x} ${y + ry} A ${rx} ${ry} 0 0 0 ${x + w} ${y + ry}`} fill="none" />
				</g>
			);
		}
		case "note":
			return (
				<g>
					<rect x={x + 1.5} y={y + 3} width={w} height={h} rx={3} fill="#1D2330" opacity={0.08} />
					<rect x={x} y={y} width={w} height={h} rx={3} fill={fill} />
				</g>
			);
		default:
			return <rect x={x} y={y} width={w} height={h} rx={10} fill={fill} stroke={stroke} strokeWidth={1.5} />;
	}
}

const Shape = memo(function Shape({ el, hideText }: { el: ShapeEl; hideText: boolean }) {
	const box = textBoxFor(el);
	return (
		<g data-id={el.id}>
			<ShapeOutline el={el} />
			{!hideText && el.text && (
				<Lines
					lines={wrapText(el.text, box.w, el.textSize, el.bold)}
					cx={el.x + el.w / 2}
					cy={box.cy}
					size={el.textSize}
					bold={el.bold}
					anchor="middle"
					fill={INK}
				/>
			)}
		</g>
	);
});

const FreeText = memo(function FreeText({ el, hideText }: { el: TextEl; hideText: boolean }) {
	const lines = wrapText(el.text || " ", el.w, el.textSize, el.bold);
	const lh = lineHeightPx(el.textSize);
	return (
		<g data-id={el.id}>
			<rect x={el.x} y={el.y} width={el.w} height={el.h} fill="transparent" />
			{!hideText && (
				<Lines
					lines={lines}
					cx={0}
					cy={el.y + (lines.length * lh) / 2}
					x={el.x}
					size={el.textSize}
					bold={el.bold}
					anchor="start"
					fill="var(--board-ink)"
				/>
			)}
		</g>
	);
});

export const FrameBody = memo(function FrameBody({ el }: { el: FrameEl }) {
	return (
		<rect
			data-frame-body={el.id}
			x={el.x}
			y={el.y}
			width={el.w}
			height={el.h}
			rx={8}
			fill="#FFFFFF"
			stroke={FRAME_LINE}
			strokeWidth={1}
		/>
	);
});

export const FrameHeader = memo(function FrameHeader({ el, hideText }: { el: FrameEl; hideText: boolean }) {
	return (
		<g data-id={el.id}>
			<rect x={el.x} y={el.y} width={el.w} height={64} fill="transparent" />
			{!hideText && (
				<>
					<text
						x={el.x + 28}
						y={el.y + 36}
						fontFamily={DISPLAY_FONT}
						fontSize={24}
						fontWeight={700}
						fill={INK}
						letterSpacing={-0.4}
					>
						{el.title || "Untitled frame"}
					</text>
					{el.subtitle && (
						<text x={el.x + 28} y={el.y + 58} fontFamily={BOARD_FONT} fontSize={13} fill={INK_SOFT}>
							{el.subtitle}
						</text>
					)}
				</>
			)}
		</g>
	);
});

export function EdgeMarkers() {
	return (
		<defs>
			<marker
				id="lw-arrow"
				viewBox="0 0 10 10"
				refX="9"
				refY="5"
				markerWidth="9"
				markerHeight="9"
				markerUnits="userSpaceOnUse"
				orient="auto-start-reverse"
			>
				<path d="M 0 0.5 L 10 5 L 0 9.5 z" fill={EDGE_COLOR} />
			</marker>
		</defs>
	);
}

const Edge = memo(function Edge({
	el,
	from,
	to,
	hideLabel,
}: {
	el: EdgeEl;
	from: BoxEl;
	to: BoxEl;
	hideLabel: boolean;
}) {
	const g = edgeGeometry(from, to, el.route);
	const labelW = el.label ? Math.max(28, el.label.length * 7 + 16) : 0;
	return (
		<g data-id={el.id}>
			<path d={g.d} stroke="transparent" strokeWidth={14} fill="none" />
			<path
				d={g.d}
				stroke={EDGE_COLOR}
				strokeWidth={1.75}
				fill="none"
				strokeDasharray={el.dashed ? "6 5" : undefined}
				strokeLinejoin="round"
				markerEnd={el.arrow !== "none" ? "url(#lw-arrow)" : undefined}
				markerStart={el.arrow === "both" ? "url(#lw-arrow)" : undefined}
			/>
			{el.label && !hideLabel && (
				<g>
					<rect
						x={g.mid.x - labelW / 2}
						y={g.mid.y - 11}
						width={labelW}
						height={22}
						rx={11}
						fill="#FFFFFF"
						stroke="#DDE1E7"
					/>
					<text
						x={g.mid.x}
						y={g.mid.y}
						fontFamily={BOARD_FONT}
						fontSize={12}
						fontWeight={500}
						fill={INK_SOFT}
						textAnchor="middle"
						dominantBaseline="central"
					>
						{el.label}
					</text>
				</g>
			)}
		</g>
	);
});

/**
 * Paint order: frame bodies, frame headers, edges, then shapes and text.
 */
export function Scene({ board, editingId }: { board: Board; editingId: string | null }) {
	const byId = new Map<string, BoxEl>();
	for (const el of board.elements) if (isBox(el)) byId.set(el.id, el);
	const frames = board.elements.filter((e): e is FrameEl => e.type === "frame");

	return (
		<>
			{frames.map((f) => (
				<FrameBody key={f.id} el={f} />
			))}
			{frames.map((f) => (
				<FrameHeader key={f.id} el={f} hideText={editingId === f.id} />
			))}
			{board.elements.map((el) => {
				if (el.type !== "edge") return null;
				const from = byId.get(el.from);
				const to = byId.get(el.to);
				if (!from || !to) return null;
				return <Edge key={el.id} el={el} from={from} to={to} hideLabel={editingId === el.id} />;
			})}
			{board.elements.map((el) => {
				if (el.type === "shape") return <Shape key={el.id} el={el} hideText={editingId === el.id} />;
				if (el.type === "text") return <FreeText key={el.id} el={el} hideText={editingId === el.id} />;
				return null;
			})}
		</>
	);
}
