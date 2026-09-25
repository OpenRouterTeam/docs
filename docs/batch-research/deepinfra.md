# DeepInfra Batch API research

This Phase 1 note records official documentation and native live captures for DeepInfra's OpenAI-compatible Batch API. It contains no adapter, schema, endpoint, or registration implementation. Provenance labels are `[capture]` for observations from the native API run on 2026-09-21, `[docs]` for official DeepInfra documentation, and `[unconfirmed]` for behavior not demonstrated by a live capture.

Each factual claim carries one of those tags. Load-bearing `[capture]` claims name the committed fixture under `packages/batch/adapters/deepinfra/fixtures/`. Raw transcripts, including every intermediate poll, remain outside the repository under `$BATCH_RESEARCH_CAPTURE_ROOT/deepinfra/captures/`.

## Official sources

- [docs] Batch introduction, limits, pricing: https://docs.deepinfra.com/batch/introduction
- [docs] Batch endpoints (create, retrieve, list, cancel): https://docs.deepinfra.com/batch/batch-endpoints
- [docs] Batch object and status table: https://docs.deepinfra.com/batch/batch-objects
- [docs] File endpoints (upload, retrieve, content, delete, limits, expiry): https://docs.deepinfra.com/batch/file-endpoints

## 1. Auth

- [docs] All batch and file requests use `Authorization: Bearer <API key>`. The docs show the same `DEEPINFRA_TOKEN` for upload, create, poll, and content download.
- [capture] The platform key at Infisical `/_providers` `DEEPINFRA_API_KEY` uploaded files, created batches, listed and polled batches, cancelled a batch, and read, downloaded, and deleted files. The key was never printed or persisted.
- [capture] A malformed bearer value returned HTTP 401 `{"detail": "User is not authorized to access this resource"}` (`live-bad-auth.json`). No `Authorization` header returned HTTP 401 `{"detail": {"error": "not authenticated"}}` (`live-no-auth.json`). The two 401 bodies differ in shape, so error normalization must accept `detail` as either a string or an object.
- [unconfirmed] BYOK key format and whether customer keys see the same batch quota were not probed. Implementation should reuse OpenRouter's existing DeepInfra provider credential plumbing.

## 2. Endpoints and host

- [docs] The batch API lives under `https://api.deepinfra.com/v1/openai` and uses `POST /files`, `POST /batches`, `GET /batches/{id}`, `GET /batches`, `POST /batches/{id}/cancel`, `GET /files/{id}`, `GET /files/{id}/content`, and `DELETE /files/{id}`.
- [capture] The same routes are also served at `https://api.deepinfra.com/v1/files` and `https://api.deepinfra.com/v1/batches`. A live probe returned 200 for `/v1/batches`, `/v1/openai/batches`, `/v1/files`, `/v1/files/{id}`, `/v1/files/{id}/content`, and `/v1/batches/{id}`, and 404 for `/v1/openai/v1/batches` and `/v1/openai/v1/files`.
- [capture] The existing OpenAI batch helpers (`file-uploader.ts`, `batch-submitter.ts`, `batch-poller.ts`, `file-downloader.ts`, `delete-batch-file.ts`) append `/v1/files` and `/v1/batches` to `baseUrl`. Passing the sync adapter's base URL `https://api.deepinfra.com/v1/openai` to them yields `/v1/openai/v1/files`, which is a 404. The batch adapter must therefore receive `https://api.deepinfra.com` as `baseUrl` (so the helpers produce `/v1/files` and `/v1/batches`), not the sync base URL. The committed exchange fixtures record paths relative to `https://api.deepinfra.com`.
- [docs] [capture] Accepted `endpoint` values at batch creation are exactly `/v1/chat/completions`, `/v1/completions`, and `/v1/embeddings`. Creating with `/v1/responses` returned HTTP 422 whose `detail[0].msg` lists the three accepted literals (`live-create-unsupported-endpoint.json`).
- [docs] Images, moderations, responses, and videos are explicitly excluded from batch.
- [capture] `/v1/chat/completions` and `/v1/embeddings` were exercised end to end. `/v1/completions` is `[unconfirmed]` live and is not in the current OpenRouter batch endpoint set.

## 3. Upload versus inline, and request-line shape

