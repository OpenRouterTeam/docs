---
name: audio-research-provider
description: "Phase 1: research a new speech-to-text (STT) or text-to-speech (TTS) provider end-to-end before code is written. Produces a cited research note, live captures, and ready-to-import fixtures. Sub-skill of audio-provider-onboarding."
user-invocable: true
---

## Shared research policy

Apply these gates to both modalities before implementation:

- Check the launch/chat thread for provider capabilities already dropped in by the requester; treat them as the primary capability input and reconcile them against provider documentation rather than starting from scratch.
- Define the billable unit from the provider's primary pricing source, recording the URL and date. Never substitute an estimate.
- Enumerate every request-level pricing modifier and decide its SKU, endpoint, pinned parameter, or explicit unsupported status.
- Reconcile captured usage against the published rate and document any mismatch.
- If primary-source pricing cannot be verified, stop and escalate to the invoker using the escalation format in the STT section below.
- Enumerate the provider's FULL advertised parameter surface (voices, formats, sample rates, speeds, languages). Where the provider supports values our serving enums or Zod schemas lack, record them in the note so the adapter PR extends the serving schema in the same PR (see the completeness rule in [`audio-add-adapter`](../audio-add-adapter/SKILL.md)).

## STT

The first phase of STT provider onboarding. The goal is to leave behind enough
evidence that the adapter, pricing strategy, fixtures, and DB rows can all be
authored from this one note — without revisiting the provider's docs or
re-running cURL.

Invoke this skill before writing any adapter code. Pair with the companion
[`capture-matrix.md`](./capture-matrix.md) for the canonical list of scenarios
to capture.

### When to invoke

- Adding a brand new STT provider to OpenRouter (e.g. "research deepgram STT",
  "research assemblyai STT")
- Refreshing an existing provider whose API has changed materially (new
  pricing, new endpoint shape, new billing floor)

If the provider already has a research note at `docs/stt-research/<provider>.md`
and the upstream surface has not changed, prefer reading the note over
re-running this skill.

### Prerequisites

- Provider's lowercase slug picked (matches `ProviderName.*` in
  `packages/enums/providers.ts`)
