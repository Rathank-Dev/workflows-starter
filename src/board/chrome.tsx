import { useEffect, useRef, useState, type ReactNode } from "react";
import {
	COLORS,
	COLOR_KEYS,
	SHAPE_KINDS,
	isBox,
	type Board,
	type BoardEl,
	type ColorKey,
	type EdgeEl,
	type ShapeKind,
	type TextSize,
} from "../../shared/board";
import { TEMPLATES, buildTemplate, templateSize, type FlowTemplate } from "../../shared/templates";
import { Icons, Mark } from "./icons";
import { TOOLS, VIEW_TOOLS, type Tool } from "./tools";
import type { SyncStatus } from "./useBoardDoc";


function IconButton({
	label,
	shortcut,
	active,
	disabled,
	onClick,
	children,
	tipSide = "right",
}: {
	label: string;
	shortcut?: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
	tipSide?: "right" | "top" | "bottom";
}) {
	return (
		<button
			type="button"
			className="icon-btn"
			data-active={active || undefined}
			aria-pressed={active}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
		>
			{children}
			<span className="tip" data-side={tipSide} role="presentation">
				{label}
				{shortcut && <kbd>{shortcut}</kbd>}
			</span>
		</button>
	);
}

/* ------------------------------------------------------------------ */

export function Toolbar({
	tool,
	onTool,
	templatesOpen,
	onTemplates,
	readOnly,
}: {
	tool: Tool;
	onTool: (t: Tool) => void;
	templatesOpen: boolean;
	onTemplates: () => void;
	/** View-only boards get pan, select, and comment. */
	readOnly?: boolean;
}) {
	return (
		<nav className="panel toolbar" aria-label="Tools">
			{!readOnly && (
				<>
					<IconButton label="Templates" active={templatesOpen} onClick={onTemplates}>
						<Icons.templates />
					</IconButton>
					<div className="toolbar-sep" />
				</>
			)}
			{TOOLS.filter((t) => !readOnly || VIEW_TOOLS.has(t.tool)).map((t) => (
				<IconButton key={t.tool} label={t.label} shortcut={t.key} active={tool === t.tool} onClick={() => onTool(t.tool)}>
					<t.icon />
				</IconButton>
			))}
		</nav>
	);
}

/* ------------------------------------------------------------------ */

export function HistoryBar(props: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }) {
	return (
		<div className="panel history-bar">
			<IconButton label="Undo" shortcut="Ctrl Z" disabled={!props.canUndo} onClick={props.onUndo}>
				<Icons.undo />
			</IconButton>
			<IconButton label="Redo" shortcut="Ctrl ⇧ Z" disabled={!props.canRedo} onClick={props.onRedo}>
				<Icons.redo />
			</IconButton>
		</div>
	);
}

export function ZoomBar(props: {
	zoom: number;
	onZoomOut: () => void;
	onZoomIn: () => void;
	onReset: () => void;
	onFit: () => void;
	onHelp: () => void;
}) {
	return (
		<div className="panel zoom-bar">
			<IconButton label="Fit board" shortcut="⇧ 1" tipSide="top" onClick={props.onFit}>
				<Icons.fit />
			</IconButton>
			<IconButton label="Zoom out" shortcut="Ctrl −" tipSide="top" onClick={props.onZoomOut}>
				<Icons.minus />
			</IconButton>
			<button type="button" className="zoom-value" onClick={props.onReset} aria-label="Reset zoom to 100%">
				{Math.round(props.zoom * 100)}%
			</button>
			<IconButton label="Zoom in" shortcut="Ctrl +" tipSide="top" onClick={props.onZoomIn}>
				<Icons.plus />
			</IconButton>
			<IconButton label="Shortcuts" shortcut="?" tipSide="top" onClick={props.onHelp}>
				<Icons.help />
			</IconButton>
		</div>
	);
}

/* ------------------------------------------------------------------ */

