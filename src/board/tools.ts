import type { ReactNode } from "react";
import type { ShapeKind } from "../../shared/board";
import { Icons } from "./icons";

export type Tool = "select" | "hand" | "connect" | "frame" | "text" | "comment" | ShapeKind;

export const TOOLS: { tool: Tool; label: string; key: string; icon: () => ReactNode }[] = [
	{ tool: "select", label: "Select", key: "V", icon: Icons.select },
	{ tool: "hand", label: "Pan", key: "H", icon: Icons.hand },
	{ tool: "frame", label: "Frame", key: "F", icon: Icons.frame },
	{ tool: "rect", label: "Box", key: "R", icon: Icons.rect },
	{ tool: "pill", label: "Start / end", key: "O", icon: Icons.pill },
	{ tool: "diamond", label: "Decision", key: "D", icon: Icons.diamond },
	{ tool: "cylinder", label: "Database", key: "C", icon: Icons.cylinder },
	{ tool: "note", label: "Sticky note", key: "N", icon: Icons.note },
	{ tool: "text", label: "Text", key: "T", icon: Icons.text },
	{ tool: "connect", label: "Connector", key: "L", icon: Icons.connect },
	{ tool: "comment", label: "Comment", key: "M", icon: Icons.comment },
];

/** Tools for people who can view a board but not edit it. */
export const VIEW_TOOLS = new Set<Tool>(["select", "hand", "comment"]);

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(
	TOOLS.map((t) => [t.key.toLowerCase(), t.tool]),
);

