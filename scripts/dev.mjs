// Starts Vite with Hyperdrive's local connection string taken from .dev.vars,
// so the database password lives in exactly one git-ignored file.
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const env = { ...process.env };
const vars = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "";
const read = (name) => vars.match(new RegExp(`^${name}\\s*=\\s*"?([^"\\n]*)"?`, "m"))?.[1] || undefined;

env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??= read("DATABASE_URL");
// Which Cloudflare account Workers AI calls are billed to, when you can access several
env.CLOUDFLARE_ACCOUNT_ID ??= read("CLOUDFLARE_ACCOUNT_ID");
if (env.CLOUDFLARE_ACCOUNT_ID) {
	env.LINEWORK_REMOTE_BINDINGS = "1";
} else {
	delete env.CLOUDFLARE_ACCOUNT_ID;
	console.log("Workers AI is off locally. Set CLOUDFLARE_ACCOUNT_ID in .dev.vars (after `npx wrangler login`) to use it.");
}
if (!env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE) {
	console.warn("No DATABASE_URL in .dev.vars: sign-in and sharing won't work locally.");
}
// Run the project's own Vite, whether started via `npm run` or `node scripts/dev.mjs`
const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [vite, ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
