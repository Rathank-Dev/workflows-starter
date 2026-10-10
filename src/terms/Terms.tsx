import { useEffect } from "react";
import { Mark } from "../board/icons";
import { LEGAL_UPDATED, SUPPORT_EMAIL } from "../contact";
import "../privacy/privacy.css";

/** Plain-language terms, kept in step with how the app actually behaves. */
const SECTIONS: [heading: string, items: [title: string, text: string][]][] = [
	[
		"Using Flowyard",
		[
			["The service", "Flowyard is a whiteboard for flowcharts and system diagrams, with live sharing and an optional AI assistant. You can draw without an account; sharing, comments, walkthroughs, and the assistant need a sign-in with GitHub, Google, or Discord."],
			["Your account", "You're responsible for what happens under your account. If you think someone else has access, use \"Log out everywhere\" on your profile; it ends every session and closes open boards."],
			["Free plan", "Flowyard is free today, with limits: 3 assistant uses a day, 5 saved walkthroughs (up to 5 minutes each), 30 new shared boards a day, and 200 members per board. Limits may change; paid plans may be added later, and you'll be told before anything you use starts to cost money."],
		],
	],
	[
		"Your content",
		[
			["You own it", "Boards, comments, and walkthroughs you create stay yours. You give Flowyard permission to store, copy, and show them only as needed to run the service: to save them, sync them live, and show them to the people you share them with."],
			["Sharing is your choice", "A shared board opens for people you invite, and for anyone with its link (which carries a secret key) at the access you set: edit, view, or none. Anyone you let in can copy what they see. You can lock the link or reset it from the Share menu at any time."],
			["The assistant", "When you use the assistant, your messages, the flow you selected, and the names of the board's frames go to the AI provider you picked, to produce a reply. Don't send anything you aren't allowed to share with them."],
		],
	],
	[
		"Acceptable use",
		[
			["Don't", "Don't use Flowyard to break the law, to store or spread malware, to harass people, or to share content you don't have the right to. Don't try to get around limits, access boards or accounts that aren't yours, overload the service, or scrape it."],
			["Security research", "Found a vulnerability? Report it privately through the repository's Security tab (\"Report a vulnerability\"). Good-faith research that avoids other people's data and doesn't disrupt the service is welcome."],
			["Enforcement", "Content or accounts that break these terms may be removed or suspended, and boards may be locked to protect other people."],
		],
	],
	[
		"Ending and deleting",
		[
			["Trash", "Boards you move to the trash can be restored for 30 days, then they're deleted for good, with their comments and walkthroughs."],
			["Deleting your account", "Deleting your account from your profile signs you out everywhere and erases your account and boards after 30 days. Signing in before then cancels it."],
			["If the service ends", "If Flowyard shuts down, you'll be given notice and time to export your boards (PNG, SVG, or JSON from the board menu)."],
		],
	],
	[
		"The fine print",
		[
			["No guarantees", "Flowyard is provided as is. It may have bugs or downtime, and boards could be lost; export anything important. Diagrams, templates, and assistant output can be wrong or incomplete: they're a starting point, not professional security, legal, or compliance advice. Check them before relying on them."],
			["Liability", "To the extent the law allows, Flowyard isn't liable for indirect or consequential losses, or for lost data or profits, from using or being unable to use the service."],
			["Other services", "Flowyard relies on Cloudflare, the sign-in providers, the AI providers, and Google Fonts. Their own terms apply to what they do; see the privacy page for what each one receives."],
			["Changes", "These terms may change as Flowyard does. Significant changes will be announced in the app before they apply; continuing to use Flowyard afterwards means you accept them."],
		],
	],
];

export function Terms() {
	useEffect(() => {
		document.title = "Terms of service · Flowyard";
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
					Terms of <em>service.</em>
				</h1>
				<p className="pv-lede">
					The rules for using Flowyard, in plain language. By using it you agree to them. How data is handled is on the{" "}
					<a className="pv-link" href="/privacy">
						privacy page
					</a>
					.
				</p>
				<p className="pv-updated">Last updated {LEGAL_UPDATED}</p>

				{SECTIONS.map(([heading, items], i) => (
					<section key={heading} aria-labelledby={`tos-${i}`}>
						<h2 id={`tos-${i}`}>{heading}</h2>
						<ul className="pv-list">
							{items.map(([title, text]) => (
								<li key={title}>
									<strong>{title}</strong>
									<span>{text}</span>
								</li>
							))}
						</ul>
					</section>
				))}

				<section aria-labelledby="tos-contact">
					<h2 id="tos-contact">Contact</h2>
					<p>
						Questions about these terms, account requests, or reports of content that breaks them:{" "}
						<a className="pv-link" href={`mailto:${SUPPORT_EMAIL}`}>
							{SUPPORT_EMAIL}
						</a>
						.
					</p>
				</section>
			</main>
		</div>
	);
}
