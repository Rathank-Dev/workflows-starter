import { Discord, GitHub, Google, decodeIdToken, generateCodeVerifier, generateState } from "arctic";
import { SESSION_IDLE_DAYS, cancelPendingDeletion } from "./account";
import { LEGACY_REFERRAL_COOKIE, REFERRAL_COOKIE, referralFrom } from "./referrals";
import type { Sql, User } from "./db";
import { CLEAR_CACHE, error, getCookie, randomToken, safeReturnTo, setCookie, sha256Hex } from "./http";

export type Provider = "github" | "google" | "discord";
const PROVIDERS: Provider[] = ["github", "google", "discord"];

// __Host- cookies must be Secure, Path=/, and carry no Domain, so a sibling
// subdomain can't plant or overwrite them.
export const SESSION_COOKIE = "__Host-flowyard_session";
const STATE_COOKIE = "__Host-flowyard_oauth";
const SESSION_DAYS = 30;

/**
 * Names from before the rename to Flowyard ("lw" was Linework). Still read so
 * nobody is signed out; a session cookie is moved to the new name the first
 * time it's seen. Remove after 2026-11-10, when every old session has expired.
 */
export const LEGACY_SESSION_COOKIE = "__Host-lw_session";
const LEGACY_STATE_COOKIE = "__Host-lw_oauth";

/** The session token from either cookie name, new first. */
function sessionToken(request: Request): string | null {
	return getCookie(request, SESSION_COOKIE) ?? getCookie(request, LEGACY_SESSION_COOKIE);
}

/** Set-Cookie values that sign this browser out, under both names. */
export function clearSessionCookies(): [string, string][] {
	return [
		["Set-Cookie", setCookie(SESSION_COOKIE, "", { maxAge: 0 })],
		["Set-Cookie", setCookie(LEGACY_SESSION_COOKIE, "", { maxAge: 0 })],
	];
}

/**
 * Moves a pre-rename session cookie to the new name, unless the response is
 * already setting or clearing the session (sign-in, sign-out). Sockets can't
 * carry new headers, so they're left alone; the next API call does it.
 */
export function upgradeLegacySession(request: Request, res: Response): Response {
	if (res.status === 101 || res.webSocket) return res;
	const legacy = getCookie(request, LEGACY_SESSION_COOKIE);
	if (!legacy || legacy.length > 200 || getCookie(request, SESSION_COOKIE) !== null) return res;
	if (res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))) return res;
	res.headers.append("Set-Cookie", setCookie(SESSION_COOKIE, legacy, { maxAge: SESSION_DAYS * 86400 }));
	res.headers.append("Set-Cookie", setCookie(LEGACY_SESSION_COOKIE, "", { maxAge: 0 }));
	return res;
}

/** Providers whose client id and secret are both set. */
export function enabledProviders(env: Env): Provider[] {
	return PROVIDERS.filter((p) => {
		const id = env[`${p.toUpperCase()}_CLIENT_ID` as keyof Env];
		const secret = env[`${p.toUpperCase()}_CLIENT_SECRET` as keyof Env];
		return typeof id === "string" && id !== "" && typeof secret === "string" && secret !== "";
	});
}

function client(provider: Provider, env: Env, origin: string) {
	const redirect = `${origin}/auth/callback/${provider}`;
	switch (provider) {
		case "github":
			return new GitHub(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, redirect);
		case "google":
			return new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirect);
		case "discord":
			return new Discord(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET, redirect);
	}
}

function asProvider(value: string, env: Env): Provider | null {
	return enabledProviders(env).includes(value as Provider) ? (value as Provider) : null;
}

/** GET /auth/login/:provider?returnTo=/path */
export function startLogin(request: Request, env: Env, providerName: string): Response {
	const url = new URL(request.url);
	const provider = asProvider(providerName, env);
	if (!provider) return error("That sign-in method isn't set up.", 404);

	const state = generateState();
	const verifier = generateCodeVerifier();
	const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
	let authUrl: URL;
	if (provider === "github") {
		authUrl = (client(provider, env, url.origin) as GitHub).createAuthorizationURL(state, ["read:user", "user:email"]);
	} else if (provider === "google") {
		authUrl = (client(provider, env, url.origin) as Google).createAuthorizationURL(state, verifier, [
			"openid",
			"profile",
			"email",
		]);
	} else {
		authUrl = (client(provider, env, url.origin) as Discord).createAuthorizationURL(state, verifier, [
			"identify",
			"email",
		]);
	}

	const cookie = setCookie(STATE_COOKIE, JSON.stringify({ p: provider, s: state, v: verifier, r: returnTo }), {
		maxAge: 600,
	});
	return new Response(null, { status: 302, headers: { Location: authUrl.toString(), "Set-Cookie": cookie } });
}

