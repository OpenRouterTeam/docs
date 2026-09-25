# Morph Batch API — research note

Output of `research-batch-provider` for Morph, written before any adapter code exists. Official pages were fetched on 2026-09-21. Live captures were attempted on 2026-09-21 against `https://api.morphllm.com/v1` with the platform development credential (Infisical `/services/batch-api`, `MORPH_LLM_API_KEY`). During the capture window `GET /v1/models` answered HTTP 200 but every request to `/v1/files` and `/v1/batches` was answered by Cloudflare with HTTP 522 (origin timeout, ~19.5 s) for 85+ minutes, and `status.morphllm.com` showed an active `degraded_performance` incident. No batch lifecycle was observed live. Every provider-behavior claim below is therefore `[docs]` or `[unconfirmed]`. The capture scripts are ready to re-run, and the matrix at the bottom lists what each scenario upgrades to `[capture]`.

Provenance labels: `[capture]` observed live, `[docs]` from an official Morph page (URL inline), `[unconfirmed]` neither.

## Official sources

- Batch guide (lifecycle, input/output/error-file format, statuses, cancel, limits, pricing, retention, pitfalls): https://docs.morphllm.com/sdk/components/batch
- API reference, upload file: https://docs.morphllm.com/api-reference/endpoint/files-upload
- API reference, list files: https://docs.morphllm.com/api-reference/endpoint/files-list
- API reference, retrieve file: https://docs.morphllm.com/api-reference/endpoint/files-retrieve
- API reference, file content (contains the `BatchOutputLine`, `BatchErrorLine`, `BatchInputLine` schemas): https://docs.morphllm.com/api-reference/endpoint/files-content
- API reference, delete file: https://docs.morphllm.com/api-reference/endpoint/files-delete
- API reference, create batch: https://docs.morphllm.com/api-reference/endpoint/batches-create
- API reference, retrieve batch: https://docs.morphllm.com/api-reference/endpoint/batches-retrieve
- API reference, list batches: https://docs.morphllm.com/api-reference/endpoint/batches-list
- API reference, cancel batch: https://docs.morphllm.com/api-reference/endpoint/batches-cancel
- Pricing: https://www.morphllm.com/pricing
- Status page: https://status.morphllm.com

Not found on any official page: a batch-specific rate limit, a maximum concurrent batches figure, whether `GET /v1/files/{id}/content` streams or buffers, and whether a batch object can be deleted (only files can). Those are `[unconfirmed]` below.

## 1. Auth

