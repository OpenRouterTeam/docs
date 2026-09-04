---
name: batch-adapter-dogfooding
description: >-
  Terminal provider-parity phase for Batch API adapters. Runs a fixed
  dogfooding matrix (isolation/errors, tools, structured outputs,
  multimodal, billing/BYOK/reasoning/search/caching, operational tracing,
  failure injection) both directly against the provider's native batch
  API and through OpenRouter, and produces an evidence report with
  per-case and per-provider verdicts. Use as the final phase of
  batch-api-development, or standalone to re-certify an already-shipped
  batch adapter (e.g. xAI, Vertex Gemini).
user-invocable: true
---

# Batch Adapter Dogfooding

Final phase of [`batch-api-development`](../batch-api-development/SKILL.md).
Everything before this phase proves the adapter against fixtures, fakes,
and its own tests. This phase proves it against reality: the same request
run natively against the provider and through OpenRouter must behave the
same way, bill correctly, and leave the shared batch machinery healthy.

Treat docs, research notes, and existing tests as **claims to verify, not
proof**. The research note (`docs/batch-research/<provider>.md`) tells you
what the provider claimed at capture time; this phase re-checks the
load-bearing claims live.

## Ground rules

- Never push production code or merge anything from this phase. Output is
  evidence, filed bugs/coverage gaps, and (optionally) new redacted
  fixtures and `tests/manual/` cases.
- Keep live batches small and cheap: minimum lines per case, cheapest
  batch-enabled model, cancel throwaway batches promptly.
- There is no public `POST /batches/:id/cancel` route (`packages/batch/routes/`),
  so cancel cases are native-only; a 404 from OpenRouter is the expected surface, not a `BUG`.
- Use existing credentials only (Infisical / provisioned secrets). Never
  hardcode or print keys. If a credential does not exist for a case
  (e.g. direct provider key, BYOK key), the case is `UNTESTED`.
- If a case cannot be run live, mark it `UNTESTED` — never infer PASS
  from docs, sync behavior, or unit tests.
- Redact all captured payloads (keys, account/team ids, customer content)
  before committing anything.

## Evidence record

Every case in the matrix produces one record:

```text
Provider | Case | Expected native behavior (doc/research claim)
       | Direct upstream result | OpenRouter result | Billing evidence | Verdict
```

Verdicts: `PASS`, `BUG`, `EXPECTED LIMITATION`, `COVERAGE GAP`, `UNTESTED`.

- `PASS`: OpenRouter matches native behavior and bills correctly, with
  live evidence for both sides. Fixtures never substitute for a live
  run; a case without live evidence is `UNTESTED`.
- `BUG`: behavior or billing diverges from native, or shared machinery
  misbehaves.
- `EXPECTED LIMITATION`: a documented, deliberate divergence (e.g. an
  OpenRouter-side guard rejecting before submit). Cite where it is
  documented or enforced.
- `COVERAGE GAP`: behavior is correct or unknown but no test pins it, or
  a matrix case has no code path handling it.
- `UNTESTED`: could not be exercised. State exactly what was missing
  (credential, provider quota, non-inducible condition).

For every `BUG` or `COVERAGE GAP`, include: severity and customer impact,
smallest reproduction, official doc link, relevant `file:line` locations,
whether the sync path already contains logic batch should reuse, and the
smallest safe fix plus its regression test.

Every non-`PASS` verdict must carry a closure path, not just a label:

- `EXPECTED LIMITATION`: state the smallest change that would close the
  divergence (even if it is deliberately not being made) so the report
  doubles as a backlog of candidate fixes.
- `COVERAGE GAP`: the smallest safe fix and regression test (above).
- `UNTESTED`: the concrete next measurement that would resolve the case
  (which credential, quota, or setup is needed and what to run).

End the report with one verdict per provider, derived from the case
verdicts — never asserted independently:

