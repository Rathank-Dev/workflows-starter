// Applies db/schema.sql. Reads DATABASE_URL from the environment, or from .dev.vars.
import { readFileSync, existsSync } from "node:fs";
import postgres from "postgres";

let url = process.env.DATABASE_URL;
if (!url && existsSync(".dev.vars")) {
	url = readFileSync(".dev.vars", "utf8").match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)?.[1];
}
if (!url) {
	console.error("Set DATABASE_URL, or add it to .dev.vars.");
	process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
	await sql.unsafe(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
	const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
	console.log("Schema applied. Tables:", tables.map((t) => t.table_name).join(", "));
} finally {
	await sql.end();
}
