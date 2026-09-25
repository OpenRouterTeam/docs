# Parasail Batch API research

This Phase 1 note records official documentation and native live captures for Parasail's OpenAI-compatible Batch API; it intentionally contains no adapter, schema, endpoint, or registration implementation. Provenance labels are `[capture]` for observations from the native API run on 2026-09-21, `[docs]` for official Parasail documentation, and `[unconfirmed]` for behavior not demonstrated by a live capture.

Each factual claim carries one of those provenance tags: `[capture]` means Observed `<capture file>`, `[docs]` means Reported `<doc URL>`, and `[unconfirmed]` means Unverified. The surrounding row or bullet names the specific capture file or documentation URL when the claim is load-bearing.

## Official sources

- [docs] Batch API reference: https://docs.parasail.io/parasail-docs/api-reference/batch-api
- [docs] Batch quickstart: https://docs.parasail.io/parasail-docs/products/quickstart.md
- [docs] Batch file format: https://docs.parasail.io/parasail-docs/products/quickstart/file-format.md
- [docs] Batch troubleshooting: https://docs.parasail.io/parasail-docs/products/quickstart/troubleshooting.md
- [docs] Authentication: https://docs.parasail.io/parasail-docs/api-reference/authentication.md
- [docs] Models endpoint: https://docs.parasail.io/parasail-docs/api-reference/models-endpoint.md
- [docs] Limits and quotas: https://docs.parasail.io/parasail-docs/operate-in-production/limits-and-quotas.md
- [docs] Retries and idempotency: https://docs.parasail.io/parasail-docs/operate-in-production/retries-and-idempotency.md
- [docs] Pricing: https://docs.parasail.io/parasail-docs/billing/pricing.md
- [docs] Multi-modal inputs: https://docs.parasail.io/parasail-docs/guides/multi-modal.md
- [docs] Structured output: https://docs.parasail.io/parasail-docs/guides/structured-output.md
- [docs] Tool/function calling: https://docs.parasail.io/parasail-docs/guides/tool-function-calling.md

## 1. Auth

- [docs] All requests use `Authorization: Bearer <API key>` against `https://api.parasail.io/v1`; the Files API and Batch API share this gateway. See the authentication page.
- [capture] A key scoped through Infisical `/_providers` successfully read `/v1/models`, uploaded files, created batches, listed batches, polled jobs, and read file metadata. The key was never printed or persisted.
- [capture] A deliberately invalid non-secret bearer value returned HTTP 401 with the plain body `Unauthorized. Invalid token format.`.
- [unconfirmed] BYOK credential storage and runtime validation are not specified by the native Parasail docs or demonstrated here; implementation should reuse OpenRouter's provider credential plumbing rather than invent a new key format.

## 2. Endpoints

- [capture] Native discovery used `GET /v1/models`, upload used `POST /v1/files` with multipart `purpose=batch` and a JSONL file, create used `POST /v1/batches`, poll used `GET /v1/batches/{batch_id}`, list used `GET /v1/batches?limit=100`, cancel used `POST /v1/batches/{batch_id}/cancel`, file metadata used `GET /v1/files/{file_id}`, and content used `GET /v1/files/{file_id}/content`.
- [docs] The base URL is `https://api.parasail.io/v1`, and the Batch API reference identifies `/v1/batches` and the Files API reference used for uploads.
- [capture] The only accepted line URLs demonstrated by the capture plan are `/v1/chat/completions` and `/v1/embeddings`; a batch submitted with endpoint `/v1/responses` reached validation and failed with `errors.data[0].message: "Unsupported url"`.
- [docs] The file-format page documents `/v1/chat/completions` and `/v1/embeddings` as the supported request-line URLs.

## 3. Request-line shape

