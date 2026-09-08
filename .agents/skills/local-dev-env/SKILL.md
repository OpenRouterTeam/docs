---
name: local-dev-env
description: >-
  Bring up a working local OpenRouter (web + inference + DB + a funded
  Clerk session). Use when the user wants to test locally, run the
  playground, generate images/chat, or "just start the stack".
user-invocable: true
---

# Local Dev Env

A working local copy is Docker + the stack + a signed-in Clerk user with credits. Prod login / prod credits do not apply here.

## Cookbook

**Full stack** — usually the right call if you want the site to actually generate:

```bash
docker info >/dev/null || echo "start Docker / OrbStack first"
# secrets: on your own machine, `infisical login` once. On a cloud box
# (Devin, CI, …), export INFISICAL_TOKEN from INFISICAL_CLIENT /
# INFISICAL_SECRET — see AGENTS.md.
bun install
tilt up
```

`tilt up` owns the DB lifecycle — the `postgres`, `postgres-migrate` and `postgres-seed` resources run `db:start` / `db:migrate` / `db:seed` for you. Don't run those by hand first. `bun run dev:doctor` is a diagnostic for an already-started stack; on a cold box it just reports Postgres unreachable.

Wait for `web`, `api`, `api-kv-cron`, plus the modality worker for what you're testing. Ready check: `curl -sf localhost:3000 >/dev/null && curl -sf localhost:8787/health`.

**Smaller slice** when you don't need Tilt:

```bash
bun run db:start && bun run db:seed
bun run dev web cfw-api
```

Add modality workers (`cfw-image-api`, `cfw-embeddings-api` on `:8789`, …) as needed. Pass the Turbo package name with the `cfw-` prefix: `bun run dev embeddings-api dev-fs-logs` silently starts only `dev-fs-logs`.

**Sign in** — `dev+clerk_test@openrouter.ai`, then "Use another method" → "Email code" (the widget offers a magic link first), code `424242`. Shared dev-tenant account, seeded with credits, no password or real inbox needed. Google SSO with your own `@openrouter.ai` email also works.

**Admin** — put your `clerk_user_id` in `.env.development.local` as `DEV_ADMIN_CLERK_USER_ID` and `bun run db:reset`. `SELECT clerk_user_id, email FROM users`.

## Common problems

**Parallel workers collide on the inspector port** — if standalone `cfw-api`
fails with `EADDRINUSE` on `127.0.0.1:9229`, start it with a free
`WRANGLER_INSPECTOR_PORT` (for example `9234`) rather than killing another
worktree's process.

**Health is not model-data readiness** — before recording a chat test, open
`/chat` → Add Model and confirm remote models appear. Empty preset cards and
only local Gemini Nano in the picker do not prove inference is ready, even
when `/health` and a scheduled warm both return successfully.

**`auth` never starts** — only start `auth` if you're explicitly testing BYOK; a normal chat/image generation doesn't need it. If you do need it, trigger `valkey` first (`tilt trigger valkey && tilt trigger auth`) — both are manual and `auth` depends on it.

**`bun run dev cfw-api` returns 503 `Router config unavailable: could not be read from KV`** — the KV warmer (`warmKVModelsAndEndpoints`) queries ClickHouse for endpoint perf percentiles and fails closed when `:8123` is down, so no models load. `bun run dev` alone does not start ClickHouse: run `docker compose -f packages/clickhouse/docker-compose.yaml up -d && (cd packages/clickhouse && bun run ch:migrate)`, then re-trigger the cron with `curl "localhost:8787/__scheduled?cron=*/5+*+*+*+*"`. Wrangler also does not rebuild on edits to files under `packages/`; restart the dev command to pick up router or instrumentation changes.
**Embeddings return 404 on `:8787`** — `/api/v1/embeddings` is served by the dedicated `embeddings-api` worker on `:8789`, not by `api`. `TILT_PROFILE=lean` does not start it (nor `dev-fs-logs`); run `tilt enable embeddings-api dev-fs-logs && tilt trigger embeddings-api` and read request captures under `services/dev-fs-logs/.logs/default/embeddings/`.

