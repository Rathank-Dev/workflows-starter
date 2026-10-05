import {
	DEFAULT_SIZE,
	FRAME_HEADER,
	newId,
	type Board,
	type BoardEl,
	type ColorKey,
	type EdgeEl,
	type Point,
	type ShapeEl,
	type ShapeKind,
} from "./board";

/**
 * Ready-made flows. Each is laid out on a grid of columns and rows inside one
 * frame; `col` and `row` may be fractional to nudge a node.
 */

interface NodeSpec {
	k: string;
	t: string;
	col: number;
	row: number;
	c?: ColorKey;
	s?: ShapeKind;
	w?: number;
}

/** [from, to, label, dashed, route] */
type EdgeSpec = [string, string, string?, boolean?, EdgeEl["route"]?];

export interface FlowTemplate {
	id: string;
	title: string;
	subtitle: string;
	cols: number;
	rows: number;
	nodes: NodeSpec[];
	edges: EdgeSpec[];
}

const COL_W = 236;
const ROW_H = 124;
const PAD_X = 40;
const PAD_TOP = FRAME_HEADER + 20;
const PAD_BOTTOM = 32;

export function templateSize(t: FlowTemplate): { w: number; h: number } {
	return { w: PAD_X * 2 + t.cols * COL_W, h: PAD_TOP + t.rows * ROW_H + PAD_BOTTOM };
}

/** Builds fresh elements (new ids) for a template with its frame at `origin`. */
export function buildTemplate(t: FlowTemplate, origin: Point): BoardEl[] {
	const size = templateSize(t);
	const out: BoardEl[] = [
		{
			id: newId(),
			type: "frame",
			x: origin.x,
			y: origin.y,
			w: size.w,
			h: size.h,
			title: t.title,
			subtitle: t.subtitle,
		},
	];
	const ids = new Map<string, string>();
	for (const n of t.nodes) {
		const shape = n.s ?? "rect";
		const base = DEFAULT_SIZE[shape];
		const w = n.w ?? base.w;
		const h = base.h;
		const cx = origin.x + PAD_X + n.col * COL_W + COL_W / 2;
		const cy = origin.y + PAD_TOP + n.row * ROW_H + ROW_H / 2;
		const id = newId();
		ids.set(n.k, id);
		const el: ShapeEl = {
			id,
			type: "shape",
			shape,
			color: n.c ?? "white",
			text: n.t,
			textSize: "m",
			bold: shape === "pill",
			x: Math.round(cx - w / 2),
			y: Math.round(cy - h / 2),
			w,
			h,
		};
		out.push(el);
	}
	for (const [from, to, label, dashed, route] of t.edges) {
		const a = ids.get(from);
		const b = ids.get(to);
		if (!a || !b) throw new Error(`Template ${t.id}: unknown node in edge ${from} → ${to}`);
		const edge: EdgeEl = {
			id: newId(),
			type: "edge",
			from: a,
			to: b,
			label: label ?? "",
			dashed: dashed ?? false,
			arrow: "end",
			route: route ?? "elbow",
		};
		out.push(edge);
	}
	return out;
}

