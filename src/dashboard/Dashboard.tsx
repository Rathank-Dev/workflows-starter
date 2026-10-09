import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Board } from "../../shared/board";
import { TEMPLATES, buildTemplate, type FlowTemplate } from "../../shared/templates";
import { AccountButton, SignInDialog } from "../board/account";
import { FlowPreview } from "../board/FlowPreview";
import { boardPath } from "../board/linkKey";
import { Icons, Mark } from "../board/icons";
import { PROVIDER_LABEL, signInUrl, type Session } from "../session";
import "./dashboard.css";

type View = "home" | "recent" | "starred" | "trash";
type OwnerFilter = "anyone" | "me" | "others";
type Sort = "opened" | "name" | "created";

interface Row {
	id: string;
	/** Share key: board links need it to open for anyone but the owner and members. Null for members. */
	key: string | null;
	name: string;
	is_owner: boolean;
	owner_name: string;
	starred: boolean;
	created_at: string;
	updated_at: string;
	last_opened_at: string | null;
	deleted_at: string | null;
}

const VIEW_TITLE: Record<View, string> = {
	home: "Boards",
	recent: "Recently opened",
	starred: "Starred",
	trash: "Trash",
};

/** Page headings set their last word in the teal accent face. */
function Accented({ text }: { text: string }) {
	const i = text.lastIndexOf(" ");
	return i < 0 ? <em>{text}</em> : (
		<>
			{text.slice(0, i + 1)}
			<em>{text.slice(i + 1)}</em>
		</>
	);
}

function viewFromUrl(): View {
	const v = new URLSearchParams(window.location.search).get("view");
	return v === "recent" || v === "starred" || v === "trash" ? v : "home";
}

/** "Today", "Yesterday", or a short date. */
function when(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso);
	const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
	if (days < 1 && new Date().getDate() === d.getDate()) return "Today";
	if (days < 2) return "Yesterday";
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function daysLeft(deletedAt: string, trashDays: number): number {
	return Math.max(0, trashDays - Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86_400_000));
}

