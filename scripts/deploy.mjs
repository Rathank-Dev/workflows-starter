// Deploys the Worker named in wrangler.jsonc ("flowyard").
//
// Workers Builds is linked to the old "workflows-starter" Worker and sets
// WRANGLER_CI_OVERRIDE_NAME / WRANGLER_CI_MATCH_TAG, which make wrangler ignore
// the config's name and deploy to that Worker instead (it fails there: its
// storage history belongs to the original template). Clearing them makes CI
// deploy exactly what the config says. Once Builds is connected to "flowyard"
// in the dashboard, this is a no-op.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const env = { ...process.env };
for (const name of ["WRANGLER_CI_OVERRIDE_NAME", "WRANGLER_CI_MATCH_TAG"]) {
	if (env[name]) console.log(`Ignoring ${name}=${env[name]}; deploying the Worker named in wrangler.jsonc.`);
	delete env[name];
}
const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const { status } = spawnSync(process.execPath, [wrangler, "deploy", ...process.argv.slice(2)], { stdio: "inherit", env });
process.exit(status ?? 1);
