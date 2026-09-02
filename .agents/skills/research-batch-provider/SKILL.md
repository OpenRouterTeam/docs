---
name: research-batch-provider
description: >-
  Research a new batch provider (e.g. Anthropic, Gemini) end-to-end before
  any code is written. Produces a committed note at
  docs/batch-research/<provider>.md with a cited capability matrix, live
  captures per the capture matrix, and ready-to-import raw fixtures. The
  note is the contract that add-batch-provider, batch-api-audit, and
  batch-api-testing implement and audit against. Sub-skill of
  batch-api-development.
user-invocable: true
---

# Research Batch Provider

Phase 1 of batch provider onboarding
([`batch-api-development`](../batch-api-development/SKILL.md)). The goal is
to leave behind enough committed evidence that the schemas, skin decision,
adapter, fixtures, and tests can all be authored from this one note —
without revisiting vendor docs or re-running cURL.

Discovery is **agent-owned**: derive the endpoint shape, skin/adapter reuse
decision, fixture needs, and touched layers from the provider's official
docs, live captures, and the existing sync adapter. The human checkpoint
approves your conclusions; it does not supply them.

Pair with [`capture-matrix.md`](./capture-matrix.md) for the canonical
scenario list.

## Arguments

- `$PROVIDER_NAME` / `$PROVIDER_SLUG`: as in
  [`batch-api-development`](../batch-api-development/SKILL.md)
