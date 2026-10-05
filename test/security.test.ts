import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
			const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
			expect(res.status).toBe(101);
			res.webSocket!.accept();
			open.push(res.webSocket!);
		}
		const over = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
		expect(over.status).toBe(429);
		for (const ws of open) ws.close();
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