- [docs] Each JSONL line is an object with unique `custom_id`, `method: "POST"`, `url`, and `body`; chat `stream` must be omitted or false. Response order may differ from input order, so consumers match by `custom_id`.
- [capture] The committed input fixtures preserve real uploaded request lines for text, multiple system messages, multi-turn, reasoning effort, structured output, truncation, tools, public image URL, public file URL, and embeddings.
- [capture] Duplicate IDs are rejected during validation: the batch is `failed` with `errors.data[0]` containing `message: "Duplicate custom_id, first appeared on line 1"` and `line: 2`.
- [capture] Malformed JSONL is rejected during validation with one error object per malformed line and line numbers.

## 4. Status model and completion

| Native status | Internal mapping | Terminal | Evidence |
| --- | --- | --- | --- |
| `validating` | `validating` | no | [capture] immediate poll |
| `in_progress` | `in_progress` | no | [capture] poll after validation |
| `cancelling` | `cancelling` | no | [capture] cancel response |
| `completed` | `completed` | yes | [docs] listed terminal status; [unconfirmed] no successful terminal capture |
| `failed` | `failed` | yes | [capture] invalid model, malformed JSONL, duplicate ID, unsupported URL |
| `expired` | `expired` | yes | [docs] listed terminal status; [unconfirmed] not reproducible within the capture window |
| `cancelled` | `cancelled` | yes | [capture] cancellation completed with `cancelled_at` |

- [docs] Parasail describes the lifecycle as `validating`, `in_progress`, then `completed`, `failed`, `expired`, or `cancelled`; the helper exits on those terminal values.
- [capture] A cancellation request returned `cancelling`, then a later poll returned `cancelled`. The cancellation poll had no output or error file handles.
- [capture] Validation failures returned HTTP 200 for the poll resource, with `status: "failed"` and batch-level `errors`; they did not expose result rows.
- [unconfirmed] Whether a terminal failed, expired, or cancelled job can retain readable partial output is not established; the observed failed and cancelled jobs had null handles. The implementation must attempt output/error reads only when a handle is present.

## 5. Output and error shapes

- [docs] A result JSONL line contains `custom_id` and `response`; `response.status_code` is 200 for success and otherwise matches the interactive HTTP error, while `response.body` is the native chat or embeddings body.
- [docs] Failed requests are per-request rows in the output model and should be inspected independently; the docs show `record.get("error")` when `response.status_code` is not 200.
- [capture] No successful terminal output file was available during this run because six valid jobs remained `in_progress`; consequently the exact live success-line IDs, row ordering, per-row error envelope, and per-row usage are `[unconfirmed]` and the output fixtures are intentionally deferred.
- [capture] Whole-job validation failures use `errors: {object: "list", data: [{code, message, param, line}]}`, with no output or error file handle. This is a batch-level error shape, not a substitute for a failed result row.
- [capture] Failed model, duplicate ID, malformed JSONL, and unsupported endpoint examples are committed as sanitized poll fixtures.
- [unconfirmed] Separate error-file behavior could not be observed because all failed jobs were rejected at validation and returned `error_file_id: null`.

## 6. Limits

- [docs] Parasail allows up to 50,000 requests and 1000 MB per input file; the quickstart contrasts this with OpenAI's 250 MB limit.
- [docs] Parasail's batch max completion tokens default to 8,192 and can be overridden to 16,384 with `max_completion_tokens`.
- [docs] Serverless rate limits are 5 RPM for free accounts and 500 RPM for user accounts; token limits are not currently enforced for those tiers. Batch-specific 429 headers were not documented.
- [unconfirmed] An over-limit request, 429 response headers, and retry-after behavior were not triggered to avoid creating a large file or consuming shared capacity; the retries page recommends exponential backoff with jitter for 429 and 5xx responses.

## 7. Expiry and retention

