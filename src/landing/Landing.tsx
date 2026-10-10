import { useEffect, useRef, useState } from "react";
import { TEMPLATES } from "../../shared/templates";
import { AccountButton } from "../board/account";
import { FlowPreview } from "../board/FlowPreview";
import { Mark } from "../board/icons";
import { useSession } from "../session";
import "./landing.css";

const BOARD_URL = "/board";

/** The five meanings every Flowyard diagram uses; the page's colors come from these. */
const MEANINGS = [
	{ key: "step", shape: "rect", name: "Step", text: "Something a system or person does." },
	{ key: "decision", shape: "diamond", name: "Decision", text: "A question with a yes and a no branch." },
	{ key: "check", shape: "rect", name: "Security check", text: "Where a token, signature, or permission is verified." },
	{ key: "deny", shape: "rect", name: "Denied", text: "The error response or block when a check fails." },
	{ key: "pass", shape: "rect", name: "Success", text: "The request gets through." },
] as const;

function MeaningGlyph({ shape }: { shape: "rect" | "diamond" }) {
	return (
		<svg width="44" height="30" viewBox="0 0 44 30" aria-hidden="true">
			{shape === "diamond" ? (
				<polygon points="22,2 42,15 22,28 2,15" className="glyph" />
			) : (
				<rect x="2" y="5" width="40" height="20" rx="5" className="glyph" />
			)}
		</svg>
	);
}

/**
 * The hero board draws itself once: shapes and connectors appear in reading
 * order. Static when the visitor prefers reduced motion.
 */
function HeroBoard() {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const root = ref.current;
		if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const parts = Array.from(root.querySelectorAll<SVGGElement>("g[data-id]"));
		// Order by vertical position so the flow builds top to bottom
		const y = (g: SVGGElement) => g.getBBox().y;
		parts.sort((a, b) => y(a) - y(b));
		parts.forEach((g, i) => {
			g.style.animationDelay = `${200 + i * 70}ms`;
		});
		root.classList.add("is-drawing");
	}, []);
	const mfa = TEMPLATES.find((t) => t.id === "login-mfa") ?? TEMPLATES[0];
	return (
		<div className="hero-board" ref={ref}>
			<FlowPreview template={mfa} className="hero-board-svg" />
		</div>
	);
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const DEMO_PROMPT = "Draw a sign-in flow with MFA, rate limiting, and an audit log.";
const DEMO_REPLY = "I drew it with a password check, a second factor, and session setup.";

const STAGES = ["idle", "prompt", "thinking", "reply", "done"] as const;
type DemoStage = (typeof STAGES)[number];

/**
 * The assistant example plays like a real exchange when it scrolls into view:
 * the request types out, the assistant thinks, replies, and the flow draws
 * itself. Shows the finished exchange when the visitor prefers reduced motion.
 */