- [docs] [capture] Ingest is file-based. `POST /v1/files` takes multipart `file` and `purpose=batch` and returns `{id, object: "file", filename, bytes, created_at, purpose}` (`live-happy-upload.json`). Then `POST /v1/batches` takes `{input_file_id, endpoint, completion_window: "24h", metadata?, output_expires_after?}` (`live-happy-create.json`).
- [docs] Each JSONL line is `{custom_id, method: "POST", url, body}` where `url` equals the batch `endpoint` and `body` is the synchronous request body. All lines must use the same model. Model IDs are DeepInfra model IDs.
- [capture] The create response while `validating` has `request_counts: null`, `model: null`, `usage: null`, `errors: null`, `expires_at` set to `created_at + 86400`, and `output_file_id`/`error_file_id` null (`live-happy-create.json`, `live-happy-validating-poll.json`). The OpenAI poll schema requires non-null `request_counts`, so a DeepInfra poll schema must allow `request_counts` to be null before validation completes.
- [capture] Validation is asynchronous. The following inputs were accepted by upload and create, then reached `status: "failed"` with a batch-level `errors: {object: "list", data: [{code, line, message, param}]}` and no output or error file. Each pair of fixtures is `live-validation-<case>-input.jsonl` and `live-validation-<case>-poll.json`.
  - duplicate `custom_id`: `code: "duplicate_custom_id"`, `line: 1`
  - malformed JSONL: one `invalid_json` entry per bad line with its `line`
  - empty file: `invalid_json`, `line: null`, `message: "input file is empty"`
  - unknown model: `unknown_model`, `line: null`
  - two models in one file: `model_mismatch`, `line: 1`, message names both models
  - `method: "GET"`: `invalid_line`, `param: "/v1/chat/completions.method"`
  - line `url` disagreeing with the batch `endpoint` (chat body submitted under `/v1/embeddings`): `invalid_line`, `param: "/v1/embeddings.body.input"`. DeepInfra validates the body against the batch `endpoint`, not the line `url`.
  - `max_tokens: 0` on every line: `invalid_line` per line with `param: "/v1/chat/completions.body.max_tokens"` (`live-all-failure-terminal-poll.json`). A line-level schema violation is a whole-batch validation failure, not a per-row error.
- [capture] Create-time synchronous rejections: `completion_window: "1h"` returned HTTP 422 with a `literal_error` detail (`live-create-bad-window.json`). A non-existent `input_file_id` returned HTTP 404 `{"detail": {"error": "file not found"}}` (`live-create-missing-file.json`).
- [capture] `stream: true` is not a validation error. It is accepted and fails per row at runtime with `error.code: "500"`, `message: "internal error"` (`live-happy-error.jsonl`, `live-mixed-runtime-error.jsonl`). The adapter must strip `stream` and `stream_options` before serialization.

## 4. Status model and internal mapping

| Native status | Internal mapping          | Terminal | Evidence                                                                       |
| ------------- | ------------------------- | -------- | ------------------------------------------------------------------------------ |
| `validating`  | `validating`              | no       | [capture] `live-happy-validating-poll.json`                                    |
| `in_progress` | `in_progress`             | no       | [capture] `live-happy-in-progress-poll.json`                                   |
| `finalizing`  | `in_progress` (see below) | no       | [capture] `live-happy-finalizing-poll.json`                                    |
| `cancelling`  | `cancelling`              | no       | [capture] `live-cancelling-poll.json`, `live-cancel-race-cancelling-poll.json` |
| `completed`   | `completed`               | yes      | [capture] `live-happy-completed-poll.json`                                     |
| `failed`      | `failed`                  | yes      | [capture] validation fixtures, `live-all-failure-terminal-poll.json`           |
| `expired`     | `expired`                 | yes      | [docs] listed; [unconfirmed] not producible inside the capture window          |
| `cancelled`   | `cancelled`               | yes      | [capture] `live-cancelled-poll.json`                                           |