- [docs] Batch creation accepts `completion_window: "24h"` in the OpenAI-compatible request shape.
- [capture] Every observed poll included `completion_window: "24h"`; the job's `expires_at` was null on validating, in-progress, failed, and cancelled examples.
- [capture] Uploaded input file metadata included `id`, `object`, `bytes`, `created_at`, `filename`, and `purpose: "batch"`; it had no explicit expiry field. File content returned HTTP 302 to a signed object-storage URL, and following the redirect returned the uploaded JSONL.
- [unconfirmed] Parasail's retention duration, automatic artifact deletion, and post-expiry read behavior were not stated in the fetched batch docs or demonstrated live. Finalization must treat the provider's result-handle availability as a deadline and persist artifacts promptly.

## 8. Pricing and usage

- [docs] Batch pricing is token-based and is 50% of the Serverless price. Cached tokens receive a further 50% discount; FP16 quantized models are 30% above the FP8 batch price; FP8 models have no surcharge. The default tier is based on parameter count unless the model is a named model. Source: https://docs.parasail.io/parasail-docs/billing/pricing#batch-pricing.
- [docs] The prices are USD per million tokens; no separate per-request fee is documented. Named-model pricing takes precedence over parameter-size defaults.
- [capture] No live per-row usage object was available because no valid batch reached a terminal output file. `prompt_tokens_details.cached_tokens` is therefore `[unconfirmed]`; the future `parseUsage` seam must preserve it when present and leave failed rows unbilled unless later evidence proves otherwise.
- [capture] Finalization pricing must key on the active OpenRouter endpoint row, including its `quantization`, rather than infer a single Parasail model price: the same provider model family can have FP8, FP16/BF16, FP4, INT4, or unknown endpoint rows, and Parasail's batch surcharge is quantization-dependent.

## 9. Sync-transform overrides

- [capture] The existing sync adapter is `packages/router/adapters/parasail/index.ts`, where `ParasailAdapter extends VLLMOpenAIAdapter`.
- [capture] `VLLMOpenAIAdapter.transformRequest` in `packages/router/adapters/engine/vllm-openai.ts` merges `chat_template_kwargs` for chat completions using `getVllmThinkingParams`.
- [capture] `getVllmThinkingParams` returns `undefined` unless the endpoint supports reasoning toggles and `parameters.reasoning.enabled` is defined; otherwise it emits exactly `{thinking: parameters.reasoning.enabled, enable_thinking: parameters.reasoning.enabled}`.
- [capture] `chat_template_kwargs` is omitted for `/v1/completions` because the sync implementation only adds it when `usesChatCompletions()` is true.
- [capture] `OpenAIBatchAdapter` cannot be reused as-is because its base OpenAI serializer silently drops provider-specific sync transformations; the repository warning is in `services/batch-api/src/adapters/api-key-providers.ts` and `packages/batch/adapters/batch-adapter-factory.ts`.

## 10. OpenRouter mapping decision and OpenAI wire comparison

- [docs] Parasail's batch API reference says: “Parasail's batch API is a direct drop-in replacement for OpenAI's batch API. The same documentation, guides, and client libraries apply.” Source: https://docs.parasail.io/parasail-docs/api-reference/batch-api
### Deviations from OpenAI batch wire

