# Fireworks batch inference — research note

Provider research for the Fireworks batch adapter. Everything marked **live**
was captured on 2026-08-30 against `https://api.fireworks.ai` with the
platform `FIREWORKS_API_KEY` (account sanitized to `example-account`); everything marked
**docs** comes from the official documentation and was not independently
verified.

## Primary documentation

- Guide: <https://docs.fireworks.ai/guides/batch-inference>
- API reference: `create-batch-inference-job`, `get-batch-inference-job`,
  `list-batch-inference-jobs`, `create-dataset`, `upload-dataset-files`,
  `get-dataset-download-endpoint`, `get-dataset` under
  <https://docs.fireworks.ai/api-reference/>

## Authentication

`Authorization: Bearer <api key>` on every call (live). A bad key returns
HTTP 403 with an OpenAI-style `error` envelope
(`{"error":{"message":"The API key you provided is invalid.","code":"UNAUTHORIZED",...}}`)
— see the invalid-API-key transcript below (live). The gRPC-style
`{code, message}` body appears on other control-plane errors (e.g. the 404
`resource not found` and 400 `example_count is required` captures), not on
bad-key auth failures.

## API model

Fireworks batch is **dataset-driven**, not OpenAI-Files-style:

1. Create a dataset (`POST /v1/accounts/{acct}/datasets` with
   `{datasetId, dataset: {userUploaded: {}, exampleCount: "<n>"}}`) (live).
2. Upload JSONL to it (`POST .../datasets/{id}:upload`, multipart `file`
   field) (live). The dataset transitions to `READY` (live).
3. Create the job
   (`POST /v1/accounts/{acct}/batchInferenceJobs?batchInferenceJobId={id}`
   with `{model, inputDatasetId}`) (live). The request also accepts an
   optional `inferenceParameters` object with job-level defaults such as
   `maxTokens` and `extraBody` (docs); the live captures sent only
   `{model, inputDatasetId}`, and every job response came back with a
   server-populated `inferenceParameters` (at minimum
   `{"extraBody": "{}"}` — see the transcripts below). The **model is
   job-level**, not per input line. Fireworks allocates `outputDatasetId`
   automatically (live).
4. Poll `GET .../batchInferenceJobs/{id}` (live).
5. Download results: `GET .../datasets/{outputDatasetId}:getDownloadEndpoint`
   returns `filenameToSignedUrls` — short-lived (~10 min) signed GCS URLs,
   one per file in the output dataset (live).

## Endpoint matrix

| Operation | Method + path | Provenance |
| --- | --- | --- |
| Create dataset | `POST /v1/accounts/{acct}/datasets` | live |
| Upload dataset file | `POST /v1/accounts/{acct}/datasets/{id}:upload` | live |
| Get dataset | `GET /v1/accounts/{acct}/datasets/{id}` | live |
| Create job | `POST /v1/accounts/{acct}/batchInferenceJobs?batchInferenceJobId={id}` | live |
| Get job | `GET /v1/accounts/{acct}/batchInferenceJobs/{id}` | live |
| List jobs | `GET /v1/accounts/{acct}/batchInferenceJobs` | live |
| Delete job | `DELETE /v1/accounts/{acct}/batchInferenceJobs/{id}` | live |
| Download endpoint | `GET /v1/accounts/{acct}/datasets/{id}:getDownloadEndpoint` | live |

There is **no cancel endpoint**; `DELETE` on a running job moves it to
`JOB_STATE_DELETING_CLEANING_UP` and then removes it (live).

## Request line format

```json
{"custom_id": "req-1", "body": {"messages": [...], "max_tokens": 20}}
```

- `custom_id` required per line and must be unique within the dataset
  (docs: guide §1 "Prepare your dataset"); no documented length/charset
  constraint (docs). The adapter treats `customIdConstraints = null` as
  uniqueness-only validation, matching this contract.
- `body` is a chat-completions-shaped payload **without** `model` — the
  model is set on the job (live).
- `body.messages` and `body.prompt_token_ids` are mutually exclusive (docs).
- A job-level `systemPrompt` can be set; it is applied only to rows that do
  not already start with a system message (docs).

## Status values and mapping

