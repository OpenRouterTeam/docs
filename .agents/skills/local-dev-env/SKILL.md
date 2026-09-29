---
name: local-dev-env
description: Start and test the local OpenRouter stack with Tilt; covers login, service readiness, fixtures, and request tracing.
user-invocable: true
---

# Local development

## Start

From the repository root:

```bash
bun run dev:up
tilt wait --for=condition=Ready uiresource/api uiresource/api-kv-cron uiresource/frontend-api --timeout=300s
tilt get uiresources -o json | jq -r '.items[] | .metadata.name as $name | .status.endpointLinks[]? | "\($name)\t\(.url)"'
```

- `dev:up` handles Infisical authentication, persists a missing local Postgres URL in `.env.development.local` so it survives secret injection, starts and seeds Postgres, starts Tilt, and checks the web server. Existing database overrides are preserved.
- The explicit wait above checks the API and frontend API too.
- Use Tilt's URLs; environment and `.env.worktree` overrides can change ports.
- Memory capacity below 20 GiB selects `lean`; 20 GiB or more selects `full`. Capacity is total host RAM capped by an OS/container memory allowance, never currently free RAM: a busy 64 GiB Mac still selects full. Lean keeps the full service set, starts Mission Control and its internal API on demand, and limits concurrent updates, Next.js heaps, esbuild memory, and ClickHouse. Use `TILT_PROFILE=full bun run dev:up` or `TILT_PROFILE=lean bun run dev:up` to override. Successful lean startup prints the Mission Control commands and a link to this guide.

## Services

Check the resources needed for the test. Many already start automatically; enable and trigger resources that are not running, in dependency order:

```bash
tilt enable <resource>
tilt trigger <resource>
tilt wait --for=condition=Ready uiresource/<resource> --timeout=300s
```

