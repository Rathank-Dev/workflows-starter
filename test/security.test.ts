import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { linkRole } from "../worker/access";
import { linkKeyOf } from "../worker/http";

const ORIGIN = "https://example.com";

describe("Worker security", () => {
	it("sends no-store and nosniff on API responses", async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { "CF-Connecting-IP": "10.0.0.1" } });
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(await res.json()).toMatchObject({ user: null });
	});

	it("blocks state-changing requests from other sites", async () => {
		for (const [path, method] of [
			["/api/boards", "POST"],
			["/api/ai", "POST"],
			["/auth/logout", "POST"],
			["/api/boards/0123456789abcdef0123456789abcdef", "DELETE"],
		]) {
			const res = await SELF.fetch(`${ORIGIN}${path}`, {
				method,
				headers: { Origin: "https://evil.example", "CF-Connecting-IP": "10.0.0.2" },
			});
			expect(res.status, `${method} ${path}`).toBe(403);
		}
	});

	it("requires sign-in to create boards and use the assistant", async () => {
		for (const path of ["/api/boards", "/api/ai"]) {
			const res = await SELF.fetch(`${ORIGIN}${path}`, {
				method: "POST",
				headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.0.0.3" },
				body: "{}",
			});
			expect(res.status, path).toBe(401);
		}
	});

	it("refuses live connections to boards that were never created", async () => {
		const res = await SELF.fetch(`${ORIGIN}/ws?board=not-a-board`, {
			headers: { Upgrade: "websocket", "CF-Connecting-IP": "10.0.0.4" },
		});
		expect(res.status).toBe(404);
	});

	it("refuses live connections opened by other sites", async () => {
		const res = await SELF.fetch(`${ORIGIN}/ws?board=${"b".repeat(32)}`, {
			headers: { Upgrade: "websocket", Origin: "https://evil.example", "CF-Connecting-IP": "10.0.0.5" },
		});
		expect(res.status).toBe(403);
	});

	it("rate-limits one IP address", async () => {
		const statuses: number[] = [];
		for (let i = 0; i < 130; i++) {
			const res = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { "CF-Connecting-IP": "10.9.9.9" } });
			statuses.push(res.status);
			await res.body?.cancel();
		}
		expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
		// Another address is unaffected
		const other = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { "CF-Connecting-IP": "10.8.8.8" } });
		expect(other.status).toBe(200);
	});

	it("refuses oversized request bodies before reading them", async () => {
		for (const path of ["/api/boards", "/api/ai", "/api/boards/0123456789abcdef0123456789abcdef"]) {
			const res = await SELF.fetch(`${ORIGIN}${path}`, {
				method: path.endsWith("def") ? "PATCH" : "POST",
				headers: { Origin: ORIGIN, "Content-Length": "50000000", "CF-Connecting-IP": "10.0.0.6" },
				body: "x",
			});
			expect(res.status, path).toBe(413);
		}
	});

	it("refuses bodies without a declared length (chunked uploads)", async () => {
		const stream = new ReadableStream({
			start(c) {
				c.enqueue(new TextEncoder().encode("x".repeat(1000)));
				c.close();
			},
		});
		const res = await SELF.fetch(`${ORIGIN}/api/boards`, {
			method: "POST",
			headers: { Origin: ORIGIN, "CF-Connecting-IP": "10.0.0.8" },
			body: stream,
		});
		expect(res.status).toBe(411);
	});

	it("doesn't start sign-in for providers that aren't configured", async () => {
		const res = await SELF.fetch(`${ORIGIN}/auth/login/github?returnTo=//evil.com`, {
			headers: { "CF-Connecting-IP": "10.0.0.5" },
			redirect: "manual",
		});
		expect(res.status).toBe(404);
	});
});

describe("BoardDO connection cap", () => {
	it("refuses sockets past MAX_CONNECTIONS", async () => {
		const { env } = await import("cloudflare:test");
		const { MAX_CONNECTIONS } = await import("../worker/board-do");
		const stub = env.BOARD.get(env.BOARD.idFromName(`cap-${Date.now()}`));
		const open: WebSocket[] = [];
		for (let i = 0; i < MAX_CONNECTIONS; i++) {
			// Spread across addresses so the per-IP limit doesn't trigger first
			const ip = `10.1.${Math.floor(i / 5)}.${i % 5}`;
			const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket", "CF-Connecting-IP": ip, "X-Flowyard-Role": "edit" } });
			expect(res.status).toBe(101);
			res.webSocket!.accept();
			open.push(res.webSocket!);
		}
		const over = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket", "CF-Connecting-IP": "10.2.0.1", "X-Flowyard-Role": "edit" } });
		expect(over.status).toBe(429);
		for (const ws of open) ws.close(1000);
	});

	it("limits sockets per IP so one person can't take every slot", async () => {
		const { env } = await import("cloudflare:test");
		const { MAX_CONNECTIONS_PER_IP } = await import("../worker/board-do");
		const stub = env.BOARD.get(env.BOARD.idFromName(`ipcap-${Date.now()}`));
		const open: WebSocket[] = [];
		const connect = (ip: string) => stub.fetch("https://do/ws", { headers: { Upgrade: "websocket", "CF-Connecting-IP": ip, "X-Flowyard-Role": "edit" } });
		for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) {
			const res = await connect("10.3.0.1");
			expect(res.status).toBe(101);
			res.webSocket!.accept();
			open.push(res.webSocket!);
		}
		expect((await connect("10.3.0.1")).status).toBe(429);
		const other = await connect("10.3.0.2");
		expect(other.status).toBe(101);
		other.webSocket!.accept();
		open.push(other.webSocket!);
		for (const ws of open) ws.close(1000);
	});
});