export const TEMPLATES: FlowTemplate[] = [
	{
		id: "oauth-pkce",
		title: "Authorization flow",
		subtitle: "OAuth 2.0 authorization code with PKCE (RFC 7636)",
		cols: 3,
		rows: 10,
		nodes: [
			{ k: "lc", t: "Client app", col: 0, row: 0, s: "pill", c: "grey" },
			{ k: "la", t: "Authorization server", col: 1, row: 0, s: "pill", c: "grey" },
			{ k: "lr", t: "Resource API", col: 2, row: 0, s: "pill", c: "grey" },
			{ k: "pkce", t: "Generate code_verifier and S256 code_challenge", col: 0, row: 1, c: "blue" },
			{ k: "redir", t: "Redirect to /authorize with challenge + state", col: 0, row: 2, c: "blue" },
			{ k: "login", t: "User signs in with MFA", col: 1, row: 2, c: "purple" },
			{ k: "consent", t: "Consent granted?", col: 1, row: 3, s: "diamond", c: "yellow" },
			{ k: "denied", t: "Show access_denied error", col: 0, row: 3, c: "red" },
			{ k: "code", t: "Return code + state to redirect_uri", col: 1, row: 4, c: "green" },
			{ k: "exch", t: "Check state, POST /token with code + verifier", col: 0, row: 5, c: "blue" },
			{ k: "verify", t: "Check SHA-256(verifier) matches challenge", col: 1, row: 5, c: "purple" },
			{ k: "issue", t: "Issue short-lived access token + refresh token", col: 1, row: 6, c: "green" },
			{ k: "call", t: "Call API with Authorization: Bearer", col: 0, row: 7, c: "blue" },
			{ k: "jwt", t: "Validate JWT signature, iss, aud, exp, scope", col: 2, row: 7, c: "purple" },
			{ k: "valid", t: "Token valid?", col: 2, row: 8, s: "diamond", c: "yellow" },
			{ k: "401", t: "401 Unauthorized", col: 1, row: 8, c: "red" },
			{ k: "200", t: "200 OK with data", col: 2, row: 9, c: "green" },
		],
		edges: [
			["pkce", "redir"],
			["redir", "login"],
			["login", "consent"],
			["consent", "denied", "No"],
			["consent", "code", "Yes"],
			["code", "exch"],
			["exch", "verify"],
			["verify", "issue"],
			["issue", "call", "tokens", true],
			["call", "jwt"],
			["jwt", "valid"],
			["valid", "401", "No"],
			["valid", "200", "Yes"],
		],
	},
	{
		id: "request-lifecycle",
		title: "Request lifecycle",
		subtitle: "From the browser to the database and back",
		cols: 3,
		rows: 10,
		nodes: [
			{ k: "req", t: "Client request", col: 0, row: 0, s: "pill", c: "grey" },
			{ k: "dns", t: "DNS resolves to edge IP", col: 0, row: 1, c: "blue" },
			{ k: "tls", t: "TLS 1.3 handshake", col: 0, row: 2, c: "blue" },
			{ k: "waf", t: "Passes WAF and bot checks?", col: 0, row: 3, s: "diamond", c: "yellow" },
			{ k: "403a", t: "403 Blocked, event sent to SIEM", col: 1, row: 3, c: "red" },
			{ k: "rate", t: "Under rate limit?", col: 0, row: 4, s: "diamond", c: "yellow" },
			{ k: "429", t: "429 Too Many Requests", col: 1, row: 4, c: "red" },
			{ k: "authn", t: "Authenticated?", col: 0, row: 5, s: "diamond", c: "yellow" },
			{ k: "401", t: "401 Unauthorized", col: 1, row: 5, c: "red" },
			{ k: "authz", t: "Allowed for this resource?", col: 0, row: 6, s: "diamond", c: "yellow" },
			{ k: "403b", t: "403 Forbidden", col: 1, row: 6, c: "red" },
			{ k: "svc", t: "Service handler validates input", col: 0, row: 7, c: "purple" },
			{ k: "cache", t: "Cache hit?", col: 1, row: 7, s: "diamond", c: "yellow" },
			{ k: "db", t: "Primary database", col: 2, row: 7, s: "cylinder", c: "blue" },
			{ k: "build", t: "Build response", col: 1, row: 8, c: "green" },
			{ k: "logs", t: "Structured logs + traces", col: 2, row: 9, c: "purple" },
			{ k: "res", t: "Response sent", col: 0, row: 9, s: "pill", c: "grey" },
		],
		edges: [
			["req", "dns"],
			["dns", "tls"],
			["tls", "waf"],
			["waf", "403a", "No"],
			["waf", "rate", "Yes"],
			["rate", "429", "No"],
			["rate", "authn", "Yes"],
			["authn", "401", "No"],
			["authn", "authz", "Yes"],
			["authz", "403b", "No"],
			["authz", "svc", "Yes"],
			["svc", "cache"],
			["cache", "db", "No"],
			["cache", "build", "Yes"],
			["db", "build", "", false, "corner"],
			["build", "logs", "", true, "corner"],
			["build", "res"],
		],
	},
	{
		id: "incident-response",
		title: "Incident response",
		subtitle: "NIST SP 800-61 lifecycle for a security alert",
		cols: 3,
		rows: 6,
		nodes: [
			{ k: "alert", t: "SIEM alert or user report", col: 0, row: 0, s: "pill", c: "grey" },
			{ k: "triage", t: "Triage: severity, scope, affected assets", col: 0, row: 1, c: "blue" },
			{ k: "tp", t: "True positive?", col: 0, row: 2, s: "diamond", c: "yellow" },
			{ k: "close", t: "Close and tune the detection rule", col: 1, row: 2, c: "grey" },
			{ k: "contain", t: "Contain: isolate host, revoke credentials", col: 0, row: 3, c: "orange" },
			{ k: "evidence", t: "Preserve evidence with chain of custody", col: 1, row: 3, c: "blue" },
			{ k: "notify", t: "Notify stakeholders and regulators if data exposed", col: 2, row: 3, c: "red", w: 200 },
			{ k: "erad", t: "Eradicate: remove persistence, fix root cause", col: 0, row: 4, c: "orange" },
			{ k: "recover", t: "Recover from clean backups, watch closely", col: 0, row: 5, c: "green" },
			{ k: "review", t: "Post-incident review", col: 1, row: 5, c: "purple" },
			{ k: "update", t: "Update playbooks and detections", col: 2, row: 5, c: "green" },
		],
		edges: [
			["alert", "triage"],
			["triage", "tp"],
			["tp", "close", "No"],
			["tp", "contain", "Yes"],
			["contain", "evidence", "", true],
			["evidence", "notify"],
			["contain", "erad"],
			["erad", "recover"],
			["recover", "review"],
			["review", "update"],
		],
	},
	{
		id: "secure-pipeline",
		title: "Secure CI/CD pipeline",
		subtitle: "Every change scanned, signed, and released gradually",
		cols: 3,
		rows: 8,
		nodes: [
			{ k: "push", t: "Push or pull request", col: 1, row: 0, s: "pill", c: "grey" },
			{ k: "lint", t: "Lint + unit tests", col: 0, row: 1, c: "blue" },
			{ k: "sast", t: "SAST + secret scan", col: 1, row: 1, c: "blue" },
			{ k: "sca", t: "Dependency + license scan", col: 2, row: 1, c: "blue" },
			{ k: "checks", t: "All checks pass?", col: 1, row: 2, s: "diamond", c: "yellow" },
			{ k: "block", t: "Block merge, notify author", col: 2, row: 2, c: "red" },
			{ k: "build", t: "Build image from pinned base", col: 1, row: 3, c: "purple" },
			{ k: "sign", t: "Sign image, attach SBOM, push to registry", col: 1, row: 4, c: "purple" },
			{ k: "stage", t: "Deploy to staging, run DAST", col: 1, row: 5, c: "green" },
			{ k: "approve", t: "Release approved?", col: 1, row: 6, s: "diamond", c: "yellow" },
			{ k: "hold", t: "Hold release", col: 2, row: 6, c: "grey" },
			{ k: "canary", t: "Canary 5% → 100%", col: 1, row: 7, c: "green" },
			{ k: "rollback", t: "Automatic rollback on SLO breach", col: 0, row: 7, c: "red" },
		],
		edges: [
			["push", "lint"],
			["push", "sast"],
			["push", "sca"],
			["lint", "checks"],
			["sast", "checks"],
			["sca", "checks"],
			["checks", "block", "No"],
			["checks", "build", "Yes"],
			["build", "sign"],
			["sign", "stage"],
			["stage", "approve"],
			["approve", "hold", "No"],
			["approve", "canary", "Yes"],
			["canary", "rollback", "SLO breach", true],
		],
	},
	{
		id: "login-mfa",
		title: "Sign-in with MFA",
		subtitle: "Password check, second factor, and session setup",
		cols: 3,
		rows: 7,
		nodes: [
			{ k: "submit", t: "User submits email + password", col: 1, row: 0, s: "pill", c: "grey" },
			{ k: "limit", t: "Rate limit by IP and account", col: 1, row: 1, c: "purple" },
			{ k: "pw", t: "Password matches (Argon2id)?", col: 1, row: 2, s: "diamond", c: "yellow" },
			{ k: "fail", t: "Count failure, lock after 5 tries", col: 0, row: 2, c: "red" },
			{ k: "enrolled", t: "MFA enrolled?", col: 1, row: 3, s: "diamond", c: "yellow" },
			{ k: "enroll", t: "Require MFA enrollment", col: 2, row: 3, c: "orange" },
			{ k: "challenge", t: "Challenge with WebAuthn or TOTP", col: 1, row: 4, c: "blue" },
			{ k: "ok", t: "Second factor valid?", col: 1, row: 5, s: "diamond", c: "yellow" },
			{ k: "generic", t: "Show generic error, log attempt", col: 0, row: 5, c: "red" },
			{ k: "session", t: "Rotate session ID, set HttpOnly Secure cookie", col: 1, row: 6, c: "green" },
			{ k: "audit", t: "Audit event to SIEM", col: 2, row: 6, c: "purple" },
		],
		edges: [
			["submit", "limit"],
			["limit", "pw"],
			["pw", "fail", "No"],
			["pw", "enrolled", "Yes"],
			["enrolled", "enroll", "No"],
			["enrolled", "challenge", "Yes"],
			["enroll", "challenge", "", false, "corner"],
			["challenge", "ok"],
			["ok", "generic", "No"],
			["ok", "session", "Yes"],
			["session", "audit", "", true],
		],
	},
];

