import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Database tests (test/db.test.ts) run only when TEST_DATABASE_URL points at a
// throwaway Postgres with the schema applied. Without it, Hyperdrive still needs
// a local URL to start, and those tests are skipped.
const testDatabase = process.env.TEST_DATABASE_URL;
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE =
	testDatabase ?? process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ?? "postgres://test:test@127.0.0.1:5432/test";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			// Don't connect Workers AI (or any remote binding) to Cloudflare during tests
			remoteBindings: false,
			miniflare: { bindings: { DB_TESTS: testDatabase ? "1" : "" } },
		}),
	],
	test: {
		// postgres.js's Cloudflare socket adapter reports a socket closed by
		// sql.end() as an unhandled rejection. Ignore exactly that one, so any
		// other unhandled error still fails the run.
		onUnhandledError: (error) => error.message !== "This socket has been closed.",
	},
});
