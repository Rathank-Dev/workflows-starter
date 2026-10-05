import { useEffect, useState } from "react";
import { AccountButton, Avatar } from "../board/account";
import { Mark } from "../board/icons";
import { PROVIDER_LABEL, signInUrl, type Provider, type Session } from "../session";
import "./dashboard.css";

interface ProfileData {
	user: { id: string; name: string; email: string | null; avatarUrl: string | null; createdAt: string };
	accounts: { provider: Provider; created_at: string }[];
	plan: { id: string; name: string };
	usage: { boards: number; aiRemaining: number; aiDailyLimit: number; sessions: number };
}

const ALL_PROVIDERS: Provider[] = ["github", "google", "discord"];

export function Profile({ session }: { session: Session }) {
	const [data, setData] = useState<ProfileData | null>(null);
	const [failed, setFailed] = useState(false);
	const [confirmText, setConfirmText] = useState("");
	const [deleting, setDeleting] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	// Signed-out visitors get the sign-in screen on the dashboard
	useEffect(() => {
		if (!session.loading && !session.user) window.location.replace("/dashboard");
	}, [session.loading, session.user]);

	useEffect(() => {
		if (session.loading || !session.user) return;
		fetch("/api/profile")
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then(setData)
			.catch(() => setFailed(true));
	}, [session.loading, session.user]);

	if (session.loading || !session.user) return <div className="dash dash-loading" aria-busy="true" />;

	const logoutAll = async () => {
		if (!window.confirm("Log out on every device, including this one?")) return;
		const res = await fetch("/auth/logout-all", { method: "POST" });
		if (res.ok) window.location.assign("/");
		else setMessage("Couldn't log out everywhere. Try again.");
	};

	const deleteAccount = async () => {
		setDeleting(true);
		const res = await fetch("/api/account", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirm: confirmText }),
		});
		setDeleting(false);
		const body = (await res.json().catch(() => null)) as { deleteAt?: string } | null;
		if (res.ok && body?.deleteAt) window.location.assign(`/dashboard?account_scheduled=${encodeURIComponent(body.deleteAt)}`);
		else setMessage("Couldn't schedule your account for deletion. Try again.");
	};

	const connected = new Set(data?.accounts.map((a) => a.provider));

	return (
		<div className="profile-page">
			<header className="profile-top">
				<a className="dash-brand" href="/">
					<Mark />
					<span>Flowyard</span>
				</a>
				<a className="text-link" href="/dashboard">
					← Back to dashboard
				</a>
				<AccountButton session={session} onSignIn={() => {}} />
			</header>

			<main className="profile-main">
				{failed && <p className="dash-note dash-error">Couldn't load your profile. Refresh to try again.</p>}
				{!data && !failed && <p className="dash-note">Loading your profile…</p>}
				{message && (
					<p className="dash-note dash-error" role="alert">
						{message}
					</p>
				)}

				{data && (
					<>
						<section className="panel profile-card profile-hero">
							<Avatar user={data.user} size={64} />
							<div>
								<h1>{data.user.name}</h1>
								<p>{data.user.email ?? "No email shared by your sign-in provider"}</p>
								<p className="muted">
									Member since{" "}
									{new Date(data.user.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
								</p>
							</div>
						</section>

						<section className="panel profile-card">
							<h2>Sign-in methods</h2>
							<ul className="profile-list">
								{ALL_PROVIDERS.map((p) => (
									<li key={p}>
										<span>{PROVIDER_LABEL[p]}</span>
										{connected.has(p) ? (
											<span className="pill pill-on">Connected</span>
										) : session.providers.includes(p) ? (
											<span className="muted">Not connected</span>
										) : (
											<span className="muted">Not available yet</span>
										)}
									</li>
								))}
							</ul>
							<p className="muted small">
								Each sign-in method is a separate account. Sign in with the one you used before to reach your boards.
							</p>
							{session.providers.length > 0 && !session.providers.every((p) => connected.has(p)) && (
								<p className="muted small">
									Signing in with another provider creates a new, separate account (
									{session.providers
										.filter((p) => !connected.has(p))
										.map((p) => (
											<a key={p} href={signInUrl(p, "/dashboard")}>
												{PROVIDER_LABEL[p]}
											</a>
										))}
									).
								</p>
							)}
						</section>

						<section className="panel profile-card" id="plan">
							<h2>Plan and usage</h2>
							<ul className="profile-list">
								<li>
									<span>Plan</span>
									<strong>{data.plan.name}</strong>
								</li>
								<li>
									<span>Shared boards</span>
									<strong>{data.usage.boards}</strong>
								</li>
								<li>
									<span>Assistant today</span>
									<strong>
										{data.usage.aiRemaining} of {data.usage.aiDailyLimit} left
									</strong>
								</li>
							</ul>
							<div className="profile-upgrade">
								<div>
									<strong>Pro and Team plans are coming soon</strong>
									<p className="muted small">More assistant requests, higher-quality AI, version history, and view-only links.</p>
								</div>
								<button type="button" className="ghost-btn" disabled>
									Upgrade <span className="soon">Soon</span>
								</button>
							</div>
						</section>

						<section className="panel profile-card">
							<h2>Security</h2>
							<ul className="profile-list">
								<li>
									<span>Active sessions</span>
									<strong>{data.usage.sessions}</strong>
								</li>
							</ul>
							<button type="button" className="ghost-btn" onClick={logoutAll}>
								Log out everywhere
							</button>
						</section>

						<section className="panel profile-card profile-danger">
							<h2>Delete account</h2>
							<p className="small">
								You'll be logged out everywhere, and your boards go to the trash; their links stop working, including for people editing them now.
								Everything is deleted for good after 30 days. Sign in again before then to cancel and get your boards back.
							</p>
							<label className="profile-confirm">
								<span>
									Type <code>DELETE</code> to confirm
								</span>
								<input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
							</label>
							<button type="button" className="danger-btn" disabled={confirmText !== "DELETE" || deleting} onClick={deleteAccount}>
								{deleting ? "Scheduling…" : "Delete my account in 30 days"}
							</button>
						</section>
					</>
				)}
			</main>
		</div>
	);
}
