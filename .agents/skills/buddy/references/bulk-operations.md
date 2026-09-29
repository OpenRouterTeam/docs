# Bulk operations: budgets, chunks, check-ins, break glass, live monitoring, rollback

A bulk operation is any task that applies more than a handful of writes in one go: hiding every endpoint of a provider, repricing a model family, re-running capability tests across a provider, starting or publishing an Arena batch. The batch id, budget and chunk rules below are not scoped to bulk jobs, though: the worker applies them to every apply on these routes, a single write included, because it cannot tell a one-off from the first write of a loop. The worker throttles these per agent, holds every batch to fixed chunks with a mandatory Datadog check-in between them, tags every write with telemetry, and expects the agent to watch the result while it lands. Read the code first: `services/cfw-internal/src/routes/buddy-api/bulk-rate-limit.ts` (budgets), `bulk-chunk-gate.ts` (chunk sizes and waits), `bulk-check-in.ts` (the check-in route), `bulk-break-glass.ts` (the emergency window), `bulk-telemetry.ts` (metric and log fields), `route.ts` (which routes belong to which family).

## Budgets (server-enforced, per agent, per minute)

| Family | Routes | Limit |
|---|---|---|
| `catalog_apply` | `POST/PATCH` on models, model-author, endpoints, providers, model-version-groups, pricing-versions, hide, model unhide, duplicate, reset-created-at | 10 applies / min |
| `endpoint_automation` | `/endpoint/:id/automation/baseline-unhide`, `/endpoint/:id/automation/capability-test` | 5 / min |
| `arena_bulk` | `/arena-eval-runs`, `/arena-eval-runs/publish`, `/arena-model-backfill` | 2 / min |

Only `apply: true` spends catalog and automation budget. Previews are free, so preview the whole batch first and post it as one artifact. Arena bulk routes spend budget on every call. Buddy and Devin have separate budgets, so one agent cannot starve the other.

On exhaustion the worker returns `429` with `Retry-After: 60`. Wait the full `Retry-After` before the next apply. Do not retry in a tight loop, do not switch credentials to get a fresh budget, and do not split the batch across agents to go faster. If the budget is too small for a legitimate job, say so in the thread and let a human decide whether to open a break-glass window (below) or raise the normal limit in `services/cfw-internal/wrangler.toml`.

## Correlate the batch

Send `X-Buddy-Batch-Id: <token>` on every request of one job, previews included. The worker enforces the shape `<job>-<YYYY-MM-DD>-<HHMM>` with the UTC date and time the job started, an optional `-<N>` sequence (one or two digits) for a second job started in the same minute, and at most 64 characters in total. `<job>` is letters, digits, `.`, `_` or `-`, starting alphanumeric, for example `hide-deepinfra-2026-09-17-1430` or `ECO-4210-2026-09-17-1430`. The date and time must be real values (`MM` 01 to 12, `DD` 01 to 31, `HHMM` 0000 to 2359), so a date-only id such as `hide-deepinfra-2026-09-17` or a ticket id alone is refused. On an apply the header is mandatory: a missing or malformed token is refused with `400` before anything is written, and the error names the expected shape. On a preview it is optional and a malformed token is dropped to `null` rather than logged. One batch id is one agent and one family, so a job that touches two families runs as two batches. Post the batch id in the approval message, so anyone can pull the job's log lines later.

Nothing checks that an id is new. The gate keeps a batch's chunk state for 24 hours after its last apply or check-in (7 days once stopped), so a second job that reuses an id inside that window continues the first job's batch: it inherits the chunk position and wait, and a stopped id answers `423`. The `HHMM` suffix is what keeps two same-day jobs on one target apart, and a second job started inside the same minute appends a sequence number (`hide-deepinfra-2026-09-17-1430-2`). The whole id, sequence suffix included, must fit the 64-character limit, so keep `<job>` to 45 characters (room for `-YYYY-MM-DD-HHMM-NN`). The worker checks the shape only, not that the time is current or that the id is unused.

## Chunks and check-ins (server-enforced)

Applies on one batch land in fixed chunks. When a chunk is full the worker refuses further applies on that batch until two things have happened: the family wait has passed since the last apply, and a check-in has been posted for the chunk. The per-minute budget runs first, so an apply refused by the budget does not take a chunk position, while an apply refused by the gate spends one budget token that comes back within the minute.

| Family | Chunk | Wait after the last apply | Exempt |
|---|---|---|---|
| `catalog_apply` | 10 applies | 5 minutes | none |
| `endpoint_automation` | 5 applies | 5 minutes | none |
| `arena_bulk` | 1 call | 10 minutes | `/arena-eval-runs/publish` (per-minute budget only) |