export function BoardMenu({
	name,
	onRename,
	onExportPng,
	onExportSvg,
	onExportJson,
	onImportJson,
	onNewBoard,
	shared,
	readOnly,
}: {
	/** View-only: no renaming or opening files into this board. */
	readOnly?: boolean;
	shared: boolean;
	name: string;
	onRename: (name: string) => void;
	onExportPng: () => void;
	onExportSvg: () => void;
	onExportJson: () => void;
	onImportJson: (file: File) => void;
	onNewBoard: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(name);
	const [focused, setFocused] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const shown = focused ? draft : name;

	useEffect(() => {
		if (!open) return;
		const close = (e: PointerEvent) => {
			if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
		};
		window.addEventListener("pointerdown", close);
		return () => window.removeEventListener("pointerdown", close);
	}, [open]);

	const item = (label: string, fn: () => void) => (
		<button
			type="button"
			role="menuitem"
			onClick={() => {
				setOpen(false);
				fn();
			}}
		>
			{label}
		</button>
	);

	return (
		<div className="panel board-bar" ref={menuRef}>
			<Mark />
			<a className="brand" href="/">Flowyard</a>
			<div className="board-bar-sep" />
			<input
				className="board-name"
				value={shown}
				aria-label="Board name"
				readOnly={readOnly}
				maxLength={120}
				size={Math.max(8, shown.length)}
				onFocus={() => {
					setDraft(name);
					setFocused(true);
				}}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => {
					setFocused(false);
					const next = draft.trim() || "Untitled board";
					if (next !== name) onRename(next);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
				}}
			/>
			<IconButton label="Board menu" tipSide="bottom" active={open} onClick={() => setOpen((o) => !o)}>
				<Icons.more />
			</IconButton>
			{open && (
				<div className="panel menu" role="menu">
					{item("Export as PNG", onExportPng)}
					{item("Export as SVG", onExportSvg)}
					{item("Download board file (.json)", onExportJson)}
					{!readOnly && (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setOpen(false);
								fileRef.current?.click();
							}}
						>
							Open board file…
						</button>
					)}
					<div className="menu-sep" />
					{item(shared ? "Back to my browser board" : "New blank board", onNewBoard)}
				</div>
			)}
			<input
				ref={fileRef}
				type="file"
				accept="application/json,.json"
				hidden
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) onImportJson(file);
					e.target.value = "";
				}}
			/>
		</div>
	);
}

export function ShareBar({
	status,
	presence,
	sharing,
	disabled,
	onShare,
	viewOnly,
	children,
}: {
	viewOnly?: boolean;
	status: SyncStatus;
	presence: number;
	sharing: boolean;
	disabled?: boolean;
	onShare: () => void;
	children?: ReactNode;
}) {
	const statusText =
		status === "local"
			? "Saved in this browser"
			: status === "live"
				? "Saved"
				: status === "connecting"
					? "Connecting…"
					: status === "deleted"
						? "Board deleted"
						: status === "denied"
							? "No access"
							: "Offline, saving in this browser";
	return (
		<div className="panel share-bar">
			<span className="sync" data-status={status}>
				<span className="sync-dot" />
				{statusText}
			</span>
			{viewOnly && <span className="view-only">View only</span>}
			{status === "live" && presence > 1 && <span className="presence">{presence} people here</span>}
			{children}
			<button type="button" className="share-btn" onClick={onShare} disabled={sharing || disabled} aria-label="Share">
				<Icons.link />
				<span className="share-label">{sharing ? "Sharing…" : "Share"}</span>
			</button>
		</div>
	);
}

/* ------------------------------------------------------------------ */

const SIZE_LABEL: Record<TextSize, string> = { s: "S", m: "M", l: "L", xl: "XL" };
const SHAPE_LABEL: Record<ShapeKind, string> = {
	rect: "Box",
	pill: "Start / end",
	diamond: "Decision",
	cylinder: "Database",
	note: "Sticky note",
};

const NEXT_ROUTE = { elbow: "corner", corner: "straight", straight: "elbow" } as const;

export interface ContextActions {
	setColor: (c: ColorKey) => void;
	setShape: (s: ShapeKind) => void;
	setTextSize: (s: TextSize) => void;
	toggleBold: () => void;
	setEdge: (patch: Partial<Pick<EdgeEl, "dashed" | "arrow" | "route">>) => void;
	duplicate: () => void;
	remove: () => void;
	toFront: () => void;
	toBack: () => void;
}

