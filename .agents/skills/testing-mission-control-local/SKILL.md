---
name: testing-mission-control-local
description: Run and test Mission Control (projects/mission-control) end-to-end on the local dev stack — Postgres, cfw-internal, Clerk admin login, seeding changelog data, and restarting individual services without dev-multi.
---

# Testing Mission Control locally

## Stack
- `bun run db:start && bun run db:migrate` (Postgres on 127.0.0.1:54322, Docker container `openrouter-web_db`).
- `bun run dev mission-control cfw-internal web` starts MC (:3001), cfw-internal (:8794), web (:3000). All dev scripts require Infisical env injection.
- Infisical universal auth: `INFISICAL_TOKEN=$(infisical login --method=universal-auth --client-id="$INFISICAL_CLIENT" --client-secret="$INFISICAL_SECRET" --plain --silent)`, then `infisical run --token "$INFISICAL_TOKEN" --env=dev --path=<service path> --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 -- <cmd>`.

## Restarting a single crashed service (without restarting dev-multi)
- **cfw-internal**: `.dev.vars` is written by its `scripts/dev.ts` on first run and persists — so you can bypass Infisical entirely: from `services/cfw-internal`, run `node node_modules/.bin/wrangler dev --test-scheduled --port 8794 --inspector-port 9229 --persist-to ../../.wrangler/shared-state --minify=false`.
- **mission-control**: its `scripts/dev.ts` shells out to bare `next` and may fail with "next: command not found" outside turbo; run Next directly instead: from `projects/mission-control`, `infisical run --token ... --path=/projects/mission-control ... -- ./node_modules/.bin/next dev --port 3001 --turbo`.
- Caution: `pkill -f "tsx scripts/dev.ts"` matches EVERY service's dev script and tears down the whole dev-multi tree. Kill by exact PID.
- Killing wrangler's `workerd` child while wrangler is SIGSTOPped simulates a backend outage; wrangler does not reliably respawn it afterward — restart wrangler as above.

## Admin auth & gating
- Local admin gating reads `users.is_admin` for the Clerk user. Toggle with:
  `docker exec openrouter-web_db psql -U postgres -d postgres -c "UPDATE users SET is_admin=<bool> WHERE clerk_user_id='...'"` then reload — admin pages use `notFound()` (404) for non-admins.
- If `window.Clerk.user` is null but a session exists in `window.Clerk.client.sessions`, call `window.Clerk.setActive({session})` and navigate.

## Seeding lifecycle/changelog data (ecosystem-monitors page)
- Data comes from `models_changelog` / `endpoints_changelog` (columns: `operation_type`, `old_data`, `new_data`, `changes` jsonb, `editor` FK → users.clerk_user_id).
- A "deprecation" only counts when `operation_type IN ('INSERT','UPDATE')` AND `changes->'deprecation_date'` transitions null→non-null (see `packages/db/changelog/lifecycle-sql.ts`, `isDeprecationTransitionExpr`). DELETE rows and old→new date edits do NOT count — verify expectations with that exact predicate before asserting UI counts.
- Easy way to add deterministic rows: copy an existing qualifying row with shifted `created_at` via `INSERT ... SELECT ... now() - interval 'X days' ...`.
- `bun run db:seed` triggers generate hundreds of INSERT changelog rows dated at seed time; counts drift as dev services write more rows — don't assert exact totals for trigger-generated data.

## Devin Secrets Needed
- `INFISICAL_CLIENT`, `INFISICAL_SECRET` (org secrets; use qualified refs `secret:org:INFISICAL_CLIENT` in exec env).