Observed live state sequence:
`JOB_STATE_VALIDATING → JOB_STATE_PENDING → JOB_STATE_CREATING →
JOB_STATE_RUNNING → JOB_STATE_COMPLETED`. Also observed live:
`JOB_STATE_FAILED`, `JOB_STATE_DELETING_CLEANING_UP`. All other states
below come from the complete job-state enum in Fireworks'
get-batch-inference-job API reference (docs) and were not observed live.

Complete mapping to `UpstreamBatchStatus` (every documented enum member):

| Fireworks | OpenRouter | Provenance |
| --- | --- | --- |
| `JOB_STATE_UNSPECIFIED`, `JOB_STATE_VALIDATING` | `validating` | live (`VALIDATING`), docs |
| `JOB_STATE_CREATING_INPUT_DATASET`, `JOB_STATE_PENDING`, `JOB_STATE_CREATING`, `JOB_STATE_RUNNING`, `JOB_STATE_RE_QUEUEING`, `JOB_STATE_IDLE`, `JOB_STATE_PAUSED` | `in_progress` | live (`PENDING`/`CREATING`/`RUNNING`), docs |
| `JOB_STATE_WRITING_RESULTS` | `finalizing` | docs |
| `JOB_STATE_COMPLETED` | `completed` | live |
| `JOB_STATE_FAILED` | `failed` | live |
| `JOB_STATE_EARLY_STOPPED`, `JOB_STATE_EXPIRED` | `expired` | docs (both retain partial output) |
| `JOB_STATE_CANCELLING` | `cancelling` | docs |
| `JOB_STATE_CANCELLED`, `JOB_STATE_DELETING`, `JOB_STATE_DELETING_CLEANING_UP`, `JOB_STATE_DELETED`, `JOB_STATE_ARCHIVED` | `cancelled` | live (`DELETING_CLEANING_UP`), docs |

The adapter's Zod enum carries the complete documented list so a
legitimate poll response is never rejected before mapping.

Progress/request counts come from `jobProgress`:
`totalInputRequests`, `totalProcessedRequests`,
`successfullyProcessedRequests`, `failedRequests`, `outputRows`,
`inputTokens`, `outputTokens`, `cachedInputTokenCount`, `percent` (live).

On `JOB_STATE_FAILED`, `status.code`/`status.message` carry the batch-level
failure reason, e.g.
`"Dataset has a syntax error: chat dataset validation failed on
input2.jsonl:1: invalid role bananas in message 1..."` (live). A failed
job's `outputDatasetId` does not exist — `getDownloadEndpoint` on it
returns 404 `resource not found` (live).

## Result and error handling

- Output dataset contains `BIJOutputSet.jsonl` plus an `error-data` file
  (live). In the happy-path run `error-data` was empty.
- Output line shape (live):

```json
{"custom_id": "req-ok-2", "response": {"id": "chatcmpl-…", "object": "chat.completion", "created": 1788062136, "model": "accounts/fireworks/models/llama-v3p1-8b-instruct", "choices": [{"index": 0, "message": {"role": "assistant", "content": "4"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 47, "total_tokens": 49, "completion_tokens": 2, "prompt_tokens_details": {"cached_tokens": 29}}}}
```

  No `response.status_code` wrapper and no per-line `error` envelope was
  observed; the body is OpenAI-chat-compatible, including
  `usage.prompt_tokens_details.cached_tokens`.
- **A native success row is not canonical batch-output JSONL** (`id`,
  `response.status_code`, `response.body` are absent). Serving
  (`parseResult`) and billing (`transformBatchResponse` over the raw
  artifact) are separate paths; only the first tolerates the native shape
  on its own. Without a `transformBatchResponse` override every row fails
  the canonical schema at finalize, zero generations are emitted, and the
  batch ends `completed` with `usage` all zeros and `is_usage_complete:
  false` while every served line is `200`. Terminal `completed` plus `200`
  rows is therefore not billing evidence for this provider.
- Rows come back reordered relative to the input; correlation is by
  `custom_id` only.
- Reasoning models return `message.reasoning_content` and
  `completion_tokens_details.reasoning_tokens`. When `max_tokens` is too
  small for the reasoning phase the row ends `finish_reason: length` with
  the partial reasoning text in `content` and `reasoning_tokens: 0`; with
  headroom the split is reported normally.
