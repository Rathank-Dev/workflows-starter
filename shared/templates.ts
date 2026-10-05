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