- `Authorization: Bearer <MORPH_LLM_API_KEY>` on every call `[docs]` (https://docs.morphllm.com/sdk/components/batch, cURL tab). Same header the sync adapter sends.
- `[capture]` The platform dev key is accepted by `GET /v1/models` (HTTP 200, 2026-09-21). Whether it is enabled for `/v1/files` and `/v1/batches` is `[unconfirmed]` because those endpoints never reached the origin.
- Non-2xx control-plane responses use one envelope `{"error": {"code": string, "message": string}}` `[docs]` (files-content reference, `Error` schema). 401 is "Missing or invalid API key", 404 "resource does not exist", 429 "Retry-After header", 500 "safe to retry with backoff" `[docs]`.

## 2. Endpoints

Base URL `https://api.morphllm.com/v1` `[docs]`. The OpenAI batch helpers in `packages/batch/adapters/openai/` append `/v1/...` themselves, so the registration `defaultBaseUrl` is `https://api.morphllm.com`.

| Operation     | Endpoint                                                                                                                                  | Docs shape                                                                                                                | Live                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Upload input  | `POST /v1/files` multipart `purpose=batch`, `file`, optional `expires_after[anchor]=created_at`, `expires_after[seconds]` (3600..2592000) | HTTP 200 `{id: "file_…", object: "file", bytes, created_at, filename, purpose: "batch", status: "uploaded", expires_at?}` | `[unconfirmed]` (522) |
| File metadata | `GET /v1/files/{file_id}`                                                                                                                 | same `FileObject`                                                                                                         | `[unconfirmed]`       |
| File content  | `GET /v1/files/{file_id}/content`                                                                                                         | raw JSONL                                                                                                                 | `[unconfirmed]`       |
| List files    | `GET /v1/files?after=<int offset>&limit=`                                                                                                 | `{object: "list", data: [...]}`                                                                                           | `[unconfirmed]`       |
| Delete file   | `DELETE /v1/files/{file_id}`                                                                                                              | `{id, object: "file", deleted: true}`                                                                                     | `[unconfirmed]`       |
| Create        | `POST /v1/batches` `{input_file_id, endpoint: "/v1/chat/completions", completion_window: "24h", metadata?, output_expires_after?}`        | HTTP 200 batch object in `validating`                                                                                     | `[unconfirmed]`       |
| Retrieve      | `GET /v1/batches/{batch_id}`                                                                                                              | bare batch object                                                                                                         | `[unconfirmed]`       |
| List          | `GET /v1/batches?after=<int offset>&limit=`                                                                                               | `{object: "list", data: [...]}`                                                                                           | `[unconfirmed]`       |
| Cancel        | `POST /v1/batches/{batch_id}/cancel`                                                                                                      | batch object in `cancelling`; 400 on a terminal batch; no-op on `cancelling`                                              | `[unconfirmed]`       |
| Delete batch  | none                                                                                                                                      | not documented                                                                                                            | n/a                   |

All `[docs]` cells come from the API reference pages listed above. Two divergences from OpenAI to carry into the adapter: `after` on both list endpoints is an integer offset, not an object id `[docs]` (batch guide, Pitfalls), and there is no `DELETE /v1/batches/{id}` `[docs]`, so `nativeDeletion` is `BATCH_NATIVE_DELETION_UNSUPPORTED`. File deletion exists but deleting the input or output file is not the same contract as deleting the job.

## 3. Native request-line shape

```json
{
  "custom_id": "req-0001",
  "method": "POST",
  "url": "/v1/chat/completions",
  "body": {
    "model": "morph-glm53flash",
    "messages": [{ "role": "user", "content": "..." }],
    "max_tokens": 256
  }
}
```

- `custom_id` unique within the batch, no documented length cap `[docs]` (batch guide, Limits). Live acceptance of long or non-ASCII ids is `[unconfirmed]`.
- `method` always `POST`, `url` always `/v1/chat/completions` and must match the batch `endpoint` `[docs]`.
- `body` is a sync Chat Completions body. One `model` per batch: a second model in the file fails validation `[docs]`. `stream: true` is rejected `[docs]`. Blank lines and invalid JSON fail validation `[docs]` (`validating` row of the status table).
- Validation problems surface on the batch object as `errors: {object: "list", data: [{code, message, param, line}]}` with `status: "failed"` `[docs]` (batches-create reference, `BatchError` schema). Whether Morph rejects at `POST /v1/batches` time (HTTP 400) or accepts and fails asynchronously is `[unconfirmed]`. The adapter must handle both.

## 4. Exhaustive upstream status model

| Morph `status` | Terminal | Meaning `[docs]`                                                                                                  | `UpstreamBatchStatus` |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------------------- | --------------------- |
| `validating`   |          | input file checked: JSON per line, one model, unique `custom_id`, supported endpoint                              | `Validating`          |
| `in_progress`  |          | requests running, `request_counts` advances                                                                       | `InProgress`          |
| `finalizing`   |          | all requests finished, output and error files being written                                                       | `Finalizing`          |
| `completed`    | yes      | `output_file_id` and `error_file_id` set where they have lines                                                    | `Completed`           |
| `failed`       | yes      | validation failed or system error, reasons in `errors`, anything that completed first is still in the output file | `Failed`              |
| `expired`      | yes      | 24 h window closed, completed rows in output file, rest in error file as `batch_expired`                          | `Expired`             |
| `cancelling`   |          | cancel requested, in-flight requests draining                                                                     | `Cancelling`          |
| `cancelled`    | yes      | completed rows in output file, rest in error file as `batch_cancelled`                                            | `Cancelled`           |

Source for the table: https://docs.morphllm.com/sdk/components/batch (Statuses). The names are byte-identical to the eight values of `UpstreamBatchStatus`, so the shared OpenAI poller's status mapping applies unchanged. Live transition order and timing are `[unconfirmed]`. The docs recommend polling every 30 to 60 s and state there is no webhook `[docs]`.

Batch object fields `[docs]` (batches-create reference): `id` (`batch_` prefixed), `object: "batch"`, `endpoint`, `input_file_id`, `completion_window`, `metadata`, `created_at`, `status`, `model`, `output_file_id`, `error_file_id`, `in_progress_at`, `finalizing_at`, `completed_at`, `failed_at`, `expired_at`, `expires_at`, `cancelling_at`, `cancelled_at`, `request_counts: {total, completed, failed}`, `errors`, `usage`. `output_file_id` and `error_file_id` are `null` before a terminal state and `null` when the corresponding file has no lines `[docs]` (batches-cancel reference, response schema). `request_counts.failed` counts both output-file non-2xx rows and error-file rows `[docs]` (files-content reference, `status_code` description says non-2xx "count toward `request_counts.failed`"). Whether `total` is known during `validating` (the create example shows `0`) is `[unconfirmed]`.

## 5. Output and error shapes

Two files. Together they cover every `custom_id` `[docs]` (Pitfalls). Output order is completion order, not input order `[docs]`.

### 5a. Output file, success row

```json
{
  "id": "batch_req_…",
  "custom_id": "req-0001",
  "response": {
    "status_code": 200,
    "request_id": "req_…",
    "body": {
      "id": "chatcmpl-…",
      "object": "chat.completion",
      "created": 1780005400,
      "model": "morph-glm53flash",
      "choices": [
        {
          "index": 0,
          "message": { "role": "assistant", "content": "…" },
          "finish_reason": "stop"
        }
      ],
      "usage": {
        "prompt_tokens": 412,
        "completion_tokens": 18,
        "total_tokens": 430
      }
    }
  },
  "error": null
}
```

`response.body` is "the full Chat Completions response, identical to the synchronous endpoint, including `usage`" `[docs]`. `response.request_id` is required by the schema `[docs]`. Whether live bodies carry `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`, `reasoning_content`, or `tool_calls` for the sync-parity scenarios is `[unconfirmed]`.

### 5b. Output file, model-level error row (the case Charles asked about)

```json
{
  "id": "batch_req_…",
  "custom_id": "req-0003",
  "response": {
    "status_code": 400,
    "request_id": "req_…",
    "body": {
      "error": { "message": "…", "type": "…", "param": "…", "code": "…" }
    }
  },
  "error": null
}
```

- A request the model answered with a non-2xx status stays in the **output** file. `response.status_code` is the model's HTTP status, `response.body` is the error envelope, and `error` is **always `null`** in the output file `[docs]` (files-content reference, `BatchOutputLine.error`: "Always `null` in the output file. Client-side failures go to the error file instead.").
- Such rows count toward `request_counts.failed` `[docs]`.
- The docs' worked example lists 400 (bad parameter), 413 (oversized prompt), and 500 (system error) as per-request status codes that appear in the output file `[docs]` (Pitfalls). The exact envelope keys inside `body.error` on a live 400/413/500, and whether 429 ever appears as an output row rather than as `timeout` in the error file, are `[unconfirmed]`.
- Billing: the guide says "Every request that completes is billed" and "Requests in the error file are free" `[docs]`. Whether a non-2xx output row is billed (it "completed" in the sense of receiving a response) is **not stated** and is `[unconfirmed]`. This matters for `verify-batch-billing` parity: our finalizer skips lines with `status_code !== 200`, so if Morph bills them we under-bill, if Morph does not we match.

### 5c. Error file row

```json
{
  "id": "batch_req_…",
  "custom_id": "req-0002",
  "response": null,
  "error": {
    "code": "batch_expired",
    "message": "This request could not be executed before the completion window expired."
  }
}
```

- Only requests that **never got a model response** land here `[docs]`. `response` is always `null` `[docs]`. `error` is `{code, message}` with no `type` or `param` `[docs]`.
- `error.code` enum `[docs]` (batch guide, Error file):

| `code`            | Meaning                                                  |
| ----------------- | -------------------------------------------------------- |
| `timeout`         | request sent, no response arrived in time                |
| `batch_cancelled` | batch cancelled before this request ran                  |
| `batch_expired`   | 24 h window closed before this request ran               |
| `batch_failed`    | batch hit a system error before this request ran         |
| `model_not_found` | the line's `model` is not available for batch            |
| `parse_error`     | the line, or the model's reply to it, was not valid JSON |

- Error-file rows are not billed `[docs]`.
- `parse_error` covering "the model's reply" means a malformed model response is reported as a never-executed request, not as an output row. `[docs]`, live `[unconfirmed]`.

### 5d. Mixed batch and non-success terminal states

- `completed` with some 4xx output rows and some error rows is the normal partial-success shape `[docs]`.
- `failed`, `expired`, `cancelled` keep partial output: "Whatever completed is in the output file and billed. Whatever did not run is in the error file and not billed. OpenAI discards results on cancel; Morph keeps them." `[docs]` (Cancel and expiry). Handles are set once terminal `[docs]`. Our finalizer does not read them today: `resolveFinalizationArtifacts` in `services/batch-api/src/finalize/process-completed-batch.ts` only downloads and bills artifacts when `isUpstreamCompleted` is true, and that predicate is `status === 'completed'`. A Morph batch that ends `failed`, `expired`, or `cancelled` with 40 completed rows would be marked terminal with none of those rows served or billed. Morph fits `BatchResultMode.FileHandle`, but shipping it needs a finalize path that materializes whichever handles are non-null on every terminal status while keeping the public status accurate. That is a `services/batch-api` change and its own stack layer, not a status remap.
- Cancel is allowed from `validating` or `in_progress` `[docs]`. Cancelling a terminal batch returns 400, cancelling one already `cancelling` is a no-op `[docs]`.

## 6. Limits `[docs]`

| Limit               | Value                                                 |
| ------------------- | ----------------------------------------------------- |
| Input file size     | 100 MB                                                |
| Lines per file      | 50,000                                                |
| Models per batch    | 1                                                     |
| `endpoint`          | `/v1/chat/completions` only                           |
| `completion_window` | `24h` only                                            |
| `metadata`          | up to 16 pairs, keys up to 64 chars, values up to 512 |
| `stream: true`      | rejected                                              |
| `custom_id`         | unique within the batch, no length cap                |

Source: https://docs.morphllm.com/sdk/components/batch (Limits). Requests per minute and concurrent batch caps are `[unconfirmed]`. OpenRouter's `BatchLimitsSchema` in `packages/batch/limits.ts` is not a substitute for these caps: `max_request_count` and the 200 MB payload cap are runtime-overridable and can exceed Morph's 50,000-line and 100 MB limits. Morph submissions therefore need provider-specific admission (clamp to 50,000 lines and 100 MB before the upload/create side effects). The adapter does not enforce this yet, tracked as a known gap.

## 7. Expiry and retention `[docs]`

- Input, output, and error files are deleted 30 days after being written. `expires_after` on upload and `output_expires_after` on batch creation shorten that (1 hour to 30 days, anchored to file creation).
- Zero-data-retention accounts: files and outputs deleted after 24 hours. Whether the platform account is ZDR is `[unconfirmed]`. The adapter must finalize within 24 h of terminal to be safe on either account type, which the existing poll and sweep cadence satisfies.
- `DELETE /v1/files/{file_id}` removes a file immediately. Post-delete read behavior (404 vs 410) is `[unconfirmed]`.
- Source: https://docs.morphllm.com/sdk/components/batch (Retention).

## 8. Pricing `[docs]`

- Every completed request is billed at 50% of the model's synchronous input and output rates. Error-file rows are free. Cancel and expiry do not refund already-completed requests. Source: https://docs.morphllm.com/sdk/components/batch (Pricing), per-model rates at https://www.morphllm.com/pricing.
- Batch-level `usage` on the batch object: `{input_tokens, input_tokens_details: {cached_tokens}, output_tokens, output_tokens_details: {reasoning_tokens}, total_tokens}` `[docs]` (batches-create reference). Per-row usage is in `response.body.usage` in Chat Completions shape `[docs]`. We bill per row from the raw artifact, never from the batch aggregate.
- Cached-token discount at batch price is `[unconfirmed]`.

## 9. Sync-transform overrides

The sync adapter `packages/router/adapters/morph/index.ts` extends `VLLMOpenAIAdapter` and overrides only `getHeaders` to add `X-Session-Id` (prompt-cache affinity, hashed per entity, user, session). A batch input line has no per-line headers, so this override cannot be reproduced in the file. Consequences:

- Lowering must go through a Morph-owned serializer (`serializeMorphRequest` over a `MorphSerializeContext`) that wraps `serializeOpenAiChatRequest` and re-adds `chat_template_kwargs` from `getVllmThinkingParams`, matching the sync `VLLMOpenAIAdapter` path. Plain `serializeOpenAiChatRequest` would drop `chat_template_kwargs` and make batch reasoning diverge from sync (ECO-1670).
- Prompt-cache affinity is lost in batch. Whether Morph applies caching inside a batch without the header is `[unconfirmed]`. Not a correctness issue.
- `VLLMOpenAIAdapter` request and response behavior (reasoning field names, `min_p`, `top_k`, `repetition_penalty`) must be checked against the Morph body shape during adapter implementation. `[unconfirmed]` until the tool-call and reasoning captures run.

## 10. OpenRouter mapping decision

- **Skin**: the existing OpenAI chat-completions skin. Morph input lines are OpenAI batch input lines and output rows are OpenAI batch output rows `[docs]`. No new endpoint family.
- **Adapter**: new `MorphBatchAdapter` in `packages/batch/adapters/morph/`, `ingestMode = File`, `resultMode = FileHandle`, `nativeDeletion = BATCH_NATIVE_DELETION_UNSUPPORTED`. Reuses the shared OpenAI uploader, submitter, poller, and file downloader with `baseUrl = https://api.morphllm.com` because the endpoint paths, status enum, `request_counts`, and file-handle fields match `[docs]`. Provider-specific pieces:
  1. `fromInternalRequest`: Morph-owned lowering through the sync serializer (section 9).
  2. `parseResult`: error-file rows carry `error: {code, message}` and the canonical `BatchResultErrorSchema` requires `{type, message, param}`, so the Morph parser maps `code` to `type` (cf. `TogetherErrorLineSchema`) and passes output rows through `batchErrorFromResponse` so a 4xx output row is served as a canonical error with `response: null`.
  3. `transformBatchResponse`: identity for output-file rows (already canonical `[docs]`). Error-file rows are stored raw and only parsed at serving time, which is how Together and OpenAI behave today.
  4. Cancel: `POST /v1/batches/{id}/cancel`, expect `cancelling`, treat 400 on a terminal batch as already-terminal.
- **Billing**: unchanged finalizer. Output rows with `status_code !== 200` are skipped, error-file rows never match the output-line schema. Section 5b records the one open billing question.
- **Fake provider**: add Morph routes to `services/fake-provider/batch/` mirroring the OpenAI fake with three differences: `error` fixed to `null` in output rows, error-file rows shaped `{code, message}`, integer-offset `after` on list routes.
- **Registration**: `services/batch-api/src/adapters/api-key-providers.ts` entry `{provider: ProviderName.Morph, apiKeyEnvVar: 'MORPH_LLM_API_KEY', baseUrlEnvVar: 'MORPH_BASE_URL', defaultBaseUrl: 'https://api.morphllm.com'}` plus `BatchAdapterName.MorphBatchAdapter`.

## 11. OpenRouter endpoint intersection

Morph batch models `[docs]` (batch guide): `morph-glm53flash`, `morph-dsv4flash`, `morph-glm53-744b`, `morph-kimik3`. `[capture]` `GET /v1/models` on 2026-09-21 additionally listed `morph-dsv41flash`, `morph-v3-fast`, `morph-v3-large`, `auto`, `morph-compactor`, `morph-warp-grep-v2.1`, and did not list `morph-dsv4flash`. Which of these are batch-eligible is `[unconfirmed]` (the `model_not_found` error code exists for exactly this case).

`[capture]` OpenRouter public `/api/v1/models` on 2026-09-21 has Morph endpoints for `z-ai/glm-5.3-flash`, `z-ai/glm-5.3`, `moonshotai/kimi-k3`, `deepseek/deepseek-v4.1-flash`, `morph/morph-v3-large`, `morph/morph-v3-fast`. Candidate `:batch` rows, pending live eligibility check:

| OpenRouter model                              | Morph model id                    | Eligibility                                                                        |
| --------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| `z-ai/glm-5.3-flash`                          | `morph-glm53flash`                | `[docs]` listed                                                                    |
| `z-ai/glm-5.3`                                | `morph-glm53-744b`                | `[docs]` listed                                                                    |
| `moonshotai/kimi-k3`                          | `morph-kimik3`                    | `[docs]` listed                                                                    |
| `deepseek/deepseek-v4.1-flash`                | `morph-dsv41flash`                | `[unconfirmed]` (docs list `morph-dsv4flash`, live models list `morph-dsv41flash`) |
| `morph/morph-v3-large`, `morph/morph-v3-fast` | `morph-v3-large`, `morph-v3-fast` | `[unconfirmed]`, Fast Apply models, probably not batch targets                     |

## 12. Platform and BYOK credential shape

Single bearer API key, same env var as sync (`MORPH_LLM_API_KEY`, `packages/providers/configs/api-key.ts`). BYOK keys are the same shape. No project or org header documented `[docs]`.

## 13. Artifact handles

`input_file_id`, `output_file_id`, `error_file_id`, all `file_` prefixed, read through `GET /v1/files/{id}/content` `[docs]`. Both result handles nullable independently, so a batch with zero failures has `error_file_id: null` and a fully failed batch may have `output_file_id: null` `[docs]`. Our `FileHandle` result mode already requires at least one of the two.

## 14. Native remote URL inputs

Not mentioned anywhere in the batch docs. The listed batch models are text models. `batchAdapterSupportsImageUrls` and `batchAdapterSupportsFileUrls` should be `false` until the `img-public-url` and `file-public-url` captures show otherwise. `[unconfirmed]`.

## Committed fixtures

None yet. Fixtures are promoted into `packages/batch/adapters/morph/fixtures/live-*` from `/tmp/batch-research/morph/captures/` once the capture scripts run against a healthy origin. Until then the fake provider and adapter tests use docs-derived fixtures named `docs-*` so their provenance is visible.

## Deferred captures

Every live capture is deferred for the same reason: `/v1/files` and `/v1/batches` answered HTTP 522 for the whole capture window (see the preamble), so no file id and therefore no batch ever existed. Each row names what the missing capture leaves `[unconfirmed]`.

| Deferred capture                                                                                                                                                                                   | Fields left `[unconfirmed]`                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload input (`POST /v1/files`)                                                                                                                                                                    | `FileObject` shape and `status` value, whether the dev key is enabled for files and batches, acceptance of long or non-ASCII `custom_id`                                                              |
| Create batch (`POST /v1/batches`)                                                                                                                                                                  | Batch object in `validating`, whether `request_counts.total` is known before `in_progress`, whether invalid input is rejected synchronously with 400 or asynchronously as `failed` with `errors`      |
| Poll to terminal                                                                                                                                                                                   | Transition order and timing through `validating`, `in_progress`, `finalizing`, `completed`                                                                                                            |
| Download output file                                                                                                                                                                               | Live success-row shape, presence of `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`, `reasoning_content`, `tool_calls`, `VLLMOpenAIAdapter` reasoning field names |
| Mixed batch with per-request 4xx                                                                                                                                                                   | Exact `body.error` envelope keys on an output-file model error, whether 429 or 5xx ever appear as output rows rather than `timeout` error rows, whether non-2xx output rows are billed (section 5b)   |
| Fully invalid batch                                                                                                                                                                                | `errors.data[]` shape and `line` numbering on a `failed` batch                                                                                                                                        |
| Cancel mid-flight                                                                                                                                                                                  | `cancelling` to `cancelled` transition, partial `output_file_id` plus `batch_cancelled` error rows, 400 body on cancelling a terminal batch                                                           |
| Error-path matrix (bad token, malformed JSONL, duplicate or missing `custom_id`, unsupported or mixed model, unsupported endpoint, `stream: true`, bad `completion_window`, missing batch or file) | Control-plane error envelope and status code per case, whether `model_not_found` and `parse_error` surface at validation or per row                                                                   |
| Upload with `expires_after`, delete file, post-delete read                                                                                                                                         | `expires_at` on the file object, delete response, 404 vs 410 after deletion                                                                                                                           |
| Expired batch                                                                                                                                                                                      | `expired` batch object, `batch_expired` error rows, partial output retention (also not attemptable inside a session because of the 24 h window)                                                       |
| Public image URL, file URL inputs                                                                                                                                                                  | Whether any batch model accepts remote URL inputs (section 14)                                                                                                                                        |

## Capture-matrix coverage

Scripts: `01-happy.sh`, `02-degraded.sh`, `03-errors.sh`, driven by `run-all.sh`, which polls `GET /v1/batches?limit=1` until HTTP 200 and then runs all three.

| Scenario                                                                                                                                                                                   | Script | Status 2026-09-21                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------- |
| Model discovery                                                                                                                                                                            | manual | `[capture]` 200                                |
| Upload, create, poll to terminal, download output and error                                                                                                                                | 01     | blocked (522)                                  |
| Plain text, tool calls, multi-system, multi-turn, reasoning, structured output, truncation, public image URL                                                                               | 01     | blocked                                        |
| Mixed batch: valid + bad `max_tokens` + malformed `messages` + bad `temperature` + bad `tool_choice` (output-file 4xx rows)                                                                | 02     | blocked                                        |
| Fully invalid batch (`failed` with `errors`)                                                                                                                                               | 02     | blocked                                        |
| Cancel a 40-request batch mid-flight (partial output + `batch_cancelled` rows)                                                                                                             | 02     | blocked                                        |
| Bad token, malformed JSONL, duplicate and missing `custom_id`, unsupported model, mixed models, unsupported endpoint, `stream: true`, bad `completion_window`, missing batch, missing file | 03     | blocked                                        |
| Upload with 1 h `expires_after`, delete file, post-delete read                                                                                                                             | 03     | blocked                                        |
| Expired batch                                                                                                                                                                              | none   | not attemptable inside a session (24 h window) |
