import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { REPLY_JSON_SCHEMA } from "../worker/ai";
import { availableProviders, generate, type AiProviderInfo, type GenerateInput } from "../worker/ai-providers";

const reply = { reply: "Hi", action: "none", flow: { title: "", subtitle: "", cols: 1, rows: 1, nodes: [], edges: [] } };
const input: GenerateInput = {
	system: "You draw flows.",
	messages: [{ role: "user", content: "Draw a login flow" }],
	schema: z.object({ reply: z.string() }),
	jsonSchema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
	example: '{"reply":"..."}',
};
const testEnv = { ...env, GEMINI_API_KEY: "g-key", DEEPSEEK_API_KEY: "d-key" } as Env;

afterEach(() => vi.restoreAllMocks());

describe("reply JSON schema", () => {
	it("is a plain object schema every provider accepts", () => {
		expect(REPLY_JSON_SCHEMA).not.toHaveProperty("$schema");
		expect(JSON.stringify(REPLY_JSON_SCHEMA)).not.toContain("anyOf");
		expect(REPLY_JSON_SCHEMA).toMatchObject({ type: "object", required: ["reply", "action", "flow"] });
	});
});

describe("availableProviders", () => {
	it("lists only providers with keys, plus Workers AI when bound", () => {
		const ids = availableProviders({ ...env, ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "x", DEEPSEEK_API_KEY: "", WORKERS_AI: "" } as Env).map((p) => p.id);
		expect(ids).toEqual(["google", "workers-ai"]);
		const off = availableProviders({ ...env, GEMINI_API_KEY: "", WORKERS_AI: "off" } as Env);
		expect(off.map((p) => p.id)).not.toContain("workers-ai");
	});

	it("uses model overrides when set", () => {
		const [g] = availableProviders({ ...env, GEMINI_API_KEY: "x", GEMINI_MODEL: "gemini-custom", WORKERS_AI: "off" } as Env);
		expect(g).toMatchObject({ id: "google", model: "gemini-custom" });
	});
});

describe("Gemini adapter", () => {
	const provider: AiProviderInfo = { id: "google", label: "Gemini", model: "gemini-3.8-flash" };

	it("sends a JSON-schema request and parses the reply", async () => {
		const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }),
		);
		const r = await generate(provider, testEnv, input);
		expect(r).toEqual({ ok: true, value: reply });
		const [url, init] = spy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
		expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-key");
		const body = JSON.parse(init.body as string);
		expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: input.jsonSchema });
		expect(body.systemInstruction.parts[0].text).toBe("You draw flows.");
		expect(body.contents[0]).toEqual({ role: "user", parts: [{ text: "Draw a login flow" }] });
	});

	it("reports a safety block as a refusal and a bad key clearly", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ candidates: [{ finishReason: "SAFETY" }] }));
		expect(await generate(provider, testEnv, input)).toMatchObject({ ok: false, refusal: true });
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("no", { status: 403 }));
		expect(await generate(provider, testEnv, input)).toMatchObject({ ok: false, status: 503, message: expect.stringContaining("API key") });
	});
});

describe("DeepSeek adapter", () => {
	const provider: AiProviderInfo = { id: "deepseek", label: "DeepSeek", model: "deepseek-flash" };

	it("uses JSON mode with an example in the prompt", async () => {
		const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] }),
		);
		const r = await generate(provider, testEnv, input);
		expect(r).toEqual({ ok: true, value: reply });
		const [url, init] = spy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.deepseek.com/chat/completions");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer d-key");
		const body = JSON.parse(init.body as string);
		expect(body).toMatchObject({ model: "deepseek-flash", response_format: { type: "json_object" } });
		expect(body.messages[0].role).toBe("system");
		expect(body.messages[0].content.toLowerCase()).toContain("json");
		expect(body.messages[0].content).toContain(input.example);
	});

	it("handles DeepSeek's known empty-content answers", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ choices: [{ message: { content: "" } }] }));
		expect(await generate(provider, testEnv, input)).toMatchObject({ ok: false, message: expect.stringContaining("empty") });
	});
});

describe("Workers AI adapter", () => {
	const provider: AiProviderInfo = { id: "workers-ai", label: "Workers AI", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" };

	it("calls the AI binding in JSON mode and accepts object or string replies", async () => {
		const run = vi.fn().mockResolvedValueOnce({ response: reply }).mockResolvedValueOnce({ response: JSON.stringify(reply) });
		const aiEnv = { ...env, AI: { run } } as unknown as Env;
		expect(await generate(provider, aiEnv, input)).toEqual({ ok: true, value: reply });
		expect(await generate(provider, aiEnv, input)).toEqual({ ok: true, value: reply });
		const [model, args] = run.mock.calls[0];
		expect(model).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
		expect(args.response_format).toEqual({ type: "json_schema", json_schema: input.jsonSchema });
		expect(args.messages[0]).toEqual({ role: "system", content: "You draw flows." });
	});

	it("explains how to enable it when the binding fails", async () => {
		const aiEnv = { ...env, AI: { run: vi.fn().mockRejectedValue(new Error("no remote")) } } as unknown as Env;
		expect(await generate(provider, aiEnv, input)).toMatchObject({ ok: false, message: expect.stringContaining("CLOUDFLARE_ACCOUNT_ID") });
	});
});
