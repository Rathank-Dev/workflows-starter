import { useEffect, useRef } from "react";
import { TEMPLATES } from "../../shared/templates";
import { FlowPreview } from "../board/FlowPreview";
import { Mark } from "../board/icons";
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

export function Landing() {
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
					<a className="fy-btn fy-btn-quiet" href="/dashboard">
						Sign in
					</a>
					<a className="fy-btn fy-btn-primary" href={BOARD_URL}>
						Start a board
					</a>
				</div>
			</header>

			<main>
				<section className="fy-hero">
					<div className="fy-hero-copy">
						<h1>Draw the flow before you ship it.</h1>
						<p>
							Flowyard is a whiteboard for security and system flows. Start from a real template, or describe a flow and the
							assistant draws it. Share one link and edit together, live.
						</p>
						<div className="fy-actions">
							<a className="fy-btn fy-btn-primary fy-btn-large" href={BOARD_URL}>
								Start a board
							</a>
							<a className="fy-btn fy-btn-quiet fy-btn-large" href="#templates">
								Browse templates
							</a>
						</div>
						<p className="fy-fineprint">Free to draw, no account needed. Sign in with GitHub to share.</p>
					</div>
					<HeroBoard />
				</section>

				<section className="fy-meanings" aria-labelledby="meanings-title">
					<h2 id="meanings-title">Every color means something</h2>
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
						<h2 id="templates-title">Start from a flow that's already right</h2>
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
						<h2 id="assistant-title">Describe it. Get a diagram.</h2>
						<p className="fy-lede">
							Ask for a flow and the assistant draws it on your board. Select a frame and ask for a change, and it edits that flow
							in place. Every change can be undone.
						</p>
						<p className="fy-fineprint">Three assistant requests a day on the free plan.</p>
					</div>
					<div className="fy-chat" aria-label="Example">
						<p className="fy-bubble fy-bubble-you">Draw a sign-in flow with MFA, rate limiting, and an audit log.</p>
						<p className="fy-bubble fy-bubble-ai">I drew it with a password check, a second factor, and session setup.</p>
						<div className="fy-chat-result">
							<FlowPreview template={TEMPLATES.find((t) => t.id === "login-mfa") ?? TEMPLATES[0]} />
						</div>
					</div>
				</section>

				<section className="fy-how" aria-labelledby="how-title">
					<h2 id="how-title">How it works</h2>
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
					<h2>Your next flow starts on a blank board.</h2>
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
				</nav>
				<span>© {new Date().getFullYear()} Flowyard</span>
			</footer>
		</div>
	);
}