- [docs] The status table lists exactly `validating`, `in_progress`, `finalizing`, `completed`, `failed`, `expired`, `cancelling`, `cancelled`, with `finalizing` defined as "all requests are done; the output files are being assembled".
- [capture] The happy batch was observed in the order `validating` (`request_counts: null`) then `in_progress` (`request_counts` populated, `model` populated, `usage` populated and growing) then `finalizing` then `completed`. Timestamps `in_progress_at`, `finalizing_at`, `completed_at` were populated in step.
- [capture] `finalizing` has no `UpstreamBatchStatus` counterpart. It carries no result handles yet (`output_file_id: null` in `live-happy-finalizing-poll.json`), so mapping it to `in_progress` is safe. Mapping it to `completed` would make finalization read a null handle.
- [capture] `usage` and `request_counts` are cumulative and grow during `in_progress` and `cancelling` (raw `pre-*.json` and `poll-*.json` transcripts). They must not be used as a terminal signal. The terminal signal is the status string.

## 5. Completion, partial failure, and cancellation

- [capture] A `completed` batch can contain failed rows. The happy batch of 8 lines ended `completed` with `request_counts: {total: 8, completed: 7, failed: 1}`, both `output_file_id` and `error_file_id` set (`live-happy-completed-poll.json`), 7 rows in the output file (`live-happy-output.jsonl`) and 1 row in the error file (`live-happy-error.jsonl`).
- [capture] The mixed-runtime batch of 7 lines ended `completed` with `{total: 7, completed: 5, failed: 2}`. Its error file has a context-overflow row (`code: "400"`, message names the token count and limit) and a `stream: true` row (`code: "500"`) (`live-mixed-runtime-error.jsonl`, `live-mixed-runtime-completed-poll.json`).
- [capture] Batch-level `failed` is reserved for validation. Every observed `failed` batch had `errors.data` populated, `request_counts: null`, and no handles. No `failed` batch with partial output was observed.
- [capture] `error_file_id` is set even when `request_counts.failed` is 0. The embeddings batch (`{total: 3, completed: 3, failed: 0}`) still carried `error_file_id` (`live-embeddings-completed-poll.json`) and the error file was empty. `fetchNativeResults` must tolerate an empty error artifact and must not treat a non-null `error_file_id` as proof of failures.
- [capture] Cancellation is asynchronous and does not stop in-flight or queued work reliably. `POST /v1/batches/{id}/cancel` on a `validating` batch returned HTTP 200 with `status: "cancelling"` (`live-cancel-response.json`) and reached `cancelled` with null handles and `request_counts: null` (`live-cancelled-poll.json`). Cancelling a 60-line batch after it was `in_progress` with 5 completed rows entered `cancelling` (`live-cancel-race-cancelling-poll.json`) and then completed all 60 rows and ended `completed` with `cancelled_at: null` and `cancelling_at` set (`live-cancel-race-completed-poll.json`). Cancel is best effort. OpenRouter must treat a `completed` poll after a cancel request as a completed, billable batch.
- [capture] Cancelling an already cancelled batch returned HTTP 400 `{"detail": {"error": "batch is already cancelled"}}` (`live-cancel-after-terminal.json`).
- [unconfirmed] Whether a batch that reaches `cancelled` after producing some rows exposes output and error files was not observed. The docs say expired batches keep finished rows in the output file. An implementation must read handles when non-null regardless of terminal status.
- [unconfirmed] `expired` was not produced. The 24 hour window exceeds the capture budget.

## 6. Output and error shapes