**Playground shows stale model params after a reseed** — `tilt trigger api-kv-cron`, then `tilt trigger web`. For **image** models specifically, the playground controls come from the image-api worker (`:8797/api/v1/images/models/<author>/<slug>/endpoints`), not the page HTML, so check there rather than grepping the rendered page.

## Testing webhooks and negative auth paths locally

**Real Clerk webhooks do reach localhost.** `bun run dev web` starts a `smee`
forwarder (`smee -u https://smee.io/openrouter-web-internal-clerk -t
http://localhost:3000/api/webhooks/clerk`), so genuine signature-verified
`user.created` / `organization.created` / `organizationMembership.created`
deliveries land on the real Next route. Check for `POST
http://localhost:3000/api/webhooks/clerk - 200` in the dev-server stdout before
assuming you must drive `handleClerkEvent` by hand. It is a shared smee channel,
so filter log lines by your own org/user id.

**Deleting a `users` row is blocked by design.** The table has a
`record_user_changelog()` trigger plus several `RESTRICT` FKs
(`users_changelog`, `entity_achievements`, `organization_members`, …), and the
running app re-inserts the row between statements. To simulate a
"missing users row" failure path, bypass triggers and FKs in one shot:

```bash
docker exec openrouter-web_db psql -U postgres -d postgres \
  -c "set session_replication_role = replica; delete from users where clerk_user_id='user_...';"
```

Fire the request immediately afterwards — the app may recreate the row.

**Extra Clerk users / roles for permission tests** — mint them straight from the
Backend API with the dev `sk_test_` key (`infisical secrets get CLERK_SECRET_KEY
--path=/projects/web`): `POST /v1/users`, then `POST
/v1/organizations/<org_id>/memberships` with `{"role":"org:member"}`, then `POST
/v1/sign_in_tokens` and open
`localhost:3000/sign-in#/?__clerk_ticket=<token>`. Type the ticket
programmatically — a hand-retyped JWT that drops one character fails with "This
ticket is invalid." Clerk auto-activates the org when the user's only membership
is that org, which is a convenient way to get a non-admin org-scoped session.

Ticket gotchas:

- **Sign-in tokens are single-use.** A ticket consumed by a failed or partial
  navigation leaves you on a signed-out page with no error. Mint a fresh token
  per attempt rather than retrying the same URL.
- **Send the ticket to `/sign-in#/?__clerk_ticket=`, not `/`.** The root route
  does not consume the ticket; it just renders the signed-out home page.
- **Driving a 600-char URL through synthetic keystrokes drops characters.** If
  no clipboard tool (`xclip`/`xsel`) is installed, write a throwaway
  `file:///tmp/x.html` whose `<script>` sets `location.href` to the ticket URL
  and navigate to that short path instead — the JWT is never typed.

**To reach `JoinedOrgWelcome` you need a *personal*-scoped session.** For a user
whose only membership is one org, Clerk auto-activates that org, and
`OnboardingSwitch` skips onboarding entirely for an active org session (no
overlay at all). Switch the account switcher to "Personal" to exercise the
invite-path branch.

**`cf_*` fields are always null locally** — no Cloudflare edge sits in front of
wrangler dev, and `cf_ip_hash` is hardcoded null in
`packages/instrumentation/cf-bot-log-fields.ts`. Do not assert non-null `cf_*`
values locally; assert the keys are present instead, and make `signup_*`
assertions falsifiable by seeding unique marker values on the `users` row first.

**Onboarding overlay only renders for a user with pending onboarding** — a
reused Clerk user has `hasPendingOnboarding` cleared, so `OnboardingSwitch`
renders nothing. Use a fresh user per onboarding run. `OnboardingSwitch` latches
its joined-org-vs-full-flow branch on entry, so an org created mid-flow keeps the
flow mounted and `CompleteStep` fires the completion request with the org active.
Confirm the scope from `organization_id` in the `Onboarding completed` log line
rather than assuming it either way.

## Handy

| | |
|---|---|
| web / api / image / frontend-api / auth | `:3000` / `:8787` / `:8797` / `:8795` / `:8802` |
| embeddings-api | `:8789` |
| postgres | `:54322` |
| secrets | Infisical via `bun run x` / Tilt; overrides in `.env.development.local` |

## Done when

http://localhost:3000 loads, a signed-in generate succeeds, and `localhost:8787/health` is `ok`.