interface Profile {
	id: string;
	name: string;
	email: string | null;
	avatar: string | null;
}

async function fetchProfile(provider: Provider, env: Env, origin: string, code: string, verifier: string): Promise<Profile> {
	if (provider === "github") {
		const tokens = await (client(provider, env, origin) as GitHub).validateAuthorizationCode(code);
		const headers = { Authorization: `Bearer ${tokens.accessToken()}`, "User-Agent": "flowyard", Accept: "application/vnd.github+json" };
		const res = await fetch("https://api.github.com/user", { headers });
		if (!res.ok) throw new Error(`GitHub profile request failed (${res.status})`);
		const u = (await res.json()) as { id: number; login: string; name: string | null; avatar_url: string; email: string | null };
		let email = u.email;
		if (!email) {
			const er = await fetch("https://api.github.com/user/emails", { headers });
			if (er.ok) {
				const list = (await er.json()) as { email: string; primary: boolean; verified: boolean }[];
				email = list.find((e) => e.primary && e.verified)?.email ?? null;
			}
		}
		return { id: String(u.id), name: u.name || u.login, email, avatar: u.avatar_url };
	}
	if (provider === "google") {
		const tokens = await (client(provider, env, origin) as Google).validateAuthorizationCode(code, verifier);
		// Received straight from Google's token endpoint over TLS, so no signature check is needed.
		const claims = decodeIdToken(tokens.idToken()) as {
			sub: string;
			name?: string;
			email?: string;
			email_verified?: boolean;
			picture?: string;
		};
		return {
			id: claims.sub,
			name: claims.name || claims.email || "Google user",
			email: claims.email_verified ? (claims.email ?? null) : null,
			avatar: claims.picture ?? null,
		};
	}
	const tokens = await (client(provider, env, origin) as Discord).validateAuthorizationCode(code, verifier);
	const res = await fetch("https://discord.com/api/users/@me", {
		headers: { Authorization: `Bearer ${tokens.accessToken()}` },
	});
	if (!res.ok) throw new Error(`Discord profile request failed (${res.status})`);
	const u = (await res.json()) as {
		id: string;
		username: string;
		global_name: string | null;
		avatar: string | null;
		email?: string | null;
		verified?: boolean;
	};
	return {
		id: u.id,
		name: u.global_name || u.username,
		email: u.verified ? (u.email ?? null) : null,
		avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=96` : null,
	};
}

/** GET /auth/callback/:provider?code&state */
export async function finishLogin(request: Request, env: Env, sql: Sql, providerName: string): Promise<Response> {
	const url = new URL(request.url);
	const provider = asProvider(providerName, env);
	const clearState = setCookie(STATE_COOKIE, "", { maxAge: 0 });
	const clearLegacyState = setCookie(LEGACY_STATE_COOKIE, "", { maxAge: 0 });
	// Only a fixed code goes in the URL; the client maps it to a message, so a
	// crafted link can't put arbitrary text on the page.
	const fail = (code: "unavailable" | "expired" | "cancelled" | "failed") =>
		new Response(null, {
			status: 302,
			headers: [
				["Location", `/board?signin_error=${code}`],
				["Set-Cookie", clearState],
				["Set-Cookie", clearLegacyState],
			],
		});

	if (!provider) return fail("unavailable");
	let saved: { p: string; s: string; v: string; r: string };
	try {
		saved = JSON.parse(getCookie(request, STATE_COOKIE) ?? getCookie(request, LEGACY_STATE_COOKIE) ?? "");
	} catch {
		return fail("expired");
	}
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	if (!code || !state || saved.p !== provider || saved.s !== state) {
		return fail("cancelled");
	}

	let profile: Profile;
	try {
		profile = await fetchProfile(provider, env, url.origin, code, saved.v);
	} catch (err) {
		console.error("OAuth callback failed", provider, err);
		return fail("failed");
	}

	const user = await upsertUser(sql, provider, profile, referralFrom(request));
	// Signing in within the 30 days cancels a scheduled account deletion
	const restored = await cancelPendingDeletion(sql, user.id);
	const token = randomToken();
	await sql`
		insert into sessions (id, user_id, expires_at)
		values (${await sha256Hex(token)}, ${user.id}, now() + make_interval(days => ${SESSION_DAYS}))
	`;
	// Opportunistic cleanup of this user's expired sessions
	await sql`delete from sessions where user_id = ${user.id} and expires_at < now()`;

	const headers = new Headers({ Location: restored ? "/dashboard?account_restored=1" : safeReturnTo(saved.r) });
	headers.append("Set-Cookie", clearState);
	headers.append("Set-Cookie", clearLegacyState);
	if (referralFrom(request)) {
		headers.append("Set-Cookie", setCookie(REFERRAL_COOKIE, "", { maxAge: 0 }));
		headers.append("Set-Cookie", setCookie(LEGACY_REFERRAL_COOKIE, "", { maxAge: 0 }));
	}
	headers.append("Set-Cookie", setCookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400 }));
	// Signing in replaces any pre-rename session cookie
	headers.append("Set-Cookie", setCookie(LEGACY_SESSION_COOKIE, "", { maxAge: 0 }));
	return new Response(null, { status: 302, headers });
}

/** referralCode: from the visitor's invite cookie; only counts for a brand-new account. */
async function upsertUser(sql: Sql, provider: Provider, p: Profile, referralCode: string | null): Promise<User> {
	return sql.begin(async (tx) => {
		const [existing] = await tx<User[]>`
			select u.id, u.name, u.email, u.avatar_url
			from oauth_accounts a join users u on u.id = a.user_id
			where a.provider = ${provider} and a.provider_user_id = ${p.id}
		`;
		if (existing) {
			const [updated] = await tx<User[]>`
				update users set name = ${p.name.slice(0, 120)}, avatar_url = ${p.avatar}, email = coalesce(${p.email}, email)
				where id = ${existing.id}
				returning id, name, email, avatar_url
			`;
			return updated;
		}
		const [created] = await tx<User[]>`
			insert into users (name, email, avatar_url, referred_by)
			values (
				${p.name.slice(0, 120)}, ${p.email}, ${p.avatar},
				(select id from users where referral_code = ${referralCode})
			)
			returning id, name, email, avatar_url
		`;
		await tx`
			insert into oauth_accounts (provider, provider_user_id, user_id)
			values (${provider}, ${p.id}, ${created.id})
		`;
		return created;
	}) as Promise<User>;
}

/**
 * The signed-in user for this request, or null. A session lasts 30 days from
 * sign-in, and ends sooner if it goes 7 days unused. Use is recorded at most
 * hourly, so most requests don't write.
 */
export async function currentUser(request: Request, sql: Sql): Promise<User | null> {
	const token = sessionToken(request);
	if (!token || token.length > 200) return null;
	const id = await sha256Hex(token);
	const [row] = await sql<(User & { stale: boolean })[]>`
		select u.id, u.name, u.email, u.avatar_url, s.last_used_at < now() - interval '1 hour' as stale
		from sessions s join users u on u.id = s.user_id
		where s.id = ${id} and s.expires_at > now()
			and s.last_used_at > now() - make_interval(days => ${SESSION_IDLE_DAYS})
	`;
	if (!row) return null;
	if (row.stale) await sql`update sessions set last_used_at = now() where id = ${id}`;
	return { id: row.id, name: row.name, email: row.email, avatar_url: row.avatar_url };
}

/** POST /auth/logout */
export async function logout(request: Request, sql: Sql): Promise<Response> {
	const token = sessionToken(request);
	if (token) await sql`delete from sessions where id = ${await sha256Hex(token)}`;
	return new Response(null, {
		status: 204,
		headers: [...clearSessionCookies(), ...Object.entries(CLEAR_CACHE)],
	});
}
