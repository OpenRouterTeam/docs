# Google Vertex AI (Gemini) Batch API research note

Backfill output of `research-batch-provider` for provider `google-vertex` (enum `Provider.Google`, Datadog `provider_name: "Google"`), written after the adapter under `packages/batch/adapters/vertex/` was already in production. Live captures were taken 2026-09-02 with the platform development service account (Infisical `/services/batch-api`, env `dev`) against the regional control plane, and through OpenRouter's public Batch API pinned with `provider.only: ["google-vertex"]`. Raw transcripts lived in `/tmp/batch-research/google-vertex/` and are not committed. The dogfood evidence is summarized in the "Dogfood evidence" section below.

Provenance labels: `[capture YYYY-MM-DD]` observed live, `[docs: <url>]` from the official page cited, `[code]` read from the shipped adapter, `[unconfirmed]` neither.

Google AI Studio (`docs/batch-research/google-ai-studio.md`) shares the Gemini `GenerateContentRequest`/`GenerateContentResponse` codecs but is a different control plane (API key, `batches/{id}` long-running operation, Files API). Nothing in this note transfers to it unless stated.

## Official sources

- Overview (limits, queue time, turnaround, cancellation, discount): https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-gemini
- Cloud Storage input/output guide (request line, output line, `status` field, incremental export): https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-from-cloud-storage
- BigQuery input/output guide (not used by the adapter, cited for the shared importer behavior): https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-from-bigquery
- Batch prediction API model reference (SDK/REST parameters): https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/batch-prediction-api
- REST resource `projects.locations.batchPredictionJobs`: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.batchPredictionJobs
  - create: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.batchPredictionJobs/create
  - get: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.batchPredictionJobs/get
  - list: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.batchPredictionJobs/list
  - cancel: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.batchPredictionJobs/cancel
  - delete: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.batchPredictionJobs/delete
- Job state enum: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/JobState
- Discovery document (field types for `completionStats`, `outputInfo`, `JobState` descriptions, revision `20260828` when captured): https://aiplatform.googleapis.com/$discovery/rest?version=v1
- Pricing: https://cloud.google.com/vertex-ai/generative-ai/pricing
- Quotas and limits: https://cloud.google.com/vertex-ai/generative-ai/docs/quotas
- Locations and the global endpoint: https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
- Batch embeddings (the embeddings wire the adapter also serves): https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/batch-prediction-genai-embeddings
- Context caching: https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview
- Grounding with Google Search: https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search

There is no separate "results" or "files" endpoint: output is written to the caller's Cloud Storage bucket and read with the Cloud Storage JSON API (`[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-from-cloud-storage]`). There is no documented retention or expiry page for batch output because retention is the bucket's own lifecycle policy.

## 1. Auth

- Control plane: OAuth2 bearer token. Platform mints it through Application Default Credentials (`GoogleAuth` with the `cloud-platform` scope, so workload identity on Cloud Run; no key material) and reads only `VERTEX_BATCH_PROJECT_ID`, `VERTEX_BATCH_REGION`, `VERTEX_BATCH_OUTPUT_URI_PREFIX` `[code]` `services/batch-api/src/adapters/google-vertex.ts`. BYOK mints it from the customer's uploaded service-account JSON key `[code]` `vertex-byok-adapter.ts`. The direct captures below used a dev service-account JSON key (Infisical `GOOGLE_APPLICATION_CREDENTIALS_JSON`) as the caller, which is a research convenience, not the platform runtime path.
- Permissions the caller needs, as observed:
  - `aiplatform.batchPredictionJobs.create` on `projects/{project}/locations/{location}`. Missing it is HTTP 403 `PERMISSION_DENIED` with `Permission 'aiplatform.batchPredictionJobs.create' denied on resource '//aiplatform.googleapis.com/projects/<project>/locations/us-central1'` `[capture 2026-09-02]` (the dev service account is in project `llmixer` while `VERTEX_BATCH_PROJECT_ID` names `openrouter-core`).
  - Read on the input object and write on the output prefix, held by the **Vertex AI service agent** of the job's project (`service-<project-number>@gcp-sa-aiplatform.iam.gserviceaccount.com`), not by the caller. A missing `storage.objects.create` on the output bucket lets the job run to completion and then fail with gRPC code `7` `[capture 2026-09-02]`, see §5.
- Custom service accounts and CMEK are not supported for Gemini batch `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-from-cloud-storage]`.

## 2. Endpoints

Host is `{location}-aiplatform.googleapis.com` for a region, or `aiplatform.googleapis.com` with `locations/global` for the global endpoint `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-from-cloud-storage]`.

| Operation | Endpoint | Live result |
| --- | --- | --- |
| Create | `POST /v1/projects/{p}/locations/{l}/batchPredictionJobs` | HTTP 200, body is the job resource in `JOB_STATE_PENDING` `[capture 2026-09-02]` |
| Poll | `GET /v1/{job.name}` | job resource `[capture 2026-09-02]` |
| List | `GET /v1/projects/{p}/locations/{l}/batchPredictionJobs` | `{batchPredictionJobs: [...]}` `[capture 2026-09-02]` |
| Cancel | `POST /v1/{job.name}:cancel` | HTTP 200 `{}` on a pending job, later `JOB_STATE_CANCELLED` `[capture 2026-09-02]`. HTTP 400 `FAILED_PRECONDITION` on a failed job `[capture 2026-09-02]` |
| Delete | `DELETE /v1/{job.name}` | not exercised `[docs: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.batchPredictionJobs/delete]` |
| Results | Cloud Storage list + read under `outputInfo.gcsOutputDirectory` | not readable with the dev credential, see §5 |