export function Dashboard({ session }: { session: Session }) {
	const [view, setView] = useState<View>(viewFromUrl);
	const [rows, setRows] = useState<Row[] | null>(null);
	const [trashDays, setTrashDays] = useState(30);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [owner, setOwner] = useState<OwnerFilter>("anyone");
	const [sort, setSort] = useState<Sort>("opened");
	const [creating, setCreating] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const [signIn, setSignIn] = useState(false);

	const say = useCallback((msg: string) => {
		setToast(msg);
		window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
	}, []);

	const load = useCallback(async () => {
		try {
			const res = await fetch("/api/dashboard");
			if (res.status === 401) {
				setRows([]);
				return;
			}
			const data = (await res.json()) as { boards: Row[]; trashDays: number };
			setRows(data.boards);
			setTrashDays(data.trashDays);
			setLoadError(null);
		} catch {
			setLoadError("Couldn't load your boards. Check your connection and refresh.");
		}
	}, []);

	useEffect(() => {
		if (!session.loading && session.user) load();
	}, [session.loading, session.user, load]);

	// Back from a cancelled account deletion
	const [notice] = useState(() => new URLSearchParams(window.location.search));
	useEffect(() => {
		if (notice.get("account_restored") === "1") {
			say("Welcome back. Your account deletion is cancelled and your boards are restored.");
			window.history.replaceState(null, "", "/dashboard");
		}
	}, [notice, say]);
	const scheduledFor = notice.get("account_scheduled");

	const go = (v: View) => {
		setView(v);
		window.history.replaceState(null, "", v === "home" ? "/dashboard" : `/dashboard?view=${v}`);
	};

	const visible = useMemo(() => {
		if (!rows) return [];
		const q = query.trim().toLowerCase();
		let list = rows.filter((r) => (view === "trash" ? r.deleted_at !== null : r.deleted_at === null));
		if (view === "recent") list = list.filter((r) => r.last_opened_at);
		if (view === "starred") list = list.filter((r) => r.starred);
		if (owner === "me") list = list.filter((r) => r.is_owner);
		if (owner === "others") list = list.filter((r) => !r.is_owner);
		if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
		const opened = (r: Row) => new Date(r.last_opened_at ?? r.updated_at).getTime();
		return [...list].sort((a, b) =>
			view === "recent" || sort === "opened"
				? opened(b) - opened(a)
				: sort === "name"
					? a.name.localeCompare(b.name)
					: new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
		);
	}, [rows, view, owner, sort, query]);

	const counts = useMemo(() => {
		const live = rows?.filter((r) => !r.deleted_at) ?? [];
		return {
			home: live.length,
			recent: live.filter((r) => r.last_opened_at).length,
			starred: live.filter((r) => r.starred).length,
			trash: rows?.filter((r) => r.deleted_at).length ?? 0,
		};
	}, [rows]);

	const create = async (template: FlowTemplate | null) => {
		const key = template?.id ?? "blank";
		setCreating(key);
		const doc: Board = template
			? { v: 1, name: template.title, elements: buildTemplate(template, { x: 0, y: 0 }) }
			: { v: 1, name: "Untitled board", elements: [] };
		try {
			const res = await fetch("/api/boards", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ doc }),
			});
			const data = (await res.json().catch(() => null)) as { id?: string; key?: string; error?: string } | null;
			if (!res.ok || !data?.id) {
				say(data?.error ?? "Couldn't create the board. Try again.");
				return;
			}
			window.location.assign(boardPath(data.id, data.key));
		} catch {
			say("Couldn't reach the server. Check your connection.");
		} finally {
			setCreating(null);
		}
	};

	const patchRow = (id: string, patch: Partial<Row>) =>
		setRows((list) => list?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? null);

	const act = async (r: Row, action: "star" | "unstar" | "trash" | "restore" | "delete" | "rename" | "copy") => {
		const post = (path: string, body?: unknown) =>
			fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
		if (action === "copy") {
			const link = `${window.location.origin}${boardPath(r.id, r.key)}`;
			try {
				await navigator.clipboard.writeText(link);
				say("Board link copied. Change who it lets in from the board's Share menu.");
			} catch {
				window.prompt("Copy this link:", link);
			}
			return;
		}
		if (action === "star" || action === "unstar") {
			const starred = action === "star";
			patchRow(r.id, { starred });
			const res = await post(`/api/boards/${r.id}/star`, { starred });
			if (!res.ok) {
				patchRow(r.id, { starred: !starred });
				say("Couldn't update the star. Try again.");
			}
			return;
		}
		if (action === "rename") {
			const name = window.prompt("Rename board", r.name)?.trim();
			if (!name || name === r.name) return;
			const res = await fetch(`/api/boards/${r.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name }),
			});
			if (res.ok) patchRow(r.id, { name: name.slice(0, 120) });
			else say("Couldn't rename the board.");
			return;
		}
		if (action === "trash") {
			const res = await post(`/api/boards/${r.id}/trash`);
			if (res.ok) {
				patchRow(r.id, { deleted_at: new Date().toISOString() });
				say(`Moved to trash. You can restore it for ${trashDays} days.`);
			} else say("Couldn't move it to the trash.");
			return;
		}
		if (action === "restore") {
			const res = await post(`/api/boards/${r.id}/restore`);
			if (res.ok) {
				patchRow(r.id, { deleted_at: null });
				say("Restored.");
			} else say("Couldn't restore the board.");
			return;
		}
		if (!window.confirm(`Delete “${r.name}” forever? This can't be undone.`)) return;
		const res = await fetch(`/api/boards/${r.id}`, { method: "DELETE" });
		if (res.ok) {
			setRows((list) => list?.filter((x) => x.id !== r.id) ?? null);
			say("Deleted forever.");
		} else say("Couldn't delete the board.");
	};

	if (session.loading) return <div className="dash dash-loading" aria-busy="true" />;

	if (!session.user) {
		return (
			<div className="dash-signed-out">
				<a className="dash-brand" href="/">
					<Mark />
					<span>Flowyard</span>
				</a>
				<div className="panel dash-signin-card">
					{scheduledFor && !Number.isNaN(Date.parse(scheduledFor)) && (
						<p className="dash-scheduled" role="status">
							Your account will be deleted on{" "}
							<strong>{new Date(scheduledFor).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</strong>.
							Changed your mind? Sign in before then to keep it and get your boards back.
						</p>
					)}
					<h1>
						Sign in to your <em>dashboard.</em>
					</h1>
					<p>See your shared boards, starred flows, and trash in one place.</p>
					{session.providers.length === 0 ? (
						<p className="dialog-note">Sign-in isn't set up on this server yet.</p>
					) : (
						<div className="provider-list">
							{session.providers.map((p) => (
								<a key={p} className="provider-btn" href={signInUrl(p, "/dashboard")}>
									Continue with {PROVIDER_LABEL[p]}
								</a>
							))}
						</div>
					)}
					<a className="text-link" href="/board">
						Or keep drawing without an account
					</a>
				</div>
			</div>
		);
	}

	return (
		<div className="dash">
			<aside className="dash-side" aria-label="Dashboard">
				<a className="dash-brand" href="/">
					<Mark />
					<span>Flowyard</span>
				</a>
				<label className="dash-search">
					<span className="sr-only">Search boards</span>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
						<circle cx="11" cy="11" r="7" />
						<path d="M20 20l-3.5-3.5" />
					</svg>
					<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search boards" />
				</label>
				<nav className="dash-nav">
					{(["home", "recent", "starred", "trash"] as View[]).map((v) => (
						<button key={v} type="button" data-active={view === v || undefined} onClick={() => go(v)}>
							<span>{v === "home" ? "Home" : v === "recent" ? "Recent" : v === "starred" ? "Starred" : "Trash"}</span>
							{rows && <span className="dash-count">{counts[v]}</span>}
						</button>
					))}
				</nav>
				<a className="dash-local" href="/board">
					Browser board
					<span>Saved on this device, not shared</span>
				</a>
				<div className="dash-plan">
					<strong>Free plan</strong>
					<span className="ai-meter" role="img" aria-label={`${session.aiRemaining ?? session.aiDailyLimit} of ${session.aiDailyLimit} assistant requests left today`}>
						{Array.from({ length: session.aiDailyLimit }, (_, i) => (
							<span key={i} data-on={i < (session.aiRemaining ?? session.aiDailyLimit) || undefined} />
						))}
					</span>
					<span>
						{session.aiRemaining ?? session.aiDailyLimit} of {session.aiDailyLimit} assistant requests left today
					</span>
					<a className="ghost-btn" href="/profile#plan">
						Upgrade <span className="soon">Soon</span>
					</a>
				</div>
			</aside>

			<main className="dash-main">
				<header className="dash-top">
					<span className="dash-plan-badge">Free plan</span>
					<div className="dash-top-right">
						<button type="button" className="primary-btn" onClick={() => create(null)} disabled={creating !== null}>
							<Icons.plus /> New board
						</button>
						<AccountButton session={session} onSignIn={() => setSignIn(true)} />
					</div>
				</header>

				{view === "home" && (
					<section className="dash-templates" aria-label="Start a board">
						<h2>Start a board</h2>
						<div className="dash-template-row">
							<button type="button" className="dash-template" onClick={() => create(null)} disabled={creating !== null}>
								<span className="dash-template-thumb dash-blank">
									<Icons.plus />
								</span>
								<span>{creating === "blank" ? "Creating…" : "Blank board"}</span>
							</button>
							{TEMPLATES.map((t) => (
								<button key={t.id} type="button" className="dash-template" onClick={() => create(t)} disabled={creating !== null}>
									<span className="dash-template-thumb">
										<FlowPreview template={t} />
									</span>
									<span>{creating === t.id ? "Creating…" : t.title}</span>
								</button>
							))}
						</div>
					</section>
				)}

				<section className="dash-boards" aria-label={VIEW_TITLE[view]}>
					<div className="dash-boards-head">
						<h1>
							<Accented text={VIEW_TITLE[view]} />
						</h1>
						{view !== "trash" && (
							<div className="dash-filters">
								<label>
									<span>Owned by</span>
									<select value={owner} onChange={(e) => setOwner(e.target.value as OwnerFilter)}>
										<option value="anyone">Anyone</option>
										<option value="me">Me</option>
										<option value="others">Others</option>
									</select>
								</label>
								{view !== "recent" && (
									<label>
										<span>Sort by</span>
										<select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
											<option value="opened">Last opened</option>
											<option value="name">Name</option>
											<option value="created">Date created</option>
										</select>
									</label>
								)}
							</div>
						)}
					</div>
					{view === "trash" && (
						<p className="dash-note">Boards in the trash are deleted for good after {trashDays} days.</p>
					)}

					{loadError && <p className="dash-note dash-error">{loadError}</p>}
					{!rows && !loadError && <p className="dash-note">Loading your boards…</p>}
					{rows && visible.length === 0 && (
						<div className="dash-empty">
							{query ? (
								<p>No boards match “{query}”.</p>
							) : view === "trash" ? (
								<p>The trash is empty.</p>
							) : view === "starred" ? (
								<p>Star a board to keep it here.</p>
							) : view === "recent" ? (
								<p>Boards you open will show up here.</p>
							) : (
								<>
									<p>No shared boards yet.</p>
									<p>Start one from a template above, or share your browser board from inside it.</p>
								</>
							)}
						</div>
					)}

					{visible.length > 0 && (
						<table className="dash-table">
							<thead>
								<tr>
									<th scope="col" className="col-star">
										<span className="sr-only">Starred</span>
									</th>
									<th scope="col">Name</th>
									<th scope="col">{view === "trash" ? "Deleted" : "Last opened"}</th>
									<th scope="col">Owner</th>
									<th scope="col" className="col-actions">
										<span className="sr-only">Actions</span>
									</th>
								</tr>
							</thead>
							<tbody>
								{visible.map((r) => (
									<tr key={r.id}>
										<td className="col-star">
											{view !== "trash" && (
												<button
													type="button"
													className="star-btn"
													aria-pressed={r.starred}
													aria-label={r.starred ? `Unstar ${r.name}` : `Star ${r.name}`}
													onClick={() => act(r, r.starred ? "unstar" : "star")}
												>
													<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
														<path
															d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
															fill={r.starred ? "currentColor" : "none"}
															stroke="currentColor"
															strokeWidth="1.6"
															strokeLinejoin="round"
														/>
													</svg>
												</button>
											)}
										</td>
										<td>
											{view === "trash" ? (
												<span className="board-name-cell">
													<strong>{r.name}</strong>
													<span>Deleted forever in {daysLeft(r.deleted_at!, trashDays)} days</span>
												</span>
											) : (
												<a className="board-name-cell" href={boardPath(r.id, r.key)}>
													<strong>{r.name}</strong>
													<span>Updated {when(r.updated_at)}</span>
												</a>
											)}
										</td>
										<td>{when(view === "trash" ? r.deleted_at : r.last_opened_at)}</td>
										<td>{r.is_owner ? "You" : r.owner_name}</td>
										<td className="col-actions">
											<RowMenu row={r} view={view} onAction={(a) => act(r, a)} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</section>
			</main>

			{signIn && <SignInDialog session={session} reason="general" returnTo="/dashboard" onClose={() => setSignIn(false)} />}
			<div className="toast" role="status" aria-live="polite" data-shown={toast ? true : undefined}>
				{toast}
			</div>
		</div>
	);
}

function RowMenu({
	row,
	view,
	onAction,
}: {
	row: Row;
	view: View;
	onAction: (a: "trash" | "restore" | "delete" | "rename" | "copy") => void;
}) {
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
	// Keyboard users land on the first item
	useEffect(() => {
		if (open) ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
	}, [open]);

	const item = (
		label: string,
		a: "trash" | "restore" | "delete" | "rename" | "copy",
		icon: () => ReactNode,
		danger = false,
	) => (
		<button
			type="button"
			role="menuitem"
			data-danger={danger || undefined}
			onClick={() => {
				setOpen(false);
				onAction(a);
			}}
		>
			{icon()}
			{label}
		</button>
	);

	return (
		<div className="row-menu" ref={ref}>
			<button type="button" className="icon-btn" aria-label={`Actions for ${row.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
				<Icons.more />
			</button>
			{open && (
				<div className="panel menu row-menu-list" role="menu">
					{view === "trash" ? (
						<>
							{item("Restore", "restore", Icons.restore)}
							<div className="menu-sep" />
							{item("Delete forever", "delete", Icons.trash, true)}
						</>
					) : (
						<>
							<a role="menuitem" href={boardPath(row.id, row.key)}>
								<Icons.open />
								Open
							</a>
							{item("Copy link", "copy", Icons.link)}
							{row.is_owner && item("Rename", "rename", Icons.pencil)}
							{row.is_owner && <div className="menu-sep" />}
							{row.is_owner && item("Move to trash", "trash", Icons.trash, true)}
						</>
					)}
				</div>
			)}
		</div>
	);
}
