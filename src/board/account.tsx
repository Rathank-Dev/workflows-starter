import { useEffect, useRef, useState, type ReactNode } from "react";
import { PROVIDER_LABEL, signInUrl, type Session } from "../session";
import { Icons } from "./icons";

function Dialog({
	title,
	onClose,
	children,
	labelledBy,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
	labelledBy: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		ref.current?.querySelector<HTMLElement>("button, a, input")?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			previous?.focus?.();
		};
	}, [onClose]);

	return (
		<div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="panel dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
				<header>
					<h2 id={labelledBy}>{title}</h2>
					<button type="button" className="text-btn" onClick={onClose}>
						Close
					</button>
				</header>
				{children}
			</div>
		</div>
	);
}

export type SignInReason = "share" | "assistant" | "boards" | "general";

const REASON_TEXT: Record<SignInReason, string> = {
	share: "Sign in to create a share link. Your board stays saved in this browser while you do.",
	assistant: "Sign in to use the assistant.",
	boards: "Sign in to see the boards you've shared.",
	general: "Sign in to share boards and use the assistant. You can keep drawing without an account.",
};

export function SignInDialog({
	session,
	reason,
	returnTo,
	onClose,
}: {
	session: Session;
	reason: SignInReason;
	returnTo: string;
	onClose: () => void;
}) {
	return (
		<Dialog title="Sign in" labelledBy="signin-title" onClose={onClose}>
			<p className="dialog-text">{REASON_TEXT[reason]}</p>
			{session.providers.length === 0 ? (
				<p className="dialog-note">Sign-in isn't set up on this server yet.</p>
			) : (
				<div className="provider-list">
					{session.providers.map((p) => (
						<a key={p} className="provider-btn" data-provider={p} href={signInUrl(p, returnTo)}>
							Continue with {PROVIDER_LABEL[p]}
						</a>
					))}
				</div>
			)}
			<p className="dialog-note">No password needed. We only read your name and profile picture.</p>
		</Dialog>
	);
}

export function ShareDialog({ link, onClose, onCopied }: { link: string; onClose: () => void; onCopied: () => void }) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
			onCopied();
		} catch {
			inputRef.current?.select();
		}
	};
	return (
		<Dialog title="Share board" labelledBy="share-title" onClose={onClose}>
			<p className="dialog-text">Anyone with this link can view and edit the board. Changes show up live for everyone.</p>
			<div className="share-row">
				<input ref={inputRef} readOnly value={link} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
				<button type="button" className="primary-btn" onClick={copy}>
					{copied ? "Copied" : "Copy link"}
				</button>
			</div>
		</Dialog>
	);
}

export function AccountButton({
	session,
	onSignIn,
	onBoards,
}: {
	session: Session;
	onSignIn: () => void;
	onBoards: () => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
		window.addEventListener("pointerdown", close);
		return () => window.removeEventListener("pointerdown", close);
	}, [open]);

	if (session.loading) return null;
	if (!session.user) {
		return (
			<button type="button" className="ghost-btn" onClick={onSignIn}>
				Sign in
			</button>
		);
	}
	const user = session.user;
	return (
		<div className="account" ref={ref}>
			<button
				type="button"
				className="avatar-btn"
				aria-label={`Account: ${user.name}`}
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
			>
				{user.avatarUrl ? (
					<img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
				) : (
					<span>{user.name.slice(0, 1).toUpperCase()}</span>
				)}
			</button>
			{open && (
				<div className="panel menu account-menu" role="menu">
					<p className="menu-label">{user.name}</p>
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							setOpen(false);
							onBoards();
						}}
					>
						Your shared boards
					</button>
					<div className="menu-sep" />
					<button
						type="button"
						role="menuitem"
						onClick={() => {
							setOpen(false);
							session.signOut();
						}}
					>
						Sign out
					</button>
				</div>
			)}
		</div>
	);
}

interface BoardRow {
	id: string;
	name: string;
	updated_at: string;
}

export function BoardsPanel({ onClose, currentId }: { onClose: () => void; currentId: string | null }) {
	const [boards, setBoards] = useState<BoardRow[] | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		fetch("/api/boards")
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((d: { boards: BoardRow[] }) => setBoards(d.boards))
			.catch(() => setFailed(true));
	}, []);

	const remove = async (b: BoardRow) => {
		if (!window.confirm(`Delete “${b.name}” for everyone? This can't be undone.`)) return;
		const res = await fetch(`/api/boards/${b.id}`, { method: "DELETE" });
		if (res.ok) {
			setBoards((list) => list?.filter((x) => x.id !== b.id) ?? null);
			if (b.id === currentId) window.location.assign("/board");
		}
	};

	return (
		<Dialog title="Your shared boards" labelledBy="boards-title" onClose={onClose}>
			{failed && <p className="dialog-note">Couldn't load your boards. Check your connection and try again.</p>}
			{!failed && boards === null && <p className="dialog-note">Loading…</p>}
			{boards?.length === 0 && (
				<p className="dialog-text">You haven't shared a board yet. Use Share on any board to create a link.</p>
			)}
			{boards && boards.length > 0 && (
				<ul className="board-list">
					{boards.map((b) => (
						<li key={b.id} data-current={b.id === currentId || undefined}>
							<a href={`/board?board=${b.id}`}>
								<span className="board-list-name">{b.name}</span>
								<span className="board-list-date">
									{new Date(b.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
								</span>
							</a>
							<button type="button" className="icon-btn" aria-label={`Delete ${b.name}`} onClick={() => remove(b)}>
								<Icons.trash />
							</button>
						</li>
					))}
				</ul>
			)}
		</Dialog>
	);
}
