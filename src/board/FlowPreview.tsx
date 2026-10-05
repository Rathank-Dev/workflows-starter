import { useMemo } from "react";
import type { Board } from "../../shared/board";
import { buildTemplate, templateSize, type FlowTemplate } from "../../shared/templates";
import { EdgeMarkers, Scene } from "./Scene";

/** A template drawn by the same renderer the board uses. */
export function FlowPreview({ template, className }: { template: FlowTemplate; className?: string }) {
	const { board, size } = useMemo(() => {
		const b: Board = { v: 1, name: template.title, elements: buildTemplate(template, { x: 0, y: 0 }) };
		return { board: b, size: templateSize(template) };
	}, [template]);
	return (
		<svg className={className} viewBox={`-8 -8 ${size.w + 16} ${size.h + 16}`} role="img" aria-label={`${template.title} flow`}>
			<EdgeMarkers />
			<Scene board={board} editingId={null} />
		</svg>
	);
}