function AssistantDemo() {
	const ref = useRef<HTMLDivElement>(null);
	const [stage, setStage] = useState<DemoStage>(() => (reducedMotion() ? "done" : "idle"));
	const [typed, setTyped] = useState(0);

	useEffect(() => {
		const root = ref.current;
		if (!root || reducedMotion()) return;
		const timers: number[] = [];
		const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
		const type = (text: string, next: () => void) => {
			let i = 0;
			const tick = () => {
				i += 1;
				setTyped(i);
				if (i < text.length) later(tick, 18 + Math.random() * 34);
				else later(next, 450);
			};
			later(tick, 300);
		};
		const run = () => {
			setStage("prompt");
			setTyped(0);
			type(DEMO_PROMPT, () => {
				setStage("thinking");
				later(() => {
					setStage("reply");
					setTyped(0);
					type(DEMO_REPLY, () => setStage("done"));
				}, 1300);
			});
		};
		const seen = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					seen.disconnect();
					run();
				}
			},
			{ threshold: 0.4 },
		);
		seen.observe(root);
		return () => {
			seen.disconnect();
			timers.forEach(clearTimeout);
		};
	}, []);

	// Once the flow is on screen, draw it in reading order like the hero
	useEffect(() => {
		if (stage !== "done") return;
		const root = ref.current?.querySelector<HTMLDivElement>(".fy-chat-result");
		if (!root || reducedMotion()) return;
		const parts = Array.from(root.querySelectorAll<SVGGElement>("g[data-id]"));
		parts.sort((a, b) => a.getBBox().y - b.getBBox().y);
		parts.forEach((g, i) => {
			g.style.animationDelay = `${i * 60}ms`;
		});
		root.classList.add("is-drawing");
	}, [stage]);

	const after = (s: DemoStage) => STAGES.indexOf(stage) > STAGES.indexOf(s);
	const promptText = stage === "prompt" ? DEMO_PROMPT.slice(0, typed) : DEMO_PROMPT;
	const replyText = stage === "reply" ? DEMO_REPLY.slice(0, typed) : DEMO_REPLY;

	return (
		<div className="fy-chat" ref={ref} aria-label={`Example: you ask "${DEMO_PROMPT}" and the assistant replies "${DEMO_REPLY}"`} role="img">
			<div className="fy-chat-head" aria-hidden="true">
				<span className="fy-chat-dot" data-live={stage === "thinking" || stage === "reply" || undefined} />
				Assistant
			</div>
			<div className="fy-chat-log" aria-hidden="true">
				{stage !== "idle" && (
					<p className="fy-bubble fy-bubble-you">
						{promptText}
						{stage === "prompt" && <span className="fy-caret" />}
					</p>
				)}
				{stage === "thinking" && (
					<p className="fy-bubble fy-bubble-ai fy-thinking">
						<span />
						<span />
						<span />
					</p>
				)}
				{after("thinking") && (
					<p className="fy-bubble fy-bubble-ai">
						{replyText}
						{stage === "reply" && <span className="fy-caret" />}
					</p>
				)}
				{stage === "done" && (
					<div className="fy-chat-result">
						<FlowPreview template={TEMPLATES.find((t) => t.id === "login-mfa") ?? TEMPLATES[0]} />
					</div>
				)}
			</div>
			<div className="fy-chat-input" aria-hidden="true">
				<span>Describe a flow…</span>
				<span className="fy-chat-send">Send</span>
			</div>
		</div>
	);
}

function CursorArrow() {
	return (
		<svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
			<path d="M1 1l13 7-6 1.5L5 16z" />
		</svg>
	);
}

