import type { Sql, User } from "./db";
import { getCookie, json, setCookie } from "./http";

/**
 * Invite rewards. Each person has a referral link (/r/<code>); whoever signs
 * up for the first time after opening it is recorded as their referral.
 * Rewards themselves arrive with paid plans; this keeps the count until then.
 *
 * The referral cookie isn't needed for the site to work, so it's only set
 * once the visitor agrees to it in the cookie banner.
 */
export const REFERRAL_COOKIE = "__Host-flowyard_ref";
/** Pre-rename name ("lw" was Linework), still read until it expires. Remove after 2026-11-10. */
export const LEGACY_REFERRAL_COOKIE = "__Host-lw_ref";
const REFERRAL_DAYS = 30;
const CODE = /^[a-z0-9]{8}$/;
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function newCode(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** GET /r/:code — show the homepage with the code; the cookie banner asks before it's kept. */
export function referralLanding(code: string): Response {
	return new Response(null, { status: 302, headers: { Location: CODE.test(code) ? `/?ref=${code}` : "/" } });
}

/** POST /api/referral/remember  { code } — the visitor agreed to the referral cookie. */
export async function rememberReferral(request: Request): Promise<Response> {
	const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
	const code = typeof body?.code === "string" ? body.code : "";
	if (!CODE.test(code)) return new Response(null, { status: 400 });
	return new Response(null, {
		status: 204,
		headers: { "Set-Cookie": setCookie(REFERRAL_COOKIE, code, { maxAge: REFERRAL_DAYS * 86400 }) },
	});
}

/** The referral code from this request's cookie, if any. */
export function referralFrom(request: Request): string | null {
	const code = getCookie(request, REFERRAL_COOKIE) ?? getCookie(request, LEGACY_REFERRAL_COOKIE);
	return code && CODE.test(code) ? code : null;
}

/** GET /api/referral — the person's referral link and how many people joined with it. */
export async function getReferral(request: Request, sql: Sql, user: User): Promise<Response> {
	let code = (await sql<{ referral_code: string | null }[]>`select referral_code from users where id = ${user.id}`)[0]
		?.referral_code;
	// Codes are random; the unique index rejects the rare clash, so try another
	for (let attempt = 0; !code && attempt < 5; attempt++) {
		try {
			await sql`update users set referral_code = ${newCode()} where id = ${user.id} and referral_code is null`;
		} catch {
			continue;
		}
		code = (await sql<{ referral_code: string | null }[]>`select referral_code from users where id = ${user.id}`)[0]
			?.referral_code;
	}
	const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from users where referred_by = ${user.id}`;
	return json({
		url: code ? `${new URL(request.url).origin}/r/${code}` : null,
		joined: n,
	});
}