- [capture] Successful rows are `{id: "batch_req_<batch_id>_<6 digits>", custom_id, response: {status_code: 200, request_id, endpoint, body}, error: null}` where `body` is the synchronous chat completion or embeddings response (`live-happy-output.jsonl`, `live-embeddings-output.jsonl`). The existing `parseOpenAIBatchResult` and `parseOpenAIBatchUsage` accepted every captured successful chat, multimodal, and embeddings row unchanged when run locally.
- [capture] Not every model emits the same success-row shape. `zai-org/GLM-5.3-Flash` rows carry `choices[].message.tool_calls: null` (and `reasoning_content: null`, `name: null`) on plain text completions, observed live through OpenRouter (`batch-1790083435-MUdDtdyhZgBBwXBQcofY`, 3 of 3 rows) and reproduced natively with the same 3 inputs (`live-null-tool-calls-output.jsonl`). The canonical completion schema accepts an omitted `tool_calls` but rejects `null`, so the shared OpenAI-compatible normalizer drops a null `tool_calls` before canonical validation, mirroring the existing null `annotations` handling. `openai/gpt-oss-20b` rows omit the field.
- [capture] Failed rows are `{id, custom_id, response: null, error: {code, message, param, type}}` with `code` a string HTTP status (`"400"`, `"500"`), `param: null`, and `type: null` in every observed row (`live-happy-error.jsonl`, `live-mixed-runtime-error.jsonl`, `live-multimodal-error.jsonl`, `live-sync-parity-error.jsonl`).
- [capture] The canonical `BatchResultErrorSchema` requires `type: string`, so `parseOpenAIBatchResult` rejected every DeepInfra error row. The DeepInfra adapter needs an error-row normalizer that maps `code` to the canonical `type` or `error_type` and to `response.status_code`, keeps `message`, and preserves the provider code. This is the deviation most likely to lose paid rows if ignored.
- [capture] Output row order is not input order. In `live-happy-output.jsonl` the row for input line 1 appears fifth. Reconciliation must key on `custom_id`.
- [capture] Chat response bodies carry `service_tier: "default"`, `id: "chatcmpl-..."`, `object`, `created`, `model`, `choices`, `usage`. The gpt-oss-20b rows put reasoning in `choices[].message.reasoning_content`, including when `reasoning` was not requested. `finish_reason` values observed are `stop`, `length`, `tool_calls`. Tool calls, `response_format: json_schema` output, `n: 2` with two choices, and `max_tokens` truncation all round-tripped (`live-happy-output.jsonl`, `live-sync-parity-output.jsonl`).
- [capture] Embeddings response bodies are the OpenAI list shape with `data[].embedding` float arrays and `usage: {prompt_tokens, total_tokens}` (`live-embeddings-output.jsonl`).

## 7. Limits

- [docs] 50,000 request lines per file, 200 MB input file with `purpose: "batch"`, 50,000 embedding inputs per file, 100 concurrent batches per user, 512 MB for any user-created file, 2 GB total files per user including response files. Batch usage does not affect real-time rate limits.
- [docs] `metadata` allows up to 16 string pairs, keys up to 64 characters and values up to 512 characters.
- [docs] `completion_window` accepts only `"24h"`. [capture] `"1h"` is a 422 (`live-create-bad-window.json`).
- [unconfirmed] 429 behavior, over-limit file rejection, and the concurrent batch cap were not probed to avoid consuming shared quota.

## 8. Expiry and retention

- [docs] Files expire after 30 days by default. `expires_after: {anchor: "created_at", seconds}` on upload and `output_expires_after` on batch create accept 3,600 to 2,592,000 seconds and apply to the output and error files.
- [capture] The happy batch was created with `output_expires_after: {anchor: "created_at", seconds: 3600}`. Output and error file metadata reported `expires_at` exactly 3,600 seconds after their `created_at` (`live-happy-output-file-metadata.json`, `live-happy-error-file-metadata.json`). The input file kept the 30 day default (`live-happy-input-file-metadata.json`, `expires_at` = `created_at + 2592000`).
- [capture] Output and error file metadata use `purpose: "batch_output"`. The error file is named `<batch_id>_errors.jsonl` while its id is `<batch_id>_error`.
- [capture] Batch `expires_at` is `created_at + 86400` on every batch, matching the 24 hour window.
- [unconfirmed] Whether the batch record itself is ever purged, and what a content read returns after `expires_at`, was not observed. Finalization must persist artifacts before the configured output expiry.

## 9. Pricing and usage

