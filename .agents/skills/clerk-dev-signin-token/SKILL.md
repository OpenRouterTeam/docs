---
name: clerk-dev-signin-token
description: Headless login to the local dev web app (localhost:3000) using Clerk Backend API sign-in tokens (ticket strategy). Use when an agent session needs an authenticated browser session on local dev — avoids the shared password account and email-code flows entirely, so concurrent sessions never trip Clerk account lockouts. Dev Clerk instance only; not for production.
---

# Clerk Dev Sign-In Token Login

Log into the local dev web app without a password or email code by
minting a one-time sign-in token with the dev Clerk secret key and
consuming it in the browser via the `ticket` strategy. Each session
gets its own throwaway `+clerk_test` user, so any number of concurrent
agent sessions can log in without contention or lockouts.

**Dev instance only.** The script refuses to run unless
`CLERK_SECRET_KEY` is an `sk_test_` key.

## 1. Mint a user + ticket

Requires the web dev server running (`bun run dev web`) and Infisical
machine-identity auth (see `tilt-testing` skill, Section 7):

```bash
cd /path/to/openrouter-web
export INFISICAL_TOKEN=$(infisical login --method=universal-auth \
  --client-id="$INFISICAL_CLIENT" --client-secret="$INFISICAL_SECRET" \
  --silent --plain)
export TICKET_FILE=$(mktemp -t clerk-ticket.XXXXXX.json)  # per-invocation, 0600 perms
trap 'rm -f "$TICKET_FILE"' EXIT  # every exit path removes the ticket
infisical run --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 \
  --env=dev --path=/projects/web -- \
  bun scripts/clerk-dev-signin-token.ts > "$TICKET_FILE"
```

Output: `{ user_id, email, ticket }`. By default it reuses one
deterministic `devin+clerk_test_<machine-id>@openrouter.ai` user per
machine, keyed on `/etc/machine-id` so distinct agent VMs get distinct
users even when they share a hostname. Reuse rather than minting per run
keeps the shared tenant browsable. Flags:

- `--email <email>` — reuse a specific account (e.g. the one that
  owns seeded data or an admin grant).
- `--fresh` — force a new throwaway user when isolation matters.
- `--cleanup` — delete `devin+clerk_test_*` users with no activity
  (sign-in or creation) in the last day, instead of minting a token.
  Every mint also runs this cleanup best-effort (logged to stderr),
  so the generated population self-prunes without extra invocations.

Tokens are single-use and expire after 10 minutes.

## 2. Consume the ticket in the browser

```bash
agent-browser connect 29229
agent-browser open http://localhost:3000
TICKET=$(python3 -c "import json,os;print(json.load(open(os.environ['TICKET_FILE']))['ticket'])")
agent-browser eval "(async () => {
  const res = await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket: '$TICKET' });
  if (res.status === 'complete') {
    await window.Clerk.setActive({ session: res.createdSessionId });
    return 'signed-in:' + window.Clerk.user?.id;
  }
  return 'status:' + res.status;
})()"
```

If the browser is already signed in as another user, run
`agent-browser eval "window.Clerk.signOut()"` first.

Expect `signed-in:user_...`, then `rm -f "$TICKET_FILE"` (the EXIT trap
also covers crashed/interrupted runs, but don't leave a still-valid
ticket lying around longer than needed). Reload any page and the
session is active. A brand-new user lands on the onboarding flow first — click
through "Individual" to provision the workspace + API key.

If `signIn.create` reports `session_exists` while `window.Clerk.user` is
null, inspect `window.Clerk.client.sessions` and call
`window.Clerk.setActive({ session: <active-session-id> })` before reloading.

`agent-browser eval` of an awaited IIFE can return `CDP error: Promise was
collected`, or look like it never settles, even when the sign-in already
succeeded. Kick the call off without awaiting it inside the eval (store the
outcome on a `window.__*` global, read that global in a follow-up eval), and
check `window.Clerk.client.sessions` before retrying — retrying against an
already-created session fails with "Session already exists".

## Notes

- If the script exits with the `CLERK_SECRET_KEY missing` error and you
  cannot get Infisical access to `/projects/web`, fall back to signing in
  as `dev+clerk_test@openrouter.ai` with the email code `424242`.
- Admin gate: after login, grant admin in local Postgres keyed to the
  printed `user_id` (see `setup-quality-tournament-env` skill).
- Mission control (`bun run dev mission-control`, localhost:3001) shares the
  dev Clerk tenant, so mint the ticket the same way and consume it on
  `http://localhost:3001`. Its pages also need a `users` row for the minted
  `clerk_user_id` — without one, API routes 401 with "User not found". Note
  `bun run db:reset` drops that row, so re-insert it after reseeding. For
  organization-scoped sessions, also insert the Clerk organization ID as an
  `is_organization` row. With Postgres down entirely
  (`ECONNREFUSED 127.0.0.1:54322`) pages redirect-loop into
  `ERR_TOO_MANY_REDIRECTS`, so run `bun run db:start` first. Admin is the
  `users.is_admin` column.
- Chatroom (`localhost:3000/chat`) requests from a freshly minted user fail
  with "Insufficient credits" — insert a `credits` row for the minted
  `clerk_user_id` (`INSERT INTO credits (created_at, amount, clerk_user_id,
  note) VALUES (now(), 100, '<user_id>', 'local dev testing')`).
- Mission control's dev `CLICKHOUSE_URL` points at a local ClickHouse; for
  pages that read real analytics, override `CLICKHOUSE_*` in the root
  `.env.development.local` with read-only cluster credentials instead of
  seeding locally.
  If `bun run dev mission-control` re-injects the local value, launch
  `next dev --port 3001 --turbo` directly under the Infisical environment
  with the read-only `CLICKHOUSE_*` overrides.
- Settings pages that read `/api/frontend/v1/private/*` (e.g.
  `/settings/notifications`) 404 with `bun run dev web` alone — start
  `bun run dev web cfw-frontend-api` so the worker serves those routes.
- Do not use this for `openrouter.ai` / the prod Clerk tenant; use the
  `/tests/e2e` credentials there.
- Simplest manual login: `dev+clerk_test@openrouter.ai`, email code
  `424242`. Seeded with credits, no password. Prefer this skill's tokens
  when a session needs its own isolated user.
- The legacy `$CLERK_DEV_USERNAME_PASSWORD` password flow still works
  for one-off manual logins, but prefer this skill for agent sessions
  to avoid lockouts on the shared account.
- Works for Mission Control (localhost:3001) too: mint with
  `--path=/projects/mission-control` instead of `/projects/web` (same
  script), consume the ticket on `http://localhost:3001/` (the root —
  `/sign-in` redirect-loops in the dev server), then grant admin the
  same way (Mission Control gates on `users.is_admin` in local
  Postgres; `bun run db:start` if the container is
  stopped, and wait ~60s for the is-admin cache).
- If Mission Control pages keep failing with "User not found" even
  though the `users` row exists, check `window.Clerk.organization` — a
  session activated into a Clerk organization looks up the org's entity
  id, not the user's. Switch to the personal account with
  `window.Clerk.setActive({ session: <session-id>, organization: null })`
  and reload.
