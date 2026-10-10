/** Headers on every Worker response: API data is per-user and never cached. */
export const SECURITY_HEADERS: Record<string, string> = {
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
};

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
	const h = new Headers(SECURITY_HEADERS);
	new Headers(headers).forEach((v, k) => h.set(k, v));
	return Response.json(data, { status, headers: h });
}

export function error(message: string, status: number, headers?: HeadersInit): Response {
	return json({ error: message }, status, headers);
}

export function getCookie(request: Request, name: string): string | null {
	const header = request.headers.get("Cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [k, ...v] = part.trim().split("=");
		if (k !== name) continue;
		try {
			return decodeURIComponent(v.join("="));
		} catch {
			// Malformed escape (e.g. "%E0"): treat it as no cookie, not a server error
			return null;
		}
	}
	return null;
}

/**
 * Sent when someone signs out: drops this site's HTTP cache in their browser
 * (walkthrough videos are cached privately for an hour). Storage is left
 * alone so a signed-out board isn't lost; the client clears shared boards.
 */
export const CLEAR_CACHE = { "Clear-Site-Data": '"cache"' };

export function setCookie(
	name: string,
	value: string,
	opts: { maxAge: number; path?: string },
): string {
	return `${name}=${encodeURIComponent(value)}; Path=${opts.path ?? "/"}; Max-Age=${opts.maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Rejects state-changing requests from other sites. Cookies are SameSite=Lax
 * already; this is a second check that works even if that changes.
 */
export function sameOrigin(request: Request): boolean {
	const origin = request.headers.get("Origin");
	return origin !== null && origin === new URL(request.url).origin;
}

/**
 * Only allow redirects back into this app. Browsers drop tabs and newlines and
 * treat "\" as "/", so "/\t/evil.com" would become "//evil.com": reject those
 * characters outright, then confirm the parsed URL stays on our origin.
 */
export function safeReturnTo(value: string | null): string {
	// eslint-disable-next-line no-control-regex -- matching control characters is the point
	if (!value || /[\x00-\x1f\x7f\\]/.test(value)) return "/";
	if (!value.startsWith("/") || value.startsWith("//")) return "/";
	try {
		const base = "https://flowyard.invalid";
		const u = new URL(value, base);
		if (u.origin !== base) return "/";
		return (u.pathname + u.search + u.hash).slice(0, 500);
	} catch {
		return "/";
	}
}

/** Compares two secrets without exiting early on the first difference. */
export function sameSecret(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** A board's share key: 32 hex characters, sent as ?key= on board links and requests. */
export const LINK_KEY = /^[a-f0-9]{32}$/;

/** The share key a request carries, or null if it has none (or a malformed one). */
export function linkKeyOf(request: Request): string | null {
	const key = new URL(request.url).searchParams.get("key");
	return key && LINK_KEY.test(key) ? key : null;
}

export function randomToken(bytes = 32): string {
	const buf = crypto.getRandomValues(new Uint8Array(bytes));
	return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomHex(bytes = 16): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