- [docs] Batch requests are billed at 20% below the corresponding real-time price for the same model and endpoint, applied automatically.
- [capture] Each successful chat row carries `usage: {prompt_tokens, completion_tokens, total_tokens, estimated_cost, prompt_tokens_details: null}`. `estimated_cost` is a USD float (for example `3.34e-06` for 74 prompt and 8 completion tokens on gpt-oss-20b). It is a provider estimate and is not consumed by OpenRouter billing, which prices from the endpoint row.
- [capture] The batch object carries aggregate `usage: {input_tokens, input_tokens_details: {cached_tokens}, output_tokens, output_tokens_details: {reasoning_tokens}, total_tokens}`. On the happy batch it was `{519, 0, 136, 0, 655}`, which equals the sum of the seven successful rows' `prompt_tokens` and `completion_tokens`. The failed row contributed no usage. Billing must still read per-row usage from the artifact, not this aggregate.
- [capture] `reasoning_tokens` was 0 and `cached_tokens` was 0 on every batch even though `reasoning_content` was returned. The per-row `prompt_tokens_details` was null. Reasoning tokens are folded into `completion_tokens` and are not separately reported. `[unconfirmed]` whether cached-token billing applies in batch.
- [unconfirmed] Billing continuity through OpenRouter (`transformBatchResponse` then `emitBatchGenerations` on the persisted native rows) is not yet proven. It is a required implementation-phase check.

## 10. Sync adapter transform parity

- [capture] The sync `DeepInfraAdapter` (`packages/router/adapters/deepinfra.ts`) extends `OpenAICompatibleInternalStreamAdapter` and adds `reasoning: {enabled, effort}` derived from `reasoning_effort`, always sets `stream_options: {include_usage: true, continuous_usage_stats: true}` on non-BYOK, adds an optional derived `prompt_cache_key`, and parses DeepInfra's top-level `{error_type, error_message}` error shape.
- [capture] A batch probe of those fields (`live-sync-parity-input.jsonl`, `live-sync-parity-completed-poll.json`) showed:
  - `reasoning: {enabled: true, effort: "low"}` is accepted and the row returned `reasoning_content`. `reasoning: {enabled: false}` is accepted.
  - `prompt_cache_key` is accepted. `[unconfirmed]` whether it affects caching in batch, since `cached_tokens` stayed 0.
  - `stream_options` without `stream: true` fails per row with `code: "500"` and a message containing "Stream options can only be defined when stream is true" (`live-sync-parity-error.jsonl`).
  - `stream: false` is accepted.
- [capture] Therefore the batch serializer must reproduce the `reasoning` object lowering and may pass `prompt_cache_key`, and must omit `stream` and `stream_options`. `OpenAIBatchAdapter.fromInternalRequest` does none of the DeepInfra lowering, so a DeepInfra-specific `fromInternalRequest` is required, as the factory warning states.

## 11. OpenRouter mapping decision and OpenAI wire comparison

- [docs] DeepInfra describes the API as an OpenAI-compatible file upload, batch, and results workflow.
- [capture] The observed wire matches OpenAI for bearer auth, multipart upload with `purpose: "batch"`, the batch object field names, `completion_window: "24h"`, JSONL line shape, successful output row shape, `errors.data[]` on validation failure, and file metadata.

### Deviations from the OpenAI batch wire

- [capture] Base URL composition. Native routes are `https://api.deepinfra.com/v1/files` and `/v1/batches`. The sync adapter's `/v1/openai` base cannot be reused with the OpenAI helpers.
- [capture] `request_counts` is `null` until validation finishes and on validation-failed and cancelled-before-start batches. OpenAI returns zeros.
- [capture] Error rows have `code` as a string HTTP status and `type: null`. OpenAI error rows carry a string `type`.
- [capture] `error_file_id` is non-null on batches with zero failed rows, pointing at an empty file.
- [capture] `finalizing` is an observable status.
- [capture] The batch object carries `model` and cumulative `usage` fields.
- [capture] `DELETE /v1/batches/{id}` returns 405 `{"detail": "Method Not Allowed"}` (`live-delete-batch.json`). The batch remains readable afterwards (`live-get-after-delete-batch.json`).
- [capture] Deleting an already deleted file returns 404 `file not found` (`live-delete-input-file-again.json`), the same body as a never-existing file, so a 404 on delete is safe to treat as already absent.
- [capture] Cancel is best effort and a cancelled-then-completed batch ends `completed`, not `cancelled`.
- [capture] HTTP error bodies are FastAPI style `{"detail": ...}` where `detail` is a string, an object with `error`, or a list of pydantic errors. The OpenAI `{error: {message, type}}` envelope is not used.
- [capture] Validation errors include `line` numbers that are 0-based (`live-validation-method-get-poll.json` reports `line: 0` for the first line). OpenAI reports 1-based lines.

### Adapter and skin reuse