/** The board a new visitor sees: three flows side by side. */
export function starterBoard(): Board {
	const elements: BoardEl[] = [];
	let x = 0;
	for (const id of ["oauth-pkce", "request-lifecycle", "incident-response"]) {
		const t = TEMPLATES.find((t) => t.id === id)!;
		elements.push(...buildTemplate(t, { x, y: 0 }));
		x += templateSize(t).w + 120;
	}
	elements.sort((a, b) => Number(b.type === "frame") - Number(a.type === "frame"));
	return { v: 1, name: "Security architecture", elements };
}

/* ------------------------------------------------------------------ */
/* Flow specs: the JSON shape the AI assistant reads and writes        */
/* ------------------------------------------------------------------ */

export interface FlowSpecNode {
	k: string;
	t: string;
	col: number;
	row: number;
	c: ColorKey;
	s: ShapeKind;
}

export interface FlowSpecEdge {
	from: string;
	to: string;
	label: string;
	dashed: boolean;
	route: EdgeEl["route"];
}

export interface FlowSpec {
	title: string;
	subtitle: string;
	cols: number;
	rows: number;
	nodes: FlowSpecNode[];
	edges: FlowSpecEdge[];
}

export const FLOW_LIMITS = { cols: 6, rows: 18, nodes: 48, edges: 96, text: 120 };