- `SAFE`: every applicable case is a live `PASS` or a cited
  `EXPECTED LIMITATION`. No `BUG`, no `COVERAGE GAP`, no `UNTESTED`
  core-lifecycle case.
- `SAFE WITH KNOWN LIMITS`: the core lifecycle (isolation/errors,
  polling, results, finalization, billing of plain successful and failed
  lines) has live `PASS` evidence, but non-blocking cases remain
  `UNTESTED` or `COVERAGE GAP` — list each as a known limit with a
  filed issue.
- `NOT SAFE`: any unresolved `BUG`, or the core lifecycle itself lacks
  live evidence. An all-`UNTESTED` report is always `NOT SAFE` — a
  provider cannot be certified without live evidence.

Also list explicitly every case where OpenRouter behavior differs from
calling the provider directly.

The report is a durable artifact: commit it (redacted) under
`tests/manual/<yyyy-mm-dd>-<provider>-dogfood/` alongside any manual test
scripts and captures, per the `tests/manual/` convention.

## Test matrix

Run every applicable case both directly against the provider's native
batch API and through OpenRouter (production or the local stack per
[`batch-api-testing`](../batch-api-testing/SKILL.md) §Live verification).
Record the exact serialized provider request for serialization-sensitive
cases (structured outputs especially).

### 1. Batch isolation and errors

- Five valid requests.
- Four valid requests plus one syntactically valid JSONL line containing
  an invalid request (bad model, bad param).
- A syntactically invalid JSONL line, as a separate case.

Determine natively whether upload, batch creation, or only the bad
sub-request fails, then verify OpenRouter matches. If upstream returns
partial success, one bad line must not wedge polling, finalization,
serving, or billing of the good lines.

### 2. Tools

- One function tool.
- Several function tools with automatic selection.
- Forced `tool_choice`.
- Parallel tool calls where supported.
- Native web search, and web search combined with function tools where
  the provider supports the combination.

Verify tool names, arguments, call IDs, finish reasons, and response
serialization line by line. Unsupported combinations must fail clearly
before submission or return the same error shape as upstream (see
`packages/batch/schemas/assert-no-web-search.ts` for the current
submit-time guard pattern).

### 3. Structured outputs

- Basic JSON Schema.
- Nested objects, arrays, enums, required and optional fields.
- A schema using `$defs` and local `$ref`.
- A referenced definition reused in more than one location.
- Structured output combined with tools where supported.

