---
name: debug-batch-api
description: >-
  Investigate Batch API production issues using Datadog logs and metrics.
  Given a batch job ID, Clerk entity ID, or symptom such as "batch stuck",
  "results 402", "usage missing", or "submit failing", traces the job through
  ingress, acceptance, asynchronous submission, provider polling, finalization,
  billing, and results serving.
  TRIGGER when: a user reports a Batch API production issue, a batch job is
  stuck, batch results are payment-blocked, usage is missing, or batch
  submission/finalization is failing.
user-invocable: true
---

# Debug Batch API

Use the shared [Debug Prod](../debug-prod/SKILL.md) investigation workflow,
query mechanics, retention rules, and reporting conventions to produce an
evidence-backed Batch API timeline. This skill adds the Batch API-specific
inputs, log schema, lifecycle queries, metrics, and failure modes.

Do not infer a provider acceptance from HTTP 202: acceptance means the raw
payload was durably persisted and a submit job was queued.

## Prerequisites

Follow [Debug Prod](../debug-prod/SKILL.md) for:

- Datadog MCP availability checks and `get_logs` invocation
- Default and narrow investigation time windows
- Datadog's 14-day log-retention boundary
- Generic query fallback and troubleshooting mechanics
- Shared RCA reporting and shareable Log Explorer URL conventions

Batch-specific queries below use the same Datadog MCP request shape and
time-window variables defined by Debug Prod.

## Links

