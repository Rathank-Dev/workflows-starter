import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { parseBoard, type Board } from "../shared/board";
import { TEMPLATES, buildTemplate, starterBoard } from "../shared/templates";

function stub(name: string) {
	return env.BOARD.get(env.BOARD.idFromName(name));
}

describe("templates", () => {
	it("every template builds a valid board", () => {
		for (const t of TEMPLATES) {
			const board: Board = { v: 1, name: t.title, elements: buildTemplate(t, { x: 0, y: 0 }) };
			const parsed = parseBoard(board);
			expect(parsed, t.id).not.toBeNull();
			expect(parsed!.elements).toHaveLength(board.elements.length);
		}
	});

	it("starter board is valid", () => {
		expect(parseBoard(starterBoard())).not.toBeNull();
	});
});

describe("parseBoard", () => {
	it("rejects unknown element types and bad colors", () => {
		const base = { v: 1, name: "x" };
		expect(parseBoard({ ...base, elements: [{ id: "a", type: "script", x: 0, y: 0, w: 10, h: 10 }] })).toBeNull();
		expect(
			parseBoard({
				...base,
				elements: [
					{ id: "a", type: "shape", shape: "rect", color: "javascript:", text: "", textSize: "m", bold: false, x: 0, y: 0, w: 10, h: 10 },
				],
			}),
		).toBeNull();
	});

	it("drops edges whose ends are missing", () => {
		const board = parseBoard({
			v: 1,
			name: "x",
			elements: [
				{ id: "a", type: "shape", shape: "rect", color: "red", text: "A", textSize: "m", bold: false, x: 0, y: 0, w: 10, h: 10 },
				{ id: "e", type: "edge", from: "a", to: "missing", label: "", dashed: false, arrow: "end", route: "elbow" },
			],
		});
		expect(board?.elements.map((e) => e.id)).toEqual(["a"]);
	});
});

describe("BoardDO", () => {
	it("starts empty, then saves and returns a board", async () => {
		const s = stub(`test-${Date.now()}`);
		expect(await s.getBoard()).toEqual({ doc: null, rev: 0 });

		const board = starterBoard();
		expect(await s.saveBoard(board)).toBe(1);
		const { doc, rev } = await s.getBoard();
		expect(rev).toBe(1);
		expect(doc?.elements).toHaveLength(board.elements.length);
	});

	it("rejects malformed boards", async () => {
		const s = stub(`test-bad-${Date.now()}`);
		expect(await s.saveBoard({ v: 2, elements: [] })).toBeNull();
		expect((await s.getBoard()).rev).toBe(0);
	});
});
