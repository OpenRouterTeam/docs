# Mistral Batch API research note

Backfill of `research-batch-provider` for Mistral, written against the
adapter that is already in production (`packages/batch/adapters/mistral`).
Live captures were taken on 2026-09-02 against `https://api.mistral.ai` with
the platform development credential (Infisical `/services/batch-api`
`MISTRAL_API_KEY`), and against OpenRouter's public Batch API pinned with
`provider.only: ["Mistral"]`. The dogfood parity run is folded into the
"Dogfood evidence" section at the end. Raw transcripts are not committed;
the capture names quoted below identify the probe, and the job IDs let the
OpenRouter side be re-read from Datadog
(`service:batch-api* @data.jsonPayload.extra.job_id:<batch-id>`).

Provenance labels used below:

- **live capture**: observed on 2026-09-02; the probe capture is named.
- **official docs**: stated by a Mistral page; the URL is cited inline.
- **unconfirmed**: neither observed nor found in official docs.

## Official sources

Every official URL relied on in this note. Anchors point at the operation
blocks on the API reference pages.

- Batch inference guide (overview, request-line shape, status enum, FAQ
  on retention): https://docs.mistral.ai/capabilities/batch/
- API reference index: https://docs.mistral.ai/api/
- Batch jobs API reference page: https://docs.mistral.ai/api/endpoint/batch
  - Create: https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_create_batch_job
  - Retrieve: https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_get_batch_job
  - List: https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_get_batch_jobs
  - Cancel: https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_cancel_batch_job
  - Delete: https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_delete_batch_job
- Files API reference page (results are files): https://docs.mistral.ai/api/endpoint/files
  - Upload: https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_upload_file
  - Retrieve metadata: https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_retrieve_file
  - Download content (results): https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_download_file
  - Signed URL: https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_get_signed_url
  - Delete: https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_delete_file
- Status enum: the "List batch jobs" section of
  https://docs.mistral.ai/capabilities/batch/ and the official Python SDK
  model page
  https://raw.githubusercontent.com/mistralai/client-python/main/docs/models/batchjobstatus.md
- Job, request, and error shapes (official SDK model pages):
  https://raw.githubusercontent.com/mistralai/client-python/main/docs/models/batchjob.md,
  https://raw.githubusercontent.com/mistralai/client-python/main/docs/models/batchrequest.md,
  https://raw.githubusercontent.com/mistralai/client-python/main/docs/models/createbatchjobrequest.md,
  https://raw.githubusercontent.com/mistralai/client-python/main/docs/models/batcherror.md
- Pricing (batch discount): https://mistral.ai/pricing/
- Limits and retention: request cap in the guide
  https://docs.mistral.ai/capabilities/batch/, file size and `expires_at` on
  https://docs.mistral.ai/api/endpoint/files, `timeout_hours` on the create
  operation above, and the FAQ "Will batch results ever expire?" on
  https://docs.mistral.ai/capabilities/batch/

Mistral's docs site renders the API reference client-side, so
`https://docs.mistral.ai/api/#tag/batch` and `#tag/files` (the URLs in the
task brief) redirect to the `/api/endpoint/...` pages above. There is no
public OpenAPI JSON at `docs.mistral.ai/api/openapi.json` or
`api.mistral.ai/openapi.json` (both returned 404 on 2026-09-02).

## 1. Auth