export function Landing() {
	const session = useSession();
	return (
		<div className="fy">
			<header className="fy-nav">
				<a className="fy-brand" href="/" aria-label="Flowyard home">
					<Mark />
					<span>Flowyard</span>
				</a>
				<nav className="fy-links" aria-label="Sections">
					<a href="#templates">Templates</a>
					<a href="#assistant">Assistant</a>
					<a href="/dashboard">Dashboard</a>
				</nav>
				<div className="fy-nav-actions">
					{/* Nothing until the session loads, so signed-in people never see "Sign in" flash */}
					{!session.loading &&
						(session.user ? (
							<AccountButton session={session} onSignIn={() => window.location.assign("/dashboard")} />
						) : (
							<a className="fy-btn fy-btn-link" href="/dashboard">
								Sign in
							</a>
						))}
					<a className="fy-btn fy-btn-outline" href={BOARD_URL}>
						Start a board
					</a>
				</div>
			</header>

			<main>
				<section className="fy-hero">
					<div className="fy-hero-copy">
						<p className="fy-eyebrow">
								<span className="fy-eyebrow-rule" aria-hidden="true" />
								<span className="fy-eyebrow-dot" aria-hidden="true" />
								Flowcharts for security teams
							</p>
							<h1>
								Draw the flow.
								<br />
								Ship it <em>secure.</em>
							</h1>
						<p>
							Flowyard is a whiteboard for security and system flows. Start from a real template, or describe a flow and the
							assistant draws it. Share one link and edit together, live.
						</p>
						<div className="fy-actions">
							<a className="fy-btn fy-btn-primary fy-btn-large" href={BOARD_URL}>
								Start a board
							</a>
							<a className="fy-btn fy-btn-link fy-btn-large" href="#templates">
								Browse templates
							</a>
						</div>
						<p className="fy-fineprint">Free to draw, no account needed. Sign in with GitHub to share.</p>
					</div>
					<HeroBoard />
				</section>

				<section className="fy-meanings" aria-labelledby="meanings-title">
					<h2 id="meanings-title">
						Every color <em>means</em> something.
					</h2>
					<p className="fy-lede">
						Flowyard boards share one visual language, so anyone reading a flow knows where the checks are and what happens when
						they fail.
					</p>
					<ul className="fy-meaning-list">
						{MEANINGS.map((m) => (
							<li key={m.key} data-meaning={m.key}>
								<MeaningGlyph shape={m.shape} />
								<strong>{m.name}</strong>
								<span>{m.text}</span>
							</li>
						))}
					</ul>
				</section>

				<section className="fy-templates" id="templates" aria-labelledby="templates-title">
					<div className="fy-section-head">
						<h2 id="templates-title">
							Start from a flow that's already <em>right.</em>
						</h2>
						<p className="fy-lede">Each template follows the real standard and names the actual checks. Open one and edit it.</p>
					</div>
					<ul className="fy-template-grid">
						{TEMPLATES.map((t) => (
							<li key={t.id}>
								<a className="fy-template" href={`${BOARD_URL}#template=${t.id}`}>
									<span className="fy-template-thumb">
										<FlowPreview template={t} />
									</span>
									<strong>{t.title}</strong>
									<span>{t.subtitle}</span>
								</a>
							</li>
						))}
					</ul>
				</section>

				<section className="fy-assistant" id="assistant" aria-labelledby="assistant-title">
					<div className="fy-assistant-copy">
						<h2 id="assistant-title">
							Describe it. Get a <em>diagram.</em>
						</h2>
						<p className="fy-lede">
							Ask for a flow and the assistant draws it on your board. Select a frame and ask for a change, and it edits that flow
							in place. Every change can be undone.
						</p>
						<p className="fy-fineprint">Three assistant requests a day on the free plan.</p>
					</div>
					<AssistantDemo />
				</section>

				<section className="fy-team" aria-labelledby="team-title">
					<div className="fy-team-copy">
						<h2 id="team-title">
							Make AI a team <em>sport.</em>
						</h2>
						<p className="fy-lede">Connect your AI tools to collaborate on their outputs.</p>
						<div className="fy-actions">
							<a className="fy-btn fy-btn-primary fy-btn-large" href="/dashboard">
								Connect
							</a>
						</div>
					</div>
					<div className="fy-team-board" role="img" aria-label="Teammates reviewing a flow the assistant drew, with live cursors and a comment">
						<FlowPreview template={TEMPLATES.find((t) => t.id === "secure-pipeline") ?? TEMPLATES[0]} />
						<span className="fy-cursor" data-who="a" aria-hidden="true">
							<CursorArrow />
							<span>Assistant</span>
						</span>
						<span className="fy-cursor" data-who="b" aria-hidden="true">
							<CursorArrow />
							<span>Dara</span>
						</span>
						<span className="fy-cursor" data-who="c" aria-hidden="true">
							<CursorArrow />
							<span>Sok</span>
						</span>
						<p className="fy-comment" aria-hidden="true">
							<strong>Dara</strong> Add an approval step before prod?
						</p>
					</div>
				</section>

				<section className="fy-how" aria-labelledby="how-title">
					<h2 id="how-title">
						How it <em>works.</em>
					</h2>
					<ol className="fy-how-flow">
						<li>
							<strong>Draw</strong>
							<span>Open a board, no account needed. Your work saves in this browser.</span>
						</li>
						<li>
							<strong>Share</strong>
							<span>Sign in with GitHub to get a link. Everyone with it edits live.</span>
						</li>
						<li>
							<strong>Export</strong>
							<span>Download PNG or SVG for docs and reviews, or a board file to reopen later.</span>
						</li>
					</ol>
				</section>

				<section className="fy-cta">
					<h2>
						Your next flow starts on a blank <em>board.</em>
					</h2>
					<a className="fy-btn fy-btn-primary fy-btn-large" href={BOARD_URL}>
						Start a board
					</a>
				</section>
			</main>

			<footer className="fy-footer">
				<a className="fy-brand" href="/">
					<Mark />
					<span>Flowyard</span>
				</a>
				<nav aria-label="Footer">
					<a href={BOARD_URL}>Board</a>
					<a href="/dashboard">Dashboard</a>
					<a href="#templates">Templates</a>
					<a href="/privacy">Privacy</a>
					<a href="/terms">Terms</a>
				</nav>
				<span>© {new Date().getFullYear()} Flowyard</span>
			</footer>
		</div>
	);
}
