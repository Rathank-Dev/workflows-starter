import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { parseCommentOp } from "../shared/comments";

type Msg = { type: string; [k: string]: unknown };

/** Opens a socket to a board's Durable Object as the Worker would, with the given identity. */
async function join(boardName: string, role: string, user?: { id: string; name: string }) {
	const { env } = await import("cloudflare:test");
	const stub = env.BOARD.get(env.BOARD.idFromName(boardName));
	const headers: Record<string, string> = { Upgrade: "websocket", "CF-Connecting-IP": "10.9.0.1", "X-Flowyard-Role": role };
	if (user) {
		headers["X-Flowyard-User"] = user.id;
		headers["X-Flowyard-Name"] = encodeURIComponent(user.name);
	}
	const res = await stub.fetch("https://do/ws", { headers });
	if (res.status !== 101) return { status: res.status, ws: null, messages: [] as Msg[], next: async () => null };
	const ws = res.webSocket!;
	const messages: Msg[] = [];
	const waiters: ((m: Msg) => void)[] = [];
	let closed: { code: number } | null = null;
	ws.addEventListener("message", (e) => {
		const m = JSON.parse(e.data as string) as Msg;
		messages.push(m);
		waiters.splice(0).forEach((w) => w(m));
	});
	ws.addEventListener("close", (e) => {
		closed = { code: e.code };
	});
	ws.accept();
	/** Resolves with the next message of a type (or what's already arrived). */
	const next = (type: string, after = 0) =>
		new Promise<Msg | null>((resolve) => {
			const found = messages.slice(after).find((m) => m.type === type);
			if (found) return resolve(found);
			const timer = setTimeout(() => resolve(null), 1500);
			const check = (m: Msg) => {
				if (m.type === type) {
					clearTimeout(timer);
					resolve(m);
				} else waiters.push(check);
			};
			waiters.push(check);
		});
	return { status: 101, ws, messages, next, closed: () => closed };
}

const doc = (name: string) => ({ v: 1, name, elements: [] });
const settle = () => new Promise((r) => setTimeout(r, 100));

describe("board roles", () => {
	it("refuses sockets the Worker didn't approve", async () => {
		const { env } = await import("cloudflare:test");
		const stub = env.BOARD.get(env.BOARD.idFromName(`norole-${Date.now()}`));
		const res = await stub.fetch("https://do/ws", { headers: { Upgrade: "websocket" } });
		expect(res.status).toBe(403);
	});

	it("tells each socket its role, and lets only editors save", async () => {
		const name = `roles-${Date.now()}`;
		const viewer = await join(name, "view");
		const editor = await join(name, "edit");
		expect((await viewer.next("hello"))?.role).toBe("view");
		expect((await editor.next("hello"))?.role).toBe("edit");

		const before = viewer.messages.length;
		viewer.ws!.send(JSON.stringify({ type: "update", doc: doc("Viewer edit") }));
		const err = await viewer.next("error", before);
		expect(String(err?.message)).toContain("not edit");

		editor.ws!.send(JSON.stringify({ type: "update", doc: doc("Editor edit") }));
		expect(await editor.next("ack")).not.toBeNull();
		const relayed = await viewer.next("doc", before);
		expect((relayed?.doc as { name: string }).name).toBe("Editor edit");
		viewer.ws!.close(1000);
		editor.ws!.close(1000);
	});

	it("drops everyone but the owner when access changes", async () => {
		const { env } = await import("cloudflare:test");
		const name = `refresh-${Date.now()}`;
		const owner = await join(name, "owner", { id: "u-owner", name: "Owner" });
		const guest = await join(name, "edit");
		await guest.next("hello");
		await env.BOARD.get(env.BOARD.idFromName(name)).refreshAccess();
		await settle();
		expect(guest.closed?.()?.code).toBe(4001);
		expect(owner.closed?.()).toBeNull();
		owner.ws!.close(1000);
	});

	it("drops a signed-out person's sockets, owner included, and no one else's", async () => {
		const { env } = await import("cloudflare:test");
		const name = `signout-${Date.now()}`;
		const ada = await join(name, "owner", { id: "u-ada", name: "Ada" });
		const adaTab = await join(name, "edit", { id: "u-ada", name: "Ada" });
		const bob = await join(name, "edit", { id: "u-bob", name: "Bob" });
		const guest = await join(name, "view");
		await Promise.all([ada.next("hello"), adaTab.next("hello"), bob.next("hello"), guest.next("hello")]);
		await env.BOARD.get(env.BOARD.idFromName(name)).disconnectUser("u-ada");
		await settle();
		expect(ada.closed?.()?.code).toBe(4001);
		expect(adaTab.closed?.()?.code).toBe(4001);
		expect(bob.closed?.()).toBeNull();
		expect(guest.closed?.()).toBeNull();
		bob.ws!.close(1000);
		guest.ws!.close(1000);
	});
});

