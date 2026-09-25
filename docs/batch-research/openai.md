# OpenAI Batch API — research note

Backfill output of `research-batch-provider` for OpenAI, the provider the
`OpenAIBatchAdapter` (`packages/batch/adapters/openai/`) was built around.
Live captures were taken on 2026-09-02 against `https://api.openai.com`
with the platform development credential (Infisical `/services/batch-api`),
against OpenRouter's public Batch API (`POST /api/beta/batches`) with the
Batch API test key, and against Datadog (`service:batch-api*`). Raw
transcripts live in `/tmp/batch-research/openai/` on the capture machine and
are not committed. Provider-generated batch, file, request, and organization
identifiers are redacted below.

Every claim is labeled `live capture` (observed on 2026-09-02),
`official docs` (with the URL), or `unconfirmed`.

## Official sources

Overview and lifecycle:

- Batch guide (overview, lifecycle, status table, rate limits, expiry,
  retention): https://developers.openai.com/api/docs/guides/batch
- Batch API reference (object shape, status enum, `request_counts`,
  `errors`): https://platform.openai.com/docs/api-reference/batch
- Create batch: https://platform.openai.com/docs/api-reference/batch/create
- Retrieve batch: https://platform.openai.com/docs/api-reference/batch/retrieve
- List batches: https://platform.openai.com/docs/api-reference/batch/list
- Cancel batch: https://platform.openai.com/docs/api-reference/batch/cancel
- Batch request input line: https://platform.openai.com/docs/api-reference/batch/request-input
- Batch request output line: https://platform.openai.com/docs/api-reference/batch/request-output
- Batch object (status enum page): https://platform.openai.com/docs/api-reference/batch/object

Files (input upload and result download):

- Files API reference: https://platform.openai.com/docs/api-reference/files
- Upload file: https://platform.openai.com/docs/api-reference/files/create
- Retrieve file metadata: https://platform.openai.com/docs/api-reference/files/retrieve
- Retrieve file content (results): https://platform.openai.com/docs/api-reference/files/retrieve-contents
- File object (`expires_at`, `purpose`): https://platform.openai.com/docs/api-reference/files/object

Pricing, limits, retention:

- API pricing (per-model token prices, "Batch API" 50% discount, tool
  pricing): https://developers.openai.com/api/docs/pricing
- Product pricing landing page (requested reference, not used for
  per-token numbers because it renders ChatGPT plan pricing, not API token
  pricing): https://openai.com/api/pricing/
- Rate limits and per-batch limits: https://developers.openai.com/api/docs/guides/batch#rate-limits
- Batch expiration: https://developers.openai.com/api/docs/guides/batch#batch-expiration
- Output retention (30-day auto-delete): https://developers.openai.com/api/docs/guides/batch#5-retrieving-the-results
- `output_expires_after` on create: https://platform.openai.com/docs/api-reference/batch/create#batch_create-output_expires_after

Sync endpoint references used for the per-family body shapes:

- Chat Completions: https://platform.openai.com/docs/api-reference/chat
- Responses: https://platform.openai.com/docs/api-reference/responses
- Embeddings: https://platform.openai.com/docs/api-reference/embeddings

The guide pages were fetched on 2026-09-02 and quoted from the fetched
copy. Where a page section anchor is cited, the claim is in that section
of the fetched page.

## 1. Auth