- [capture] Reuse from `packages/batch/adapters/openai`: `uploadBatchFile`, `downloadBatchFile`, `deleteBatchFile`, `transformToOpenAiBatchInput`, `parseOpenAIBatchUsage`, `openAiBatchResultToInternalResponse`, and `parseOpenAIBatchResult` for successful rows, all with `baseUrl: "https://api.deepinfra.com"`.
- [capture] DeepInfra-specific: a poll schema and status mapper allowing null `request_counts`, `finalizing`, and the `errors.data[].code` values above. A `submitNativeBatch` that sets `output_expires_after`. A `parseResult` wrapper that normalizes `error.type: null` rows. A `fromInternalRequest` that lowers through the sync DeepInfra transform (reasoning object, no stream fields). Error-body normalization for `{"detail": ...}`.
- [capture] The existing chat and embeddings skins apply unchanged because the line `body` is the OpenAI-compatible sync body.
- [capture] `nativeDeletion` must be `BATCH_NATIVE_DELETION_UNSUPPORTED`. `deleteFiles` should delete input, output, and error handles via `DELETE /v1/files/{id}` and treat 404 as already deleted.

## 12. OpenRouter endpoint intersection

- [capture] Native `GET /v1/models` returned 192 models across chat, embeddings, image, video, and audio. Seed data (`postgres/seeds/endpoints_rows.csv`) has 107 active, non-hidden, non-deleted DeepInfra endpoint rows over 106 provider model IDs, of which 105 appear in the native listing. The one absent is `canopylabs/orpheus-3b-0.1-ft`.
- [capture] The chat probe model `openai/gpt-oss-20b` and the vision probe model `Qwen/Qwen3-VL-30B-A3B-Instruct` are active OpenRouter DeepInfra endpoints. The embeddings probe model `Qwen/Qwen3-Embedding-0.6B` is not an OpenRouter endpoint. Active embedding endpoints include `Qwen/Qwen3-Embedding-4B`, `Qwen/Qwen3-Embedding-8B`, `BAAI/bge-m3`, and the `intfloat`, `thenlper`, and `sentence-transformers` rows.
- [unconfirmed] Whether every intersected chat model is batch-eligible on DeepInfra's side was not probed. `unknown_model` is the validation failure to expect for a non-batch model.

## 13. Credential shape

- [docs] A single bearer API key covers files and batches.
- [capture] The platform key at `/_providers` `DEEPINFRA_API_KEY` sufficed for every operation above.
- [unconfirmed] BYOK behavior is not probed.

## 14. Artifact handles

- [capture] The poll exposes `input_file_id` (`file_<24>`), `output_file_id` (`<batch_id>_output`), and `error_file_id` (`<batch_id>_error`). Output and error ids are derived from the batch id, not independent file ids.
- [capture] All three resolve through `GET /v1/files/{id}` and `GET /v1/files/{id}/content`. Content is served directly with `content-type: binary/octet-stream` and a `content-disposition` filename, with no redirect.
- [capture] After deleting output and error files, `GET /v1/files/{id}/content` returns 404 and the batch record still reports the ids (`live-get-content-after-delete-output-file.json`, `live-get-batch-after-all-deletes.json`). A non-null handle is not proof the artifact still exists.

## 15. Remote image URL inputs

- [capture] `image_url: {url: "https://..."}` to a PNG on a public host succeeded on `Qwen/Qwen3-VL-30B-A3B-Instruct` (`live-multimodal-input.jsonl` line `image-url-001`, `live-multimodal-output.jsonl`).
- [capture] A `data:image/png;base64,...` URL succeeded (`image-data-url-004`).
- [capture] A URL serving HTML failed per row with `code: "400"`, message "Failed to download one or more images. Ensure URLs are reachable and serve a supported image MIME type (image/jpeg, image/png, image/webp, image/gif)." (`live-multimodal-error.jsonl`). An unreachable image URL failed with the same message (`live-multimodal-rejected-error.jsonl`).
- [capture] The provider fetches the URL server-side and the failure is row-level, not batch-level. `batchAdapterSupportsImageUrls` can be `supported: true` for this adapter, with the supported MIME list above recorded for the docs matrix.

## 16. Remote file and PDF URL inputs