const COLOR_SET = new Set<string>(["white", "grey", "red", "orange", "yellow", "green", "blue", "purple"]);
const SHAPE_SET = new Set<string>(["rect", "pill", "diamond", "cylinder", "note"]);
const ROUTE_SET = new Set<string>(["elbow", "corner", "straight"]);

/**
 * Checks an untrusted flow spec (from the model or the client). Returns a
 * clean copy, or a message saying what's wrong.
 */
export function validateFlowSpec(input: unknown): { spec: FlowSpec } | { error: string } {
	const L = FLOW_LIMITS;
	if (typeof input !== "object" || input === null) return { error: "Flow is not an object." };
	const f = input as Record<string, unknown>;
	const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
	const int = (v: unknown, min: number, max: number) =>
		typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : min;

	const cols = int(f.cols, 1, L.cols);
	const rows = int(f.rows, 1, L.rows);
	if (!Array.isArray(f.nodes) || f.nodes.length === 0) return { error: "Flow has no steps." };
	if (f.nodes.length > L.nodes) return { error: `Flow has more than ${L.nodes} steps.` };
	if (!Array.isArray(f.edges) || f.edges.length > L.edges) return { error: "Flow has too many connections." };

	const keys = new Set<string>();
	const cells = new Set<string>();
	const nodes: FlowSpecNode[] = [];
	for (const raw of f.nodes as Record<string, unknown>[]) {
		const k = str(raw?.k, 40);
		if (!k || keys.has(k)) return { error: "Every step needs a unique key." };
		keys.add(k);
		// Snap to half cells and keep inside the grid
		const col = Math.min(cols - 1, Math.max(0, Math.round(Number(raw.col) * 2) / 2 || 0));
		const row = Math.min(rows - 1, Math.max(0, Math.round(Number(raw.row) * 2) / 2 || 0));
		const cell = `${col}:${row}`;
		if (cells.has(cell)) return { error: "Two steps share the same spot on the grid." };
		cells.add(cell);
		nodes.push({
			k,
			t: str(raw.t, L.text),
			col,
			row,
			c: (COLOR_SET.has(raw.c as string) ? raw.c : "white") as ColorKey,
			s: (SHAPE_SET.has(raw.s as string) ? raw.s : "rect") as ShapeKind,
		});
	}

	const edges: FlowSpecEdge[] = [];
	for (const raw of f.edges as Record<string, unknown>[]) {
		const from = str(raw?.from, 40);
		const to = str(raw?.to, 40);
		if (!keys.has(from) || !keys.has(to) || from === to) continue;
		edges.push({
			from,
			to,
			label: str(raw.label, 40),
			dashed: raw.dashed === true,
			route: (ROUTE_SET.has(raw.route as string) ? raw.route : "elbow") as EdgeEl["route"],
		});
	}

	return {
		spec: {
			title: str(f.title, 120) || "Untitled flow",
			subtitle: str(f.subtitle, 200),
			cols,
			rows,
			nodes,
			edges,
		},
	};
}

