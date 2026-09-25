# Together Batch API — research note

Backfill output of `research-batch-provider` for Together, written after the adapter under `packages/batch/adapters/together/` was already in production. Live captures were taken on 2026-09-02 against `https://api.together.xyz` with the platform development credential (Infisical `/services/batch-api`, `TOGETHER_API_KEY`), and against the OpenRouter public Batch API with the batch test key. The direct-versus-OpenRouter dogfood evidence lives in the "Dogfood parity run" section below. Raw transcripts stay in `/tmp/batch-research/together/` and are not committed. Redacted copies of the captures that back the claims below are committed under `packages/batch/adapters/together/fixtures/live-*` (see "Committed fixtures"). Account, project, and organization identifiers are omitted here. Native job and file IDs are shortened to 8 characters, OpenRouter job IDs belong to the batch test key and are listed in full so the Datadog rows can be re-queried.

Provenance labels: `[capture]` observed live on 2026-09-02, `[docs]` from an official Together page (URL inline), `[unconfirmed]` neither.

## Official sources

Every official Together URL relied on in this note. Pages were fetched on 2026-09-02.

- Batch overview (limits, supported models, discounted models, billing): https://docs.together.ai/docs/inference/batch/overview
- Batch tutorial (request-line shape, `custom_id` cap, lifecycle): https://docs.together.ai/docs/inference/batch/tutorial
- Manage batch jobs (status enum table, results, error file, cancel, list): https://docs.together.ai/docs/inference/batch/manage
- API reference, create batch: https://docs.together.ai/reference/batch-create
- API reference, retrieve batch: https://docs.together.ai/reference/batch-get
- API reference, list batches: https://docs.together.ai/reference/batch-list
- API reference, cancel batch: https://docs.together.ai/reference/batch-cancel
- API reference, upload file (purpose enum): https://docs.together.ai/reference/upload-file
- API reference, retrieve file metadata: https://docs.together.ai/reference/get-files-id
- API reference, retrieve file content: https://docs.together.ai/reference/get-files-id-content
- API reference, list files: https://docs.together.ai/reference/get-files
- API reference, list models: https://docs.together.ai/reference/models
- Serverless rate limits: https://docs.together.ai/docs/serverless/rate-limits
- OpenAI compatibility: https://docs.together.ai/docs/inference/openai-compatibility
- Pricing: https://www.together.ai/pricing
- Docs index used to locate the reference pages: https://docs.together.ai/llms.txt

Not found on any official page fetched: file or job retention windows, a per-file line cap, and a batch-specific requests-per-minute figure. Those claims below are `[unconfirmed]`.

## 1. Auth

