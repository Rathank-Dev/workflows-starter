import { useEffect } from "react";
import { Mark } from "../board/icons";
import "./notfound.css";

/**
 * Shown for any address the app doesn't know. The page explains itself as a
 * flow: the request, the route check, and the "no" branch that lands here.
 */
export function NotFound() {
	const path = window.location.pathname;
	useEffect(() => {
		document.title = "Page not found · Flowyard";
		// Keep unknown addresses out of search results
		const meta = document.createElement("meta");
		meta.name = "robots";
		meta.content = "noindex";
		document.head.appendChild(meta);
		return () => meta.remove();
	}, []);

	return (
		<div className="nf">
			<header className="nf-top">
				<a className="nf-brand" href="/">
					<Mark />
					<span>Flowyard</span>
				</a>
			</header>
			<main className="nf-main">
				<p className="nf-code">Error 404</p>
				<h1>
					This page isn't on the <em>board.</em>
				</h1>
				<p className="nf-lede">The address may be mistyped, or the page was moved. Here's what happened to your request:</p>

				<ol className="nf-flow" aria-label="How your request was handled">
					<li className="nf-node nf-step">
						<span className="nf-label">Request</span>
						<code>{path.length > 40 ? `${path.slice(0, 40)}…` : path}</code>
					</li>
					<li className="nf-node nf-decision">
						<svg viewBox="0 0 128 84" aria-hidden="true">
							<polygon points="64,2 126,42 64,82 2,42" />
						</svg>
						<span>Page exists?</span>
					</li>
					<li className="nf-node nf-deny">
						<span className="nf-label">No</span>
						<strong>404 Not found</strong>
					</li>
				</ol>

				<div className="nf-actions">
					<a className="fy-btn-like nf-primary" href="/">
						Go to homepage
					</a>
					<a className="fy-btn-like nf-quiet" href="/dashboard">
						Open dashboard
					</a>
					<a className="fy-btn-like nf-quiet" href="/board">
						Start a board
					</a>
				</div>
			</main>
		</div>
	);
}
