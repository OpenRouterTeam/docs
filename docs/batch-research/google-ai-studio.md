# Google AI Studio Batch API — research note

Phase-1 output of `research-batch-provider` for Google AI Studio. Live
captures were taken on 2026-09-01 against the Gemini API v1beta with the
platform development credential. Provider-generated identifiers,
timestamps, hashes, response IDs, and thought signatures are redacted in
the committed fixtures.

Primary sources:

- Guide: https://ai.google.dev/gemini-api/docs/batch-api
- Discovery document: https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta
  (revision `20260830` when captured)

## Authentication and endpoints

Every request uses `x-goog-api-key`. An invalid key returns HTTP 400 with
`INVALID_ARGUMENT` and `ErrorInfo.reason = API_KEY_INVALID` (live).

| Operation | Endpoint | Live result |
| --- | --- | --- |
| Start resumable upload | `POST /upload/v1beta/files` | upload URL in `x-goog-upload-url` |
| Finalize upload | `POST <upload URL>` | `file.name`, state `ACTIVE` |
| Create | `POST /v1beta/models/{model}:batchGenerateContent` | long-running operation named `batches/{id}` |
| Poll | `GET /v1beta/batches/{id}` | operation metadata contains batch state and stats |
| Download | `GET /download/v1beta/{file}:download?alt=media` | JSONL output |
| Cancel | `POST /v1beta/batches/{id}:cancel` with `{}` | HTTP 200 `{}`; poll reaches cancelled |

The documented camelCase create fields are `displayName` and
`inputConfig.fileName`. The live API also accepted the adapter's snake_case
`display_name` and `input_config.file_name` payload.

## Input and output

Input is JSONL with one object per line:

```json
{"key":"request-1","request":{"contents":[{"role":"user","parts":[{"text":"Reply pong."}]}]}}
```

Live coverage included plain text, function calling, multiple system parts,
multi-turn content, thinking, JSON-schema structured output, and output-token
truncation. All seven rows succeeded. The downloaded output kept request
order and used `{ "key": ..., "response": ... }` lines, matching the
official guarantee that file output preserves input order.

The terminal operation stores the output file in
`metadata.output.responsesFile`. It also repeats the value as
`response.responsesFile`. It does **not** use
`metadata.output.fileName`; the adapter and fake provider must model the live
`responsesFile` field.

## Status mapping

The discovery enum is exhaustive:

| Google state | OpenRouter status |
| --- | --- |
| `BATCH_STATE_UNSPECIFIED` | `failed` (defensive unknown state) |
| `BATCH_STATE_PENDING` | `validating` |
| `BATCH_STATE_RUNNING` | `in_progress` |
| `BATCH_STATE_SUCCEEDED` | `completed` |
| `BATCH_STATE_FAILED` | `failed` |
| `BATCH_STATE_CANCELLED` | `cancelled` |
| `BATCH_STATE_EXPIRED` | `expired` |

Live polling observed pending at creation, then running and succeeded. A
separate one-row job was cancelled immediately: cancel returned `{}`, and a
subsequent poll returned `BATCH_STATE_CANCELLED`, `done: true`, plus a
provider error code 13.

## Failure behavior

- Unsupported model creation returns HTTP 404 `NOT_FOUND` (live).
- A file containing one valid row and one malformed request is rejected at
  create time with HTTP 400 `INVALID_ARGUMENT`; no partial batch is created
  (live).
- Invalid credentials return HTTP 400 `INVALID_ARGUMENT` (live).
- Rate limiting was not induced. Treat HTTP 429 with the normal provider
  retry policy.

## Limits, expiry, and pricing

Official documentation states:

- input files are limited to 2 GB;
- target turnaround is 24 hours;
- pending or running jobs expire after 48 hours;
- batch requests cost 50% of standard interactive pricing.

The 2 GB limit and 48-hour expiry were not reproduced because they are
costly or time-bound. The capture upload showed a provider-managed file
expiration two days after upload.

## OpenRouter implementation decision

- Reuse the existing Gemini request serializer and chat-completions batch
  skin.
- Use file ingestion and file-handle results.
- Persist the uploaded input `file.name`; on terminal success persist
  `metadata.output.responsesFile` as the output file handle.
- Keep AI Studio separate from Vertex: authentication, upload, control-plane
  endpoints, and operation shapes differ even though request/response codecs
  are shared.
- Platform and BYOK credentials are plain Google AI Studio API keys sent in
  `x-goog-api-key`.

## Capture matrix

Captured live: invalid auth; upload; snake_case create; pending/running/
succeeded polls; ordered output; text; tools; multi-system; multi-turn;
thinking; structured output; truncation; cancellation; malformed-row create
failure; unsupported model.

Documented only: 429 response, 2 GB rejection, 48-hour expiry. A processing-
time mixed success/error output was not produced; malformed row validation
rejects the whole create request synchronously.


## Deletion (captured 2026-09-08)

Both batch records and uploaded files can be deleted, but generated output is
owned by the batch operation. A one-row `gemini-2.5-flash-lite` batch verified:

- `DELETE /v1beta/batches/{id}` returns `200 {}`; repeated deletion and GET
  return `404 NOT_FOUND`.
- The generated `files/batch-{id}` output stays readable after a direct file
  DELETE fails with `400 INVALID_ARGUMENT` (its ID exceeds the Files API's
  40-character delete limit). Deleting the batch makes GET on its output file
  return `404 NOT_FOUND`. Delete the batch before checking its files.
- Uploaded input DELETE returns `200 {}`. Repeating it returns
  `403 PERMISSION_DENIED` with “or it may not exist,” not 404. The adapter
  accepts this only after exhausting a successful project file listing with
  the original key and confirming absence. A listed file, failed/malformed
  listing, or repeated page token remains an error. Generated output never
  uses this fallback: project listings contain uploaded files.

The discovery document describes `files.list` as listing files owned by the
requesting project, with pages of at most 100 entries. Batch deletion removes
an operation; it does not cancel active inference. The control service's
terminal-state and finalization guards still apply.

Captured receipts live in `packages/batch/adapters/google-ai-studio/fixtures/deletion.json`.
`delete-resource.test.ts` pins success, generated-output readback, permission
failures, malformed responses, and pagination; the fake-provider
`google-ai-studio/deletion.test.ts` pins the adapter's batch/input/output cleanup.
