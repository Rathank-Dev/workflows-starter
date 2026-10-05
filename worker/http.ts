export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
	return Response.json(data, { status, headers });
}

export function error(message: string, status: number): Response {
	return json({ error: message }, status);
}

export function getCookie(request: Request, name: string): string | null {
	const header = request.headers.get("Cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const [k, ...v] = part.trim().split("=");
		if (k === name) return decodeURIComponent(v.join("="));
	}
	return null;
}

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