- `cached_tokens` can be nonzero in batch output (llama-8b capture), but a
  production model observed through OpenRouter reported `cached_tokens: 0`
  on an identical multi-thousand-token prefix within one batch. Treat batch
  prompt caching as per-model and unproven until a native run shows it;
  the `:batch` cache-read price only matters when the provider reports
  cached tokens.
- Tool calls (`tool_calls` with `finish_reason: tool_calls`) and
  `response_format: json_schema` return in the OpenAI-compatible shape and
  parse through the standard chat normalizer without provider-specific
  handling.
- Per-row failure shape is **unverified** (docs say failed requests are
  written to the error file; no live capture produced a non-empty one — see
  deferred captures).
- Partial failure maps to `completed` with rows for the successes; missing
  rows for failed/expired requests must be tolerated. **Unverified:** the
  terminal state of a mixed-success job. Fireworks defines `COMPLETED` as
  "All requests successfully processed", and the only captured row-level
  failure failed the whole job, so no live capture proves a mixed job ends
  `COMPLETED` rather than another terminal state. Finalization must not
  assume `completed` implies zero failed rows; a mixed-result live capture
  is a deferred capture.

## Validation semantics (live, important)

- **Row-level validation errors fail the whole job**, not the row: an
  invalid message role took the job to `JOB_STATE_FAILED` with zero output.
  Sad paths are largely batch-level, unlike OpenAI/Together per-row errors.
- An absurd `max_tokens` (900000) did **not** fail the row — Fireworks
  clamped it and returned a normal completion.
- Through OpenRouter, a line that fails lowering (e.g. `temperature` above
  the provider maximum) fails the whole batch at submit before any
  Fireworks job exists (first-error submit-worker behavior). Unsupported
  input kinds (image URL parts, `web_search_options`) fail the same way
  with a targeted message pointing at the sync API. A line that passes
  lowering but fails Fireworks dataset validation (invalid message role)
  fails the whole upstream job and surfaces as a terminal `failed` batch
  with the upstream message. None of these paths produce a per-row
  provider error, so a live provider-side error row remains unverified.

## Limits, expiry, pricing (docs)

- Input dataset limit 80 GiB; output dataset limit 8 GB. The direct
  multipart `:upload` endpoint used by this adapter only accepts files up
  to **150 MB** (docs: upload-dataset-files); larger datasets require the
  `:getUploadEndpoint` signed-URL flow plus `:validateUpload`
  (docs: get-dataset-upload-endpoint), which this stack does not implement.
  The adapter therefore enforces a Fireworks-specific 150 MB cap before
  submission and rejects larger inputs with a non-retryable 413.
- Jobs expire after a configurable window (`expireTime` observed live at
  +24h); completed requests are retained.
