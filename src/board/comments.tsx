import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_COMMENT_CHARS, type BoardComment, type CommentOp } from "../../shared/comments";

interface Viewport {
	x: number;
	y: number;
	zoom: number;
}

export interface Thread {
	root: BoardComment;
	replies: BoardComment[];
}

/** Groups comments into threads, oldest first. */
// eslint-disable-next-line react-refresh/only-export-components -- a hook used only alongside these components
export function useThreads(comments: Map<string, BoardComment>): Thread[] {
	return useMemo(() => {
		const threads = new Map<string, Thread>();
		const all = Array.from(comments.values()).sort((a, b) => a.at - b.at);
		for (const c of all) if (c.parent === null) threads.set(c.id, { root: c, replies: [] });
		for (const c of all) if (c.parent !== null) threads.get(c.parent)?.replies.push(c);
		return Array.from(threads.values());
	}, [comments]);
}

const timeFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function ago(at: number): string {
	const s = Math.round((at - Date.now()) / 1000);
	if (s > -60) return "just now";
	if (s > -3600) return timeFmt.format(Math.round(s / 60), "minute");
	if (s > -86400) return timeFmt.format(Math.round(s / 3600), "hour");
	if (s > -86400 * 7) return timeFmt.format(Math.round(s / 86400), "day");
	return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const screen = (vp: Viewport, x: number, y: number) => ({ left: x * vp.zoom + vp.x, top: y * vp.zoom + vp.y });

/** Pins for open threads, drawn over the canvas at their board position. */
export function CommentPins({
	threads,
	vp,
	openId,
	onOpen,
}: {
	threads: Thread[];
	vp: Viewport;
	openId: string | null;
	onOpen: (id: string) => void;
}) {
	return (
		<div className="comment-layer">
			{threads
				.filter((t) => !t.root.resolved || t.root.id === openId)
				.map((t) => (
					<button
						key={t.root.id}
						type="button"
						className="comment-pin"
						data-open={t.root.id === openId || undefined}
						data-resolved={t.root.resolved || undefined}
						style={screen(vp, t.root.x, t.root.y)}
						aria-label={`Comment by ${t.root.authorName}${t.replies.length ? `, ${t.replies.length} replies` : ""}`}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => onOpen(t.root.id)}
					>
						<span>{t.root.authorName.slice(0, 1).toUpperCase()}</span>
						{t.replies.length > 0 && <em>{t.replies.length + 1}</em>}
					</button>
				))}
		</div>
	);
}

function Compose({
	placeholder,
	submitLabel,
	onSubmit,
	onCancel,
	autoFocus,
}: {
	placeholder: string;
	submitLabel: string;
	onSubmit: (text: string) => boolean;
	onCancel?: () => void;
	autoFocus?: boolean;
}) {
	const [text, setText] = useState("");
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (autoFocus) ref.current?.focus();
	}, [autoFocus]);
	const submit = () => {
		if (text.trim() && onSubmit(text.trim())) setText("");
	};
	return (
		<form
			className="comment-compose"
			onSubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<textarea
				ref={ref}
				value={text}
				maxLength={MAX_COMMENT_CHARS}
				rows={2}
				placeholder={placeholder}
				aria-label={placeholder}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						submit();
					} else if (e.key === "Escape") {
						onCancel?.();
					}
				}}
			/>
			<div className="comment-compose-actions">
				{onCancel && (
					<button type="button" className="text-btn" onClick={onCancel}>
						Cancel
					</button>
				)}
				<button type="submit" className="primary-btn" disabled={!text.trim()}>
					{submitLabel}
				</button>
			</div>
		</form>
	);
}

/** Popover for writing a new comment where the person clicked. */
export function NewComment({
	at,
	vp,
	send,
	onDone,
}: {
	at: { x: number; y: number };
	vp: Viewport;
	send: (op: CommentOp) => boolean;
	onDone: () => void;
}) {
	return (
		<>
			<span className="comment-pin" data-open data-draft style={screen(vp, at.x, at.y)} aria-hidden="true">
				<span>+</span>
			</span>
			<div className="panel comment-pop" style={popPosition(vp, at)} onPointerDown={(e) => e.stopPropagation()}>
				<Compose
					autoFocus
					placeholder="Add a comment"
					submitLabel="Comment"
					onCancel={onDone}
					onSubmit={(text) => {
						const ok = send({ type: "comment:add", x: at.x, y: at.y, text });
						if (ok) onDone();
						return ok;
					}}
				/>
			</div>
		</>
	);
}

/** Keeps a popover beside its pin and inside the window. */
function popPosition(vp: Viewport, at: { x: number; y: number }) {
	const p = screen(vp, at.x, at.y);
	const w = Math.min(320, window.innerWidth - 32);
	return {
		left: Math.max(16, Math.min(p.left + 22, window.innerWidth - w - 16)),
		top: Math.max(76, Math.min(p.top - 8, window.innerHeight - 340)),
		width: w,
	};
}

