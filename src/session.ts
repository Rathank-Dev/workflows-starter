import { useCallback, useEffect, useState } from "react";

export type Provider = "github" | "google" | "discord";

export interface AssistantProvider {
	id: "anthropic" | "google" | "deepseek" | "workers-ai";
	label: string;
	model: string;
}

export interface SessionUser {
	id: string;
	name: string;
	avatarUrl: string | null;
}

interface SessionState {
	loading: boolean;
	user: SessionUser | null;
	providers: Provider[];
	/** AI providers the server is configured for; empty means the assistant is off */
	assistant: AssistantProvider[];
}

/** Who's signed in, which sign-in methods exist, and whether the assistant is on. */
export function useSession() {
	const [state, setState] = useState<SessionState>({ loading: true, user: null, providers: [], assistant: [] });

	useEffect(() => {
		let cancelled = false;
		fetch("/api/me")
			.then((r) => (r.ok ? r.json() : null))
			.then((d: Partial<SessionState> | null) => {
				if (cancelled) return;
				setState({
					loading: false,
					user: d?.user ?? null,
					providers: d?.providers ?? [],
					assistant: Array.isArray(d?.assistant) ? d.assistant : [],
				});
			})
			.catch(() => !cancelled && setState((s) => ({ ...s, loading: false })));
		return () => {
			cancelled = true;
		};
	}, []);

	const signOut = useCallback(async () => {
		await fetch("/auth/logout", { method: "POST" }).catch(() => {});
		setState((s) => ({ ...s, user: null }));
	}, []);

	return { ...state, signOut };
}

export type Session = ReturnType<typeof useSession>;

export const PROVIDER_LABEL: Record<Provider, string> = {
	github: "GitHub",
	google: "Google",
	discord: "Discord",
};

export function signInUrl(provider: Provider, returnTo: string) {
	return `/auth/login/${provider}?returnTo=${encodeURIComponent(returnTo)}`;
}
