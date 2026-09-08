---
name: testing-mission-control-local
description: Run and test Mission Control (projects/mission-control) end-to-end on the local dev stack — Postgres, cfw-internal, Clerk admin login, seeding changelog data, and restarting individual services without dev-multi.
---

# Testing Mission Control locally

## Stack
- `bun run db:start && bun run db:migrate` (Postgres on 127.0.0.1:54322, Docker container `openrouter-web_db`).
- `bun run dev mission-control cfw-internal web` starts MC (:3001), cfw-internal (:8794), web (:3000). All dev scripts require Infisical env injection.
- Infisical universal auth: `INFISICAL_TOKEN=$(infisical login --method=universal-auth --client-id="$INFISICAL_CLIENT" --client-secret="$INFISICAL_SECRET" --plain --silent)`, then `infisical run --token "$INFISICAL_TOKEN" --env=dev --path=<service path> --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 -- <cmd>`.
- For cfw-internal, use Infisical path `/services/cfw-internal-api`, not the directory name `/services/cfw-internal`; check `services/cfw-internal/package.json` (`x` script) for the current path before starting it.
- `/user/<clerk-user-id>` and `/organization/<org-id>` 500 as a whole page (not just one card) unless `usage-record` (:8801) is up, because `getUserDataSA` fetches join analytics from it. Start the Spanner emulator (`bun run spanner:start`), run `services/usage-record/scripts/dev-spanner-init.ts` under `infisical run --path=/services/usage-record`, then `services/usage-record/scripts/dev.ts` with `WRANGLER_INSPECTOR_PORT=9230` (9229 collides with cfw-internal).

## Restarting a single crashed service (without restarting dev-multi)
- **cfw-internal**: `.dev.vars` is written by `services/cfw-internal/scripts/dev.ts` on first run and persists — so you can bypass Infisical entirely: from `services/cfw-internal`, run `node node_modules/.bin/wrangler dev --test-scheduled --port 8794 --inspector-port 9229 --persist-to ../../.wrangler/shared-state --minify=false`.
- **mission-control**: `projects/mission-control/scripts/dev.ts` shells out to bare `next` and may fail with "next: command not found" outside turbo; run Next directly instead: from `projects/mission-control`, `infisical run --token ... --path=/projects/mission-control ... -- ./node_modules/.bin/next dev --port 3001 --turbo`.
- Caution: `pkill -f "tsx scripts/dev.ts"` matches EVERY service's dev script and tears down the whole dev-multi tree. Kill by exact PID.
- Killing wrangler's `workerd` child while wrangler is SIGSTOPped simulates a backend outage; wrangler does not reliably respawn it afterward — restart wrangler as above.

## Demo Hub (admin-utils/demo-hub) against production openrouter.ai
- The demo API routes call `https://openrouter.ai/api/v1` with `OPENROUTER_API_KEY`. The Infisical dev env sets a dev-only key that fails with 401 `User not found` in prod, and `infisical run` injects it after your shell export. Override *after* Infisical: `infisical run ... -- env OPENROUTER_API_KEY="$ORG_KEY" ./node_modules/.bin/next dev --port 3001`.

## Admin auth & gating
- Use the `clerk-dev-signin-token` skill for dev login. A reused dev user can have MFA enabled: inspect the ticket result's `status` before calling `setActive`; `needs_second_factor` is not a completed login. When isolated test-account creation is permitted, `--fresh` avoids inheriting that user's MFA configuration. Never guess its second-factor code. After activation, wait for `window.Clerk.loaded` and a non-null `window.Clerk.user` before navigating to an admin route.
- Local admin gating reads `users.is_admin` for the Clerk user. Toggle with:
  `docker exec openrouter-web_db psql -U postgres -d postgres -c "UPDATE users SET is_admin=<bool> WHERE clerk_user_id='...'"` then reload — admin pages use `notFound()` (404) for non-admins.
- If `window.Clerk.user` is null but a session exists in `window.Clerk.client.sessions`, call `window.Clerk.setActive({session})` and navigate.

## Model/endpoint edit pages
- Model edit route is `/model/edit/<maker>/<permaslug>` and needs the **dated permaslug** (e.g. `tencent/hy4-preview-20260827`), not the human slug (`tencent/hy4-preview`) — the human slug renders a permanent skeleton/loading state with no error. Look up a valid one: `docker exec openrouter-web_db psql -U postgres -d postgres -c "SELECT permaslug FROM models LIMIT 5"`. Endpoint edit is `/endpoint/edit/<endpoint uuid>` (`SELECT id FROM endpoints LIMIT 5`).
- Fresh DBs have zero models — run `bun run db:seed` first (~1k models, ~4.7k endpoints).
- A long-lived local Postgres can drift behind `postgres/migrations` (symptom: cfw-internal 500s such as `column "source_alert" of relation "ban_candidate_suggestions" does not exist`). `bun run db:migrate` needs an Infisical session; without one, run the installed dbmate directly: `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable" node node_modules/.bun/dbmate@*/node_modules/dbmate/dist/cli.js --migrations-dir postgres/migrations --migrations-table dbmate.schema_migrations --no-dump-schema up`. Never hand-edit the schema.

