import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

/**
 * One small connection per request, through Hyperdrive's pool. Workers can't
 * keep sockets between requests, so callers must `ctx.waitUntil(sql.end())`.
 */
export function connect(env: Env): Sql {
	return postgres(env.HYPERDRIVE.connectionString, {
		max: 1,
		fetch_types: false,
		connect_timeout: 10,
		idle_timeout: 5,
		onnotice: () => {},
	});
}

export interface User {
	id: string;
	name: string;
	email: string | null;
	avatar_url: string | null;
}