describe("signing out everywhere", () => {
	it("disconnects the person from every board they own or have opened", async () => {
		const { disconnectEverywhere } = await import("../worker/account");
		const queries: string[] = [];
		const sql = ((strings: TemplateStringsArray) => {
			queries.push(strings.join("?"));
			return Promise.resolve([{ id: "b1" }, { id: "b2" }, { id: "b3" }]);
		}) as unknown as Parameters<typeof disconnectEverywhere>[0];
		const dropped: [string, string][] = [];
		const store = {
			deleteBoard: async () => {},
			disconnectAll: async () => {},
			deleteFiles: async () => {},
			disconnectUser: async (board: string, user: string) => {
				dropped.push([board, user]);
			},
		};
		await disconnectEverywhere(sql, store, "u-ada");
		expect(queries.join()).toMatch(/board_visits/);
		expect(queries.join()).toMatch(/owner_id/);
		expect(dropped).toEqual([
			["b1", "u-ada"],
			["b2", "u-ada"],
			["b3", "u-ada"],
		]);
	});
});

describe("comments", () => {
	it("requires a signed-in person", async () => {
		const anon = await join(`c-anon-${Date.now()}`, "edit");
		expect((await anon.next("hello"))?.canComment).toBe(false);
		anon.ws!.send(JSON.stringify({ type: "comment:add", x: 1, y: 2, text: "hi" }));
		expect(String((await anon.next("error"))?.message)).toContain("Sign in");
		anon.ws!.close(1000);
	});

	it("adds, replies, and resolves threads for everyone, including viewers", async () => {
		const name = `c-flow-${Date.now()}`;
		const dara = await join(name, "view", { id: "u-dara", name: "Dara" });
		const sok = await join(name, "edit", { id: "u-sok", name: "Sok" });
		await dara.next("comments");
		await sok.next("comments");

		dara.ws!.send(JSON.stringify({ type: "comment:add", x: 40, y: 80, text: "  Add an approval step?  " }));
		const added = (await sok.next("comment"))?.comment as { id: string; text: string; authorName: string; x: number };
		expect(added.text).toBe("Add an approval step?");
		expect(added.authorName).toBe("Dara");

		await dara.next("comment"); // her own copy arrives too
		const mark = dara.messages.length;
		sok.ws!.send(JSON.stringify({ type: "comment:reply", parent: added.id, text: "Done" }));
		const reply = (await dara.next("comment", mark))?.comment as { parent: string; x: number };
		expect(reply.parent).toBe(added.id);
		expect(reply.x).toBe(40);

		const mark2 = dara.messages.length;
		sok.ws!.send(JSON.stringify({ type: "comment:resolve", id: added.id, resolved: true }));
		expect(((await dara.next("comment", mark2))?.comment as { resolved: boolean }).resolved).toBe(true);

		// A late joiner gets the whole history
		const late = await join(name, "view");
		expect(((await late.next("comments"))?.items as unknown[]).length).toBe(2);
		for (const s of [dara, sok, late]) s.ws!.close(1000);
	});

	it("lets only the author or the owner delete", async () => {
		const name = `c-del-${Date.now()}`;
		const author = await join(name, "edit", { id: "u-a", name: "A" });
		const other = await join(name, "edit", { id: "u-b", name: "B" });
		const owner = await join(name, "owner", { id: "u-o", name: "O" });
		author.ws!.send(JSON.stringify({ type: "comment:add", x: 0, y: 0, text: "mine" }));
		const c = (await other.next("comment"))?.comment as { id: string };

		other.ws!.send(JSON.stringify({ type: "comment:delete", id: c.id }));
		expect(String((await other.next("error"))?.message)).toContain("author");

		const mark = author.messages.length;
		owner.ws!.send(JSON.stringify({ type: "comment:delete", id: c.id }));
		expect((await author.next("comment:removed", mark))?.ids).toEqual([c.id]);
		for (const s of [author, other, owner]) s.ws!.close(1000);
	});

	it("validates comment messages", () => {
		expect(parseCommentOp({ type: "comment:add", x: 1, y: 2, text: "ok" })).not.toBeNull();
		expect(parseCommentOp({ type: "comment:add", x: Infinity, y: 2, text: "ok" })).toBeNull();
		expect(parseCommentOp({ type: "comment:add", x: 1, y: 2, text: "   " })).toBeNull();
		expect(parseCommentOp({ type: "comment:add", x: 1, y: 2, text: "x".repeat(2001) })).toBeNull();
		expect(parseCommentOp({ type: "comment:resolve", id: "a", resolved: "yes" })).toBeNull();
		expect(parseCommentOp({ type: "comment:nope", id: "a" })).toBeNull();
	});
});

