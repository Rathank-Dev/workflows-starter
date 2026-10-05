import { useMemo } from "react";
import type { Board } from "../../shared/board";
import { TEMPLATES, buildTemplate, templateSize, type FlowTemplate } from "../../shared/templates";
import { EdgeMarkers, Scene } from "../board/Scene";
import "./landing.css";

const BOARD_URL = "/board";

/** A real template, rendered by the same code the board uses. */
function FlowPreview({ template, className }: { template: FlowTemplate; className?: string }) {
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

function Logo() {
	return (
		<a className="ly-logo" href="/" aria-label="Flowyard home">
			<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
				<rect x="1.5" y="3" width="11" height="8" rx="2.5" fill="var(--accent)" />
				<rect x="13.5" y="15" width="11" height="8" rx="4" fill="none" stroke="var(--fg)" strokeWidth="1.75" />
				<path d="M7 11v8h6.5" fill="none" stroke="var(--fg)" strokeWidth="1.75" strokeLinecap="round" />
			</svg>
			<span>Flowyard</span>
		</a>
	);
}

const TICKER = [
	"OAuth 2.0 + PKCE",
	"Request lifecycle",
	"NIST incident response",
	"Secure CI/CD",
	"Sign-in with MFA",
	"Live collaboration",
	"PNG · SVG · JSON export",
	"Claude · Gemini · DeepSeek · Workers AI",
];

const PROBLEMS = [
	{
		title: "Diagrams go stale",
		body: "The architecture diagram in the wiki is from two reorgs ago. Nobody updates it because opening the tool is a chore.",
		tag: "Wikis · Slide decks",
	},
	{
		title: "Reviews need real detail",
		body: "A box labeled “auth” doesn't survive a security review. Reviewers want the checks: state, PKCE, audience, expiry.",
		tag: "Threat models · Audits",
	},
	{
		title: "Blank canvas, slow start",
		body: "Every flow starts with twenty minutes of dragging boxes before anyone talks about the actual system.",
		tag: "Templates · Assistant",
	},
	{
		title: "Screenshots don't collaborate",
		body: "A PNG in a chat thread can't be corrected. A shared board can, by everyone in the meeting, at once.",
		tag: "Live links · Sync",
	},
];

const PROVIDERS = [
	{ k: "Claude", v: "Anthropic" },
	{ k: "Gemini", v: "Google" },
	{ k: "DeepSeek", v: "DeepSeek" },
	{ k: "Workers AI", v: "Runs on Cloudflare, no key" },
];

const STEPS = [
	{ n: "01 · Open", h: "No account needed", p: "Open the board and start drawing. Your work saves in your browser until you decide to share it." },
	{ n: "02 · Draw", h: "Template or assistant", p: "Drop in a ready-made flow, draw your own, or describe one and let the assistant lay it out." },
	{ n: "03 · Share", h: "One link, live", p: "Sign in with GitHub, Google, or Discord to create a link. Everyone with it edits together in real time." },
	{ n: "04 · Export", h: "Take it anywhere", p: "Download PNG or SVG for docs and decks, or a board file you can open again later." },
];

export function Landing() {
	const hero = TEMPLATES.find((t) => t.id === "oauth-pkce") ?? TEMPLATES[0];
	return (
		<div className="ly">
			<nav className="ly-nav">
				<div className="ly-inner">
					<Logo />
					<div className="ly-links">
						<a href="#templates">Templates</a>
						<a href="#assistant">Assistant</a>
						<a href="#process">How it works</a>
					</div>
					<a className="ly-cta" href={BOARD_URL}>
						Open the board &rarr;
					</a>
				</div>
			</nav>

			<main>
				<section className="ly-hero">
					<div className="ly-inner ly-hero-grid">
						<div>
							<div className="ly-eyebrow">
								<span className="ly-live" />
								Flowcharts for security &amp; systems teams
							</div>
							<h1>
								Map every flow.
								<br />
								Share it <em>live.</em>
							</h1>
							<p className="ly-sub">
								Flowyard is a whiteboard for security and architecture flows. Start from a template, or describe a flow and the
								assistant draws it. Share one link and edit together in real time.
							</p>
							<div className="ly-actions">
								<a className="ly-btn-primary" href={BOARD_URL}>
									Open the board
								</a>
								<a className="ly-btn-ghost" href="#templates">
									See the templates <span className="ly-arr">&rarr;</span>
								</a>
							</div>
							<div className="ly-stats">
								<div>
									<span className="n">{TEMPLATES.length}</span>
									<span className="l">Ready-made flows</span>
								</div>
								<div>
									<span className="n">4</span>
									<span className="l">AI models</span>
								</div>
								<div>
									<span className="n">0</span>
									<span className="l">Installs</span>
								</div>
							</div>
						</div>
						<div className="ly-preview" aria-hidden="false">
							<div className="ly-preview-bar">
								<span className="mono">board / {hero.title.toLowerCase()}</span>
								<span className="ly-preview-live">
									<span className="ly-live" /> live
								</span>
							</div>
							<FlowPreview template={hero} className="ly-preview-svg" />
						</div>
					</div>
				</section>

				<div className="ly-ticker" aria-hidden="true">
					<div className="ly-ticker-inner">
						{[...TICKER, ...TICKER].map((t, i) => (
							<span className="ly-ticker-item" key={i}>
								<span className="dot" />
								{t}
							</span>
						))}
					</div>
				</div>

				<section id="problem">
					<div className="ly-inner">
						<div className="ly-sec-label">The problem</div>
						<h2 className="ly-head">
							Where system diagrams
							<br />
							fall <em>apart.</em>
						</h2>
						<p className="ly-section-sub">
							Teams don't skip diagrams because they're useless. They skip them because the tools make every diagram expensive to start
							and impossible to keep current.
						</p>
						<div className="ly-grid ly-grid-4">
							{PROBLEMS.map((p, i) => (
								<div className="ly-card" key={p.title}>
									<span className="num">{String(i + 1).padStart(2, "0")}</span>
									<h3>{p.title}</h3>
									<p>{p.body}</p>
									<span className="tag">{p.tag}</span>
								</div>
							))}
						</div>
					</div>
				</section>

				<section id="templates">
					<div className="ly-inner">
						<div className="ly-sec-label">Templates</div>
						<h2 className="ly-head">
							Start from flows
							<br />
							that are <em>right.</em>
						</h2>
						<p className="ly-section-sub">
							Each template follows the real standard, with the actual checks named. Open one and it lands on your board, ready to edit.
						</p>
						<div className="ly-grid ly-grid-3 ly-templates">
							{TEMPLATES.map((t, i) => (
								<a className="ly-template" key={t.id} href={`${BOARD_URL}#template=${t.id}`}>
									<div className="ly-template-thumb">
										<FlowPreview template={t} />
									</div>
									<span className="tier">// Template {String(i + 1).padStart(2, "0")}</span>
									<h3>{t.title}</h3>
									<p>{t.subtitle}</p>
									<span className="bottom">
										Open on the board <span className="ly-arr">&rarr;</span>
									</span>
								</a>
							))}
							<a className="ly-template ly-template-blank" href={BOARD_URL}>
								<span className="tier">// Blank</span>
								<h3>Your own flow</h3>
								<p>Boxes, decisions, databases, sticky notes, frames, and connectors that route themselves.</p>
								<span className="bottom">
									Start drawing <span className="ly-arr">&rarr;</span>
								</span>
							</a>
						</div>
					</div>
				</section>

				<section id="assistant">
					<div className="ly-inner ly-split">
						<div>
							<div className="ly-sec-label">Assistant</div>
							<h2 className="ly-head">
								Describe it.
								<br />
								Get a <em>diagram.</em>
							</h2>
							<p className="ly-section-sub">
								Ask for a flow and the assistant draws it as a frame on your board. Select a frame and ask for a change, and it edits that
								flow in place. Every change is one undo away.
							</p>
						</div>
						<div>
							<blockquote className="ly-quote">
								“Draw a password reset flow with rate limiting and single-use tokens.”
							</blockquote>
							<div className="ly-cells">
								{PROVIDERS.map((p) => (
									<div className="ly-cell" key={p.k}>
										<span className="k">{p.k}</span>
										<span className="v">{p.v}</span>
									</div>
								))}
							</div>
						</div>
					</div>
				</section>

				<section id="process">
					<div className="ly-inner">
						<div className="ly-sec-label">How it works</div>
						<h2 className="ly-head">
							From idea to shared
							<br />
							diagram in <em>minutes.</em>
						</h2>
						<div className="ly-process">
							{STEPS.map((s) => (
								<div className="ly-step" key={s.n}>
									<span className="n">// {s.n}</span>
									<h3>{s.h}</h3>
									<p>{s.p}</p>
								</div>
							))}
						</div>
					</div>
				</section>

				<section className="ly-cta-section">
					<div className="ly-inner ly-cta-grid">
						<h2>
							Your next flow is
							<br />
							one click <em>away.</em>
						</h2>
						<div>
							<a className="ly-btn-primary" href={BOARD_URL}>
								Open the board
							</a>
							<p className="ly-cta-detail">No signup to draw. Sign in only when you want a share link.</p>
						</div>
					</div>
				</section>
			</main>

			<footer className="ly-footer">
				<Logo />
				<div className="ly-footer-links">
					<a href={BOARD_URL}>Board</a>
					<a href="#templates">Templates</a>
					<a href="#assistant">Assistant</a>
				</div>
				<span>© {new Date().getFullYear()} Flowyard</span>
			</footer>
		</div>
	);
}
