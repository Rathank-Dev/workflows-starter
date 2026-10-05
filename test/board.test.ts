import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { parseBoard, type Board } from "../shared/board";
import { TEMPLATES, buildTemplate, frameToSpec, specToTemplate, starterBoard, validateFlowSpec } from "../shared/templates";

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

describe("validateFlowSpec", () => {
	const base = {
		title: "T",
		subtitle: "",
		cols: 2,
		rows: 2,
		nodes: [
			{ k: "a", t: "A", col: 0, row: 0, c: "blue", s: "rect" },
			{ k: "b", t: "B", col: 1, row: 1, c: "green", s: "rect" },
		],
		edges: [{ from: "a", to: "b", label: "", dashed: false, route: "elbow" }],
	};

	it("accepts a well-formed flow and builds a valid board", () => {
		const r = validateFlowSpec(base);
		expect("spec" in r).toBe(true);
		if (!("spec" in r)) return;
		const board: Board = { v: 1, name: "x", elements: buildTemplate(specToTemplate(r.spec), { x: 0, y: 0 }) };
		expect(parseBoard(board)).not.toBeNull();
	});

	it("rejects duplicate keys and overlapping steps", () => {
		expect(validateFlowSpec({ ...base, nodes: [base.nodes[0], { ...base.nodes[1], k: "a" }] })).toHaveProperty("error");
		expect(validateFlowSpec({ ...base, nodes: [base.nodes[0], { ...base.nodes[1], col: 0, row: 0 }] })).toHaveProperty("error");
	});

	it("clamps positions and drops edges to unknown steps", () => {
		const r = validateFlowSpec({
			...base,
			nodes: [base.nodes[0], { ...base.nodes[1], col: 99, row: -5 }],
			edges: [...base.edges, { from: "a", to: "zzz", label: "", dashed: false, route: "elbow" }],
		});
		if (!("spec" in r)) throw new Error("expected spec");
		expect(r.spec.nodes[1]).toMatchObject({ col: 1, row: 0 });
		expect(r.spec.edges).toHaveLength(1);
	});

	it("round-trips a template frame through frameToSpec", () => {
		const t = TEMPLATES[0];
		const board: Board = { v: 1, name: "x", elements: buildTemplate(t, { x: 100, y: 50 }) };
		const spec = frameToSpec(board, board.elements[0].id)!;
		expect(spec.nodes).toHaveLength(t.nodes.length);
		expect(spec.edges).toHaveLength(t.edges.length);
		expect(spec.nodes.map((n) => [n.col, n.row]).sort()).toEqual(t.nodes.map((n) => [n.col, n.row]).sort());
	});
});

describe("safeReturnTo", () => {
	it("keeps in-app paths and rejects anything that could leave the site", async () => {
		const { safeReturnTo } = await import("../worker/http");
		expect(safeReturnTo("/?board=abc&share=1")).toBe("/?board=abc&share=1");
		for (const bad of [null, "", "https://evil.com", "//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "javascript:alert(1)"]) {
			expect(safeReturnTo(bad)).toBe("/");
		}
	});
});
