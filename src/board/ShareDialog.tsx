import { useCallback, useEffect, useState } from "react";
import type { Session } from "../session";
import { Avatar, Dialog } from "./account";
import { boardPath, linkKey, withKey } from "./linkKey";
import type { BoardRole, Person } from "./useBoardDoc";

type LinkAccess = "edit" | "view" | "none";
type Tab = "invite" | "rewards";

interface Sharing {
  role: BoardRole;
  linkAccess: LinkAccess;
  /** The board's share link with its key; null for people who came through the link. */
  linkUrl: string | null;
  invite: { role: "edit" | "view"; url: string | null } | null;
  people: {
    id: string;
    name: string;
    avatarUrl: string | null;
    role: BoardRole;
  }[];
}

const ROLE_LABEL: Record<BoardRole, string> = {
  owner: "Owner",
  edit: "Can edit",
  view: "Can view",
};
const LINK_HELP: Record<LinkAccess, string> = {
  edit: "Anyone who has the board link can open it and edit, even without signing in.",
  view: "Anyone who has the board link can open it and look, but only members can edit.",
  none: "Only you and the people you've invited can open this board.",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = (await res.json().catch(() => null)) as
    (T & { error?: string }) | null;
  if (!res.ok)
    throw new Error(data?.error ?? "Something went wrong. Try again.");
  return data as T;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Share: who can open the board, the invite link that makes people members,
 * and everyone on it. Rewards: your personal link for inviting people to Flowyard.
 */
export function ShareDialog({
  boardId,
  boardName,
  session,
  here,
  onClose,
  say,
}: {
  boardId: string;
  boardName: string;
  session: Session;
  /** Signed-in people on the board right now. */
  here: Person[];
  onClose: () => void;
  say: (message: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("invite");
  return (
    <Dialog
      title={`Share “${boardName}”`}
      labelledBy="share-title"
      onClose={onClose}
      className="share-dialog"
    >
      <div className="tabs" role="tablist" aria-label="Share options">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "invite"}
          onClick={() => setTab("invite")}
        >
          Invite
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "rewards"}
          onClick={() => setTab("rewards")}
        >
          Rewards
        </button>
      </div>
      {tab === "invite" ? (
        <InviteTab
          boardId={boardId}
          boardName={boardName}
          here={here}
          say={say}
        />
      ) : (
        <RewardsTab session={session} say={say} />
      )}
    </Dialog>
  );
}

function InviteTab({
  boardId,
  boardName,
  here,
  say,
}: {
  boardId: string;
  boardName: string;
  here: Person[];
  say: (message: string) => void;
}) {
  const [data, setData] = useState<Sharing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Sharing>(withKey(`/api/boards/${boardId}/sharing`)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [boardId]);
  useEffect(() => {
    load();
  }, [load]);

  /** Runs a change; `show` updates the dialog right away so it doesn't lag the server. */
  const run = async (
    fn: () => Promise<unknown>,
    done?: string,
    show?: (d: Sharing) => Sharing,
  ) => {
    if (show) setData((d) => (d ? show(d) : d));
    setBusy(true);
    try {
      await fn();
      await load();
      if (done) say(done);
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <p className="dialog-note dash-error">{error}</p>;
  if (!data) return <p className="dialog-note">Loading…</p>;

  const isOwner = data.role === "owner";
  // Link visitors aren't sent the key; they already have it in this page's address
  const boardLink = data.linkUrl ?? `${window.location.origin}${boardPath(boardId, linkKey())}`;
  const hereIds = new Set(here.map((p) => p.id));
  const invite = data.invite;
  const mail = (url: string) =>
    `mailto:?subject=${encodeURIComponent(`Join “${boardName}” on Flowyard`)}&body=${encodeURIComponent(
      `I'd like you to work on this flow with me:\n\n${url}\n`,
    )}`;

  return (
    <div className="share-body">
      {error && <p className="dialog-note dash-error">{error}</p>}

      {isOwner && invite && (
        <section className="share-section" aria-labelledby="invite-title">
          <h3 id="invite-title">Invite people</h3>
          <p className="share-help">
            People who open this link and sign in become members of the board.
          </p>
          {invite.url ? (
            <>
              <div className="share-row">
                <input
                  readOnly
                  value={invite.url}
                  aria-label="Invite link"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <select
                  aria-label="Invited people"
                  value={invite.role}
                  disabled={busy}
                  onChange={(e) => {
                    const inviteRole = e.target.value as "edit" | "view";
                    run(
                      () =>
                        api(`/api/boards/${boardId}/sharing`, {
                          method: "PATCH",
                          body: JSON.stringify({ inviteRole }),
                        }),
                      undefined,
                      (d) => ({
                        ...d,
                        invite: d.invite && { ...d.invite, role: inviteRole },
                      }),
                    );
                  }}
                >
                  <option value="edit">Can edit</option>
                  <option value="view">Can view</option>
                </select>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={async () =>
                    say(
                      (await copyText(invite.url!))
                        ? "Invite link copied"
                        : "Select the link and copy it",
                    )
                  }
                >
                  Copy
                </button>
              </div>
              <div className="share-links">
                <a className="text-link" href={mail(invite.url)}>
                  Email it
                </a>
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        api(`/api/boards/${boardId}/invite`, {
                          method: "POST",
                        }),
                      "New invite link created. The old one no longer works.",
                    )
                  }
                >
                  Reset link
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="primary-btn"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    api(`/api/boards/${boardId}/invite`, { method: "POST" }),
                  "Invite link created",
                )
              }
            >
              Create invite link
            </button>
          )}
        </section>
      )}

      <section className="share-section" aria-labelledby="access-title">
        <h3 id="access-title">Board link</h3>
        <div className="access-row">
          <span className="access-icon" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
            </svg>
          </span>
          <span className="access-label">Anyone with the link</span>
          {isOwner ? (
            <select
              aria-label="Anyone with the link"
              value={data.linkAccess}
              disabled={busy}
              onChange={(e) => {
                const linkAccess = e.target.value as LinkAccess;
                run(
                  () =>
                    api(`/api/boards/${boardId}/sharing`, {
                      method: "PATCH",
                      body: JSON.stringify({ linkAccess }),
                    }),
                  "Board link access updated",
                  (d) => ({ ...d, linkAccess }),
                );
              }}
            >
              <option value="edit">Can edit</option>
              <option value="view">Can view</option>
              <option value="none">No access</option>
            </select>
          ) : (
            <span className="muted">
              {data.linkAccess === "none"
                ? "No access"
                : ROLE_LABEL[data.linkAccess]}
            </span>
          )}
        </div>
        <p className="share-help">{LINK_HELP[data.linkAccess]}</p>
        <div className="share-row">
          <input
            readOnly
            value={boardLink}
            aria-label="Board link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="ghost-btn"
            onClick={async () =>
              say(
                (await copyText(boardLink))
                  ? "Board link copied"
                  : "Select the link and copy it",
              )
            }
          >
            Copy
          </button>
        </div>
        {isOwner && (
          <div className="share-links">
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const { key } = await api<{ key: string }>(`/api/boards/${boardId}/link`, { method: "POST" });
                  window.history.replaceState(null, "", boardPath(boardId, key));
                }, "New board link created. The old one no longer works.")
              }
            >
              Reset link
            </button>
          </div>
        )}
      </section>

      {data.people.length > 0 && (
        <section className="share-section" aria-labelledby="people-title">
          <h3 id="people-title">
            People <span className="muted">{data.people.length}</span>
          </h3>
          {data.people.length === 1 && isOwner && (
            <p className="share-help">
              You haven't invited anyone yet. Send the invite link to add
              people.
            </p>
          )}
          <ul className="people-list">
            {data.people.map((p) => (
              <li key={p.id}>
                <span className="people-avatar">
                  <Avatar user={p} size={30} />
                  {hereIds.has(p.id) && (
                    <span className="here-dot" title="On the board now" />
                  )}
                </span>
                <span className="people-name">
                  {p.name}
                  {hereIds.has(p.id) && (
                    <span className="muted"> · here now</span>
                  )}
                </span>
                {isOwner && p.role !== "owner" ? (
                  <span className="people-actions">
                    <select
                      aria-label={`${p.name}'s role`}
                      value={p.role}
                      disabled={busy}
                      onChange={(e) => {
                        const role = e.target.value as "edit" | "view";
                        run(
                          () =>
                            api(`/api/boards/${boardId}/members/${p.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ role }),
                            }),
                          `${p.name} ${role === "edit" ? "can edit" : "can view"} now`,
                          (d) => ({
                            ...d,
                            people: d.people.map((x) =>
                              x.id === p.id ? { ...x, role } : x,
                            ),
                          }),
                        );
                      }}
                    >
                      <option value="edit">Can edit</option>
                      <option value="view">Can view</option>
                    </select>
                    <button
                      type="button"
                      className="text-link danger-link"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            api(`/api/boards/${boardId}/members/${p.id}`, {
                              method: "DELETE",
                            }),
                          `${p.name} was removed`,
                        )
                      }
                    >
                      Remove
                    </button>
                  </span>
                ) : (
                  <span className="muted people-role">
                    {ROLE_LABEL[p.role]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RewardsTab({
  session,
  say,
}: {
  session: Session;
  say: (message: string) => void;
}) {
  const [data, setData] = useState<{
    url: string | null;
    joined: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!session.user) return;
    api<{ url: string | null; joined: number }>("/api/referral").then(
      setData,
      (e: Error) => setError(e.message),
    );
  }, [session.user]);

  if (!session.user)
    return <p className="dialog-note">Sign in to get your invite link.</p>;
  if (error) return <p className="dialog-note dash-error">{error}</p>;
  if (!data) return <p className="dialog-note">Loading…</p>;
  const url = data.url ?? "";
  const text = "I draw security and system flows in Flowyard. Try it:";

  return (
    <div className="share-body">
      <section className="share-section">
        <h3>Invite people to Flowyard</h3>
        <p className="share-help">
          Share your personal link. When someone opens it and creates an
          account, they count as your invite.
        </p>
        <div className="reward-count">
          <strong>{data.joined}</strong>
          <span>
            {data.joined === 1 ? "person has" : "people have"} joined with your
            link
          </span>
        </div>
        <div className="share-row">
          <input
            readOnly
            value={url}
            aria-label="Your invite link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="primary-btn"
            disabled={!url}
            onClick={async () =>
              say(
                (await copyText(url))
                  ? "Your invite link was copied"
                  : "Select the link and copy it",
              )
            }
          >
            Copy
          </button>
        </div>
        <div className="share-social" aria-label="Share your link">
          <a
            className="ghost-btn"
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Post on X
          </a>
          <a
            className="ghost-btn"
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            LinkedIn
          </a>
          <a
            className="ghost-btn"
            href={`mailto:?subject=${encodeURIComponent("Try Flowyard")}&body=${encodeURIComponent(`${text}\n\n${url}\n`)}`}
          >
            Email
          </a>
        </div>
      </section>
      <p className="reward-note">
        <strong>Rewards aren't live yet.</strong> They'll arrive with paid
        plans. Until then, this page keeps count of who joined with your link.
      </p>
    </div>
  );
}
