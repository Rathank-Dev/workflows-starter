import { useEffect, useRef, useState, type ReactNode } from "react";
import { PROVIDER_LABEL, signInUrl, type Session } from "../session";

export function Dialog({
	title,
	onClose,
	children,
	labelledBy,
	className,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
	labelledBy: string;
	className?: string;
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
			<div className={`panel dialog ${className ?? ""}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
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

export type SignInReason = "share" | "assistant" | "boards" | "general" | "invite" | "comment" | "record" | "access";

const REASON_TEXT: Record<SignInReason, string> = {
	share: "Sign in to create a share link. Your board stays saved in this browser while you do.",
	assistant: "Sign in to use the assistant.",
	boards: "Sign in to see the boards you've shared.",
	general: "Sign in to share boards and use the assistant. You can keep drawing without an account.",
	invite: "Sign in to join this board. The invite link keeps working after you sign in.",
	comment: "Sign in to comment. Comments show your name to everyone on the board.",
	record: "Sign in to record a walkthrough of this board.",
	access: "This board is private. Sign in with the account that was invited to open it.",
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

export function AccountButton({ session, onSignIn }: { session: Session; onSignIn: () => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		window.addEventListener("pointerdown", close);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointerdown", close);
			window.removeEventListener("keydown", onKey);
		};
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
				aria-haspopup="menu"
				onClick={() => setOpen((o) => !o)}
			>
				<Avatar user={user} />
			</button>
			{open && (
				<div className="panel menu account-menu" role="menu">
					<div className="account-menu-head">
						<Avatar user={user} />
						<span>{user.name}</span>
					</div>
					<a role="menuitem" href="/dashboard">
						Dashboard
					</a>
					<a role="menuitem" href="/profile">
						Profile
					</a>
					<a role="menuitem" href="/dashboard?view=trash">
						Trash
					</a>
					<div className="menu-sep" />
					<a role="menuitem" href="/profile#plan">
						Upgrade <span className="soon">Soon</span>
					</a>
					<button
						type="button"
						role="menuitem"
						onClick={async () => {
							setOpen(false);
							await session.signOut();
							window.location.assign("/");
						}}
					>
						Log out
					</button>
				</div>
			)}
		</div>
	);
}

export function Avatar({ user, size }: { user: { name: string; avatarUrl: string | null }; size?: number }) {
	const style = size ? { width: size, height: size, fontSize: size * 0.42 } : undefined;
	return user.avatarUrl ? (
		<img className="avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" style={style} />
	) : (
		<span className="avatar avatar-initial" style={style} aria-hidden="true">
			{user.name.slice(0, 1).toUpperCase()}
		</span>
	);
}