A chunk position is taken when the gate admits the apply, before the route runs, so an admitted apply that then fails in the handler (`404`, `5xx`) still counts toward the chunk. Refusals ahead of the gate (`401`, `403`, budget `429`) do not.

Responses on a full chunk:

- `429` with `Retry-After` while the wait is still running. Wait the full `Retry-After`, then check in.
- `428` once the wait has passed and no check-in has been posted. Check in, then continue.
- `423` when the batch was stopped by its last check-in. A stopped batch stays stopped. Start a new batch id after a human has decided the change should continue.
- `503` when the gate itself is unreachable. The gate fails closed, so retry later instead of working around it.

The check-in is `POST /bulk-batches/:batchId/check-in` with the same credential and the body below. It records what you compared in Datadog and your verdict. A `continue` is refused with `409` on an empty chunk and `429` with `Retry-After` before the wait has passed. A `stop` is accepted at any time, including on an empty chunk and mid-wait, so a batch can be frozen the moment an alert fires. Either verdict gets `423` on a batch that is already stopped.

```json
{
  "family": "catalog_apply",
  "verdict": "continue",
  "signals": [
    { "name": "transaction_attempt.success_rate:deepinfra", "before": 0.994, "after": 0.993 },
    { "name": "endpoint_returned_error.count:deepinfra", "before": 12, "after": 14 }
  ]
}
```

`signals` is 1 to 10 entries on a `continue` and 0 to 10 on a `stop`, so a stop posted straight from an alert may omit it. Each `name` is 1 to 80 characters from `[A-Za-z0-9._:/-]`, starting alphanumeric, naming the Datadog query you compared. `before` is the baseline from before the chunk, `after` the value at the end of the wait, `null` when the query returned nothing. The worker does not judge the numbers. It stores them in the audit log so a reviewer can see what the verdict was based on, and it refuses to open the next chunk without them. `verdict: "continue"` opens the next chunk and the response carries `next_chunk`. `verdict: "stop"` freezes the batch and `next_chunk` is `null`. A stopped batch id stays refused for seven days, then the gate forgets it.

Stop when any signal has moved against the touched resources compared with the prior hour, when any apply in the chunk returned something other than the expected result, or when a human in the thread says stop. A stop is a decision, not a retry. Say why in the thread with the batch id.

## Break glass (emergency ceiling, bounded and audited)

When a human on the catalog-editor list says the change cannot wait for the normal budget, the worker can raise one agent's budget on one family for a bounded window. The switch is the `buddy_bulk_break_glass` live-config key, holding at most one window `{ agent, family, reason, opened_by, opened_at, expires_at }`. While a window names the caller's exact agent and family and has not expired, that family's applies are checked against the emergency ceiling alone. Outside a window every apply spends both the normal and the emergency counter, so opening or closing a window mid-minute never admits more than the emergency ceiling in that minute. Nothing else changes: batch ids are still mandatory, chunks, waits, check-ins and stop verdicts still apply, and the per-minute budget still refuses with `429`.

| Family | Normal | Under break glass |
|---|---|---|
| `catalog_apply` | 10 / min | 60 / min |
| `endpoint_automation` | 5 / min | 60 / min |
| `arena_bulk` | 2 / min | 10 / min for `/arena-eval-runs` and `/arena-model-backfill`. `/arena-eval-runs/publish` stays at 2 / min because publish has no exact inverse. |

Rules the worker enforces:

- A window lasts at most 60 minutes from `opened_at`. A longer, inverted, malformed or expired window is ignored and the family runs at its normal budget. A cold isolate with no value serves the default (no window) and refreshes from KV in the background.
- Exactly one window at a time. Opening a second replaces the first, and the audit row and Slack post carry the old value.
- Only a verified Devin OIDC requester whose email is on the shared editor list (`packages/providers/configs/catalog-editors.ts`, the same list that gates `apply: true`) can open or close it from a session. The static Buddy key and `X-Buddy-Actor-Email` cannot. Mission Control uses its own admin gate on the same key.

Two ways to open or close it, both writing the same key, both audited in the live-config audit table and posted to `#changelog-live-config`:

- **Mission Control.** `https://internal.openrouter.ai/admin-utils/live-config?key=buddy_bulk_break_glass`. Set `window` to the object above, or back to `null` to close.
- **From a Devin session.** `POST /bulk-break-glass` with `{ "agent": "devin", "family": "catalog_apply", "reason": "<why normal limits are insufficient>", "minutes": 30 }` under the session's OIDC token opens it and returns `{ window, previous_window }`. `DELETE /bulk-break-glass` closes it (idempotent, returns `{ window: null, previous_window }`). `403` means the requester is not a verified editor, `400` means the body is out of bounds (more than 60 minutes, empty reason, unknown family), `503` means the live-config namespace is unavailable and nothing was written.