## Sentinel ban-candidate case detail (`/admin-utils/sentinel/ban-candidates/<id>`)
- For case-scoped Usage or standalone `/admin-utils/sentinel/usage`, seed a **user-type** target with a non-null Clerk user ID and `status='pending_review'` to get a nonempty Awaiting approval cohort; an API-key-only case does not exercise this branch (`packages/db/ban-candidates/queries.ts`). Start/migrate ClickHouse with `bun run ch:start` / `bun run ch:migrate`; an empty analytics response can still verify the explorer shell.
- Account timing needs at least three targets with usable signup timestamps to render comparison charts. A single-user fixture verifies tab navigation and the unavailable state, not populated timing analysis.
- The case page loads three independent sources; if any is down the page can sit on **skeletons forever** with no visible error. Check the MC/cfw-internal logs for the failing dependency before assuming a UI bug.
  - `cfw-internal` (:8794) — case detail/enrichment.
  - `cfw-frontend-api` (:8795) — entity lookup; if it isn't running, the target detail sheet never resolves. Start it with `bun run dev cfw-frontend-api`, or directly from `services/cfw-frontend-api` with `WRANGLER_INSPECTOR_PORT=9245` when :9229 is already taken by another wrangler ("Address already in use (127.0.0.1:9229)").
  - `usage-record` (:8801, `USAGE_RECORD_PORT` in the Tiltfile) — console metrics. Without it cfw-internal logs `Worker "usage-record" not found` on the case metrics endpoint; other panels still render.
  - A `Web endpoints cache not found in KV` warning from cfw-frontend-api is harmless for these pages.
- API-key behavioral evidence (Before/After windows, new models/colos/ASNs, sibling-key comparison) is computed from ClickHouse `generations`, not Postgres. For a local case with real-looking numbers, insert throwaway `generations` rows for the affected key and one sibling key of the same owner, split around the proposed compromise time (post an `INSERT INTO generations ...` statement to the local ClickHouse HTTP port `8123`, authenticating with the local dev ClickHouse user from `.env`), then `TRUNCATE TABLE generations` when done. Unauthenticated HTTP to :8123 fails with `Code: 194 ... REQUIRED_PASSWORD`; the simplest path is inside the container: `docker exec clickhouse-clickhouse-1 sh -c 'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --database "$CLICKHOUSE_DB" -q "..."'`.
- The API-key acknowledgement gate ("I have reviewed this key's behavior") is client-side Zustand state: it resets on navigation to another case, and the case-level `Enact N approved targets` button only appears under the **Approved** stage filter (not Review/All). To test the gate on an awaiting-enactment target, approve it, navigate to another case and back, then check the row's `Enact` button `title`.
- To prove a "one batched read per case" claim, don't trust the Network panel count alone (manual `fetch()` probes and refetches inflate it). Read `performance.getEntriesByType('resource').filter(e => e.name.includes('api-key-evidence'))` right after a hard reload, then again after opening each target sheet and each Review/Enact dialog — a URL whose `target_ids` holds a single id means some component still owns its own per-target `useQuery`.
- The acknowledgement is bound to an evidence fingerprint. Any server-computed request-time field in the evidence (e.g. a `windowUntil = now()`) makes every refetch (dialog mount, mutation invalidation, two query shapes for the same key) produce a new fingerprint and silently untick the box, so an acknowledged key stays blocked with "Key evidence not yet reviewed". If the box unticks itself after clicking Review, compare two fetches of the evidence URL field-by-field before blaming the store.
- The case-level batched read must keep every key target in `target_ids` at every stage, enacted keys included: after enacting one of two keys, the enacted key's sheet must still render evidence and the evidence URL must still carry both ids. Opening a target sheet refetches that target's batch, so expect one extra request per sheet open (same `target_ids`) when counting resource entries.
- Filing from `/admin-utils/revoke-keys` → "File as compromised" is the easiest way to create an `api_key` ban-candidate case locally; it writes `ban_candidate_suggestions` + `ban_candidate_targets` (`target_type='api_key'`, `target_value=<key id>`) and does **not** disable the key. Clean up with `DELETE FROM ban_candidate_targets WHERE target_type='api_key' AND target_value IN (...)`. Note there is no `target_id` column — join on `suggestion_id`/`target_value`.
- Host `psql` is not installed; always go through `docker exec openrouter-web_db psql -U postgres -d postgres -c "..."`.

## Seeding lifecycle/changelog data (ecosystem-monitors page)
- Data comes from `models_changelog` / `endpoints_changelog` (columns: `operation_type`, `old_data`, `new_data`, `changes` jsonb, `editor` FK → users.clerk_user_id).
- A "deprecation" only counts when `operation_type IN ('INSERT','UPDATE')` AND `changes->'deprecation_date'` transitions null→non-null (see `packages/db/changelog/lifecycle-sql.ts`, `isDeprecationTransitionExpr`). DELETE rows and old→new date edits do NOT count — verify expectations with that exact predicate before asserting UI counts.
- Easy way to add deterministic rows: copy an existing qualifying row with shifted `created_at` via `INSERT ... SELECT ... now() - interval 'X days' ...`.
- `bun run db:seed` triggers generate hundreds of INSERT changelog rows dated at seed time; counts drift as dev services write more rows — don't assert exact totals for trigger-generated data.