- `Authorization: Bearer <TOGETHER_API_KEY>` on every call `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/manage).
- `[capture]` A request with no browser-like `User-Agent` (Python `urllib` default) was answered by Cloudflare with HTTP 403 and error code `1010` before reaching the API. Sending `User-Agent: curl/8.5.0` and `Accept: */*` made the same request succeed. The production adapter is not affected (500 Together jobs finalized in the 7-day Datadog sample), so this only bites hand-rolled probes.
- `[capture]` The platform dev key reads the account's batch list, files, and models. BYOK keys are the same bearer shape (section 12).

## 2. Endpoints

Documented base URL is `https://api.together.ai/v1` `[docs]` (official docs: https://docs.together.ai/reference/batch-create). The adapter's `defaultBaseUrl` is `https://api.together.xyz` (`services/batch-api/src/adapters/api-key-providers.ts:41`). `[capture]` Both hosts answered identically for `GET /v1/batches` with the same key (`k-host-probe-api-together-ai`). Treat `.xyz` as a working alias, not the documented host (divergence D5).

| Operation | Endpoint | Live result `[capture]` | Docs |
| --- | --- | --- | --- |
| Upload input | `POST /v1/files/upload` multipart `purpose=batch-api`, `file_name`, `file` | HTTP 200, `{id, object: "file", purpose: "batch-api", processing_status, bytes, LineCount, Processed, FileType}` | https://docs.together.ai/reference/upload-file |
| File metadata | `GET /v1/files/{id}` | HTTP 200, same shape as upload | https://docs.together.ai/reference/get-files-id |
| File content | `GET /v1/files/{id}/content` | HTTP 200, raw JSONL | https://docs.together.ai/reference/get-files-id-content |
| List files | `GET /v1/files` | HTTP 200 `{data: [...]}` | https://docs.together.ai/reference/get-files |
| Create | `POST /v1/batches` `{input_file_id, endpoint, completion_window?, model_id?}` | HTTP 201 `{job: {...}}` | https://docs.together.ai/reference/batch-create |
| Retrieve | `GET /v1/batches/{id}` | HTTP 200, bare job object (no `job` wrapper) | https://docs.together.ai/reference/batch-get |
| List | `GET /v1/batches` | HTTP 200, bare JSON array of job objects | https://docs.together.ai/reference/batch-list |
| Cancel | `POST /v1/batches/{id}/cancel` | HTTP 200 job object with `status: "CANCELING"`; HTTP 409 `{"error": "Cannot cancel job - already in terminal state: CANCELLED"}` on a terminal job | https://docs.together.ai/reference/batch-cancel |
| Unknown batch | `GET /v1/batches/<random uuid>` | HTTP 404 `{"error": "Job not found", "request_id": "..."}` | |
| Unknown file | `GET /v1/files/<random>/content` | HTTP 404 `{"error": {"message": "File ... not found", "type": "not_found"}}` | |

Create wraps the job in `{"job": ...}` and every later read returns the job bare `[capture]`; the adapter handles this (`TogetherCreateResponseSchema = z.object({ job: ... })` in `batch-submitter.ts`, bare object in `batch-poller.ts`).

`[capture]` Creating a batch against a non-existent `input_file_id` returned HTTP 201 and `VALIDATING`, then `FAILED` with `error: "Failed to download input file: ... 404 ..."` (`j-create-bad-file-id`). Creation is never a validation point for the file. `[capture]` Uploading with `purpose=fine-tune` and then creating a batch from it also worked and `COMPLETED` (`i-upload-wrong-purpose`), so `purpose` is not enforced for batch input. The adapter always sends `batch-api`, which is the documented value `[docs]` (official docs: https://docs.together.ai/reference/upload-file).

## 3. Native request-line shape

```json
{"custom_id": "request-1", "body": {"model": "openai/gpt-oss-20b", "messages": [{"role": "user", "content": "Hello"}], "max_tokens": 64}}
```

- Two fields per line, `custom_id` and `body`, where `body` is the chat-completions request `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/tutorial).
- `custom_id` is documented as max 64 chars `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/tutorial). `[capture]` A 65-char `custom_id` was accepted natively and its row came back in the output file (`g-custom-id-65-chars`). OpenRouter caps it at 64 (`packages/batch/adapters/together/schemas.ts:5`, enforced by `services/batch-api/src/submit/shared/validate-custom-id.ts:43-47`), which is the documented value and therefore the safe choice.
- `body.model` is required per line `[capture]`. A line without `model` plus `model_id` on the create call was accepted, then the row failed at execution with `missing 'model' field in body or not a string` (`h-no-model-in-line-model_id-on-create`). The adapter stamps the routing model into every line (`transform.ts` `toTogetherBatchInputLine`), so this cannot happen through OpenRouter.
- OpenRouter also rejects a per-line `model` that differs from the top-level `model` at submit with HTTP 400 `Each batch request body model must match the top-level model.` (`services/batch-api/src/submit/worker/scan-and-persist-batch-requests.ts:823`) `[capture]` (`or-a2b-line-model-override`).
- Batch results come back in arbitrary order and `custom_id` is the reconciliation key `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/overview). `[capture]` confirmed on every multi-line job.

## 4. Exhaustive upstream status model

Documented enum `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/manage and the `BatchJobStatus` schema at https://docs.together.ai/reference/batch-get): `VALIDATING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `EXPIRED`, `CANCELLED`.

`[capture]` Observed values: `VALIDATING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `CANCELLED`, and one value absent from the docs and from the adapter schema, `CANCELING` (single L), returned by the cancel call and by the next two polls before the job settled to `CANCELLED` (`a4-cancel`, about 15 seconds). `EXPIRED` was not observed (a 24 h wait exceeds the capture budget).

Adapter mapping (`status.ts` `toUpstreamStatus`):

| Native | `UpstreamBatchStatus` | Terminal |
| --- | --- | --- |
| `VALIDATING` | `Validating` | no |
| `IN_PROGRESS` | `InProgress` | no |
| `COMPLETED` | `Completed` | yes |
| `FAILED` | `Failed` | yes |
| `EXPIRED` | `Expired` | yes |
| `CANCELLED` | `Cancelled` | yes |
| `CANCELING` | not in `TogetherStatusSchema`, poll fails Zod parse | see D1 |

Status object fields `[capture]`: `id`, `input_file_id`, `file_size_bytes`, `status`, `job_deadline`, `created_at`, `endpoint`, `progress` (0 to 100), `model_id` (present once validation passes), `output_file_id`, `error_file_id` (each only when that file exists), `completed_at`, and `error` (string, only on `FAILED`). There is **no `request_counts`** and no per-request counters of any kind. `job_deadline` is `created_at` plus 24 h `[capture]`, matching the fixed `24h` completion window `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/overview).

Completion and failure semantics, answering the skill's questions:

- **Does terminal mean every sub-request finished?** `COMPLETED` means the job stopped and any successful rows are in `output_file_id`. It does not mean every row succeeded. `[docs]` "a `COMPLETED` batch can still contain individual request failures" (official docs: https://docs.together.ai/docs/inference/batch/manage). `[capture]` `a2-partial-4valid-1invalid-model` reached `COMPLETED` with four rows in the output file and one in the error file.
- **Results readable on `FAILED`?** `[capture]` No. Both `FAILED` jobs observed (malformed JSONL, non-serverless model) carried neither `output_file_id` nor `error_file_id`. The only diagnostic is the top-level `error` string, for example `Failed to calculate tokens: input format error: Line 2 (within chunk): Invalid JSON format - ...` and `Invalid model ID: Unable to access non-serverless model ...`.
- **Results readable on `CANCELLED`?** `[docs]` Requests completed before the cancel landed are still billed and their responses are still returned in the output file (official docs: https://docs.together.ai/docs/inference/batch/manage). `[capture]` The cancelled job was cancelled during `VALIDATING` and ended with no file handles at all, so the partial-output case is `[unconfirmed]` live.
- **Results readable on `EXPIRED`?** `[unconfirmed]`. No official page states it and it was not observed.
- **Where do failed lines live?** In `error_file_id`, a separate JSONL file, only when the job itself reaches `COMPLETED` `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/manage) `[capture]`. Whole-job rejections (bad JSONL, bad model, missing file) produce no error file, only `error`.
- **Do failed lines carry `custom_id`?** Yes `[capture]`, plus a Together-generated `id` (`br_...`). See section 5.
- **Do failed lines carry usage?** No `[capture]`. The error envelope is `{code, message}` only.
- **Are failed lines charged?** `[docs]` "Failed requests in the error file aren't billed" (official docs: https://docs.together.ai/docs/inference/batch/overview). Not verifiable from the API (no billing endpoint was probed).
- **How do counters map?** There are none natively. `pollTogetherBatch` returns `{total: 0, completed: 0, failed: 0}` and the finalizer reconstructs counts from the served rows (section 10).

## 5. Output and error shapes

Output file row `[capture]` (`gpt-oss-20b`):

```json
{"id": "br_<opaque>", "custom_id": "ok-1", "response": {"status_code": 200, "body": {"id": "<provider id>", "object": "chat.completion", "created": 1788380068, "model": "openai/gpt-oss-20b", "prompt": [], "metadata": {"weight_version": "default"}, "choices": [{"index": 0, "finish_reason": "stop", "logprobs": null, "seed": null, "message": {"role": "assistant", "content": "1", "reasoning": "...", "tool_calls": []}}], "usage": {"prompt_tokens": 73, "completion_tokens": 42, "total_tokens": 115, "reasoning_tokens": 0}}}}
```

Error file row `[capture]`:

```json
{"id": "br_<opaque>", "custom_id": "bad-model", "error": {"code": "batch_client_error", "message": "Unable to access model nonexistent/model-xyz. Please visit https://api.together.ai/models/... to create and start a new dedicated endpoint for the model."}}
```

- Documented output row is `{custom_id, response: {status_code, body}}` and the error row is keyed by `custom_id` `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/manage). The live rows add `id` on both, which the adapter ignores (`TogetherResponseLineSchema` and `TogetherErrorLineSchema` in `output-parser.ts` are non-strict).
- `[capture]` Per-line error codes seen: `batch_client_error` for an unknown model, an invalid `tool_choice` function name, more than four `stop` sequences, an image part on a text model, an image URL whose host refuses non-browser clients, and a `file` part. Together validates request parameters at execution time, not at upload or create.
- `[capture]` Rows can come back with `finish_reason: "length"`, empty `content`, and the budget spent in `message.reasoning` (`gemma-4-31B-it` at `max_tokens: 16` and 48, `gpt-oss-20b` at 64). This is model behavior, identical on the sync path, and the row is still a 200 with usage.
- `[capture]` `message.reasoning` (string) is present for `gpt-oss-20b` and DeepSeek V4 Flash. `usage.reasoning_tokens` sits at the top level of `usage` for `gpt-oss-20b` (value 0), and DeepSeek V4 Flash additionally returns `usage.completion_tokens_details.reasoning_tokens` (`r-reasoning-deepseek-v4-flash`). `parseTogetherBatchUsage` parses the body with the shared `NonStreamCompletionResponseSchema`, which reads the nested `completion_tokens_details` and drops the flat extension.
- `[capture]` `message.tool_calls` is `[]` on rows without tool calls; `normalizeChatCompletionsChoices` in `normalizeTogetherBody` handles that before the shared schema sees it.
- `[capture]` Structured outputs (`response_format: json_schema`) with nested objects, arrays, enums, optional fields, `$defs` plus local `$ref`, and a reused referenced definition all returned HTTP 200 rows with schema-conforming `content` (`c-structured-outputs`, `c2-structured-defs-ref-1024`). Structured output combined with tools returned a 200 row.
- `[capture]` Tools (`gpt-oss-20b`): one tool, several tools with automatic selection, a forced `tool_choice`, and a parallel prompt each returned 200 rows, and every row with `tool_calls` parsed through the adapter. Whether the model actually emitted a call varied between the native and OpenRouter runs (the forced call came back with zero `tool_calls` and whitespace content natively and with one call through OpenRouter), and the parallel prompt leaked harmony markup (`commentary to=functions.get_time json{...}`) into `content` on both sides. That is `gpt-oss-20b` sampling on Together, not an adapter transform difference. A `web_search` tool type was rejected per line as a malformed tool (`b-tools`). No native web search in batch.

## 6. Limits

All `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/overview) unless noted:

- Up to 50,000 requests per batch.
- Up to 100 MB per input file.
- Up to 10 MB per line, including inline base64 payloads. Oversized lines are not caught at validation and fail with `error reading input file` `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/tutorial).
- Up to 30B tokens enqueued per model at any time.
- Batch jobs run against a separate rate-limit pool from the real-time API. Poll every 30 to 60 s, tighter loops hit rate limits `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/manage). The serverless rate-limits page gives no batch-specific RPM figure (official docs: https://docs.together.ai/docs/serverless/rate-limits).
- `custom_id` max 64 chars `[docs]` (see section 3 for the live divergence).
- `[capture]` Four `stop` sequences maximum per request (`Maximum four stop sequences allowed`, `f2-per-line-probe`).
- `[capture]` No rate limit was hit during roughly 40 native jobs with 10 s polling.

## 7. Expiry and retention

- Completion window is fixed at `24h` and is best-effort `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/overview). `[capture]` `job_deadline = created_at + 24h` on every job.
- `EXPIRED` means the job exceeded its time limit `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/manage).
- File and job retention: `[unconfirmed]`. No official page fetched states how long input, output, or error files stay downloadable or how long jobs stay listable. `[capture]` Files from 2026-09-02T17:39Z were still listable and downloadable three hours later.
- Finalization runs within minutes of the sweep noticing a terminal poll (Datadog, section 10), well inside any plausible window.

## 8. Pricing

- Batch is advertised as "up to 50% lower cost" but the discount applies only to the listed discounted models, `meta-llama/Llama-3.3-70B-Instruct-Turbo` and `openai/whisper-large-v3`. "Models not listed run at standard rates" `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/overview). The pricing page has a batch toggle but its `data-batch` discount attributes were empty for every listed model on 2026-09-02 `[capture]` (official docs: https://www.together.ai/pricing).
- Only successful rows in the output file are billed, error-file rows are not, and cancellation does not refund rows finished before the cancel `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/overview).
- `[capture]` `GET /v1/models` lists `openai/gpt-oss-20b` at `$0.05 / $0.20` per 1M tokens and `deepseek-ai/DeepSeek-V4-Flash-0731` at `$0.14 / $0.28`. The OpenRouter `:batch` endpoint rows for `openai/gpt-oss-20b:batch` are `0.00000005 / 0.0000002` per token, the same as Together's standard rate, consistent with no batch discount on these models.
- `[capture]` Datadog `finalized_cost` equals `prompt_tokens * 5e-8 + completion_tokens * 2e-7` on every `gpt-oss-20b` job checked (for example 219 prompt + 24 completion tokens = 1.575e-05).

## 9. Sync-transform overrides

The sync Together adapter (`packages/router/adapters/together/`) serializes through `serializeTogetherRequest`. The batch adapter lowers through `togetherInternalRequestToBatchInput` (`from-internal-request.ts`) so the batch body matches the sync wire body. Points checked:

- `[capture]` `reasoning` in the message and `reasoning_tokens` in usage come back in the same places as the sync response, so `openAiBatchBodyToInternalResponse(body, ProviderName.Together)` renders reasoning identically.
- `[capture]` `tool_calls: []` and `logprobs: null` on plain rows are the same as sync and are normalized by `normalizeTogetherBody`.
- `[capture]` Together caps `stop` at four entries and rejects a `tool_choice` naming a function absent from `tools`, in batch as a per-line `batch_client_error` rather than a sync HTTP 400. Same rule, different channel.
- `[capture]` `s-sync-image-gemma-4-31b`: an image request whose URL host (`upload.wikimedia.org`) answers HTTP 400 to non-browser clients returned HTTP 500 `Internal server error` on the sync endpoint and `batch_client_error: Internal server error` per line in batch (`d3-multimodal-gemma-4-31b`). With a URL that serves generic clients (`raw.githubusercontent.com`) the batch row succeeded (`d5-multimodal-gemma-4-31b-github-png`). Batch and sync fetch remote images the same way and fail the same way on a refused fetch.

## 10. OpenRouter mapping decision

Adapter: `TogetherBatchAdapter` (`together-batch-adapter.ts`), `ingestMode: File`, `resultMode: FileHandle`.

- `uploadNativeInput` → `uploadTogetherFile` multipart to `/v1/files/upload` with `purpose=batch-api`. Returns the `file-...` id.
- `submitNativeBatch` → `submitTogetherBatch` posts `{input_file_id, endpoint: "/v1/chat/completions"}` and reads `job.id` and `job.status`.
- `pollBatch` → `pollTogetherBatch`:
- `status`: `toUpstreamStatus(status)` (section 4 table). `CANCELING` fails the parse (D1).
- `request_counts`: the native object has none, so the adapter returns zeros. `services/batch-api/src/finalize/finalize-batch-job.ts` treats all-zero counts as "provider carries no counts" and derives `total` from the accepted line count, `completed` from parsed output rows, `failed` from error rows and the remainder. `[capture]` `or-a6-partial-output-and-error-file` served `{total: 4, completed: 3, failed: 1}` from a native job with 3 output rows and 1 error row.
- `failure_reason`: not mapped. `TogetherPollResponseSchema` has no `error` field, so a `FAILED` job is served with the generic `The provider ended this batch as "failed" without reporting a reason.` even though Together's poll body carries a specific `error` string (D2).
- `output_file_id`, `error_file_id`: passed through, `null` when absent.
- `fetchNativeResults` → `downloadTogetherFile` on `output_file_id ?? error_file_id` (base class picks the handle) with up to 5 retries on retryable initial errors, logging `batch.together.download_retry` per retry. Finalization also downloads `error_file_id` separately into `BatchGcsArtifact.ErrorRawResponse` when present (`process-completed-batch.ts`). `[capture]` Datadog searches for `batch.together.download_retry` over 14 days returned 0 events, so the retry path has not fired in production in that window. Its trigger (an initially unreadable output file) is `[unconfirmed]`. Datadog link: https://us5.datadoghq.com/logs?query=service%3Abatch-api%2A%20batch.together.download_retry
- `parseResult` → `parseTogetherBatchResult`: a `response` row is normalized (`id`, `created` defaults, `tool_calls` normalization) and parsed with `NonStreamCompletionResponseSchema`, then wrapped as `{id: custom_id, custom_id, response: {status_code, request_id: null, body}, error: null}`. An `error` row becomes `{response: null, error: {type: code ?? 'invalid_request_error', message, param: null}}`. `[capture]` The served OpenRouter error row for `tool-choice-missing-fn` was `{"error": {"type": "batch_client_error", "message": "Selected function was not found in the tools list"}}`.
- `parseUsage` → `parseTogetherBatchUsage`: `usage` from the shared schema. `[capture]` `emit_generations.done` reports `emitted == total_lines` and `estimated: 0, skipped: 0, unaccounted: 0` on every successful job checked.
- Whole-batch failure: when a native job is `FAILED`, OpenRouter serves `status: failed`, `request_counts.failed == total`, `usage: null`, `results: null` `[capture]` (`or-f-nemotron-non-serverless`).

## 11. OpenRouter endpoint intersection

- Together batch supports `/v1/chat/completions` for most serverless models and `/v1/audio/transcriptions` and `/v1/audio/translations` for audio models `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/overview).
- The adapter submits only `/v1/chat/completions` (`TOGETHER_ENDPOINT` in `batch-submitter.ts`). OpenRouter `/v1/responses` and `/v1/messages` lines are lowered to the chat wire by the completions skin. Embeddings and audio are not offered on Together `:batch` rows.
- `[capture]` OpenRouter `:batch` variants routed to Together on 2026-09-02 (14): `z-ai/glm-5.3-flash`, `qwen/qwen3.8-2.4t-a95b`, `deepseek/deepseek-v4-pro-0813`, `meta/muse-glimmer-30b`, `deepseek/deepseek-v4-flash-0731`, `thinkingmachines/inkling-small`, `thinkingmachines/inkling`, `moonshotai/kimi-k3`, `nvidia/nemotron-3-ultra-550b-a55b`, `minimax/minimax-m3`, `google/gemma-4-31b-it`, `qwen/qwen3.5-9b`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`.
- **Which are not batch-eligible natively?** `[capture]` `nvidia/nemotron-3-ultra-550b-a55b` fails at `VALIDATING` with `Invalid model ID: Unable to access non-serverless model ...` both natively and through OpenRouter. Datadog `batch_api.finalize.completed` shows 5 of 5 jobs on this model `failed` since 2026-08-27T22:40Z (281 requests) after 3 `completed` earlier that day (D3). The other 13 all have `completed` jobs in the same 7-day sample. The suggested cheap models `meta-llama/Llama-3.2-3B-Instruct` and `meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo` are also non-serverless in this account and fail the same way, and are not OpenRouter `:batch` rows, so `openai/gpt-oss-20b:batch` was used instead.
- **What happens on an unsupported model?** Natively, HTTP 201 at create, then `FAILED` with the `error` string above and no files `[capture]`. Through OpenRouter, HTTP 202 at submit, then `status: failed` with the generic reason (D2).

## 12. Platform and BYOK credential shape

- Registered in `services/batch-api/src/adapters/api-key-providers.ts:37-42` as an API-key provider with env `TOGETHER_API_KEY` and BYOK supported.
- Platform and BYOK use the same bearer token shape and the same base URL. There is no project or organization header. The job object echoes `user_id`, `project_id`, `organization_id` of the key owner `[capture]`, which the adapter never reads.
- `[capture]` All 500 Together `finalize.completed` events in the 7-day Datadog sample have `is_byok: false`. No BYOK Together key exists in the test account, so BYOK is `UNTESTED` (dogfood section below).
- BYOK-specific risk: a customer can cancel the upstream job in their own Together console, which is the only way `CANCELING` reaches the poller (D1).

## 13. Artifact handles

- Input: `input_file_id` (`file-<uuid>`), stored as the job's upstream input handle.
- Job: `upstream_batch_id` is a bare UUID with no prefix `[capture]`.
- Output: `output_file_id`, error: `error_file_id`, both `file-<uuid>`, each present only when that file has at least one row `[capture]`. A job can carry both, one, or neither.
- Files are visible in `GET /v1/files` with `filename` `batch.jsonl`, `output.jsonl`, `errors.jsonl` `[capture]`. A single uploaded file can back multiple batch jobs `[docs]` (official docs: https://docs.together.ai/docs/inference/batch/overview).
- OpenRouter persists the raw output and error files to GCS (`BatchGcsArtifact.OutputRawResponse`, `ErrorRawResponse`) with the bucket's 30-day expiry (`services/batch-api/CLAUDE.md`).

## 14. Native remote URL inputs

- `[docs]` Together's own guidance is to reference images by hosted URL rather than inlining base64, because of the 10 MB line cap (official docs: https://docs.together.ai/docs/inference/batch/tutorial). That implies image URL support on vision models in batch, but no official page fetched states which models.
- `[capture]` Public image URL, **supported natively on a vision model.** `google/gemma-4-31B-it` (the only vision-capable OpenRouter `:batch` row on Together) returned a 200 row for `{"type": "image_url", "image_url": {"url": "https://raw.githubusercontent.com/.../python.png"}}` with `prompt_tokens: 284` against 19 for the text-only control and a `reasoning` string describing the logo (`d5-multimodal-gemma-4-31b-github-png`, 2026-09-02T20:56Z). The field name is OpenAI's `image_url.url`. Earlier attempts with an `upload.wikimedia.org` URL failed per line with `Internal server error` (`d3-multimodal-gemma-4-31b`); that host answers HTTP 400 to a `curl` user agent, so the failure is attributed to the fetch, not the model (inference). On the text model `gpt-oss-20b` an image part fails per line with `One of the image(s) could not be processed (possibly corrupt)` (`d2`). `Qwen/Qwen2.5-VL-72B-Instruct`, `Qwen/Qwen3-VL-8B-Instruct`, `Qwen/Qwen3-VL-32B-Instruct`, and `meta-llama/Llama-4-Scout-17B-16E-Instruct` are non-serverless in this account and fail at `VALIDATING`. `batchAdapterSupportsImageUrls` is `false` for Together (`packages/batch/adapters/image-url-support.ts:34-38`), which is now a conservative gap rather than a fact about the provider (D6).
- `[capture]` Public file/PDF URL: a `{"type": "file", "file": {"file_id": "<https url>", "filename": ...}}` part fails per line on both `gpt-oss-20b` and `gemma-4-31B-it` with `Invalid JSON data: ... messages[0]: data did not match any variant of untagged enum MessageContent`, and the PDF URL passed as `image_url` fails with `cannot identify image file` after being fetched. Together's chat schema has no file part. `batchAdapterSupportsFileUrls` returning `false` (`packages/batch/adapters/file-url-support.ts:35`) matches. No official page documents file parts for Together chat.
- OpenRouter side `[capture]`: an image part is rejected before submit with `Batch request '<id>' batch adapter 'TogetherBatchAdapter' does not support native image URLs; use the sync API.` (`packages/batch/skins/image-input-capability.ts:48`), served as `status: failed` with that message and no upstream job (`or-d-image-url-vision-model`, pinned to `google/gemma-4-31b-it`).

## Committed fixtures

Every `live-*` file under `packages/batch/adapters/together/fixtures/` is a verbatim Together response with one deterministic redaction pass: `user_id`, `project_id`, `organization_id`, job ids, and `file-<uuid>` handles are rewritten to stable `*TEST<nn>` placeholders, the per-row `br_...` id is dropped, and response body ids become `resp-TEST<nn>`. Token counts, timestamps, model ids, error strings, and content are untouched. `live-captures.golden.test.ts` parses every line through `pollTogetherBatch`, `parseTogetherBatchResult`, and `parseTogetherBatchUsage`, so a schema change that stops accepting a captured shape fails CI. All captures are from 2026-09-02 except the cancel pair, re-captured on 2026-09-04 because the 2026-09-02 `CANCELING` poll was not persisted.

| Fixture | Source case | What it pins |
| --- | --- | --- |
| `live-canceling-poll.json`, `live-cancelled-poll.json` | `a4-cancel` (re-run 2026-09-04) | transient `CANCELING` (fails `TogetherStatusSchema`, D1), then `CANCELLED` with no files |
| `live-failed-invalid-jsonl-poll.json` | `a3-invalid-jsonl-line` | `FAILED`, top-level `error`, no `output_file_id` or `error_file_id` (D2) |
| `live-failed-non-serverless-model-poll.json` | `e-unsupported-*` | `FAILED` with the `Unable to access non-serverless model` error (D2, D3) |
| `live-completed-partial-poll.json` | `a2-partial-4valid-1invalid-model` | `COMPLETED` with both file handles and no `request_counts` |
| `live-partial-{input,output,errors}.jsonl` | `a2-partial-4valid-1invalid-model` | 4 success rows plus one `batch_client_error` row keyed by `custom_id` |
| `live-tools-{input,output,errors}.jsonl` | `b-tools` | tool calls, forced `tool_choice`, and the rejected `web_search` tool type |
| `live-structured-{input,output}.jsonl` | `c-structured-outputs` | `response_format: json_schema` rows, nested objects and `$defs` |
| `live-reasoning-{input,output}.jsonl` | `r-reasoning-deepseek-v4-flash` | `reasoning_content` plus `completion_tokens_details.reasoning_tokens` |
| `live-image-{input,output}.jsonl` | `d5-multimodal-gemma-4-31b-github-png` | public `image_url` accepted natively on a vision model (D6) |
| `live-image-text-model-{input,errors}.jsonl` | `d2-multimodal-text-model-rejected` | image and `file` parts failing per line on `gpt-oss-20b` |

Not captured as fixtures: `EXPIRED` (never observed) and a `CANCELLED` job with partial output (the cancelled job never left `VALIDATING`).

## Divergences found between adapter and observed/documented behavior

### D1. Undocumented transient `CANCELING` status fails the poll parse

- **Severity:** low.
- **Customer impact:** a BYOK customer who cancels the Together job in their own console makes every OpenRouter poll fail Zod validation until the job reaches `CANCELLED` (about 15 s live). The sweep logs `batch_api.sweep.poll_failed` and retries next tick, then finalizes normally. Platform-key jobs cannot hit this because OpenRouter exposes no cancel route (`services/batch-api/src/routes/batches.ts`).
- **Smallest repro:** `POST /v1/batches/{id}/cancel` on a `VALIDATING` job, then `GET /v1/batches/{id}`, observe `"status": "CANCELING"` (`a4-cancel`, 2026-09-02).
- **Official docs:** enum lists only `CANCELLED` (https://docs.together.ai/docs/inference/batch/manage, https://docs.together.ai/reference/batch-get).
- **Code:** `packages/batch/adapters/together/status.ts:7-14` (`TogetherStatusSchema`), `batch-poller.ts:14-20`.
- **Sync comparison:** not applicable, the sync path has no job status.
- **Smallest safe fix:** add `'CANCELING'` to `TogetherStatusSchema` and map it to `UpstreamBatchStatusValues.InProgress` (non-terminal) in `toUpstreamStatus`.
- **Regression test:** `status.test.ts` case asserting `CANCELING` parses and is non-terminal, plus a `batch-poller.test.ts` fixture with `"status": "CANCELING"`.
- **Datadog:** `batch_api.sweep.poll_failed` with `provider_name:Together` returned 0 events over 14 days, so no customer has hit this yet.

### D2. Native `error` string is dropped, so failed jobs are served with a generic reason

- **Severity:** medium.
- **Customer impact:** every whole-job failure (non-serverless model, malformed JSONL, unreadable input file) is served as `The provider ended this batch as "failed" without reporting a reason.` while Together's poll body says exactly why (`Invalid model ID: Unable to access non-serverless model nvidia/nemotron-3-ultra-550b-a55b ...`). In the 7-day Datadog sample 5 jobs (281 requests) failed this way.
- **Smallest repro:** OpenRouter `POST /api/beta/batches` with `model: "nvidia/nemotron-3-ultra-550b-a55b"`, one line, poll to `failed` (`or-f-nemotron-non-serverless`, `batch-1788380436-eir93VbPGsonMSMHxuv6`, 2026-09-02).
- **Official docs:** the retrieve schema has an `error` string property (https://docs.together.ai/reference/batch-get).
- **Code:** `packages/batch/adapters/together/batch-poller.ts:14-20` (schema has no `error`), `:43-52` (no `failure_reason`), `services/batch-api/src/finalize/finalize-batch-job.ts:705-709` (generic fallback).
- **Sync comparison:** the sync path returns Together's `error.message` verbatim in the HTTP 400 body.
- **Smallest safe fix:** add `error: z.string().nullish()` to `TogetherPollResponseSchema` and return `failure_reason: error ?? null` when status is `FAILED` or `EXPIRED`, mirroring `packages/batch/adapters/fireworks/batch-poller.ts:101`.
- **Regression test:** `batch-poller.test.ts` fixture from the `e-unsupported-*` poll body asserting `failure_reason` carries the string.

### D3. `nvidia/nemotron-3-ultra-550b-a55b:batch` on Together is not batch-eligible

- **Severity:** high (the endpoint row is live and every job fails).
- **Customer impact:** 100% job failure on this `:batch` row since 2026-08-27T22:40Z (Datadog, 5 of 5 jobs, 281 requests, versus 3 `completed` jobs earlier on 2026-08-27). Customers pay nothing but lose a day-long completion window and get the generic reason from D2.
- **Smallest repro:** native `POST /v1/batches` with a one-line file for `nvidia/nemotron-3-ultra-550b-a55b`, poll: `FAILED`, `error: "Invalid model ID: Unable to access non-serverless model ..."` (`e-unsupported-nemotron-3-ultra`, 2026-09-02). The model is still listed by `GET /v1/models`.
- **Official docs:** "Most serverless models support batch processing" (https://docs.together.ai/docs/inference/batch/overview). Serverless status is per account and can change.
- **Code:** the `:batch` endpoint row for this model (data, not adapter code). Datadog query: https://us5.datadoghq.com/logs?query=service%3Abatch-api%2A%20batch_api.finalize.completed%20%40data.jsonPayload.extra.provider_name%3ATogether%20%40data.jsonPayload.extra.model%3Anvidia%2Fnemotron-3-ultra-550b-a55b-20260604
- **Sync comparison:** not checked in this session (whether Together sync still serves the model).
- **Smallest safe fix:** disable the Together `:batch` endpoint row for this model until Together restores serverless access, and consider a monitor on `finalize.completed` with `async_job_status:failed` grouped by `model`.
- **Regression test:** none at code level. Operational check.

### D4. Native accepts a 65-char `custom_id` that the docs and adapter cap at 64

- **Severity:** informational.
- **Customer impact:** none. OpenRouter rejects at submit with HTTP 422 `this provider caps custom_id at 64 characters`, which matches the documented limit. Native is more permissive than documented.
- **Repro:** `g-custom-id-65-chars` (native COMPLETED), `or-h-custom-id-65` (OpenRouter 422), 2026-09-02.
- **Official docs:** https://docs.together.ai/docs/inference/batch/tutorial
- **Code:** `packages/batch/adapters/together/schemas.ts:5`.
- **Fix:** none. Keep the documented cap.

### D5. Adapter base URL is `api.together.xyz`, docs say `api.together.ai`

- **Severity:** informational.
- **Customer impact:** none observed. Both hosts served identical responses with the same key on 2026-09-02 (`k-host-probe-api-together-ai`).
- **Official docs:** every reference page uses `https://api.together.ai/v1` (https://docs.together.ai/reference/batch-create).
- **Code:** `services/batch-api/src/adapters/api-key-providers.ts:41`.
- **Fix:** none required. Note the risk if Together retires the `.xyz` alias.

### D6. `batchAdapterSupportsImageUrls` is `false` although Together batch accepts public image URLs on vision models

- **Severity:** low (coverage gap, fail-closed).
- **Customer impact:** an image request to `google/gemma-4-31b-it:batch` is rejected before submit with `does not support native image URLs; use the sync API.` even though the native job would succeed. No wrong result, only a missing capability.
- **Smallest repro:** native one-line batch on `google/gemma-4-31B-it` with an `image_url` part pointing at `https://raw.githubusercontent.com/github/explore/main/topics/python/python.png`, observe a 200 row with `prompt_tokens: 284` (`d5-multimodal-gemma-4-31b-github-png`, 2026-09-02). OpenRouter twin `or-d-image-url-vision-model` fails pre-submit.
- **Official docs:** hosted image URLs are the recommended input for vision batches (https://docs.together.ai/docs/inference/batch/tutorial). No page lists which models accept them.
- **Code:** `packages/batch/adapters/image-url-support.ts:34-38`, `packages/batch/skins/image-input-capability.ts:48`.
- **Sync comparison:** the sync path accepts the same part for this model and serializes it unchanged (`serializeTogetherRequest`).
- **Smallest safe fix:** flip Together to supported in `image-url-support.ts` once per-model modality gating is confirmed to reject image parts on text-only `:batch` rows (Together returns a per-line `batch_client_error` for those, so the failure would be billed as a failed row rather than rejected up front).
- **Regression test:** `image-url-support.test.ts` case for Together, plus a redacted `d5` output row as a `parseTogetherBatchResult` fixture.

### Not divergences, recorded for completeness

- OpenRouter fails the whole job at submit-worker lowering when one line cannot be lowered (temperature 99, `max_tokens` above context, prompt above context), with `Failed to lower batch request '<id>' to the provider wire: ...` and no upstream job (`scan-and-persist-batch-requests.ts:688`). Together would have run the other lines and put the bad one in the error file. This is the shared fail-closed design, not a Together adapter behavior. `[capture]` `or-a2`, `or-a3`, `or-a4`.
- OpenRouter has no public cancel route. `POST /api/beta/batches/{id}/cancel` returned HTTP 404 and the jobs completed (`or-e-cancel`, `or-e2-cancel-after-visible`). Together supports cancel natively (section 2).
- The first `GET /api/beta/batches/{id}` immediately after a 202 returned HTTP 404 on several jobs and 200 on the next poll a few seconds later. Not investigated further here. `[capture]`

## Dogfood parity run (2026-09-02)

Matrix from `batch-adapter-dogfooding`, run natively and through OpenRouter with `provider: {only: ["together"]}` in every body. A case counted only after Datadog `batch_api.batch_accepted` showed `provider_name: Together`. Datadog was read through the US5 REST API (the `datadog` MCP server exposed no `get_logs`). Spend: native under $0.10, OpenRouter test key about $0.0006 (sum of served `usage.cost`).

**Provider verdict: NOT SAFE.** The dogfooding rubric marks a provider `NOT SAFE` while any BUG is unresolved, and two are: D2 (medium, `TogetherPollResponseSchema` drops the native `error` string, so every whole-job failure is served with a generic `failure_reason`) and D3 (high, `nvidia/nemotron-3-ultra-550b-a55b:batch` fails 100% for the platform credential and should be disabled until Together restores access). Neither loses paid results or bills wrongly, and upload, submit, poll, results, finalization, and billing of successful and failed lines have live PASS evidence on both sides with Datadog confirmation, so the verdict becomes `SAFE WITH KNOWN LIMITS` once D2 and D3 are closed. D1, D6, and the read-after-write 404 are coverage gaps. BYOK, cache hits, expiry, and persistence faults are UNTESTED.

### OpenRouter jobs and billing arithmetic

Every served `usage.cost` below equals `prompt * $0.05/M + completion * $0.20/M` (`openai/gpt-oss-20b:batch`) or `prompt * $0.14/M + completion * $0.28/M` (`deepseek/deepseek-v4-flash-0731:batch`) to the last digit, and Datadog `finalize.completed.finalized_cost` equals the served cost with `is_usage_complete: true`; `emit_generations.done` reports `estimated: 0, skipped: 0, unaccounted: 0` and `emitted == total_lines` on all of them. No `emit_generation.missing_usage` or `fallback_usage_estimated` event exists for `provider_name:Together` in the 7-day window. The `$0.05 / $0.20` rate is Together's standard price for `openai/gpt-oss-20b` (section 8: the batch discount covers only the listed models, and `gpt-oss-20b` is not one of them), so these rows prove billing parity between the OpenRouter `:batch` row and the native invoice, not a 50% batch discount. No discounted model has an OpenRouter `:batch` row on Together, so discount validation is UNTESTED.

| OpenRouter job | Case | Served result | Usage (prompt/completion) and cost | Verdict |
| --- | --- | --- | --- | --- |
| `batch-1788380436-9vrknTJVcH0Ws1R5lpCA` | `text` 5 lines (`text`, `multi-system`, `multi-turn`, `reasoning`, `truncated`) | `completed` 5/5, `finish_reason: length` on `truncated` | 405/171, `5.445e-05` | PASS |
| `batch-1788381647-98U4VTaswZ7xWgfKCS4Q` | 4 valid + 1 bad `tool_choice` name | `completed` `{total:4, completed:3, failed:1}`, error row has `custom_id`, no usage | 219/24, `1.575e-05` for the 3 billed lines | PASS, failed line unbilled on both sides |
| `batch-1788380436-o2IJolqQLBToYoxaQOsP` | `tool-calls` (single, multi `auto`, forced, parallel) | `completed` 4/4, forced choice returned one `get_weather` call | 570/780, `0.0001845` | PASS |
| `batch-1788380436-b4wZ2yY9ej9RCX4fUHyM` | `structured-output` (basic, nested, `$defs`/`$ref`, with tools) | `completed` 4/4, basic and nested hit `finish_reason: length` at `max_tokens: 64` | 372/648, `0.0001482` | PASS, truncation is the shared token budget |
| `batch-1788381096-fO1x3Nf9BFbAF2z8SQ1w` | `reasoning` DeepSeek V4 Flash, 1 line | `completed`, `message.reasoning` served, `reasoning_tokens: 13` | 96/16, `1.792e-05` | PASS, reasoning tokens sit inside `completion_tokens` at the completion rate |
| `batch-1788380436-oguE97lm0NyzdrULDZJC`, `batch-1788380748-9D1Yn349d4eE2Ehb7IsC` | cancel probes | `POST .../cancel` 404 before and after visibility, both ran to `completed` 3/3 | `3e-05` each | EXPECTED LIMITATION, no public cancel route |
| `batch-1788380436-eir93VbPGsonMSMHxuv6` | `nvidia/nemotron-3-ultra-550b-a55b` | `failed`, generic reason, `usage: null` | none, `finalized_cost` absent | BUG D2 + D3 |
| `batch-1788381184-rHATdJLIv23iekIxNLwl` | `image-url-public` on `google/gemma-4-31b-it` | `failed` pre-submit, `does not support native image URLs` | none, `submit_job.failed` 422 | EXPECTED LIMITATION + COVERAGE GAP D6 |
| `batch-1788380436-6T9DdmqLCTMbrSE3lgh8`, `batch-1788380438-IkGYkub7vPADb0EFQ1xG` | `image-url-rejected`, `file-url-rejected` on `gpt-oss-20b` | `failed` pre-submit, `does not support image inputs` / `unsupported 'file' content` | none, `submit_job.failed` 422 | EXPECTED LIMITATION |

Rejected at submit with no job: a per-line `body.model` override (HTTP 400 `Each batch request body model must match the top-level model.`).

### Nuances a test writer needs

- Native error strings seen on per-line `batch_client_error` rows: `Maximum four stop sequences allowed`, `Selected function was not found in the tools list`, `tools[0]: missing field 'function'` (a `{type: "web_search"}` tool, so native search is not routable), `One of the image(s) could not be processed (possibly corrupt)`, and `messages[0]: data did not match any variant of untagged enum MessageContent` (a `file` part).
- A 10-entry `stop` succeeds through OpenRouter because the shared OpenAI chat serializer keeps only the first four (`packages/router/adapters/openai/serialize-chat-request.ts:234`), while the same line fails natively.
- Forced `tool_choice` on `gpt-oss-20b` at `max_tokens: 64` returned `finish_reason: length` with no `tool_calls` natively (budget spent in the harmony channel) and a well-formed call through OpenRouter. Both sides accept the payload. `tool-parallel` leaked harmony text (`commentary to=functions.get_time ...`) identically on both sides.
- `prompt_tokens_details.cached_tokens` is present and `0` on repeated identical short prompts natively and through OpenRouter.
- Operational trace of `batch-1788381647-98U4VTaswZ7xWgfKCS4Q`: `batch_accepted` → `batch_submitted_upstream` (`upstream_batch_id`, `upstream_input_file_id`) → `finalize_one.started` → `finalize.phase_started`/`phase_completed` x6 → `emit_generations.done` → `finalize.completed` + `finalize.batch_level_failures` (`failed: 1`). Sweep polls are not indexed under `job_id`.

### UNTESTED

- BYOK: no BYOK Together key on the test account.
- Non-zero cache hit: needs a prompt long enough for Together prefix caching on a batch-eligible model.
- Uploaded image or file reference in a batch line: no documented field.
- Expired job: the 24 h window was not waited out.
- Persistence failure injection: needs a GCS or Spanner fault hook.

## Capture-matrix coverage

| Matrix row | Native case | OpenRouter case | Result |
| --- | --- | --- | --- |
| Happy path, 5 lines | `a1-text-5valid` | `or-a1-text-5valid` | both completed 5/5 |
| Partial success, 4 valid + 1 bad model | `a2-partial-4valid-1invalid-model` | `or-a6-partial-output-and-error-file` (invalid `tool_choice` instead, model override is rejected at submit) | native 4 + 1 error row, OpenRouter 3 + 1 |
| Syntactically invalid JSONL | `a3-invalid-jsonl-line` | not reachable (OpenRouter serializes the file) | native upload 200, create 201, job `FAILED` |
| Cancel | `a4-cancel` | `or-e-cancel` (404, no route) | native `CANCELING` then `CANCELLED` |
| Tools | `b-tools` | `or-b-tools` | 4/4 |
| Structured outputs | `c-structured-outputs`, `c2-structured-defs-ref-1024` | `or-c-structured-outputs` | 4/4 |
| Reasoning | `r-reasoning-deepseek-v4-flash` | `or-r-reasoning-deepseek-v4-flash` | 1/1, nested reasoning tokens |
| Image URL | `d5-multimodal-gemma-4-31b-github-png` (200), `d1`, `d2`, `d3`, `d4`, `s-sync-image-*` | `or-d-image-url-vision-model` | native success on gemma-4-31B-it, OpenRouter rejects pre-submit (D6) |
| File URL | `d2-multimodal-text-model-rejected` | `or-d-multimodal-rejected` | per-line error natively, rejected pre-submit |
| Unsupported model | `e-unsupported-*` | `or-f-nemotron-non-serverless` | `FAILED`, no files |
| Per-line runtime errors | `f-runtime-per-line-failures`, `f2-per-line-probe` | `or-a6` | error file rows carry `custom_id`, no usage |
| Long `custom_id` | `g-custom-id-65-chars` | `or-h-custom-id-65` | D4 |
| Missing line model | `h-no-model-in-line-model_id-on-create` | `or-a2b-line-model-override` | per-line error natively, 400 at submit |
| Multi-system, multi-turn, truncated | inside `a1-text-5valid` and `f2-per-line-probe` | `or-a1-text-5valid` | 200 rows, `finish_reason: length` on truncation |
| Wrong upload purpose | `i-upload-wrong-purpose` | n/a | accepted and completed |
| Unknown file id at create | `j-create-bad-file-id` | n/a | 201 then `FAILED` |
| Host alias | `k-host-probe-api-together-ai` | n/a | D5 |
| Expired job | not captured | not captured | `[unconfirmed]` |
| BYOK | not captured | not captured | no BYOK key in the test account |