- Provider API key reachable. Default lookup path is Infisical
  (`/services/cfw-stt-api` or the provider's dedicated path). See
  [CLAUDE.md](../../../CLAUDE.md) → "Secret Management" for the Infisical
  non-interactive flow.
- One short reference audio file (~5 seconds, clean speech, English) on disk.
  `tests/e2e/api/stt/helpers.ts` exposes `generateTestWavBase64()` if you need
  a synthetic clip; otherwise drop a real `.wav` into a scratch dir.
- Optional: a second, longer reference audio (~30 seconds) for long-audio and
  cost-reconciliation captures.

### Outputs

By the end of this skill the repo contains:

```text
docs/stt-research/<provider>.md
packages/stt/adapters/<provider>/fixtures/
  <scenario>.request.json              # canonical request snapshot
  <scenario>.response.json             # canonical response snapshot
  README.md                            # one-line description per fixture
```

Nothing else. No adapter code, no pricing strategy code, no DB seeds.

**Raw cURL captures are NOT committed.** They are working artifacts you
produce locally (under `/tmp/stt-research/<provider>/captures/` or any
scratch directory of your choice) and reference inline in the research
note by pasting the relevant JSON. The research note is the canonical
view; the captures dir is throwaway evidence. The previous version of
this skill committed `docs/stt-research/<provider>/captures/<scenario>.{request.sh,response.json,response.headers}`
— that pattern is deprecated. See
`docs/stt-research/openai-gpt-transcribe.md` for the inline-JSON pattern.

### Phase A — Doc pass

WebFetch the provider's official STT documentation. Extract these fields
into draft notes (final form lands in Phase D). The doc pass is the
weakest part of this skill — vendor docs lie, omit, and contradict their
own API surprisingly often. Phase B is where the real research happens.
The doc pass is best treated as "generate a hypothesis we can confirm or
falsify with cURL".

#### A.0 — Scope decision (do this first)

Many providers ship multimodal model families where the same brand name
covers several capability surfaces (e.g. transcription, audio chat,
realtime, TTS). Before extracting field-level details, decide which
**single** lane this research pass targets:

- Hit `GET <provider>/v1/models` (or equivalent) and filter for the
  `audio_transcription` / equivalent capability flag.
- Inspect aliases: `<brand>-latest` may resolve to a different underlying
  model per capability. Pin a dated model id (`<brand>-YYMM`) in the
  research note rather than the floating alias.
- Cross-check on the live endpoint by sending a request with the
  sibling-capability model id (e.g. the audio-chat variant against the
  transcription endpoint) — a well-engineered provider rejects with a
  clear `invalid_model` message. Note the rejection envelope in the
  research note's "Quirks" section if the upstream silently routes to
  a working model instead of rejecting.

The research note's first section is the scope statement: which lane,
which model id, what is explicitly deferred.

#### A.1 — Field extraction

For the chosen lane, extract the fields below. For every request-side
field discovered, also classify whether it affects the **response shape**,
the **billing**, both, or neither. These two attributes are non-optional:
every shape-affecting field must be admitted by the adapter's response
Zod schema before ship, and every billing-affecting field must be
accounted for by the pricing strategy. Argument classifications get
enumerated in the research note's "Shape-affecting and billing-affecting
request arguments" table (Phase D).

1. **Endpoint URL(s)** — exact path. Include sync vs async variants if both
   exist (we use sync only at OpenRouter today; note async for the
   "Open questions" section).
2. **Auth scheme** — Bearer, `x-api-key`, signed query string, service
   account, etc.
3. **Request body shape** — `multipart/form-data`, `application/json` with
   base64 `content` field, `application/json` with `data:audio/<fmt>;base64,…`
   data URI, or raw bytes. Also note whether the provider exposes a
   `file_url` or `file_id` upload mode.
4. **Supported audio formats** — record the exact format strings the provider
   accepts (e.g. `wav`, `mp3`, `flac`, `m4a`, `ogg`, `webm`, `aac`).
5. **Audio size / duration limits** — max file size in bytes, max duration in
   seconds, max sample rate.
6. **Rate limits** — RPS / RPM and per-key quotas (note both the published
   value and the observed limit if they differ). Phase B's response headers
   from scenario 1 are typically more honest than the docs page.
7. **Pricing model** — per second, per minute, per hour, or per token. Record
   the exact unit and price **from the provider's primary source** (official
   pricing page, API/billing docs, or contract rate card). Record the URL and
   the date checked. Providers publish different rates per **API mode**
   (pre-recorded REST vs streaming/WSS vs batch) — record the rate for the
   mode the adapter actually uses and mark the others out of scope. Never
   mix modes.
7b. **Request-level pricing modifiers** — enumerate every request parameter
   that changes the price without changing the model ID (e.g. Deepgram's
   `language=multi` selects a higher rate on the same `nova-3`).
   Each modifier needs an explicit decision: separate SKU, separate
   endpoint record, endpoint-pinned param, or explicitly unsupported.
   A missed modifier here becomes a silent under/overbilling bug.
8. **Minimum billed unit** — many providers floor sub-second clips to 1s,
   15s, 60s, or similar. Record the floor.
9. **Surcharges / opt-in features** — speaker diarization, language ID,
   timestamps, custom vocabularies. Note which add cost.
10. **Response shape** — top-level transcript field path, usage field path,
    error envelope shape, request ID location. Note whether the response
    shape can vary based on input (e.g. a `request_count` field that only
    appears for sharded long-audio requests, an `audio_tokens` field that
    only appears for short-audio requests).
11. **Error envelope** — exact JSON shape and HTTP status mapping for at least
    auth failure, unsupported format, and too-large payload. Some providers
    serve different envelopes from different layers (FastAPI auth handler
    vs Pydantic validator vs custom business logic) — capture each shape
    you encounter, do not assume one shape fits all 4xx responses.
12. **Documented constraints to validate live** — every "X is incompatible
    with Y" / "feature A requires feature B" claim in the docs becomes a
    `doc-constraint-validation` capture (scenario 12). The capture either
    confirms the constraint (in which case the adapter enforces it) or
    proves the docs are stale (in which case the note records the
    discrepancy).

