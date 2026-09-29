# Mistral batch adapter dogfood, 2026-09-04

Procedure: `.agents/skills/batch-adapter-dogfooding/SKILL.md`.
Endpoint under test: `mistralai/mistral-medium-3-5:batch` (OpenRouter model
string in the batch row `mistralai/mistral-medium-3.5-20260430`, upstream
provider model id `mistral-medium-3-5`). Direct native model
`mistral-medium-2604`. Native docs: https://docs.mistral.ai/capabilities/batch.
`docs/batch-research/mistral.md` (PR #39787, ECO-3759) merged to main
during this run, after the batches were submitted. It records the same
string-encoded error-body parser finding from a 2026-09-02 capture (case 1h
here) and a native `CANCELLED` result gap; the `[capture]` claims here that
overlap it are independent confirmations, not new findings.

Status after this run: both `BUG`s (1d, 1h) were fixed on main by #40348
(`fix(batch): preserve Mistral batch error details on failed lines and
upload 422s`), which committed the captures below to
`packages/batch/adapters/mistral/fixtures/` with regression tests. The
behavior and verdicts below are as observed on 2026-09-04, before that
fix.

Provider verdict: **NOT SAFE** (derived, see bottom). The plain success path,
tools, structured outputs, and billing all `PASS` with live evidence. The
verdict is driven by one `BUG` (upstream 422 detail collapsed) and two core
lifecycle items with no live evidence (per line failure serving/billing, and
fault injection/idempotency).

Raw transcripts stay in scratch (`~/mistral-dogfood/raw/`, not committed).
Everything here is redacted: no prompts, completions, keys, account ids.
Native Mistral job ids are shown as 8 char prefixes.

## Runs

| Case | Native (mistral-medium-2604) | OpenRouter batch id | Terminal |
| --- | --- | --- | --- |
| A, 5 plain lines | job `54bab7e8`, SUCCESS 5/5, 36 779 s | `batch-1788484322-78SIdmQozbljw3xE4VGa` | completed 5/5, 36 436 s |
| B, 3 valid + `max_tokens:-5` + bad role | upload 422 (whole file) | `batch-1788484376-X2oJUZPW1cqdlTESdm9k` | failed 0/5 at async validation, 4 s |
| B2, 3 valid + unreachable image URL | job `bc3237e7`, SUCCESS 3/4, one line 400 | `batch-1788484378-YLkhOmzeG50Nsq5DoC1n` | failed 0/4 at async validation, 4 s |
| B3, 3 valid + `tool_choice` naming an unknown tool | upload 422 with `errors[].line_number` | `batch-1788484380-GpARCtC2tm7dPQkhb9or` | failed 0/4, upstream 422, 54 s |
| C, valid line + malformed JSONL tail | upload 422 | n/a | create returned 400 synchronously |
| D, tools + structured outputs + image URL + step-by-step | job `64c69a7d`, SUCCESS 9/10, image line 400 | `batch-1788484384-Lqa6QhKhA16gIzAyWEwb` | failed 0/10 at async validation, 4 s |
| D2, D without the image line | (covered by D) | `batch-1788484426-ltI5p4MTpJDrUeK2D4tg` | completed 9/9, 36 577 s |
| Control, 1 line on `ministral-3b-latest` | SUCCESS in ~9 min | n/a | n/a |

Both paths sat at 0/N for about 10 h on the medium model. The 3b control
finished in 9 min, so the wait was Mistral side queueing for this model,
not an OpenRouter stall.

## Matrix

Every case lists expected native behavior, direct result, OpenRouter
result, billing evidence, verdict. `E<n>` refers to the evidence items
below.

### 1. Batch isolation and errors

**1a plain success (A).** Expected: 5 lines, HTTP 200 each, 50% discounted
pricing. Native: 5×200, `finish_reason:stop`, 23/2/25 tokens per line.
OpenRouter: 5×200, identical per line usage, batch usage 115/10/125, cost
0.00012375, `is_byok:false`. Billing: E1, E2, E3. **PASS**.

**1b invalid request body (B).** Expected: rejection. Native: 422 at file
upload for the whole file, `errors[0].message` lists 29 pydantic errors,
`line_number` present. OpenRouter: create 202, then async validation
failed the whole batch with `Batch request 'b5-bad' sets 'max_tokens'
below 1; each batched request must allow at least 1 output token.`
(`assertMinimumMaxTokensCap`, E7). Outcome parity (whole batch fails on
both sides). The bad `role` on the other invalid line is not reported
because validation stops at the first failing check. **PASS**, with a
closure note: this body could be rejected at accept time (202 then 4 s to
failed is the accept/worker skew class in the skill).

**1c malformed JSONL (C).** Native: 422 `Invalid file format. Chat too
large or missing...`. OpenRouter: synchronous 400 `expected a value but got
character "T"`. Both reject the whole submission. **PASS**.

**1d upstream 422 detail collapsed (B3).** Expected: the customer can
tell which line failed and why. Native: 422 body
`{detail:"Invalid file format.", description:"Found 1 error in this
file...", errors:[{message:"tool_choice requests function
'does_not_exist' which is not in the provided tools: ['get_weather']",
line_number:4}]}`. OpenRouter: batch `error.message` is `HTTP 422: Invalid
file format.` and nothing else. `handleMistralErrorResponse`
(`packages/batch/adapters/mistral/mistral-fetch.ts`) parses only
`{detail}`. Datadog shows three upload attempts (two Mistral 502s retried,
then the terminal 422), E8. **BUG**, low severity, see Issues.

**1e transient 502 on upload.** Native: first D upload returned 502
(`An invalid response was received from the upstream server`), retry
succeeded. OpenRouter: B3 saw two 502s, retried, then hit the real 422
(E8). Retry behavior is correct. **PASS**.

**1f read after create 404.** OpenRouter `GET /api/beta/batches/{id}`
issued immediately after the 202 create returned 404 `Batch job ... not
found.` for batch A. A poll 5 s later returned `in_progress`. Native
showed the same lag: the first `GET /v1/batch/jobs/{id}` after the 200
create of job D returned 404 `No batch job matches the given query.`, the
next poll 15 s later returned 200 (E10). Both surfaces are eventually
consistent for a few seconds after create, so this is parity, not a
divergence. The OpenRouter 404 originates in its own read path (the row
is OpenRouter's, not Mistral's), so it is still worth a client-side
retry note in the docs. **PASS** with observation.

**1g per line failure inside an accepted batch.** Native B2 and D each
produced an error file with one 400 line and a success file with the rest
(E4). OpenRouter never reached this state because the only per line
failure we can induce on Mistral (image URL) is blocked by the capability
guard before upload. Serving and billing of a mixed success/error Mistral
result file has no live evidence. **UNTESTED**. Next measurement: find a
body Mistral accepts at upload but fails at execution (a content length
over the context window is the candidate) and confirm `failed` in
`emit_generations.done` equals the error file line count and the served
row carries the native 400.

**1h native error line parsing.** Expected: a served failure row keeps
Mistral's `message` and `type`. Native: error file lines carry
`response.body` as a JSON string (difference 9, E4). OpenRouter: the
production parser on that captured line returns the generic "Upstream
request failed with status 400." and `invalid_request_error` (E11).
**BUG**, low severity, see Issues. Not yet observed on a live OpenRouter
batch because of 1g.

### 2. Tools and tool choice (D / D2)

Expected: single call, auto with multiple tools, forced function,
parallel calls. Native: 1, 1, 1 (forced `get_weather`), 2 calls
respectively. OpenRouter: same function names and argument lengths,
`finish_reason:tool_calls`, `native_finish_reason:tool_calls`. Tool call
ids differ (separate executions). Billing E2, E3. **PASS**.

Unknown tool in `tool_choice`: covered by 1d.

### 3. Structured outputs (D / D2)

`json_schema` basic, nested with arrays and enum, `$defs`, and
`json_object`. Native and OpenRouter both returned parseable JSON matching
the schema on every case, `finish_reason:stop`. Completion token counts
differ on the nested case (137 native vs 127 OpenRouter, separate
executions, not a defect). Billing E2, E3. **PASS**.

### 4. Multimodal inputs

**4a image URL (B2, D).** OpenRouter rejects the whole batch with
`batch adapter 'MistralBatchAdapter' does not support native image URLs;
use the sync API.` This is the deliberate guard in
`packages/batch/adapters/image-url-support.ts` (`supported:false`, comment
"native batch image behavior is not verified"). **EXPECTED LIMITATION**.

**4b native image support itself.** Native accepted the image line at
upload and failed it at execution with 400 `invalid_request_file` because
the test URL was unreachable, which shows Mistral attempts the fetch. A
valid public image was not run. **UNTESTED**. Next measurement: one native
line with a reachable image URL; if it returns 200 the guard can be
lifted (the comment in `image-url-support.ts` says exactly this).

File inputs, audio: not run, **UNTESTED**.

### 5. Billing, BYOK, reasoning, search, caching

**5a billing of successful lines (A, D2).** Independent calculation from
advertised batch pricing (0.75 / 3.75 USD per 1M):
A `115×0.75e-6 + 10×3.75e-6 = 0.00012375`,
D2 `576×0.75e-6 + 391×3.75e-6 = 0.00189825`. Both equal the batch
`usage.cost`, the `emit_generations.done.total_usage`, and the sum of the
14 exact generation rows (E1, E2, E3). `is_usage_complete:true`,
`unaccounted:0`. The `finalized_cost` field of
`batch_api.finalize.completed` was not captured during the run and the
logs are past retention, so the persisted charge is proven from the
served batch `usage.cost` instead (E3a). **PASS**.

**5b billing of failed lines.** No OpenRouter batch reached a per line
failure (1g). **UNTESTED**.

**5c BYOK.** No Mistral BYOK key is configured on the test workspace.
**UNTESTED**.

**5d reasoning.** The request asked for step by step reasoning in plain
content (Mistral Medium has no separate reasoning channel in chat
completions). Native and OpenRouter content began identically,
`reasoning:null` on OpenRouter as expected. **PASS** for this shape. A
`reasoning` parameter round trip was not run, **UNTESTED**.

**5e caching.** Native D reported `prompt_tokens_details.cached_tokens:128`
on the multi tool line. The separately executed OpenRouter D2 line
reported 0, and the generation row has `native_tokens_cached:0`. Mistral
batch rows elsewhere in `default.generations` do carry nonzero
`native_tokens_cached`, so pass-through exists. Whether Mistral cached on
the OpenRouter execution is unknown (`upstream_raw_response_usage` is
null on these rows, E9). **UNTESTED**. Next measurement: a batch with two
lines sharing a long identical prefix, compare served `cached_tokens` to
the raw result file.

**5f web search.** Not applicable to the Mistral batch adapter (no
plugin path in batch). **UNTESTED** as a rejection check.

### 6. Operational tracing (Datadog, `service:batch-api*
@data.jsonPayload.extra.job_id:<id>`)

Observed for A and D2 (E5, E6): `batch_api.batch_accepted`, upload,
`batch_api.batch_submitted_upstream`, poll records, result file download,
`batch_api.emit_generation.*` per line, `batch_api.emit_generations.done`
with all invariants, `batch_api.finalize.completed` with
`is_usage_complete:true`. **PASS** for upload, submit, poll, result
retrieval, finalization, serving.

Terminal errors: B, B2, D show `assertMinimumMaxTokensCap` /
`assertImageInputCapability` rejections and a permanent failure record
(E7). **PASS**.

Two `endpoint_id` values served the same `:batch` model string
(`bf606cdf…` for A, `d0131604…` for D2), both provider Mistral, same
pricing outcome, only one appears in the public endpoints listing. Not
classified. Next measurement: Postgres `endpoints` rows for that model
to confirm the second row is intentional (ZDR sibling or similar).

Expiry, deadline cleanup, cancellation, result handle re-read after
expiry: not exercised in a 24 h window. **UNTESTED**.

### 7. Failure injection and idempotency

No fault flags or fake provider were used against production and finalize
replay was not triggered. **UNTESTED**. Next measurement: run the
`tests/manual/` fault matrix against the local Tilt stack with the Mistral
adapter and the captured B3 422 shape, then replay finalize on A and
assert byte identical generation ids.

## Every native vs OpenRouter difference observed

1. Invalid body: native rejects at upload with per line pydantic detail,
   OpenRouter accepts (202) then fails the batch 4 s later with one
   message naming the first offending line only.
2. Unknown `tool_choice` function: native `errors[].message` +
   `line_number`, OpenRouter `HTTP 422: Invalid file format.` (BUG).
3. Image URL: native attempts the fetch per line, OpenRouter rejects the
   whole batch before upload (EXPECTED LIMITATION).
4. Malformed JSONL: native 422 at upload, OpenRouter synchronous 400 at
   create.
5. Read after create: both surfaces can 404 for a few seconds (observed
   once each, A on OpenRouter, D on native). Parity, not a bug.
9. Native error file lines carry `response.body` as a JSON string
   (double encoded), not an object. Success lines carry an object.
   Feeding the captured line through the production
   `parseMistralBatchResult` (E11) yields `error.message: "Upstream
   request failed with status 400."`, `type: invalid_request_error`. The
   native `message` ("File could not be fetched from url ...") and `type`
   (`invalid_request_file`) are dropped because `parseMistralError` only
   reads objects. BUG (1h), not yet observed on the live OpenRouter path.
6. Response shape: OpenRouter adds `provider`, `system_fingerprint`,
   `service_tier`, `logprobs`, `native_finish_reason`, `refusal`,
   `reasoning`, and normalizes `usage` into OpenAI style details. Native
   message carries `tool_call_id`, `index`, `metadata`.
7. Cached tokens: 128 native vs 0 OpenRouter on the multi tool line
   (separate executions, UNTESTED).
8. Response `model`: OpenRouter serves `mistralai/mistral-medium-3-5:batch`
   while the batch row says `mistralai/mistral-medium-3.5-20260430`.

## Evidence

- **E1 (Measured)** ClickHouse, exact ids from the served
  `response.body.id` values, `default.generations WHERE created_at >=
  '2026-09-04' AND generation_id IN (14 ids in evidence.json)`. 14 rows,
  all `provider_name=Mistral`, `variant=batch`,
  `tokens_*` equal to served usage, `usage = usage_upstream`,
  `byok_usage_inference=0`, `native_tokens_cached=0`. Per row `usage`
  in evidence.json. Note the `usage` column is stored at 6 decimals
  (0.000024 for a 0.00002475 line), aggregates come from the finalize log.
- **E2 (Observed)** Datadog `batch_api.emit_generations.done` for A:
  `emitted:5 estimated:0 failed:0 skipped:0 unaccounted:0 total_lines:5
  unmatched_output_lines:0 total_usage:0.00012375`. For D2: `emitted:9 ...
  total_usage:0.00189825`.
- **E3 (Observed)** Datadog `batch_api.finalize.completed` for A:
  `is_usage_complete:true served_requests:5 served_error_requests:0
  failed:0 batch_level_failed:0`. For D2: same with 9. `finalized_cost`
  was not recorded from these log lines.
- **E3a (Observed + code)** The served `usage.cost` in E6 (A 0.00012375,
  D2 0.00189825) is the persisted finalized cost: GET
  (`services/batch-api/src/read/get-batch.ts`) serves the stored
  `job.usage`, which finalize (`finalize-batch-job.ts`) writes from the
  same `usage` object it logs as `finalized_cost`. Both equal the
  independent pricing calculation in 5a.
- **E4 (Observed)** Native B2 and D job objects, `succeeded_requests`
  3 and 9, `failed_requests` 1 and 1, error file lines carrying
  `response.status_code:400` with `type:invalid_request_file`.
- **E5 (Observed)** Datadog lifecycle records for A and D2, query in
  section 6, window 2026-09-04 01:00 to 13:00 UTC.
- **E6 (Observed)** OpenRouter final poll bodies (status, request_counts,
  usage, finalized_at), redacted in evidence.json.
- **E7 (Observed)** Datadog for B, B2, D: rejection location and status
  (400 `assertMinimumMaxTokensCap`, 422 `assertImageInputCapability`),
  permanent failure record written.
- **E8 (Observed)** Datadog for B3: three `uploadMistralFile` attempts,
  two HTTP 502 then HTTP 422, batch marked failed with `HTTP 422:
  Invalid file format.`
- **E9 (Measured)** ClickHouse `upstream_raw_response_usage`,
  `usage_cache` are null on the sampled A and D2 rows.
- **E10 (Observed)** `first_poll_statuses` in evidence.json are the
  first three polls of each poll loop: native D `[404, 200, 200]`,
  native A and B2 `[200, 200, 200]`. For OpenRouter A the 404 came from
  a separate GET issued immediately after the 202 create, before the
  poll loop started (`openrouter_A_first_poll`); the loop's first three
  polls were all 200 `in_progress`. Redacted native error line: now
  `packages/batch/adapters/mistral/fixtures/live-error-file-line-string-body.json`.
- **E11 (Reproduced)** `parseMistralBatchResult(fixtureLine, 0)` on
  the captured native error line (now
  `packages/batch/adapters/mistral/fixtures/live-error-file-line-string-body.json`) under bun:test
  returned `response:null, error:{type:'invalid_request_error',
  message:'Upstream request failed with status 400.'}`. Deterministic pure
  function on a live native capture. Not observed through a live
  OpenRouter batch (1g).
- **Refutation attempts.** Billing: recomputed from advertised pricing
  and from per row sums, both agree. Cache: checked that other Mistral
  batch rows carry nonzero `native_tokens_cached` before treating 0 as
  suspicious (they do, so no bug claim). Stall: submitted a 3b control
  job to rule out an OpenRouter side stall.

## Issues

1. **BUG, low.** Mistral upload 422 detail dropped. Impact: a customer
   with one bad `tool_choice` line in a large batch gets `HTTP 422:
   Invalid file format.` and cannot locate the line. Repro: B3 above.
   Docs: https://docs.mistral.ai/capabilities/batch. Code:
   `packages/batch/adapters/mistral/mistral-fetch.ts`
   `MistralErrorResponseSchema`. Sync path: the router Mistral adapter
   has no `detail` parser to reuse. Smallest fix: extend the schema with
   optional `description` and `errors: [{message, line_number}]` and
   append them to the message. Regression test: fixture from the B3
   capture through `handleMistralErrorResponse`. Fixed by #40348;
   fixtures and tests now in `packages/batch/adapters/mistral/`:
   `fixtures/live-upload-422-line-errors.json` (B3) and
   `fixtures/live-upload-422-body-validation-errors.json` (B), pinned in
   `mistral-fetch.test.ts`.
2. **BUG, low.** Native error file lines carry `response.body` as a JSON
   string. `parseMistralError` reads only objects, so served failure rows
   lose Mistral's `message` and `type` and show the generic "Upstream
   request failed with status 400." Impact: a customer cannot tell why a
   line failed (bad URL vs. content policy vs. context length). Repro:
   E11. Docs: https://docs.mistral.ai/capabilities/batch. Code:
   `packages/batch/adapters/mistral/output-parser.ts` `parseMistralError`.
   Sync path: none, the sync adapter never sees string bodies. Smallest
   fix: when `response.body` is a string, `safeParseJson` it before
   `parseMistralError`, and record `[capture]` string-encoded error bodies
   in the Mistral research note. Regression test: the fixture above
   through `parseMistralBatchResult`, expect `type: invalid_request_file`.
   Fixed by #40348, pinned in `output-parser.test.ts`.
3. **COVERAGE GAP.** No live evidence for Mistral per line failure
   serving/billing (1g, 5b, including the string-encoded error body in
   difference 9) or for fault injection/idempotency (7).

## Verdict derivation

Case verdicts: PASS 1a 1b 1c 1e 1f 2 3 5a 5d 6. EXPECTED LIMITATION 4a.
BUG 1d 1h (reproduced from a live native capture, not yet observed on the
OpenRouter serving path). UNTESTED 1g 4b 5b 5c 5e 5f 7 (and
expiry/cancel). Any
unresolved BUG, or missing live evidence for a core lifecycle item
(failed line billing, idempotency), yields **NOT SAFE** under the skill's
rubric. Clearing 1d, 1h, 1g, and 7 would move this to SAFE WITH KNOWN
LIMITS.