- Bearer token: `Authorization: Bearer <key>` (official docs:
  https://docs.mistral.ai/api/). **live capture**: every successful native
  call used this header.
- Invalid key returns HTTP 401 `{"detail":"Invalid API Key"}` on both
  `GET /v1/models` and `POST /v1/batch/jobs` (**live capture**:
  `401-bad-auth-models.json`, `401-bad-auth-create.json`). Note the create call
  validates the `input_files` UUID shape before auth: a non-UUID file id
  with a bad key returns a 422 UUID parse error, not 401 (**live capture**,
  raw transcript only).
- Keys are workspace-scoped and batches are visible to every key in the
  workspace (official docs FAQ "Are batches specific to a workspace?"
  https://docs.mistral.ai/capabilities/batch/). **live capture**: the
  upstream job ids logged by production `batch_api.batch_submitted_upstream`
  events were retrievable with the development credential, so the
  development and production platform keys share one Mistral workspace
  (`status-running-medium-slow.json`).

## 2. Endpoints

All paths are relative to `https://api.mistral.ai` (the adapter's
`defaultBaseUrl`, overridable with `MISTRAL_BASE_URL`).

| Operation | Method and path | Adapter call site | Live result |
| --- | --- | --- | --- |
| Upload input | `POST /v1/files` multipart, `purpose=batch` (official docs: https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_upload_file) | `file-uploader.ts` | 200 file object, `sample_type: "batch_request"`, `num_lines` populated, `expires_at: null` (**live capture** `upload-200-happy-5.json`) |
| Create job | `POST /v1/batch/jobs` JSON `{input_files, model, endpoint, metadata?, timeout_hours?, agent_id?}` (official docs: https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_create_batch_job) | `batch-submitter.ts` | 200 job object, `status: "QUEUED"`, counters zero (**live capture** `create-200-happy-5.json`) |
| Retrieve job | `GET /v1/batch/jobs/{job_id}` (official docs: https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_get_batch_job) | `batch-poller.ts` | 200 job object (**live capture** `status-*.json`) |
| List jobs | `GET /v1/batch/jobs` with `status`/`metadata` filters (official docs: https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_get_batch_jobs) | not used | 200 `{data: [...], object: "list", total}` (**live capture** `list-jobs.json`) |
| Cancel job | `POST /v1/batch/jobs/{job_id}/cancel` (official docs: https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_cancel_batch_job) | not used | 200 job object; `CANCELLED` immediately when nothing had started, `CANCELLATION_REQUESTED` when running (**live capture** `cancel-200-before-start.json`, `cancel-200-cancellation-requested.json`) |
| Delete job | `DELETE /v1/batch/jobs/{job_id}` (official docs: https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_delete_batch_job) | not used | **unconfirmed** (not exercised) |
| File metadata | `GET /v1/files/{file_id}` (official docs: https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_retrieve_file) | not used | 200; output files carry `sample_type: "batch_result"`, `source: "mistral"`, `expires_at: null` (**live capture** `file-metadata-output.json`, `file-metadata-error.json`) |
| Download results | `GET /v1/files/{file_id}/content` (official docs: https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_download_file) | `file-downloader.ts` | 200 JSONL body (**live capture** `output-*.jsonl`, `error-*.jsonl`) |
| Signed URL | `GET /v1/files/{file_id}/url?expiry=<hours>` (official docs: https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_get_signed_url) | not used | **unconfirmed** (not exercised) |
| Delete file | `DELETE /v1/files/{file_id}` (official docs: https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_delete_file) | not used | **unconfirmed** (not exercised) |

The create operation also accepts inline `requests: BatchRequest[]` as an
alternative to `input_files` (official docs:
https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_create_batch_job).
The adapter uses file ingest only (`ingestMode = BatchIngestMode.File`).
Inline mode is **unconfirmed** live.

Create-time validation observed (**live capture**):

- Unknown `input_files` UUID: 404 `create-404-missing-file.json`.
- `timeout_hours: 0`: 422 (minimum 1) `create-422-timeout-hours-0.json`;
  `timeout_hours: 168`: 200 `create-200-timeout-hours-168.json`.
- `endpoint: "/v1/responses"`: 422 `create-422-unsupported-endpoint.json`.
  The documented enum is `/v1/chat/completions`, `/v1/embeddings`,
  `/v1/fim/completions`, `/v1/moderations`, `/v1/chat/moderations`,
  `/v1/ocr`, `/v1/classifications`, `/v1/chat/classifications`,
  `/v1/conversations`, `/v1/audio/transcriptions` (official docs:
  https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_create_batch_job).
- Unknown model: 422 `create-422-unsupported-model.json`.

## 3. Native request-line shape

Each JSONL line is `{"custom_id": "<string>", "body": {<raw endpoint request>}}`
with no `method` or `url`; the endpoint is a job-level field (official docs:
https://docs.mistral.ai/capabilities/batch/ "Prepare Batch"). `body.model`
is optional in the line because the job's `model` applies (official docs
example omits it; **live capture** `inputs/happy-5.jsonl` lines both with
and without `body.model` were accepted).

How the adapter lowers an OpenRouter line (**code**, `transform.ts:38` and
`from-internal-request.ts`):

1. The OpenRouter chat body is normalized through the shared internal
   request, serialized with the sync OpenAI chat serializer, then run
   through the sync Mistral serializer (`serializeMistralRequest`,
   `transformMistralMessages`, `getMistralPromptMode`) so batch and sync
   emit the same upstream body.
2. The result is written as `{"custom_id": item.custom_id, "body": <serialized>}`,
   one line per request, and uploaded as `batch_input.jsonl` with
   `purpose=batch`.
3. The job is created with `input_files: [<file id>]`, `model: <upstream
   model id>`, `endpoint: "/v1/chat/completions"` (`MISTRAL_BATCH_ENDPOINT`).
   The adapter sends no `metadata` and no `timeout_hours`, so the job gets
   the documented default of 24 hours (official docs:
   https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_create_batch_job_request_timeout_hours).

Upload-time validation is schema-level and rejects the whole file (**live
capture**, all HTTP 422 with `"detail": "Invalid file format."` and a
pydantic error list): malformed JSON line `upload-422-malformed-jsonl.json`,
invalid role / bad tool schema `upload-422-invalid-lines.json`,
`max_tokens: -5` `upload-422-negative-max-tokens.json`, `temperature: 2.0`
(`Input should be less than or equal to 1.5`) `upload-422-temperature-2.json`.
`max_tokens: 10000000` was accepted at upload and the job succeeded with a
50-token completion, so Mistral clamps rather than rejects oversized
`max_tokens` (**live capture** `upload-200-max-tokens-huge.json`,
`output-max-tokens-huge.jsonl`).

`custom_id` is described as unique (official docs:
https://docs.mistral.ai/capabilities/batch/ "A unique custom_id"), but
duplicate and absent `custom_id` values were accepted at upload and the job
succeeded, emitting two rows with `custom_id: "dup"` and one with
`custom_id: null` (**live capture** `output-ids-4.jsonl`). OpenRouter
rejects both before upload (section 10), so the adapter never relies on
Mistral enforcing uniqueness.

## 4. Exhaustive upstream status model

Documented enum (official docs: https://docs.mistral.ai/capabilities/batch/
"List batch jobs" and
https://raw.githubusercontent.com/mistralai/client-python/main/docs/models/batchjobstatus.md):
`QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, `TIMEOUT_EXCEEDED`,
`CANCELLATION_REQUESTED`, `CANCELLED`. The adapter's `MistralBatchStatusSchema`
enumerates exactly these seven, and `toUpstreamStatus` (`status.ts`) is an
exhaustive switch.

| Mistral status | Observed | Adapter `UpstreamBatchStatus` | Terminal |
| --- | --- | --- | --- |
| `QUEUED` | **live capture** `status-queued.json` (counters zero, `started_at` set) | `validating` | no |
| `RUNNING` | **live capture** `status-running.json` | `in_progress` | no |
| `SUCCESS` | **live capture** `status-success-all-5.json`, `status-success-partial-4of5.json`, `status-success-partial-2of4.json` | `completed` | yes |
| `FAILED` | **unconfirmed** (no input found that fails the whole job after upload validation) | `failed` | yes |
| `TIMEOUT_EXCEEDED` | **unconfirmed** (minimum `timeout_hours` is 1, not waited) | `expired` | yes |
| `CANCELLATION_REQUESTED` | **live capture** `cancel-200-cancellation-requested.json` | `cancelling` | no |
| `CANCELLED` | **live capture** `status-cancelled-before-start.json`, `status-cancelled-race-8of8-with-output.json` | `cancelled` | yes |

Counters on the job object (**live capture**, all `status-*.json`):
`total_requests`, `completed_requests`, `succeeded_requests`,
`failed_requests`, plus `started_at`, `completed_at`, `output_file`,
`error_file`, `errors[]`, `outputs`, `metadata`, `agent_id`.

Completion and failure semantics:

- **Does terminal mean every request is done?** `SUCCESS` means every line
  was processed, not that every line succeeded: a 4-line job finished
  `SUCCESS` with `completed_requests: 4, succeeded_requests: 2,
  failed_requests: 2` and both `output_file` and `error_file` set
  (**live capture** `status-success-partial-2of4.json`). `completed_requests`
  is processed-count (successes plus failures), which is why the adapter
  reports `succeeded_requests` as the shared `completed` counter
  (`batch-poller.ts:48`).
- `CANCELLED` does not mean nothing ran. Cancelling an 8-line job while
  `RUNNING` returned `CANCELLATION_REQUESTED`, and the next poll was
  `CANCELLED` with `completed_requests: 8, succeeded_requests: 8`,
  `completed_at` set, and an `output_file` containing 8 successful rows
  (**live capture** `status-cancelled-race-8of8-with-output.json`,
  `output-cancelled-race.jsonl`). Cancelling before any line started
  returned `CANCELLED` directly with counters zero and no files
  (`status-cancelled-before-start.json`).
- Counters were monotonic in every capture (**live capture**); whether a
  cancel can revert them is **unconfirmed**.
- `errors[]` is populated on `SUCCESS` too when lines failed:
  `[{"message": "HTTP Error, status code: 400", "count": 2}]`
  (**live capture** `status-success-partial-2of4.json`). The SDK model
  documents `BatchError` as `{message, count}` (official docs:
  https://raw.githubusercontent.com/mistralai/client-python/main/docs/models/batcherror.md);
  no `code` field exists, so the adapter's `failure_codes` (which reads
  `entry.code`) is always `null` for Mistral.
- What `errors[]` carries on a job-level `FAILED` is **unconfirmed**.

## 5. Output and error shapes

Successful rows are in `output_file`; failed rows are in a separate
`error_file` (official docs: https://docs.mistral.ai/capabilities/batch/
"Retrieve Results"; **live capture** partial jobs above). A job with no
failures has `error_file: null` (**live capture** `status-success-all-5.json`);
a mixed job has both files set (**live capture**
`status-success-partial-2of4.json`, `error-sad2-4.jsonl` with
`output-sad2-4.jsonl`). Whether a job where every line failed reports
`output_file: null` with only `error_file` set is **unconfirmed**: no
committed status capture has `succeeded_requests: 0` with
`failed_requests > 0`.

Row shape, identical in both files (**live capture** `output-happy-5.jsonl`,
`error-mixed2-5.jsonl`):

```json
{"id": "batch-<8hex>-<8hex>-<n>", "custom_id": "<id or null>",
 "response": {"status_code": 200, "body": {"id": "...", "object": "chat.completion", "model": "...", "usage": {...}, "created": 1788379763, "choices": [...]}},
 "error": null}
```

- Success rows: `response.status_code: 200`, `response.body` is a JSON
  object equal to a sync chat completion, including `usage`
  (`prompt_tokens`, `completion_tokens`, `total_tokens`,
  `prompt_tokens_details.cached_tokens`, `request_count`, and nulls for
  audio and service tier fields).
- Failed rows: `response.status_code: 400`, `response.body` is a JSON
  **string** (not an object) encoding
  `{"object":"error","message":"...","type":"invalid_request_file","param":null,"code":"3310","raw_status_code":400}`,
  and `error: null` (**live capture** `error-mixed2-5.jsonl`,
  `error-img-3.jsonl`). Failed rows carry `custom_id` and `id` and carry no
  `usage`.
- Are failed lines charged? Failed rows have no usage, so nothing is
  billable from the artifact (**live capture**). Whether Mistral bills the
  workspace for them is **unconfirmed** (no billing export was consulted).
- Results readable on `SUCCESS` with partial failures: yes, both files
  (**live capture**). On `CANCELLED`: yes when an `output_file` exists
  (**live capture** `output-cancelled-race.jsonl`). On `FAILED` and
  `TIMEOUT_EXCEEDED`: **unconfirmed**.
- File metadata for result files reports `bytes`, `num_lines`,
  `sample_type: "batch_result"`, `source: "mistral"`, `expires_at: null`
  (**live capture** `file-metadata-output.json`).

## 6. Limits

- Up to 1 million requests per batch (official docs:
  https://docs.mistral.ai/capabilities/batch/ "Batch Inference"). Not
  approached live.
- Individual files up to 512 MB (official docs:
  https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_upload_file).
- `timeout_hours` default 24 (official docs:
  https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_create_batch_job_request_timeout_hours);
  minimum 1 and 168 accepted (**live capture**
  `create-422-timeout-hours-0.json`, `create-200-timeout-hours-168.json`).
  The upper bound is **unconfirmed**.
- Batches may slightly exceed the workspace spend limit (official docs FAQ
  "Can batches exceed the spend limit?" https://docs.mistral.ai/capabilities/batch/).
- No rate-limit response was hit during roughly 60 native calls
  (**live capture**); rate-limit shape is **unconfirmed**.
- Throughput: `ministral-3b-latest` 5-line jobs completed in under two
  minutes; a 1-line `mistral-medium-3-5` job was still `RUNNING` about 40
  minutes after creation (**live capture**
  `status-running-medium-slow-40min.json`). Mistral makes no completion-time
  promise other than `timeout_hours` (official docs:
  https://docs.mistral.ai/capabilities/batch/).

## 7. Expiry and retention

- "Will batch results ever expire? No, the results do not expire at this
  time." (official docs FAQ: https://docs.mistral.ai/capabilities/batch/).
- Input and result files report `expires_at: null` (**live capture**
  `upload-200-happy-5.json`, `file-metadata-output.json`); the upload
  operation accepts an optional `expiry` and files carry `expires_at`
  (official docs:
  https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_upload_file_request_expiry).
- Files can be deleted explicitly (official docs:
  https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_delete_file)
  and jobs can be deleted (official docs:
  https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_delete_batch_job).
  The adapter deletes nothing; input and result files accumulate in the
  workspace indefinitely.
- Signed URLs default to 24 hours and accept 1 to 168 (official docs:
  https://docs.mistral.ai/api/endpoint/files#operation-files_api_routes_get_signed_url_parameters_expiry).
- OpenRouter's own copy of the artifact expires after 30 days
  (`services/batch-api/AGENTS.md` "Retention").

## 8. Pricing

- "Batch processing, for high-volume work, reduces the price by 50%"
  (official docs: https://mistral.ai/pricing/ "How is API pricing
  calculated?"). Per-model list prices render client-side on that page and
  were not captured; no per-model figure is asserted here.
- OpenRouter's `:batch` endpoints bill at half the sync price (**live
  capture**): `mistralai/ministral-8b-2512` sync `$0.15/M` in and out,
  batch `usage.cost` `8.25e-7` for 6 prompt + 5 completion tokens =
  `11 × 0.075e-6`; `mistralai/mistral-small-2603` sync `$0.15/M` in,
  `$0.60/M` out, batch cost `2.85e-6` for 18 + 5 tokens =
  `18 × 0.075e-6 + 5 × 0.3e-6` (`terminal-probe-*.json`, Datadog
  `batch_api.finalize.completed.finalized_cost`).
- Cached prompt tokens are reported in
  `usage.prompt_tokens_details.cached_tokens` (**live capture**, always 0
  in these runs); whether batch applies the cached-input discount is
  **unconfirmed**.

## 9. Sync-transform overrides

The sync adapter (`packages/router/adapters/mistral/index.ts`) overrides
`transformRequest` and the batch lowering reuses the same pure pieces
(`from-internal-request.ts`):

- `normalizeMistralMessages` and `transformMistralMessages` (message
  shape, tool-call id handling).
- `getMistralPromptMode` (`mistral-prompt-mode.ts`): sets
  `prompt_mode: "reasoning"` only for `mistralai/magistral-*` permaslugs on
  endpoints with `supports_reasoning` when reasoning is enabled.
  **live capture**: sending `prompt_mode: "reasoning"` to
  `mistral-small-latest` synchronously returned 400
  (`sync-400-prompt-mode-reasoning.json`); the same body to
  `magistral-small-latest` in batch was accepted
  (`output-reasoning-prompt-mode.jsonl`), and `reasoning_effort: "high"`
  with `top_p: 1` produced a `thinking` content block
  (`output-reasoning-effort-high.jsonl`, `sync-200-reasoning-effort-high.json`).
- `serializeMistralRequest` (`mistral-request-serializer.ts`) maps
  `reasoning_effort` and `top_p` and drops OpenAI-only fields.
- Response side: `parseMistralCompletionBody` in `output-parser.ts` runs
  each batch row body through `normalizeMistralBatchBody`, which applies the
  shared `normalizeMistralResponseBody` and `normalizeMistralUsage` from
  `mistral-response-normalizer.ts` (plus a `tool_calls: null` to `[]`
  rewrite) before validating against the chat-completion shape, so sync
  and batch share the response normalizer.

Divergence between sync and batch found here: none in the lowered body
(both go through `serializeMistralRequest`). The sync path's 400 for
`prompt_mode` on a non-Magistral model is a per-request rejection, whereas
in batch an equivalent bad parameter is either a 422 at upload (whole file)
or a per-line 400 row (section 5).

## 10. OpenRouter mapping decision

`MistralBatchAdapter` (`mistral-batch-adapter.ts`): `ingestMode = File`,
`resultMode = FileHandle`, `customIdConstraints = null`.

`pollBatch` (`batch-poller.ts:36-55`, `toPollResult`):

| Shared field | Source | Note |
| --- | --- | --- |
| `status` | `toUpstreamStatus(batch.status)` | table in section 4 |
| `request_counts.total` | `total_requests ?? 0` | `0` in the create response, populated by the first poll (**live capture** `create-200-happy-5.json` has `total_requests: 0`, `status-queued.json` has `total_requests: 1`); finalization keeps the accept-time total when a provider reports all zeros (`finalize-batch-job.ts` `rejectedCounts`) |
| `request_counts.completed` | `succeeded_requests ?? 0` | deliberately not `completed_requests`, which counts failures too (**live capture** `status-success-partial-2of4.json`) |
| `request_counts.failed` | `failed_requests ?? 0` | |
| `output_file_id` | `output_file ?? null` | |
| `error_file_id` | `error_file ?? null` | |
| `failure_reason` | `summarizeBatchFailureReasons(errors)` only when status is `failed` or `expired`, else `null` | |
| `failure_codes` | codes from `errors[].code` | always `null`: Mistral `BatchError` has no `code` (section 4) |

`fetchNativeResults` downloads `output_file_id ?? error_file_id`
(`base.ts:179`, one handle per call). Finalization calls it twice on a
partially failed `SUCCESS` job, once with the output handle into
`output/raw_response`, once with only the error handle into
`error/raw_response` (`services/batch-api/src/finalize/process-completed-batch.ts:68-99`)
and the serve reader walks `[outputUri, errorUri]` in order
(`services/batch-api/src/read/batch-gcs-results-reader.ts:95`), so failed
rows are served after the successful rows with their `custom_id` and
error message. Not exercised through OpenRouter live (every candidate bad
line was rejected at admission, section 10); the two-file path is covered
by the shared finalize tests, not by a Mistral fixture.

`parseResult` (`output-parser.ts`, `parseMistralBatchResult`):

- Row with `response` object and `status_code` 2xx: canonical success row,
  `id`, `custom_id`, `response.body` passed to the completions skin.
- Row with `response.status_code` >= 400: canonical error row; the error is
  parsed from `response.body`, then from `error`, then from the status code
  (`output-parser.ts:55-67`). Live error rows carry `response.body` as a
  JSON **string** (**live capture** `error-mixed2-5.jsonl`), and
  `parseMistralError` only reads objects (`output-parser.ts:145`), so the
  served error is the generic `Upstream request failed with status 400.`
  and the provider's `message`/`type`/`code` are dropped (**reproduced**
  2026-09-02 by running `parseMistralBatchResult` on that capture). See
  divergence D1.
- Row with no `response`: canonical error row from `error`, with fallback
  id `mistral-error-<lineIndex>` when `id`/`custom_id` are missing.

`parseUsage` (`parseMistralBatchUsage`) validates the body with
`parseMistralCompletionBody` and returns `usage ?? null`; failed rows carry
no usage and are never billed.

OpenRouter-side behavior observed through the public API (**live capture**):

- Models without a `:batch` endpoint are rejected at submit: 400
  `Model 'mistralai/ministral-3b-2512' does not have a :batch endpoint`
  (`400-no-batch-endpoint-ministral-3b.json`, same for
  `mistralai/magistral-small-2509`, so no Magistral reasoning run was
  possible through OpenRouter). Eligible and used:
  `mistralai/ministral-8b-2512`, `mistralai/mistral-small-2603`,
  `mistralai/mistral-medium-3.5-20260430`.
- Request-level `body.model` must equal the top-level `model`
  (`400-body-model-mismatch.json`); duplicate `custom_id` is 422
  (`422-duplicate-custom-id.json`); missing `custom_id` is 400
  (`400-missing-custom-id.json`).
- Submission is accepted with 202 `status: "validating"` and then either
  reaches `in_progress` after `batch_api.batch_submitted_upstream`, or
  goes straight to `failed` with `finalized_at` set, `request_counts.failed
  == total`, `results: null`, and `error.message` naming the offending
  `custom_id`. Every line-level admission or lowering error fails the whole
  batch before any upstream call: image URL parts, `file`/document parts on
  models without file input,
  empty `messages`, `max_tokens < 1`, and `max_tokens` beyond the endpoint
  context (`terminal-failed-*.json`; Datadog
  `batch_api.submit.lowering_failed` then
  `batch_api.submit_job.failed reason=validation-failed`).
- There is no public cancel route. `POST /api/beta/batches/:id/cancel`
  returned plain-text 404 on two separate `validating` batches, and the
  second batch went on to complete and bill normally
  (`404-cancel-route.txt`, `404-cancel-route-second-attempt.txt`,
  `terminal-completed-after-cancel-404.json`). The edge routes are
  `POST /`, `GET /:id`, `GET /` only (`packages/batch/routes/submit.ts:168`,
  `poll.ts:61`, `list.ts:52`), and `finalize-batch-job.ts:695-703` notes that
  `cancelled` is reached only when a BYOK caller cancels in the provider
  console. The public docs (`projects/docs/batch-quickstart.mdx`) list
  `cancelling`/`cancelled` statuses but document no cancel endpoint.

## 11. OpenRouter endpoint intersection

| OpenRouter batch endpoint | Mistral batch `endpoint` | Adapter |
| --- | --- | --- |
| `/v1/chat/completions` | `/v1/chat/completions` (official docs: create operation above) | supported, the only one lowered (`from-internal-request.ts` rejects non-chat with "supports chat completions only") |
| `/v1/responses` | not in Mistral's enum; 422 live (`create-422-unsupported-endpoint.json`) | not supported |
| `/v1/messages` | not in Mistral's enum (official docs) | not supported |
| `/v1/embeddings` | `/v1/embeddings` exists natively (official docs) | not implemented by the adapter; **unconfirmed** live |

Mistral also offers `/v1/fim/completions`, `/v1/moderations`,
`/v1/chat/moderations`, `/v1/ocr`, `/v1/classifications`,
`/v1/chat/classifications`, `/v1/conversations`,
`/v1/audio/transcriptions` in batch (official docs:
https://docs.mistral.ai/api/endpoint/batch#operation-jobs_api_routes_batch_create_batch_job);
none has an OpenRouter batch family.

## 12. Platform versus BYOK credential shape

- **Platform**: registered in
  `services/batch-api/src/adapters/optional-api-key-providers.ts:12-20`
  with `apiKeyEnvVar: 'MISTRAL_API_KEY'`, `baseUrlEnvVar: 'MISTRAL_BASE_URL'`,
  `defaultBaseUrl: 'https://api.mistral.ai'`, disabled-log key
  `batch_api.mistral.provider_disabled` when the env var is absent. The
  key is a plain Mistral workspace API key (section 1).
- **BYOK**: `supportsByok: false`. The flag was introduced by
  [#38260](https://github.com/OpenRouterTeam/openrouter-web/pull/38260)
  when the optional-provider table gained BYOK for xAI; the code carries no
  Mistral-specific rationale, and `byok-support.ts:5-13` describes the set
  generically as providers whose batch adapters cannot build a user-key
  adapter. Effect (`apply-byok-endpoint-overlay.ts`, `isBatchByokProvider`):
  a user's Mistral BYOK key is ignored for batch and the job runs on the
  platform key. **live capture**: every completed OpenRouter batch reported
  `usage.is_byok: false`. Whether the test workspace had a Mistral provider
  key attached was not determinable from the API, so "BYOK key present,
  routed to platform" is **unconfirmed** as a controlled experiment.
- **ZDR**: `MISTRAL_ZDR_API_KEY` exists in Infisical but the batch service
  reads only `MISTRAL_API_KEY`. Batch does not honor ZDR routing: when the
  caller's privacy settings enable ZDR for the Mistral bucket, submission is
  rejected with `zdr-retention`
  (`services/batch-api/src/submit/accept/batch-privacy.ts`). Not exercised
  live (**unconfirmed**; requires a ZDR-enabled key).

## 13. Artifact handles

- Input: one Mistral file id (UUID) from `POST /v1/files`, referenced in
  `input_files` (**live capture**).
- Output: `output_file` and `error_file` are Mistral file ids (UUIDs),
  each `null` until the job is terminal and `null` permanently when no row
  of that kind exists (**live capture** section 5). The adapter stores them
  as `output_file_id` / `error_file_id`.
- Row ids: `batch-<8hex>-<8hex>-<lineIndex>`; OpenRouter re-serves them
  unchanged in `results[].id` (**live capture** `terminal-happy-5.json`).
- Upstream job id: UUID, logged as `upstream_batch_id` in
  `batch_api.batch_submitted_upstream` (**live capture**, Datadog).
- Handles do not expire (section 7).

## 14. Remote URL inputs

- Public image URL (`image_url` part) natively: supported when Mistral can
  fetch the URL. `ministral-3b-latest` (the job model, a multimodal
  Ministral) returned 200 rows describing a Google-hosted photo and a
  GitHub-hosted logo, and an unreachable URL produced a per-line 400 row with
  `type: "invalid_request_file"`, `code: "3310"`, message `File could not be
  fetched from url '...'` (**live capture** `output-img-3.jsonl`,
  `error-img-3.jsonl`). Mistral's own docs example image URL
  (`tripfixers.com/...eiffel-tower...`) was itself unfetchable and produced
  the same 3310 row. `pixtral-12b-latest` was not exercised
  (**unconfirmed** for that model specifically).
- Public file/PDF URL (`document_url` part) natively: a public arXiv PDF
  line returned a 200 row with the correct title and 12,592 prompt tokens
  (**live capture** `output-features-5.jsonl` row `feat-doc-url`,
  `ministral-3b-latest`). An unfetchable `document_url` did **not** fail the
  line: `sad-doc-url-404` returned 200 with a made-up title and 58 tokens
  (`output-sad2-4.jsonl`), unlike an unfetchable `image_url`, which is a
  per-line 400. Whether that is a Mistral-side silent drop or a fetch of
  arXiv's HTML 404 page is **unconfirmed**.
- Adapter switches: `image-url-support.ts:29-33` marks Mistral
  `supported: false` with the comment "native batch image behavior is not
  verified", but the live capture above verifies it works, see divergence D3.
  `file-url-support.ts:27-29` returns `true` for Mistral, but admission also
  requires the model to accept `file` input, `supports_multipart`, and
  `features.supports_file_urls` (`resolve-batch-content-options.ts`), and
  the generic content guard `assert-supported-batch-content.ts` rejects
  `file`/document parts otherwise. Live: `file` parts failed admission on
  `ministral-8b-2512` and `mistral-small-2603`
  (`terminal-failed-file-url-*.json`), a Mistral-native `document_url` part
  failed admission on every model (`terminal-failed-document-url.json`),
  and a `file` part with a URL `file_data` on
  `mistral-medium-3.5-20260430` was admitted and submitted upstream
  (`batch_api.batch_submitted_upstream`, `in-progress-file-url-mistral-medium.json`)
  but had not finished when this note was written, so the OpenRouter-served
  result of a file URL is **unconfirmed**.

## Divergences found between adapter and observed/documented behavior

- **D1. Error-file rows lose the provider's error message.** Every
  captured `error_file` row has `response: {status_code: 400, body:
  "<JSON string>"}` and `error: null` (**live capture**
  `error-mixed2-5.jsonl`, `error-img-3.jsonl`, `error-sad2-4.jsonl`,
  `error-features-5.jsonl`). `parseMistralBatchResult` tries
  `parseMistralError(response.body)` but that helper accepts only objects
  (`output-parser.ts:64`, `:145`), so the row falls through to
  `batchErrorFromResponse` and is served as `type: invalid_request_error`,
  `message: "Upstream request failed with status 400."`, and the real
  `message` ("File could not be fetched from url ..."), `type`
  (`invalid_request_file`) and `code` (`3310`) are discarded
  (**reproduced** 2026-09-02). The sync path forwards the raw upstream
  error body text as the error message
  (`packages/router/adapters/base/index.ts:1748`, `captureFetchError`), so
  the same Mistral error reaches a sync caller intact. The shared finalize
  path does persist and serve the error file as a second artifact (section
  10), so the row and its `custom_id` are served; only the reason is lost.
  `packages/batch/adapters/mistral/fixtures/` has no error-file row and
  every parser test uses hand-built object bodies, which is why this was
  not caught. Smallest fix: `JSON.parse` a string `response.body` through
  a Zod `z.string()` guard before `parseMistralError`, plus a fixture test
  on a captured error row asserting the provider `message` and `type`
  survive.
- **D2. `CANCELLED` with a full `output_file` is not finalized.** Mistral
  can return `CANCELLED` with all requests completed and an `output_file`
  when cancellation races completion (**live capture**
  `status-cancelled-race-8of8-with-output.json`). Finalization only
  processes artifacts for upstream `completed`; `cancelled` is a terminal
  outcome with no artifact read (`services/batch-api/src/finalize/process-completed-batch.ts:153`, `isUpstreamCompleted`). Those rows
  are billable by the provider and unserved by OpenRouter. Reachable today
  only if someone cancels the job in the Mistral console, since there is no
  public cancel route (section 10). Smallest fix: treat `cancelled` with
  `output_file_id` set like `completed` for artifact and billing purposes.
- **D3. `image-url-support.ts` comment is stale.** It says Mistral's
  native batch image behavior "is not verified"; `ministral-3b-latest`
  processed two public image URLs in batch (**live capture**
  `output-img-3.jsonl`). The `supported: false` decision may still be right
  (fetch failures surface as per-line 3310 rows, and the Batch API is
  text-only today) but the comment should cite this note.
- **D4. `failure_codes` can never populate.** `extractBatchFailureCodes`
  reads `errors[].code`; Mistral's `BatchError` is `{message, count}`
  (official docs:
  https://raw.githubusercontent.com/mistralai/client-python/main/docs/models/batcherror.md;
  **live capture** `status-success-partial-2of4.json`). Harmless, but the
  `provider_failure_codes` log field is always empty for Mistral.
- **D5. Docs say `custom_id` is unique; the API does not enforce it.**
  Duplicate and null `custom_id` rows were processed natively
  (**live capture** `output-ids-4.jsonl`). OpenRouter enforces uniqueness
  and presence itself, so no customer impact.
- **D6. Sync-path 1.5 temperature ceiling is enforced at upload in batch.**
  `temperature: 2.0` (valid on OpenRouter's sync schema) is a 422 for the
  whole file natively (**live capture** `upload-422-temperature-2.json`).
  Whether OpenRouter clamps it before lowering was not tested
  (**unconfirmed**); if it does not, one such line would fail the whole
  batch at Mistral's upload step rather than per line.

## Dogfood evidence (2026-09-02)

About 20 native jobs of 1 to 8 lines and 19 OpenRouter batches of 1 to 5
lines, each confirmed `batch_accepted.provider_name == "Mistral"`.

**Provider verdict: NOT SAFE** by the skill's rule (one open `BUG`, D1).
Practical reading: results and billing are correct for all-successful
workloads, and the D1 fix gates `SAFE WITH KNOWN LIMITS`. Limits to carry
forward after D1: no cancel route (D2 unreachable), `FAILED` and
`TIMEOUT_EXCEEDED` never induced, BYOK and ZDR untested, Magistral not
batch-eligible on OpenRouter, image and file parts rejected at admission.

Billing (**live capture** plus Datadog `finalize.completed` and
`emit_generations.done`, all `is_usage_complete=True`, `estimated=0
skipped=0 unaccounted=0`):

- `batch-1788380503-OJEftodk3j3N0YkHKkaK` (plain, tools, multi system,
  multi turn, truncate): `finalized_cost=1.3275e-05` = `177 tokens ×
  0.075e-6`, half the `$0.15/M` sync price, `total=5 succeeded=5 failed=0
  emitted=5`. Served rows match the native rows per `custom_id` (finish
  reasons `stop`/`tool_calls`/`length`/`stop`/`length`).
- `batch-1788380521-w4RrVv6i9kQSy3zLBZLR` (`tool_choice: none`,
  `json_schema`): `4.65e-06` = `62 × 0.075e-6`, json_schema content
  identical on both sides.
- `batch-1788382924-J67dD8yx6tfQ15KRVbBv`: billed `8.25e-07` after the
  cancel 404 (section 10). Five completed jobs total `2.2425e-5`. Native
  error rows carry no usage and were never billed.

Quirks a test writer needs (**live capture**):

- Native upload rejects the whole file with one 422: `Invalid file format.
  Chat too large or missing. Format your file using newline delimited JSON`
  for a malformed line, `Invalid file format.` plus a pydantic list for bad
  roles, empty `messages`, `max_tokens: -5`, `temperature: 2`. OpenRouter
  names the first offending line and rejects `max_tokens: -5` with `sets
  'max_tokens' below 1`.
- Native create: inaccessible model 422 `You do not have access to the
  model`, `timeout_hours: 0` 422 `greater_than_equal`. A per-line
  `body.model` (`does-not-exist-9000`) is silently ignored in favor of the
  job model, where OpenRouter returns 400 on a model mismatch.
- Duplicate `custom_id` (`dup`) and a missing `custom_id` run natively;
  OpenRouter: 422 `Request at line 2 has a duplicate custom_id 'dup'`, 400
  `custom_id: Invalid input: expected string`.
- `max_tokens: 10000000` succeeds natively with `finish_reason: stop`;
  OpenRouter fails the batch at lowering with `maximum context length is
  262144 tokens` (`batch-1788382900`, `batch-1788382026`, `status=400`).
- Image parts on OpenRouter: 422 `batch adapter 'MistralBatchAdapter' does
  not support native image URLs; use the sync API` (`batch-1788380504`,
  `batch-1788380660`); file parts `batch-1788380505`, `-590`, `-659`.
- Cancel before start: immediate `CANCELLED`, counters 0, no artifacts.
  Cancel 15 s into an 8-line job: `CANCELLED`, 8/8 succeeded, readable
  `output_file` (D2).

`UNTESTED` and the missing prerequisite:

- OpenRouter partial success: no line passes admission and fails at Mistral
  (`batch-1788380522` failed whole on its image line).
- OpenRouter Magistral reasoning: no `:batch` endpoint. Natively
  `reasoning_effort: "high"` produced `thinking` parts, 214 tokens.
- OpenRouter file URL on a file-capable model
  (`batch-1788382168-ylcvUKuCSaGERRPUjpVm`, upstream `<uuid:882cdc39>`) and
  the plain probe `batch-1788380480-vQaDB8KQqDh5but3n1V6` were still
  `in_progress` at 21:23 UTC (native `mistral-medium-3-5` sibling
  `RUNNING` after 60 min).
- Native `FAILED` and `TIMEOUT_EXCEEDED`: whole-job bad input is rejected
  at upload or create, minimum `timeout_hours` is 1. Next: 1-line
  `mistral-medium-3-5` job with `timeout_hours: 1`.
- BYOK, ZDR, bad platform key: need a workspace-attached Mistral key, a
  ZDR-enforced test key, and control of the service env.
- Job-size and rate limits (section 6): no 429 seen, no burst attempted.