- Provider API key reachable — default lookup is Infisical
  (`/_providers` or the provider's dedicated path); never paste keys into
  the note or fixtures. Verify the machine identity can actually *read*
  the secret value (not just that the entry exists) before starting, so
  the live-capture step does not stall mid-phase

## Outputs

```text
docs/batch-research/<provider>.md          # the committed research note
packages/batch/adapters/<provider>/fixtures/   # raw provider shapes
  (or packages/batch/skins/<skin>/fixtures/ for skin-side shapes)
```

Committed fixtures include the **request inputs** captured per
batchable-request scenario (see the capture matrix), not only the
response/output shapes — so the tests below never hand-write request
payloads.

Raw capture transcripts stay in `/tmp/batch-research/<provider>/` and are
**not** committed; the note quotes the relevant redacted JSON inline.
No adapter code, no schema code, no registrations.

## Fixtures drive every layer

The batchable-request scenarios (`text`, `tool-calls`, `multi-system`,
`multi-turn`, `reasoning`, `structured-output`, `truncated`) are captured
here **once**, each as a real request+response pair, and every downstream
layer reads those captures — the same way the OpenAI fixtures already
work. Nothing below re-captures or invents payloads:

- The **fake provider** ([`fake-batch-provider`](../fake-batch-provider/SKILL.md))
  is built *from* these captures. It is never the fixture source —
  generating fixtures from the fake is circular.
- **Adapter request tests** (`adapters/<provider>/from-internal-request.test.ts`)
  consume the captured request inputs from
  `adapters/<provider>/fixtures.ts` — no inline hand-written request
  bodies.
- **Skin parity tests** (`skins/<skin>/parity.test.ts`) consume the
  captured response pairs from `skins/<skin>/fixtures/sync-*.json`.

If a test hand-writes a request body for a scenario the matrix covers,
the capture is missing — go back and capture it, don't invent it.

## The capability matrix (required note sections)

Every row cites an official doc URL and/or a live capture from the
capture matrix:

1. **Auth** — header/query scheme, key scope, org/project pinning
2. **Endpoints** — upload, create-batch, poll/get, results download,
   error-file download, cancel, list; note file-based vs inline
   submission. Record the exact API product and host; adjacent products
   from the same vendor are explicit exclusions, not interchangeable docs
3. **Request-line shape** — the provider-native per-line format; whether
   it matches an existing `BATCH_ENDPOINT_FAMILY` skin (Anthropic
   Messages, Gemini `generateContent`, OpenAI chat completions) or needs
   a new skin
4. **Status model** — every upstream status string, its meaning, and the
   proposed mapping to internal statuses (exhaustive table; call out
   `expired`/`cancelling`/partial states explicitly). Some providers
   expose no batch-level status string at all — only counters and
   lifecycle timestamps — in which case the note must specify the exact
   derivation rules (ordering and precedence included) the adapter will
   use to synthesize `BatchPollResult.status`. See
   [§Completion and per-request failure semantics](#completion-and-per-request-failure-semantics)
   for the questions this row must answer
5. **Output/error shapes** — success line, error line, separate error
   file semantics, mixed partial-success behavior, ordering and
   `custom_id` guarantees. Providers without output files may return
   results from a paginated results endpoint with inline per-row errors;
   record the pagination contract, including the terminal token value
   actually observed on the wire. State explicitly whether a success row
   is already canonical batch-output JSONL (`id`, `response.status_code`,
   `response.body`); when it is not, the adapter decisions must name the
   `transformBatchResponse` override, because billing reads the stored
   native row through that method
6. **Limits** — max lines/bytes per file, per-batch token limits,
   enqueued-job limits, rate-limit headers and backoff hints
7. **Expiry/retention** — completion window options and what happens to
   unfinished jobs, plus how long the provider stores our data. Give a
   cited duration per artifact, separately for each place the data lands,
   since they differ and are documented separately: the uploaded input
   (Files API object, inlined request body, or a bucket we own), the batch
   job record, and the results (output/error file, inline results
   endpoint, or storage prefix). Per artifact record the documented
   retention, the field carrying the concrete deadline where one exists
   (`expires_at` and friends), whether the clock starts at upload, submit
   or completion, what a read after expiry returns, and whether the
   provider deletes on its own or keeps the artifact until we delete it.
   State whether deletion is possible and through which call. Then state
   the two consequences: retention is a deadline on finalize, which is
   what copies provider results into our storage, and a retention window
   shorter than our sweep or retry window must be flagged here. If the
   provider documents a ZDR or no-retention mode, record whether it
   applies to batch
8. **Pricing** — batch discount vs sync pricing, per-request fees,
   how usage is reported per line. Record whether the provider reports
   an authoritative per-request cost (field name, unit, and conversion
   to USD): a direct provider cost takes precedence over token-derived
   pricing in finalization, so dropping it in the response transform is
   a billing defect, not an optimization
9. **Sync-transform overrides** — does the provider's live sync adapter
   override `transformRequest`/`getReasoningEffort`? If yes,
   `OpenAIBatchAdapter` reuse is forbidden (see the factory doc comment
   in `services/batch-api/src/adapters/adapter-factory.ts`)
10. **OpenRouter mapping decision** — the concluded reuse-vs-new call for
    skin and adapter, the planned layer list, and the fixture plan
11. **OpenRouter endpoint intersection** — documented batch models
    intersected with active OpenRouter endpoints, the requested modality,
    and a minimal live batch. Record every excluded preview, partner,
    tuned, historical, or non-requested model with its reason
12. **Credential shape** — platform and BYOK credential formats, including
    runtime validation, documented separately: they may differ per path.
    Vertex platform auth uses ADC/workload identity (no key material);
    Google BYOK is rejected until batch artifact ownership is designed,
    since jobs and GCS artifacts run in the OpenRouter platform project.
    Record whether BYOK is even supportable, not just its key format
13. **Artifact handles** — what poll stores for terminal result discovery.
    Treat `output_file_id` as the shared provider result-handle slot: it may
    contain a Files API id or, for Vertex, a GCS output prefix
14. **Remote URL inputs** — whether the provider's *batch* line format
    natively accepts a public image URL and a public file/PDF URL, or only
    inlined base64. Answer per modality and per wire, and cite the batch
    docs, not the sync docs: a provider whose sync API takes an image URL
    can still have a batch serializer with no field for it. Record the
    native field name, the accepted schemes and content types, whether the
    provider fetches the URL itself, and what it returns when the fetch
    fails. The two decisions land on seams of different granularity, so
    record them at that granularity. `batchAdapterSupportsImageUrls`
    (`packages/batch/adapters/image-url-support.ts`) keys on the adapter
    name alone, so one answer per adapter. `batchAdapterSupportsFileUrls`
    (`packages/batch/adapters/file-url-support.ts`) takes the endpoint row
    and may branch on the wire it lowers to (OpenAI answers true only for
    the Responses wire), so file URL support is answered per endpoint and
    wire, not once per provider. Both default to unsupported with a
    caller-facing reason, so an unresearched provider silently tells users
    to fall back to the sync API. Unverified is a valid conclusion, but it
    must be the stated one

## Completion and per-request failure semantics

Providers diverge most in how they report completion and per-request
failure. Rows 4 and 5 answer the three questions below from the official
docs, citing a doc URL per claim, and cite the terminal capture where one
exists. A missing capture does not hold up sign-off. Mark every
doc-only answer as unconfirmed, and validate the adapter against real
upstream payloads once they exist (see
[§Deferred captures](#deferred-captures)).

**1. How does the provider say the batch is done?**

- The exhaustive list of status strings and which are terminal. Anything
  outside `UpstreamBatchStatus` (`packages/batch/schemas/batch-status.ts`)
  must be mapped here, because `BaseBatchAdapter.submitBatchInput` fails
  the submit with a 502 on an unrecognized status string.
- Whether a terminal status means *every* sub-request finished, or only
  that the job stopped. Anthropic reports one `ended` status and puts the
  per-request outcomes in `request_counts`; Vertex has a distinct
  `JOB_STATE_PARTIALLY_SUCCEEDED`; OpenAI-shaped providers report
  `completed` with a populated `error_file_id`.
- Whether results are readable before the terminal status, and whether a
  batch-level `failed`/`expired` still produces readable output.
- Which field carries a batch-level failure explanation and per-line
  error entries, since a batch rejected as a whole has no result rows to
  explain it.

**2. When the batch is done, how do failed sub-requests appear?**

- Where a failed line lives: inline in the output file, in a separate
  error file, or as a discriminated result type in one stream
  (Anthropic's `result.type` of `succeeded`/`errored`/`canceled`/`expired`).
- The error envelope's exact shape, including whether `custom_id`, an
  HTTP status, a code, and a message are all present. Without `custom_id`
  on the error line, the failure cannot be correlated to an input line.
- Whether cancelled and expired sub-requests appear as lines at all, or
  only as counters.
- Whether a failed line ever carries usage, and whether the provider
  charges for failed sub-requests. Finalization bills only lines whose
  response status is 200, so a provider that charges for failures is a
  gap to raise at sign-off, not something the adapter absorbs.
- Whether per-outcome counters exist and what they sum to, so the note
  can define `total`/`completed`/`failed` for this provider rather than
  leaving the adapter to guess.

**3. How does that reach the adapter?**

Name the seam for each answer above, so the implementation phase has no
remaining judgement calls:

| Provider fact | Adapter seam |
| --- | --- |
| status string → lifecycle | `pollBatch` → `BatchPollResult.status` |
| per-outcome counters | `pollBatch` → `BatchPollResult.request_counts` |
| batch-level failure text/codes | `pollBatch` → `failure_reason` / `failure_codes` |
| terminal result handle (file id or GCS prefix) | `pollBatch` → `output_file_id`, plus `error_file_id` when separate |
| per-line success body | `parseResult` → `BatchResult.response` |
| per-line error envelope | `parseResult` → `BatchResult.error` |
| per-line usage on successful lines | `parseUsage` |
| native public image URL support, per adapter | `batchAdapterSupportsImageUrls(adapterName)` |
| native public file/PDF URL support, per endpoint and wire | `batchAdapterSupportsFileUrls(endpoint)` |

Two mapping rules the note must state its conclusion against, because
both are load-bearing downstream:

- A job whose sub-requests partly failed maps to `completed`, never
  `failed`. `failed` suppresses the results the caller is entitled to
  read.
- A failed line is a normal result row carrying `error` instead of
  `response`, not a dropped line. This holds for every outcome the
  provider emits as a line. `parseResult` cannot invent a row for an
  outcome reported only as a counter, so when cancelled or expired
  sub-requests have no line, say so, state which inputs end up with no
  row at all, and decide the handling. The read path joins on the lines
  the provider emitted and resolves inputs by `custom_id` without
  enumerating them, so synthesizing the missing rows is orchestration-layer
  work that has to be specified, or the note accepts the missing rows and
  says how the caller sees the count discrepancy.

## Procedure

1. Read the provider's official batch docs; fill the matrix with cited
   claims.
   When a live capture contradicts the docs (field names, terminal
   pagination values, timestamp formats), record the divergence in the
   note and model the adapter and fake from the capture, not the doc.
2. Run as much of the [capture matrix](./capture-matrix.md) live against
   the provider as the credential and the provider's own limits allow;
   record what could not be captured rather than stalling. Save raw
   status/headers/body per scenario in `/tmp`, redact, and promote the
   load-bearing shapes into the note and fixtures
   (capture mechanics: [`batch-sync-fixtures`](../batch-sync-fixtures/SKILL.md)).
   For each batchable-request scenario, commit the captured **request
   input** into `adapters/<provider>/fixtures.ts` alongside the response
   line, tagged with the same provenance — this is what the adapter's
   `from-internal-request` tests consume.
3. Read the provider's existing sync adapter for override behavior
   (matrix row 9).
4. Answer the three
   [completion and failure questions](#completion-and-per-request-failure-semantics)
   before proposing the status mapping, from the terminal captures where
   they exist and from the docs otherwise, marking which answers are
   doc-only.
5. Write the note, commit it with the fixtures, and present the
   conclusions (status mapping, skin decision, adapter plan, stack layer
   list) for human sign-off before any implementation. Doc-only answers
   are enough to sign off, provided the note marks them.

For Vertex Gemini, verify both regional
`{location}-aiplatform.googleapis.com` and the unprefixed global
`aiplatform.googleapis.com` host. Normalize model ids such as
`gemini-2.5-flash` to `publishers/google/models/gemini-2.5-flash` at the
provider boundary.

## Gotchas from live runs

Learned running this skill against xAI (`docs/batch-research/xai.md`),
where the whole status model is counters:

- **Never trust a counter as a terminal signal without watching it over
  time.** xAI's cancel set `num_cancelled: 5, num_pending: 0`, then
  reverted to `num_success: 5, num_cancelled: 0` twenty seconds later as
  the in-flight work landed. On a counter-only provider, poll the same
  batch repeatedly across a state change and record whether the counters
  are monotonic; map lifecycle off a durable field (a cancel timestamp)
  before falling back to counters.
- **Separate admission-time from execution-time validation.** A provider
  may reject an entire add/submit call on one bad line — an unsupported
  model and a duplicate line id both did on xAI — so a probe built from
  obviously-invalid lines tests the wrong thing and admits nothing. Build
  the mixed job from inputs that pass admission and fail while running
  (a negative `max_tokens`, an unfetchable image URL), then probe
  admission rejection separately.
- **Verify documented field names against a live payload.** xAI's prose
  says `expires_at`; the object carries `expire_time`, date-only.
- **Probe remote-URL field names by trying the variants.** xAI takes
  `file.url`, not OpenAI's `file.file_url`, and reports the wrong one as a
  per-line error rather than a rejection.
- **A request can sit `pending` with no error and no deadline.** Two xAI
  probes never resolved. Record whether the provider documents a
  per-request timeout; without one, the adapter needs its own.

## Deferred captures

A capture the credential or the provider's own limits made impossible is
deferred, not dropped. Implementation may proceed on doc-derived
fixtures, under these terms.

- Tag every doc-derived fixture with `provenance: 'docs'` and the doc URL
  it came from, so a later real capture replaces a marked value rather
  than an assumed one.
- List the deferred captures in the note under a **Deferred** heading,
  each with the reason and the field it leaves unconfirmed.
- Nothing serves production traffic on doc-derived fixtures alone. Land
  the contract, skin, and adapter layers, hold the runtime registration
  and the `:batch` endpoint rows that together make the provider
  reachable, then replay the real payloads through `pollBatch`,
  `parseResult`, and `parseUsage` and correct whichever doc-only answers
  they contradict
  ([`add-batch-provider`](../add-batch-provider/SKILL.md) owns the gate).

## Related skills

- [`batch-api-development`](../batch-api-development/SKILL.md) — invokes
  this as Phase 1
- [`batch-sync-fixtures`](../batch-sync-fixtures/SKILL.md) — capture,
  redaction, and fixture-loader mechanics
- [`add-batch-provider`](../add-batch-provider/SKILL.md) — implements from
  this note
- [`audio-research-provider`](../audio-research-provider/SKILL.md) — the
  pattern this mirrors