The human's message is the trigger, the route is the control. Open a window only when a human on the editor list says so in the thread, with the family and the reason, and quote that message in the approval. Never open it on your own judgment, never open it for a family the human did not name, and never open it for a longer window than the job needs. Close it as soon as the last chunk is applied instead of waiting for expiry. Opening and closing reach a warm worker through the live-config cache, so either may take about ten seconds plus KV propagation to be honoured, and until then that worker keeps checking against the budget it last read. Closing changes the budget, it does not halt a batch. To halt writes at once, post a `stop` check-in, which the batch gate honours on the next apply.

Every request served under a window carries `break_glass: true` on its `buddy_bulk_operation` log line and `break_glass:true` on the metric, so it can never be used quietly. The `[cfw-internal] Buddy bulk writes served under break glass` monitor fires on the first such request and recovers five minutes after the last. Whoever opened the window watches the dashboard widgets for the whole window and posts the before and after in the thread.

## The loop for every bulk change

1. **Preview everything.** Run the whole batch with `apply` omitted. Collect the `preview.current` snapshots where the route returns one (update routes only, creates have no `current`). Keep them in the thread or attached, not only in your context. Before applying, name the rollback path for every operation in the batch from the table below. If an operation has no supported inverse, say so in the approval message so the approver knows the change is one-way at the API.
2. **Ask for approval separately.** One message with the previews and the batch id, then a distinct approval message from a human. The approver's email goes in `X-Buddy-Actor-Email` (static key) or is derived from the OIDC session (Devin).
3. **Apply in order, watching each response.** Stop on the first `403` (approver not an editor), first `5xx`, or any `applied: false` you did not expect. A `429` is a pause, not a stop. A `423` means the batch was stopped and the job goes back to a human.
4. **Monitor while it lands.** Take the baseline for every signal you will check in with before the first apply. Open the Datadog queries below and keep them open. Anything other than `outcome:ok` for your agent and family during the window means stop and read the log line.
5. **Check in between chunks.** When the chunk is full, wait the family interval, re-run the same Datadog queries for the resources the chunk touched, and post the check-in with the before and after values and your verdict. Post the same numbers in the thread. Only then apply the next chunk.
6. **Re-read and verify.** After the last apply, `GET` every touched resource and diff it against `preview.proposed`. Report count applied, count verified, and any mismatch. Exclude `updated_at` and `last_edited_clerk_user_id` from the "nothing else changed" diff, every apply rewrites both, so a diff that includes them reports a mismatch on every row.
7. **Watch the customer-visible effect.** For endpoint and pricing changes, compare the provider's `Transaction attempt` success rate and `Endpoint returned error` volume in Datadog for the touched endpoints against the prior hour for at least the next 15 minutes. Use the same window the debug-prod skill uses (`.agents/skills/debug-prod/SKILL.md`). These are the same signals as the check-ins, so the last check-in and this comparison use one set of queries. The bulk change is not finished until this comparison is posted. Two field names differ between the log lines: the upstream status on `Endpoint returned error` is `@extra.status` (with `@extra.raw_status` and `@extra.provider_error_code`), while `@extra.endpoint_error.status` exists only on `Transaction attempt`. For a `provider_region` change, also group `Transaction attempt` by `@extra.fetch_url` (non-BYOK only, BYOK logs it as null) to see the touched endpoints move to the regional host, which lags the apply by the endpoint cache TTL (about 5 minutes).
8. **Roll back per route category.** Rollback is another bulk change: preview it, get approval, apply, re-read. The DB changelog tables (`endpoints_changelog`, `models_changelog`, `providers_changelog`) hold old and new data for every write if a `current` snapshot was lost.

## Rollback paths

| Operation | Inverse | Notes |
|---|---|---|
| `PATCH /model/:author/:slug`, `PATCH /endpoint/:id`, `PATCH /provider/:slug` | Same `PATCH` with the fields from `preview.current` | `hidden` and `is_private` are gated by the privacy/visibility rules and may be stripped. Check `stripped_fields` in the rollback preview. |
| `POST /endpoint/:id/hide` | `POST /endpoint/:id/automation/baseline-unhide` for a public endpoint, `PATCH` with `hidden: false` only for a private one | The automation runs the baseline gates and can refuse to unhide. A refused unhide is a human decision, not a retry. |
| `POST /model/:author/:slug/unhide` | `PATCH` with `hidden: true` for a private model, none at the API for a public one | PATCH strips `hidden` on a public model, so re-hiding it is a Mission Control edit. Endpoints keep their own visibility, so an unhidden model with hidden endpoints serves nothing. |
| `POST /model/:author/:slug/reset-created-at` | None at the API | The route always writes the current time and ignores any `created_at` in the body. Recovery is a manual DB update from `models_changelog`. |
| `POST /models`, `POST /endpoints`, `POST /providers`, `POST /model-version-groups`, `POST /pricing-versions`, `POST /endpoint/:id/duplicate` | None at the API | The Buddy API has no delete. Contain a wrong endpoint with `/hide`, then hand the cleanup to a human with DB access. |
| Arena bulk | None exact at the API | Publishing a run replaces only the cells that run scored. `POST /arena-challenge/:id/eval-publication/unpublish` clears every live cell of the challenge version, including cells other runs own, so it is a takedown, not an inverse. Republishing a former owner is not one either, it reclaims every cell that run scored, including cells another run owns now. Recovery is a manual DB restore of the exact closed pointers in `arena_eval_result_publications` by a human with DB access. Use `unpublish` only to contain a wrong publish that must come down before that restore. See `.agents/skills/arena-studio/SKILL.md`. |

