# Anthropic Message Batches API — research note

Backfill output of `research-batch-provider` for provider `anthropic` (OpenRouter provider name `Anthropic`). The adapter (`packages/batch/adapters/anthropic/`) shipped before this note existed; this document verifies its assumptions against the native API, the official docs, and OpenRouter's public Batch API, and records the divergences.

Live captures were taken 2026-09-02 against `https://api.anthropic.com` with the platform `ANTHROPIC_API_KEY` (Infisical `/services/batch-api`, env `dev`), model `claude-haiku-4-5` (resolved upstream to `claude-haiku-4-5-20251001`) for the lifecycle and error-shape captures, plus a same-model rerun of the ten-line feature batch on `claude-opus-5` so that every model-dependent comparison below (tools, structured output, thinking, truncation, cache counts) is against the model OpenRouter actually ran. OpenRouter-side captures used `POST https://openrouter.ai/api/beta/batches` with the batch test key and model `anthropic/claude-opus-5` (resolved to the `anthropic/claude-opus-5-20260723:batch` endpoint row) because the cheaper Haiku/Sonnet slugs were rejected by the batch resolver (§11, D1). Raw transcripts were not committed; redacted shapes are quoted inline, and the dogfood run (OpenRouter batch ids, Datadog fields, per-case verdicts) is folded into the final section.

Provenance tags: `[capture]` observed live on 2026-09-02, `[docs]` official documentation (URL cited inline), `[code]` read from this repository, `[unconfirmed]` neither.

## Official sources

- Overview guide (batch processing): https://platform.claude.com/docs/en/build-with-claude/batch-processing
- API reference — create: https://platform.claude.com/docs/en/api/creating-message-batches
- API reference — retrieve: https://platform.claude.com/docs/en/api/retrieving-message-batches
- API reference — list: https://platform.claude.com/docs/en/api/listing-message-batches
- API reference — cancel: https://platform.claude.com/docs/en/api/canceling-message-batches
- API reference — results: https://platform.claude.com/docs/en/api/retrieving-message-batch-results
- API reference — delete: https://platform.claude.com/docs/en/api/deleting-message-batches
- API reference — Messages create (the `params` shape of a batch line): https://platform.claude.com/docs/en/api/messages/create
- API overview (auth headers, versioning): https://platform.claude.com/docs/en/api/overview
- Errors (error `type` → HTTP status): https://platform.claude.com/docs/en/api/errors
- Rate limits (headers, tiers): https://platform.claude.com/docs/en/api/rate-limits
- Pricing (batch 50% discount, web search charge): https://platform.claude.com/docs/en/about-claude/pricing
- API and data retention: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- Files API (`file_id` sources): https://platform.claude.com/docs/en/build-with-claude/files
- Vision (public image URL blocks): https://platform.claude.com/docs/en/build-with-claude/vision
- PDF support (public PDF URL blocks): https://platform.claude.com/docs/en/build-with-claude/pdf-support
- Prompt caching (cache usage fields, batch interaction): https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Extended thinking (`thinking_tokens` are billed output tokens): https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- Web search tool (`web_search_20250305`): https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- Tool reference: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference

The status enum, request counters and result types have no standalone page; they are defined on the retrieve and results reference pages listed above.

## 1. Auth