Global endpoint: create in `locations/global` was accepted (HTTP 200, `JOB_STATE_PENDING`) `[capture 2026-09-02]`. The job later failed on the missing input bucket, so end-to-end global execution is `[unconfirmed]`. The docs list "Batch prediction for Anthropic and OpenMaaS models" as a global-endpoint limitation and tuned models as unsupported on global for batch, not Gemini publisher models `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations]`. Production platform jobs observed in Datadog on 2026-09-02 were created in `locations/europe-west4` `[capture 2026-09-02]`. The dev config points at `us-central1`.

Create body used by the adapter (`[code]` `vertex-batch-job-adapter.ts`):

```json
{
  "displayName": "openrouter-batch-<Date.now()>",
  "model": "publishers/google/models/gemini-2.5-flash-lite",
  "inputConfig": {"instancesFormat": "jsonl", "gcsSource": {"uris": ["gs://<bucket>/<billable entity>/<batch id>/input_file_lowered"]}},
  "outputConfig": {"predictionsFormat": "jsonl", "gcsDestination": {"outputUriPrefix": "gs://<bucket>/<VERTEX_BATCH_OUTPUT_URI_PREFIX>/<batch id>"}}
}
```

The batch id is appended to the configured output prefix because Vertex only adds a create-timestamp directory and same-instant jobs sharing a prefix would overwrite each other's `predictions.jsonl` `[code]`.

Bad model: HTTP 404 `NOT_FOUND`, `The PublisherModel gemini-does-not-exist does not exist.` `[capture 2026-09-02]`. Bad input or output bucket: create is accepted (`JOB_STATE_PENDING`) and the job fails asynchronously with gRPC code `9` `Failed to get GCS bucket location for <bucket>. Please check that the bucket exists and permissions are set correctly.` `[capture 2026-09-02]`.

## 3. Request-line shape

One JSON object per line. The documented shape is `{"request": <GenerateContentRequest>}` `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-from-cloud-storage]`. The model is bound on the job, not per line.