export function ContextBar({
	selected,
	left,
	top,
	actions,
}: {
	selected: BoardEl[];
	left: number;
	top: number;
	actions: ContextActions;
}) {
	const shapes = selected.filter((e) => e.type === "shape");
	const texty = selected.filter((e) => e.type === "shape" || e.type === "text");
	const edges = selected.filter((e): e is EdgeEl => e.type === "edge");
	const boxes = selected.filter(isBox);
	const first = texty[0];
	const color = shapes[0]?.color;
	const shape = shapes[0]?.shape;
	const size = first?.textSize;
	const bold = first?.bold;
	const edge = edges[0];
	const nextArrow = edge ? ({ end: "both", both: "none", none: "end" } as const)[edge.arrow] : "end";

	return (
		<div className="panel context-bar" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
			{shapes.length > 0 && (
				<div className="swatches" role="radiogroup" aria-label="Color">
					{COLOR_KEYS.map((c) => (
						<button
							key={c}
							type="button"
							role="radio"
							aria-checked={color === c}
							aria-label={COLORS[c].label}
							title={COLORS[c].label}
							className="swatch"
							style={{ background: COLORS[c].fill, borderColor: COLORS[c].stroke }}
							onClick={() => actions.setColor(c)}
						/>
					))}
				</div>
			)}
			{shapes.length > 0 && (
				<label className="ctx-select">
					<span className="sr-only">Shape</span>
					<select value={shape} onChange={(e) => actions.setShape(e.target.value as ShapeKind)}>
						{SHAPE_KINDS.map((s) => (
							<option key={s} value={s}>
								{SHAPE_LABEL[s]}
							</option>
						))}
					</select>
				</label>
			)}
			{texty.length > 0 && (
				<>
					<div className="seg" role="radiogroup" aria-label="Text size">
						{(Object.keys(SIZE_LABEL) as TextSize[]).map((s) => (
							<button
								key={s}
								type="button"
								role="radio"
								aria-checked={size === s}
								data-active={size === s || undefined}
								onClick={() => actions.setTextSize(s)}
							>
								{SIZE_LABEL[s]}
							</button>
						))}
					</div>
					<IconButton label="Bold" shortcut="Ctrl B" tipSide="top" active={bold} onClick={actions.toggleBold}>
						<Icons.bold />
					</IconButton>
				</>
			)}
			{edge && (
				<>
					<IconButton
						label={edge.dashed ? "Solid line" : "Dashed line"}
						tipSide="top"
						onClick={() => actions.setEdge({ dashed: !edge.dashed })}
					>
						{edge.dashed ? <Icons.solid /> : <Icons.dashed />}
					</IconButton>
					<IconButton
						label={nextArrow === "both" ? "Arrows on both ends" : nextArrow === "none" ? "No arrows" : "Arrow at end"}
						tipSide="top"
						onClick={() => actions.setEdge({ arrow: nextArrow })}
					>
						{edge.arrow === "end" ? <Icons.arrowEnd /> : edge.arrow === "both" ? <Icons.arrowBoth /> : <Icons.arrowNone />}
					</IconButton>
					<IconButton
						label={
							edge.route === "elbow" ? "Switch to one bend" : edge.route === "corner" ? "Switch to straight" : "Switch to elbow"
						}
						tipSide="top"
						onClick={() => actions.setEdge({ route: NEXT_ROUTE[edge.route] })}
					>
						{edge.route === "elbow" ? <Icons.elbow /> : edge.route === "corner" ? <Icons.corner /> : <Icons.straight />}
					</IconButton>
				</>
			)}
			{(shapes.length > 0 || texty.length > 0 || edge) && <div className="ctx-sep" />}
			{boxes.some((b) => b.type !== "frame") && (
				<>
					<IconButton label="Bring to front" shortcut="]" tipSide="top" onClick={actions.toFront}>
						<Icons.front />
					</IconButton>
					<IconButton label="Send to back" shortcut="[" tipSide="top" onClick={actions.toBack}>
						<Icons.back />
					</IconButton>
				</>
			)}
			{boxes.length > 0 && (
				<IconButton label="Duplicate" shortcut="Ctrl D" tipSide="top" onClick={actions.duplicate}>
					<Icons.duplicate />
				</IconButton>
			)}
			<IconButton label="Delete" shortcut="Del" tipSide="top" onClick={actions.remove}>
				<Icons.trash />
			</IconButton>
		</div>
	);
}