For each case, capture the exact serialized provider request. Determine
whether the provider accepts references natively, whether OpenRouter must
dereference them, and whether the sync serializer already implements the
correct transform that batch should reuse (ECO-1670 parity: batch must
lower through the sync path's pure serializer). Vertex is the known-risky
provider here — see `packages/batch/adapters/vertex/gemini-inline-schema-refs.ts`
and its siblings for the current dereferencing behavior.

### 4. Multimodal inputs

Where the provider/model supports them: image URL, uploaded image or
file reference, and mixed text plus image. Account for model-specific
restrictions.

- OpenRouter must not block inputs the provider's batch API accepts.
- Unsupported inputs must fail deterministically at or before submit,
  never by creating an unusable upstream batch.

### 5. Billing, BYOK, reasoning, search, and caching

- Successful, failed, and partially successful lines bill per the
  provider's batch/async pricing rules.
- Reasoning tokens are counted exactly once (watch for providers that
  exclude reasoning from `completion_tokens` on the batch wire — xAI
  does; see `docs/batch-research/xai.md` §8).
- Native web-search charges are counted exactly once. Establish whether
  the provider-reported cost already includes search before adding any
  separate charge.
- Cached-token reporting and discounts are correct. Run a real cache hit
  if the provider supports caching in batch mode (submit the same long
  prefix twice; endpoint/account affinity matters — see ECO-3596).
- BYOK uses the caller's key, records the upstream cost, and charges only
  the OpenRouter BYOK fee. Failed or refused BYOK lines follow existing
  billing rules.

Billing evidence means the actual usage/charge records (generation rows,
pricing math against the provider's published batch rates), not the
adapter's own logs. A terminal `completed` status with every served line
`200` is **not** billing evidence: serving normalizes its own copy of each
row, billing parses the raw artifact line, and the two can diverge with
no visible error on the batch object. A `completed` batch whose
`usage` is all zeros is a billing failure, not settlement lag. Before
any billing `PASS`, confirm from the finalize logs that:

- `batch_api.emit_generations.done` accounts for every line:
  `emitted + estimated + failed + skipped == total_lines` and
  `unaccounted == 0`, where `emitted + estimated` equals the number of
  lines you expect to be billable (served `200`) and `failed` equals the
  lines you deliberately made fail. A deliberately failed line is
  non-billable and must not be counted as missing; a `200` line that
  lands in `skipped` or `unaccounted` is a billing bug.
- `batch_api.finalize.completed` reports `is_usage_complete: true`, and
  its `finalized_cost` matches the cost you compute independently from
  the `:batch` row's pricing and the per-line usage of the billable
  lines (cached prompt tokens at the cache-read price). Zero is a valid
  `finalized_cost` only when that independent figure is also zero (free
  pricing, or no billable line succeeded); a nonzero expected cost with
  `finalized_cost: 0` is a bug.

See §Procedure for the queries.

### 6. Operational tracing

Trace one live batch through upload, submission, polling, paginated
result retrieval, inline errors, finalization, and serving. Confirm:

- Input-file expiry is set as intended (xAI: `expires_after` must precede
  `file` in the multipart body).
- Result retrieval uses the handles the provider actually issues:
  batch-id-paginated providers must not invent output file IDs;
  file-handle providers must persist the upstream-issued IDs, never
  derive them (see `batch-api-audit` §H. Skin contract correctness).
- Output artifacts are job-isolated: no shared prefixes or paths that let
  concurrent jobs read or overwrite each other's results (ECO-3088 was
  exactly this on Vertex GCS output prefixes).
- Retryable upstream failures remain retryable; permanent request errors
  do not retry forever.
- Terminal failures carry a classified reason: a silent provider close
  must classify as a provider error, not OpenRouter infra (ECO-3042).
- Logs correlate OpenRouter batch id, upstream batch id, input file,
  provider, and failing stage, without exposing keys, customer content,
  internal billing fields, or provider-only response fields
  (e.g. `cost_in_usd_ticks` must be stripped from served output).

### 7. Failure injection

Inject failures (fake provider, fault flags, or targeted mocks in
`tests/manual/`) at upload, submit, poll, result-page retrieval,
transformation, persistence, and billing. Verify retries are idempotent
and cannot duplicate generations or charges — finalize replay must emit
byte-identical generation IDs.

## Lifecycle-health checks (recurring failure classes)

These come from real incidents. Check each one for the adapter under
test; they generalize to any provider:

- **Silent stall visibility** (ECO-3525): if the batch stops progressing
  without an error, does anything detect it? A lifecycle that can go
  quiet with no monitor or sweep signal is a `COVERAGE GAP`.
- **Sweep starvation** (ECO-3311): a long-running batch must keep getting
  polled even when many jobs are in flight. Verify a non-terminal poll
  still advances the job's sweep ordering.
- **Accept/worker validation skew** (ECO-3257): a body the async worker
  will reject should be rejected at accept time where feasible; at
  minimum the eventual failure must be served with a clear per-line or
  per-batch error, not a silently stuck batch.
- **Result cross-contamination** (ECO-3088): concurrent batches must not
  share output locations.
- **Unattributed terminal failures** (ECO-3042): every terminal failure
  must classify to the right error class for dashboards and alerts.
- **Canonical content preservation** (ECO-2517): reasoning and other
  canonical response fields must survive the batch result path unchanged
  relative to sync.
- **Moderation coverage** (ECO-1870): every JSONL line is moderated
  before fan-out, not just the first or a sample.
- **Deadline cleanup** (ECO-2773): when the OpenRouter-side lifecycle
  expires or is cancelled, the upstream batch is cancelled too.
- **Serving/billing divergence** (ECO-3718): a batch can serve every
  line as `200` while billing emits zero generations because the
  adapter leaves `transformBatchResponse` as identity on non-canonical
  native rows. Check `emit_generations.done` accounting, not the served
  results.

When a new incident class appears in Linear, add it here so the next
dogfooding run checks for it by default.

## Procedure

1. Read the provider's research note and current official docs (batch,
   tools, structured outputs, multimodal, caching, pricing). Diff the
   docs against the research note; doc drift is a finding.