Correlation key: the docs do not define a `custom_id` or `key` field for the Gemini generate-content wire. The adapter writes `{"custom_id": "or-cid-<client id>", "request": {...}}` and relies on Vertex echoing unknown sibling keys into the output row `[code]` `vertex-gemini-correlation-key.ts`. Observed: output rows carried the sibling back, five `iso-*` ids and three numeric-looking ids (`"12345"`, `"000000"`, `"7"`) round-tripped unchanged through OpenRouter `[capture 2026-09-02]`. The `or-cid-` prefix exists because Vertex reserializes the value and coerces numeric-looking strings (`"000000"` → `0`) `[code]`, fixed in [#34309](https://github.com/OpenRouterTeam/openrouter-web/pull/34309); the coercion itself was not re-captured here `[unconfirmed]`.

Output order is not input order: a 5-line batch came back `iso-3, iso-2, iso-1, iso-5, iso-4` `[capture 2026-09-02]`. The adapter joins on `custom_id`, never on position `[code]`.

Importer constraints (Vertex loads the file through a BigQuery-style import that infers one column type per JSON key across the whole file). All of these fail the **whole job** before any prediction runs with gRPC code `3` and a message beginning `Failed to import data. Please check 'Prepare input' section of the batch predictions documentation.` `[capture 2026-08-26..31, Datadog batch.adapter.vertex_job_error]`:

| Importer rejection (message fragment) | Jobs in 7d | Adapter handling at `bc6f234` |
| --- | --- | --- |
| `Repeated field must be imported as a JSON array. Field: ...responseJsonSchema.properties.<x>.anyOf.type` | 37 | normalized by `gemini-normalize-schema-types.ts` ([#33653](https://github.com/OpenRouterTeam/openrouter-web/pull/33653)) |
| `Schema nested too deeply, at least 16 compared to the maximum allowed level of 15` | 16 | none, see Divergences D3 |
| `Invalid field name "$defs"` / `"$schema"` / a property name with spaces | 9 | `$`-keywords inlined/stripped (`gemini-inline-schema-refs.ts`, `gemini-strip-unimportable-schema-keys.ts`, [#38934](https://github.com/OpenRouterTeam/openrouter-web/pull/38934)); user property names not checked, D4 |
| `Cannot store struct 'request.tools.functionDeclarations.parameters...' with no fields` / `...responseJsonSchema...` | 8 | empty `properties`/`$defs` maps dropped ([#38119](https://github.com/OpenRouterTeam/openrouter-web/pull/38119)) |
| `Cannot store struct 'request.tools.google_search' with no fields` | 2 | source path `[unconfirmed]`, `assert-no-web-search.ts` rejects `web_search` tools at submit only when the endpoint lacks `supports_native_web_search`; otherwise `gemini-serialize-request.ts` emits `google_search: {}` |
| `Cannot store struct 'request.contents.parts.functionCall.args...' with no fields` | 1 | none, D5 |
| `Only optional fields can be set to NULL. Field: enum` | (pre-window) | null keywords dropped ([#38119](https://github.com/OpenRouterTeam/openrouter-web/pull/38119)) |

Whether the three fixes above eliminated their categories after deploy is `[unconfirmed]`: the window overlaps the merge dates.

Full sanitization order (`[code]` `gemini-serialize-request.ts`): sync serializer lowers the request → `inlineVertexBatchSchemaRefs` → strip unimportable keys → normalize `type` shapes, applied to `generationConfig.responseJsonSchema` and to every `tools[].functionDeclarations[].parameters`.

## 4. Status model

`state` is `JobState` (12 values, `[docs: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/JobState]`). Descriptions quoted from the discovery document revision `20260828`.

| `JobState` | Official description | Observed | Adapter maps to (`[code]` `vertex-job-state.ts`) |
| --- | --- | --- | --- |
| `JOB_STATE_UNSPECIFIED` | The job state is unspecified. | no | `validating` |
| `JOB_STATE_QUEUED` | The job has been just created or resumed and processing has not yet begun. | `[capture 2026-09-02]` (poll of a bad-bucket job before failure) | `validating` |
| `JOB_STATE_PENDING` | The service is preparing to run the job. | `[capture 2026-09-02]` create response | `validating` |
| `JOB_STATE_RUNNING` | The job is in progress. | `[capture 2026-09-02]` unwritable-output job | `in_progress` |
| `JOB_STATE_SUCCEEDED` | The job completed successfully. | via OpenRouter only (`async_job_status: completed`) `[capture 2026-09-02]` | `completed` |
| `JOB_STATE_FAILED` | The job failed. | `[capture 2026-09-02]` | `failed` |
| `JOB_STATE_CANCELLING` | The job is being cancelled. From this state the job may only go to either `JOB_STATE_SUCCEEDED`, `JOB_STATE_FAILED` or `JOB_STATE_CANCELLED`. | not seen (pending→cancelled in one poll interval) | `cancelling` |
| `JOB_STATE_CANCELLED` | The job has been cancelled. | `[capture 2026-09-02]` | `cancelled` |
| `JOB_STATE_PAUSED` | The job has been stopped, and can be resumed. | no | `in_progress` |
| `JOB_STATE_EXPIRED` | The job has expired. | no | `expired` |
| `JOB_STATE_UPDATING` | The job is being updated. Only jobs in the `RUNNING` state can be updated. After updating, the job goes back to the `RUNNING` state. | no | `in_progress` |
| `JOB_STATE_PARTIALLY_SUCCEEDED` | The job is partially succeeded, some results may be missing due to errors. | no | `completed` |

Notes:

- `JOB_STATE_CANCELLING` may end in `SUCCEEDED` per the docs, so a cancel request is not a guarantee of `cancelled`. The adapter keeps polling the real state `[code]`.
- `JOB_STATE_PARTIALLY_SUCCEEDED` → `completed` is a deliberate choice: the output prefix holds every finished row, and per-row failures are surfaced as failed result lines rather than a failed batch. Never observed live. The observed per-row failure (bad function name) ended `SUCCEEDED` with the failed row inline `[capture 2026-09-02, via OpenRouter]`. When Vertex emits `PARTIALLY_SUCCEEDED` versus `SUCCEEDED` with inline failures is `[unconfirmed]`.
- Observed pending→failed latency for a bad bucket: 0.2 s to 2.6 min `[capture 2026-09-02]`. Pending→running for a 2-line job: ~90 s. Run to terminal ~2 min `[capture 2026-09-02]`.

Counters: `completionStats.{successfulCount, failedCount, incompleteCount}` are int64 **strings** `[docs: https://aiplatform.googleapis.com/$discovery/rest?version=v1]`. `incompleteCount` is `-1` when unknown, "for example, the operation failed before the total entity number could be collected" (same source). Observed on a failed job: `completionStats: {"successfulCount": "2"}` only `[capture 2026-09-02]`. The adapter parses the strings with a digits-only regex, treats `-1` as absent, and sets `total = successful + failed + incomplete` `[code]` `vertex-batch-schemas.ts`, `vertex-batch-job-adapter.ts`. Pending and cancelled jobs had `completionStats: null` `[capture 2026-09-02]`, so `request_counts` is `{total: 0, completed: 0, failed: 0}` until the job runs. The platform's `total_lines` comes from the submitted input, not from Vertex.

## 5. Output / error shapes

Output location: `outputInfo.gcsOutputDirectory`, observed as `gs://<bucket>/<prefix>/prediction-model-2026-09-02T20:06:30.166279Z` (the create-time timestamp appended to `outputUriPrefix`) `[capture 2026-09-02]`. It is present on a failed job too (the unwritable-output job) `[capture 2026-09-02]`. Files inside: the docs show `predictions.jsonl` (`...to write gs://.../predictions.jsonl` in the observed error) `[capture 2026-09-02]`. Incremental shards written during long jobs are documented ("completed inferences are continuously exported") `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-from-cloud-storage]`. The adapter lists every object under the prefix, keeps prediction shards (`vertex-batch-results.ts` filter), sorts by name, and streams them in order. Zero shards is a 502-class error `[code]`. Shard naming beyond `predictions.jsonl` and the multi-shard case are `[unconfirmed]` live (dev credential cannot read output, see below).

Output line, official example `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-from-cloud-storage]`:

```json
{"status": "", "processed_time": "2024-11-01T18:13:16.826+00:00", "request": {...}, "response": {"candidates": [...], "modelVersion": "gemini-2.0-flash-001@default", "usageMetadata": {"candidatesTokenCount": 36, "promptTokenCount": 29180, "totalTokenCount": 29216}}}
```

Failed line, official example (same page):

```json
{"status": "Bad Request: {\"error\": {\"code\": 400, \"message\": \"Please use a valid role: user, model.\", \"status\": \"INVALID_ARGUMENT\"}}", "processed_time": "2025-07-09T19:57:43.558+00:00", "request": {...}}
```

"For successful rows, model responses are stored in the response field. Otherwise, error details are stored in the status field" (same page). The adapter treats a non-empty `status` **or** a missing `response` as a failed row and parses the JSON after the `Bad Request: ` prefix into `error.type/message` `[code]` `vertex-gemini-normalize-output.ts`, `vertex-gemini-output-row-helpers.ts`. Observed through OpenRouter: the bad function-name line served as `{"custom_id": "mb-bad", "response": null, "error": {"type": "invalid_request_error", "message": "The GenerateContentRequest proto is invalid:\n  * tools[0].function_declarations[0].name: [FIELD_INVALID] ...", "param": null}}` `[capture 2026-09-02]`, identical wording to the sync 400 from the same request.

Job-level `error` is `google.rpc.Status` `{code, message}` `[docs: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.batchPredictionJobs]`. Observed codes `[capture 2026-09-02 unless noted]`:

| gRPC code | Observed message |
| --- | --- |
| `1` | `CANCELED` (cancelled job) |
| `3` | `Failed to import data. ...` (Datadog, 75 jobs in 7d) |
| `7` | `Service account service-<n>@gcp-sa-aiplatform.iam.gserviceaccount.com doesn't have sufficient permission "storage.objects.create" to write gs://.../predictions.jsonl.` |
| `9` | `Failed to get GCS bucket location for <bucket>. ...` |
| `13` | `System error. Please try this operation again. ...` (Datadog, 15 jobs on 2026-08-27 and 2026-08-29), `Failed to export data. Error encountered during execution. Retrying may solve the problem.`, `Failed to export data. Not found: Dataset <tenant dataset> was not found in location US` |

The adapter maps `code` to its gRPC name and `message` to `failure_reason`/`failure_codes` `[code]` `vertex-job-failure.ts`.

Row defects: a success row whose `usageMetadata.totalTokenCount` is absent fails the adapter's Zod parse and is converted to a failed output line with a generic sanitized error plus a `batch.adapter.vertex_output_row_defect` event (`stage: parseResponse`, `custom_id`) `[code]`. Datadog holds ≥200 such events across 22 jobs on 2026-08-26 and 2026-08-27 `[capture 2026-09-02 query]`, none in the 2026-09-02 dogfood batches. Which upstream condition omits `totalTokenCount` is `[unconfirmed]`.

## 6. Limits

- Up to 200,000 requests per job. 1 GB input file for Cloud Storage input `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-gemini]`.
- No predefined concurrent-job quota for Gemini. A shared pool with queueing under saturation `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/quotas]`.
- Importer: key nesting ≤ 15 levels, BigQuery column-name rules for every JSON key, one inferred type per key across the file, no empty structs `[capture 2026-08-26..31, Datadog]`. Not stated on the batch pages. The error text links https://cloud.google.com/bigquery/docs/schemas#column_names.
- The platform's own submit-time size and line-count gates apply before Vertex `[code]` `services/batch-api/src/submit/accept/`.

## 7. Expiry / retention

- Queue: a job waits up to 72 hours for capacity before it expires `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-gemini]`.
- Run: most jobs finish within 24 hours of starting. After 24 hours incomplete jobs are cancelled and only completed requests are charged (same page).
- Output: lives in the caller's bucket, no provider expiry. Platform batch bucket objects expire 30 days after creation (`infra/bucket.tf`, `services/batch-api/AGENTS.md`) `[code]`. BYOK auto-buckets get the same 30-day delete rule `[code]` `vertex-byok-gcs.ts`.
- `JOB_STATE_EXPIRED` maps to `expired`. Whether output written before expiry is retrievable is `[unconfirmed]`. Cancelled jobs export all completed rows (same overview page). A live cancelled-with-output capture is `[unconfirmed]` (the cancelled job had not started).

## 8. Pricing

- Batch is 50% of standard for Gemini models `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-gemini]`.
- `gemini-2.5-flash-lite` Flex/Batch: input (text, image, video) $0.05/M, audio input $0.05/M, text output (response **and reasoning**) $0.20/M `[docs: https://cloud.google.com/vertex-ai/generative-ai/pricing]`.
- Only completed requests are charged on cancel or 24 h cutoff (overview page above). A failed inline row carried no usage and was not billed: `finalized_cost` for 4 good + 1 bad lines was $2.0e-6 = 24×0.05e-6 + 4×0.2e-6, and an all-failed 1-line batch finalized at cost 0 `[capture 2026-09-02]`.
- Reasoning: 1075 completion tokens billed at $0.20/M → $2.157e-4 `[capture 2026-09-02]`, matching the "response and reasoning" line.
- Implicit caching is enabled by default with a 90% discount on cached tokens for Gemini 2.5 (overview page). A 2-line batch sharing a ~2.6k-token prefix reported `cached_tokens: 0` on both rows and no discount `[capture 2026-09-02]`. Cache hits in batch are `[unconfirmed]`.
- Grounding with Google Search pricing is per request on the pricing page. Not exercised because the OpenRouter batch endpoint rejects `web_search` for this endpoint `[capture 2026-09-02]`, native grounding in batch is `[unconfirmed]`.

## 9. Sync-transform overrides

The batch line is produced by the sync Gemini serializer (`packages/router/.../google` via `vertex-gemini-from-internal-request.ts`) so upstream bodies match sync `[code]`. Batch-only differences:

- Schema lowering described in §3 (inline `$ref`, strip `$`-keywords, null keywords, empty maps, normalize `type` arrays) applies to batch only. Sync `generateContent` accepts the raw schema `[code]`.
- Response: `finishReason: STOP` with function calls is reported as `tool_calls` (sync does the same) `[code]`, observed `finish_reason: tool_calls`, `native_finish_reason: STOP` `[capture 2026-09-02]`.
- Reasoning: `thoughtsTokenCount` is added into `completion_tokens` and the thought parts are served as `reasoning`/`reasoning_details`, but `completion_tokens_details.reasoning_tokens` is not populated (served `0`) `[capture 2026-09-02]`. Sync reported `reasoning_tokens: 417` for the same prompt. See Divergences D2.
- Cached tokens: `usageMetadata.cachedContentTokenCount` → `prompt_tokens_details.cached_tokens` only when > 0 `[code]`.
- Grounding metadata → `annotations` + `server_tool_use.web_search_requests` `[code]`, not observed.

## 10. OpenRouter mapping decision

| Seam | Decision | Provenance |
| --- | --- | --- |
| `ingestMode` | `File`: JSONL uploaded to GCS, then `batchPredictionJobs.create` | `[code]` |
| `resultMode` | `FileHandle`: `output_file_id` = `outputInfo.gcsOutputDirectory` (a `gs://` **prefix**, not a file), `error_file_id` = `null` (failures are inline) | `[code]`, prefix shape `[capture 2026-09-02]` |
| `pollBatch → status` | table in §4 | `[code]` |
| `pollBatch → request_counts` | `completionStats` strings → numbers, `-1` → absent, `total` summed | `[code]` |
| `pollBatch → failure_reason / failure_codes` | job `error.{code,message}` → gRPC name + message | `[code]`, codes `1/7/9` `[capture 2026-09-02]`, `3/13` Datadog |
| `parseResult` | list + sort + stream shards under the prefix. Per row: non-empty `status` or no `response` → failed line (`custom_id` preserved, `usage` absent). Success → chat-completion body with `tool_calls`/`reasoning` folded in | `[code]`, served shapes `[capture 2026-09-02]` |
| `parseUsage` | `promptTokenCount`, `candidatesTokenCount + thoughtsTokenCount`, `cachedContentTokenCount`, non-billable on `error`/`content_filter` finish | `[code]` |
| Correlation | `or-cid-` prefixed `custom_id` sibling, join by id | `[code]`, round trip `[capture 2026-09-02]` |
| Shared response format | all lines in one job must share `response_format`/schema. Mixed schemas rejected at submit | `[capture 2026-09-02]` HTTP 400 `cannot share an upstream input with the requests before it` |

Completion and failure semantics (the load-bearing answers):

- **Terminal means all done?** Yes for `SUCCEEDED`, `FAILED`, `CANCELLED`, `EXPIRED`: no further rows are written (docs: "If the batch inference job is terminated, all completed rows are exported"). `PARTIALLY_SUCCEEDED` is terminal with rows possibly missing (JobState description).
- **Results readable on failed?** Partially: the unwritable-output job reached `FAILED` with `successfulCount: "2"` and a `gcsOutputDirectory`, but nothing could be written there `[capture 2026-09-02]`. For import failures (code `3`) nothing runs, so there is no output. Finalization fetches results only when the upstream status is `completed` (`services/batch-api/src/finalize/process-completed-batch.ts`, `isUpstreamCompleted`) `[code]`.
- **Readable on cancelled?** Docs say completed rows are exported on cancel and charged. Finalization does not fetch on `cancelled` `[code]`, so those rows are billed by Google to the platform and not served `[unconfirmed]` live, see D1.
- **Readable on expired?** `[unconfirmed]`.
- **Where do failed lines live?** Inline in the prediction shards with a non-empty `status` string. No error file `[docs]`, `[capture 2026-09-02 via OpenRouter]`.
- **Do failed lines carry `custom_id`?** Yes, the sibling key is echoed `[capture 2026-09-02]`.
- **Do failed lines carry usage?** No `usageMetadata` (no `response` at all) `[docs example]`, served with `response: null` `[capture 2026-09-02]`.
- **Are failed lines charged?** Not by OpenRouter (`finalized_cost` excluded them, `emit_generations.done skipped: 1`) `[capture 2026-09-02]`. Google's own charging for rejected rows is `[unconfirmed]` (docs say only completed requests are charged).
- **Counter mapping** `total = successful + failed + incomplete` from Vertex. OpenRouter's served `request_counts` for the 4+1 batch was `{total: 5, completed: 4, failed: 1}` `[capture 2026-09-02]`.

## 11. OpenRouter endpoint intersection

- `/v1/chat/completions`: served, all dogfood cases `[capture 2026-09-02]`.
- `/v1/embeddings`: Vertex Gemini embeddings batch wire enabled in [#34198](https://github.com/OpenRouterTeam/openrouter-web/pull/34198) `[code]`. Not exercised here `[unconfirmed]` live.
- `/v1/responses`, `/v1/messages`: lowered through the internal chat shape by the batch skins, no Vertex-specific path `[code]`. Not exercised.
- Text-only: image and file parts are rejected at submit (§14).
- `web_search` tools rejected at submit for this endpoint `[capture 2026-09-02]`.

## 12. Credential shape

Platform: ADC (workload identity, no key material) plus project, region, and output prefix (`gs://openrouter-batch-api-dev/vertex-output` in dev) `[code]`. The dev service-account JSON key used for direct captures belongs to project `llmixer` and cannot create jobs in the configured `openrouter-core` project nor list or write the configured bucket `[capture 2026-09-02]`, so native happy-path output could not be captured (exact denials in "Dogfood evidence").

BYOK (`[code]` `vertex-byok-adapter.ts`, `vertex-byok-gcs.ts`, `projects/docs/batch-quickstart.mdx`): customer uploads a service-account key with project and region. On first batch the adapter creates a bucket named `<prefix><sanitized project>[-<hash>]-<region>` (≤ 63 chars, hash only when sanitization changed the id), location = region upper-cased or `US` for `global`, uniform bucket-level access, public access prevention enforced, soft delete off, 30-day delete lifecycle. Required roles from the adapter's own error text: `roles/storage.admin` on the project for the auto-bucket path, or bucket list/inspect plus `roles/storage.objectUser` on a pre-existing bucket, and the customer's Vertex AI service agent needs object access on it. Live BYOK is `[unconfirmed]` (no BYOK credential provisioned).

## 13. Artifact handles

- Input: `gs://<bucket>/<billable entity>/<batch id>/input_file_lowered` (`services/batch-api/src/storage/batch-gcs-store.ts`) `[code]`. The same path appears verbatim in Vertex import errors in Datadog `[capture 2026-09-02 query]`.
- `upstream_batch_id`: full resource name `projects/<project>/locations/<location>/batchPredictionJobs/<int64>` `[capture 2026-09-02]`.
- `output_file_id`: `outputInfo.gcsOutputDirectory` prefix. Shards listed at read time `[code]`.
- `error_file_id`: always `null` `[code]`.
- Delete: `batchPredictionJobs.delete` exists `[docs: https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.batchPredictionJobs/delete]`; the adapter does not call it, and output objects follow bucket lifecycle `[code]`.

## 14. Native remote image / file URL support

- Native wire: `fileData.fileUri` with `gs://` URIs is the documented multimodal input for batch (video and image examples) `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-from-cloud-storage]`. Public `https://` URIs in batch are `[unconfirmed]`; live native multimodal captures were blocked by permissions.
- `batchAdapterSupportsImageUrls(google-vertex)` = `false`: "Vertex Gemini does not support image inputs in batch because its serializer has no image URL representation" `[code]` `image-url-support.ts`, observed as the submit rejection for request `mm1` `[capture 2026-09-02]`.
- `batchAdapterSupportsFileUrls(google-vertex)` = `false`: `contains unsupported 'file' content` `[code]` `file-url-support.ts`, `assert-supported-batch-content.ts`, observed for `mm2` `[capture 2026-09-02]`.

Both are correct as *platform* limitations. The native wire could carry `gs://` media, so lifting them would need a GCS staging step and is a product decision, not a bug.

## Dogfood evidence (2026-09-02)

`batch-adapter-dogfooding` matrix, `google/gemini-2.5-flash-lite` on `/v1/chat/completions`, `provider.only: ["google-vertex"]`. **Provider verdict: SAFE WITH KNOWN LIMITS.** Every reachable OpenRouter path passed; the limits are the platform's text-only and shared-schema rules, the importer preflights the adapter lacks (D3 to D5), and the native cases the dev credential could not run (Deferred). Identifiers are truncated to their last characters; upstream jobs are `projects/<n>/locations/europe-west4/batchPredictionJobs/<id>`.

Aggregate over the 17 completed OpenRouter batches: every `batch_api.batch_accepted` had `provider_name: "Google"`; every `batch_api.finalize.completed` had `async_job_status: completed`, `is_usage_complete: true`; every `batch_api.emit_generations.done` had `emitted + skipped == total_lines`, `unaccounted: 0`; no `emit_generation.missing_usage` or `fallback_usage_estimated` event; each batch produced 9 Datadog events (accept, submit upstream, sweep/poll, finalize, emit and siblings). Every `finalized_cost` equalled `prompt × $0.05e-6 + completion × $0.20e-6` `[docs: https://cloud.google.com/vertex-ai/generative-ai/pricing]`. Spend: about $0.0006 on the OpenRouter test key; two direct Vertex inference rows on the public sample (job failed at export, output never stored). Datadog query template: `https://us5.datadoghq.com/logs?query=service%3Abatch-api*%20%40data.jsonPayload.extra.job_id%3A<batch-id>`.

Native access preconditions (the reason every output-dependent native case is Deferred):

- `batchPredictionJobs.create` in `VERTEX_BATCH_PROJECT_ID` (`openrouter-core`): HTTP 403 `PERMISSION_DENIED`, `Permission 'aiplatform.batchPredictionJobs.create' denied on resource '//aiplatform.googleapis.com/projects/openrouter-core/locations/us-central1'`. The key in `GOOGLE_APPLICATION_CREDENTIALS_JSON` belongs to a service account in `llmixer`, where create is allowed; all native jobs ran there.
- `BATCH_GCS_BUCKET` (`gs://openrouter-batch-api-dev`): `storage.objects.list` and `storage.objects.create` denied. Scratch bucket in `llmixer`: `storage.buckets.create` denied.
- The public sample `gs://cloud-samples-data/batch/prompt_for_batch_gemini_predict.jsonl` is readable by the Vertex service agent, which is how the two-row `successfulCount: "2"` then code `7` export failure in §5 was produced.

Cases that evidence a provider quirk or an OpenRouter behavior (all `[capture 2026-09-02]`; PASS unless stated):

| Case | Evidence (batch, upstream job) | Verdict / note |
| --- | --- | --- |
| 5 valid lines `iso-1..5` | `{total 5, completed 5, failed 0}`, results order `iso-3, iso-2, iso-1, iso-5, iso-4`, cost 4.25e-6 = 45×0.05e-6 + 10×0.2e-6 (`…CMJquZ`, `…43776`) | Output order is not input order; join on `custom_id`. |
| Numeric-looking `custom_id`s `"12345"`, `"000000"`, `"7"` | All three returned as the original strings, cost 1.5e-6 (`…KwekLQ`, `…73376`) | The `or-cid-` prefix defeats the importer's type coercion, including leading zeros. |
| 4 valid + 1 bad function name `get weather!` (`mb-bad`) | `{5, 4, 1}`, `mb-bad` served `response: null`, `error.message: "The GenerateContentRequest proto is invalid: * tools[0].function_declarations[0].name: [FIELD_INVALID] ..."`, same text as the sync 400; job `SUCCEEDED`, cost 2.0e-6 = 24×0.05e-6 + 4×0.2e-6, emit `4/0/0/1` skipped (`…mr6SeP`, `…11616`) | Per-row failure does not fail the job; failed row is unbilled. |
| `tool_choice` naming an undeclared function | `{5, 5, 0}`, the line answered normally (`…nWtbl7`, `…47264`) | Not a Vertex validation error; no per-row failure to test with. |
| 1 line, all invalid | `{1, 0, 1}`, top-level `error.message: "All 1 request(s) in this batch failed upstream; inspect each result's error field."`, cost 0 (`…QYPAgj`, `…71040`) | Job still `SUCCEEDED` upstream, `completed` on OpenRouter. |
| Syntactically invalid JSONL | HTTP 400 at `POST /api/beta/batches`, no batch, no upstream call | Platform rejects before Vertex's code `3` import failure. |
| One tool / several tools auto / forced `tool_choice` / parallel calls | `finish_reason: tool_calls`, `native_finish_reason: STOP`; forced mode honored; two `get_weather` calls in one message (`…cmcGZr`, `…nagWh9`, `…Rn9ODF`, `…mxaybJ`) | |
| `web_search` tool (alone or with function tools) | Synchronous `failed`, `"Batch request 'ws1' sets a 'web_search' tool, but the batch endpoint for 'google/gemini-2.5-flash-lite' does not support native web search..."` (`…wcVpK4`, `…pgt94S`), no upstream job | EXPECTED LIMITATION, `packages/batch/schemas/assert-no-web-search.ts`. Search-charge billing untestable. |
| Basic / nested / `$defs`+`$ref` / `json_object` / schema + tools | All `completed` with valid JSON or a tool call; `$defs` inlined before import (`…Bm3ASu`, `…ka1HYU`, `…5lGDGp`, `…HaLMCK`, `…unL9JO`) | |
| Mixed `response_format` schemas across lines | Synchronous `failed`, `"Batch request 'so5b' cannot share an upstream input with the requests before it: they use response_format 'json_schema' with schema {...}"` (`…0uzEml`) | EXPECTED LIMITATION, `services/batch-api/src/submit/accept/`. |
| Public image URL (`mm1`) / public PDF URL (`mm2`) | Synchronous `failed`: `"Vertex Gemini does not support image inputs in batch because its serializer has no image URL map; use the sync API."` / `"contains unsupported 'file' content..."` (`…7wKT9G`, `…oFZchK`) | EXPECTED LIMITATION, §14. |
| Reasoning (`reasoning.effort: low`, `max_tokens: 1500`) | `completion_tokens: 1075`, `reasoning_tokens: 0`, `reasoning` and `reasoning_details` served; sync gave `completion_tokens: 1197`, `reasoning_tokens: 417`; cost 2.157e-4 = 14×0.05e-6 + 1075×0.2e-6 (`…IKDtyu`, `…51872`) | PASS billing, D2 metadata. |
| Truncation (`max_tokens: 5`) | `finish_reason: length`, `native_finish_reason: MAX_TOKENS` (`…XkPL5d`, `…57920`) | |
| Shared 2.6k-token prefix, 2 rows | `cached_tokens: 0`, `prompt_tokens: 2676` each, cost 2.6855e-4 = 5355×0.05e-6 + 4×0.2e-6, no discount (`…AKZY0P`, `…03936`) | UNTESTED, no cache hit observed. |
| Native `google_search: {}` | Not run; Datadog shows 2 production jobs failed import with `Cannot store struct 'request.tools.google_search' with no fields` | Same empty-struct importer failure class as D5, but a distinct path: see the `request.tools.google_search` row in §3. `assert-no-web-search.ts` rejects this path only when the resolved endpoint lacks `supports_native_web_search`; enabled endpoints admit it and the job fails at import. |
| Empty input / `temperature: 5` | Sync returns 400 (`Input must have at least 1 token.`, `Expected temperature to be at most 2, received 5`); not submitted through batch | UNTESTED: record whether batch rejects synchronously or per row. |

UNTESTED on the OpenRouter side, with prerequisite: native search charges (web search enabled for the endpoint), cache discount (an observed hit), BYOK bucket auto-creation (a BYOK GCP credential), uploaded file references (no batch upload surface), multi-shard output (a job large enough to shard), failure injection and idempotent replay (fault hooks; covered only statically by `services/batch-api/src/finalize/*.test.ts`).

## Divergences found between adapter and observed/documented behavior

Verified (evidence cited) versus unconfirmed are marked.

- **D1 (verified against docs, unconfirmed live). Cancelled jobs export completed rows and those rows are charged, but the adapter does not fetch results for `cancelled`.** `[docs: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-gemini]` ("any already completed work is returned. You'll only be charged for the completed requests"). Finalization only fetches results when the upstream status is `completed` (`process-completed-batch.ts`). Impact: platform pays Google for rows a customer never receives and is never billed for. Same shape as the AI Studio and xAI notes. Severity low (cancel is rare, cost bounded). Closure: decide product behavior (serve partial results on cancel) and confirm live with a running job cancelled mid-flight, which needs a credential that can read the output bucket.
- **D2 (verified live). `reasoning_tokens` is `0` in batch results while sync reports it.** Batch folds `thoughtsTokenCount` into `completion_tokens` (`vertex-gemini-normalize-output.ts`) and omits `completion_tokens_details`. Sync served `reasoning_tokens: 417` for the same prompt `[capture 2026-09-02]`. Billing is unaffected (both bill thoughts as output). Severity low, metadata parity.
- **D3 (verified in Datadog). Schemas nested deeper than 15 levels fail the whole job at import** (16 jobs on 2026-08-31, code `3`, `Schema nested too deeply, at least 16 compared to the maximum allowed level of 15`). The adapter has no depth preflight. Sync accepts the same schema. Impact: a single deep line fails every line in the batch with a Vertex message. Severity medium. Smallest safe fix: measure inlined schema depth in `gemini-serialize-request.ts` and reject the line with a 400 naming the path, plus a unit test with a 16-level schema.
- **D4 (verified in Datadog). Property names outside BigQuery column rules fail the import** (`Invalid field name "No Vague/Misleading Claims About Competitor"`, 1 job 2026-08-29). The strip pass only removes `$`-keywords and leaves user property names. Severity low. Fix: same preflight, reject with the offending path.
- **D5 (verified in Datadog). Empty objects inside `contents` fail the import** (`Cannot store struct 'request.contents.parts.functionCall.args. output_schema' with no fields`, 1 job 2026-08-29). Conversation history with a tool call whose arguments contain `{}` is customer data the schema pass never touches. Severity low. Fix: reject or document.
- **D6 (verified live). No results are served for a `FAILED` job even when `successfulCount > 0` and `gcsOutputDirectory` is set.** Observed on the unwritable-output job (`successfulCount: "2"`). In that case nothing was actually written, so no data was lost. For other `FAILED` causes with partially written shards the loss is `[unconfirmed]`. Same closure as D1.
- **D7 (verified live). Production platform jobs run in `europe-west4` while the dev configuration points at `us-central1`.** Not a bug, but the region governs pricing tier (`Non-global` vs `Global` rows on the pricing page for Gemini 3 models) and data residency. Record it wherever region is assumed.
- **Not a divergence.** `JOB_STATE_PARTIALLY_SUCCEEDED → completed`, string counters, `-1` incomplete, inline `status` failures with preserved `custom_id`, `or-cid-` prefix, no error file, `output_file_id` as a prefix, and text-only capability switches all match the docs and the captures.

## Deferred

Captures the provisioned dev credential made impossible on 2026-09-02. The dev service-account JSON key used for direct captures (Infisical `GOOGLE_APPLICATION_CREDENTIALS_JSON`, not the platform's ADC path) belongs to a service account in a different project than `VERTEX_BATCH_PROJECT_ID` (create returns 403 there) and has no object read or write on `BATCH_GCS_BUCKET`, so no native job could publish output. Each item names the field it leaves unconfirmed.

- Native `SUCCEEDED` job with readable `predictions.jsonl`: raw success row and inline failed row wire shape (only the served shape via OpenRouter was observed), shard naming past the first file, `incremental_predictions` layout.
- `JOB_STATE_PARTIALLY_SUCCEEDED`: whether Vertex ever emits it for inline per-row failures or only for interrupted jobs.
- Output written before `CANCELLED`, `FAILED`, or `EXPIRED`: readability and whether `completionStats` and `outputInfo` stay populated (D1, D6).
- `thoughtsTokenCount`, `cachedContentTokenCount`, and grounding metadata on native rows, and an implicit-cache hit in batch (the 2.6k-token shared prefix produced none).
- Native `fileData.fileUri` with `gs://` and public `https://` for images and PDFs (§14 answers from docs and code only).
- BYOK bucket auto-creation against a real customer project.

Prerequisite for all of them: a service account in `VERTEX_BATCH_PROJECT_ID` with `aiplatform.batchPredictionJobs.create` and object read/write on `BATCH_GCS_BUCKET`, or a scratch project where `storage.buckets.create` is allowed.