describe("walkthrough uploads", () => {
	const origin = "https://example.com";
	const path = `/api/boards/${"a".repeat(32)}/recordings`;

	it("gets a larger body cap than other routes, and still needs sign-in", async () => {
		const big = String(40 * 1024 * 1024);
		const res = await SELF.fetch(`${origin}${path}?duration=5000`, {
			method: "POST",
			headers: { Origin: origin, "Content-Length": big, "Content-Type": "video/webm" },
			body: "x",
		});
		expect(res.status).toBe(401);

		const other = await SELF.fetch(`${origin}/api/boards`, {
			method: "POST",
			headers: { Origin: origin, "Content-Length": big, "Content-Type": "application/json" },
			body: "x",
		});
		expect(other.status).toBe(413);
	});

	it("refuses videos over the walkthrough limit", async () => {
		const res = await SELF.fetch(`${origin}${path}`, {
			method: "POST",
			headers: { Origin: origin, "Content-Length": String(200 * 1024 * 1024), "Content-Type": "video/webm" },
			body: "x",
		});
		expect(res.status).toBe(413);
	});
});

describe("live cursors", () => {
	it("relays a cursor to everyone else with the sender's name, and says when they leave", async () => {
		const name = `cursor-${Date.now()}`;
		const ada = await join(name, "edit", { id: "u-ada", name: "Ada" });
		const guest = await join(name, "view");
		await ada.next("hello");
		await guest.next("hello");

		const before = ada.messages.length;
		ada.ws!.send(JSON.stringify({ type: "cursor", x: 120.5, y: -40 }));
		const seen = await guest.next("cursor");
		expect(seen).toMatchObject({ name: "Ada", x: 120.5, y: -40 });
		expect(typeof seen?.id).toBe("string");
		await settle();
		expect(ada.messages.slice(before).some((m) => m.type === "cursor")).toBe(false);

		// Viewers can point too; anonymous ones have no name
		guest.ws!.send(JSON.stringify({ type: "cursor", x: 1, y: 2 }));
		expect(await ada.next("cursor", before)).toMatchObject({ name: null, x: 1, y: 2 });

		ada.ws!.close(1000);
		const gone = await guest.next("cursor:gone");
		expect(gone?.id).toBe(seen?.id);
		guest.ws!.close(1000);
	});

	it("hides a cursor on request and ignores bad coordinates", async () => {
		const name = `cursor-bad-${Date.now()}`;
		const a = await join(name, "edit");
		const b = await join(name, "edit");
		await a.next("hello");
		await b.next("hello");

		for (const bad of [{ x: "1", y: 2 }, { x: 1e12, y: 0 }, { x: Number.NaN, y: 0 }, { y: 3 }]) {
			a.ws!.send(JSON.stringify({ type: "cursor", ...bad }));
		}
		await settle();
		expect(b.messages.some((m) => m.type === "cursor")).toBe(false);

		a.ws!.send(JSON.stringify({ type: "cursor", x: null }));
		expect(await b.next("cursor:gone")).not.toBeNull();
		a.ws!.close(1000);
		b.ws!.close(1000);
	});

	it("rate-limits cursor moves and hides alike", async () => {
		const name = `cursor-flood-${Date.now()}`;
		const a = await join(name, "edit");
		const b = await join(name, "edit");
		await a.next("hello");
		await b.next("hello");
		for (let i = 0; i < 400; i++) {
			a.ws!.send(JSON.stringify(i % 2 ? { type: "cursor", x: i, y: i } : { type: "cursor", x: null }));
		}
		await new Promise((r) => setTimeout(r, 500));
		const relayed = b.messages.filter((m) => m.type === "cursor" || m.type === "cursor:gone").length;
		// A burst of 60, plus what refills at 30 a second while the test runs
		expect(relayed).toBeGreaterThan(0);
		expect(relayed).toBeLessThanOrEqual(100);
		a.ws!.close(1000);
		b.ws!.close(1000);
	});
});