2. Inventory credentials: direct provider key, OpenRouter test key, BYOK
   key. Anything missing bounds the matrix; record it up front.
3. Build the applicable matrix for the provider. A case the provider
   itself does not support is **not applicable**: record it with a doc
   citation and exclude it from the verdict derivation (`EXPECTED
   LIMITATION` is reserved for deliberate OpenRouter-side divergences).
   If provider support is unclear, the case is `UNTESTED`.
4. Run direct-native cases first, capturing raw transcripts to a scratch
   dir. Then run the same cases through OpenRouter.
   Local-stack gotchas: create the E2E pull subscriptions
   (`ensureSubmitSubscription()` / `ensureFinalizeSubscription()` in
   `tests/e2e/api/batches/helpers.ts`) **before** submitting — the
   emulator only pre-creates topics, and messages published before the
   subscription exists are lost, leaving batches stuck in `validating`.
   A submit 429 with `limit_source: openrouter_limiter_unavailable`
   means the `redis` + `serverless-redis-http` Tilt resources are off.
5. Fill in every evidence record. Pull billing evidence from generation
   rows / usage records, and operational evidence from logs
   (`dev-fs-logs` locally, Datadog in production). In production, query
   Datadog logs (`us5` site) with
   `service:batch-api* @data.jsonPayload.extra.job_id:<batch-id>` and
   read `batch_api.batch_accepted`, `batch_api.batch_submitted_upstream`,
   `batch_api.emit_generation.*`,
   `batch_api.emit_generations.done`, and `batch_api.finalize.completed`
   for that job. Same-day generation rows live in `default.generations`
   (keyed by `generation_id`, not `id`). Look up the exact IDs: each
   served result's `response.body.id` is already
   `genBatchId(jobId, customId, startedAt)`
   (`packages/batch/batch-generation-id.ts`), the same helper billing
   uses, so collect those IDs from the results you fetched and query
   `generation_id IN (...)` — never a
   `gen-batch-<unix-seconds>-` prefix, which every batch accepted in the
   same second shares, and never an `endpoint_id` + date filter alone,
   which also matches other customers' batches on the same row. Check
   the rows' `endpoint_id` equals the `:batch` row as a consistency
   check. An empty result only supports a no-charge claim when the
   finalize log agrees.
   Only the Batch API exercises batch adapters: the sync
   endpoint-testing routes reject `BatchAdapterName` rows.
6. Write the report, commit redacted artifacts under `tests/manual/`,
   and promote any newly captured native shapes into adapter fixtures
   when they cover a shape the fixtures lack.
7. File a Linear issue per `BUG`/`COVERAGE GAP` with the required detail,
   and update this skill's lifecycle-health list if a new failure class
   emerged.

## What this skill does NOT do

- Fix the bugs it finds — it files them with the smallest safe fix and
  regression test named.
- Replace the fake-provider e2e or intent tests of
  [`batch-api-testing`](../batch-api-testing/SKILL.md) — those run
  earlier and stay deterministic; this phase is deliberately live.
- Certify providers without evidence: no credential, no live run, no
  `PASS`.
