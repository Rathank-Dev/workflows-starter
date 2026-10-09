import { useEffect, useState } from "react";

/**
 * Cookie consent. Flowyard's sign-in cookies are strictly necessary and are
 * always used. The one optional cookie remembers who invited you (invite
 * rewards); it's set only after you accept. The choice itself is kept in this
 * browser so the banner doesn't ask again.
 */
const CHOICE_KEY = "flowyard:cookies";
type Choice = "all" | "necessary";

function storedChoice(): Choice | null {
	try {
		const v = localStorage.getItem(CHOICE_KEY);
		return v === "all" || v === "necessary" ? v : null;
	} catch {
		return null;
	}
}

/** Forget the choice, so the banner asks again (from the privacy page). */
// eslint-disable-next-line react-refresh/only-export-components -- a helper used only alongside the banner
export function resetCookieChoice() {
	try {
		localStorage.removeItem(CHOICE_KEY);
	} catch {
		// Storage blocked; the banner shows every visit anyway
	}
	window.location.reload();
}

/** The referral code from an invite link (/r/<code> lands on /?ref=<code>), removed from the address. */
function takeReferral(): string | null {
	const params = new URLSearchParams(window.location.search);
	const code = params.get("ref");
	if (code === null) return null;
	params.delete("ref");
	const rest = params.toString();
	window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
	return /^[a-z0-9]{8}$/.test(code) ? code : null;
}

export function CookieBanner() {
	const [choice, setChoice] = useState(storedChoice);

	// Keep the referral only with consent; either way, take it out of the address
	useEffect(() => {
		if (!choice) return;
		const code = takeReferral();
		if (code && choice === "all") {
			fetch("/api/referral/remember", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ code }),
			}).catch(() => {});
		}
	}, [choice]);

	if (choice) return null;

	const choose = (c: Choice) => {
		try {
			localStorage.setItem(CHOICE_KEY, c);
		} catch {
			// Storage blocked: the choice still applies for this page
		}
		setChoice(c);
	};

	return (
		<section className="cookie-banner" aria-label="Cookies">
			<p>
				Flowyard uses cookies to keep you signed in. With your OK, it also remembers who invited you, for invite rewards.{" "}
				<a href="/privacy">Privacy and cookies</a>
			</p>
			<div className="cookie-actions">
				<button type="button" className="cookie-btn" onClick={() => choose("necessary")}>
					Necessary only
				</button>
				<button type="button" className="cookie-btn cookie-btn-primary" onClick={() => choose("all")}>
					Accept all
				</button>
			</div>
		</section>
	);
}
