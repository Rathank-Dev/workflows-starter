import { useEffect } from "react";
import { Mark } from "../board/icons";
import { resetCookieChoice } from "../consent";
import { LEGAL_UPDATED, SUPPORT_EMAIL } from "../contact";
import "./privacy.css";

const COOKIES: [name: string, purpose: string, lasts: string, needed: string][] = [
	["__Host-lw_session", "Keeps you signed in. Holds a random token; the server stores only its hash.", "30 days, or 7 days unused", "Necessary"],
	["__Host-lw_oauth", "Checks that a sign-in that comes back from GitHub, Google, or Discord is the one you started.", "10 minutes", "Necessary"],
	["__Host-lw_ref", "Remembers who invited you, so they're credited if you sign up.", "30 days", "Only if you accept"],
];

const STORAGE: [key: string, purpose: string][] = [
	["linework:local", "The board you draw without signing in. It never leaves this browser unless you share it."],
	["linework:board:…, linework:role:…", "A copy of shared boards you open, so they load fast and survive going offline. Cleared when you sign out."],
	["linework:ai-provider", "Which assistant you picked last."],
	["flowyard:cookies", "Your cookie choice, so this banner doesn't ask again."],
];

const PARTIES: [who: string, why: string][] = [
	["Cloudflare", "Hosts Flowyard and stores boards, comments, and walkthrough videos."],
	["GitHub, Google, Discord", "Sign-in, when you choose one. Flowyard receives your name, email, and avatar."],
	["Anthropic, Google Gemini, DeepSeek, Cloudflare Workers AI", "The assistant. When you use it, your messages, the flow you selected, and the names of the board's frames go to the model you picked."],
	["Google Fonts", "Serves the site's fonts, so your browser contacts Google when pages load."],
];

/** What Flowyard stores, where it goes, and how to change your mind. */
export function Privacy() {
	useEffect(() => {
		document.title = "Privacy and cookies · Flowyard";
	}, []);

	return (
		<div className="pv">
			<header className="pv-top">
				<a className="pv-brand" href="/">
					<Mark />
					<span>Flowyard</span>
				</a>
			</header>
			<main className="pv-main">
				<h1>
					Privacy and <em>cookies.</em>
				</h1>
				<p className="pv-lede">
					What Flowyard keeps in your browser and on its servers, who else is involved, and how to change your choices. The rules
					for using Flowyard are in the{" "}
					<a className="pv-link" href="/terms">
						terms of service
					</a>
					.
				</p>
				<p className="pv-updated">Last updated {LEGAL_UPDATED}</p>

				<section aria-labelledby="pv-cookies">
					<h2 id="pv-cookies">Cookies</h2>
					<p>
						All Flowyard cookies are first-party, <code>HttpOnly</code> (page scripts can't read them), <code>Secure</code> (HTTPS
						only), and <code>SameSite=Lax</code> (not sent on requests other sites start). There are no advertising or analytics
						cookies.
					</p>
					<div className="pv-table-wrap">
						<table>
							<thead>
								<tr>
									<th scope="col">Cookie</th>
									<th scope="col">What it's for</th>
									<th scope="col">Kept for</th>
									<th scope="col">When</th>
								</tr>
							</thead>
							<tbody>
								{COOKIES.map(([name, purpose, lasts, needed]) => (
									<tr key={name}>
										<td data-label="Cookie">
											<code>{name}</code>
										</td>
										<td data-label="What it's for">{purpose}</td>
										<td data-label="Kept for">{lasts}</td>
										<td data-label="When">{needed}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<button type="button" className="pv-btn" onClick={resetCookieChoice}>
						Change cookie choice
					</button>
				</section>

				<section aria-labelledby="pv-storage">
					<h2 id="pv-storage">Stored in your browser</h2>
					<ul className="pv-list">
						{STORAGE.map(([key, purpose]) => (
							<li key={key}>
								<code>{key}</code>
								<span>{purpose}</span>
							</li>
						))}
					</ul>
				</section>

				<section aria-labelledby="pv-parties">
					<h2 id="pv-parties">Other services</h2>
					<ul className="pv-list">
						{PARTIES.map(([who, why]) => (
							<li key={who}>
								<strong>{who}</strong>
								<span>{why}</span>
							</li>
						))}
					</ul>
				</section>

				<section aria-labelledby="pv-yours">
					<h2 id="pv-yours">Your boards and account</h2>
					<ul className="pv-list">
						<li>
							<strong>Sharing</strong>
							<span>
								A shared board opens for people with its link (which carries a secret key) or people you invite. You can turn the
								link off or reset it from the Share menu; the old link stops working.
							</span>
						</li>
						<li>
							<strong>Signing out</strong>
							<span>Ends the session and removes shared boards from this browser. "Log out everywhere" does this on every device.</span>
						</li>
						<li>
							<strong>Deleting</strong>
							<span>
								Trashed boards are deleted for good after 30 days. Deleting your account from your profile signs you out
								everywhere and erases your account and boards after 30 days; signing in before then cancels it.
							</span>
						</li>
					</ul>
				</section>

				<section aria-labelledby="pv-contact">
					<h2 id="pv-contact">Contact</h2>
					<p>
						Questions about your data, or a request to see, correct, or delete it:{" "}
						<a className="pv-link" href={`mailto:${SUPPORT_EMAIL}`}>
							{SUPPORT_EMAIL}
						</a>
						. You can also delete your account yourself from your profile.
					</p>
				</section>
			</main>
		</div>
	);
}
