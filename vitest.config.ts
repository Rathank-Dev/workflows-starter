import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests never query Postgres, but the Hyperdrive binding needs a local URL to start.
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??= "postgres://test:test@127.0.0.1:5432/test";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			// Don't connect Workers AI (or any remote binding) to Cloudflare during tests
			remoteBindings: false,
		}),
	],
});