- [Batch API dashboard](https://us5.datadoghq.com/dashboard/cnf-jfc-nhu)
- [Batch finalize-stalled runbook](https://app.notion.com/p/39c2fd57c4dc818592b6f21725b51017)
- Repository monitor definitions:
  - `configs/terraform-monitors/monitoring/batch_finalize_stalled.tf`
  - `configs/terraform-monitors/monitoring/batch_upstream_job_id_persist_failed.tf`
  - `configs/terraform-monitors/monitoring/batch_provider_submit_outcome_unknown.tf`
  - `configs/terraform-monitors/monitoring/batch_finalize_billing_loss.tf`
  - `configs/terraform-monitors/monitoring/batch_results_payment_blocked.tf`
  - `configs/terraform-monitors/monitoring/batch_moderation_preflight.tf`
  - `configs/terraform-monitors/monitoring/batch_submit_dlq.tf`
  - `configs/terraform-monitors/monitoring/batch_api_oom.tf`
  - `configs/terraform-monitors/monitoring/batch_provider_poll_failures.tf`
  - `configs/terraform-monitors/monitoring/batch_ingress_failures.tf`

## Inputs

For a known job, narrow to the job's event window when possible. Batch Cloud
Run structured fields are nested under `@data.jsonPayload.extra.*`; event names
are matched as free-text phrases, for example `"batch_api.sweep.poll_failed"`.

Each Cloud Run worker role logs under its own Datadog service — `batch-api`
(accept/read), `batch-api-submit`, `batch-api-control`, `batch-api-sweep`,
`batch-api-finalize` — so `service:batch-api` alone returns only acceptance
records and makes submit/sweep/finalize lookups look empty. Every query below
uses `service:batch-api*`; narrow to one worker service when isolating a stage.
Cloud Run platform errors (`no available instance`, malformed-response aborts)
also land under the worker service, alongside the application events.

The Cloudflare Worker logs use `source:cloudflare @script_name:batch-api`
(their Datadog service is `api`), while its StatsD metrics retain the
`service:cfw-batch-api` tag. Cloudflare structured fields use standard
`@extra.*` fields. Do not use `@message:<event>` for lifecycle events.

### Batch job ID

Start with all Cloud Run records for the job:

```text
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID>
```

If the job ID is not indexed as a facet, use a narrow free-text search:

```text
service:batch-api* *:<JOB_ID>
```

Then run the lifecycle-specific queries below to reconstruct the timeline.

### Entity ID

Batch acceptance, admission, payment-gate, and finalization events carry
`billable_entity_id` where applicable:

```text
service:batch-api* @data.jsonPayload.extra.billable_entity_id:<ENTITY_ID>
```

For ingress/auth problems, query the Cloudflare service separately:

```text
source:cloudflare @script_name:batch-api
```

### Trace ID (APM)

Cloud Run batch services export OTLP traces under their concrete Cloud Run
service names (`batch-api`, `batch-api-submit`, `batch-api-control`,
`batch-api-sweep`, and `batch-api-finalize`). Production JSON logs carry the
active context under `otelSpanContext`. Accepted batches selected by the
configured `submit_sample_rate`, plus OpenRouter-organization batches, are
force-sampled at the trusted ingress boundary. Other accepted batches
intentionally have no APM trace. The submit worker stores its active context
on the batch-owned GCS submit journal; each scheduler candidate reconnects with a
`batch_api.sweep.poll` span before publishing finalize work. A single trace
for a sampled batch therefore spans ingress → acceptance → `batch_api.submit_job.consume` →
`batch_api.sweep.poll` → `batch_api.finalize_one.consume`.

```text
service:batch-api* @data.jsonPayload.otelSpanContext.traceId:<TRACE_ID>
service:batch-api* @or.batch.id:<JOB_ID>
```

Cloud Run logs arrive via the GCP integration, which nests the JSON payload
under `@data.jsonPayload.*`. The existing OpenTelemetry context provides
search-based correlation; this repository does not own the organization-level
Datadog log pipeline needed to add Trace ID and Span ID remappers for one-click
pivots.

### Symptom

Use the symptom decision table below, then run the corresponding stage queries.
Always include the job ID or entity filter when available.

## GCS artifacts

Batch objects use this layout:

```text
gs://$BATCH_GCS_BUCKET/<billable_entity_id>/<job_id>/<artifact>
```

The layout is built by `buildBatchGcsUri` in
`services/batch-api/src/storage/batch-gcs-store.ts`. The
`BatchGcsArtifact` enum in the same file defines:

- `raw_input`: verbatim client `{custom_id, body}` JSONL, persisted at
  acceptance before validation.
- `submit_journal`: the small submit state machine's journal.
- `input_file`: validated client-wire JSONL used for upload.
- `input_file_lowered`: provider-wire JSONL after lowering.
- `output/raw_response`: untouched provider-native result JSONL, exactly as
  fetched.
- `output/results`: validated, skin-rendered `BatchResult` JSONL, written at
  finalize and served verbatim by GET.
- `error/raw_response`: untouched provider-native failed-result JSONL.

Compare `output/raw_response` with `output/results`: a field present only in
the former was dropped by our parse/render transform; absent from both means
the provider did not send it. A served row whose `error.message` is
`<Provider> returned a malformed batch result.` (`fireworks-malformed-N` ids)
means the native row failed canonical schema validation; the finalize logs do
not record the failing Zod path, and the adapter transform swallows it too
(`transformBatchResponse` re-emits the same generic row). To see which field
was rejected, pull `output/raw_response` and run the row's `response` through
the adapter's normalizer and the canonical schema directly, e.g.
`NonStreamCompletionResponseSchema.safeParse(normalizeReasoningContentBody(row.response))`
from `packages/batch/adapters/openai/output-parser.ts`, and read
`error.issues[].path`. The finalize artifact write is
`persistBatchResults` in
`services/batch-api/src/finalize/batch-result-artifacts.ts`, and the
materialized results write is `materializeBatchResults` in
`services/batch-api/src/finalize/materialize-batch-results.ts`.

Production writes use bucket `customer-data-batch-api-prod` in project
`customer-data-483518`, configured by the `BATCH_GCS_BUCKET` env in
`services/batch-api/infra/cloudrun.tf`. The pre-cutover
`openrouter-batch-api-prod` bucket still contains older jobs (see the
`BATCH_GCS_BUCKET` comment there). Both use the 30-day artifact retention
contract (the `lifecycle_rule` on `google_storage_bucket.customer-data-batch-jobs` in
`services/batch-api/infra/customer-data-bucket.tf`).

`job_id` is the batch ID returned by submit, generated as
`orid(ORIDType.Batch)` in `services/batch-api/src/submit/accept/submit-batch.ts`
(normally `batch-<timestamp>-<random>`).

**Entity-ID gotcha:** the GCS path uses
`user.orgId ?? user.user.clerk_user_id`, not the key creator
(`billableEntityId` in `services/cfw-batch-api/src/middlewares/auth.ts`). For an org-owned key,
the path segment is the `org_…` ID, not `creator_user_id` from
`GET /api/v1/key`; using the creator user ID produces a nonexistent path.
Resolve the billable entity from ClickHouse when given a generation ID:

```sql
SELECT clerk_user_id, creator_user_id
FROM default.generations
WHERE generation_id = '<gen-batch-…>'
  AND created_at >= <start>
  AND created_at < <end>
```

Use `generation_id` (not `id`) and always bind a `created_at` window.
`clerk_user_id` is the billable entity. If it is still unknown, search by job:

```bash
gsutil ls -r 'gs://customer-data-batch-api-prod/**/<job_id>/'
```

Worked example:

```text
job_id:             batch-1785263765-XPvEnZuifmN37sHaJ9pm
billable_entity_id: org_2uMVNwONqhSdZXQy1QtyWuCjTxZ
generation_id:      gen-batch-1785263765-570b4519c6488ec4d135

gsutil cat \
  'gs://customer-data-batch-api-prod/org_2uMVNwONqhSdZXQy1QtyWuCjTxZ/batch-1785263765-XPvEnZuifmN37sHaJ9pm/output/raw_response'
gsutil cat \
  'gs://customer-data-batch-api-prod/org_2uMVNwONqhSdZXQy1QtyWuCjTxZ/batch-1785263765-XPvEnZuifmN37sHaJ9pm/output/results'
```

## Query Patterns

The following queries are the Batch API-specific extension to Debug Prod's
generic query patterns.

### Batch lifecycle and exact event queries

### 1. Ingress → Cloud Run

Worker logs: `source:cloudflare @script_name:batch-api` (the Datadog service
field is `api`; do not filter these logs with `service:cfw-batch-api`).

```text
source:cloudflare @script_name:batch-api ("batch.ingress.upstream_fetch_failed" OR "batch.ingress.upstream_non_json_error")
source:cloudflare @script_name:batch-api ("batch.ingress.forwarder_uninitialised" OR "batch.ingress.upstream_unconfigured" OR "batch.ingress.no_service_account" OR "batch.ingress.auth_token_unavailable" OR "batch.ingress.internal_auth_signing_key_missing" OR "batch.ingress.internal_auth_sign_failed" OR "batch.ingress.oversized_body_cancel_failed" OR "batch.ingress.upstream_error_body_cancel_failed" OR "batch.ingress.rate_limit_context_missing")
source:cloudflare @script_name:batch-api "Entity ratelimiter check failed open"
source:cloudflare @script_name:batch-api "batch.identity_token.refreshed"
```

Useful ingress fields include `@extra.upstream_url`, `@extra.method`,
`@extra.error_message`, `@extra.error_location`, `@extra.error_metadata`, and
`@extra.error_raw`. A missing auth token is logged and the forwarder proceeds
so the Cloud Run 403 remains visible.

Metrics:

```text
sum:openrouter.batch.identity_token.fetch{service:cfw-batch-api}.as_count()
sum:openrouter.batch.identity_token.fetch.error{service:cfw-batch-api}.as_count()
sum:openrouter.batch.identity_token.fetch.success{service:cfw-batch-api}.as_count()
p95:openrouter.batch.identity_token.fetch.latency_ms{service:cfw-batch-api}
```

### 2. Accept and admission

Service: `batch-api`.

```text
service:batch-api* "batch_api.preflight_balance_rejected"
service:batch-api* "batch_api.admission_rejected"
service:batch-api* "batch_api.batch_accepted"
service:batch-api* "batch_api.batch_failed_state_persist_failed"
```

Verified fields:

- `preflight_balance_rejected`: `billable_entity_id`, `model`,
  `request_count`, `estimated_cost`, `spendable_balance_usd`
- `admission_rejected`: `billable_entity_id`, `request_count`,
  `estimated_cost`, `error_location`
- `batch_accepted`: `billable_entity_id`, `job_id`, `model`, `client_endpoint`,
  `provider_name`, `endpoint_id`, `request_count`, `estimated_cost`, and
  acceptance timing. `client_endpoint` (the submitted route, e.g.
  `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/embeddings`)
  gates the dashboard's per-modality Model Breakdown and is absent on batches
  accepted before it shipped.
- `batch_failed_state_persist_failed`: `job_id`, `raw_input_uri`, `error`

### 3. Async submit worker and provider submission

```text
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.submit_job.already_submitted"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.submit_job.submit_in_flight"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.submit_job.retrying_cheap_ambiguous_submit"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.submit_job.provider_outcome_unknown"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.submit_job.provider_outcome_journal_failed"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.submit_job.failed"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.batch_submitted_upstream"
service:batch-api* "batch_api.submit.upstream_submit_failed" @data.jsonPayload.extra.provider_name:<PROVIDER>
service:batch-api* "batch_api.submit.upstream_upload_failed" @data.jsonPayload.extra.provider_name:<PROVIDER>
service:batch-api* "batch_api.submit.lowering_failed"
```

Important fields include `job_id`, `attempt_id`, `provider_name`,
`upstream_batch_id`, `upstream_input_file_id`, `status`, `error_location`, and
the normalized error fields. `batch_api.submit_job.provider_outcome_unknown`
means the provider outcome is ambiguous and the submit journal fenced the
irreversible provider call; do not assume a retry is safe. In contrast,
`batch_api.submit_job.provider_outcome_journal_failed` is conclusive evidence
that the provider accepted the batch: it is emitted after the provider call
succeeded with an `upstream_batch_id`, when only the journal replacement failed.

Submit metrics:

```text
p95:openrouter.batch_api.submit.preflight_duration_ms{*}
p95:openrouter.batch_api.submit.lowering_duration_ms{*}
p95:openrouter.batch_api.submit.scan_duration_ms{*}
p95:openrouter.batch_api.submit.line_count{*}
```

The submit distributions carry `provider:<name>` and
`family:<BatchEndpointFamily>` tags. They are emitted once per batch scan, not
once per line.

Transaction-attempt events for provider submission are documented in
[Transaction-attempt queries](#transaction-attempt-queries). Use the umbrella
event when diagnosing an ambiguous submit retry or a job that fails before
provider output exists.

### 4. Provider polling and sweep

The Cloud Scheduler invokes `/sweep`; the sweep polls upstream jobs and
publishes terminal poll results to the finalize Pub/Sub path.

```text
service:batch-api* "batch_api.sweep.completed"
service:batch-api* "batch_api.sweep.poll_failed" @data.jsonPayload.extra.provider_name:<PROVIDER>
service:batch-api* "batch_api.sweep.publish_failed"
service:batch-api* "batch_api.sweep.adapter_resolution_failed"
service:batch-api* "batch_api.sweep.adapter_not_found"
service:batch-api* "batch_api.sweep.provider_key_disabled"
service:batch-api* "batch_api.sweep.key_unavailable_job_read_failed"
service:batch-api* "batch_api.sweep.key_unavailable_fail_emit_failed"
service:batch-api* "batch_api.sweep.spanner_query_failed"
service:batch-api* "batch_api.sweep.row_parse_failed"
```

Verified fields:

- `sweep.completed`: `published`, `candidates_found`, `duration_ms`
- `poll_failed`: `job_id`, `provider_name`, `provider_job_id`,
  `error`, `error_location`
- adapter/key events: `job_id`, `provider_name`, provider key ID, and where
  applicable `provider_job_id`, `error`, and `error_location`
- `spanner_query_failed`: `job_type`, in-flight statuses,
  `freshness_threshold_seconds`, `sweep_scan_limit`, `error`
- `row_parse_failed`: `job_id`, `provider_name`, `provider_job_id`,
  `error`, `raw_row_keys`

There is no job age or `created_at` field on the sweep heartbeat. Use
`candidates_found`, `published`, repeated job IDs, and the job's own lifecycle
timestamps rather than inventing an age query.

### 5. Finalize and output ingestion

```text
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.finalize_one.finalize_failed"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.finalize.completed"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.finalize.already_terminal"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.finalize.job_not_found"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.finalize.results_materialize_failed"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.finalize.provider_key_disabled"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.finalize.provider_key_unavailable"
service:batch-api* "batch_api.finalize_one.invalid_push_body"
```

A deterministic per-line render failure (schema/parse, not I/O) is terminalized
on the first delivery: `renderBatchResultLine.rebuild` is tagged as a permanent
finalize failure, so `failBatchJobForPermanentFailure` emits a terminal `failed`
status and the route ACKs 200 (no redelivery). The terminal emit logs as
`batch_api.finalize.permanent_failure`; an older finalize that pre-dates the
fence may still show a short retry tail. Group `finalize_failed` by
`@data.jsonPayload.extra.job_id` before reading a spike as a fleet-wide
outage, and check `@data.jsonPayload.extra.error_location` to separate
`batchGcsStore.writeBatchOutput.pipeline` (render/parse of the line) from
`finalizeBatchJob.persistResults` (storage write).

`batch_api.finalize.completed` carries `provider_name`, `model`,
`async_job_status`, `is_usage_complete`, `finalized_cost`, `total`,
`succeeded`, `failed`, and `duration_ms`. Materialization failures carry a
`stage` such as `buildResultsUri`, `resolveBatchSkin`, or `writeResults`.

Provider result-download retries are logged by the adapters:

```text
service:batch-api* "batch.openai.download_retry"
service:batch-api* "batch.together.download_retry"
service:batch-api* "batch.adapter.vertex_job_error"
service:batch-api* "batch.adapter.vertex_output_row_defect"
```

### 6. Generation emission and usage accounting

```text
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.emit_generations.done"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.emit_generation.missing_usage"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.emit_generation.fallback_usage_estimated"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.emit_generation.schema_validation_failed"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.emit_generation.output_validation_failed"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.emit_generation.publish_failed"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.emit_generation.clickhouse_publish_failed"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.emit_generations.clickhouse_done"
```

`batch_api.emit_generations.done` carries `emitted`, `estimated`, `skipped`,
`failed`, `clickhouse_build_failed`, `unaccounted`, `total_lines`, and
`total_usage`. The missing-usage event does not carry a provider field in its
current call site, so do not add a provider facet to that query; the
fallback-estimation event does carry `provider_name` and can be filtered by it.

Per-line transaction-attempt events are documented in
[Transaction-attempt queries](#transaction-attempt-queries). They represent
finalized output lines, not provider submit calls.

### Transaction-attempt queries

`Transaction attempt` is a free-text phrase, not an `@message:` field. Batch
Cloud Run fields use `@data.jsonPayload.extra.*`; the sync/Cloudflare
`@extra.*` path returns nothing for these events. Keep the two event layers
separate in every aggregation:

- **Umbrella/provider-submit attempt:** `attempt_id` is present and
  `line_index` is absent. There is one event per job, or two when the bounded
  ambiguous retry fires; the second has `is_retry:true`.
- **Per-line attempt:** `line_index` is present and `attempt_id` is absent.
  There is one event per finalized output line, up to 50k per job.
- A submit failure emits umbrella events only and zero per-line events. That
  asymmetry is diagnostic; never count both layers together.
- Finalize replay can repeat per-line events; unique-count
  `@data.jsonPayload.extra.attempt_key` when aggregating them.

```text
service:batch-api* "Transaction attempt" @data.jsonPayload.extra.batch_id:<JOB_ID>
service:batch-api* "Transaction attempt" @data.jsonPayload.extra.batch_id:<JOB_ID> @data.jsonPayload.extra.attempt_id:*
service:batch-api* "Transaction attempt" @data.jsonPayload.extra.batch_id:<JOB_ID> @data.jsonPayload.extra.line_index:*
service:batch-api* "Transaction attempt" @data.jsonPayload.extra.batch_id:<JOB_ID> @data.jsonPayload.extra.success:false
service:batch-api* "Transaction attempt" @data.jsonPayload.extra.batch_id:<JOB_ID> @data.jsonPayload.extra.is_retry:true
service:batch-api* "Transaction attempt" @data.jsonPayload.extra.batch_id:<JOB_ID> @data.jsonPayload.extra.is_estimated_usage:true
```

Use `attempt_id` for submit-worker diagnosis and `line_index` for output-line
diagnosis; do not infer one layer from the other. For cross-service sync
monitors, exclude Batch with `-service:batch-api*`; do not rely on
`-@extra.surface:batch` because Batch payload fields are nested under
`@data.jsonPayload.extra.*`.

### 7. Results read and payment gate

```text
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.get_batch.completed_results_missing"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.get_batch.stream_results_failed"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.serve_results.parse_failed"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.serve_results.input_line_unservable"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.get_batch.results_payment_blocked"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.get_batch.results_settlement_pending"
service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> "batch_api.get_batch.results_payment_unblocked"
service:batch-api* @data.jsonPayload.extra.billable_entity_id:<ENTITY_ID> "batch_api.get_batch.results_payment_blocked"
```

Payment-blocked records carry `job_id`, `billable_entity_id`, and
`finalized_cost`. A 402 means the final charge was not covered; settlement
pending is a metadata-only 200 response, not a provider failure.

## Steps

Run the input query first, then follow the lifecycle stage that matches the
reported symptom. Extract the verified fields listed for each stage and use
the decision table to choose the next query.

### Symptom → stage decision table

| Symptom | First stage | Queries/signals | Likely causes |
|---|---|---|---|
| “Batch stuck” | Sweep/poll/finalize | `sweep.completed`, `sweep.poll_failed`, `sweep.publish_failed`, `finalize_one.finalize_failed`, repeated `job_id` | provider poll failure, Pub/Sub/finalize retry, missing provider job ID, deleted/disabled BYOK key, sweep heartbeat failure |
| “Submit failing” | Ingress → accept → submit worker | ingress errors, `preflight_balance_rejected`, `admission_rejected`, `submit_job.failed`, `upstream_submit_failed` | auth/forwarding failure, insufficient balance, admission limits, lowering/preflight failure, provider rejection |
| “Provider accepted but no progress” | Submit journal → sweep | `batch_submitted_upstream`, `provider_outcome_journal_failed`, `provider_outcome_unknown`, `sweep.poll_failed` | ambiguous outcome fencing, provider job ID persistence failure, provider polling/API failure |
| “Results 402” | Results payment gate | `results_payment_blocked`, `results_settlement_pending`, `results_payment_unblocked` | failed or insufficient-balance charge, or reconciliation recorded `payment_required`; null/absent settlement is pending and returns metadata-only 200 |
| “Usage missing” | Output ingestion → generation emission | `emit_generations.done`, `missing_usage`, `fallback_usage_estimated`, `schema_validation_failed`, `unaccounted` | provider omitted usage, malformed output, input recovery failure, incomplete billing rollup |
| “Per-line failures concentrated on one provider” | Generation emission | per-line `Transaction attempt` with `line_index`, `success:false`, grouped by `provider_name` | provider-specific output failures, rate limiting, or upstream hard failures |
| “Estimated-usage billing elevated” | Generation emission and usage accounting | per-line `Transaction attempt` with `is_estimated_usage:true`; `fallback_usage_estimated` | provider omitted usage or output usage was malformed, causing fallback estimation |
| “Repeated ambiguous submit retries” | Async submit worker | umbrella `Transaction attempt` with `attempt_id` and `is_retry:true`; `retrying_cheap_ambiguous_submit` | timeout or unknown provider outcome triggering the bounded retry |
| “Batch finalized but results unavailable” | Materialization/read | `results_materialize_failed`, `completed_results_missing`, `stream_results_failed`, `serve_results.parse_failed` | immutable GCS artifact missing/unreadable, malformed materialized JSON, storage/read failure |
| “Batch disappeared after provider key change” | Sweep/finalize key resolution | `sweep.provider_key_disabled`, `finalize.provider_key_disabled`, `finalize.provider_key_unavailable`, `key_unavailable_*` | disabled key is temporarily skipped; deleted key causes terminal failure because upstream cannot be retrieved |

### Known failure modes

- **Ambiguous provider outcome:** after provider creation starts, the submit
  journal fences the job to prevent duplicate upstream batches. Only the
  bounded cheap platform-funded retry is automatic; other ambiguous outcomes
  require reconciliation. A `provider_outcome_journal_failed` event is
  different: its `upstream_batch_id` proves the provider call succeeded even
  though the journal replacement failed.
- **Missing provider job ID:** if persistence of the upstream ID fails after
  provider acceptance, the sweep cannot poll or finalize the job. See
  `batch_upstream_job_id_persist_failed.tf`.
- **Deleted BYOK key:** the upstream batch can no longer be polled and the
  job is terminally failed. A disabled key is reversible and remains in flight.
- **Fallback usage estimation:** missing or malformed provider usage can
  trigger estimated billing. Inspect `estimated`, `unaccounted`, and
  `is_usage_complete`; do not treat fallback estimation as exact provider
  usage.
- **Payment gate:** positive-cost results can remain blocked or settlement
  pending after finalization. Null/absent settlement is a metadata-only 200
  pending state; HTTP 402 means the settlement outcome is explicitly
  `payment_required`, such as a failed or insufficient-balance charge. This is
  a billing/access state, not a provider execution state.
- **Sweep heartbeat missing:** absence of `batch_api.sweep.completed` can mean
  scheduler, Cloud Run, or Spanner query failure. The existing stalled monitor
  alerts on this condition.
- **Pub/Sub redelivery:** finalize failures return 5xx so the message retries;
  repeated failures can indicate a poison job or memory/storage problem.
- **Ingress rate limiter fails open:** the rate-limit backend failure is logged
  as `Entity ratelimiter check failed open`; it does not reject the request.
- **Vertex infers one schema for the whole input file:** Vertex Gemini batch
  does not read each GCS JSONL line independently, so rows in a file are not
  isolated. Confirmed by prod probes (ECO-2808/ECO-2809): a `stopSequences`
  value that reads as a bare JSON scalar (`"7"`, `"true"`) is re-emitted
  unquoted and fails proto parsing when every value of that field in the file
  reads that way, but survives once one value in the file does not; a field
  set on only some rows (`responseJsonSchema`) leaks onto the rows that never
  sent it (`response_mime_type must be set when response_json_schema is set`);
  and one field carrying conflicting types across rows (schema `true` versus a
  schema object) fails the entire upstream job with no per-row results and no
  provider reason. The schemas are unioned rather than kept per row, so two rows
  carrying different `json_schema` schemas both fail with `Invalid
  response_json_schema: schema at properties.<the other row's field> must be a
  boolean or an object`, while rows sharing one schema succeed. Do not diagnose
  these as serializer bugs without first checking what the other rows in the
  same batch contain. A Vertex batch whose rows disagree on `response_format`,
  or on the `json_schema` schema, is now failed during the submit scan: Vertex
  lowering reports a per-line shared-input key and the scan compares it the way
  it compares the upstream path, so that error names the offending `custom_id`
  rather than coming from the provider.
- **Vertex job fails asynchronously on GCS bucket access, not at submit:**
  Vertex accepts a job whose input or output bucket is missing or unreadable
  and fails it during execution with no `completionStats`, so a job that
  shows `batch_submitted_upstream` and then `batch.adapter.vertex_job_error`
  with no per-row output may have never run inference. A writable-input but
  unwritable-output bucket fails later, after `completionStats.successfulCount`
  shows inference ran; whether that run is billed by Google was not measured.
  Check the Vertex AI service agent's read grant on the input bucket and write
  grant on `VERTEX_BATCH_OUTPUT_URI_PREFIX` before diagnosing the payload. See
  `docs/batch-research/google-vertex.md`.

## Metrics quick reference

| Metric | Query | Tags |
|---|---|---|
| Submit preflight | `p95:openrouter.batch_api.submit.preflight_duration_ms{*}` | `provider`, `family` |
| Submit lowering | `p95:openrouter.batch_api.submit.lowering_duration_ms{*}` | `provider`, `family` |
| Submit scan | `p95:openrouter.batch_api.submit.scan_duration_ms{*}` | `provider`, `family` |
| Batch line count | `p95:openrouter.batch_api.submit.line_count{*}` | `provider`, `family` |
| Submit attempt latency | `p95:openrouter.batch_api.submit.attempt_latency_ms{*}` | `latency_type`, `success`, `provider`, `is_retry` |
| Auth key lookup error | `sum:openrouter.batch_api.auth_service.key_lookup{outcome:error}.as_count()` | none |
| Auth key lookup timeout | `sum:openrouter.batch_api.auth_service.key_lookup{outcome:timeout}.as_count()` | none |
| Auth key lookup HTTP error | `sum:openrouter.batch_api.auth_service.key_lookup{outcome:http_error}.as_count()` | `status:<HTTP status>` |
| Auth key lookup parse error | `sum:openrouter.batch_api.auth_service.key_lookup{outcome:parse_error}.as_count()` | none |
| Auth key lookup unexpected shape | `sum:openrouter.batch_api.auth_service.key_lookup{outcome:unexpected_shape}.as_count()` | none |
| Auth key lookup success | `sum:openrouter.batch_api.auth_service.key_lookup{outcome:success}.as_count()` | `result:null` on null success |
| Identity-token error | `sum:openrouter.batch.identity_token.fetch.error{service:cfw-batch-api}.as_count()` | none |
| Identity-token success | `sum:openrouter.batch.identity_token.fetch.success{service:cfw-batch-api}.as_count()` | none |
| Identity-token latency | `p95:openrouter.batch.identity_token.fetch.latency_ms{service:cfw-batch-api}` | none |
| Finalize request count | `sum:openrouter.batch_api.finalize.request{*}.as_count()` | `outcome`, `provider` |
| Finalize request latency | `p95:openrouter.batch_api.finalize.request_duration_ms{*}` | `outcome`, `provider` |
| Finalize phase latency | `p95:openrouter.batch_api.finalize.phase_duration_ms{*}` | `phase`, `outcome`, `provider` |
| Generation-line outcomes | `sum:openrouter.batch_api.finalize.generation_lines{*} by {result}.as_count()` | `result` (`emitted`, `estimated`, `skipped`, `failed`, `unaccounted`), `provider` |
| Sweep candidates | `max:openrouter.batch_api.sweep.candidates_found{*}` | none |
| Sweep published | `sum:openrouter.batch_api.sweep.published{*}.as_count()` | none |
| Sweep tick latency | `p95:openrouter.batch_api.sweep.duration_ms{*}` | none |
| Sweep mark-polled | `sum:openrouter.batch_api.sweep.mark_polled{*}.as_count()` | `outcome`, `location` on error |

`finalize.generation_lines` counts per-line publication outcomes once per
generation-emission pass: `emitted` and `estimated` lines were published for
billing, `failed` aborted the pass for retry, `skipped` produced a
non-billable row error, and `unaccounted` lines were dropped without billing
or a row error. The result buckets are mutually exclusive. A retried pass
re-counts every line (downstream billing dedupes by generation ID, StatsD
does not), so read rates and the outcome mix, not absolute totals. Any
sustained nonzero `unaccounted` or `failed` rate is a billing-completeness
signal. `sweep.candidates_found` is a per-tick gauge of the candidate rows
read by the scan, capped by the 3000-row scan limit; only up to 400 eligible
candidates are polled per tick. A gauge pinned near 3000 means the scan
cannot see the whole backlog; sustained values above 400 mean the backlog
takes multiple ticks to drain.

No batch-specific metric covers provider poll attempts, poll latency/status,
result downloads, terminal status counts, or emitted-vs-billed reconciliation
against the downstream Dataflow sink. Use the structured events above.

## Reporting format

Use Debug Prod's shared RCA structure, retention caveat, and URL conventions.
Add the Batch API-specific stage and billing details below:

Return:

1. The batch ID/entity and time window, noting the 14-day retention boundary.
2. A chronological stage timeline with event names, timestamps, and key fields.
3. The first failing stage and the strongest evidence.
4. Whether the issue is client/admission, ingress, provider, orchestration,
   billing, storage, or results access.
5. A recommended next action and relevant dashboard/monitor/runbook links.

Do not claim “provider accepted” unless
`batch_api.batch_submitted_upstream`,
`batch_api.submit_job.provider_outcome_journal_failed`, or an adapter
submission log confirms it. Do not claim “usage is complete” unless
`batch_api.finalize.completed` reports `is_usage_complete:true`.