- Header scheme: `x-api-key: <key>` plus a required `anthropic-version` header (official docs: https://platform.claude.com/docs/en/api/overview). The adapter pins `anthropic-version: 2023-06-01` (`packages/batch/adapters/anthropic/schemas.ts`, `ANTHROPIC_VERSION`) `[code]`.
- Same key as sync `/v1/messages`; no separate batch product or scope (official docs: https://platform.claude.com/docs/en/build-with-claude/batch-processing).
- Workspace scoping: every response carries `anthropic-organization-id` and `anthropic-workspace-id` headers; batches are visible to the key that created them (`GET /v1/messages/batches` listed only this workspace's batches) `[capture]`. No org/project pinning header is required `[capture]`.
- Bad key → HTTP **401** `{"type":"error","error":{"type":"authentication_error","message":"API key is invalid."}}` `[capture]` (matches https://platform.claude.com/docs/en/api/errors).
- No `anthropic-beta` header is sent by the batch adapter — only `x-api-key` and `anthropic-version` (`packages/batch/adapters/anthropic/anthropic-fetch.ts`) `[code]`. Every feature exercised below (thinking, tools, `output_config`, `cache_control`, `web_search_20250305`, URL image/document blocks) was accepted without any beta header `[capture]`. The sync adapter forwards or derives beta headers for a small allowlist (`packages/router/adapters/anthropic-message/client-beta-features.ts`); see §9.
- Platform vs BYOK: the batch executor uses one platform key (`ANTHROPIC_API_KEY`, `services/batch-api/src/adapters/api-key-providers.ts`); BYOK resolves the customer's stored Anthropic key through the same `ApiKeyAdapter` entry (§12) `[code]`.

## 2. Endpoints

Host `https://api.anthropic.com`, product = the Messages API. Ingestion is **inline**: there is no file upload step and no Files-API involvement (official docs: https://platform.claude.com/docs/en/api/creating-message-batches).

| Operation | Endpoint | Live result (2026-09-02) |
| --- | --- | --- |
| Create | `POST /v1/messages/batches` body `{"requests":[{custom_id, params}]}` | 200 `message_batch`, `processing_status: in_progress`, `request_counts.processing = N` `[capture]` |
| Poll / get | `GET /v1/messages/batches/{id}` | 200 `message_batch`; in-progress responses carried `retry-after: 10` `[capture]` |
| Results | `GET /v1/messages/batches/{id}/results` | 200 `content-type: application/x-jsonl` once `ended`; 404 `Message Batch … has no available results.` while `in_progress` `[capture]` |
| Cancel | `POST /v1/messages/batches/{id}/cancel` | 200 `message_batch` with `processing_status: canceling`, `cancel_initiated_at` set `[capture]` |
| List | `GET /v1/messages/batches?limit=` | 200 `{data:[…], has_more, first_id, last_id}` `[capture]` |
| Delete | `DELETE /v1/messages/batches/{id}` | 400 `In progress batches cannot be deleted. Consider canceling the batch instead.` on an in-progress batch `[capture]`; ended batches are deletable (official docs: https://platform.claude.com/docs/en/api/deleting-message-batches) `[docs]` |
| Nonexistent id (get or results) | | 404 `{"type":"error","error":{"type":"not_found_error","message":"Message Batch msgbatch_… not found."}}` `[capture]` |

- There is **no error file**: failed requests are inline rows in the same results JSONL (§5). There is **no output file id**: `results_url` on the batch object is `null` while processing and becomes `https://api.anthropic.com/v1/messages/batches/{id}/results` once ended — i.e. it is just the batch-id-addressed path, not a presigned or file URL `[capture]` (official docs: https://platform.claude.com/docs/en/api/retrieving-message-batches).
- The adapter fetches results off the stable path, ignoring `results_url` (`results-downloader.ts`) `[code]`.

## 3. Native request-line shape

One element of `requests[]`:

```json
{"custom_id":"ok-1","params":{"model":"claude-haiku-4-5","max_tokens":5,"messages":[{"role":"user","content":"Reply with exactly: 1"}]}}
```

- `params` is a complete Messages-create body (official docs: https://platform.claude.com/docs/en/api/creating-message-batches and https://platform.claude.com/docs/en/api/messages/create). `stream: true` is rejected per line at execution time, not at create time (`"stream=True" is not supported in the Message Batches API`, `errored` row) `[capture]`.
- `custom_id` must match `^[a-zA-Z0-9_-]{1,64}$` and be unique within the batch; violations are **synchronous 400s** at create time `[capture]`:
  - duplicate → `requests: custom_id's must be unique within a batch. Duplicate custom_id found: dup`
  - missing → `requests.0.custom_id: Field required`
  - too long → `requests.0.custom_id: String should have at most 64 characters`
  - bad charset → `requests.0.custom_id: String should match pattern '^[a-zA-Z0-9_-]{1,64}$'`
  - empty `requests` → `requests: List should have at least 1 item after validation, not 0`
  - malformed body → 400 `invalid_request_error: The request body is not valid JSON: …`
- Validation of `params` is **deferred**: a line whose `params` lacks `messages` was accepted (200, `processing: 1`) and only later became an `errored` row `messages: Field required` `[capture]`. The guide states that validation errors may surface asynchronously after the batch ends (official docs: https://platform.claude.com/docs/en/build-with-claude/batch-processing).
- OpenRouter mapping: the stored canonical line is `{custom_id, body}` (`StoredAnthropicBatchInputLineSchema`); `submitBatchInput` rewrites each `body` into `{custom_id, params}` while streaming the create call (`batch-submitter.ts`, `encodeInlineRequestsBody`) `[code]`. The adapter declares `ANTHROPIC_CUSTOM_ID_CONSTRAINTS` (64 chars, `[A-Za-z0-9_-]`) so the OpenRouter submit scan 422s a bad `custom_id` before the create call `[code]`; the live native regex is identical `[capture]`.
- Translation seam for both client families (`[code]`):
  - `/v1/messages` lines → `AnthropicMessagesBatchSkinContract.toInternalRequest` (`packages/batch/skins/anthropic-messages/index.ts`, delegating to the sync `transformAnthropicMessagesRequestToInternal`) → internal request → `anthropicInternalRequestToBatchInput` (`from-internal-request.ts`), which calls the **sync serializer** `serializeAnthropicMessagesRequest` with the batch endpoint row as context, then re-attaches native web-search server tools (`restoreNativeWebSearchTools`).
  - `/v1/chat/completions` lines → the chat skin → the same internal request → the same `serializeAnthropicMessagesRequest`. Both families therefore produce the same upstream `params` for equivalent inputs (ECO-1670 parity), and every line is lowered with `url: '/v1/messages'`.

## 4. Upstream status model (exhaustive)

`processing_status` has exactly three values (official docs: https://platform.claude.com/docs/en/api/retrieving-message-batches):

| `processing_status` | Meaning | Observed `[capture]` |
| --- | --- | --- |
| `in_progress` | requests still executing | every batch immediately after create; `ended_at: null`, `results_url: null` |
| `canceling` | cancel requested, in-flight requests draining | immediately after `POST …/cancel`; `cancel_initiated_at` set, counters still `processing: 3` |
| `ended` | terminal; all requests reached an outcome | ~25 s after cancel (`canceled: 3`), 3–11 min for 1–10 line batches |

`request_counts` has five counters `{processing, succeeded, errored, canceled, expired}` (official docs: same page). Per-request outcome is **only** in the counters and in the per-line `result.type` — `ended` says nothing about success `[docs]` `[capture]`.

Observed terminal count patterns `[capture]`:

| Batch | Counters at `ended` | Rows |
| --- | --- | --- |
| mixed 4 valid + 1 bad model | `succeeded: 4, errored: 1` | 4 `succeeded` + 1 `errored` |
| all-invalid (5 lines) | `errored: 5` | 5 `errored` |
| cancel 3 lines | `canceled: 3` | 3 `canceled` |
| URL blocks (4 lines) | `succeeded: 1, errored: 3` | 1 + 3 |
| deferred-validation (1 line) | `errored: 1` | 1 `errored` |

Counters were monotonic in every poll observed (processing decreases as the other buckets fill), and a single `ended` snapshot always had `processing: 0` `[capture]`. `expired` was not induced (needs a 24 h wait) — `[docs]` only.

### Mapping to OpenRouter (`toUpstreamBatchStatus`, `batch-poller.ts`) `[code]`

| Native | `UpstreamBatchStatus` |
| --- | --- |
| `in_progress` | `InProgress` |
| `canceling` | `Cancelling` |
| `ended` and `canceled == total > 0` | `Cancelled` |
| `ended` otherwise (any mix of succeeded/errored/expired/canceled) | `Completed` |

`toGenericRequestCounts`: `total = Σ counters`, `completed = succeeded`, `failed = errored + canceled + expired`. `failure_reason` is never set — there is no batch-level failure concept upstream `[code]`.

Answers to the completion/failure questions:

- **Is terminal = all done?** Yes. `ended` had `processing: 0` in every capture, and the results endpoint 404s until `ended` `[capture]`.
- **Is an all-errored batch `completed` or `failed`?** `Completed`. The 5/5-errored batch is `ended` with `errored: 5`; the adapter maps it to `Completed` with `request_counts {total: 5, completed: 0, failed: 5}` and every served row is a non-2xx line (§5) `[code]` `[capture]`. There is no `Failed` path for Anthropic at all; the only non-`Completed` terminal status is the all-canceled `Cancelled` case.
- **Partial success:** `Completed`, per-line outcomes in the rows `[code]`.
- **All-expired batch:** would map to `Completed` with `failed: N` (§4 table) — `[code]`, not live-verified.

## 5. Output and error shapes

Results are JSONL (`application/x-jsonl`), one object per request, in **arbitrary order** — the 5-line mixed batch came back `ok-4, ok-2, ok-3, bad-model, ok-1`; the cancel batch `c-2, c-3, c-1` `[capture]`. The docs state the same (official docs: https://platform.claude.com/docs/en/api/retrieving-message-batch-results). Every row carries `custom_id`, including failures `[capture]`.

`result.type` ∈ `succeeded | errored | canceled | expired` (official docs: same page). Observed shapes `[capture]`:

```json
{"custom_id":"ok-1","result":{"type":"succeeded","message":{"id":"msg_…","type":"message","role":"assistant","model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"1"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":16,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0},"output_tokens":5,"service_tier":"batch","inference_geo":"not_available"}}}}
{"custom_id":"bad-model","result":{"type":"errored","error":{"type":"error","error":{"details":{"error_visibility":"user_facing"},"type":"not_found_error","message":"model: claude-does-not-exist-9"},"request_id":null}}}
{"custom_id":"image_url","result":{"type":"errored","error":{"type":"error","error":{"details":{"error_visibility":"user_facing"},"type":"invalid_request_error","message":"Unable to download the file. Please verify the URL and try again."},"request_id":"workerreq_…"}}}
{"custom_id":"c-1","result":{"type":"canceled"}}
```

- `succeeded.message` is a complete Messages response; `usage.service_tier` is `"batch"` (sync calls return `"standard"`) `[capture]`. `usage` includes `cache_creation_input_tokens`, `cache_read_input_tokens`, the `cache_creation` breakdown, `inference_geo`, and — when a server tool ran — `server_tool_use: {web_search_requests, web_fetch_requests}` `[capture]`.
- `errored` rows carry **no usage** and no `message`; `error.error` may contain an undocumented `details` object, and `request_id` is `null` for pre-execution validation failures but populated (`workerreq_…`) for fetch-time failures `[capture]`. The adapter's `AnthropicResultErrorSchema` is `.passthrough()` on the inner error and `request_id` is `nullish`, so both variants parse `[code]`.
- `canceled` rows are exactly `{"type":"canceled"}` — no usage, no error `[capture]`; `expired` rows are the same shape `[docs]`.
- Results remain readable on an all-canceled batch (200, 3 rows) and on an all-errored batch (200, 5 rows) `[capture]`.

### Mapping to canonical output (`transform-response.ts`) `[code]`

| Native row | Canonical line |
| --- | --- |
| `succeeded` | `status_code 200`, `body` = native message verbatim, `id = message.id` |
| `errored` | `status_code` from `error.type` via `ANTHROPIC_ERROR_TYPE_TO_STATUS` (`invalid_request_error`→400, `not_found_error`→404, `rate_limit_error`→429, `api_error`→500, `overloaded_error`→529, unknown→502), `body = {type:'error', error}`, `id = anthropic-<custom_id>` |
| `canceled` | synthesized 499, `error.type = 'canceled'` |
| `expired` | synthesized 408, `error.type = 'expired'` |

The status table matches the official error table (official docs: https://platform.claude.com/docs/en/api/errors). `parseAnthropicBatchUsage` (`output-parser.ts`) only parses `succeeded` bodies; failed lines have no usage upstream and are billed nothing (§8) `[code]`.

Sync-path comparison `[capture]`: the same invalid model on sync `/v1/messages` returns HTTP 404 with the identical `not_found_error` envelope (minus `details`), so the 404 canonical line is what a sync caller would have seen. One divergence: sync `max_tokens: 0` returned **200** with `content: []`, `stop_reason: max_tokens`, `output_tokens: 0`, whereas the same line in a batch became `errored` `max_tokens: must be greater than or equal to 1` (the documented minimum, official docs: https://platform.claude.com/docs/en/api/messages/create). Batch is stricter than sync here; OpenRouter's serializer never emits `max_tokens < 1` (`effectiveMaxTokens`, §9) so this is not reachable through OpenRouter.

## 6. Limits

- Per batch: up to 100,000 requests or 256 MB, whichever is reached first (official docs: https://platform.claude.com/docs/en/build-with-claude/batch-processing).
- `custom_id`: 1–64 chars, `[a-zA-Z0-9_-]` `[capture]` (official docs: https://platform.claude.com/docs/en/api/creating-message-batches).
- `max_tokens` per line is bounded by the model's output ceiling: the batch rejected `max_tokens: 9999999` with `max_tokens: 9999999 > 64000, which is the maximum allowed number of output tokens for claude-haiku-4-5-20251001` — as an `errored` row, not a create-time 400 `[capture]`.
- Rate limits: create/poll/results responses carried `anthropic-ratelimit-requests-limit: 20000`, `…-remaining`, `…-reset` headers, and in-progress `GET` polls returned `retry-after: 10` `[capture]`. Header semantics and the tier table are documented at https://platform.claude.com/docs/en/api/rate-limits (official docs). Batch-specific request-count limits are not spelled out on that page `[unconfirmed]`; no 429 was hit during captures.
- Enqueued-job limit: none observed with 7 concurrent batches `[capture]`; no documented cap found `[unconfirmed]`.
- OpenRouter side: `BATCH_MAX_REQUESTS` / body size limits in `packages/batch` apply first `[code]`.

## 7. Expiry and retention

- Processing window: 24 h from creation. `expires_at = created_at + 24h` exactly in every capture (e.g. `2026-09-02T20:08:22Z` → `2026-09-03T20:08:22Z`) `[capture]`; requests still processing at that point become `expired` (official docs: https://platform.claude.com/docs/en/build-with-claude/batch-processing).
- Results retention: results are available for 29 days after batch creation (official docs: same page). `archived_at` is the field that flips when results are archived; it was `null` on every batch `[capture]` (official docs: https://platform.claude.com/docs/en/api/retrieving-message-batches).
- Input retention: the batch object does not expose the inputs; they are not separately retrievable (no input endpoint) `[capture]`. General data retention policy: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention (official docs).
- Job record: the batch object remains listable/retrievable after `ended` (list showed 7 ended/in-progress batches) `[capture]`; deletion is explicit via `DELETE /v1/messages/batches/{id}` and only allowed once ended `[capture]` `[docs]` (https://platform.claude.com/docs/en/api/deleting-message-batches).
- Clock start: `created_at` (server time on create), `ended_at` set at terminal, `cancel_initiated_at` at cancel `[capture]`.
- Read after expiry: not tested (needs a 29-day wait) `[unconfirmed]`.
- Finalization implications `[code]`: with `BatchResultMode.BatchId` the finalize path can re-fetch results any time within the 29-day window using only `upstream_batch_id`; the OpenRouter sweeper must finalize before day 29 or the results are gone. The adapter deletes ended batches through `nativeDeletion.deleteBatch` (`DELETE /v1/messages/batches/:id`); batches the caller does not delete accumulate upstream until Anthropic archives them.

## 8. Pricing

- Batch price = 50% of the model's standard input and output price (official docs: https://platform.claude.com/docs/en/about-claude/pricing; https://platform.claude.com/docs/en/build-with-claude/batch-processing). OpenRouter's `anthropic/claude-haiku-4.5:batch` endpoint row advertises `$0.5 / $2.5` per M tokens vs `$1 / $5` on the sync row `[capture]` (`GET /api/v1/models/anthropic/claude-haiku-4.5:batch/endpoints`).
- Per-line usage lives only on `succeeded` rows (`usage` object) `[capture]`. `errored`, `canceled`, `expired` rows carry no usage and are not charged (official docs: https://platform.claude.com/docs/en/build-with-claude/batch-processing).
- Cache tokens: `cache_read_input_tokens` and `cache_creation_input_tokens` are present on batch usage `[capture]`; the batch discount stacks with the prompt-cache read/write multipliers (official docs: https://platform.claude.com/docs/en/build-with-claude/prompt-caching and https://platform.claude.com/docs/en/about-claude/pricing). Two lines in one native batch sharing a 17,508-token `cache_control` prefix did hit the cache: one row `cache_creation_input_tokens: 17508`, the other `cache_read_input_tokens: 17508` `[capture]`. The same pair through OpenRouter `/v1/messages` (27,312-token prefix) produced one write row and one read row; through `/v1/chat/completions` both rows were reads (`cached_tokens: 27312, cache_write_tokens: 0`) because the prefix had already been written by the concurrent messages batch `[capture]`.
- Web search: one `web_search_20250305` line produced `server_tool_use.web_search_requests: 1` natively and through OpenRouter `[capture]`; the search is priced at $10 per 1,000 searches on top of tokens (official docs: https://platform.claude.com/docs/en/about-claude/pricing). OpenRouter billed it at the endpoint row's `web_search: 0.01` — the finalized cost `0.04587` = `13333 × 2.5e-6 + 203 × 1.25e-5 + 1 × 0.01` exactly `[capture]`. Whether Anthropic discounts the search fee in batch is not stated on the pricing page `[unconfirmed]`; OpenRouter charges full price.
- No authoritative per-line cost is returned; cost must be reconciled independently from usage × batch price. OpenRouter does this via `parseAnthropicBatchUsage` → `toAccountingUsage` (`prompt_tokens = input + cache_read + cache_creation`, with `prompt_tokens_details.{cached_tokens, cache_write_tokens}` carried separately) and `calculateUpstreamInferenceCost` (`services/batch-api/src/finalize/emit-batch-generations.ts`) against the `:batch` endpoint pricing row `[code]`.
- **Cache-write tokens are billed at the plain prompt price, not `input_cache_write`** (BUG, D5). `calculateUpstreamInferenceCost` adjusts `cached_tokens` to `input_cache_read` but has no term for `cache_write_tokens`. Measured: the OpenRouter `/v1/messages` feature batch finalized at `0.0847755`, while usage × the endpoint row's prices (`prompt 2.5e-6, completion 1.25e-5, cache read 2.5e-7, cache write 3.125e-6`) gives `0.1018455`; the gap `0.017070 = 27312 × (3.125e-6 − 2.5e-6)` is exactly the cache-write premium on the one write row `[capture]`. The sync path prices writes through `AnthropicSKU.CacheWrite5mTokens` / `CacheWrite1hTokens` (`packages/pricing/strategies/anthropic/strategy.ts`) `[code]`.

## 9. Sync-transform overrides

The sync adapter (`packages/router/adapters/anthropic-message/`) is reused wholesale: batch lowering calls `serializeAnthropicMessagesRequest` with a context built by `buildAnthropicMessagesSerializeContext` from the `:batch` endpoint row `[code]`. Behaviors that therefore apply identically:

- tool-calling params (`tools`, `tool_choice`, `disable_parallel_tool_use`), structured outputs via `output_config`, `cache_control` placement, thinking (`getThinkingParams`: an explicit budget becomes `thinking: {type: 'enabled', budget_tokens}` unless the endpoint row says `supports_reasoning_max_tokens: false` and the model supports adaptive thinking, in which case `resolveBudgetThinking` downgrades it to `{type: 'adaptive'}`; `effectiveMaxTokens` bumped to `budget_tokens + 1` when needed), sampling-knob gating by `supported_parameters`, `stop_sequences`, `metadata.user_id` (hashed), `context_management`, `speed`.
- Observed consequence of the thinking downgrade `[capture]`: the same `/v1/messages` line with `thinking: {type: "enabled", budget_tokens: 1024}` on `claude-opus-5` is an `errored` row natively (`invalid_request_error: "thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort"`) but succeeds through OpenRouter (`[thinking, text]`, `thinking_tokens 10`). Batch inherits the sync path's permissiveness; a customer porting a working OpenRouter batch line to the native API will hit this error. Opus 5 also emits a `thinking` block on lines that request no thinking (adaptive default; `structured` 54 thinking tokens natively, 52–54 through OpenRouter; `truncation` at `max_tokens: 5` spends all 5 on thinking on both paths).
- `stream` is set from `ctx.isStreaming` — batch builds the context with streaming off, matching the native rule that `stream=True` is rejected per line `[capture]`.

Batch-specific deltas `[code]`:

- No beta headers are sent (§1). The sync adapter derives/forwards `interleaved-thinking-2025-05-14` and several request-feature betas from headers or body; in batch those features silently fall back to non-beta behavior. Live: thinking, tools, `output_config`, web search and `cache_control` all worked without betas `[capture]`, so only interleaved-thinking and the newer Fable-era betas are affected `[unconfirmed]` for batch.
- `restoreNativeWebSearchTools` re-attaches `web_search_20250305` server tools that the skin normalized away, so `/v1/messages` lines keep native search `[code]`.
- Passthrough server tools such as `web_fetch_20250910` keep their native `type` but the skin adds an internal `_requestedType` marker. The Message Batches API rejects the marker on every row: `tools.0.web_fetch_20250910._requestedType: Extra inputs are not permitted` (`batch-1789719807-HzJEhYhEReOdRbBH07Jb`, 2 / 2 rows failed, sync accepted the same tool) `[capture]`. `stripRequestedTypeMarkers` removes the marker before lowering `[code]`. Whether Anthropic executes `web_fetch` inside a batch is `[unconfirmed]` until a row succeeds after the fix.
- Response side: `toAnthropicInternalResponse` (`to-internal-response.ts`) replays a native message through the internal event stream; the `/v1/messages` skin then re-renders it. Documented losses in `packages/batch/skins/anthropic-messages/index.ts`: `citations` are emptied, cache-token detail is not preserved in the rendered body, thinking/redacted-thinking block structure is normalized, multimodal response blocks are normalized `[code]`. Observed through OpenRouter `[capture]`: the `/v1/messages` web-search row was served as a single `text` block (no `server_tool_use` / `web_search_tool_result` blocks, no citations) although `usage.server_tool_use.web_search_requests: 1` was preserved; the served `id` is rewritten to `msg_<batch-id>:<custom_id>` and `usage.service_tier: "batch"` is kept. Chat rows are served in the OpenAI-compatible shape (`choices[].message.tool_calls`, `reasoning`, `reasoning_details`, `prompt_tokens_details.cached_tokens` / `cache_write_tokens`, `completion_tokens_details.reasoning_tokens`). The raw native row is what is billed (`parseUsage` reads the artifact line), so these losses affect serving only.
- `betas: ["interleaved-thinking-2025-05-14"]` in a `/v1/messages` batch line was accepted by the skin and the line completed (thinking block present, Opus 5) `[capture]`; whether the beta actually reached Anthropic cannot be seen from the result `[unconfirmed]`.

## 10. OpenRouter mapping decision

Already shipped; recorded here as the contract `[code]`:

- **Skins:** both `/v1/messages` (`AnthropicMessagesBatchSkinContract`) and `/v1/chat/completions` (chat skin) are supported; no new skin.
- **Adapter:** `AnthropicBatchAdapter` extends `BaseBatchAdapter` with `ingestMode = BatchIngestMode.Inline`, `resultMode = BatchResultMode.BatchId`.
- `submitNativeBatch` → `submitAnthropicBatch` streams the `{requests:[{custom_id, params}]}` body; `upstream_batch_id = id`.
- `pollBatch` → `pollAnthropicBatch`: `status` per §4 table, `request_counts` per `toGenericRequestCounts`, `failure_reason` never set, `output_file_id = null`, `error_file_id = null`.
- `fetchNativeResults` → `downloadAnthropicBatchResults` streams `GET …/{upstream_batch_id}/results`.
- `transformBatchResponse` → `transformAnthropicBatchResponse` normalizes native rows to canonical lines (§5 table) before billing and serving.
- `parseResult` → `parseAnthropicBatchResult` (canonical line → `{status_code, body}`), `parseUsage` → `parseAnthropicBatchUsage` (`succeeded` body → `toAccountingUsage`).
- **Fixture plan:** `packages/batch/adapters/anthropic/fixtures.ts` holds redacted create/poll/results shapes with Zod shape guards in the adjacent tests. No fixture changes in this backfill — every load-bearing shape observed live parsed under the existing schemas (the `details` object and `workerreq_` request ids are absorbed by `.passthrough()`/`nullish`).

## 11. OpenRouter endpoint intersection

- Public catalog (`GET /api/v1/models/user` with the batch test key) lists twelve `anthropic/*:batch` slugs: `claude-fable-5.1`, `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, `claude-opus-4.8`, `claude-opus-4.7`, `claude-sonnet-4.6`, `claude-opus-4.6`, `claude-opus-4.5`, `claude-haiku-4.5`, `claude-sonnet-4.5`, `claude-opus-4.1`, all provider `Anthropic` `[capture]`. `anthropic/claude-haiku-4.5:batch` advertises `$0.5 / $2.5` per M (vs `$1 / $5` sync) and `anthropic/claude-opus-5:batch` `$2.5 / $12.5` per M with `input_cache_read 0.25`, `input_cache_write 3.125`, `input_cache_write_1h 5`, `web_search 0.01` per request `[capture]`.
- Cheapest batch-enabled Anthropic model by catalog price: `anthropic/claude-haiku-4.5`. **Not submittable on 2026-09-02** (next bullet); the cheapest slug that the resolver accepted was `anthropic/claude-opus-5`, so every OpenRouter capture in this note ran on Opus 5 at batch price.
- Provider pin: `{"provider":{"only":["Anthropic"]}}` at the submit body top level (`BatchProviderPreferencesSchema` accepts only `only`) `[code]`. A mismatched pin returns 404 `Model 'anthropic/claude-opus-5' does not have an eligible :batch endpoint matching provider.only: amazon-bedrock.` `[capture]`. Datadog `batch_api.batch_accepted` carried `provider_name: Anthropic` and `model: anthropic/claude-opus-5-20260723` for every accepted job `[capture]`.
- **Resolver gap (2026-09-02, D1):** `POST /api/beta/batches` returned 400 `Model '<slug>' does not have a :batch endpoint.` for `anthropic/claude-haiku-4.5`, `anthropic/claude-haiku-4.5:batch`, `anthropic/claude-sonnet-4.5`, `anthropic/claude-sonnet-4.6` and `anthropic/claude-sonnet-5` (all listed in the catalog with a `:batch` row), and for `anthropic/claude-3.5-haiku` / `anthropic/claude-3.7-sonnet` (not listed, expected). `anthropic/claude-opus-5` was accepted (202) with the same key and body shape. Datadog `batch_api.resolve_endpoint.no_batch_endpoint` events for the `anthropic/claude-3.5-haiku` and `anthropic/claude-3.7-sonnet` probes carried `had_grants: true, model_variant_found: true` `[capture]`; the events for the four catalog-listed slugs fell outside the retrieved window and were not correlated `[unconfirmed]`. The remaining seven listed slugs were not probed (cost). The rejection happens in the resolver before any adapter code runs, so this is a batch-api resolver/endpoint-cache finding, not an Anthropic adapter finding `[code]`.
- Minimal live batch: 1 line, `/v1/messages`, `anthropic/claude-opus-5`, `max_tokens: 5`, `provider.only: ["Anthropic"]` → 202, `completed` in ~3 min, `usage.cost` present `[capture]`. Switch to `anthropic/claude-haiku-4.5` once D1 is resolved.
- Read-after-accept: `GET /api/beta/batches/{id}` issued in the same second as the 202 returned 404 `Batch job <id> not found.`; the same id resolved on the next poll ~3 min later `[capture]`. The pending job record is emitted through Pub/Sub (`submitAsyncJob`, `submit-batch.ts`) rather than written synchronously, so a client polling immediately after create sees a transient 404 `[code]`. Not Anthropic-specific; recorded as D7.
- Public cancel: `POST /api/beta/batches/{id}/cancel` returned a bare `404 Not Found` for a live job and for a nonexistent id `[capture]`; there is no cancel route in `packages/batch/routes/` or `services/batch-api/src/routes/batches.ts` and no adapter cancel hook `[code]`. Native cancellation (§4) is therefore unreachable through OpenRouter today.
- Exclusions: Bedrock/Vertex/Azure Anthropic rows are sync-only; the `:batch` variant exists only for provider `Anthropic` `[capture]`.

## 12. Credential shape

- Platform key: `sk-ant-api03-…` (the repo's secret matcher expects `sk-ant-(api03|admin01)-[A-Za-z0-9_-]{93,}AA`, `packages/guardrails/use-cases/apply-content-filter/anthropic-api-key-matcher.ts`) `[code]`. The executor validates only non-emptiness (`apiKeyAdapterEntry`, `z.string().min(1)`) and lets the upstream 401 surface `[code]`.
- BYOK: `services/batch-api/src/adapters/api-key-providers.ts` registers Anthropic as an API-key provider, so a customer's stored Anthropic key is resolved by `resolveLifecycleAdapter` for submit/poll/finalize (`services/batch-api/src/finalize/resolve-finalize-adapter.ts`) `[code]`. Same header scheme and key format as platform. Not live-tested here `[unconfirmed]` (no BYOK account in the test environment).
- Artifact ownership: a batch is only retrievable with a key from the creating workspace `[capture]` (list scoped to the workspace). If a BYOK key is deleted mid-batch, `resolve-finalize-adapter.ts` fails the job explicitly (`failBatchJobForUnavailableKey`) because the upstream results are unreachable with the platform key `[code]`.

## 13. Artifact handles

- `pollBatch` returns `output_file_id: null` and `error_file_id: null` always; `resultMode = BatchId` tells the base adapter that both may stay null and results are fetched by `upstream_batch_id` `[code]`.
- **The batch id is the result handle.** `results_url` is `…/v1/messages/batches/{id}/results` — the adapter does not persist it and does not invent a file id `[code]` `[capture]`.
- Rediscovery: any poll of `GET /v1/messages/batches/{id}` yields the same handle; `GET …/batches` lists batches with `has_more`/`before_id`/`after_id` pagination for recovery when the id is lost (official docs: https://platform.claude.com/docs/en/api/listing-message-batches) `[capture]`.

## 14. Remote URL inputs

Native, batch context, `claude-haiku-4-5` `[capture]`:

| Block | Field shape | Result |
| --- | --- | --- |
| Public PDF URL | `{"type":"document","source":{"type":"url","url":"https://assets.anthropic.com/…/Claude-3-Model-Card-October-Addendum.pdf"}}` | `succeeded`, `input_tokens: 32505`, model summarized the document |
| Public image URL (Wikimedia PNG) | `{"type":"image","source":{"type":"url","url":"https://upload.wikimedia.org/…/280px-PNG_transparency_demonstration_1.png"}}` | `errored` `invalid_request_error: Unable to download the file. Please verify the URL and try again.` (`request_id: workerreq_…`) |
| Unreachable image URL | same, `https://example.invalid/…png` | `errored`, same message |
| Non-image URL (`https://www.example.com/`) | `image` block | `errored` `messages.0.content.0.image.source.base64.data: The file format is invalid or unsupported` — the fetched HTML was validated as image bytes |

- Field names and schemes: `source.type: "url"` with an `https://` URL for both `image` (official docs: https://platform.claude.com/docs/en/build-with-claude/vision) and `document` (official docs: https://platform.claude.com/docs/en/build-with-claude/pdf-support) blocks; `source.type: "file"` + `file_id` for Files-API uploads (official docs: https://platform.claude.com/docs/en/build-with-claude/files).
- Provider fetch behavior: fetch happens at execution time inside the batch; a failed fetch is a per-line `errored` row (not a batch failure, not a create-time 400), and the other lines in the same batch still succeed `[capture]`. The Wikimedia failure is most plausibly Wikimedia's bot/user-agent policy rejecting Anthropic's fetcher `[unconfirmed]` — the Anthropic-hosted PDF over the same mechanism succeeded.
- **OpenRouter answer:** `batchAdapterSupportsImageUrls` is `true` (`packages/batch/adapters/image-url-support.ts`) and `batchAdapterSupportsFileUrls` returns `true` for `AnthropicBatchAdapter` (`packages/batch/adapters/file-url-support.ts`) `[code]`, and both are live-confirmed through OpenRouter on Opus 5 `[capture]`:

  | OpenRouter line | Result |
  | --- | --- |
  | chat `image_url` → GitHub-hosted PNG (`https://raw.githubusercontent.com/github/explore/main/topics/python/python.png`) | `completed`, 200 row, `"The Python programming language logo."`, `cost 0.0004825` |
  | messages `image` `source.type: url`, same PNG | `completed`, 200 row, `cost 0.00047` |
  | chat `image_url` → Wikimedia PNG | `completed` with `failed: 1`; row `error.type: invalid_request_error`, `Unable to download the file. Please verify the URL and try again.`; batch `error.message: All 1 request(s) in this batch failed upstream…`; `cost 0` |
  | messages `image` → Wikimedia PNG | same as above |
  | chat `file` part `{"file":{"filename":"addendum.pdf","file_data":"https://assets.anthropic.com/…pdf"}}` | `completed`, 200 row, title extracted, `cost 0.092095` |
  | messages `document` `source.type: url`, same PDF | `completed`, 200 row, `cost 0.092095` |
  | chat `image_url` with a `data:image/png;base64,…` URL | terminal `failed` before upstream submit: `Batch request 'image_b64' contains unsupported 'image_url' content. Only public http(s) image URLs are supported in batch; base64/data-URI images, audio, video, and file content parts are rejected.` (`assertSupportedBatchContent`, `packages/batch/schemas/assert-supported-batch-content.ts`) |

  The content guard admits text, public http(s) `image_url` parts and URL-only `file` parts (`file_data` holding an http(s) URL, no `file_id`) and rejects everything else; the "text-only" description of the Batch API in the task brief is out of date for this adapter `[code]` `[capture]`. The guard runs in the async submit worker, so the rejection surfaces as a terminal `failed` job with `error.message` on GET, not as a synchronous 4xx `[capture]`.
- Fetchability caveat: the Wikimedia PNG failed identically natively and through OpenRouter (`Unable to download the file.`), an unresolvable host failed with the same message, a non-image URL (`https://www.example.com/`) failed with `The file format is invalid or unsupported`, while the GitHub-hosted PNG and the Anthropic-hosted PDF succeeded `[capture]`. A URL that works in a browser is not guaranteed to work in a batch line; the per-line 400 is the correct surface (D2).
- `/v1/messages` vs translated chat: `/v1/messages` lines carry native `image`/`document` URL blocks verbatim; `/v1/chat/completions` lines carry `image_url` / `file` parts that the serializer converts to the same native blocks `[code]`. Both produced identical outcomes and costs for the same URL `[capture]`.

## Divergences found between adapter and observed/documented behavior

Every native shape observed parsed under the adapter's schemas and the status/error mappings match the docs. The items below are the findings that block or qualify the verdict; D1, D5, D6, D7 and D8 are OpenRouter-side.

### D1. Batch resolver rejects catalog-listed Anthropic `:batch` slugs (BUG, high — needs a human)

- **Severity:** high. **Customer impact:** `anthropic/claude-haiku-4.5`, `claude-sonnet-4.5`, `claude-sonnet-4.6` and `claude-sonnet-5` batch submissions are rejected with 400 even though the catalog advertises the `:batch` variant at batch price; only `anthropic/claude-opus-5` (of the five probed) is submittable.
- **Smallest repro:** `POST https://openrouter.ai/api/beta/batches` `{"endpoint":"/v1/messages","model":"anthropic/claude-haiku-4.5","provider":{"only":["Anthropic"]},"requests":[{"custom_id":"probe","body":{"max_tokens":5,"messages":[{"role":"user","content":"pong"}]}}]}` → `400 {"error":{"message":"Model 'anthropic/claude-haiku-4.5' does not have a :batch endpoint.","code":400}}`; replace the model with `anthropic/claude-opus-5` → 202 `[capture 2026-09-02 20:16–20:34 UTC]`. `GET /api/v1/models/anthropic/claude-haiku-4.5:batch/endpoints` with the same key returns the Anthropic batch row.
- **Official doc:** n/a (OpenRouter-side).
- **Code:** `services/batch-api/src/routing/batch-model-resolution.ts` (`resolveTopBatchEndpoint` → `noBatchEndpointError`), `services/batch-api/src/submit/accept/resolve-batch-submit-target.ts`.
- **Sync comparison:** sync `anthropic/claude-haiku-4.5` resolves normally.
- **Evidence:** `batch_api.batch_accepted` with `provider_name: Anthropic` exists only for the Opus 5 jobs in the dogfood evidence table; Datadog `service:batch-api* "batch_api.resolve_endpoint.no_batch_endpoint"` carries `requested_model`, `had_grants`, `model_variant_found` per rejection (the events for the four listed slugs were not correlated in this session's query window).
- **Smallest safe fix:** operational first — diff the batch-api endpoint cache against the catalog for the four failing slugs (missing `pricing_json` force-disable per `packages/batch/AGENTS.md`, `EndpointVisibility`, or a stale KV warm); if the resolver and catalog disagree by design, the catalog must not list the variant. **Regression test:** an e2e probe that submits one line per catalog-listed `anthropic/*:batch` slug and asserts `batch_api.batch_accepted`.

### D2. Native remote image URLs are fetch-dependent (documentation nuance, not an adapter bug)

- Adapter flags say image/file URLs are supported and that is correct natively and through OpenRouter (§14). A URL Anthropic's fetcher cannot download becomes a per-line `errored` row with `invalid_request_error`, mapped to a 400 line `[capture]`; the batch itself is `completed`. Record in the endpoint docs that fetchability by Anthropic's downloader is the customer's responsibility; no code change.

### D3. Batch is stricter than sync on `max_tokens: 0`

- Sync `/v1/messages` returned 200/empty for `max_tokens: 0`; batch returned an `errored` row `[capture]`. OpenRouter rejects `max_tokens < 1` itself (`Batch request 'x' sets 'max_tokens' below 1; each batched request must allow at least 1 output token.`, terminal `failed`) `[capture]`, so this is unreachable — noted so nobody "fixes" the serializer to pass through zero.

### D4. Beta headers are not sent in batch (COVERAGE GAP, low)

- `anthropic-fetch.ts` sends only `x-api-key`/`anthropic-version`; the sync adapter forwards `interleaved-thinking-2025-05-14` and derives request-feature betas. Every feature exercised live worked without betas `[capture]`, and a `/v1/messages` line with `betas: ["interleaved-thinking-2025-05-14"]` completed through OpenRouter, but whether the beta reached Anthropic is not observable from the result `[unconfirmed]`. Smallest fix if needed: thread the derived beta header list from the serializer context into `submitAnthropicBatch` headers; regression test: snapshot the create-call headers for a thinking+tools line.

### D5. Cache-write tokens billed at the prompt price (BUG, medium — fixed on `main` after this capture)

- **Severity:** medium (under-billing; OpenRouter paid Anthropic the cache-write premium and did not recover it). **Customer impact:** none visible; customers were under-charged by `(input_cache_write − prompt) × cache_write_tokens` per line (25% of the write tokens' base price for 5 m caches, 100% for 1 h caches).
- **Smallest repro:** one `/v1/messages` batch line with a ≥ 1,024-token system prompt carrying `cache_control: {type: "ephemeral"}` on a model whose `:batch` row has `input_cache_write`; compare `finalized_cost` in `batch_api.finalize.completed` with `usage × pricing`. Measured on `batch-1788381296-gQ1xZuwhPlv5JLrdaJqK`: finalized `0.0847755`, expected `0.1018455`, gap `0.017070 = 27312 × 6.25e-7` `[capture]`.
- **Official doc:** cache write is priced at 1.25× (5 m) / 2× (1 h) base input, and the batch discount applies on top (https://platform.claude.com/docs/en/build-with-claude/prompt-caching, https://platform.claude.com/docs/en/about-claude/pricing).
- **Code at capture:** `services/batch-api/src/finalize/emit-batch-generations.ts` `calculateUpstreamInferenceCost` had a `cached_tokens` adjustment against `pricing.input_cache_read` but no `cache_write_tokens` term, although `toAccountingUsage` (`packages/batch/adapters/anthropic/to-internal-response.ts`) supplies `prompt_tokens_details.cache_write_tokens`.
- **Sync comparison:** `packages/pricing/strategies/anthropic/strategy.ts` bills `AnthropicSKU.CacheWrite5mTokens` / `CacheWrite1hTokens` at `input_cache_write` / `input_cache_write_1h`.
- **Status:** fixed on `main` by #29633 (`fix(batch): bill Anthropic batch cache writes at TTL cache-write rates`, merged 2026-09-03, `984cc9ba53e`) with its own unit and finalize tests; the capture above predates the merge and is the pre-fix baseline. **Remaining verification:** re-run the `cache_a`/`cache_b` pair through `/v1/messages` on current `main` and assert `finalized_cost = 0.1018455` for the same usage.

### D6. No public cancel route (EXPECTED LIMITATION)

- `POST /api/beta/batches/{id}/cancel` → bare `404 Not Found` `[capture]`; no route exists (`packages/batch/routes/`, `services/batch-api/src/routes/batches.ts`) and `BaseBatchAdapter` has no cancel hook `[code]`. Native cancel works (§4) and the adapter already maps `canceling`/all-`canceled` correctly, so the smallest change to close the gap is a cancel route + adapter hook calling `POST /v1/messages/batches/{id}/cancel` and letting the sweeper observe `Cancelling` → `Cancelled`. Until then, customers cannot stop a queued Anthropic batch and are billed for whatever completes. Native delete is supported through `nativeDeletion.deleteBatch` (`DELETE /v1/messages/batches/:id`); cancel is not part of it.

### D7. Transient 404 on GET immediately after 202 (COVERAGE GAP, low, all providers)

- `GET /api/beta/batches/{id}` in the same second as the create returned `404 Batch job <id> not found.`; the job was visible ~3 min later `[capture]`. The pending record is emitted asynchronously (`submitAsyncJob` in `services/batch-api/src/submit/accept/submit-batch.ts`) `[code]`. `projects/docs/batch-quickstart.mdx` does not mention the window. Smallest fix: document "poll may return 404 for a few seconds after create; retry" in the quickstart, or have GET return 202/`validating` for ids that match the accept-time id format within a grace window. Regression test: e2e create → immediate GET asserting either 200 or a documented retryable status.

### D8. Parallel tool calls: one structured call + leaked markup on OpenRouter (COVERAGE GAP, cause open)

- Same model, same `params`: native `claude-opus-5` returned `[text "I'll get both for you in parallel.", tool_use get_weather, tool_use get_time]` with `stop_reason: tool_use` (1/1 run); both OpenRouter families returned the same text prefix with the `get_weather` call as literal `antml:invoke name="get_weather">…` markup inside the `text`/`content` string and only `get_time` as a structured call (2/2 runs) `[capture]`. `input_tokens` is 465 on all three rows, so the lowered prompt is token-identical. Haiku 4.5 natively also returned two `tool_use` blocks `[capture]`.
- Attribution: the markup is upstream model output (nothing under `packages/` emits `antml`) `[code]`, and the adapter passes `tool_use` blocks through unchanged (`to-internal-response.ts`) `[code]`, so the response path is exonerated. Open: whether a non-token difference in the lowered request (sampling params, `tool_choice.disable_parallel_tool_use`, headers) raises the malformed-call rate, or 2/2 vs 0/1 is sampling variance `[unconfirmed]`.
- Customer impact if systematic: one of two parallel calls is lost and raw markup is served to the user. Next measurement: capture the lowered body with `services/fake-provider` (U8 below) and diff against the native request; then 5 native + 5 OpenRouter reruns. Regression test regardless of outcome: a fixture row with two `tool_use` blocks through `transformBatchResponse` and both skins asserting both calls survive.

## Capture-matrix coverage

| Row | Native | OpenRouter (Opus 5) |
| --- | --- | --- |
| discovery (list, endpoints) | `[capture]` | `[capture]` catalog + `/endpoints`; four listed slugs unsubmittable (D1) |
| inline create; in-progress → ended | `[capture]` | `[capture]` 202 `validating` → `completed`, 3–7 min |
| output download; error rows inline | `[capture]` | `[capture]` inline `results[]` on GET |
| retention fields | `[capture]` | `completion_window: 24h`, `expires_at` on GET `[capture]` |
| text / tools / forced tool / multi-system / multi-turn / thinking / structured / truncation / cache pair | `[capture]` Haiku 10/10 `succeeded`; Opus 5 (same model as OpenRouter) 9/10, `thinking.type: enabled` `errored` (§9) | `[capture]` 10/10 on both `/v1/chat/completions` and `/v1/messages`; parallel tool calls see D8 |
| exact serialized upstream request | n/a | not observable from production; `[code]` sync serializer (U8 below) |
| public image URL / public PDF URL | `[capture]` (§14) | `[capture]` both succeed on fetchable URLs (§14) |
| OpenRouter base64 image rejection | n/a | `[capture]` terminal `failed` with content-guard message |
| native web search | `[capture]` | `[capture]` `/v1/messages`; `web` plugin and `web_search_options` rejected on chat |
| job failure (all-errored) | `[capture]` | `[capture]` `completed` + `failed: 1` + batch `error.message` |
| cancellation | `[capture]` `canceling` → `ended`, results readable | no public route (D6) |
| expiration | `[docs]` only | `[docs]` only |
| partial success (4+1) | `[capture]` | `[capture]` both families, `cost 0.00032`, failed row `id: anthropic-<custom_id>` |
| bad auth / malformed JSON / dup id / missing id / empty requests | `[capture]` | `[capture]` 401 / 400 / 422 / 400 / 400 |
| unsupported model / endpoint | `[capture]` deferred `errored` row (`claude-does-not-exist-9`; also the dated `claude-opus-5-20260723` on the platform key, while `claude-opus-5` works) | `[capture]` 400 at create |
| over-limit (`max_tokens`) | `[capture]` | `max_tokens: 0` → terminal `failed` `[capture]` |
| cancel race | `[capture]` (cancel at t+0.2 s: 3/3 canceled) | not reachable (D6) |
| rate limit (429) | not hit; headers `[capture]` | not hit |
| Datadog accept → finalize → emit_generations | n/a | `[capture]` every accepted job, `unaccounted: 0` (table below) |

## Dogfood evidence (2026-09-02)

Parity run per `.agents/skills/batch-adapter-dogfooding/SKILL.md`. Direct side: `claude-haiku-4-5` for lifecycle and error-shape captures, `claude-opus-5` (the model OpenRouter ran on) for every model-dependent row, so no verdict compares output across models. Windows: native 20:08–20:48 and 21:29–21:57 UTC, OpenRouter 20:16–20:50 UTC. Spend ≈ $0.25 native, ≈ $0.44 OpenRouter (Σ `finalized_cost`). Rows not listed here are PASS with the evidence already given in §4–§14.

### Per-job Datadog evidence

Query `service:batch-api* @data.jsonPayload.extra.job_id:<id>` (`https://us5.datadoghq.com/logs?query=service%3Abatch-api*%20%40data.jsonPayload.extra.job_id%3A<id>`; the REST API at `api.us5.datadoghq.com` was used because the `datadog` MCP exposed no log search). Every accepted job: `batch_accepted{provider_name: Anthropic, model: anthropic/claude-opus-5-20260723}` → `batch_submitted_upstream{upstream_batch_id: msgbatch_…}` → `finalize.completed{async_job_status: completed, is_usage_complete: true}` → `emit_generations.done{estimated 0, failed 0, unaccounted 0}`; no `emit_generation.missing_usage` or `fallback_usage_estimated`. Sweep/poll events carry no `job_id`. Guard-rejected jobs show `submit_job.failed` + `permanent_failure_recorded` and no upstream submit or finalize.

| Case | Job id | Lines | `finalized_cost` | succeeded / failed → emitted / skipped |
| --- | --- | --- | --- | --- |
| chat features (text, tools auto/forced/parallel, structured, reasoning, truncation, multi-turn, multi-system, `cache_a`/`cache_b`) | `batch-1788381295-s6Wz3I0t01xL3aRV1XiG` | 10 | 0.023136 = Σ usage × row price exactly (cache reads only: `cached_tokens 27312`, `cache_write_tokens 0`) | 10 / 0 → 10 / 0 |
| messages features (same ten lines) | `batch-1788381296-gQ1xZuwhPlv5JLrdaJqK` | 10 | 0.0847755 vs 0.1018455 expected (D5) | 10 / 0 → 10 / 0 |
| chat / messages mixed 4 + 1 (`bad-tool-choice`) | `batch-1788381297-fjFUSfpmMAONhJczmba6` / `batch-1788381297-w4rqw2mHvlB0tOdz664s` | 5 | 0.00032 each = 4 × (17 × 2.5e-6 + 3 × 1.25e-5) | 4 / 1 → 4 / 1 |
| cancel attempt; ran to completion (D6) | `batch-1788381304-ncGr6kQ3gQwEOZSfiXSQ` | 3 | 0.015135 — billed for a batch the caller tried to cancel | 3 / 0 → 3 / 0 |
| GitHub PNG, chat / messages | `batch-1788381758-HXRD06QF82fKlCHafaJj` / `batch-1788381761-tGaQJmuIxtkPmtqU1f9r` | 1 | 0.0004825 / 0.00047 | 1 / 0 → 1 / 0 |
| Wikimedia PNG, chat / messages (D2) | `batch-1788381300-XMSlqMROCfaV8ejlybMs` / `batch-1788381301-HFxSS3JyjyNZyohpRpJB` | 1 | 0 | 0 / 1 → 0 / 1 |
| PDF URL, chat / messages | `batch-1788381301-HNCUHYOubQd0A16qTaaQ` / `batch-1788381302-tH1b86c2T3dcDwH3WS1h` | 1 | 0.092095 each = 36573 × 2.5e-6 + 53 × 1.25e-5 | 1 / 0 → 1 / 0 |
| native web search, messages | `batch-1788381302-vDYFmbV25GHp5zNV13RU` | 1 | 0.04587 = 13333 × 2.5e-6 + 203 × 1.25e-5 + 1 × 0.01 (`web_search` row price) | 1 / 0 → 1 / 0 |
| all lines fail upstream (`bad-role`) | `batch-1788381293-YOhVIMzdez2KQmWi3iWq` | 1 | 0 | 0 / 1 → 0 / 1 |
| messages line with `betas: ["interleaved-thinking-2025-05-14"]` (D4) | `batch-1788381294-w6ZekrPTPS389tkodiDX` | 1 | 0.000795 | 1 / 0 → 1 / 0 |
| guard-rejected: base64 image, `max_tokens: 0`, `stream: true`, `plugins: [{id: "web"}]`, `web_search_options` | `batch-1788381300-fjLVsjyYhLWUsSaCYdFs`, `batch-1788381293-WiqUyESe4a1z31z9azWA`, `batch-1788381291-kRYZocpclCrDO5imgc8s`, `batch-1788381303-rKr4sDFnCVzUrmEGsfI4`, `batch-1788381304-LKyt3At6qUntpHEsNu2q` | 1 | — | terminal `failed`, no finalize |

### OpenRouter-side strings a test writer needs `[capture]`

- Create-time: 401 `{"error":{"message":"User not found.","code":401}}`; 400 `expected object key or end of object` (malformed JSON, stream parser); 400 `custom_id: Invalid input: expected string`; 400 `requests must contain at least one item.`; 422 `Request at line 2 has a duplicate custom_id 'dup'…`; 422 `Request at line 1 has an invalid custom_id 'bad id'; this provider's custom_id may only contain characters in [A-Za-z0-9_-].` and `…this provider caps custom_id at 64 characters.` (`BatchCustomIdValidator` + `ANTHROPIC_CUSTOM_ID_CONSTRAINTS`, before any upstream call); `/v1/embeddings` on an Anthropic slug → 400 `…does not output embeddings…`.
- Terminal `failed` `error.message` (async guard, surfaced on GET): `Batch requests do not support stream: true.`; `…sets 'max_tokens' below 1…` (D3); `…'web' plugin, which is not supported. OpenRouter-orchestrated web search is not yet supported on the Batch API…` (same family for `web_search_options`; the native `web_search_20250305` tool is the supported path).
- All-failed batch: `completed`, `error.message: All 1 request(s) in this batch failed upstream; inspect each result's error field.`; row `error.message: messages: at least one message is required`.
- Failed row shape: `{"id":"anthropic-bad-tool-choice","custom_id":"bad-tool-choice","response":null,"error":{"type":"invalid_request_error","message":"Tool 'does_not_exist' not found in provided tools","param":null}}` — `id` is `<provider>-<custom_id>`, no usage.

### Provider quirks not stated elsewhere `[capture]`

- Opus 5 `tool_use` blocks carry `caller: {"type": "direct"}`; the adapter's passthrough schema absorbs it and served `/v1/messages` rows echo it.
- Opus 5 thinks without a `thinking` param: the structured-output line returned `[thinking, text]` (`thinking_tokens 54`), and a `max_tokens` truncation returned `[thinking]` only (`stop_reason: max_tokens`; chat: `finish_reason: length`, empty content, `reasoning_tokens 5`).
- Reasoning-token counts match native row-for-row on the same line (`truncation` 5 native / 5 chat / 5 messages; `structured` 54 / 54 / 52).
- Cache hit inside one submission: `cache_b` wrote 27312 (`cache_creation.ephemeral_5m_input_tokens`) and `cache_a` read 27312 in the same batch, natively and through OpenRouter; the chat job submitted seconds later read the prefix on both rows (`cache_write_tokens 0`), so a cache-write billing test must run the writer first or use a fresh prefix.
- Per-line OpenRouter guards (`stream`, `max_tokens < 1`, content) fail the whole job with one `error.message`; native semantic validation is deferred to a per-line `errored` row. Duplicate and malformed `custom_id`s are the exception: synchronous 422 at create.
- Native `claude-opus-5-20260723` (the dated id in OpenRouter's `:batch` slug) is `not_found_error` on the platform key for all lines while `claude-opus-5` works; the id OpenRouter sends upstream is not observable from outside (U8).

### Untested — prerequisite → next measurement

- U1 24 h expiry / 29 d retention (https://platform.claude.com/docs/en/build-with-claude/batch-processing): a batch that outlives 24 h plus wall clock → `GET …/results` for `msgbatch_01WuZSLQZPH9VpBo5VLsABNB` on 2026-10-01 (expect 200) and 2026-10-02 (expect 404).
- U2 web search + function tools in one line; U3 `$defs`/`$ref` schemas and structured output + tools: skipped for cost → assert both tool families appear, and that `params.output_config.format.schema` keeps `$defs` verbatim.
- U4 BYOK: a workspace with a stored Anthropic key → repeat the features batch, assert `finalized_cost` goes through the BYOK path in `services/batch-api/src/finalize/resolve-finalize-adapter.ts`.
- U5 failure injection (submit 5xx, poll timeout, results 404, malformed row, finalize replay): local stack + `services/fake-provider` → assert journals fence duplicates and `unaccounted == 0`.
- U6 late cancel race: D6 closed on OpenRouter; natively cancel at t+20 s on 5 lines → `succeeded + canceled == 5`, results readable.
- U7 429: a key at the queue cap (100,000 requests / 256 MB, https://platform.claude.com/docs/en/api/rate-limits) → a retryable submit failure, not a terminal `failed` job.
- U8 exact upstream body: fake-provider capture → diff `params` against the native request. C2 (`max_tokens` over the ceiling through OpenRouter) → pin with a fixture row and a `transformBatchResponse` test.

### Verdict

**NOT SAFE** on the 2026-09-02 evidence. D1 blocks the cheapest catalog-listed Anthropic batch slugs, and D5 was a live billing defect at capture time (fixed on `main` by #29633 afterwards, not yet re-measured). Lifecycle PASS evidence — accept → upstream submit → poll → inline results → finalize → generation emission on both endpoint families, including partial and all-failed batches, image/PDF URLs and native web search — exists only for `anthropic/claude-opus-5`. Re-run the matrix on `anthropic/claude-haiku-4.5` once D1 is resolved and re-measure the cache-write row before upgrading the verdict.
