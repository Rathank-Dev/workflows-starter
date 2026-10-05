import type { Sql, User } from "./db";
import { getCookie, json, setCookie } from "./http";

/**
 * Invite rewards. Each person has a referral link (/r/<code>); whoever signs
 * up for the first time after opening it is recorded as their referral.
 * Rewards themselves arrive with paid plans; this keeps the count until then.
 */
export const REFERRAL_COOKIE = "__Host-lw_ref";
const REFERRAL_DAYS = 30;
const CODE = /^[a-z0-9]{8}$/;
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function newCode(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** GET /r/:code — remember who invited this visitor, then show the homepage. */
export function referralLanding(code: string): Response {
	const headers = new Headers({ Location: "/" });
	if (CODE.test(code)) headers.append("Set-Cookie", setCookie(REFERRAL_COOKIE, code, { maxAge: REFERRAL_DAYS * 86400 }));
	return new Response(null, { status: 302, headers });
}

/** The referral code from this request's cookie, if any. */
export function referralFrom(request: Request): string | null {
	const code = getCookie(request, REFERRAL_COOKIE);
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