- Artifact retention is **unverified**: neither the docs nor the live run
  establish how long input/output datasets stay downloadable, whether their
  retention clock starts at upload or job completion, or how they are
  deleted. Only the signed URLs themselves are known to expire (~10 min);
  fresh URLs were still obtainable from `getDownloadEndpoint` throughout the
  session. Finalization/sweep design must re-request signed URLs per attempt.
  A 404 from `getDownloadEndpoint` only proves the dataset is unavailable
  (observed live for a failed job's never-created output dataset; expiry or
  deletion would look identical), so it must surface as "results
  unavailable" rather than a specific cause. Measuring actual dataset
  retention (poll a completed job's output dataset over days) is a deferred
  capture.
- Pricing: 50% of Serverless per-token pricing; prompt caching can add a
  further 50% reduction on cached tokens.

## Irregularities observed live

1. Dataset creation requires `exampleCount`, which the create-dataset docs
   do not mention (`400 example_count is required for uploaded datasets`).
2. `exampleCount` is **not validated** against the uploaded file: a dataset
   created with `exampleCount: "1"` but 3 rows completed all 3;
   `jobProgress.totalInputRequests` echoes the declared count (1) while
   `totalProcessedRequests`/`outputRows` report the real 3. Poll counts must
   prefer processed counts over `totalInputRequests`.
3. `:getDownloadEndpoint` is documented with a curl `-X GET ... -d '{}'`
   example, but any request body makes Google's front end reject the call
   with HTTP 400; `POST` returns `Method Not Allowed`. A plain body-less
   `GET` works.
4. The model is job-level; a per-line `model` field is not part of the
   input contract.
5. There is no cancel API; `DELETE` doubles as cancel
   (`JOB_STATE_DELETING_CLEANING_UP`).
6. Signed download URLs expire in ~10 minutes (`X-Goog-Expires=599`).
7. The failed-job error message referenced `input2.jsonl:1` for a row that
   was line 2 of the upload — line numbers in validation messages are not
   trustworthy.

## Sync-transform reuse decision

The live `FireworksAdapter` (packages/router/adapters/fireworks) overrides
`getReasoningEffort`, `applyInputTransforms` (system-message hoisting), and
`transformRequest` (response-format mapping, image extraction, message field
filtering, stop trimming, top_k clamping, penalty preference,
prompt-cache key). Reusing `OpenAIBatchAdapter` would silently drop all of
that (see the warning in `services/batch-api/src/adapters/api-key-providers.ts`).

Decision: extract a pure `serializeFireworksRequest` +
`buildFireworksSerializeContext` (the Together pattern —
`serialize-together-request.ts`) and lower batch lines through it, with the
live adapter delegating to the same serializer.

## Batch-enabled model intersection

Only `accounts/fireworks/models/llama-v3p1-8b-instruct` was exercised live.
Fireworks documents batch inference as available for its serverless models
but publishes no authoritative batch-supported model list to intersect with
active OpenRouter Fireworks endpoints offline. This stack registers the
adapter without enabling `:batch` on any endpoint; per-model enablement is a
separate endpoint-registration task that must probe each candidate model
with a 1-row job (cheap, ~50% serverless pricing) before flipping it on.
Probes must be bounded: Fireworks warns an incompatible model can sit
pending indefinitely without an immediate error, so prefilter candidates
using the documented On-Demand Deployment compatibility rule, give each
probe a hard timeout, and DELETE the probe job (and its datasets) on
timeout or completion so abandoned probes do not accumulate.

## Skin / schema decisions

- Endpoint family: existing `completions` (`/v1/chat/completions`); no new
  family, no new skin — the client-side line shape is identical to the
  existing chat skin's.
- Wire usage: OpenAI-compatible; no `batch-output-line` union change.

## Adapter decisions

- `BatchIngestMode.File`: upload = create dataset + `:upload` + poll to
  `READY`; the dataset id is the upstream input file handle.
- `BatchResultMode.FileHandle`: poll stores `outputDatasetId` as
  `output_file_id`; `error_file_id` stays null (errors live inside the same
  output dataset).
- `fetchNativeResults`: `getDownloadEndpoint` → download every listed file →
  concatenate (skipping empty files).
- `exampleCount`: sent as `"1"` at create time (line count is unknown before
  the stream is consumed; live-verified as unvalidated).
- Poll counts: `total` = `max(totalInputRequests, totalProcessedRequests)`
  (either alone is unreliable: the declared `exampleCount` echoes into
  `totalInputRequests`, and `totalProcessedRequests` undercounts a job that
  terminates partially processed), `completed` =
  `successfullyProcessedRequests`, `failed` = `failedRequests`. For
  cancelled/expired jobs both provider counters can still understate the
  accepted request total, so provider counts must not overwrite the
  platform-side accepted total for terminal partial jobs.
- `failure_reason`: `status.message` when the job fails.
- `transformBatchResponse`: **required**, not optional, for this provider —
  stream native rows through `streamCanonicalOutputJsonl` and wrap each
  success as `{id, custom_id, response: {status_code: 200, body}}` with the
  native `usage` passed through unmodified (billing prices cached tokens
  from `prompt_tokens_details.cached_tokens` against `input_cache_read`).
  Native error rows and rows that fail the completion schema degrade to
  non-billable non-200 canonical rows keyed by `custom_id` so a bad row
  never aborts billing for the rest of the batch.
- Billing coverage lives in
  `services/batch-api/src/finalize/finalize-batch-job.test.ts`: the live
  output fixture is persisted as the raw artifact and driven through the
  real `transformBatchResponse` → `emitBatchGenerations` path, asserting
  emitted generations, token/cached counts, per-row cost from endpoint
  pricing, and `is_usage_complete: true`. Direct `parseResult` tests are
  serving coverage only.

## Fixture provenance

Fixtures are committed in the adapter layer of this stack (PR 4/5) under
`packages/batch/adapters/fireworks/fixtures/`, not in this docs-only PR.
They are verbatim live captures from the 2026-08-30 session (input JSONL,
output `BIJOutputSet.jsonl`, terminal poll body), with only the signed URLs
omitted; the transcripts below are the same captures inline. The per-row
error-line fixture is intentionally absent — see deferred captures.
Tool-call / multi-turn / structured-output request lowering is exercised by
the serializer unit tests (PR 2/5), which snapshot-lock the sync adapter's
production serializer rather than re-capturing each shape live.

## Deferred live captures

- A non-empty `error-data` file (per-row failure shape): row-level sad paths
  either clamp (max_tokens) or fail the whole job (validation); no live
  input produced a per-row error, and the docs describe the error file's
  existence but not its line schema. Working contract (unverified, defensive):
  the parser accepts `{"custom_id": "...", "error": {"message": "...",
  "code"?: "..."}}` lines, correlates on `custom_id`, and rejects (with a
  logged parse error) any line matching neither this nor the success shape,
  so an unexpected provider format surfaces loudly instead of dropping rows.
- `JOB_STATE_EXPIRED` payload.
- `prompt_token_ids` inputs (unsupported by OpenRouter batch anyway).

## Live capture flow (full request/response transcripts)

Verbatim transcripts from the 2026-08-30 live session against
`https://api.fireworks.ai` (account ID, emails, and signed-URL credentials
sanitized; no other edits). Auth on every call:
`Authorization: Bearer $FIREWORKS_API_KEY`.

### Input JSONL (happy path, 3 rows)

```jsonl
{"custom_id":"req-ok-1","body":{"messages":[{"role":"system","content":"You are terse."},{"role":"user","content":"Say hello in one word."}],"max_tokens":20}}
{"custom_id":"req-ok-2","body":{"messages":[{"role":"user","content":"What is 2+2? Answer with just the number."}],"temperature":0.2,"max_tokens":10}}
{"custom_id":"req-err-1","body":{"messages":[{"role":"user","content":"hi"}],"max_tokens":900000}}
```

### Step 1 — create input dataset

`POST /v1/accounts/{account}/datasets`

```json
{
  "averageTurnCount": 0,
  "createTime": "2026-08-30T03:48:42.645723285Z",
  "createdBy": "user@example.com",
  "displayName": "",
  "encryptionState": "ENCRYPTION_STATE_PLAINTEXT",
  "estimatedTokenCount": "0",
  "exampleCount": "3",
  "externalUrl": "",
  "format": "FORMAT_UNSPECIFIED",
  "name": "accounts/example-account/datasets/devin-bij-in-1788061714",
  "sourceJobName": "",
  "state": "UPLOADING",
  "status": {
    "code": "OK",
    "message": ""
  },
  "updateTime": "2026-08-30T03:48:42.645723285Z",
  "userUploaded": {}
}
```

### Step 2 — upload input JSONL

`POST /v1/accounts/{account}/datasets/{dataset}:upload (multipart file=input.jsonl)`

```json
{
  "bytes": 409,
  "created_at": 1788061722,
  "filename": "input.jsonl",
  "id": "accounts/example-account/datasets/devin-bij-in-1788061714",
  "object": "file",
  "purpose": "dataset"
}
```

### Step 3 — dataset ready

`GET /v1/accounts/{account}/datasets/{dataset}`

```json
{
  "averageTurnCount": 0,
  "createTime": "2026-08-30T03:48:42.645723Z",
  "createdBy": "user@example.com",
  "displayName": "",
  "encryptionState": "ENCRYPTION_STATE_PLAINTEXT",
  "estimatedTokenCount": "100",
  "exampleCount": "3",
  "externalUrl": "",
  "format": "FORMAT_UNSPECIFIED",
  "name": "accounts/example-account/datasets/devin-bij-in-1788061714",
  "sourceJobName": "",
  "state": "READY",
  "status": {
    "code": "OK",
    "message": ""
  },
  "updateTime": "2026-08-30T03:48:43.789813Z",
  "userUploaded": {}
}
```

### Step 4 — create batch job

`POST /v1/accounts/{account}/batchInferenceJobs?batchInferenceJobId={job}`

```json
{
  "continuedFromJobName": "",
  "createTime": "2026-08-30T03:48:56.029803417Z",
  "createdBy": "user@example.com",
  "displayName": "",
  "expireTime": "2026-08-31T03:48:53.988342027Z",
  "inferenceParameters": {
    "extraBody": "{}",
    "maxTokens": 64
  },
  "inputDatasetId": "accounts/example-account/datasets/devin-bij-in-1788061714",
  "jobProgress": null,
  "lifecycle": null,
  "maxJobDuration": null,
  "model": "accounts/fireworks/models/llama-v3p1-8b-instruct",
  "name": "accounts/example-account/batchInferenceJobs/devin-bij-job-1788061733",
  "outputDatasetId": "accounts/example-account/datasets/bij-n1729dlh",
  "placement": null,
  "precision": "BF16",
  "state": "JOB_STATE_VALIDATING",
  "status": {
    "code": "OK",
    "message": ""
  },
  "systemPrompt": "",
  "updateTime": "2026-08-30T03:48:56.029803417Z",
  "waitingOnCapacity": false
}
```

### Step 5 — poll (running)

`GET /v1/accounts/{account}/batchInferenceJobs/{job}`

```json
{
  "continuedFromJobName": "",
  "createTime": "2026-08-30T03:48:56.029803Z",
  "createdBy": "user@example.com",
  "displayName": "",
  "expireTime": "2026-08-31T03:48:53.988342Z",
  "inferenceParameters": {
    "extraBody": "{}",
    "maxTokens": 64
  },
  "inputDatasetId": "accounts/example-account/datasets/devin-bij-in-1788061714",
  "jobProgress": {
    "cachedInputTokenCount": 0,
    "epoch": 0,
    "failedRequests": 0,
    "inputTokens": 0,
    "outputRows": 0,
    "outputTokens": 0,
    "percent": 0,
    "successfullyProcessedRequests": 0,
    "totalInputRequests": 0,
    "totalProcessedRequests": 0
  },
  "lifecycle": {
    "endTime": null,
    "runStartTime": "2026-08-30T03:55:56.086402Z",
    "validatedTime": "2026-08-30T03:49:56.082811Z"
  },
  "maxJobDuration": null,
  "model": "accounts/fireworks/models/llama-v3p1-8b-instruct",
  "name": "accounts/example-account/batchInferenceJobs/devin-bij-job-1788061733",
  "outputDatasetId": "accounts/example-account/datasets/bij-n1729dlh",
  "placement": {
    "multiRegion": "MULTI_REGION_UNSPECIFIED",
    "region": "REGION_UNSPECIFIED",
    "regions": []
  },
  "precision": "BF16",
  "state": "JOB_STATE_RUNNING",
  "status": {
    "code": "OK",
    "message": ""
  },
  "systemPrompt": "",
  "updateTime": "2026-08-30T03:55:56.087058Z",
  "waitingOnCapacity": false
}
```

### Step 6 — poll (terminal, completed)

`GET .../batchInferenceJobs/{job}`

```json
{
  "continuedFromJobName": "",
  "createTime": "2026-08-30T03:48:56.029803Z",
  "createdBy": "user@example.com",
  "displayName": "",
  "expireTime": "2026-08-31T03:48:53.988342Z",
  "inferenceParameters": {
    "extraBody": "{}",
    "maxTokens": 64
  },
  "inputDatasetId": "accounts/example-account/datasets/devin-bij-in-1788061714",
  "jobProgress": {
    "cachedInputTokenCount": 82,
    "epoch": 0,
    "failedRequests": 0,
    "inputTokens": 126,
    "outputRows": 3,
    "outputTokens": 15,
    "percent": 100,
    "successfullyProcessedRequests": 3,
    "totalInputRequests": 3,
    "totalProcessedRequests": 3
  },
  "lifecycle": {
    "endTime": "2026-08-30T03:56:56.220410Z",
    "runStartTime": "2026-08-30T03:55:56.086402Z",
    "validatedTime": "2026-08-30T03:49:56.082811Z"
  },
  "maxJobDuration": null,
  "model": "accounts/fireworks/models/llama-v3p1-8b-instruct",
  "name": "accounts/example-account/batchInferenceJobs/devin-bij-job-1788061733",
  "outputDatasetId": "accounts/example-account/datasets/bij-n1729dlh",
  "placement": {
    "multiRegion": "MULTI_REGION_UNSPECIFIED",
    "region": "REGION_UNSPECIFIED",
    "regions": []
  },
  "precision": "BF16",
  "state": "JOB_STATE_COMPLETED",
  "status": {
    "code": "OK",
    "message": ""
  },
  "systemPrompt": "",
  "updateTime": "2026-08-30T03:56:56.220997Z",
  "waitingOnCapacity": false
}
```

### Step 7 — signed download URLs for output dataset

`GET /v1/accounts/{account}/datasets/{outputDataset}:getDownloadEndpoint`

```json
{
  "filenameToSignedUrls": {
    "dataset/bij-n1729dlh/BIJOutputSet.jsonl": "https://storage.googleapis.com/fireworks-artifacts-example-account/dataset/bij-n1729dlh/BIJOutputSet.jsonl?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=REDACTED%2F20260830%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20260830T035748Z&X-Goog-Expires=599&X-Goog-Signature=REDACTED&X-Goog-SignedHeaders=host",
    "dataset/bij-n1729dlh/error-data": "https://storage.googleapis.com/fireworks-artifacts-example-account/dataset/bij-n1729dlh/error-data?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=REDACTED%2F20260830%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20260830T035748Z&X-Goog-Expires=599&X-Goog-Signature=REDACTED&X-Goog-SignedHeaders=host"
  }
}
```

### Sad path — invalid API key

`any endpoint with a bad bearer token (HTTP 403)`

```json
{
  "error": {
    "message": "The API key you provided is invalid.",
    "param": null,
    "code": "UNAUTHORIZED",
    "type": "error"
  },
  "request_id": "aeb89645-8f44-4075-8d1b-e8c2f3a9c177"
}
```

### Sad path — whole-job validation failure (invalid role)

`GET .../batchInferenceJobs/{job} after JOB_STATE_FAILED`

```json
{
  "continuedFromJobName": "",
  "createTime": "2026-08-30T03:58:17.130860Z",
  "createdBy": "user@example.com",
  "displayName": "",
  "expireTime": "2026-08-31T03:58:16.914901Z",
  "inferenceParameters": {
    "extraBody": "{}"
  },
  "inputDatasetId": "accounts/example-account/datasets/devin-bij-sad-1788062294",
  "jobProgress": {
    "cachedInputTokenCount": 0,
    "epoch": 0,
    "failedRequests": 0,
    "inputTokens": 0,
    "outputRows": 0,
    "outputTokens": 0,
    "percent": 0,
    "successfullyProcessedRequests": 0,
    "totalInputRequests": 0,
    "totalProcessedRequests": 0
  },
  "lifecycle": {
    "endTime": "2026-08-30T03:59:17.199401Z",
    "runStartTime": null,
    "validatedTime": null
  },
  "maxJobDuration": null,
  "model": "accounts/fireworks/models/llama-v3p1-8b-instruct",
  "name": "accounts/example-account/batchInferenceJobs/devin-bij-sad-job-1788062294",
  "outputDatasetId": "accounts/example-account/datasets/bij-d55ciehk",
  "placement": {
    "multiRegion": "MULTI_REGION_UNSPECIFIED",
    "region": "REGION_UNSPECIFIED",
    "regions": []
  },
  "precision": "BF16",
  "state": "JOB_STATE_FAILED",
  "status": {
    "code": "INVALID_ARGUMENT",
    "message": "Dataset has a syntax error: chat dataset validation failed on input2.jsonl:1: invalid role bananas in message 1, must be 'system', 'user', 'assistant' or 'tool'"
  },
  "systemPrompt": "",
  "updateTime": "2026-08-30T03:59:17.200014Z",
  "waitingOnCapacity": false
}
```

### Sad path — download endpoint of failed job

`GET .../datasets/{outputDataset}:getDownloadEndpoint (HTTP 404)`

```json
{
  "code": 5,
  "details": [],
  "message": "resource not found"
}
```

### Cancellation — DELETE job

`DELETE .../batchInferenceJobs/{job} (HTTP 200)`

```json
{}
```

### Cancellation — job state right after DELETE

`GET .../batchInferenceJobs/{job}`

```json
{
  "continuedFromJobName": "",
  "createTime": "2026-08-30T03:58:27.782881Z",
  "createdBy": "user@example.com",
  "displayName": "",
  "expireTime": "2026-08-31T03:58:27.681951Z",
  "inferenceParameters": {
    "extraBody": "{}"
  },
  "inputDatasetId": "accounts/example-account/datasets/devin-bij-cancel-1788062305",
  "jobProgress": null,
  "lifecycle": null,
  "maxJobDuration": null,
  "model": "accounts/fireworks/models/llama-v3p1-8b-instruct",
  "name": "accounts/example-account/batchInferenceJobs/devin-bij-cancel-job-1788062305",
  "outputDatasetId": "accounts/example-account/datasets/bij-dv7qmijy",
  "placement": {
    "multiRegion": "MULTI_REGION_UNSPECIFIED",
    "region": "REGION_UNSPECIFIED",
    "regions": []
  },
  "precision": "BF16",
  "state": "JOB_STATE_DELETING_CLEANING_UP",
  "status": {
    "code": "OK",
    "message": ""
  },
  "systemPrompt": "",
  "updateTime": "2026-08-30T03:58:30.959245Z",
  "waitingOnCapacity": false
}
```

### Irregularity — exampleCount mismatch still completes

`terminal poll of a job whose dataset declared exampleCount=1 but had 3 rows`

```json
{
  "continuedFromJobName": "",
  "createTime": "2026-08-30T04:01:54.666163Z",
  "createdBy": "user@example.com",
  "displayName": "",
  "expireTime": "2026-08-31T04:01:54.573869Z",
  "inferenceParameters": {
    "extraBody": "{}"
  },
  "inputDatasetId": "accounts/example-account/datasets/devin-bij-count-1788062444",
  "jobProgress": {
    "cachedInputTokenCount": 82,
    "epoch": 0,
    "failedRequests": 0,
    "inputTokens": 126,
    "outputRows": 3,
    "outputTokens": 15,
    "percent": 100,
    "successfullyProcessedRequests": 3,
    "totalInputRequests": 1,
    "totalProcessedRequests": 3
  },
  "lifecycle": {
    "endTime": "2026-08-30T04:06:54.863709Z",
    "runStartTime": "2026-08-30T04:02:54.715063Z",
    "validatedTime": "2026-08-30T04:02:54.715063Z"
  },
  "maxJobDuration": null,
  "model": "accounts/fireworks/models/llama-v3p1-8b-instruct",
  "name": "accounts/example-account/batchInferenceJobs/devin-bij-count-job2-1788062444",
  "outputDatasetId": "accounts/example-account/datasets/bij-jheajz5r",
  "placement": {
    "multiRegion": "MULTI_REGION_UNSPECIFIED",
    "region": "REGION_UNSPECIFIED",
    "regions": []
  },
  "precision": "BF16",
  "state": "JOB_STATE_COMPLETED",
  "status": {
    "code": "OK",
    "message": ""
  },
  "systemPrompt": "",
  "updateTime": "2026-08-30T04:06:54.864564Z",
  "waitingOnCapacity": false
}
```

### Output JSONL (downloaded via signed URL, order NOT preserved)

```jsonl
{"custom_id": "req-ok-2", "response": {"id": "chatcmpl-cdf50433f50a4c8ea53511a508676ebf", "object": "chat.completion", "created": 1788062136, "model": "accounts/fireworks/models/llama-v3p1-8b-instruct", "choices": [{"index": 0, "message": {"role": "assistant", "content": "4"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 47, "total_tokens": 49, "completion_tokens": 2, "prompt_tokens_details": {"cached_tokens": 29}}}}
{"custom_id": "req-ok-1", "response": {"id": "chatcmpl-080d88538abf4085a62a956c2b12b7fc", "object": "chat.completion", "created": 1788062136, "model": "accounts/fireworks/models/llama-v3p1-8b-instruct", "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello."}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 44, "total_tokens": 47, "completion_tokens": 3, "prompt_tokens_details": {"cached_tokens": 24}}}}
{"custom_id": "req-err-1", "response": {"id": "chatcmpl-c37a41fc337647109b0d004e09669e13", "object": "chat.completion", "created": 1788062136, "model": "accounts/fireworks/models/llama-v3p1-8b-instruct", "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello! How can I assist you today?"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 35, "total_tokens": 45, "completion_tokens": 10, "prompt_tokens_details": {"cached_tokens": 29}}}}
```

### error-data file

Downloaded alongside the output; empty (0 bytes) for the happy-path job.