describe("auth cookies", () => {
	it("uses __Host- cookies that browsers protect from subdomains", async () => {
		const { setCookie } = await import("../worker/http");
		const header = setCookie("__Host-lw_session", "t", { maxAge: 60 });
		// The __Host- prefix is only honoured with Secure, Path=/ and no Domain
		expect(header).toContain("Secure");
		expect(header).toContain("Path=/;");
		expect(header).not.toMatch(/Domain=/i);
		const res = await SELF.fetch(`${ORIGIN}/auth/logout`, {
			method: "POST",
			headers: { Origin: ORIGIN, "CF-Connecting-IP": "10.0.0.7" },
		});
		expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-lw_session=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);
	});
});

describe("share keys", () => {
	const key = "0123456789abcdef0123456789abcdef";

	it("grants link access only with the board's current key", () => {
		expect(linkRole("edit", key, key)).toBe("edit");
		expect(linkRole("view", key, key)).toBe("view");
		// The board id alone, a wrong key, or an old key after a reset: nothing
		expect(linkRole("edit", key, null)).toBeNull();
		expect(linkRole("edit", key, "f".repeat(32))).toBeNull();
		expect(linkRole("edit", key, key.slice(0, 31))).toBeNull();
		// A locked link stays locked even with the key
		expect(linkRole("none", key, key)).toBeNull();
	});

	it("reads only well-formed keys from a request", () => {
		const req = (q: string) => new Request(`${ORIGIN}/ws?board=${"a".repeat(32)}${q}`);
		expect(linkKeyOf(req(`&key=${key}`))).toBe(key);
		expect(linkKeyOf(req(""))).toBeNull();
		expect(linkKeyOf(req(`&key=${key.toUpperCase()}`))).toBeNull();
		expect(linkKeyOf(req("&key=' or 1=1--"))).toBeNull();
	});
});

describe("cookies", () => {
	const post = (path: string, body: unknown, origin = ORIGIN) =>
		SELF.fetch(`${ORIGIN}${path}`, {
			method: "POST",
			headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "10.7.0.1" },
			body: JSON.stringify(body),
		});

	it("treats a malformed session cookie as signed out, not a server error", async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/me`, {
			headers: { Cookie: "__Host-lw_session=%E0%A4%A", "CF-Connecting-IP": "10.7.0.2" },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ user: null });
	});

	it("keeps no referral cookie until the visitor agrees", async () => {
		const landing = await SELF.fetch(`${ORIGIN}/r/abcd2345`, { redirect: "manual", headers: { "CF-Connecting-IP": "10.7.0.3" } });
		expect(landing.status).toBe(302);
		expect(landing.headers.get("Location")).toBe("/?ref=abcd2345");
		expect(landing.headers.get("Set-Cookie")).toBeNull();

		const agreed = await post("/api/referral/remember", { code: "abcd2345" });
		expect(agreed.status).toBe(204);
		const cookie = agreed.headers.get("Set-Cookie") ?? "";
		expect(cookie).toMatch(/^__Host-lw_ref=abcd2345;/);
		expect(cookie).toMatch(/HttpOnly/);
		expect(cookie).toMatch(/Secure/);
		expect(cookie).toMatch(/SameSite=Lax/);

		expect((await post("/api/referral/remember", { code: "<script>" })).status).toBe(400);
		expect((await post("/api/referral/remember", { code: "abcd2345" }, "https://evil.example")).status).toBe(403);
	});

	it("clears the browser's cache for this site on sign-out", async () => {
		const res = await SELF.fetch(`${ORIGIN}/auth/logout`, {
			method: "POST",
			headers: { Origin: ORIGIN, "CF-Connecting-IP": "10.7.0.4" },
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("Clear-Site-Data")).toBe('"cache"');
		expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-lw_session=; .*Max-Age=0/);
	});
});
