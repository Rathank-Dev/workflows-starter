import { useCallback, useEffect, useState } from "react";

export type Provider = "github" | "google" | "discord";

/** A neutral assistant option ("fast", "best", ...). The server keeps which AI it maps to. */
export interface AssistantProvider {
	id: string;
	label: string;
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
	/** Assistant uses left today for the signed-in user */
	aiRemaining: number | null;
	aiDailyLimit: number;
}

/** Who's signed in, which sign-in methods exist, and whether the assistant is on. */
export function useSession() {
	const [state, setState] = useState<SessionState>({ loading: true, user: null, providers: [], assistant: [], aiRemaining: null, aiDailyLimit: 3 });

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
					aiRemaining: typeof d?.aiRemaining === "number" ? d.aiRemaining : null,
					aiDailyLimit: typeof d?.aiDailyLimit === "number" ? d.aiDailyLimit : 3,
				});
			})
			.catch(() => !cancelled && setState((s) => ({ ...s, loading: false })));
		return () => {
			cancelled = true;
		};
	}, []);

	const signOut = useCallback(async () => {
		await fetch("/auth/logout", { method: "POST" }).catch(() => {});
		forgetSharedBoards();
		setState((s) => ({ ...s, user: null }));
	}, []);

	return { ...state, signOut };
}

export type Session = ReturnType<typeof useSession>;

/**
 * Signing out: remove this browser's copies of shared boards and the roles
 * seen on them (see useBoardDoc), so the next person at this computer can't
 * read them. The signed-out board ("flowyard:local") is the user's own and stays.
 */
export function forgetSharedBoards() {
	try {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith("flowyard:board:") || key.startsWith("flowyard:role:")) localStorage.removeItem(key);
		}
	} catch {
		// Storage blocked: nothing was saved
	}
}

export const PROVIDER_LABEL: Record<Provider, string> = {
	github: "GitHub",
	google: "Google",
	discord: "Discord",
};

export function signInUrl(provider: Provider, returnTo: string) {
	return `/auth/login/${provider}?returnTo=${encodeURIComponent(returnTo)}`;
}