/** An open thread: its comments, a reply box, resolve and delete. */
export function ThreadPopover({
	thread,
	vp,
	meId,
	isOwner,
	canComment,
	send,
	onSignIn,
	onClose,
}: {
	thread: Thread;
	vp: Viewport;
	meId: string | null;
	isOwner: boolean;
	canComment: boolean;
	send: (op: CommentOp) => boolean;
	onSignIn: () => void;
	onClose: () => void;
}) {
	const { root, replies } = thread;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	return (
		<div
			className="panel comment-pop"
			style={popPosition(vp, root)}
			role="dialog"
			aria-label={`Comment thread by ${root.authorName}`}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<header className="comment-pop-head">
				{canComment && (
					<button
						type="button"
						className="text-btn"
						onClick={() => send({ type: "comment:resolve", id: root.id, resolved: !root.resolved })}
					>
						{root.resolved ? "Reopen" : "Resolve"}
					</button>
				)}
				{(root.authorId === meId || isOwner) && (
					<button
						type="button"
						className="text-btn danger-link"
						onClick={() => {
							send({ type: "comment:delete", id: root.id });
							onClose();
						}}
					>
						Delete
					</button>
				)}
				<button type="button" className="text-btn" onClick={onClose} aria-label="Close thread">
					Close
				</button>
			</header>
			<ol className="comment-list">
				{[root, ...replies].map((c) => (
					<li key={c.id}>
						<div className="comment-meta">
							<strong>{c.authorName}</strong>
							<span>{ago(c.at)}</span>
							{c.parent !== null && (c.authorId === meId || isOwner) && (
								<button
									type="button"
									className="text-btn"
									aria-label="Delete reply"
									onClick={() => send({ type: "comment:delete", id: c.id })}
								>
									Delete
								</button>
							)}
						</div>
						<p>{c.text}</p>
					</li>
				))}
			</ol>
			{root.resolved ? (
				<p className="comment-note">Resolved. Reopen it to reply.</p>
			) : canComment ? (
				<Compose
					placeholder="Reply"
					submitLabel="Reply"
					onSubmit={(text) => send({ type: "comment:reply", parent: root.id, text })}
				/>
			) : (
				<button type="button" className="ghost-btn comment-signin" onClick={onSignIn}>
					Sign in to reply
				</button>
			)}
		</div>
	);
}

/** Side panel: every thread on the board, newest activity first. */
export function CommentsPanel({
	threads,
	openId,
	onOpen,
	onStart,
	onClose,
}: {
	threads: Thread[];
	openId: string | null;
	onOpen: (t: Thread) => void;
	onStart: () => void;
	onClose: () => void;
}) {
	const [showResolved, setShowResolved] = useState(false);
	const visible = threads
		.filter((t) => showResolved || !t.root.resolved)
		.sort((a, b) => last(b) - last(a));
	const resolvedCount = threads.filter((t) => t.root.resolved).length;
	return (
		<aside className="panel side-panel comments-panel" aria-label="Comments">
			<header className="side-panel-head">
				<h2>Comments</h2>
				<button type="button" className="text-btn" onClick={onClose}>
					Close
				</button>
			</header>
			{resolvedCount > 0 && (
				<label className="comments-filter">
					<input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
					Show resolved ({resolvedCount})
				</label>
			)}
			{visible.length === 0 ? (
				<div className="comments-empty">
					<span className="comments-empty-icon" aria-hidden="true">
						<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
							<path d="M4 5h16v11H9l-5 4z" strokeLinejoin="round" />
						</svg>
					</span>
					<h3>Start a discussion</h3>
					<p>Drop a comment anywhere on the board to ask a question or flag a gap in the flow.</p>
					<button type="button" className="primary-btn" onClick={onStart}>
						Add a comment
					</button>
				</div>
			) : (
				<ul className="comments-threads">
					{visible.map((t) => (
						<li key={t.root.id}>
							<button type="button" data-open={t.root.id === openId || undefined} onClick={() => onOpen(t)}>
								<span className="comment-meta">
									<strong>{t.root.authorName}</strong>
									<span>{ago(last(t))}</span>
									{t.root.resolved && <span className="pill pill-on">Resolved</span>}
								</span>
								<span className="comments-thread-text">{t.root.text}</span>
								{t.replies.length > 0 && (
									<span className="muted">
										{t.replies.length} {t.replies.length === 1 ? "reply" : "replies"}
									</span>
								)}
							</button>
						</li>
					))}
				</ul>
			)}
		</aside>
	);
}

const last = (t: Thread) => (t.replies.length ? t.replies[t.replies.length - 1].at : t.root.at);
