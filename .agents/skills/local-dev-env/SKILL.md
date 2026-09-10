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

## Sign in

Use `dev+clerk_test@openrouter.ai` → **Use another method** → **Email code** → `424242`. This development account is seeded with credits. Select **Personal** unless the test uses a locally synced organization. [Isolated users](references/isolated_users.md) are an optional path for auth and onboarding tests.

## Mission Control

Mission Control starts automatically in `full`. In `lean`, start it for admin, provider, model, and other internal workflows:

```bash
tilt enable internal mission-control
tilt trigger internal
tilt trigger mission-control
tilt wait --for=condition=Ready uiresource/internal uiresource/mission-control --timeout=300s
tilt get uiresources -o json | jq -r '.items[] | select(.metadata.name=="mission-control") | .status.endpointLinks[]?.url'
```

Open the reported URL and sign in as above. The signed-in Clerk user needs a matching local `users` row with `is_admin = true`; see [isolated users](references/isolated_users.md#admin-permission-checks) for an explicit test admin grant and revocation.

## Fixtures and checks

Scope fixture changes to your test IDs and restore them afterward; local databases are shared.

| Surface | Required facts |
| --- | --- |
| BYOK pages | `frontend-api` needs a nonempty `/api/frontend/v1/all-providers` response; navigate through the provider list because detail URLs use provider names. Key changes persist with **Save**. |
| Provider dashboard | The user must be in `providers.owners`; the endpoint must be visible, undeleted, and present in warmed KV. Verify saved values in `endpoints.features`. |
| Model pricing | Seed `pricing_versions` with an effective date in the past. Verify `pricing.overrides` on the owning model's endpoints API, served by `public-api`. |
| Notifications | See [notification checks](references/notifications.md) for setup, delivery results, privacy, and polling fallbacks. |
| Mission Control | Use model permaslugs for model-edit routes. Keep test schedules disabled and financial operations in dry-run mode. Restriction-triggered refunds queue live runs; fake payment fixtures are for read-only previews only. |
| Speech gallery | Run `bun run storybook`; open `http://localhost:6006/iframe.html?id=benchmarks-speechtakelist--default&viewMode=story`. See [speech gallery checks](references/speech_gallery.md) for fixture and browser-measurement ideas. |

After changing catalog or pricing fixtures:

1. Run `tilt trigger api` and confirm the new worker starts in `tilt logs api` to clear cached database reads.
1. Run `tilt trigger api-kv-cron` and confirm that run succeeds in `tilt logs api-kv-cron`.
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

## Debugging

- If a worker call hangs without reaching the target's logs after a restart, check for a stale Wrangler service binding; restart the target, then the caller.
- Agents sometimes share a machine and run Tilt from different checkouts; if behavior does not match your changes, check which checkout the serving process uses.
- FS logging changes the Chat/Responses streaming pipeline; check `isFSLoggingEnabled()` in `packages/clients/fs-logs/send-to-fs-log.ts` before comparing local TTFT or backpressure with production.

## Addendum

- Billing: use the [Spanner queries](references/useful_spanner_queries.md) to check generation tokens, usage rollups, and budgets.