## Admin-utils pages (live-config, credit-expiration)
- `/admin-utils/credit-expiration` renders Past Runs from `credit_expiration_runs` (kinds `inactivity` and `promo-credits`), not from the generic `workflow_runs` table, which holds no credit-expiration rows until that migration lands. Start real previews to verify persistence; never present seeded completed output as evidence of workflow completion.
- Only the promo-credits start route rejects a concurrent run (409). The inactivity preview route inserts unconditionally, so two Running inactivity previews is expected locally, not a regression. The cron path checks for an active run separately.
- Local preview outcomes depend on the workflow's dependencies, not just the `CF_KV_API_TOKEN` warning. Promo can complete with zero candidates. Inactivity discovery requires ClickHouse and the analytics CDC schema used by `packages/clickhouse/credit-expiration/queries.ts`; a healthy empty ClickHouse server is insufficient, and ordinary migrations may not create `analytics.stg_credits`, `stg_users`, or `stg_plan_tiers`. Inspect Wrangler logs for `Network connection lost` / `Database analytics does not exist` while workflows retry. Empty completed results do not exercise populated tier breakdown or pagination.
- For active-run guard testing, use a fresh tab or reload without selecting a history row. `CreditExpirationDryRunTab.tsx` disables start controls while polling the selected run, which is not proof of server-side admission protection. Verify both rejection text and unchanged database counts.

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

## Bulk refund page (`/admin-utils/bulk-refund`)
- Keep **Dry run** checked for every dispatched run. To exercise the live-run dialog, uncheck it, confirm the entity count in the dialog, click **Cancel**, and recheck Dry run. Prove nothing dispatched by comparing `workflow_runs` row counts before and after.
- Start is `POST /api/v1/internal/bulk-refund/run`, detail is `GET /api/v1/internal/bulk-refund/runs/<uuid>`. Direct probes authenticate with `Authorization: Bearer <ADMIN_API_KEY>` from cfw-internal's `.dev.vars`.
- Before dispatch, verify the signed-in Clerk ID exists in local `users`: Mission Control binds that ID as `requestedBy`, and the worker rejects unknown accounts with HTTP 400. Do not silently insert an account to mask this failure.
- The textarea has two limits: a raw character cap (`MAX_ENTITY_IDS_TEXT_LENGTH` in `app/admin-utils/bulk-refund/form-schema.ts`) and a distinct-ID cap. Probe the raw cap with repeated valid IDs that deduplicate to one, and expect the `Paste at most ...` error with no server-action dispatch.
- Use IDs that match the Clerk regex (`user_`/`org_` plus alphanumerics). A skipped entity in the result proves orchestration only, not refund planning. Check `result.runConfig.dryRun` and that no negative `credits` rows were added.
- A 500 from the server action renders the masked `Error 500 / Internal Server Error` toast, not the action's `failureMessage`. The toast auto-dismisses, so wait for its text before screenshotting.

## User deletion page runtime checks
- `/user/<clerk-id>` also depends on usage-record (:8801) and Spanner for user analytics. If another Wrangler owns inspector :9229, start usage-record with a distinct inspector port, e.g. `node node_modules/.bin/wrangler dev --port 8801 --inspector-port 9231` from its service directory after its dev script has generated `.dev.vars`.
- If deletion buttons remain disabled although `requested_data_deletion=true`, check the Next server-action queue. An unrelated `getRestrictionQualityForUserSA` request can block `getActiveDeletionSA`; inspect ClickHouse readiness and the action ID in `.next/dev/server/server-reference-manifest.json`. Any temporary disabling of that analytics hook must be disclosed and restored; it is not proof the unmodified whole page works.
- Deletion fixtures need both `requested_data_deletion=true` and `deleted=true` to satisfy the Postgres scrub gate. Setting only the first makes the UI say “Deleted” while the scrub retries a gate mismatch.
- cfw-internal local R2 persistence is under `.wrangler/shared-state/v3/r2`. Seed exact live and `_trash/` prefixes plus sibling-prefix decoys in all three bound prompt-log buckets. Verify both task rows (`user_deletion_tasks.request_id` → `user_deletions.id`) and remaining object keys; a success toast proves enqueue, not full completion.
- Local GCS credentials may return 403 for `storage.objects.list` on the prompt-log bucket. Report that separately from successful R2 deletion and do not claim real GCS deletion coverage.
## Gateway benchmark schedules

- `/gateway-benchmarks/schedules/create` needs a catalog model (`models`, with its `model_authors` parent) and a mapping row in `gateway_benchmark_models`. The local catalog is usually empty; insert temporary fixtures, track their IDs, and delete only those afterwards — never edit seed files.
- Keep test schedules disabled and do not click Run Now when testing persistence only.
- Verify nullable array columns with `runner_regions IS NULL` in psql, not a blank cell. To test unknown-value hydration, `UPDATE` only the test schedule, hard-navigate to its `/edit` URL, save through the UI, and re-check the persisted array.
