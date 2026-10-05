import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

import { cloudflare } from "@cloudflare/vite-plugin";

declare const process: { env: Record<string, string | undefined> };

// Remote bindings (Workers AI) need a Cloudflare login and a chosen account.
// scripts/dev.mjs turns them on when CLOUDFLARE_ACCOUNT_ID is set in .dev.vars.
const remoteBindings = process.env.LINEWORK_REMOTE_BINDINGS === "1";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss(), cloudflare({ remoteBindings })],
});