- [capture] The observed wire matches the OpenAI file-based shape for bearer auth, `POST /v1/files`, `purpose: "batch"`, `POST /v1/batches`, `GET /v1/batches/{id}`, `GET /v1/files/{id}/content`, JSONL request lines, and the observed lifecycle names `validating`, `in_progress`, `cancelling`, `failed`, and `cancelled`; `completed` and `expired` are [docs]-only and [unconfirmed] in this run.
- [capture] Observed differences or Parasail-specific evidence that the implementation must preserve are: `cancelling` is observable as a transient status; batch-level validation errors use `errors.object: "list"` plus `data` entries with `code`, `message`, `param`, and `line`; the native input-file metadata uses `purpose: "batch"` and content reads redirect to a signed object-storage URL; and `/v1/responses` fails with `Unsupported url`.
- [docs] Parasail documents 1000 MB input files versus OpenAI's documented 250 MB, and documents `/v1/chat/completions` and `/v1/embeddings` as the accepted batch line endpoints; neither limit was probed.
- [capture] File deletion differs from the claimed drop-in lifecycle: `DELETE /v1/files/{id}` returned `{id, object: "file", deleted: true}` and a following GET returned 404, while `DELETE /v1/batches/{id}` returned HTTP 403 `Access denied` for both a failed terminal batch and a cancelled batch; following GETs returned HTTP 200 and the batch records remained. Whether batch deletion cascades to files is [unconfirmed] because no delete attempt succeeded.
- [capture] `DELETE /v1/files/{id}` also returned HTTP 200 with `deleted: true` for non-existent output and error handles, while follow-up GETs returned 404; unlike OpenAI's 404 for a non-existent file, Parasail's receipt is not proof of deletion, so `deleteFiles` must confirm with a follow-up GET. Evidence: `live-delete-unobserved-output-file.json` and `live-delete-unobserved-error-file.json`.
- [unconfirmed] No live evidence established a deviation in completed output-line shape, separate error-file shape, per-row usage representation, retention, or output/error file deletion compared with OpenAI because no valid job reached a terminal result file during the capture window. Do not claim those surfaces are identical until a completed output and an error-file capture exist.
- [capture] The new adapter should be a Parasail-specific file-ingest adapter with an OpenAI-compatible wire serializer plus the Parasail sync transform, not `OpenAIBatchAdapter` reused unchanged. The planned implementation layers are a provider batch adapter, a Parasail serializer that reproduces `chat_template_kwargs`, provider registration, and fixtures/tests based on the deferred terminal captures.

## 11. OpenRouter endpoint intersection

- [capture] Native `/v1/models` returned 91 model objects. Intersecting those IDs with active, non-hidden, non-deleted, non-disabled Parasail endpoint rows produced 38 provider model IDs in the current seed data.
- [capture] The cheapest active intersection used for the live batch attempt was `parasail-llama-32-3b-instruct`; the primary scenario probes used `parasail-gpt-oss-20b` because it is an active OpenRouter endpoint and supports structured output/tool metadata; the image probe used active `parasail-qwen25-vl-72b-instruct`; embeddings used active `parasail-bge-m3`.
- [capture] Other active intersection IDs include `parasail-llama-33-70b-fp8`, `parasail-llama-4-maverick-instruct-fp8`, `parasail-gpt-oss-120b`, `parasail-gemma3-27b-it`, `parasail-gemma-4-26b-a4b-it`, `parasail-gemma-4-31b-it`, `parasail-mistral-small-32-24b`, `parasail-qwen3-235b-a22b-instruct-2507`, `parasail-qwen3-coder-next`, `parasail-qwen-3-next-80b-instruct`, `parasail-qwen3-vl-235b-a22b-instruct`, `parasail-qwen3vl-8b-instruct`, `parasail-qwen3p5-35b-a3b`, `parasail-qwen35-397b-a17b`, `parasail-qwen35-9b`, `parasail-qwen3p6-35b-a3b`, `parasail-qwen38-27b`, `parasail-deepseek-v4-flash`, `parasail-deepseek-v4-flash-0731`, `parasail-deepseek-v4-pro`, `parasail-deepseek-v4-pro-0813`, `parasail-glm-52`, `parasail-glm-53`, `parasail-glm-53-flash`, `parasail-kimi-k26`, `parasail-kimi-k3`, `parasail-minimax-m3`, `parasail-mistralaimistral-nemo`, `parasail-sao10kl3-lunaris-8b`, `parasail-unslopnemo-12b`, `parasail-mythomax-13b`, `parasail-cydonia-24-v41`, and `parasail-ui-tars-1p5-7b`.
- [capture] Excluded from the intersection are native discovery models with no active endpoint row, hidden/deleted/disabled endpoint rows, provider ignored models, and models not carrying the requested chat or embeddings modality. The seeds also show provider support flags and parameter sets that must be rechecked at implementation time rather than inferred from model listing alone.

