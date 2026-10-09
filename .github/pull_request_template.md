## What changed and why

<!-- One or two sentences. Link the issue if there is one. -->

## How it was tested

<!-- Commands run, and what you checked by hand (owner, member, link visitor, signed out). -->

## Security checklist

See [SECURITY.md](../SECURITY.md#checklist-for-every-change). Tick what applies; delete the rest.

- [ ] Board routes call `boardAccess` with `linkKeyOf(request)` and check the role they need
- [ ] Owner-only SQL filters on `owner_id`
- [ ] Access changes call `refreshAccess()` / `disconnectUser`
- [ ] Secrets are random, compared with `sameSecret`, and sent only to people who should hold them
- [ ] SQL uses the `sql` tag; input is validated; no raw HTML from user text
- [ ] New cookies use `setCookie`, wait for consent if optional, and are listed on `/privacy`
- [ ] New endpoints are rate-limited and size-capped
- [ ] Schema changes are idempotent and safe to run before the deploy
- [ ] No secrets committed
- [ ] A test covers the denied case (and fails without the fix, for bug fixes)

## Deploy

- [ ] No migration needed / `npm run db:migrate` run against production before merging