- Bearer token in `Authorization: Bearer <key>` on every call (official
  docs: https://platform.openai.com/docs/api-reference/authentication).
  live capture: a bogus key returns HTTP 401 with `error.type =
  "invalid_request_error"` and `error.code = "invalid_api_key"`.
- No project or organization header is required for the platform key; the
  adapter sends none (`packages/batch/adapters/openai/batch-poller.ts`
  builds only `Authorization`, plus `x-platform-user-id` for managed
  first-party keys). live capture: all lifecycle calls succeeded with the
  bearer header alone.
- Platform credential: `OPENAI_API_KEY` resolved by
  `services/batch-api/src/adapters/api-key-providers.ts`. BYOK: same
  header shape with the customer's key, see section 12.

## 2. Endpoints

All paths are relative to `https://api.openai.com`.

| Operation | Endpoint | Provenance |
| --- | --- | --- |
| Upload input | `POST /v1/files` (multipart, `purpose=batch`) | live capture, official docs: https://platform.openai.com/docs/api-reference/files/create |
| Create | `POST /v1/batches` `{input_file_id, endpoint, completion_window, metadata?, output_expires_after?}` | live capture, official docs: https://platform.openai.com/docs/api-reference/batch/create |
| Retrieve | `GET /v1/batches/{batch_id}` | live capture, official docs: https://platform.openai.com/docs/api-reference/batch/retrieve |
| List | `GET /v1/batches?limit=&after=` | live capture, official docs: https://platform.openai.com/docs/api-reference/batch/list |
| Cancel | `POST /v1/batches/{batch_id}/cancel` | live capture, official docs: https://platform.openai.com/docs/api-reference/batch/cancel |
| Result metadata | `GET /v1/files/{file_id}` | live capture, official docs: https://platform.openai.com/docs/api-reference/files/retrieve |
| Result content | `GET /v1/files/{file_id}/content` (JSONL) | live capture, official docs: https://platform.openai.com/docs/api-reference/files/retrieve-contents |

Batch `endpoint` values accepted at create time (official docs:
https://platform.openai.com/docs/api-reference/batch/create): `/v1/responses`,
`/v1/chat/completions`, `/v1/embeddings`, `/v1/completions`,
`/v1/moderations`, `/v1/images/generations`, `/v1/images/edits`,
`/v1/videos`. `completion_window` accepts only `24h` (official docs, same
page: "Currently only `24h` is supported"). live capture: `24h` echoed
back on every created batch.

The adapter uses exactly the first three endpoint values and the file
lifecycle above (`file-uploader.ts` → `batch-submitter.ts` →
`batch-poller.ts` → `file-downloader.ts`). live capture: the adapter's
request shapes (multipart upload with `purpose=batch`, JSON create with
`completion_window: "24h"`) were replayed by hand and accepted.

`GET /v1/batches/{unknown}` returns HTTP 404 with `error = {message: "No
batch found with id '...'", type: "invalid_request_error", param: null,
code: null}` (live capture).

## 3. Native request-line shape

Input is JSONL, one object per line, with `custom_id`, `method`, `url`, and
`body` (official docs: https://platform.openai.com/docs/api-reference/batch/request-input).
`url` must match the batch `endpoint` for every line and every line must
carry the same `model` (official docs, same page and
https://developers.openai.com/api/docs/guides/batch#1-prepare-your-batch-file).
live capture: a mismatched `url` on line 2 failed the whole batch with
`invalid_url`, a different `model` on line 2 failed it with
`mismatched_model` (section 4).

### 3a. `/v1/chat/completions`

```json
{"custom_id":"request-1","method":"POST","url":"/v1/chat/completions","body":{"model":"gpt-4.1-nano","messages":[{"role":"user","content":"Reply pong."}],"max_tokens":16}}
```

live capture: `custom_id` may contain spaces, unicode, and punctuation and
is echoed byte-for-byte in the output row (a 100+ character id with `—`,
`ü`, `/` round-tripped). `stream: true` is rejected at validation
(`streaming_unsupported`, `param: "body.stream"`, section 4). `n`,
`temperature`, `tools`, `tool_choice`, `parallel_tool_calls`,
`response_format` with `json_schema` (including `$defs` and local
`$ref`), `reasoning_effort`, `max_completion_tokens`, and `image_url` /
`file` content parts were all accepted into the batch and executed per
line (results in section 5).

### 3b. `/v1/responses`

Same envelope with `"url":"/v1/responses"` and a Responses request body
(`model`, `input`, `instructions`, `tools`, `text.format`, `reasoning`,
`max_output_tokens`, `include`). live capture: `input` as a string or as an
array of `message` / `function_call_output` items, `tools` of type
`function` and `web_search_preview`, `text.format` `json_schema`,
`reasoning: {effort, summary}`, and `input_image` / `input_file` parts
were all admitted and executed per line.

### 3c. `/v1/embeddings`

```json
{"custom_id":"e-1","method":"POST","url":"/v1/embeddings","body":{"model":"text-embedding-3-small","input":"pong","encoding_format":"float"}}
```

live capture: 5 lines, all `completed`. `/v1/embeddings` batches are
additionally capped at 50,000 embedding inputs across all requests
(official docs: https://developers.openai.com/api/docs/guides/batch#rate-limits).

## 4. Exhaustive upstream status model

Status enum (official docs, status table:
https://developers.openai.com/api/docs/guides/batch#4-checking-the-status-of-a-batch
and https://platform.openai.com/docs/api-reference/batch/object):

| Status | Official description | Terminal | live capture |
| --- | --- | --- | --- |
| `validating` | input file is being validated | no | yes, first poll after create |
| `failed` | input file failed validation | yes | yes, 12 distinct causes below |
| `in_progress` | validated and running | no | yes |
| `finalizing` | completed, results being prepared | no | no (polls jumped from `in_progress` to `completed`, the window is short) |
| `completed` | results are ready | yes | yes |
| `expired` | not completed within the 24-hour window | yes | no (docs only, not reproducible cheaply) |
| `cancelling` | being cancelled, may take up to 10 minutes | no | yes, immediately after `POST .../cancel` |
| `cancelled` | cancelled | yes | yes, within a few minutes of `cancelling` |

`request_counts` is `{total, completed, failed}` (official docs:
https://platform.openai.com/docs/api-reference/batch/object). live capture:

- `validating` and `failed`: `{0, 0, 0}`.
- `in_progress`: `total` set, `completed` and `failed` climb monotonically
  in every poll observed (not proven monotonic, three polls per job).
- `completed`: `completed + failed == total` on every completed job (7 jobs,
  including 3 mixed jobs).
- `cancelling`: `{5, 1, 0}` at the moment of cancel, `cancelled`:
  `{5, 0, 0}` with an `error_file_id` present and no `output_file_id`. The
  one line counted `completed` during `cancelling` was not present in any
  result file after `cancelled`, so the counters are not stable across the
  cancel transition (live capture, one job, see divergences).

`errors` is `null` on every non-`failed` status (live capture) and on
`failed` is `{object: "list", data: [{code, message, param, line}]}`
(official docs: https://platform.openai.com/docs/api-reference/batch/object).
Observed create-time validation failures (live capture, each a whole-batch
`failed` with `request_counts = {0,0,0}` and no result files):

| `code` | `param` | `line` | Trigger |
| --- | --- | --- | --- |
| `invalid_json_line` | `null` | 2 | unparseable JSONL line |
| `duplicate_custom_id` | `custom_id` | 2 | repeated `custom_id` |
| `missing_required_parameter` | `custom_id` | 2 | line without `custom_id` |
| `mismatched_model` | `body.model` | 2 | second model in one batch |
| `invalid_url` | `url` | 2 | `url` differs from batch `endpoint` |
| `model_not_found` | `body.model` | 1 | unknown model |
| `invalid_request` | `body.model` | 1 | missing `model` |
| `streaming_unsupported` | `body.stream` | 5 | `stream: true` on a chat line |
| `invalid_request` | `file_id` | `null` | nonexistent `input_file_id` |
| `invalid_request` | `file_id` | `null` | file uploaded with a non-`batch` purpose |

Validation stops at the first bad line: a file with one bad line among
good ones produced exactly one `errors.data` entry and executed nothing
(live capture, `streaming_unsupported` on line 5 of 5).

Per-line (not batch-level) failures do not change the batch status: a
batch with 8 good and 2 bad lines reached `completed` with
`request_counts = {10, 8, 2}` (live capture, section 5).

## 5. Output/error shapes

Two files. `output_file_id` holds one row per line that returned an HTTP
2xx, `error_file_id` holds one row per line that did not (official docs:
https://developers.openai.com/api/docs/guides/batch#5-retrieving-the-results
and https://platform.openai.com/docs/api-reference/batch/request-output).
Either handle is `null` when that file would be empty (live capture: an
all-success job has `error_file_id: null`, an all-failed-lines job has
`output_file_id: null` and status `completed`, a cancelled job has only
`error_file_id`).

Output order is not guaranteed to match input order, `custom_id` is the
correlation key (official docs:
https://developers.openai.com/api/docs/guides/batch#5-retrieving-the-results).
live capture: rows came back in input order on every job, which is not
evidence of a guarantee.

Row envelope (official docs:
https://platform.openai.com/docs/api-reference/batch/request-output):

```json
{"id":"batch_req_<redacted>","custom_id":"request-1","response":{"status_code":200,"request_id":"<redacted>","body":{}},"error":null}
```

live capture for each family:

- Chat Completions success: `response.body` is a `chat.completion` object
  with `choices[].message.{content,tool_calls,refusal}`, `finish_reason`
  (`stop`, `length`, `tool_calls` all observed), `usage.prompt_tokens`,
  `usage.completion_tokens`, `usage.prompt_tokens_details.cached_tokens`,
  `usage.completion_tokens_details.reasoning_tokens`. When output is
  truncated by `max_completion_tokens` on a reasoning model, `content` is
  `""` (empty string, not `null`) and `finish_reason` is `length`.
- Responses success: `response.body` is a `response` object with `status`
  (`completed` and `incomplete` observed), `incomplete_details.reason`
  (`max_output_tokens` observed), `output[]` items of type `reasoning`,
  `message`, `function_call` (no `web_search_call` item was visible on
  either side in the 200-token `web_search_preview` capture, native
  `output` held only `reasoning` at `status: incomplete`, rerun with
  `max_output_tokens >= 1000` to compare item shapes),
  `usage.input_tokens`, `usage.output_tokens`,
  `usage.input_tokens_details.cached_tokens`,
  `usage.output_tokens_details.reasoning_tokens`. Reasoning items appear
  before `message` / `function_call` items in `output`.
- Embeddings success: `response.body` is `{object: "list", data: [{object:
  "embedding", index, embedding: number[]}], model, usage: {prompt_tokens,
  total_tokens}}`.
- Per-line HTTP failure (output-file row, not error-file row): the row
  lands in `error_file_id` with `response.status_code: 400`,
  `response.body.error = {message, type, param, code}` and top-level
  `error: null`. Observed messages: `Invalid 'temperature': decimal above
  maximum value...`, `Error while downloading file. Upstream status code:
  400.` (unreachable image URL), `Invalid file data: ... Expected a
  base64-encoded data URL with an application/pdf MIME type` (chat `file`
  part with a remote URL), `You uploaded an unsupported image.` (malformed
  data URI), `No tool call found for function call output with call_id
  ...` (dangling `function_call_output`).
- Not-executed failure (cancel): the error-file row has `response: null`
  and `error = {code: "batch_cancelled", message: "This request was not
  executed because the batch was cancelled."}`. The documented `expired`
  shape is identical with `code: "batch_expired"` (official docs:
  https://developers.openai.com/api/docs/guides/batch#batch-expiration,
  unconfirmed live).

Completion and failure questions:

- Does terminal status mean every sub-request is complete? `completed`:
  yes, `completed + failed == total` and every line has a row in one of
  the two files (live capture, 7 jobs). `cancelled`: no, unexecuted lines
  get `batch_cancelled` rows and executed lines may be dropped (live
  capture, one job, see section 4). `expired`: no, unfinished lines get
  `batch_expired` rows and finished lines are in the output file (official
  docs: https://developers.openai.com/api/docs/guides/batch#batch-expiration).
  `failed`: nothing executed, no files (live capture, 12 jobs).
- Are results readable on failed, cancelled, or expired jobs? `failed`: no
  files exist. `cancelled`: the error file is readable (live capture).
  `expired`: the output file is readable and contains completed responses
  (official docs, same anchor). Read-back on `cancelled` and `expired`
  therefore requires a poller that does not require `output_file_id`.
- Where do failed lines live? Always `error_file_id`, never the output
  file, for both HTTP-level and not-executed failures (live capture and
  official docs: https://platform.openai.com/docs/api-reference/batch/request-output).
- Do failed lines carry `custom_id`? Yes, every error-file row observed
  carried the input `custom_id` (live capture, 9 rows across 6 jobs).
- Do failed lines carry usage? No. HTTP-4xx rows have
  `response.body.error` and no `usage`, not-executed rows have
  `response: null` (live capture).
- Are failed lines charged? Not observable from the API. The batch-level
  `usage` object on a completed job summed only the successful rows'
  tokens (live capture: an all-failed 1-line job reports
  `usage.total_tokens: 0`). Official docs state completed requests in an
  expired batch are charged (https://developers.openai.com/api/docs/guides/batch#batch-expiration)
  and are silent about charging for 4xx rows. unconfirmed against the
  billing dashboard.
- Batch-level `usage` (live capture, not in the fetched reference page):
  the Batch object carries `usage: {input_tokens, output_tokens,
  total_tokens, input_tokens_details: {cached_tokens},
  output_tokens_details: {reasoning_tokens}}` regardless of endpoint
  family, and it equals the sum of the per-row usages on every completed
  job checked. The adapter ignores it and bills per row, which is the
  correct choice because it survives partial success.

## 6. Limits

All official docs, https://developers.openai.com/api/docs/guides/batch#rate-limits
unless noted:

- 50,000 requests and 200 MB per input file.
- `/v1/embeddings` batches: 50,000 embedding inputs across all requests.
- 2,000 batch creations per hour.
- Per-model queued prompt token limits, set per organization on the
  Platform Settings limits page.
- No output-token limit ("The Batch API currently has no output-token
  limit").
- Batch rate limits are a separate pool from synchronous per-model limits.
- Exactly one model per batch (live capture, `mismatched_model`).

No limit was hit live: the largest batch created was 10 lines. HTTP 429
on create was not observed (unconfirmed shape). The adapter has no
client-side enforcement of the 50,000 / 200 MB limits, the service's own
submit limits (`batch_limits` LiveConfig) are lower.

## 7. Expiry/retention

- Completion window: 24 hours, the only accepted `completion_window`
  (official docs: https://platform.openai.com/docs/api-reference/batch/create).
  live capture: `expires_at - created_at == 86400` on every batch.
- Expired batches: unfinished requests are cancelled and written to the
  error file as `batch_expired`, finished responses are delivered in the
  output file and charged (official docs:
  https://developers.openai.com/api/docs/guides/batch#batch-expiration).
- Output file retention: deleted 30 days after the batch completes
  (official docs: https://developers.openai.com/api/docs/guides/batch#5-retrieving-the-results).
  `output_expires_after: {anchor: "created_at", seconds}` on create
  shortens this to between 1 hour and 30 days, anchored on the output
  file's creation time, not the batch's (official docs:
  https://platform.openai.com/docs/api-reference/batch/create#batch_create-output_expires_after).
  live capture: `GET /v1/files/{output_file_id}` returned
  `expires_at` = file `created_at` + 30 days on a batch created without
  `output_expires_after`.
- Input file retention: not stated on the batch pages. unconfirmed.
- Cancel latency: `cancelling` "may take up to 10 minutes" (official docs
  status table). live capture: under 3 minutes.

OpenRouter's own artifact bucket expires objects 30 days after creation
(`services/batch-api/CLAUDE.md`), which is at least as long as the
upstream retention, so finalization is bounded by the 24-hour window plus
sweep latency and never by upstream file expiry.

## 8. Pricing

Official docs: https://developers.openai.com/api/docs/pricing. The page
lists per-model standard prices and a "Batch API" tab at 50% of standard
input and output prices. Values read on 2026-09-02 (USD per 1M tokens,
batch tab):

| Model | Input | Output |
| --- | --- | --- |
| `gpt-5-nano` | 0.025 | 0.20 |
| `gpt-4.1-nano` | 0.05 | 0.20 |
| `gpt-4o-mini` | 0.075 | 0.30 |
| `o4-mini` | 0.55 | 2.20 |
| `text-embedding-3-small` | 0.02 | n/a |

Cached input tokens are billed at the model's cached-input rate on the
same page. Web search is billed per call (`$10.00 / 1k calls` for the
reasoning-model tier read on the page) plus search content tokens at model
rates (official docs, same page, "Built-in tools" section).

live capture (OpenRouter side, Datadog `batch_api.finalize.completed`):
`finalized_cost` matched `prompt_tokens * 0.025e-6 + completion_tokens *
0.20e-6` exactly on every `openai/gpt-5-nano` job without cached tokens
(for example `457 * 0.025e-6 + 2058 * 0.20e-6 = 0.000423025`), matched
`0.01 + tokens` on the web search job (one call at $10 / 1k), and on the
one job with cached prompt tokens (`cached_tokens: 2816` of 2899 on a
line) matched `(6049 - 2816) * 0.025e-6 + 2816 * 0.0025e-6 + 1297 *
0.20e-6 = 0.000347265`, so cached input is billed at 10% of the batch
input rate, consistent with the cached-input column on the pricing page.
Web search job `batch-1788380112-v1rl3GrMauvcLlvYxeDU`: `finalized_cost
0.01025815 = 0.01 + 8726 * 0.025e-6 + 200 * 0.20e-6`.

Billing invariants that held on all 15 finalized OpenAI-routed jobs (live
capture, Datadog `batch_api.emit_generations.done` and
`batch_api.finalize.completed`): `emitted + estimated + failed + skipped
== total_lines`, `unaccounted == 0`, `is_usage_complete: true`, no
`emit_generation.missing_usage`, no `fallback_usage_estimated`. Summed
`finalized_cost` was $0.0129, of which $0.01 was the one web search call.
An all-failed job (`batch-1788380104-tJvmoB5NnSQuYvjxXpnb`, unreachable
image URL) reports `finalized_cost 0`, emits `finalize.batch_level_failures`
and no `emit_generations.done`, and serves job-level `error.message: "All 1
request(s) in this batch failed upstream; inspect each result's error
field."`.

## 9. Sync-transform overrides

The sync OpenAI adapters (`packages/router/adapters/openai/` and
`packages/router/adapters/openai-responses/`) override request shape for
reasoning models (`max_tokens` → `max_completion_tokens`, `temperature`
dropped for `o*`/`gpt-5*`), for the Responses wire (`reasoning.summary`,
`include: ["reasoning.encrypted_content"]`, `store: false`), and for
model-specific quirks. The batch lowering reuses the sync path's pure
serializers (`packages/batch/adapters/openai/from-internal-request.ts`
→ `serializeOpenAiChatCompletionsRequest` /
`serializeOpenAiResponsesRequest` / `serializeOpenAiEmbeddingsRequest`),
so those overrides apply identically in batch (ECO-1670 invariant,
`packages/batch/CLAUDE.md`).

live capture (OpenRouter side): a `/v1/chat/completions` line for
`openai/gpt-5-nano` with `temperature: 5` was accepted and executed by
OpenAI through OpenRouter (`temperature` dropped for the reasoning model
by the sync serializer) while the same line sent natively failed with
`Invalid 'temperature'`. `max_tokens: 16` on a chat line was lowered to a
Responses-wire `max_output_tokens` and came back as `finish_reason:
"length"` with `completion_tokens: 0`.

Wire selection is model-based, not endpoint-based
(`lowersToResponsesWire`, `from-internal-request.ts:71`): models in
`OpenAIChatCompletionsModel` speak Chat Completions, everything else,
including `gpt-5-nano`, speaks the Responses wire regardless of whether
the client submitted `/v1/chat/completions` or `/v1/responses`. live
capture: every OpenRouter `openai/gpt-5-nano` chat result carried
`reasoning_details` of kind `reasoning.encrypted`, which only the
Responses wire produces.

## 10. OpenRouter mapping decision

`pollBatch` (`packages/batch/adapters/openai/batch-poller.ts`):

- `status` → passed through after Zod validation, unknown strings are a
  502. All eight documented statuses are already in
  `BATCH_UPSTREAM_STATUSES`, so the enum matches the official status page
  (section 4). `finalizing` and `cancelling` are non-terminal, the sweep
  keeps polling.
- `request_counts` → `{total, completed, failed}` mapped 1:1 to internal
  `total`, `completed`, `failed`. Correct for `completed` (live capture,
  counters are complete). For `cancelled` the counters are not stable
  (section 4), the service must derive `failed` from result rows rather
  than trust `request_counts.failed = 0`.
- `failure_reason` → summarized from `errors.data[].{code, message, line}`
  on `failed` (live capture: single entry, matches the table in section 4).
- `output_file_id` / `error_file_id` → nullable pass-through. The adapter
  declares `BatchResultMode.FileHandle`, which requires at least one
  handle. live capture: `completed` always has at least one, `cancelled`
  has only `error_file_id`, `failed` has neither (correct, nothing to
  read).

`parseResult` (`output-parser.ts` → `parseOpenAIBatchResult`): detects
embeddings bodies and serves them verbatim, otherwise normalizes the row
into the canonical `{id, custom_id, response: {status_code, body}, error}`
shape and lets the completions family re-render it through the internal
stream. Error-file rows with `response.body.error` become a public
`error` object (live capture: `{type: "invalid_request_error", message,
param}` served on the mixed jobs). Rows with `response: null` and
`error.code = batch_cancelled | batch_expired` are the shape the adapter
must accept for cancelled and expired jobs (unconfirmed through
OpenRouter, the public API has no cancel route, section 11).

`parseUsage` (`parseOpenAIBatchUsage`): Responses wire → `input_tokens` /
`output_tokens` / `cached_tokens` / `reasoning_tokens`, Chat wire →
`prompt_tokens` / `completion_tokens` and details, embeddings →
`prompt_tokens` with `completion_tokens: 0`, web search calls counted from
`web_search_call` output items. Error-file rows have no usage and are
billed nothing (live capture: `emit_generations.done` reports
`total_lines = succeeded`, failed rows are excluded before emission, and
`finalized_cost = 0` on an all-failed job).

## 11. OpenRouter endpoint intersection

Native families `/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`
are all wired through the adapter. OpenRouter admission on 2026-09-02:

| OpenRouter endpoint | Result | Provenance |
| --- | --- | --- |
| `/v1/chat/completions` with `openai/gpt-5-nano` | accepted, routed to OpenAI | live capture |
| `/v1/responses` with `openai/gpt-5-nano` | accepted, routed to OpenAI | live capture |
| `/v1/messages` with `openai/gpt-5-nano` | accepted, routed to OpenAI, result served in Anthropic shape | live capture |
| `/v1/embeddings` with `openai/text-embedding-3-small` and `-3-large` | HTTP 400, no `:batch` endpoint | live capture |
| any endpoint with `openai/gpt-4.1-nano`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-3.5-turbo` | HTTP 400 `Model '<slug>' does not have a :batch endpoint.` | live capture |
| `openai/gpt-oss-20b` | accepted but routed to Together (`provider_name: "Together"` in Datadog), not OpenAI evidence | live capture |

Admission is per `:batch` endpoint row, so this table is a snapshot of the
endpoint catalog on the capture date, not an adapter property.

Public route surface: `POST /api/beta/batches`, `GET /api/beta/batches`,
`GET /api/beta/batches/:id`. There is no cancel route in
`services/batch-api/src/routes/batches.ts` (live capture: `POST
/api/beta/batches/:id/cancel` returned HTTP 404 `Not Found`). The
`cfw-batch-api` auth middleware comment reserves `/:id/cancel`, the route
is not implemented.

Content admission (live capture, enforced at submit validation before any
upstream call): public `http(s)` `image_url` parts are accepted and
executed (`r3-image-ok`, `provider_name: "OpenAI"`), data-URI images are
rejected with `contains unsupported 'image_url' content. Only public
http(s) image URLs are supported in batch; base64/data-URI images, audio,
video, and file content parts are rejected.`
(`batch-1788380973-eGpj66kKyCmlri6oq5cg`, HTTP 422), `input_audio` is
rejected with `contains unsupported 'input_audio' content. Batch does not
support this content; remove audio, video, file, or other non-text content
parts.` (`batch-1788380977-vMebuO2vI0DqOKSdjTUe`), `stream: true` is
rejected with `Batch requests do not support stream: true.` (job status
`failed`, `request_counts.failed = 1`,
`batch-1788380115-mvCKf2vxCOCQk57DvtfN`, Datadog `submit_job.failed reason
validation-failed status 400` then `submit_job.permanent_failure_recorded`,
nothing submitted upstream). A chat `file` part with a remote URL
(`batch-1788380105-qXCI4QlTx48HEPuXALQv`) and a Responses `input_file`
with `file_url` (`batch-1788380108-aOTW02H4rK3uphsp7o9u`) were accepted
and executed (both reached OpenAI and returned 200).

Request-body ordering: `endpoint` and `model` must precede `requests`,
otherwise HTTP 400 `endpoint and model are required and must appear before
requests in the request body` (live capture, stream-parsed body).
`provider.only: ["OpenAI"]` inside the per-line body pins routing, a
provider that does not serve the model returns HTTP 404 `does not have an
eligible :batch endpoint matching provider.only: <name>` at submit (live
capture). Duplicate `custom_id` → HTTP 422, missing `custom_id` → HTTP
400, invalid key → HTTP 401 `{"message":"User not found","code":401}`
(live capture). Routing proof per job is `provider_name` on the Datadog
`batch_api.batch_accepted` event (`service:batch-api*
@data.jsonPayload.extra.job_id:<job-id>` on https://us5.datadoghq.com/logs).
`openai/gpt-oss-20b` job `batch-1788381038-Ojd5kE1YMQW1UqaXpReN` routed to
Together and is not OpenAI evidence.

## 12. Platform and BYOK credential shape

- Platform: `OPENAI_API_KEY` from the batch-api secret set, sent as
  `Authorization: Bearer`. Managed first-party keys additionally send
  `x-platform-user-id` (`batch-poller.ts`, `batch-submitter.ts`). live
  capture: every OpenRouter job above reports `is_byok: false`.
- BYOK: the same bearer header with the customer key. `api-key-providers.ts`
  marks OpenAI as BYOK-capable. The files and batches created under a
  BYOK key live in the customer's OpenAI organization, so `input_file_id`,
  `output_file_id`, and the batch itself are only readable with that key.
  live capture (native): a file id from one organization referenced in a
  create call is rejected with `invalid_request` "Cannot find file ..., or
  organization <redacted> does not have access to it" (section 4). BYOK
  OpenAI batch through OpenRouter: UNTESTED. Prerequisite: confirm the
  `E2E_OPENAI_BYOK_API_KEY` workspace has batch access and a budget owner,
  then submit a 1-line chat job and check `is_byok: true` on the job and
  `provider_name: "OpenAI"` in Datadog.

## 13. Artifact handles

- Input: `input_file_id` (`file-…`) returned by `POST /v1/files`, echoed on
  the Batch object. Owned by the uploading organization.
- Output: `output_file_id` and `error_file_id` (`file-…`), nullable,
  populated at `completed` / `cancelled` (live capture) and `expired`
  (official docs). Read with `GET /v1/files/{id}/content`. Metadata via
  `GET /v1/files/{id}` includes `bytes`, `purpose: "batch_output"`,
  `created_at`, `expires_at` (live capture).
- Batch: `batch_…` id, listable with `GET /v1/batches` (live capture:
  `object: "list"`, `data[]`, `has_more`, `first_id`, `last_id`).
- Per-row: `id: batch_req_…` and `response.request_id` (live capture).
  Not persisted by the adapter, `custom_id` is the key.
- OpenRouter: `upstream_batch_id` is logged on
  `batch_api.batch_submitted_upstream` (live capture, 15 jobs), the
  public job id is `batch-<epoch>-<random>`.

## 14. Remote URL inputs

Native behavior (live capture, 2026-09-02):

| Input | Chat Completions | Responses |
| --- | --- | --- |
| Public `https` image URL (gstatic, github avatars) | HTTP 200, image described | HTTP 200, image described |
| Malformed base64 data URI image | HTTP 400 `You uploaded an unsupported image.` | HTTP 400 `The image data you provided does not represent a valid image.` |
| Public `https` PDF URL | HTTP 400 `Invalid file data ... Expected a base64-encoded data URL with an application/pdf MIME type` (`file.file_data`) | HTTP 200 with `input_file: {file_url}` (`The first word of the document is "Dummy."`) |
| Unreachable / non-image URL | HTTP 400 `Error while downloading file. Upstream status code: 400.` | same |

So OpenAI resolves remote image URLs on both wires and remote PDF URLs
only on the Responses wire via `input_file.file_url` (live capture). Valid
base64 data URIs were not tested (only malformed ones), so data-URI
support is unconfirmed by capture, official docs describe it for both
wires (https://platform.openai.com/docs/api-reference/chat/create, image
content part, and https://platform.openai.com/docs/api-reference/responses/create,
`input_image`).

Capability switches:

- `batchAdapterSupportsImageUrls` (`adapters/image-url-support.ts:16`):
  `{supported: true}` for OpenAI. Matches native behavior on both wires
  (live capture) and matches the OpenRouter admission of public image URLs
  (live capture `r3-image-ok`).
- `batchAdapterSupportsFileUrls` (`adapters/file-url-support.ts:21`):
  `lowersToResponsesWire(endpoint)`. Matches native behavior: file URLs
  work only on the Responses wire (live capture). Because `gpt-5-nano`
  lowers to the Responses wire even for `/v1/chat/completions` lines, a
  chat `file` part with a URL succeeds through OpenRouter (live capture
  `p-chat-file`, HTTP 200) while the same line fails natively on the Chat
  wire. That is a deliberate consequence of the wire selection, not a
  parity break.

## 15. Divergences found between adapter and observed/documented behavior

Listed by seam. "None" means the adapter's assumption was verified.

- Chat Completions input shape: none. Sync serializer output was accepted
  natively for every case in the matrix (live capture).
- Chat Completions result shape: minor. Native truncated reasoning-model
  rows carry `content: ""`, OpenRouter serves `content: null` for the same
  case (live capture `sys-dev`, `forced-tool`). Same information, client
  code comparing to `""` differs.
- Responses input shape: none (live capture).
- Responses result shape: **BUG**. Every `function_call` item in a
  Responses-wire result is dropped by the `/v1/responses` batch skin. The
  live capture happened to carry a `reasoning` item alongside the call,
  but the loss does not depend on it (offline check on 2026-09-04: the
  same body without `reasoning` renders `output: []`). Native:
  `output: [reasoning, function_call(get_weather, {"city":"Paris"})]`,
  `status: completed`. OpenRouter `/v1/responses` job
  `batch-1788380106-kCG5DHnJfa0GiYnYW4Jk`, line `r-tool`: `status:
  completed`, `output: [reasoning]`, `usage.output_tokens: 254` with
  `reasoning_tokens: 192` (62 non-reasoning output tokens billed, no
  visible item). The same request through `/v1/chat/completions` on the
  same model (same Responses wire upstream) served `tool_calls:
  [get_weather]` and `finish_reason: tool_calls`, so the loss is in the
  Responses skin render, not in the adapter or upstream. Reproduced
  offline at repo HEAD by feeding the native `r-tool` body through
  `openAiBatchResultToInternalResponse`
  (`packages/batch/adapters/openai/to-internal-response.ts:50`) and
  `OpenResponsesBatchSkinContract.fromInternalResponse`: the internal
  events contain the tool call (End-only event from `buildToolCallEvents`,
  `packages/batch/adapters/openai/responses-to-internal-response.ts:188`)
  and the reasoning, the rendered `output` contains only `reasoning`.
  Root cause: `renderNonStreamResponse`
  (`packages/router/skins/openai-responses/from-internal-stream/handler-generation.ts:700`)
  starts with an empty `toolIndexToOutputIndex`, only the tool Start
  handler populates it, the End handler returns early on a miss, and the
  batch adapter never emits a Start. Severity high: any `/v1/responses`
  batch with tools on a Responses-wire model (`gpt-5*`, `o*`, anything
  outside `OpenAIChatCompletionsModel`) gets `status: completed` with no
  function call, pays for it, and has no signal. Live repro: one
  `/v1/responses` line, `openai/gpt-5-nano`, one `function` tool
  `get_weather(city)`, `input: "What is the weather in Paris?"`,
  `max_output_tokens: 300`. The sync `/v1/responses` path receives Start +
  Delta + End and renders correctly, and
  `packages/batch/skins/openai-responses/parity.test.ts` only feeds Chat
  Completions wire bodies, so it cannot catch this. Smallest safe fix:
  emit Start + End per `function_call` item in the Responses batch adapter
  (keeps the skin untouched). Regression test: commit the redacted native
  `r-tool` body (Responses wire, `reasoning` + `function_call`) as a
  fixture and add a Responses-wire parity case asserting a `function_call`
  with the fixture's `name` and `arguments`, plus a variant without the
  `reasoning` item.
- Responses result ordering: minor. Native `output` lists `reasoning`
  before `message`, OpenRouter serves `message` before `reasoning` (live
  capture, every `/v1/responses` line with both items). Item order is not
  documented as significant. On the `web_search_preview` line OpenRouter
  served two `reasoning` items where native had one (live capture, one
  line).
- Embeddings input and result shapes: adapter path unverified through
  OpenRouter (no `:batch` endpoint row for `text-embedding-3-small` or
  `-3-large` on 2026-09-02). Native shapes match the verbatim skin's
  schema (live capture, 5 lines).
- File upload and download: none. Multipart `purpose=batch` upload,
  `/content` download, `batch_output` purpose on results (live capture).
- Output and error-file semantics: none. Error rows in `error_file_id`
  only, `custom_id` present, no usage (live capture).
- Partial success: none. `completed` with `request_counts.failed > 0`,
  OpenRouter serves the failed line as an `error` result and bills only
  the succeeded lines (`emit_generations.done total_lines = 9` for a
  10-line job with 1 failure, `finalize.completed total 10 succeeded 9
  failed 1`, live capture).
- Status lifecycle: none for the observed `validating` → `in_progress` →
  `completed` and for `failed` (live capture). `finalizing` was not observed
  on either side (section 4), so the poller's handling of it has no live
  evidence. `cancelled` and `expired` through OpenRouter: status
  transition UNTESTED, result read-back **BUG** (B2 below). Both are
  reachable in production (`expired` whenever an upstream batch outlives
  its 24-hour window, `cancelled` when a BYOK customer cancels the same
  batch in their own OpenAI organization) but neither was exercised in
  this run (no public cancel route, and the 24-hour window was not waited
  out). Reachability is only the status transition. Result read-back is a
  separate question, and it is a verified divergence, not an untested
  case: the finalizer
  (`resolveFinalizationArtifacts` in
  `services/batch-api/src/finalize/process-completed-batch.ts`) downloads
  and renders artifacts only for upstream `completed`, and emits
  `cancelled` and `expired` directly with no `output_gcs_uri` (unit tests
  `upstream expired` in `finalize-batch-job.test.ts` assert this). So the
  `batch_cancelled` / `batch_expired` error rows OpenAI does write, and the
  completed responses an `expired` output file carries, are never
  materialized or served, and the adapter's `response: null` handling has
  no production caller on these statuses. B2: native OpenAI exposes
  per-line outcomes on both statuses and charged, completed responses on
  `expired` (official docs, section 7); OpenRouter serves neither, so a
  customer whose batch expires pays OpenAI for completed rows and gets
  nothing back. Severity high, same class as B1 (paid results lost with no
  signal), lower frequency (only batches that outlive the 24-hour window
  or are cancelled upstream by a BYOK customer). Smallest safe fix and
  verification, in order: (1) a production change that materializes
  terminal artifacts for `cancelled` and `expired` (download whichever of
  `output_file_id` / `error_file_id` is present, render through the same
  path as `completed`, decide billing for `expired` completed rows), (2)
  a BYOK job submitted through OpenRouter and cancelled with the same key
  at OpenAI to exercise `cancelled`, and (3) an `expired` run, which needs
  the full 24-hour window. A BYOK submit-then-cancel run before (1) can
  confirm only that OpenRouter reaches `cancelled` cleanly.
- Request counters: one caveat. Native `request_counts` on a `cancelled`
  batch reset `completed` to 0 and left `failed` at 0 while 5
  `batch_cancelled` rows exist (live capture, one job). Any consumer that
  derives `failed` from `request_counts` on `cancelled` will undercount.
  The adapter passes counters through, the service's finalize derives
  totals from rows (Datadog `finalize.completed` `total/succeeded/failed`
  agreed with rows on every job), so no production impact today.
- Failure behavior: none. `errors.data[]` summarized into
  `failure_reason` matches the observed single-entry shape (live capture).
- Retention: none. 30-day upstream output retention equals the bucket TTL
  (official docs and `services/batch-api/CLAUDE.md`).
- Pricing: none. `finalized_cost` reconciled to the published batch rates
  on all 15 finalized jobs, including the cached-input discount and the
  per-call web search charge (section 8).
- Sync serializer and transform behavior: none. `temperature` dropped for
  reasoning models and `max_tokens` lowered identically to sync (live
  capture).
- OpenRouter endpoint intersection: catalog gap, not adapter. Cheap
  chat models named in the brief (`gpt-4.1-nano`, `gpt-4o-mini`) and both
  embedding models have no `:batch` row (live capture).
- Platform and BYOK credentials: platform verified (`is_byok: false`).
  BYOK unconfirmed.
- Result handles: none. `FileHandle` mode requirement (at least one
  handle) holds on `completed` and `cancelled` (live capture).
- Image URL behavior: none, `{supported: true}` verified natively on both
  wires and through OpenRouter (live capture).
- File/PDF URL behavior: none, `lowersToResponsesWire` gating verified
  natively (Chat wire rejects, Responses wire accepts) (live capture).
- Adapter seam mapping: `pollBatch` (status enum, counters, handles,
  `failure_reason`) verified for `completed` and `failed`, `parseResult`
  verified for chat and error rows, `parseUsage` verified by exact cost
  reconciliation on 15 jobs, `batchAdapterSupportsImageUrls` and
  `batchAdapterSupportsFileUrls` verified natively. Unverified in
  production: `cancelled` / `expired` row shapes, embeddings through
  OpenRouter, BYOK.

## 16. Dogfood verdict (2026-09-02)

**NOT SAFE**, two open BUGs: B1, `/v1/responses` batches with tools on
Responses-wire models lose every `function_call`; B2, `cancelled` and
`expired` batches are finalized without their result files, so completed
rows OpenAI charged for on `expired` are never served (section 15, status
lifecycle). Core lifecycle, partial success, and billing PASS on
`/v1/chat/completions` and on `/v1/responses` without tools, cost
reconciled exactly on 15 jobs. The verdict becomes SAFE WITH KNOWN LIMITS
once B1 and B2 are fixed and re-verified (B2 needs the terminal-artifact
materialization change plus a BYOK cancel run and an `expired` run).

COVERAGE GAP:

- B1 body (Responses wire, `reasoning` + `function_call`) has no committed
  fixture; the redacted native `r-tool` row is only in the capture
  transcripts. The B1 fix PR must capture it verbatim before those expire
  (regression recipe in section 15).
- Native cancel race, one sample: the line counted `completed` during
  `cancelling` was in neither result file after `cancelled` and
  `request_counts.completed` reset to 0 (section 4). Regression test: a
  `pollBatch` fixture for a `cancelled` batch with `error_file_id` only
  and `request_counts.completed 0`, asserting `FileHandle` mode accepts it
  and `parseResult` maps `batch_cancelled` rows to zero-usage errors.
- `finalizing` not observed on either side (section 4), the poller's
  handling of that status has no live evidence.

UNTESTED (prerequisite):

- `expired` shape (a production `expired` job, query
  `@data.jsonPayload.extra.upstream_status:expired`, or a fixture).
- HTTP 429 on create and the 50,000-line / 200 MB limits (budget).
- Embeddings through OpenRouter (a `:batch` row for an OpenAI embedding
  model, then check `finalized_cost = prompt_tokens * 0.02e-6`, the batch
  rate in section 8).
- BYOK (section 12). `/v1/responses` `input_image` through OpenRouter
  (one live line). Several tools with `tool_choice: auto` (budget only).
- Silent stall and deadline cleanup (a stalled or expired OpenRouter job).
- OpenRouter cancel (`POST /api/beta/batches/:id/cancel` is HTTP 404,
  `batch-1788380114-TFZUbmosHEN2FkalZ0Bj` ran to `completed`).