## 12. Credential shape

- [docs] Parasail credentials are bearer API keys, and platform jobs and Files API artifacts live in Parasail's service account.
- [capture] The platform key was available as `PARASAIL_API_KEY` through Infisical and worked from `/_providers`; a second path was not read because the first succeeded.
- [unconfirmed] BYOK key format, organization scoping, and artifact ownership for OpenRouter customer keys require a separate credential-plumbing decision; this research does not introduce or expose credentials.

## 13. Artifact handles

- [capture] Poll responses expose `input_file_id`, `output_file_id`, and `error_file_id`; validation failures and cancellation had an input handle but null output/error handles.
- [capture] The input handle resolved through `GET /v1/files/{id}` and `GET /v1/files/{id}/content`; the content endpoint redirects to object storage.
- [unconfirmed] Successful output and separate error handles were not observed because the valid jobs remained `in_progress`. The future `pollBatch` should map `output_file_id` to the shared result-handle slot and preserve `error_file_id` independently; `fetchNativeResults` should read both when non-null.

## 14. Remote URL inputs

- [docs] The batch file format only defines `body` as the interactive request body and documents chat and embeddings; the quickstart's batch image section describes converting local images to base64.
- [capture] A public `image_url` request line and a public PDF `file_url` request line were accepted by file upload and batch creation, but their jobs remained `in_progress`; successful fetch or rejection was therefore not observed.
- [unconfirmed] Native public image URL support, accepted schemes/content types, provider-side fetch failures, and native public file/PDF URL support remain unconfirmed. Until terminal captures exist, `batchAdapterSupportsImageUrls` and `batchAdapterSupportsFileUrls` should default to unsupported with a caller-facing reason; base64 image support is the documented helper path.

## 15. Native deletion

- [capture] `DELETE /v1/files/{id}` returned HTTP 200 with `{id, object: "file", deleted: true}` for an input file; `GET /v1/files/{id}` and `GET /v1/files/{id}/content` both returned HTTP 404 afterward. Evidence: `live-delete-input-file.json` and `live-get-after-delete-file.json`.
- [capture] The same file deletion receipt was probed for unobserved output and error handles; both stable non-existent handles returned HTTP 200 with `deleted: true`, and follow-up GETs returned 404. No real output/error handle existed because all valid jobs remained non-terminal. Evidence: `live-delete-unobserved-output-file.json` and `live-delete-unobserved-error-file.json`.
- [capture] `DELETE /v1/batches/{id}` returned HTTP 403 with `{error: {message: "Access denied", type: "invalid_request_error"}}` for both a failed terminal batch and a cancelled batch. Follow-up GETs returned HTTP 200 with the original batch records, so the route is not a usable native batch-delete operation for this credential. Evidence: `live-delete-terminal-batch.json`, `live-delete-nonterminal-batch.json`, and `live-get-after-delete-batches.json`.
- [unconfirmed] Whether a higher-privilege Parasail account can delete batches, and whether such deletion cascades to input/output/error files, remains unconfirmed. The observed credential cannot demonstrate cascade behavior.
- [unconfirmed] The observed credential could not establish provider-wide `nativeDeletion` support because `DELETE /v1/batches/{id}` was forbidden; a future adapter must identify and test the required permission scope before choosing `{supported: true}` or `{supported: false}`. It should implement `deleteFiles` through `DELETE /v1/files/{id}` for non-null input/output/error handles and confirm absence with a follow-up GET.

## Completion, failure, and adapter seam decisions

