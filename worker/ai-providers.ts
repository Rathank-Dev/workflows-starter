import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/**
 * One adapter per AI provider. Each takes the same system prompt and
 * conversation and returns the model's JSON reply as a plain object; the
 * caller validates it, so no adapter's output is trusted.
 */

export type AiProviderId = "anthropic" | "google" | "deepseek" | "workers-ai";

export interface AiProviderInfo {
	id: AiProviderId;
	label: string;
	model: string;
}

export interface ChatTurn {
	role: "user" | "assistant";
	content: string;
}

export interface GenerateInput {
	system: string;
	messages: ChatTurn[];
	/** Zod schema (Claude uses it directly for structured output) */
	schema: z.ZodType;
	/** The same schema as plain JSON Schema, for Gemini and Workers AI */
	jsonSchema: Record<string, unknown>;
	/** A filled-in example reply, for DeepSeek's JSON mode */
	example: string;
}

export type GenerateResult = { ok: true; value: unknown } | { ok: false; message: string; status: number; refusal?: boolean };

const MAX_OUTPUT_TOKENS = 16000;

/** Default models; override with GEMINI_MODEL, DEEPSEEK_MODEL, WORKERS_AI_MODEL. */
const DEFAULT_MODEL: Record<AiProviderId, string> = {
	anthropic: "claude-opus-5-5",
	google: "gemini-3.8-flash",
	deepseek: "deepseek-flash",
	"workers-ai": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
};

const LABEL: Record<AiProviderId, string> = {
	anthropic: "Claude",
	google: "Gemini",
	deepseek: "DeepSeek",
	"workers-ai": "Workers AI",
};

const set = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Providers this server can use, in the order the picker shows them. */
export function availableProviders(env: Env): AiProviderInfo[] {
	const out: AiProviderInfo[] = [];
	if (set(env.ANTHROPIC_API_KEY)) out.push(info("anthropic", env));
	if (set(env.GEMINI_API_KEY)) out.push(info("google", env));
	if (set(env.DEEPSEEK_API_KEY)) out.push(info("deepseek", env));
	// No key needed: runs on Cloudflare. WORKERS_AI="off" hides it.
	if (env.AI && env.WORKERS_AI !== "off") out.push(info("workers-ai", env));
	return out;
}

function info(id: AiProviderId, env: Env): AiProviderInfo {
	const override = { google: env.GEMINI_MODEL, deepseek: env.DEEPSEEK_MODEL, "workers-ai": env.WORKERS_AI_MODEL }[
		id as "google"
	];
	return { id, label: LABEL[id], model: set(override) ? override.trim() : DEFAULT_MODEL[id] };
}

export async function generate(provider: AiProviderInfo, env: Env, input: GenerateInput): Promise<GenerateResult> {
	try {
		switch (provider.id) {
			case "anthropic":
				return await viaAnthropic(provider.model, env, input);
			case "google":
				return await viaGemini(provider.model, env, input);
			case "deepseek":
				return await viaDeepSeek(provider.model, env, input);
			case "workers-ai":
				return await viaWorkersAi(provider.model, env, input);
		}
	} catch (err) {
		console.error(`${provider.label} request failed`, err);
		if (provider.id === "workers-ai") {
			return {
				ok: false,
				status: 503,
				message:
					"Workers AI didn't respond. In local development, set CLOUDFLARE_ACCOUNT_ID in .dev.vars and restart `npm run dev`.",
			};
		}
		return { ok: false, status: 502, message: `${provider.label} ran into a problem. Try again.` };
	}
}

function httpFailure(label: string, status: number): GenerateResult {
	if (status === 401 || status === 403) {
		return { ok: false, status: 503, message: `${label} rejected this server's API key. Check it in your settings.` };
	}
	if (status === 429) return { ok: false, status: 503, message: `${label} is busy or out of quota. Try again in a minute.` };
	return { ok: false, status: 502, message: `${label} ran into a problem (HTTP ${status}). Try again.` };
}