## Datadog (us5)

Every bulk request emits one `buddy_bulk_operation` log line and one `openrouter.cfw_internal.buddy_bulk.operation` count, both tagged `agent`, `family`, `mode`, `outcome`, `break_glass`. The log line also carries `status`, `method`, `route_path`, `batch_id`, `duration_ms`. Emails, request bodies, and resource ids are never in either. `outcome` is `ok` (2xx), `forbidden` (403), `rate_limited` (the per-minute budget's 429 only), `chunk_wait` (the chunk gate's 429 while the wait runs), `rejected` (any other 4xx, including the gate's 400, 423 and 428) or `error` (5xx). A batch that waits out its chunks as instructed produces `chunk_wait` and never `rate_limited`, so a `rate_limited` series is always a loop retrying into the budget. Opening or closing a break-glass window emits one `buddy_bulk_break_glass_change` line (`action`, `agent`, `family`, `opened_at`, `expires_at`, `replaced_open_window`, `is_success`) alongside the live-config audit row. `replaced_open_window` is true only when the value read before the write was a window still open at that moment, not for an expired or not-yet-open stored window.

Every gated apply also emits one `buddy_bulk_chunk_gate` log line (`result`, `chunk`, `position`, `retry_after_seconds`, `batch_id`) and one `openrouter.cfw_internal.buddy_bulk.chunk_gate` count tagged `agent`, `family`, `result`. Every check-in emits one `buddy_bulk_check_in` summary line (`chunk`, `verdict`, `result`, `signal_count`), one `buddy_bulk_check_in_signal` line per signal (`signal_name`, `before`, `after`), and one `openrouter.cfw_internal.buddy_bulk.check_in` count tagged `agent`, `family`, `verdict`, `result`. Batch ids and signal names are log fields, never metric tags.

- Worker logs land under `service:api`, narrowed with `@script_name:internal`, and structured fields sit under `@extra.`.
- Live log tail for one job: `service:api @script_name:internal @extra.batch_id:<token>` in Log Explorer at `https://us5.datadoghq.com/logs`.
- Rejections during the window: `service:api @script_name:internal (buddy_bulk_rate_limited OR (buddy_bulk_operation -@extra.outcome:ok))`.
- Chunk and check-in history for one job: `service:api @script_name:internal @extra.batch_id:<token> (buddy_bulk_chunk_gate OR buddy_bulk_check_in OR buddy_bulk_check_in_signal)`.
- Everything written under break glass: `service:api @script_name:internal buddy_bulk_operation @extra.break_glass:true`, and the window opens and closes: `service:api @script_name:internal buddy_bulk_break_glass_change`.
- Counts by outcome: the "Buddy bulk operations by outcome", "Buddy bulk successful apply requests by agent and family", "Buddy bulk chunk gate by result", "Buddy bulk check-ins by verdict and result" and "Buddy bulk requests served under break glass" widgets on the `cfw-internal` service dashboard (`configs/terraform-monitors/monitoring/cfw_service_dashboard.tf`, `internal` entry). `outcome:ok` means the apply request returned 2xx. A route that reports a per-row failure inside a 2xx body still counts as ok here, so read the response bodies, not this widget, to know what was written.
- Devin has the native `datadog` MCP server for these queries and for the check-in signals.

Two monitors watch these metrics, both in `configs/terraform-monitors/monitoring/`. `buddy_bulk_rate_limited.tf` fires when one agent and family return more than 12 `outcome:rate_limited` responses in five minutes, which a caller that honours `Retry-After` cannot reach even with two sessions on the same family, so above it a loop is retrying into the budget or the chunk wait instead of pausing. Its message carries the stop procedure. `buddy_bulk_break_glass.tf` fires on the first request served under a break-glass window. There is no burst or volume monitor on applies; the chunk gate bounds the write rate server-side.
