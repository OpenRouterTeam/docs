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
- **cfw-internal**: `.dev.vars` is written by `services/cfw-internal/scripts/dev.ts` on first run and persists — so you can bypass Infisical entirely: from `services/cfw-internal`, run `node node_modules/.bin/wrangler dev --test-scheduled --port 8794 --inspector-port 9229 --persist-to ../../.wrangler/shared-state --minify=false`.
- **mission-control**: `projects/mission-control/scripts/dev.ts` shells out to bare `next` and may fail with "next: command not found" outside turbo; run Next directly instead: from `projects/mission-control`, `infisical run --token ... --path=/projects/mission-control ... -- ./node_modules/.bin/next dev --port 3001 --turbo`.
- Caution: `pkill -f "tsx scripts/dev.ts"` matches EVERY service's dev script and tears down the whole dev-multi tree. Kill by exact PID.
- Killing wrangler's `workerd` child while wrangler is SIGSTOPped simulates a backend outage; wrangler does not reliably respawn it afterward — restart wrangler as above.

## Demo Hub (admin-utils/demo-hub) against production openrouter.ai
- The demo API routes call `https://openrouter.ai/api/v1` with `OPENROUTER_API_KEY`. The Infisical dev env sets a dev-only key that fails with 401 `User not found` in prod, and `infisical run` injects it after your shell export. Override *after* Infisical: `infisical run ... -- env OPENROUTER_API_KEY="$ORG_KEY" ./node_modules/.bin/next dev --port 3001`.

## Admin auth & gating
- Local admin gating reads `users.is_admin` for the Clerk user. Toggle with:
  `docker exec openrouter-web_db psql -U postgres -d postgres -c "UPDATE users SET is_admin=<bool> WHERE clerk_user_id='...'"` then reload — admin pages use `notFound()` (404) for non-admins.
- If `window.Clerk.user` is null but a session exists in `window.Clerk.client.sessions`, call `window.Clerk.setActive({session})` and navigate.

## Model/endpoint edit pages
- Model edit route is `/model/edit/<maker>/<permaslug>` and needs the **dated permaslug** (e.g. `tencent/hy4-preview-20260827`), not the human slug (`tencent/hy4-preview`) — the human slug renders a permanent skeleton/loading state with no error. Look up a valid one: `docker exec openrouter-web_db psql -U postgres -d postgres -c "SELECT permaslug FROM models LIMIT 5"`. Endpoint edit is `/endpoint/edit/<endpoint uuid>` (`SELECT id FROM endpoints LIMIT 5`).
- Fresh DBs have zero models — run `bun run db:seed` first (~1k models, ~4.7k endpoints).

## Seeding lifecycle/changelog data (ecosystem-monitors page)
- Data comes from `models_changelog` / `endpoints_changelog` (columns: `operation_type`, `old_data`, `new_data`, `changes` jsonb, `editor` FK → users.clerk_user_id).
- A "deprecation" only counts when `operation_type IN ('INSERT','UPDATE')` AND `changes->'deprecation_date'` transitions null→non-null (see `packages/db/changelog/lifecycle-sql.ts`, `isDeprecationTransitionExpr`). DELETE rows and old→new date edits do NOT count — verify expectations with that exact predicate before asserting UI counts.
- Easy way to add deterministic rows: copy an existing qualifying row with shifted `created_at` via `INSERT ... SELECT ... now() - interval 'X days' ...`.
- `bun run db:seed` triggers generate hundreds of INSERT changelog rows dated at seed time; counts drift as dev services write more rows — don't assert exact totals for trigger-generated data.

## Admin-utils pages (live-config, credit-expiration)
- `/admin-utils/credit-expiration` renders Past Runs from `credit_expiration_runs`; a fresh DB shows an empty table, so insert a couple of rows (one `Completed`, one older) before exercising run selection.
- Dry runs started locally end in `Failed`: the Cloudflare workflow/KV bindings (`CF_KV_API_TOKEN`) are absent in dev. The started run's id, its in-flight card, and the URL marker are still fully observable — only completion is not.

## Inference-anomaly page
- `app/inference-anomaly/actions.ts` reads `OPENROUTER_API_KEY` first and `PLAYGROUND_OPENROUTER_API_KEY` second. The dev-env `OPENROUTER_API_KEY` in Infisical can be a dead key (401 from `GET https://openrouter.ai/api/v1/key`); check it before running probes, and start MC with `OPENROUTER_API_KEY=` (empty) to fall through to the playground key.
- Pinned probes call `GET /generation?id=` after each completion. To see upstream traffic without printing keys, set `OPENROUTER_BASE_URL` to a local logging proxy that forwards to `https://openrouter.ai/api/v1`.
## MC API routes (demo-hub, oidc-test, provider fetch-models)
- Switching MC between worktrees: dump the running Next process env (`cat /proc/<pid>/environ | tr '\0' '\n'`) before killing it, then re-export it for `./node_modules/.bin/next dev --port 3001 --turbo` in the new worktree — avoids re-running Infisical.
- `GET /api/oidc-test` can be opened directly in the admin browser tab; locally with cfw-internal on :8794 it returns `{"ok":true}`, so the 502 malformed-body branch is not reachable without stubbing the upstream.
- `/provider/<permaslug>` → "Fetch Models" calls `/api/provider/<name>/fetch-models` and opens the decoded JSON in a new tab; every provider monitor sends an Authorization header, so pick one whose `*_API_KEY` is in the MC env (Together/Mistral/DeepInfra were present). Unknown name → JSON 404.
- Demo Hub Fusion with the env `OPENROUTER_API_KEY` against the local API base may return 401 "User not found." — still a valid error-envelope path (extra.fusionResult/synthesis null); a success run needs a key for a user that exists in the local DB.

## Devin Secrets Needed
- `INFISICAL_CLIENT`, `INFISICAL_SECRET` (org secrets; use qualified refs `secret:org:INFISICAL_CLIENT` in exec env).