function parseJson(text: string | undefined | null, label: string): GenerateResult {
	if (!text || !text.trim()) return { ok: false, status: 502, message: `${label} sent an empty answer. Try again.` };
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false, status: 502, message: `${label}'s answer was cut off or malformed. Try a smaller request.` };
	}
}

/* ------------------------------------------------------------------ */

async function viaAnthropic(model: string, env: Env, input: GenerateInput): Promise<GenerateResult> {
	const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
	try {
		const response = await client.beta.messages.parse({
			model,
			max_tokens: MAX_OUTPUT_TOKENS,
			betas: ["server-side-fallback-2026-07-01"],
			fallbacks: "default",
			system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
			output_config: { effort: "medium", format: betaZodOutputFormat(input.schema) },
			messages: input.messages,
		});
		if (response.stop_reason === "refusal") {
			return { ok: false, status: 200, refusal: true, message: "I can't help with that request." };
		}
		if (response.parsed_output == null) {
			return { ok: false, status: 502, message: "Claude's answer was cut off. Try a smaller request." };
		}
		return { ok: true, value: response.parsed_output };
	} catch (err) {
		if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
			return httpFailure("Claude", 401);
		}
		if (err instanceof Anthropic.RateLimitError) return httpFailure("Claude", 429);
		if (err instanceof Anthropic.APIError) return httpFailure("Claude", err.status ?? 502);
		throw err;
	}
}

/** Gemini generateContent with a JSON Schema response. */
async function viaGemini(model: string, env: Env, input: GenerateInput): Promise<GenerateResult> {
	const res = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
			body: JSON.stringify({
				systemInstruction: { parts: [{ text: input.system }] },
				contents: input.messages.map((m) => ({
					role: m.role === "assistant" ? "model" : "user",
					parts: [{ text: m.content }],
				})),
				generationConfig: {
					responseMimeType: "application/json",
					responseJsonSchema: input.jsonSchema,
					maxOutputTokens: MAX_OUTPUT_TOKENS,
				},
			}),
		},
	);
	if (!res.ok) return httpFailure("Gemini", res.status);
	const data = (await res.json()) as {
		promptFeedback?: { blockReason?: string };
		candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
	};
	const candidate = data.candidates?.[0];
	if (data.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") {
		return { ok: false, status: 200, refusal: true, message: "I can't help with that request." };
	}
	return parseJson(candidate?.content?.parts?.map((p) => p.text ?? "").join(""), "Gemini");
}

/** DeepSeek chat completions in JSON mode (OpenAI-compatible). */
async function viaDeepSeek(model: string, env: Env, input: GenerateInput): Promise<GenerateResult> {
	const res = await fetch("https://api.deepseek.com/chat/completions", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
		body: JSON.stringify({
			model,
			// JSON mode needs the word "json" and an example of the shape in the prompt
			messages: [
				{ role: "system", content: `${input.system}\n\nReply with only a JSON object shaped like this example:\n${input.example}` },
				...input.messages,
			],
			response_format: { type: "json_object" },
			max_tokens: 8000,
		}),
	});
	if (!res.ok) return httpFailure("DeepSeek", res.status);
	const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
	return parseJson(data.choices?.[0]?.message?.content, "DeepSeek");
}

/** Workers AI (runs on Cloudflare) with JSON mode. */
async function viaWorkersAi(model: string, env: Env, input: GenerateInput): Promise<GenerateResult> {
	// The binding's types only know built-in model names; the model is configurable.
	const ai = env.AI as unknown as { run(model: string, inputs: object): Promise<{ response?: unknown }> };
	const result = await ai.run(model, {
		messages: [{ role: "system", content: input.system }, ...input.messages],
		response_format: { type: "json_schema", json_schema: input.jsonSchema },
		max_tokens: 4096,
	});
	const response = result?.response;
	if (response && typeof response === "object") return { ok: true, value: response };
	return parseJson(typeof response === "string" ? response : null, "Workers AI");
}