export function specToTemplate(spec: FlowSpec): FlowTemplate {
	return {
		id: "ai",
		title: spec.title,
		subtitle: spec.subtitle,
		cols: spec.cols,
		rows: spec.rows,
		nodes: spec.nodes.map((n) => ({ k: n.k, t: n.t, col: n.col, row: n.row, c: n.c, s: n.s })),
		edges: spec.edges.map((e) => [e.from, e.to, e.label, e.dashed, e.route]),
	};
}

/**
 * Describes a frame and the shapes inside it as a flow spec, so the
 * assistant can edit it. Shape ids become step keys.
 */
export function frameToSpec(board: Board, frameId: string): FlowSpec | null {
	const frame = board.elements.find((e) => e.id === frameId);
	if (!frame || frame.type !== "frame") return null;
	const inside = board.elements.filter(
		(e): e is ShapeEl =>
			e.type === "shape" &&
			e.x >= frame.x &&
			e.y >= frame.y &&
			e.x + e.w <= frame.x + frame.w &&
			e.y + e.h <= frame.y + frame.h,
	);
	const ids = new Set(inside.map((n) => n.id));
	const toCell = (center: number, origin: number, size: number) =>
		Math.max(0, Math.round(((center - origin) / size - 0.5) * 2) / 2);
	const nodes = inside.map((n) => ({
		k: n.id,
		t: n.text,
		col: toCell(n.x + n.w / 2, frame.x + PAD_X, COL_W),
		row: toCell(n.y + n.h / 2, frame.y + PAD_TOP, ROW_H),
		c: n.color,
		s: n.shape,
	}));
	const edges = board.elements
		.filter((e): e is EdgeEl => e.type === "edge" && ids.has(e.from) && ids.has(e.to))
		.map((e) => ({ from: e.from, to: e.to, label: e.label, dashed: e.dashed, route: e.route }));
	return {
		title: frame.title,
		subtitle: frame.subtitle,
		cols: Math.max(1, Math.ceil((frame.w - PAD_X * 2) / COL_W)),
		rows: Math.max(1, Math.ceil((frame.h - PAD_TOP - PAD_BOTTOM) / ROW_H)),
		nodes,
		edges,
	};
}
