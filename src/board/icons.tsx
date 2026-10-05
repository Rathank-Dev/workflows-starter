import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
	return (
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...rest}
		>
			{children}
		</svg>
	);
}

// eslint-disable-next-line react-refresh/only-export-components -- icon map, not state
export const Icons = {
	select: () => (
		<Icon>
			<path d="M5 3.5l13 6.2-5.6 1.7L10 17z" fill="currentColor" stroke="none" />
			<path d="M12.4 11.4l5 5" />
		</Icon>
	),
	hand: () => (
		<Icon>
			<path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-1.5V4a1.5 1.5 0 013 0v6m0-4.5a1.5 1.5 0 013 0V13a7 7 0 01-7 7h-.6a6 6 0 01-4.6-2.2L4 15a1.6 1.6 0 012.4-2L8 14.5" />
		</Icon>
	),
	frame: () => (
		<Icon>
			<path d="M7 3v18M17 3v18M3 7h18M3 17h18" />
		</Icon>
	),
	rect: () => (
		<Icon>
			<rect x="3.5" y="6" width="17" height="12" rx="2.5" />
		</Icon>
	),
	pill: () => (
		<Icon>
			<rect x="3" y="7.5" width="18" height="9" rx="4.5" />
		</Icon>
	),
	diamond: () => (
		<Icon>
			<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" />
		</Icon>
	),
	cylinder: () => (
		<Icon>
			<ellipse cx="12" cy="6" rx="7" ry="2.5" />
			<path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />
		</Icon>
	),
	note: () => (
		<Icon>
			<path d="M4.5 4.5h15v10l-5 5h-10z" />
			<path d="M19.5 14.5h-5v5" />
		</Icon>
	),
	text: () => (
		<Icon>
			<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />
		</Icon>
	),
	connect: () => (
		<Icon>
			<circle cx="5.5" cy="18.5" r="2" />
			<path d="M7.5 18.5H12a2 2 0 002-2v-9a2 2 0 012-2h4.5" />
			<path d="M17.5 2.5l3 3-3 3" />
		</Icon>
	),
	templates: () => (
		<Icon>
			<rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
			<rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
			<rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
			<path d="M17 14v6M14 17h6" />
		</Icon>
	),
	undo: () => (
		<Icon>
			<path d="M9 14L4 9l5-5" />
			<path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
		</Icon>
	),
	redo: () => (
		<Icon>
			<path d="M15 14l5-5-5-5" />
			<path d="M20 9H9.5a5.5 5.5 0 000 11H13" />
		</Icon>
	),
	minus: () => (
		<Icon>
			<path d="M5 12h14" />
		</Icon>
	),
	plus: () => (
		<Icon>
			<path d="M12 5v14M5 12h14" />
		</Icon>
	),
	fit: () => (
		<Icon>
			<path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15" />
		</Icon>
	),
	more: () => (
		<Icon>
			<circle cx="12" cy="5.5" r="1.2" fill="currentColor" />
			<circle cx="12" cy="12" r="1.2" fill="currentColor" />
			<circle cx="12" cy="18.5" r="1.2" fill="currentColor" />
		</Icon>
	),
	trash: () => (
		<Icon>
			<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13" />
		</Icon>
	),
	duplicate: () => (
		<Icon>
			<rect x="8.5" y="8.5" width="11" height="11" rx="2" />
			<path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5" />
		</Icon>
	),
	front: () => (
		<Icon>
			<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fillOpacity={0.25} />
			<path d="M16 5.5V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h.5" />
		</Icon>
	),
	back: () => (
		<Icon>
			<rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" fillOpacity={0.25} />
			<path d="M8 18.5v.5a1 1 0 001 1h10a1 1 0 001-1V9a1 1 0 00-1-1h-.5" />
		</Icon>
	),
	bold: () => (
		<Icon strokeWidth={2.4}>
			<path d="M7 4.5h6a3.75 3.75 0 010 7.5H7zM7 12h7a3.75 3.75 0 010 7.5H7z" />
		</Icon>
	),
	dashed: () => (
		<Icon>
			<path d="M3 12h3M10.5 12h3M18 12h3" />
		</Icon>
	),
	solid: () => (
		<Icon>
			<path d="M3 12h18" />
		</Icon>
	),
	arrowEnd: () => (
		<Icon>
			<path d="M3 12h17M15 7l5 5-5 5" />
		</Icon>
	),
	arrowBoth: () => (
		<Icon>
			<path d="M4 12h16M9 7l-5 5 5 5M15 7l5 5-5 5" />
		</Icon>
	),
	arrowNone: () => (
		<Icon>
			<path d="M4 12h16" />
		</Icon>
	),
	elbow: () => (
		<Icon>
			<path d="M3 6h8v12h10" />
		</Icon>
	),
	corner: () => (
		<Icon>
			<path d="M5 3v16h16" />
		</Icon>
	),
	straight: () => (
		<Icon>
			<path d="M4 19L20 5" />
		</Icon>
	),
	sparkle: () => (
		<Icon>
			<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
			<path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
		</Icon>
	),
	help: () => (
		<Icon>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M9.6 9.5a2.5 2.5 0 014.8 1c0 1.7-2.4 2-2.4 3.5" />
			<circle cx="12" cy="17" r="0.6" fill="currentColor" />
		</Icon>
	),
	open: () => (
		<Icon>
			<path d="M13.5 5.5h5v5M18.5 5.5l-8 8M16 13.5v4a1.5 1.5 0 01-1.5 1.5h-8A1.5 1.5 0 015 17.5v-8A1.5 1.5 0 016.5 8h4" />
		</Icon>
	),
	pencil: () => (
		<Icon>
			<path d="M5 19l1-4.2L15.6 5.2a1.8 1.8 0 012.6 0l.6.6a1.8 1.8 0 010 2.6L9.2 18 5 19z" />
		</Icon>
	),
	restore: () => (
		<Icon>
			<path d="M5 12a7 7 0 107-7 7.2 7.2 0 00-5.2 2.2L5 9" />
			<path d="M5 5v4h4" />
		</Icon>
	),
	comment: () => (
		<Icon>
			<path d="M4.5 5.5h15v10h-9l-4.5 4v-4h-1.5z" />
		</Icon>
	),
	video: () => (
		<Icon>
			<rect x="3.5" y="6.5" width="12" height="11" rx="2" />
			<path d="M15.5 10.5l5-3v9l-5-3" />
		</Icon>
	),
	link: () => (
		<Icon>
			<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
			<path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
		</Icon>
	),
};

/** The app mark: two linked nodes. */
export function Mark() {
	return (
		<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
			<rect x="1.5" y="3" width="11" height="8" rx="2.5" fill="var(--select)" />
			<rect x="13.5" y="15" width="11" height="8" rx="4" fill="none" stroke="var(--ink)" strokeWidth="1.75" />
			<path d="M7 11v8h6.5" fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinecap="round" />
		</svg>
	);
}
