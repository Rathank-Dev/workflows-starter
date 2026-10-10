# Security

## Reporting a problem

Please report vulnerabilities privately through GitHub: the repository's **Security** tab → **Report a vulnerability**. If you can't use GitHub, email support@flowyard.dev. Don't open a public issue. Include the steps to reproduce and what an attacker could do. You'll get a reply within a few days, and credit in the fix if you'd like it.

## How Flowyard is protected

| Area | What's in place | Where |
| --- | --- | --- |
| Sign-in | OAuth with state and PKCE (Google, Discord); only `returnTo` paths on this site are followed | `worker/auth.ts`, `safeReturnTo` in `worker/http.ts` |
| Sessions | Random token in a `__Host-` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`); only its SHA-256 is stored. Ends 30 days after sign-in or after 7 days unused. Signing out everywhere also closes open board connections | `worker/auth.ts`, `disconnectEverywhere` in `worker/account.ts` |
| Board access | Owner, invited members, or the share link. Link access needs the board's secret key (`?key=`), compared in constant time; the owner can reset it. The id alone opens nothing | `boardAccess` / `linkRole` in `worker/access.ts` |
| Live editing | The Worker checks access, then passes role and identity to the board's Durable Object in headers it sets itself. Edits, comments, and cursors are rate-limited per socket; viewers can't save | `worker/index.ts` (`/ws`), `worker/board-do.ts` |
| Requests | Same-origin check on every non-GET; body size declared and capped before reading; per-IP rate limit on API, auth, and socket routes | `worker/index.ts` |
| Input | Boards, comments, and assistant output are parsed and validated on the server before they're stored or drawn | `shared/board.ts`, `shared/comments.ts`, `worker/ai.ts` |
| Uploads | Walkthrough videos: editors only, first bytes checked, streamed to R2 at the declared length, served with `sandbox` CSP | `worker/recordings.ts` |
| Browser | Strict CSP, `nosniff`, `frame-ancestors 'none'`, HSTS; React escapes all board text, including exports | `public/_headers`, `worker/http.ts` |
| Privacy | Only necessary cookies without consent; shared boards removed from the browser on sign-out | `src/consent.tsx`, `/privacy` |

## Checklist for every change

Copy what applies into the pull request (the template does this).

**Access**
- [ ] Every new route that touches a board calls `boardAccess` with the request's share key (`linkKeyOf`), and checks the role it needs (`canEdit`, owner).
- [ ] Owner-only actions filter on `owner_id = ${user.id}` in the SQL itself, not only in code.
- [ ] Anything that changes who can open a board calls `refreshAccess()` (or `disconnectUser`) so open sockets are checked again.
- [ ] New secrets (keys, tokens) come from `randomHex`/`randomToken`, are compared with `sameSecret`, and are only sent to people who should hold them.

**Input and output**
- [ ] SQL uses the `sql\`…\`` tag with `${values}`, never string building.
- [ ] Request bodies and query values are validated (type, length, pattern) before use; IDs match their regex.
- [ ] No `dangerouslySetInnerHTML`, no building HTML or SVG strings from user text.
- [ ] Error messages don't reveal other people's data, provider details, or stack traces.

**Sessions and cookies**
- [ ] New cookies use `setCookie` (`__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`) and are listed on `/privacy`.
- [ ] Cookies that aren't strictly necessary wait for consent (`src/consent.tsx`).
- [ ] New browser storage is listed on `/privacy`; anything from a shared board is cleared by `forgetSharedBoards`.

**Abuse and cost**
- [ ] New endpoints sit behind the request rate limit, and anything expensive (AI, uploads, fan-out to sockets) has its own limit.
- [ ] Sizes are capped: bodies, documents, lists, uploads.

**Data and deploys**
- [ ] Schema changes go in `db/schema.sql`, are idempotent, and work with the code that's live now (defaults, nullable columns), because the migration runs before the deploy.
- [ ] Secrets are set with `wrangler secret put`, never committed. `.dev.vars` stays untracked.
- [ ] New dependencies are needed, maintained, and pass `npm audit`.

**Tests**
- [ ] A test proves the protection: the denied case, not only the allowed one. For a bug fix, the test fails without the fix.

## Workflow

1. **Branch** from `main`. Never push to `main`; merging deploys to production (Workers Builds).
2. **Build** with the checklist above in mind. Add tests next to the existing ones in `test/`.
3. **Check locally:** `npm run lint`, `npx tsc -b`, `npm test`, `npm run build`, `npm audit`.
4. **Open a pull request.** CI runs the same checks plus `npm audit --audit-level=high`; the template asks for the checklist and how you tested.
5. **Review:** a second person (or a review pass) reads the diff for the checklist items, especially access checks and anything that sends secrets to the client.
6. **Migrate first:** if `db/schema.sql` changed, run `npm run db:migrate` against production before merging.
7. **Merge, then verify** on https://flowyard.khmersec.workers.dev: the Workers Builds check is green, and the changed flow works for an owner, a member, a link visitor, and a signed-out visitor.
8. **Keep up:** Dependabot opens weekly update PRs; merge them when CI passes. Re-run a full security review after large features.