- [capture] `{type: "file", file: {filename, file_data: "https://.../x.pdf"}}` succeeded when the URL served `application/pdf` (`live-multimodal-input.jsonl` line `file-url-002`, `live-multimodal-output.jsonl`).
- [capture] `file: {file_id: "https://..."}` failed per row with "file_id is not supported; send the PDF inline as file_data (data:application/pdf;base64,...) or as an https URL" (`live-multimodal-rejected-error.jsonl` line `file-url-003`). A URL not serving `application/pdf` failed with "Failed to download the PDF. Ensure the URL is reachable and serves application/pdf." (`file-url-alt-004`).
- [capture] `batchAdapterSupportsFileUrls` can be `supported: true` provided the serializer emits the URL in `file_data`, never `file_id`.
- [unconfirmed] Non-PDF file types were not probed.

## 17. Native deletion

- [capture] `DELETE /v1/files/{id}` returned 200 `{id, object: "file", deleted: true}` for input, output, and error files (`live-delete-input-file.json`, `live-delete-output-file.json`, `live-delete-error-file.json`). Subsequent metadata and content reads returned 404 (`live-get-after-delete-input-file.json`, `live-get-content-after-delete-output-file.json`). Repeating the delete returned 404 (`live-delete-input-file-again.json`).
- [capture] `DELETE /v1/batches/{id}` returned 405 and the batch remained readable. Native batch deletion is unsupported.
- [capture] Deleting all three files leaves the batch record intact with the stale ids (`live-get-batch-after-all-deletes.json`).

## Completion, failure, and adapter seam decisions

- [capture] Completion is the status string. Map `finalizing` to `in_progress`. Never infer completion from `request_counts` or `usage`, which grow monotonically during the run.
- [capture] A whole-job `failed` status carries `errors.data[]` and no rows. Surface `code` and `message` (and `line` where non-null) as `failure_reason`/`failure_codes` from `pollBatch`.
- [capture] A `completed` status may carry both files. Read both when non-null, tolerate an empty error file, and reconcile rows by `custom_id`.
- [capture] Normalize error rows before `parseResult` and in `transformBatchResponse` so billing sees canonical rows. Failed rows carry no usage.
- [capture] Serialize through a DeepInfra-specific `fromInternalRequest` that reproduces the sync `reasoning` object and omits stream fields. Emit file URLs in `file_data`.
- [capture] Construct all URLs from `https://api.deepinfra.com`.
- [unconfirmed] Expired and cancelled-with-partial-output artifact readability. Read handles whenever non-null.

## Capture matrix

Completed live rows: discovery (models, list batches, list files, bad auth, no auth, missing batch, missing file), upload-create, validating, in-progress, finalizing, completed, output download, error-file download, retention fields, file deletion for input, output, and error, repeat delete, batch delete attempt, text, tool calls, multiple system messages, multi-turn, reasoning, structured output, truncation, `n: 2`, public image URL accepted, image URL rejected (HTML and unreachable), image data URL, public PDF URL via `file_data` accepted, PDF via `file_id` rejected, non-PDF URL rejected, embeddings, failed job (7 validation shapes), all-failure job, mixed partial-success job, cancelled job, cancel race that completed, cancel after terminal, sync-parity fields (`reasoning`, `prompt_cache_key`, `stream_options`, `stream: false`).

