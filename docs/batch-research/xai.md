# xAI Batch API — research note

Phase-1 output of `research-batch-provider` for provider `xai`
(slug `x-ai`). All live captures were taken 2026-08-28 against
`https://api.x.ai/v1` with the platform `X_AI_API_KEY` (Infisical
`/services/cfw-api`, env `dev`); raw transcripts lived in
`/tmp/batch-research/xai/` and the load-bearing shapes are quoted below
and committed in `packages/batch/adapters/xai/fixtures.ts` +
`packages/batch/adapters/xai/fixtures/`.

Primary docs:

- Guide: https://docs.x.ai/docs/guides/batch-api
  (also served at https://docs.x.ai/developers/advanced-api-usage/batch-api)
- REST reference: https://docs.x.ai/developers/rest-api-reference/inference/batches
- Pricing: https://docs.x.ai/developers/pricing (Batch API Pricing section)

## 1. Auth

- `Authorization: Bearer $XAI_API_KEY`, same key as sync inference (doc:
  guide, "Authentication"). No org/project pinning headers.
- Batches are team-scoped; `create_api_key_id` records the creating key.
- Bad key → HTTP **400** (not 401) with
  `{"code":"Client specified an invalid argument","error":"Incorrect API key provided. …"}`
  (live capture `02-bad-auth`).

## 2. Endpoints

Host `https://api.x.ai/v1`. The Batch API is part of the main xAI
inference REST API (not a separate product). A batch is a **container**
that can be filled two mutually exclusive ways:

| Operation | Endpoint | Notes |
| --- | --- | --- |
| Upload input file | `POST /v1/files` (multipart `file=`) | JSONL, purpose not required; response `{id: "file_…", object: "file", bytes, created_at, expires_at, filename, purpose}` (live `17-upload`) |
| Create batch | `POST /v1/batches` `{name, input_file_id?}` | With `input_file_id` → file-based, sealed. Without → inline mode |
| Add requests (inline only) | `POST /v1/batches/{id}/requests` `{batch_requests:[…]}` | Rejected with HTTP 412 on file-based batches: "Cannot add inline requests to a file-based batch" (live `19`) |
| Poll | `GET /v1/batches/{id}` | Returns state counters, no textual status (§4) |
| Request metadata | `GET /v1/batches/{id}/requests?limit&pagination_token` | Per-request `state`, max `limit` 1000 |
| Results | `GET /v1/batches/{id}/results?limit&pagination_token` | Paginated JSON, **not** a downloadable file. Results may be readable before the whole batch finishes (doc: guide) |
| Cancel | `POST /v1/batches/{id}:cancel` | Returns the batch object with `cancel_time` set |
| List | `GET /v1/batches?limit&pagination_token` | Team-wide |

There is **no error-file download**: per-request errors come back inline
in the results stream as `batch_result.error` strings.

## 3. Request-line shape

File-based JSONL lines are exactly the OpenAI batch input-line shape
(doc: guide, "Creating batches from a file"):

```json
{"custom_id": "chat-1", "method": "POST", "url": "/v1/chat/completions", "body": {"model": "grok-4.3", "messages": [...]}}
```

Supported `url` values include `/v1/chat/completions`, `/v1/responses`,
`/v1/images/generations|edits`, `/v1/videos/generations|edits|extensions`
(doc: guide). Live-verified for chat completions and responses.

**Live-verified quirk:** every text line — including `url:
"/v1/responses"` lines with Responses-native `input`, `reasoning`,
`text.format` and Responses-style tools — is internally converted to the
chat wire. Request metadata reports `endpoint:
"xai_api.Chat/GetCompletion"` and the result is always a
`chat_get_completion` (Chat Completions response) object (live `28`,
`31`, `32`). There is no Responses-shaped batch output.

Inline mode (`POST …/requests`) wraps the same chat body:

```json
{"batch_requests": [{"batch_request_id": "text-1", "batch_request": {"chat_get_completion": { …chat completions body… }}}]}
```

`batch_request_id` is optional; when omitted, xAI generates one of the
form `batch_request_<uuid>` (live `06` + `08`). It must be unique within
the batch: re-adding an existing id with different content → HTTP 412
`"batch_request_id 'text-1' content differs from originally submitted"`
(live `05`); identical re-adds are idempotent per docs.

This matches the existing `/v1/chat/completions` request-line skin — no
new skin needed (§10).

## 4. Status model

xAI batches have **no textual status field**. `GET /v1/batches/{id}`
returns aggregate counters plus cancellation/expiry fields (REST ref):

```json
{"batch_id": "batch_…", "name": "…", "create_time": "2026-08-28",
 "expire_time": "2026-09-27", "create_api_key_id": "…",
 "cancel_time": null, "cancel_by_xai_message": null,
 "state": {"num_requests": 8, "num_pending": 0, "num_success": 8,
           "num_error": 0, "num_cancelled": 0},
 "input_file_id": "file_…"}
```

`input_file_id` is present only on file-based batches. Derived mapping to
`UpstreamBatchStatus` — rows are evaluated top-down and the first match
wins, except `expired`, which is checked after the two cancellation rows
and before `validating`/`in_progress` (an expired batch that still shows
unfinished counters must not report as forever in-flight; a batch that xAI
cancelled at expiry keeps its cancellation row):

| Observation | Upstream status | Evidence |
| --- | --- | --- |
| `cancel_by_xai_message != null` (xAI cancelled it, e.g. JSONL validation failure) | `failed` | live `24`: malformed line → `cancel_time` set, `cancel_by_xai_message: "JSONL file validation failed: line 2: invalid JSON: …"`, all counters 0 |
| `cancel_time != null`, no xAI message | `cancelled` | live `15` |
| file-based and `num_requests == 0` (file still being ingested) | `validating` | live `18` (counters 0 right after create) vs `20` (populated) |
| `num_pending > 0` | `in_progress` | live `07` first poll: 8 pending |
| `num_pending == 0 && num_requests > 0` | `completed` | live `07` second poll: 8 success. Mixed `num_error`/`num_cancelled` > 0 is still `completed` (partial success lives per-line) |
| `expire_time` passed with unfinished work (`num_requests == 0` or `num_pending > 0`) | `expired` | not live-capturable (30-day window); doc: unfinished requests are cancelled at expiry |

Per-request states (`GET …/requests`):
`unknown | pending | succeeded | cancelled | failed` (REST ref; live saw
`succeeded` and, after batch cancel, `num_cancelled` incremented).

There is no `finalizing`/`cancelling` intermediate: cancel is immediate
and synchronous in observation (live `13`→`15`).

> **Corrected by A1 below — do not implement this table's cancellation
> mapping as written.** A later capture round observed the cancel counters
> revert: a cancelled batch read `num_cancelled: 5` and then, seconds later,
> `num_success: 5` with all five result rows readable. `cancel_time != null`
> is therefore not a durable terminal signal, and readable rows must outrank
> both cancellation and expiry. See §A1 and §A6 (tracked as ECO-3744).

## 5. Output / error shapes

`GET …/results` returns pages of:

```json
{"results": [{"batch_request_id": "text-1",
  "batch_result": {"response": {"chat_get_completion": { …chat.completion… }}}}],
 "pagination_token": "…" }
```

- Success: `batch_result.response.chat_get_completion` is a standard
  chat-completion body (`id`, `object: "chat.completion"`, `created`,
  `model`, `choices[].message{content, reasoning_content?, tool_calls?,
  refusal}`, `finish_reason`, `usage`, `system_fingerprint`,
  `service_tier`) — live `09`/`10`/`21`/`31`, committed fixtures.
- Native search (`tools: [{"type": "web_search"}]`, optionally `x_search`):
  the completion body is still `chat.completion`, but xAI flattens the whole
  server-side run into `choices` — an assistant turn carrying the
  `web_search`/`x_search` `tool_calls` with `finish_reason: ""`, one
  `role: "tool"` turn per executed call, then the assistant answer — plus a
  top-level `citations` array of bare URLs (no titles) and a
  `usage.cost_in_usd_ticks` that already includes the search fees. Only the
  final turn is servable; the intermediate turns are not chat-wire shaped.
  Live capture: `fixtures/live-web-search-results.json`
  (2026-08-31, `grok-4.3`, `fixtures/scripts/collect-xai-batch-web-search.ts`),
  which is what ECO-3670 fixed the parser against.
- Error: `batch_result` is `{"error": "<string>"}` — a bare string, no
  structured code (live `16`: `{"error": "Batch cancelled"}`). Mixed
  batches interleave both variants keyed by `batch_request_id`.
- Ordering: results are returned sorted by `batch_request_id`
  (lexicographic in live `09`+`10`), **not** submission order — doc
  explicitly says order is not guaranteed; correlate by id only.
- `custom_id` ↔ `batch_request_id`: file-mode `custom_id` comes back as
  `batch_request_id` verbatim (live `21`).
- Pagination: `limit` ≤ 1000; `pagination_token` null/empty on last page
  (live `09` with `limit=2` produced a token; `10` drained the rest).

## 6. Limits

- File-based: max 200 MB per file, 50 000 requests per file, 25 MB per
  request line (doc: guide).
- Inline: 2 batch creations/sec/team; 1000 add-request calls per 30 s
  (doc: guide). No documented per-call array cap; unverified.
- Batch requests do **not** count against per-minute inference rate
  limits (doc: guide + pricing).
- No rate-limit headers observed on 200s; over-limit behavior untested.
- Unsupported model → whole add-call/creation rejected HTTP 400
  `"Model <id> is not supported for batch processing."` (live `04a`,
  `26`). A file referencing an unsupported model fails file validation →
  batch cancelled by xAI (doc; same `cancel_by_xai_message` channel as
  malformed JSONL, live `24` shows the malformed case).

## 7. Expiry / retention

- Batch `expire_time` is 30 days after create (live: create 2026-08-28 →
  expire 2026-09-27). No selectable completion window — OpenRouter's
  `completion_window: "24h"` is our own contract; xAI merely targets
  "typically within 24 hours, best effort" (doc: guide).
- At expiry unfinished requests are cancelled; completed results remain
  retrievable via the results endpoint (doc: guide "Batch expiration").
- Uploaded files support an `expires_after` upload field from 3,600 to
  2,592,000 seconds. OpenRouter uses 2,592,000 seconds (30 days), matching
  the xAI batch expiry. The field must precede `file` in the multipart body.
  The original live capture omitted it and returned `expires_at: null`
  (live `17`).
- Image/video result URLs expire after 1 hour (doc: guide) — irrelevant
  for the text-only onboarding.

## 8. Pricing

- Batch discount **20% off** all token types, only for: `grok-4.3`,
  `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning`,
  `grok-4.20-multi-agent-0309` (doc: pricing "Batch API Pricing").
  Other models "have no batch discount" — and in practice are simply not
  batch-enabled for text (§11).
- Usage is reported per result line in `usage` (chat-completion shape,
  incl. `prompt_tokens_details.cached_tokens`,
  `completion_tokens_details.reasoning_tokens`) plus a batch-only
  `usage.cost_in_usd_ticks` field (live `21`/`31`; not in the sync
  schema). Inferred tick unit: 1e-10 USD — recomputing the grok-4.3
  batch price for live `21` f-resp-1 (198 prompt / 192 cached / 119
  completion+reasoning tokens) at 20% off standard rates reproduces
  2 747 200 ticks exactly at 1e-10 USD/tick. Finalization treats this
  provider-reported total as authoritative, using the same USD-tick
  conversion as sync xAI billing; token pricing remains the fallback when
  the field is absent.
- **Reasoning tokens are excluded from `completion_tokens`** on the batch
  wire (live `21`: `completion_tokens: 1` with
  `completion_tokens_details.reasoning_tokens: 118`; the tick recompute
  above only balances when reasoning tokens are charged at the completion
  rate). Billing must fold `reasoning_tokens` into the billable completion
  count — the adapter's `parseUsage` does this — or reasoning-heavy Grok
  responses are underbilled by orders of magnitude.
- File storage $0.025/GiB/day, file downloads $0.20/GiB (doc: pricing).
  The 30-day upload expiry bounds storage cost if terminal cleanup does not
  run.
- Priority processing is explicitly unsupported for batch (doc: pricing).

## 9. Sync-transform overrides

The live xAI sync adapter `InternalStreamXAIResponsesAdapter`
(`packages/router/adapters/x-ai-responses/internal-stream.ts`) extends
the OpenAI Responses adapter and **overrides `transformRequest`** (and
`getProviderModelId`, reasoning-effort gating): grok-4.20 model-id
mapping by `reasoning.enabled`, `x_search` tool injection +
web-search domain filters, `top_k`/`min_p`, `top_logprobs` clamp 0–8 with
forced `logprobs: true`, `text` param suppression unless
`response_format` was explicitly requested.

Per the factory doc comment
(`services/batch-api/src/adapters/adapter-factory.ts`), reusing
`OpenAIBatchAdapter` is therefore **forbidden** — xAI needs its own batch
adapter whose lowering goes through the xAI Responses serializer
(extracted from the sync adapter, ECO-1670 parity).

## 10. OpenRouter mapping decision

- **Skin:** reuse the existing `/v1/chat/completions` skin
  (`BatchEndpointFamily.Completions`). No new skin: clients submit chat
  completions lines, and xAI's output is chat-completion shaped.
- **Adapter:** new `XAIBatchAdapter` extending `BaseBatchAdapter`.
  - `ingestMode: 'file'`: our canonical stored JSONL
    (`custom_id`/`method`/`url`/`body`) is byte-compatible with xAI's
    file format, so upload is a streaming passthrough of the lowered
    lines — no chunked inline add-calls, no 1000-calls/30s budget.
  - Lowering (`fromInternalRequest`): per sync parity, serialize each
    line via the xAI Responses serializer (extract the pure serializer
    from `InternalStreamXAIResponsesAdapter.transformRequest` +
    `getProviderModelId`) and emit `url: "/v1/responses"` lines.
    Live-verified that Responses lines (incl. `reasoning`, `text.format`,
    Responses tools) are accepted and produce chat-shaped results
    (live `29`–`32`).
  - `submitNativeBatch`: `POST /files` (multipart) then `POST /batches`
    with `input_file_id`; persist `batch_id` as `upstream_batch_id` and
    `input_file_id` in the artifact slot (§13).
  - `pollBatch`: derive `UpstreamBatchStatus` from the counter table in
    §4 (exhaustive over the observation matrix).
  - `fetchNativeResults`: page `GET …/results` draining
    `pagination_token`; `transformBatchResponse` normalizes each native
    element to the canonical batch output line before serving or billing.
    Success bodies preserve `cost_in_usd_ticks` for internal billing while
    the public parser strips it; errors come from the bare
    `batch_result.error` string.
  - `toInternalResponse`: chat-completion → internal (same seam the
    OpenAI adapter's chat path uses).
- **Planned layers** (stacked, one owner per file):
  1. research note + fixtures (this PR)
  2. fake-provider xAI batch surface
  3. serializer extraction from the sync xAI adapter (sync-owned files)
  4. `XAIBatchAdapter` + schemas + registration
     (`BatchAdapterName.XAIBatchAdapter`, `BATCH_ADAPTER_SYNC_WIRES` →
     `InternalStreamXAIResponsesAdapter`, factory + runtime env)
  5. endpoint rows / orchestration + tests & monitoring
- **Fixture plan:** committed under `packages/batch/adapters/xai/` —
  request-input capture (`fixtures.ts`, all seven batchable-request
  scenarios as submitted live) and redacted native response shapes
  (`fixtures/*.json`: upload, create, poll validating/in-progress/
  completed, results page pair, per-scenario result lines, cancel,
  cancelled-result error line, malformed-file cancellation, dup-id and
  unsupported-model errors, bad-auth error).

## 11. OpenRouter endpoint intersection

Live batch-enablement probe (one add-request per model against a
throwaway batch, then cancel — live `model-check-*`):

| xAI model | Batch | OpenRouter endpoint |
| --- | --- | --- |
| `grok-4.3` | yes (200) | `x-ai/grok-4.3` — **onboard** |
| `grok-4.20-0309-reasoning` / `-non-reasoning` | yes (200) | `x-ai/grok-4.20` (sync adapter maps id by `reasoning.enabled`) — **onboard** |
| `grok-4.20-multi-agent-0309` | yes (200) | `x-ai/grok-4.20-multi-agent` — **onboard** |
| `grok-4.5` | no (400 "not supported for batch processing") | excluded |
| `grok-4.6` | no (400) | excluded |
| `grok-build-0.1` | no (400) | excluded |
| `grok-3-mini` (not on OpenRouter) | no (400) | excluded |
| `grok-imagine-*` image/video models | doc-supported for batch | excluded — image/video modalities out of scope for this onboarding |

A minimal live batch (8 text scenarios on `grok-4.3`) completed
end-to-end in under a minute (live `03`–`10`).

## 12. Credential shape

- **Platform:** single bearer key. Runtime env needs `X_AI_API_KEY`
  (already provisioned for sync in `/services/cfw-api`; batch-api runtime
  needs it added to its own env/Infisical path). The ZDR variant key
  (`X_AI_ZDR_API_KEY`, `packages/providers/configs/xai.ts`) applies only
  to the `xai/zdr` provider endpoints; batch onboarding targets the
  primary `xai` provider — ZDR batch is out of scope until requested.
- **BYOK:** supportable — a user bearer key exercises the same endpoints;
  batches are scoped to the key's team, results are read via the API (no
  cross-project artifact ownership problem à la Vertex). Validation:
  non-empty string starting `xai-` per console-issued keys (runtime
  should validate non-empty only, prefix as a warning; prefix rule is
  unverified against all key vintages).

## 13. Artifact handles

- `upstream_batch_id` ← `batch_id` (`batch_<uuid>`): sole handle needed
  for poll, results, cancel.
- `upstream_input_file_id` ← `input_file_id` (`file_<uuid>`): retained as
  the input artifact handle for diagnostics and future cleanup.
- `upstream_output_file_id` / `upstream_error_file_id` remain null: xAI
  creates neither artifact. Result discovery reads `upstream_batch_id`
  and calls the batch resource's paginated results endpoint.

## Capture-matrix coverage

Captured live: discovery (`/language-models`), upload+create (file and
inline), validating/in-progress/completed polls, results + pagination,
text, tool-calls, multi-system, multi-turn, reasoning, structured-output,
truncated (`finish_reason: "length"`), cancelled batch + cancelled result
line, cancel race (post-cancel add → 403), malformed JSONL
(batch auto-cancelled), duplicate custom id (412), missing custom id
(auto-generated), unsupported model (400), bad auth (400), sealed
file-batch add (412), Responses-wire lines (reasoning/structured/tools).

Not capturable / untested: expired job (30-day horizon), over-limit
files (200 MB), rate-limit responses (not induced), processing-time
per-line failure with `num_error > 0` (could not trigger; error-line
shape evidenced by the cancelled-result capture and REST ref
`batch_result.error`).

---

## Addendum — second live capture round (2026-08-29, inline mode)

A second independent research pass ran 74 live transcripts against
`api.x.ai` on `grok-4.3` in **inline** mode (create-then-add, no Files
API), covering the scenarios the first pass could not trigger. Claims are
tagged **[capture]** (observed live), **[docs]**, or **[unconfirmed]**.
Raw transcripts are uncommitted; every JSON/text block below is verbatim.

### A1. Counters are not monotonic — cancel can revert

The first pass recorded cancel as "immediate and synchronous". It is not.
A cancel of a five-request batch returned
`{num_pending: 0, num_success: 0, num_cancelled: 5}`; **20 seconds later
the same batch read `{num_success: 5, num_cancelled: 0}` and served all
five result rows** — the in-flight work had already landed and the
counter reverted. **[capture]**

Consequences for §4's derivation, in order of severity:

1. `cancel_time != null` must **not** outrank readable rows. A batch with
   `num_success + num_error > 0` has results the caller paid for, and
   `process-completed-batch` materializes only for `completed`, so
   returning `cancelled` there discards billable output permanently. The
   currently shipped `deriveXaiBatchStatus`
   (`packages/batch/adapters/xai/status.ts`) returns `cancelled` on
   `cancel_time` alone and is exposed to exactly this loss.
2. `num_pending == 0` is not terminality. Treat a snapshot as *settled*
   only when `num_pending == 0 && num_cancelled == 0`; any
   `num_cancelled > 0` snapshot is `cancelling` until it has repeated
   unchanged for a stabilization window. The observed flip took under
   20 s; xAI documents no bound, so the window is a guess
   (**[unconfirmed]**) and is a sign-off decision.
3. Expiry must not outrank readable rows either. `expire_time` is
   date-only — a scheduling deadline, not an instant — and only a failed
   results read proves deletion, which `pollBatch` cannot attempt. Map an
   expiry-day batch that has rows to `completed` and let the results fetch
   classify a 404 as permanent expiry loss.
4. A cancelled batch with `num_requests == 0` is stable by construction:
   after a cancel, further adds are rejected 403 **[capture]**, so no
   counter can move again. It maps to `cancelled`, not `expired`.

### A2. Execution-time per-line failure — the `num_error > 0` gap

The first pass could not trigger a processing-time failure. Two inputs do,
both admitted successfully and failing while running: a negative
`max_tokens`, and an unfetchable public image URL. A five-line mixed job
reached `{num_requests: 5, num_pending: 0, num_success: 3, num_error: 2,
num_cancelled: 0}` with rows for both outcomes in one stream. **[capture]**

```json
{"batch_request_id": "mixed_003",
 "batch_result": {"error": "Maximum number of tokens max_tokens must be positive but max_tokens = -5"}}
```

This confirms the error envelope is a bare string with no code, no HTTP
status, and **no usage** — so finalization bills nothing for a failed row;
whether xAI charges for it is not observable **[unconfirmed]**. Results
were readable mid-flight: a `num_pending: 3` snapshot already returned 2
error rows and 1 success row. **[capture]**

Admission is atomic and separate from execution: one unsupported model or
one duplicate `batch_request_id` rejects the **whole** add call (400/412),
admitting zero requests — which is why a probe built from obviously
invalid lines tests nothing. **[capture]**

### A3. Remote URL inputs (matrix row 14)

Both supported natively on the chat wire, fetched server-side by xAI.

- **Images** — `image_url.url`. A public PNG was admitted; a 404 URL
  failed at execution time with a provider-side fetch error, which proves
  xAI does the fetch: `Failed to download the provided image
  (image_download_error=image_fetch_http_error): the image host returned
  HTTP status 404 … [WKE=invalid_image]`. **[capture]** Caveat: the
  *valid* image request never completed (see A4), so
  `batchAdapterSupportsImageUrls` should stay unsupported until a valid
  image probe finishes.
- **Files/PDFs** — the field is `file.url`, **not** OpenAI's
  `file.file_url`; `file_url` is rejected per line with `FileContent must
  set one of file_id, url, or inline data`. A public PDF completed and
  billed `image_tokens` (pages are rasterized). `file_id` and inline data
  are the other accepted forms. **[capture]**

### A4. A request can sit `pending` with no deadline

Two probes (`temperature: 99`, and the valid image URL) were still
`pending` after 25 minutes with no error row and no per-request deadline
field anywhere in the API. xAI documents no per-request timeout
**[unconfirmed]**, so a poll loop can hang until batch expiry and the
adapter needs its own deadline. Highest-priority follow-up.

### A5. Retention, as observed inline

Inline batches involve no Files API object: request lines live in the
batch record and share its `expire_time` (date-only, observed
2026-08-29 → 2026-09-28). Every response carries
`x-zero-data-retention: false` and `x-data-retention: general`.
**[capture]** No delete call exists, and what a post-`expire_time` read
returns is **[unconfirmed]**.

### A6. TODO — fold into the delete-endpoint work

The A1 lifecycle correction is not applied to
`packages/batch/adapters/xai/status.ts` in this note's PR, and is to be
addressed when the batch delete endpoint is implemented, since both
changes turn on when a batch's data is considered gone. Tracked as
ECO-3744:

- `deriveXaiBatchStatus` returns `cancelled` on `cancel_time` alone, so a
  cancel that loses the race against in-flight work finalizes a batch
  whose rows were readable and billable.
- The ordering to implement: readable rows outrank cancellation and
  expiry; `num_cancelled > 0` stays `cancelling` until stable; `cancelled`
  only when cancellation is stable with no readable rows; a cancelled
  `num_requests == 0` batch is stable by construction.
- The stabilization window is an open decision (N identical polls versus a
  grace period from `cancel_time`); xAI documents no bound, and the
  observed flip took under 20 s.
- Regression cases to add with the fix: the cancelled-to-success
  transition, and a mixed pending/rows snapshot.

### A7. Still deferred after both passes

Expiry behavior (needs a 30-day-old batch); multi-page result traversal
(no probe exceeded one page); the A1 stabilization threshold; whether a
genuinely pending request yields a `cancelled` result row or only a
counter; `batch_request_id` uniqueness across add calls; billing for
failed lines; rate limits.