/* ------------------------------------------------------------------ */

function TemplateThumb({ t }: { t: FlowTemplate }) {
	const els = buildTemplate(t, { x: 0, y: 0 });
	const size = templateSize(t);
	const byId = new Map(els.filter(isBox).map((e) => [e.id, e]));
	return (
		<svg viewBox={`0 0 ${size.w} ${size.h}`} className="thumb" aria-hidden="true">
			<rect width={size.w} height={size.h} rx={16} fill="#FFFFFF" />
			{els.map((el) => {
				if (el.type !== "edge") return null;
				const a = byId.get(el.from)!;
				const b = byId.get(el.to)!;
				return (
					<line
						key={el.id}
						x1={a.x + a.w / 2}
						y1={a.y + a.h / 2}
						x2={b.x + b.w / 2}
						y2={b.y + b.h / 2}
						stroke="#9AA3B2"
						strokeWidth={6}
					/>
				);
			})}
			{els.map((el) =>
				el.type === "shape" ? (
					<rect
						key={el.id}
						x={el.x}
						y={el.y}
						width={el.w}
						height={el.h}
						rx={el.shape === "pill" ? el.h / 2 : 12}
						fill={COLORS[el.color].fill}
						stroke={COLORS[el.color].stroke}
						strokeWidth={5}
					/>
				) : null,
			)}
		</svg>
	);
}

export function TemplatesPanel({
	onInsert,
	onClose,
}: {
	onInsert: (t: FlowTemplate) => void;
	onClose: () => void;
}) {
	return (
		<aside className="panel templates" aria-label="Templates" onPointerDown={(e) => e.stopPropagation()}>
			<header>
				<h2>Templates</h2>
				<button type="button" className="text-btn" onClick={onClose}>
					Close
				</button>
			</header>
			<p className="templates-hint">Each one drops onto the board as a frame you can edit.</p>
			<ul>
				{TEMPLATES.map((t) => (
					<li key={t.id}>
						<button type="button" className="template" onClick={() => onInsert(t)}>
							<TemplateThumb t={t} />
							<span className="template-title">{t.title}</span>
							<span className="template-sub">{t.subtitle}</span>
						</button>
					</li>
				))}
			</ul>
		</aside>
	);
}

/* ------------------------------------------------------------------ */

const SHORTCUTS: [string, string][] = [
	["Pan", "Space + drag, or scroll"],
	["Zoom", "Ctrl + scroll, or pinch"],
	["Edit text", "Double-click, or Enter"],
	["New box", "Double-click empty canvas"],
	["Connect", "Drag a blue dot onto another shape"],
	["Add next step", "Click a blue dot"],
	["Select many", "Shift-click, or drag on empty canvas"],
	["Move frame", "Drag its title"],
	["Nudge", "Arrow keys (Shift for 10)"],
	["Duplicate", "Ctrl D"],
	["Copy / paste", "Ctrl C / Ctrl V"],
	["Delete", "Delete or Backspace"],
	["Fit board", "Shift 1"],
];

export function HelpPanel({ onClose }: { onClose: () => void }) {
	return (
		<aside className="panel help" aria-label="Keyboard shortcuts" onPointerDown={(e) => e.stopPropagation()}>
			<header>
				<h2>Shortcuts</h2>
				<button type="button" className="text-btn" onClick={onClose}>
					Close
				</button>
			</header>
			<dl>
				{SHORTCUTS.map(([what, how]) => (
					<div key={what}>
						<dt>{what}</dt>
						<dd>{how}</dd>
					</div>
				))}
			</dl>
		</aside>
	);
}

export function Toast({ message }: { message: string | null }) {
	return (
		<div className="toast" role="status" aria-live="polite" data-shown={message ? true : undefined}>
			{message}
		</div>
	);
}

/** Board name and element count for an empty-state hint. */
export function EmptyHint({ board }: { board: Board }) {
	if (board.elements.length > 0) return null;
	return (
		<div className="empty-hint">
			<p>This board is empty.</p>
			<p>Pick a template on the left, or double-click anywhere to add a box.</p>
		</div>
	);
}
