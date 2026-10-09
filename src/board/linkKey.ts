/**
 * Share keys. A board's link is /board?board=<id>&key=<key>; the key is what
 * lets "anyone with the link" in, so board requests from this page carry it.
 * The page URL is the one place it lives: resetting the link rewrites it.
 */
const KEY = /^[a-f0-9]{32}$/;

/** The share key in this page's address, if any. */
export function linkKey(): string | null {
	const key = new URLSearchParams(window.location.search).get("key");
	return key && KEY.test(key) ? key : null;
}

/** Adds this page's share key to an API path, when it has one. */
export function withKey(path: string): string {
	const key = linkKey();
	if (!key) return path;
	return `${path}${path.includes("?") ? "&" : "?"}key=${key}`;
}

/** A board's address: its id plus the share key that opens it. */
export function boardPath(id: string, key: string | null | undefined): string {
	return key ? `/board?board=${id}&key=${key}` : `/board?board=${id}`;
}