Deferred rows and reasons: `expired` (24 hour window), cancelled job with partial artifacts (cancel completed all rows), `/v1/completions` (not in OpenRouter's batch endpoint set), 429 and over-limit (shared quota), BYOK credential (no customer key), results on `expired`, billing continuity through OpenRouter (implementation phase).

## Fixture index

| Fixture                                                                                                                                                                                                                                                               | Capture-matrix row proved                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `live-bad-auth.json`, `live-no-auth.json`                                                                                                                                                                                                                             | `bad-auth`                                                                                                                           |
| `live-get-missing-batch.json`, `live-get-missing-file.json`                                                                                                                                                                                                           | `discovery` 404 shapes                                                                                                               |
| `live-happy-input.jsonl`                                                                                                                                                                                                                                              | request inputs for `text`, `multi-system`, `multi-turn`, `reasoning`, `structured-output`, `truncated`, `tool-calls`, `stream: true` |
| `live-happy-upload.json`, `live-happy-create.json`                                                                                                                                                                                                                    | `upload-create`                                                                                                                      |
| `live-happy-validating-poll.json`                                                                                                                                                                                                                                     | `status-queued`                                                                                                                      |
| `live-happy-in-progress-poll.json`                                                                                                                                                                                                                                    | `status-in-progress`                                                                                                                 |
| `live-happy-finalizing-poll.json`                                                                                                                                                                                                                                     | `finalizing`                                                                                                                         |
| `live-happy-completed-poll.json`                                                                                                                                                                                                                                      | `status-completed`, `partial-success` counts and both handles                                                                        |
| `live-happy-output.jsonl`                                                                                                                                                                                                                                             | `output-download`, successful row shapes                                                                                             |
| `live-null-tool-calls-output.jsonl`                                                                                                                                                                                                                                   | null `tool_calls` rows (GLM-5.3-Flash)                                                                                               |
| `live-happy-error.jsonl`                                                                                                                                                                                                                                              | `error-file-download`, `stream: true` row failure                                                                                    |
| `live-happy-input-file-metadata.json`, `live-happy-output-file-metadata.json`, `live-happy-error-file-metadata.json`                                                                                                                                                  | `retention-fields`                                                                                                                   |
| `live-mixed-runtime-completed-poll.json`, `live-mixed-runtime-output.jsonl`, `live-mixed-runtime-error.jsonl`                                                                                                                                                         | `partial-success` with context overflow                                                                                              |
| `live-all-failure-input.jsonl`, `live-all-failure-terminal-poll.json`                                                                                                                                                                                                 | all-failure probe (validation)                                                                                                       |
| `live-validation-*-input.jsonl`, `live-validation-*-poll.json`                                                                                                                                                                                                        | `duplicate-custom-id`, `malformed-jsonl`, `unsupported-endpoint-or-model`, `job-failed`                                              |
| `live-create-bad-window.json`, `live-create-missing-file.json`, `live-create-unsupported-endpoint.json`                                                                                                                                                               | create-time 422 and 404                                                                                                              |
| `live-cancel-response.json`, `live-cancelling-poll.json`, `live-cancelled-poll.json`, `live-cancel-after-terminal.json`                                                                                                                                               | `job-cancelled`                                                                                                                      |
| `live-cancel-race-cancelling-poll.json`, `live-cancel-race-completed-poll.json`                                                                                                                                                                                       | cancel race                                                                                                                          |
| `live-multimodal-input.jsonl`, `live-multimodal-completed-poll.json`, `live-multimodal-output.jsonl`, `live-multimodal-error.jsonl`                                                                                                                                   | `image-url-public`, `file-url-public`, `image-url-rejected`                                                                          |
| `live-multimodal-rejected-input.jsonl`, `live-multimodal-rejected-error.jsonl`                                                                                                                                                                                        | `image-url-rejected`, `file-url-rejected`                                                                                            |
| `live-embeddings-input.jsonl`, `live-embeddings-completed-poll.json`, `live-embeddings-output.jsonl`                                                                                                                                                                  | embeddings wire                                                                                                                      |
| `live-sync-parity-input.jsonl`, `live-sync-parity-completed-poll.json`, `live-sync-parity-output.jsonl`, `live-sync-parity-error.jsonl`                                                                                                                               | sync-transform parity                                                                                                                |
| `live-delete-batch.json`, `live-get-after-delete-batch.json`                                                                                                                                                                                                          | `delete-batch`                                                                                                                       |
| `live-delete-input-file.json`, `live-delete-input-file-again.json`, `live-get-after-delete-input-file.json`, `live-delete-output-file.json`, `live-get-content-after-delete-output-file.json`, `live-delete-error-file.json`, `live-get-batch-after-all-deletes.json` | `delete-file`                                                                                                                        |
| `provenance.json`                                                                                                                                                                                                                                                     | redaction and capture-status manifest                                                                                                |

Fixtures live under `packages/batch/adapters/deepinfra/fixtures/`. Identifiers are redacted to stable placeholders as described in `provenance.json`. The mixed-runtime input JSONL is not committed because its overflow line exceeds 1 MB.