| Test | Additional resources, in order |
| --- | --- |
| BYOK inference | `valkey`, `auth` |
| Mission Control | See [Mission Control](#mission-control) below |
| Public model/pricing API | `public-api` |
| Image, video, embeddings, rerank, speech | The corresponding `image-api`, `video-api`, `embeddings-api`, `rerank-api`, `stt-api`, `tts-api` |
| KV routing | `kv-cache` |
| Notification delivery | `alert-delivery` |
| Request captures | `dev-fs-logs` |
| Persisted usage | `dataflow`, `dataflow-generation-commits`; add `dataflow-async-jobs` for async jobs |
| Local fake upstream | `fake-provider` starts automatically in both profiles |
| Batch API | See [batch-api-testing](../batch-api-testing/SKILL.md#launch) for its resource list and subscription checks |

- Start usage pipelines and confirm their Pub/Sub subscriptions exist before sending requests; earlier messages can be lost.
- Wait on named resources; unstarted manual resources never become Ready.
- After restarting a resource, confirm the new run in its logs: `tilt wait` can still observe the previous Ready state.

## Public catalog visual checks without local workers

For read-only web catalog UI checks, `DEV_USE_PROD_FRONTEND_API=true bun run dev web` uses the supported public production-data proxy in `packages/frontend/middlewares/utils.ts`. Use this only when testing frontend rendering, not local API changes or fixture behavior, and disclose the production-data dependency in the results. `/models` needs no sign-in. Wait for real model cards and modality counts to populate before screenshots, since the heading renders even when catalog requests fail.

Unlike `dev:up`, a direct `bun run dev web` can require explicitly exporting `INFISICAL_TOKEN` from `infisical login --method=universal-auth --client-id="$INFISICAL_CLIENT" --client-secret="$INFISICAL_SECRET" --silent --plain` first. Do not print the token.

The same token export applies when starting `tilt up --stream -- --lite` directly. Confirm Next.js reports its listening origin in `tilt logs web`, since Tilt can mark the resource ready while its Infisical child waits for login. Model detail pages can render public catalog and pricing data while private benchmark and signup-metadata requests fail against the absent local frontend-api worker. Report those failures separately. Lite mode is not coverage of every model-page backend request.

For read-only catalog checks against a production build (`next start`), `DEV_USE_PROD_FRONTEND_API=true` alone does not activate the middleware proxy: `packages/frontend/middlewares/utils.ts` gates it on development mode or `VERCEL_ENV=preview`. Set `VERCEL_ENV=preview` and confirm an anonymous `/api/frontend/v1/author-models?authorSlug=openai` returns 200 before testing client hydration or refetch behavior. This setup is not evidence for authenticated local-worker flows.

## Authenticated production-build browser checks

For hydration races that do not reproduce under `next dev`, reuse `startLocalWebServer` from `tests/web-e2e/scripts/local-web-server.ts` with the local Tilt workers, a stable `baseUrl`, and a free `nextPort`. Export the universal-auth `INFISICAL_TOKEN` first; otherwise the build child can wait for interactive login. The helper builds with `NODE_ENV=production` after Infisical injection and serves through the local edge proxy. Stop any existing dev process before building because dev and production share `.next`; if an existing edge proxy prevents a forced rebuild, stop its owning launcher first. Check `.next/BUILD_ID` and `.next/route-smoke-built-head` before calling a recording production-build evidence. Apply CPU/network throttling before navigation and capture console/page errors separately from ordinary loading placeholders; settled screenshots alone cannot prove a transient hydration fix.

## Sign in

Sign in with a [Clerk sign-in ticket](../clerk-dev-signin-token/SKILL.md) for the seeded `dev+clerk_test@openrouter.ai` account, which has credits. Select **Personal** unless the test uses a locally synced organization. [Isolated users](references/isolated_users.md) are an optional path for auth and onboarding tests.

Use the `/sign-in` form only when a ticket cannot be minted. Enter `dev+clerk_test@openrouter.ai` → **Use another method** → **Email code** → `424242`. Each form submission emails a magic link to a shared inbox, so do not retry the form once signed in.

## Mission Control

When starting Mission Control services individually rather than through Tilt, also run `frontend-api` for shared current-user reads and `usage-record` for the user-detail overview. An authenticated `/user/<id>` showing `Error: Internal Server Error` with `getUserDataSA` / `getPendingJobSummarySA` logging `ECONNREFUSED ...:8801` means the usage-record dependency is unavailable; check its Spanner and Pub/Sub readiness before testing user management. See [credits and reverification checks](references/credits_reverification.md) for that dependency's local setup.

User-detail background reads also need ClickHouse. Start its Compose resource and run `bun run ch:migrate` from `packages/clickhouse`. Application migrations may not provision analytics marts such as `analytics.mart_restriction_quality_signals`; inspect worker logs for missing tables rather than assuming a healthy database is sufficient. For local fixtures, `setupRestrictionQualityTables` in `packages/clickhouse/integration/restriction-quality/fixtures.ts` provides the DDL for both the user-signals and organization-rollup marts; empty tables suffice for a new user's no-signals state. If a mutation stays pending but has not reached its server action, inspect the pending Next.js POST's `next-action` ID and map it through `.next/dev/server/server-reference-manifest.json` or compiled server chunks. An unrelated initial server action may be blocking the serialized action queue. Do not replace analytical responses with mocks to claim end-to-end mutation proof.

Mission Control starts automatically in `full`. In `lean`, start it for admin, provider, model, and other internal workflows:

```bash
tilt enable internal mission-control
tilt trigger internal
tilt trigger mission-control
tilt wait --for=condition=Ready uiresource/internal uiresource/mission-control --timeout=300s
tilt get uiresources -o json | jq -r '.items[] | select(.metadata.name=="mission-control") | .status.endpointLinks[]?.url'
```

Open the reported URL and sign in as above. The signed-in Clerk user needs a matching local `users` row with `is_admin = true`; see [isolated users](references/isolated_users.md#admin-permission-checks) for an explicit test admin grant and revocation.

Internal routes that require a Clerk-verified employee (the Mission Control HIPAA toggles, workspace-limit overrides) bypass Clerk locally and act as the seeded dev admin — `DEV_ADMIN_CLERK_USER_ID` from the root `.env.development.local`, or the shared default that `bun run db:seed` syncs. The worker records that identity as the actor (for example `user_entitlements.granted_by`), so it must have a local `users` row; `bun run dev:doctor` warns when the table is seeded without it. The value reaches `cfw-internal` through `bun run dev` → `.dev.vars`, so after changing the override run `tilt trigger internal` and, if the new identity has no `users` row, run `bun run x scripts/sync-clerk.ts` (or `bun run db:reset`) — `bun run db:seed` short-circuits on an already-seeded database and never reaches the Clerk sync; a linked worktree without its own `.env.development.local` uses the main checkout's file for seeding, the worker, and the doctor alike.

Mission Control skips its own HIPAA authorization to match: the org HIPAA grant and the endpoint HIPAA-eligibility switch call Google's metadata server and the `hipaa-admins` group in production, neither of which a laptop can reach, so `prepareHipaaWorkerAuthorization` returns empty authorization headers when `isHipaaDevAuthBypassEnabled()` is true. That needs `isDev()` **and** `MISSION_CONTROL_HIPAA_DEV_AUTH_BYPASS=true`, which only Mission Control's own `bun run dev` scripts set — the same shape as `SUPPORT_DEV_AUTH_BYPASS` in `services/cfw-support`. A deployment is protected by `OR_ENV=production` making `isDev()` false, and the flag's absence from every deployed environment is the independent second gate, so an `OR_ENV` misconfiguration alone keeps the Google path. Everything downstream is the production path: the same server actions, the same `cfw-internal` routes, the real `user_entitlements` and `endpoints` writes attributed to the dev admin, the `hipaa_endpoint_eligibility_changed` audit log, and the post-save KV routing-cache refresh. The org toggle grants the entitlement only — it does not enable HIPAA on existing workspaces, which stay owned by `workspaces.is_hipaa_enabled`. To exercise HIPAA inference after a toggle, start `api-hipaa` and use the seeded fixtures in [e2e-testing](../e2e-testing/SKILL.md); a database seeded before those fixtures existed makes `tests/e2e/api/hipaa` skip with a `[WARN]` until it is reseeded.

The Devin (v2) layout toggle is gated separately by the email allowlist in `packages/helpers/devin-shell-access.ts`; an admin user outside it has no toggle. Do not commit allowlist changes or disable MFA to get access. A user-authorized local-only entry stays uncommitted, is lost on checkout, and is removed before finishing. Switch layouts with the header button labeled "Switch to the Devin layout"; open content tabs with Ctrl-click or the tab strip's "New tab" button. Hover-only styles cannot be exercised when `matchMedia('(hover:hover)').matches` is false in the automation browser; report them as unverified.

In the Devin panel, a working chat session does not prove the `!` playbook and `#` knowledge catalogs work: those need `DEVIN_ORG_ID` alongside the v3 service token (see `projects/mission-control/app/env.ts`) and otherwise show "Devin API v3 is not configured". A `/nav` follow-up in an existing session fails server-side message-length validation, so ask for navigation in plain text. The attached-context card appears only for sessions created in the current browser session; after a reload the same session shows no card.

On `/provider-monitors` in the v2 shell, provider detail opens inline. Clicking a Live/Hidden/Disabled count selects the provider (row bubbling); endpoint-specific selection is only through the named entries in the count's hover preview, and Ctrl-click on either opens a background content tab. The count's hit area is its numeral, so move the pointer onto the numeral if the preview does not open. Await the anchored URL and the settled attached-context card separately: the URL changes before the context publishes. Sort by clicking the button inside the column header, and note the API column sorts monitor URLs, not the displayed schema labels.

## Fixtures and checks

Scope fixture changes to your test IDs and restore them afterward; local databases are shared.

| Surface | Required facts |
| --- | --- |
| BYOK pages | `frontend-api` needs a nonempty `/api/frontend/v1/all-providers` response; navigate through the provider list because detail URLs use provider names. Key changes persist with **Save**. |
| Provider dashboard | The user must be in `providers.owners`; the endpoint must be visible, undeleted, and present in warmed KV. Verify saved values in `endpoints.features`. |
| Model pricing | Seed `pricing_versions` with an effective date in the past. Verify `pricing.overrides` on the owning model's endpoints API, served by `public-api`. |
| Notifications | See [notification checks](references/notifications.md) for setup, delivery results, privacy, and polling fallbacks. |
| Credits and reverification | See [credits and reverification checks](references/credits_reverification.md) for the `usage-record` SSR dependency, auto top-up routes, and Clerk `strict_mfa` session aging. |
| KV warmer audit inserts | See [audit persistence checks](references/kv_audit_persistence.md) for seeding reference-stat rows, hung-insert and timeout tests, and publication-ordering proof. |
| Mission Control | Use model permaslugs for model-edit routes. Keep test schedules disabled and financial operations in dry-run mode. Restriction-triggered refunds queue live runs; fake payment fixtures are for read-only previews only. |
| Arena text-image | A persisted `model_example_batches` row with `modality = 'text_image'` does not prove the launch response parsed; also check its item rows and the worker's `model-example-text-image-items:dispatched` count. Source-view fixtures need `size_bytes` on both the raster asset and the nested source, and public explore needs an `arena_cell_publications` row. MC grids are built from the challenge generator's roster, so attach text-model fixtures to a text-image challenge. Serve temporary SVG fixtures from the tested app's own origin (MC and web use different ports) and remove them afterward. |
| Speech gallery | Run `bun run storybook`; open `http://localhost:6006/iframe.html?id=benchmarks-speechtakelist--default&viewMode=story`. See [speech gallery checks](references/speech_gallery.md) for fixture and browser-measurement ideas. |

For speech gallery variants, edit the story's `scenarios` control as JSON in the Storybook manager instead of changing story source. Set `take.transcript` together with the scenario prompt when varying asked-for text, since the transcript takes precedence as the asked-for text. The story's `/takes/*.wav` URLs are not shipped; for playback, serve a temporary WAV from `projects/web/public` and override `audioUrl` and `audioDurationMs`, then remove the file. A Storybook started before a branch change serves a stale bundle, so restart it before collecting evidence.

After changing catalog or pricing fixtures:

1. Run `tilt trigger api` and confirm the new worker starts in `tilt logs api` to clear cached database reads.
1. Run `tilt trigger api-kv-cron` and confirm that run succeeds in `tilt logs api-kv-cron`. A local run can outlast a `tilt wait` timeout, so a timeout is not a failure: poll `tilt get uiresource api-kv-cron -o json | jq -r .status.updateStatus` until it leaves `in_progress`, then check the latest `buildHistory` entry for an error.
1. Run `tilt trigger api`, `tilt trigger frontend-api`, and `tilt trigger web`, then restart any other worker under test to reload warmed KV.

- Restart the worker under test after edits to shared packages.
- For KV tests, restart `kv-cache` after local KV writes. Shared state is `.wrangler/shared-state`; Wrangler writes use `--local --persist-to ../../.wrangler/shared-state` from the worker directory.
- Live-config reads initially use schema defaults while refreshing in the background.

## Verify and trace

Exercise the changed behavior through the real page or API with populated fixtures; verify saved changes after reloading. A health response alone does not prove the feature works. Local API requests can use the seeded key `sk-or-v1-unlimitedkey`.

```bash
tilt logs --tail=100 --source=runtime web api frontend-api
tilt logs --since=5m --source=runtime api usage-record dataflow
```

Correlate by the internal `gen-*` generation ID; the response ID may be the provider's ID. Captures live under `services/dev-fs-logs/.logs/<generation-id>/`; early route captures use `.logs/default/`. Verify persisted usage in the Spanner emulator.

Endpoint eval tests (Mission Control and provider-dashboard quick tests) write adapter captures to `.logs/default/adapters/*.log` as concatenated JSON shared with background monitors; select records by endpoint ID and request timestamp. Check a seeded endpoint's variant before using it as a chat control: batch variants expose the same test button but fail synchronous tests with an invalid-adapter error. Mission Control passes `showAllTemplates` to the test popover, so model-filtered template groups are only observable on the provider dashboard's endpoint editor.

### cfw-internal cron dispatch without Tilt

`bunx wrangler dev --test-scheduled` in `services/cfw-internal` boots without `.dev.vars`. Read the port from its output, then fire a slot with `curl 'http://localhost:<port>/__scheduled?cron=*+*+*+*+*'` (the middleware accepts `cron` only, not a fixed `time`). Inspect the resulting `CronTaskWorkflow` run with `bunx wrangler workflows instances describe cron-task-workflow <id> --local --port <port>`, which shows step names, order, attempts, and final status.

- Most cron handlers log and swallow missing-credential and DB errors, so a `Completed` instance proves dispatch and step ordering, not that the task did its work.
- Dispatch creates one instance per task, id `<slot>-<task>-<scheduledTime>`. To probe a task directly, use `workflows trigger cron-task-workflow '{"cron":"*/5 * * * *","scheduledTime":<ms>,"task":"<task>"}' --id <unique-test-id> --local --port <port>`. Check the task is local-only before triggering anything that mutates.
- The tasks of a slot start concurrently and the schedule has no ordering primitive. When a task must run after another one, the parent workflow creates the follow-up `CronTaskWorkflow` instance in its own `step.do` after the parent task's step, passing the same `cron` and `scheduledTime`. Do not make the follow-up instance poll the parent. Verify the chain from `describe` on the parent (the create step runs after the task step) and from the follow-up instance's `cron-task-workflow:started` log.
- A task that reaches its business step and then fails against the missing local `api` worker is an orchestration pass, not a failure.
- Concurrent fires within the same millisecond share an instance id. Locally a duplicate `create()` returns success without a second run, so count instances and `cron-task-workflow:started` logs rather than `workflow-created` logs.

## Debugging

- If Docker pulls fail with `failed size validation`, check the configured registry mirror before changing image versions. Pull the same pinned image through an available trusted mirror (for Docker Hub images, `mirror.gcr.io/<image>:<tag>`), then tag it with the original name and retry the resource. This can affect Postgres, Redis, ClickHouse, and the Pub/Sub emulator independently. When several images fail, put `https://mirror.gcr.io` first in `registry-mirrors` in `/etc/docker/daemon.json` and restart Docker so every later pull uses it.
- An empty Playground model picker with catalog 500s can mean KV warm-up is still running, even when web/API health checks pass. Wait for `api-kv-cron` to finish, then reload `/chat`; the five-minute cron in `services/cfw-internal/src/routes/cron/schedule.ts` runs provider monitoring before the catalog rebuild.
- If `api-kv-cron` reports `catalog-refresh-publish-failed` from `warmKVModelsAndEndpoints`, ensure local ClickHouse is running and migrated before retrying the warm-up; otherwise the router catalog remains unavailable.
- If a worker call hangs without reaching the target's logs after a restart, check for a stale Wrangler service binding; restart the target, then the caller.
- Agents sometimes share a machine and run Tilt from different checkouts; if behavior does not match your changes, check which checkout the serving process uses.
- Never run `bun run test:mutation --in-place` while a browser verification uses the same checkout: the instrumented source is compiled by the dev server and breaks the page until the file is restored.
- Playwright screenshots inject a temporary `caret-color: transparent` style; a capture before hydration finishes surfaces as a hydration attribute mismatch in Next's dev overlay. Capture after hydration or pass `caret: 'initial'`. The dev overlay badge can cover the account button; click the unobstructed chevron instead of forcing the click through it.
- FS logging changes the Chat/Responses streaming pipeline; check `isFSLoggingEnabled()` in `packages/clients/fs-logs/send-to-fs-log.ts` before comparing local TTFT or backpressure with production.
- Feature gates: for registered Statsig gates, open Dev Panel → Feature Flags, search the gate name, and use Default / On / Off. The list comes from `packages/frontend/feature-flags/registry.ts` (`STATSIG_GATE_LIST`). Read the evaluated value and current override instead of assuming local defaults are false; the Internal profile can evaluate true. Restore Default after testing.
- The desktop Account trigger is also a profile link. Hover to open its organization menu; clicking the trigger may navigate to Profile instead. See `projects/web/components/ui/Navbar/DesktopNavBar.tsx`.
- For entity-scoped UI, check `performance.timeOrigin` across organization selection to distinguish an in-place refresh from a full navigation. Clear resource timings immediately before switching and increase their buffer when counting requests; report aborted/status-zero entries separately. Verify the actual copied/resolved identity, not only a short token mask.

## Addendum

- Billing: use the [Spanner queries](references/useful_spanner_queries.md) to check generation tokens, usage rollups, and budgets.

## Responsive account-navigation checks

At mobile width the web navbar exposes two controls named "Open navigation menu" (both `nav_nested` arms render in the HTML, see `projects/web/components/ui/Navbar/NavArmTree.tsx`). Use the leftmost sidebar trigger, not the account-menu trigger, and confirm it becomes "Close navigation menu". The drawer lists workspace links before account links, so scroll inside it to reach settings links. Capture after the slide transition settles, since an immediate screenshot can show partially translated text and look like a broken drawer.

## Devin Secrets Needed

- `INFISICAL_CLIENT` and `INFISICAL_SECRET` for the local stack's universal-auth secret injection. Machine-identity `infisical run` may need an explicit `--projectId` where interactive developer scripts omit it.
- Clerk sign-in credentials are covered by the linked `clerk-dev-signin-token` skill. If ticket consumption returns `needs_second_factor`, do not bypass MFA; distinguish flows that require sign-in from client-only UI flows.