Capture sources with URLs in the note so future researchers can re-verify.

#### A.2 — When pricing cannot be verified

If the provider's primary source does not surface a usable rate for the
API mode in scope (rate gated behind a console, contradictory pages,
stale docs), **stop and escalate to the invoker** before any
pricing-dependent work (SKUs, pricing strategy, staging). Never
substitute a comparable-provider rate or announcement estimate — an
estimated rate that ships is a production billing bug.

Escalation message format:

```text
Pricing cannot be verified from the provider's primary source.
Checked: <URLs + date>
Missing/ambiguous: <rate, unit, API mode, or billing rule>
Blocked: <adapter pricing / SKU design / staging>
Please provide: <pricing page, rate card, or confirmed billing rule>
```

Non-pricing research (Phase B captures, response-shape work) may
continue while blocked. Mark the note's "Unit price" as
**BLOCKED — awaiting invoker** and every reconciliation row as
`unverified` until the authoritative rate lands.

Sometimes a rate genuinely isn't published — especially for a
request-level modifier on an otherwise-priced model. That does not mean
inventing one. If the pricing strategy has a documented fallback (e.g.
an unpriced modifier SKU billing at the base SKU's rate), that fallback
is the acceptable interim behavior — provided the research note names
the unpriced SKU, the escalation above was sent, and the fallback is
logged and its effective rate serialized (see `audio-add-adapter`).
The failure mode to avoid is silence: pricing that is missing must be
loudly visible in the note and in the agent's report to the invoker,
never quietly absorbed as if it were verified.

### Phase B — Live capture matrix

Run the cURL scenarios from [`capture-matrix.md`](./capture-matrix.md) against
the real provider. Save each invocation as **three artifacts** in your
scratch dir (`/tmp/stt-research/<provider>/captures/` is the suggested
location; the path does not matter, none of these files will be committed):

- `<scenario>.request.sh` — the literal cURL command (with the API key
  redacted as `$STT_API_KEY`)
- `<scenario>.response.json` — the raw upstream response body (pretty-print
  with `jq`)
- `<scenario>.response.headers` — the full HTTP response headers,
  captured via `curl -D <scenario>.response.headers`. Headers are where
  upstream rate-limit budgets, correlation IDs, and (often) the
  canonical billing unit live; the matrix's Phase D reconciliation
  depends on them.

These files are **local working artifacts**, not part of the PR. Their
job is to feed Phase D, where you inline the relevant JSON blocks into
the research note. Once Phase D is committed, you can delete the
scratch dir.

Twelve scenarios are mandatory; the matrix lists optional ones at the
bottom for providers with extra surface area.

Mandatory scenarios are summarized here for reference; consult
`capture-matrix.md` for the cURL templates:

| # | Scenario                    | Purpose                                       |
|---|-----------------------------|-----------------------------------------------|
| 1 | baseline                    | minimal viable request, 5s clip               |
| 2 | with-language               | explicit language hint                        |
| 3 | with-temperature            | non-default decoding parameter                |
| 4 | with-timestamps             | timestamp / verbose response                  |
| 5 | with-provider-options       | provider-specific passthrough field           |
| 6 | long-audio                  | ~30s clip, for billing reconciliation         |
| 7 | unsupported-format          | error envelope shape                          |
| 8 | bad-auth                    | 401 envelope                                  |
| 9 | oversize-payload            | 413 envelope                                  |
| 10| short-audio                 | sub-floor clip, exposes billing floor         |
| 11| empty-audio                 | edge case: silent clip, 0-token transcription |
| 12| doc-constraint-validation   | live-test every docs "X is incompatible with Y" claim |

If a scenario is not applicable (e.g. provider does not expose temperature
or only hosts one model on the brand), note that fact in Phase D under
the relevant section with one sentence explaining why.

Optional scenarios worth running early when the upstream supports them
(see `capture-matrix.md`):

- `sharding-threshold-probe` — same audio at 5s / 15s / 30s / 60s to
  detect whether the provider switches usage shape based on duration
  (e.g. introducing a `request_count` field or dropping `audio_tokens`).
  Critical because the adapter response schema must accept both shapes.
- `with-file-url` — if the upstream supports pulling audio from a URL
  rather than a multipart upload, capture it: useful future passthrough.
- `with-oai-passthrough` — pass OpenAI-compat fields
  (`response_format=verbose_json`, `prompt`, `seed`). Drives the
  adapter's `CORE_FIELDS` block list.

### Phase C — Billing reconciliation

For every captured response with `usage` data, compute:

- `measured_seconds` — duration we would bill from the response (the value
  the adapter's `extractDuration` will return)
- `expected_unit_cost` — published per-unit price from Phase A (or
  working estimate if pricing is gated; see A.2)
- `expected_billed_units` — `measured_seconds` rounded per the floor
- `expected_cost` — `expected_billed_units * expected_unit_cost`
- `provider_reported_cost` — if the provider returns a cost field (most do
  not), capture it here

Add a reconciliation table to the note (see Phase D, "Billing model" section).
Flag any scenario where `expected_cost` does not match an obvious provider
formula. Sub-floor scenarios should make the floor explicit — if the
upstream reports `usage.<unit>: 0` for a sub-floor clip, that means the
billing floor must be enforced **on our side**; record this as a hard
requirement for the dual-clamp pattern in `audio-stage-endpoint`'s Step 11.

### Phase D — Research note

Write `docs/stt-research/<provider>.md` with these sections, in this order.
Keep sections short — bullets and tables beat prose.

```markdown
# <Provider> STT Research

Last updated: <YYYY-MM-DD>
Researcher: <devin-session-id or github-handle>

### Scope

- Lane being onboarded: `<sync transcription | streaming | audio chat>`
- Primary model id: `<dated id, e.g. provider-mini-2602>`
- Explicitly deferred: `<list of sibling capabilities + reason>`

### Model map

From `GET <provider>/v1/models` filtered on the relevant capability flag.
List every model id (and alias) on this lane, with status and replacement
pointer. Highlight any `-latest` alias whose underlying model differs by
capability — we should pin the dated id in the endpoint row.

### Endpoint shape

- Sync URL: `<URL>`
- Auth: `<scheme>` (header: `<header-name>`)
- Body format: `<FormData | JSON | JSON+dataURI>`
- Default OpenRouter URL pattern (`<baseUrl>/audio/transcriptions`) compatible?
  - [ ] Yes — adapter can derive URL from `provider_info.baseUrl`
  - [ ] No — adapter must override `getUrl()` and pin the URL (document why)

### Request matrix

| Scenario | Format | Optional fields exercised | Notes |
| --- | --- | --- | --- |
| baseline | wav | — | inline JSON in scenario section below |
| ... | ... | ... | ... |

#### Shape-affecting and billing-affecting request arguments

**Any request argument that changes the response shape or the billing
MUST be documented here.** List every argument, classify whether it
changes response shape, billing, or both, and link to the scenario
capture that proves it. This table is the source of truth for two
downstream consumers:

- The adapter's response Zod schema must admit every observed shape —
  miss one and you ship a Zod parse failure to production.
- The pricing strategy must account for every billing-affecting argument —
  miss one and the provider silently under- or over-charges customers.

| Argument | Effect | Classification | Scenario evidence |
| --- | --- | --- | --- |
| `timestamp_granularities[]=word` | adds `words[]` array to response | response-shape | with-timestamps |
| `diarize=true` | adds `speakers[]` to response; doubles upstream price | both | with-provider-options |
| `language=auto` | adds `detected_language` to response | response-shape | with-language |
| `response_format=verbose_json` | switches whole envelope to verbose shape | response-shape | with-timestamps |
| ... | ... | ... | ... |

If the provider exposes none, write "none observed" with a sentence
explaining why (e.g. the API is single-shape and flat-priced). "None
observed" is acceptable; silently omitting a known shape- or
billing-affecting field is not.

### Response shape

- Transcript field: `<path>` (e.g. `output.choices[0].message.content[0].text`)
- Usage field: `<path>` (e.g. `usage.seconds`)
- Request ID field: `<path>` (often a response header, not a body field)
- Error envelope: `<JSON shape>`

If the response shape varies based on input (sharded long-audio vs
short-audio, language-detection on/off, timestamp granularities,
diarization toggle, etc.), document each shape inline in the research
note with the response JSON pasted directly under the scenario that
produced it. The adapter's Zod schema must admit all observed shapes,
and every shape-affecting argument that produced a divergent capture
MUST appear in the "Shape-affecting and billing-affecting request
arguments" table above.

### Billing model

- Unit: `<seconds | minutes | hours | tokens>`
- Floor: `<N>` (provider rounds sub-floor clips up to this)
- Surcharges: `<list>` (each with multiplier or flat add)
- Free passthrough fields: `<list>` (e.g. system prompts, vocabularies)

Every request argument that changes billing — directly (priced surcharge),
indirectly (changes the unit, e.g. tokens vs seconds), or by switching
the upstream's billing model entirely — MUST appear in the
"Shape-affecting and billing-affecting request arguments" table above
and cross-reference the surcharge listed here. Pricing-strategy code
relies on this enumeration being exhaustive.

#### Reconciliation

| Scenario | measured | floor | billed | unit price | expected cost | upstream cost | delta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 5.2s | 1s | 5.2s | $0.000035/s | $0.000182 | n/a | — |
| short-audio | 0.4s | 1s | 1s | $0.000035/s | $0.000035 | n/a | floor enforced |
| long-audio | 28.7s | 1s | 28.7s | $0.000035/s | $0.001004 | n/a | — |

### OpenRouter mapping

- Adapter shape: `<FormData | JSON ArrayBuffer>`
- URL strategy: `<inherit baseUrl | hardcode in getUrl() override>`
- Pricing strategy:
  - SKUs needed: `<list>`
  - Floor enforced at adapter (`getResponseUsageSeconds`) AND pricing strategy
    (`getFinalUsageResponse`)? `<yes/no — required when floor > 0>`
- Provider passthrough namespace: `provider.options.<slug>`
- Core fields blocklist (cannot be overridden via passthrough): `<list>`

### Quirks

Anything that will trip up an implementer: content-sniffing behavior,
silent format-renaming, off-by-one in usage units, async-only fields surfaced
in sync responses, response-shape switches based on input duration,
fields whose docs claim mutual exclusion that the live API ignores,
silently-dropped OpenAI-compat parameters, multipart values that reject
whitespace, undocumented cross-option constraints (e.g. "feature A
requires feature B and the docs do not say so"), and any
capability-overloaded aliases discovered in the model map.

### Error envelopes

Per-status-code documentation of the upstream error JSON. If the
provider serves multiple envelope shapes for the same status (FastAPI
auth handler vs Pydantic validator vs custom business logic), tabulate
each shape — the adapter has to handle all of them. Note any code
fields that switch type between string and integer between envelopes.
The shape summary is the source of truth — you do NOT need to paste
the full failure JSON inline unless it materially clarifies the shape
(in practice, the summary table is enough).

### Cool features (deferred)

Things we are not shipping in v1 but should track: diarization, word-level
timestamps, custom vocabularies, real-time streaming.

### Open questions

Anything that needs clarification from the provider or from Charles.
```

Inline the relevant request + response JSON directly in the note for
the key scenarios (5–7 is plenty; baseline + with-language +
with-timestamps + diarize/long-audio + url-mode + a format-probe summary).
Failure-case envelopes only need their **shape** documented, not full
JSON dumps. The reconciliation table is the deliverable Step 11 of
`audio-stage-endpoint` will check against.

### Phase E — Fixture wiring

Copy two captures into the adapter directory as canonical fixtures. These are
what the adapter unit tests will assert against:

```text
packages/stt/adapters/<provider>/fixtures/baseline.request.json
packages/stt/adapters/<provider>/fixtures/baseline.response.json
```

Rules:

- The `request.json` is the **parsed** body the adapter should produce
  (FormData fields serialized as a plain object, or the JSON body verbatim).
  See `packages/stt/adapters/alibaba/fixtures/qwen3-asr-flash-welcome.request.json`
  for the shape model — the canonical reference for both JSON-body and
  FormData fixture patterns.
- The `response.json` is the **raw upstream response** as captured, minus any
  API-key echoes or PII. Do not normalize the response shape — the adapter is
  what does the normalization.
- Add a one-line description per fixture in `fixtures/README.md`:

  ```markdown
  - `baseline.{request,response}.json` — 5s en-US clip, default options
  - `with-language.{request,response}.json` — 5s clip, language='es'
  ```

Pick scenarios that exercise the adapter's interesting branches (baseline +
with-language is the minimum). The full scenario set is captured inline in
the research note's "Scenarios" section — only the fixtures the unit
tests import are committed under `fixtures/`.

### Examples

#### "research deepgram stt" — first invocation

1. Pull `DEEPGRAM_API_KEY` from Infisical (`/services/cfw-stt-api`).
2. `mkdir -p /tmp/stt-research/deepgram/captures` (scratch dir, NOT committed).
3. WebFetch <https://developers.deepgram.com/reference/listen> and fill Phase A.
4. Run the 12 cURL scenarios from `capture-matrix.md`, saving triples into
   `/tmp/stt-research/deepgram/captures/`.
5. Compute reconciliation rows for the four scenarios with usage data.
6. Author the `deepgram.md` research note under `docs/stt-research/`, inlining
   the relevant request + response JSON for each scenario directly in the note.
7. Copy `baseline` and `with-language` captures into
   `packages/stt/adapters/deepgram/fixtures/`.
8. Optionally delete the scratch captures dir.

Output left for `audio-add-adapter` to pick up: research note + fixtures.

### Troubleshooting

**Provider returns 401 with no error body.** Capture the response headers
too — many providers signal auth failures via `WWW-Authenticate` rather than
the JSON body. Save as `bad-auth.response.headers`.

**Provider returns 200 with no `usage` field.** Note explicitly in the
"Quirks" section. The adapter will need to either (a) compute duration from
the audio bytes before sending, or (b) fall back to a billing floor.
Reference the Google Cloud adapter, which surfaces `wLog` on missing
`totalBilledDuration` rather than silently billing 0.

**cURL responses include non-deterministic fields** (e.g. `request_id`,
timestamps). That is fine in the inline-JSON view in the research note
(the note documents what the live API returns); for the
`fixtures/*.response.json` files, redact non-deterministic values to a
fixed placeholder so the adapter snapshot stays stable across reruns.

**Provider's docs claim a format is supported but it fails live.** Trust the
capture, not the docs. Note the discrepancy in "Quirks" with the scenario
filename. Vendor docs lie often enough that the canonical Alibaba adapter has
a multi-line comment documenting which advertised formats actually work
versus which silently rename or fail.

**You only have an async endpoint.** OpenRouter STT is sync-only today. File
the async endpoint under "Cool features (deferred)" and use the sync surface
for captures. If the provider has no sync surface at all, stop here and ask
Charles before going further — that is a meaningful architectural lift, not
just a new adapter.

### Companion files

- [`capture-matrix.md`](./capture-matrix.md) — canonical 12-scenario cURL
  template. Editable without touching this SKILL.

### Related skills

- [`audio-add-adapter`](../audio-add-adapter/SKILL.md) — next phase, consumes the
  research note + fixtures.
- [`audio-stage-endpoint`](../audio-stage-endpoint/SKILL.md) — Step 11
  reconciles against the billing table in this note.
- [`audio-provider-onboarding`](../audio-provider-onboarding/SKILL.md) — overall
  flow.

### Key source files for reference

| File | What to read it for |
| --- | --- |
| `packages/stt/adapters/base.ts` | Adapter contract; informs "OpenRouter mapping" section |
| `packages/stt/adapters/openai/index.ts` | Canonical FormData adapter |
| `packages/stt/adapters/google-cloud/index.ts` | Canonical JSON-body adapter with URL override |
| `packages/stt/adapters/groq/index.ts` | Inherits OpenAI; canonical billing-floor pattern |
| `packages/pricing/strategies/stt/strategy.ts` | OpenAI STT pricing strategy |
| `packages/pricing/strategies/stt/groq-strategy.ts` | Pricing-layer billing floor enforcement |
| `tests/e2e/api/stt/helpers.ts` | `generateTestWavBase64()` for synthetic test audio |

### If review moves the note out of the repo

Same hazard as TTS (see the TTS section below): if review relocates
`docs/stt-research/$PROVIDER_SLUG.md` out of the repo while the
fixtures stay in-repo, sweep every inbound reference (fixtures README,
adapter comments) in the same commit — inline the facts each reference
needs (endpoint, response fields, billing rules) or drop the sentence
entirely. Do not leave pointers to external trackers in repo files; a
bare file deletion leaves dangling pointers.


## TTS

Phase 1 of [`audio-provider-onboarding`](../audio-provider-onboarding/SKILL.md).
Everything downstream (adapter, pricing, staging, e2e) is built on this
note — a wrong billable-unit definition here becomes a billing bug in
production. No adapter code until the human signs off on the note.

### Arguments

- `$PROVIDER_SLUG`: lowercase provider slug (e.g. `deepgram`)
- `$MODEL_ID`: primary TTS model id (e.g. `aura-2`)

### Phase A — Documentation pass

Read the provider's TTS docs and record, with doc links, every item
below in `docs/tts-research/$PROVIDER_SLUG.md`:

#### Request surface

- Endpoint URL, HTTP method, and auth scheme (Bearer vs `Token` vs
  API-key header vs query param). `BaseTTSAdapter.getHeaders()` defaults
  to `Authorization: Bearer` + JSON — note every deviation.
- Request body/query shape: which fields go in the JSON body vs the query
  string vs the path.
- **Upstream model vs voice mapping.** OpenRouter sends `model`, `input`,
  `voice`, `response_format`, `speed`
  (`packages/tts/schemas/request/index.ts`). Some providers encode the
  voice in the model id (`aura-asteria-en`), some take a separate
  `voice`/`voice_id` field, some take both. Decide what
  `endpoint.provider_model_id` will hold and how `request.voice` maps.
- Text limits: max input length (and in what unit — characters, bytes,
  tokens) and behavior on overflow (413, truncation, chunking).
- Speed/rate support: native param, SSML prosody, or unsupported.
- Streaming/chunk behavior: does the provider stream raw audio bytes,
  SSE-wrapped base64 chunks (Mistral-style — see
  `packages/tts/adapters/mistral/decode-mistral-tts-stream.ts`), or only
  whole-file responses?
- Upstream request-ID headers: which of `request-id`, `x-request-id`,
  `x-amzn-requestid`, `apim-request-id` (auto-captured by
  `BaseTTSAdapter`) does the provider send — or a custom header the
  adapter must capture itself?
- Callback/webhook params (e.g. a `callback` URL for async synthesis):
  document them and flag the SSRF exposure — these must be blocked or
  never forwarded from user passthrough options.

#### Audio output

- Codec/container/MIME mappings for every supported `response_format`
  (`mp3`, `opus`, `aac`, `flac`, `wav`, `pcm`): the provider's param
  value and the exact `Content-Type` it returns.
- PCM details: sample rate (fixed or configurable), bit depth,
  endianness, and channel count — these feed
  `getPcmParameters()`/`TTSPcmParameters` and must be exact or playback
  is garbled.
- Which formats we will register in `TTS_ADAPTER_SUPPORTED_FORMATS`
  (`packages/tts/adapters/supported-formats.ts`).

#### Pricing and billing

- Pricing dimension: per character, per token, per byte, per second of
  output audio, or per request. Record the rate **from the provider's
  primary source** (official pricing page, API/billing docs, or contract
  rate card) with the URL and date checked. If the provider prices
  streaming and non-streaming synthesis differently, record only the
  mode the adapter uses and mark the other out of scope.
- **Request-level pricing modifiers** — enumerate every request param
  that changes the price without changing the model ID (voice tier,
  quality level, format premium). Each needs an explicit decision:
  separate SKU, separate endpoint record, pinned param, or explicitly
  unsupported.
- **If pricing cannot be verified from the primary source, stop and
  escalate to the invoker** using the escalation format in §A.2 above. Do
  not substitute a comparable-provider rate; do not proceed to SKU
  design or staging on an estimate.
- **The provider's billable-character definition** — this is the single
  highest-risk item. Pin down whether "character" means UTF-16 code
  units (`input.length` in JS — the `BaseTTSAdapter.getUsage()`
  default), Unicode code points, UTF-8 bytes, normalized/SSML-stripped
  text, or a provider-reported usage figure in the response/headers.
  Test with multi-byte input (emoji, CJK) in Phase B.
- Minimums (per-request character floors), model/voice premiums, volume
  tiers, and any params that add surcharges (e.g. higher-quality codec
  or timestamps).
- **Generic vs custom SKU decision**: can billing be expressed as
  `TTSSKU.Characters` (`tts:characters`,
  `packages/pricing/strategies/tts/skus.ts`) with the standard
  `TTSPricingStrategy`? If the provider bills on tokens or
  provider-reported usage, a custom strategy is needed (see
  `packages/pricing/strategies/gemini-tts/` and
  `PricingStrategy.GeminiTTS` in `packages/enums/pricing-strategy.ts`).

### Phase B — Live capture matrix

Get a trial key and capture real request/response pairs. Raw captures
live in `/tmp/` as working artifacts; inline the interesting parts into
the note. Required captures:

| #   | Scenario                           | What it proves                            |
| --- | ---------------------------------- | ----------------------------------------- |
| 1   | Compressed audio (mp3/opus)        | happy path, Content-Type mapping          |
| 2   | PCM output                         | sample rate/bit depth/endianness/channels |
| 3   | Alternate voice                    | voice mapping actually switches voices    |
| 4   | Speed param (if supported)         | speed plumbing / ignored behavior         |
| 5   | Invalid request (bad voice/format) | error status + body shape                 |
| 6   | Auth failure (bad key)             | 401/403 shape, auth scheme confirmation   |

For each: save the exact request (URL, headers minus key, body), response
status, response headers (Content-Type, request-ID header, any usage
headers), and for audio responses the byte length plus a local playback
check (`ffprobe` or `ffplay`) confirming the audio is decodable and
non-empty.

Also capture a multi-byte input (emoji/CJK) and reconcile the provider's
reported billed characters against `input.length`, code-point count, and
UTF-8 byte count to settle the billable-unit question with evidence.

### Phase C — Billing reconciliation

Build a small table: for 2–3 captures, compute expected cost from the
published price and your chosen unit definition, and compare with the
provider dashboard/usage API. Any mismatch means your unit definition is
wrong — fix it before sign-off.

### Phase D — Research note

`docs/tts-research/$PROVIDER_SLUG.md` sections, in order:

1. Summary + doc links
2. Request surface (endpoint, auth, body, model/voice mapping, limits,
   speed, streaming, request-ID, callbacks/SSRF)
3. Audio output (format/MIME table, PCM parameters, supported-formats
   decision)
4. Pricing (dimension, billable-unit definition with evidence, minimums/
   premiums/tiers/surcharges, generic-vs-custom SKU decision)
5. Capture matrix with inlined evidence
6. Billing reconciliation table
7. Open questions for the human checkpoint

### Phase E — Fixtures

Wire the captures into adapter-test fixtures at
`packages/tts/adapters/$PROVIDER_SLUG/fixtures/` (e.g.
`baseline.request.json`, `with-voice.request.json`, plus error-body
fixtures). Binary audio bodies are not committed — record byte length and
Content-Type instead.

### Done when

- The note is complete with every Phase A item answered and Phase B/C
  evidence inlined
- The billable-unit and SKU decisions are explicit and human-approved
- Fixtures exist for the adapter tests

### If review moves the note out of the repo

Review may direct relocating the research note out of the repo while
the fixtures stay in-repo. When that happens, sweep every inbound
reference to `docs/tts-research/$PROVIDER_SLUG.md` (the fixtures
README, adapter comments) in the same commit — inline the facts each
reference needs (byte lengths, Content-Types, billing rules) or drop
the sentence entirely. Do not leave pointers to external trackers in
repo files; a bare file deletion leaves dangling pointers
(post-merge fix: PR #30085).
