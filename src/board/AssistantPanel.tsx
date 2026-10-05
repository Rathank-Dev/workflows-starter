import { useEffect, useRef, useState } from "react";
import type { FlowSpec } from "../../shared/templates";
import type { Session } from "../session";

interface Message {
	role: "user" | "assistant";
	content: string;
	/** What happened on the board, shown under an assistant reply */
	applied?: { label: string; frameId: string };
	error?: boolean;
}

export interface AssistantContext {
	selected: { frameId: string; spec: FlowSpec } | null;
	frames: string[];
}

interface AiResponse {
	reply: string;
	action: "none" | "insert" | "replace";
	flow: FlowSpec | null;
	/** Uses left today after this request */
	remaining?: number;
}

export function AssistantPanel({
	session,
	context,
	applyFlow,
	showFrame,
	onSignIn,
	onClose,
}: {
	session: Session;
	context: AssistantContext;
	/** Puts the flow on the board and returns the frame it lives in */
	applyFlow: (flow: FlowSpec, replaceFrameId: string | null) => string;
	showFrame: (frameId: string) => void;
	onSignIn: () => void;
	onClose: () => void;
}) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [remaining, setRemaining] = useState<number | null>(session.aiRemaining);
	const outOfUses = remaining !== null && remaining <= 0;
	const listRef = useRef<HTMLDivElement>(null);
	const [providerId, setProviderId] = useState<string>(() => {
		try {
			return localStorage.getItem("linework:ai-provider") ?? "";
		} catch {
			return "";
		}
	});
	const provider = session.assistant.find((p) => p.id === providerId) ?? session.assistant[0];
	const pickProvider = (id: string) => {
		setProviderId(id);
		try {
			localStorage.setItem("linework:ai-provider", id);
		} catch {
			// Storage blocked; the choice lasts for this visit
		}
	};
	const inputRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
	}, [messages, busy]);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const send = async (text: string) => {
		const content = text.trim();
		if (!content || busy || outOfUses) return;
		const ctx = context;
		const history = [...messages, { role: "user" as const, content }];
		setMessages(history);
		setDraft("");
		setBusy(true);
		try {
			const res = await fetch("/api/ai", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					messages: history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
					selected: ctx.selected?.spec ?? null,
					frames: ctx.frames,
					provider: provider?.id,
				}),
			});
			const data = (await res.json().catch(() => null)) as (AiResponse & { error?: string }) | null;
			if (typeof data?.remaining === "number") setRemaining(data.remaining);
			if (!res.ok || !data || data.error) {
				if (res.status === 401) onSignIn();
				if (res.status === 429 && /today/i.test(data?.error ?? "")) setRemaining(0);
				setMessages((m) => [...m, { role: "assistant", content: data?.error ?? "The assistant didn't answer. Try again.", error: true }]);
				return;
			}
			let applied: Message["applied"];
			if (data.flow && data.action !== "none") {
				const replaceId = data.action === "replace" ? (ctx.selected?.frameId ?? null) : null;
				const frameId = applyFlow(data.flow, replaceId);
				applied = { label: `${replaceId ? "Updated" : "Added"} “${data.flow.title}”`, frameId };
			}
			setMessages((m) => [...m, { role: "assistant", content: data.reply, applied }]);
		} catch {
			setMessages((m) => [...m, { role: "assistant", content: "Couldn't reach the assistant. Check your connection.", error: true }]);
		} finally {
			setBusy(false);
		}
	};

	const suggestions = context.selected
		? ["What's missing from this flow?", "Add logging and alerting steps", "Turn this into swimlanes by actor"]
		: ["Draw a password reset flow", "Map a file upload pipeline with malware scanning", "Draw a JWT refresh token rotation flow"];

	let body;
	if (!session.user) {
		body = (
			<div className="assistant-empty">
				<p>Sign in to use the assistant. It can draw new flows and change the one you select.</p>
				<button type="button" className="primary-btn" onClick={onSignIn}>
					Sign in
				</button>
			</div>
		);
	} else if (session.assistant.length === 0) {
		body = (
			<div className="assistant-empty">
				<p>The assistant isn't set up on this server yet.</p>
			</div>
		);
	} else {
		body = (
			<>
				<div className="assistant-log" ref={listRef} aria-live="polite">
					{messages.length === 0 && (
						<div className="assistant-intro">
							<p>Describe a flow and I'll draw it. Select a frame first to have me change it.</p>
							<div className="chips">
								{suggestions.map((s) => (
									<button key={s} type="button" className="chip" onClick={() => send(s)}>
										{s}
									</button>
								))}
							</div>
						</div>
					)}
					{messages.map((m, i) => (
						<div key={i} className="msg" data-role={m.role} data-error={m.error || undefined}>
							<p>{m.content}</p>
							{m.applied && (
								<button type="button" className="applied" onClick={() => showFrame(m.applied!.frameId)}>
									{m.applied.label}. Show on board
								</button>
							)}
						</div>
					))}
					{busy && (
						<div className="msg" data-role="assistant">
							<p className="thinking">Working on it…</p>
						</div>
					)}
				</div>
				<form
					className="assistant-input"
					data-has-picker={session.assistant.length > 1 || undefined}
					onSubmit={(e) => {
						e.preventDefault();
						send(draft);
					}}
				>
					{session.assistant.length > 1 && (
						<label className="model-pick">
							<span>Model</span>
							<select value={provider?.id} onChange={(e) => pickProvider(e.target.value)}>
								{session.assistant.map((p) => (
									<option key={p.id} value={p.id}>
										{p.label}
									</option>
								))}
							</select>
						</label>
					)}
					{remaining !== null && (
						<p className="ai-quota" data-empty={outOfUses || undefined}>
							{outOfUses
								? "You've used today's assistant requests. They reset at midnight UTC."
								: `${remaining} of ${session.aiDailyLimit} assistant requests left today`}
						</p>
					)}
					{context.selected && (
						<p className="working-on">
							Working on <strong>{context.selected.spec.title}</strong>
						</p>
					)}
					<textarea
						ref={inputRef}
						rows={2}
						value={draft}
						maxLength={4000}
						placeholder={context.selected ? "Ask for a change to this flow" : "Describe a flow to draw"}
						aria-label="Message the assistant"
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								send(draft);
							}
						}}
					/>
					<button type="submit" className="primary-btn" disabled={busy || outOfUses || !draft.trim()}>
						Send
					</button>
				</form>
			</>
		);
	}

	return (
		<aside className="panel assistant" aria-label="Assistant" onPointerDown={(e) => e.stopPropagation()}>
			<header>
				<h2>Assistant</h2>
				<button type="button" className="text-btn" onClick={onClose}>
					Close
				</button>
			</header>
			{body}
		</aside>
	);
}