- [capture] Completion is signaled by a terminal poll status. `pollBatch` must map `validating`, `in_progress`, and `cancelling` to the same-named non-terminal `UpstreamBatchStatus` values, and `completed`, `failed`, `expired`, and `cancelled` to their corresponding terminal values.
- [capture] Whole-job validation failures expose batch-level `errors` and no result rows. A failed model, malformed JSONL, duplicate ID, or unsupported endpoint must become `failure_reason`/`failure_codes` from `pollBatch`, not a fabricated result line.
- [unconfirmed] A valid job with one failed sub-request alongside successes was submitted, but no terminal result was available. Once captured, `parseResult` must preserve each failed line as a normal row with `custom_id` and `error` instead of `response`; successful rows must carry `response`.
- [unconfirmed] Per-row usage belongs in `parseUsage` from `response.body.usage`; failed rows carry no usage unless a terminal capture proves otherwise. Billing must not infer usage from batch-level counters.
- [unconfirmed] Partial-success status remains unconfirmed until a terminal output file with mixed rows is captured; the submitted mixed-input job did not finish during this research. A future adapter should preserve successful and failed rows if Parasail reports them in one output file, while a whole-job `failed` status should remain reserved for validation/upstream job failure.

## Capture matrix

Completed live rows: discovery; upload-create; immediate validating poll; in-progress poll; list; input file metadata and redirect/content read; failed job; cancelled job; duplicate `custom_id`; malformed JSONL; unsupported endpoint; invalid auth; request inputs for text, tools, multiple system messages, multi-turn, reasoning, structured output, truncation, public image URL, public file URL, and embeddings.

Deferred rows and reasons: completed poll, output download, error-file download, retention follow-up (post-expiry read), terminal partial-success output, results on non-success terminal handles, image URL acceptance/rejection, file URL acceptance/rejection, five-line happy/sad/mixed probes, missing `custom_id`, over-limit, cancel race, and rate-limit. The valid jobs remained `in_progress` for the entire capture window, while rate-limit and over-limit probes were deferred to avoid shared-capacity and large-file side effects; missing-ID and cancel-race probes were lower priority after duplicate-ID and cancellation captures.

## Fixture index

| Fixture | Capture-matrix row proved |
| --- | --- |
| `live-discovery.json` | `discovery` |
| `live-upload-create.json` | `upload-create` and `status-queued` (observed as `validating` immediately after create) |
| `live-in-progress-poll.json` | `status-in-progress` |
| `live-happy-input.jsonl` | `text`, `multi-system`, `multi-turn`, `reasoning`, `structured-output`, `truncated` |
| `live-tools-input.jsonl` | `tool-calls` |
| `live-image-url-input.jsonl` | `image-url-public` |
| `live-file-url-input.jsonl` | `file-url-public` |
| `live-embeddings-input.jsonl` | `text` on the embeddings wire |
| `live-partial-input.jsonl` | `partial-success` request input |
| `live-failed-poll.json` | `job-failed` |
| `live-duplicate-poll.json` | `duplicate-custom-id` |
| `live-malformed-poll.json` | `malformed-jsonl` |
| `live-unsupported-endpoint-poll.json` | `unsupported-endpoint-or-model` |
| `live-cancelled-poll.json` | `job-cancelled` |
| `live-bad-auth.json` | `bad-auth` |
| `live-file-metadata.json` | `retention-fields` |
| `live-delete-input-file.json` | `delete-file` input handle |
| `live-get-after-delete-file.json` | `delete-file` post-delete read |
| `live-delete-unobserved-output-file.json` | `delete-file` output-handle probe |
| `live-delete-unobserved-error-file.json` | `delete-file` error-handle probe |
| `live-delete-terminal-batch.json` | `delete-batch` terminal attempt |
| `live-delete-nonterminal-batch.json` | `delete-batch` non-terminal attempt |
| `live-get-after-delete-batches.json` | `delete-batch` post-delete reads |
| `provenance.json` | redaction and capture-status manifest |

Fixtures live under `packages/batch/adapters/parasail/fixtures/`. They preserve native field names and sanitized provider shapes; output/error JSONL fixtures are explicitly deferred because the provider did not expose a terminal result handle during the capture window. Raw transcripts remain outside the repository.
