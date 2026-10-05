-- Flowyard schema. Safe to run repeatedly: `npm run db:migrate`.

create table if not exists users (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	email text,
	avatar_url text,
	created_at timestamptz not null default now()
);

-- One row per sign-in method. Accounts are never linked by email, so an
-- unverified email at one provider can't take over an account from another.
create table if not exists oauth_accounts (
	provider text not null check (provider in ('github', 'google', 'discord')),
	provider_user_id text not null,
	user_id uuid not null references users (id) on delete cascade,
	created_at timestamptz not null default now(),
	primary key (provider, provider_user_id)
);

-- id is the SHA-256 of the session token; the token itself only lives in the cookie.
create table if not exists sessions (
	id text primary key,
	user_id uuid not null references users (id) on delete cascade,
	expires_at timestamptz not null,
	created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);

-- Shared boards. Content lives in the board's Durable Object; this is the registry.
create table if not exists boards (
	id text primary key,
	owner_id uuid not null references users (id) on delete cascade,
	name text not null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);
create index if not exists boards_owner_idx on boards (owner_id, updated_at desc);

create table if not exists ai_usage (
	user_id uuid not null references users (id) on delete cascade,
	day date not null,
	requests integer not null default 0,
	primary key (user_id, day)
);

-- Per-network daily assistant count, so extra accounts on one network don't
-- multiply the quota. ip_key is a salted SHA-256 of the client IP, never the IP.
create table if not exists ai_ip_usage (
	ip_key text not null,
	day date not null,
	requests integer not null default 0,
	primary key (ip_key, day)
);

-- Dashboard: trash (restorable for 30 days), per-person stars and recent visits.
alter table boards add column if not exists deleted_at timestamptz;

create table if not exists board_visits (
	user_id uuid not null references users (id) on delete cascade,
	board_id text not null references boards (id) on delete cascade,
	last_opened_at timestamptz not null default now(),
	primary key (user_id, board_id)
);
create index if not exists board_visits_user_idx on board_visits (user_id, last_opened_at desc);

create table if not exists board_stars (
	user_id uuid not null references users (id) on delete cascade,
	board_id text not null references boards (id) on delete cascade,
	created_at timestamptz not null default now(),
	primary key (user_id, board_id)
);

-- 30-day account deletion: requesting it ends sessions and trashes the user's
-- boards (flagged so they can be restored); signing in again cancels it; a
-- daily job deletes accounts whose 30 days have passed.
alter table users add column if not exists deletion_requested_at timestamptz;
alter table boards add column if not exists trashed_with_account boolean not null default false;

-- Sharing. link_access is what "anyone with the link" can do; members (added
-- through an invite link) keep their role even when the link is locked down.
alter table boards add column if not exists link_access text not null default 'edit';
do $$ begin
	alter table boards add constraint boards_link_access_check check (link_access in ('edit', 'view', 'none'));
exception when duplicate_object then null; end $$;
-- One invite link per board; resetting it makes the old one stop working.
alter table boards add column if not exists invite_token text;
alter table boards add column if not exists invite_role text not null default 'edit';
do $$ begin
	alter table boards add constraint boards_invite_role_check check (invite_role in ('edit', 'view'));
exception when duplicate_object then null; end $$;

create table if not exists board_members (
	board_id text not null references boards (id) on delete cascade,
	user_id uuid not null references users (id) on delete cascade,
	role text not null check (role in ('edit', 'view')),
	added_at timestamptz not null default now(),
	primary key (board_id, user_id)
);
create index if not exists board_members_user_idx on board_members (user_id);

-- Video walkthroughs. The video lives in R2 at recordings/<board_id>/<id>.
create table if not exists recordings (
	id text primary key,
	board_id text not null references boards (id) on delete cascade,
	user_id uuid not null references users (id) on delete cascade,
	title text not null,
	duration_ms integer not null,
	bytes integer not null,
	content_type text not null,
	created_at timestamptz not null default now()
);
create index if not exists recordings_board_idx on recordings (board_id, created_at desc);
create index if not exists recordings_user_idx on recordings (user_id);

-- Invite rewards: each person's referral code, and who invited whom.
alter table users add column if not exists referral_code text unique;
alter table users add column if not exists referred_by uuid references users (id) on delete set null;
