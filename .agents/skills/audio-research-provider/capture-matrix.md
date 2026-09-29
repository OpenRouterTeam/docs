# STT Capture Matrix

Canonical cURL scenarios for [`audio-research-provider`](./SKILL.md) Phase B.
Run each scenario against the real provider and save **three artifacts** per
scenario in your local scratch dir (suggested:
`/tmp/stt-research/<provider>/captures/` — the path doesn't matter, none of
these files are committed):

- `<scenario>.request.sh` — literal cURL command (API key redacted as `$STT_API_KEY`)
- `<scenario>.response.json` — raw response body (pretty-print with `jq`)
- `<scenario>.response.headers` — full response headers (`curl -D <file>`)

The headers file is mandatory, not optional — providers leak the canonical
billing unit, request IDs, and per-key quotas in headers, and Phase D's
research note depends on capturing them. None of these files are
committed; they exist to feed Phase D, where you inline the relevant
JSON into the research note. Examples worth flagging in Phase D:

- `x-ratelimit-*` headers reveal whether the per-key quota is
  request-counted, second-counted, or token-counted (this is often a
  better signal than the docs).
- `x-request-id` / `mistral-correlation-id` / `cf-ray` headers are what
  the adapter should log on error paths for support escalation.
- `content-type` differences between success and error envelopes (some
  providers serve 401s as `text/plain`).

The scenario list below is the mandatory floor; the optional set at the
bottom is per-provider and exercises specific surface area.

## Conventions

- `$STT_API_KEY` — provider API key (load from Infisical; never inline)
- `$STT_URL` — provider sync transcription endpoint (from Phase A doc pass)
- `$STT_AUDIO_5S` — path to a 5-second WAV with clean English speech
- `$STT_AUDIO_30S` — path to a 30-second WAV with clean English speech
- `$STT_AUDIO_SILENT` — path to a 5-second silent clip (`sox` can synthesize one)
- `$STT_AUDIO_HUGE` — path to a file larger than the provider's documented
  size limit
- `$STT_MODEL` — provider's model id (e.g. `whisper-large-v3`, `gpt-4o-transcribe`,
  `qwen3-asr-flash`)

All scenarios assume sync transcription. Adapt the `--data-binary` /
`--form` flags to whatever Phase A determined the provider expects (FormData
vs JSON+base64 vs data URI).

## cURL gotchas before you start

- **Multipart repeated keys coalesce in some clients.** `curl`'s `-F` will
  not produce a true array when you repeat the same field name with `-F`
  alone — depending on the field, the values may be concatenated into one
  string. If the provider expects an array (e.g. `timestamp_granularities[]`
  in OpenAI's API, `timestamp_granularities` with multiple entries in
  Mistral's), test with both `-F 'key=a'` style and explicit
  `-F 'key[]=a' -F 'key[]=b'` style and see which the upstream parses.
  Capture whichever shape works in `<scenario>.request.sh`.
- **Whitespace in multipart values may be silently mangled.** Some
  validators (e.g. Mistral's `context_bias`) reject any value containing a
  space, even though the docs prose says "phrases". When a docs example
  uses underscored or quoted strings, copy the example verbatim before
  generalizing.
- **Heredoc / large JSON bodies hit `Argument list too long`** when you
  try to inline base64 audio with `-d "$(cat file)"`. Use `-d @body.json`
  with a file on disk for JSON-body providers.

## Mandatory scenarios

### 1. baseline

Minimal viable request — only fields strictly required by the provider.
Establishes the canonical request shape and response shape.

```bash
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer $STT_API_KEY" \
  -F "file=@$STT_AUDIO_5S" \
  -F "model=$STT_MODEL"
```

Verify: 200, transcript populated, `usage` populated (or noted absent).

### 2. with-language

Pass an explicit language hint (ISO-639-1 code). Establishes the language
field path and whether the provider validates the code.

```bash
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer $STT_API_KEY" \
  -F "file=@$STT_AUDIO_5S" \
  -F "model=$STT_MODEL" \
  -F "language=en"
```

Verify: transcript matches scenario 1 (within transcription noise) and the
response signals the language was applied (where applicable).

### 3. with-temperature

Pass a non-default decoding parameter. Many providers do not honor
temperature for STT — record whether it changed the transcript.

```bash
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer $STT_API_KEY" \
  -F "file=@$STT_AUDIO_5S" \
  -F "model=$STT_MODEL" \
  -F "temperature=0.7"
```

If the provider does not accept a temperature analog, leave a one-line
`not-applicable.txt` in the scenario dir.

### 4. with-timestamps

Request word-level or segment-level timestamps. Reveals the verbose response
shape (often `verbose_json` or `response_format=verbose_json`).

```bash
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer $STT_API_KEY" \
  -F "file=@$STT_AUDIO_5S" \
  -F "model=$STT_MODEL" \
  -F "response_format=verbose_json" \
  -F "timestamp_granularities[]=word"
```

Verify: response includes a timestamped segment array. Note the path in the
research note's "Response shape" section.

### 5. with-provider-options

Exercise a provider-specific field that OpenRouter callers will expose via
`provider.options.<slug>.*`. Examples: speaker diarization, custom
vocabularies, profanity filter, system-prompt biasing.

```bash
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer $STT_API_KEY" \
  -F "file=@$STT_AUDIO_5S" \
  -F "model=$STT_MODEL" \
  -F "diarize=true"
```

Verify: response includes the requested extra. If the field changes pricing,
flag it under "Surcharges" in the research note.

### 6. long-audio

30-second clip. Used by Phase C reconciliation to validate that billing
scales linearly past the floor.

```bash
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer $STT_API_KEY" \
  -F "file=@$STT_AUDIO_30S" \
  -F "model=$STT_MODEL"
```

Verify: `usage` reports ~30 seconds. If the provider reports tokens instead,
record the token-to-second ratio you observe.

### 7. unsupported-format

Send an audio format the provider's docs say is unsupported (e.g. raw `.pcm`
or a deliberately mangled MIME type). Captures the error envelope.

```bash
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer $STT_API_KEY" \
  -F "file=@unsupported.pcm" \
  -F "model=$STT_MODEL"
```

Verify: 4xx with a documented error shape. Save the full response body and
headers.

### 8. bad-auth

Send a request with an obviously invalid key. Captures the 401 envelope.

```bash
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer sk-invalid-test-key" \
  -F "file=@$STT_AUDIO_5S" \
  -F "model=$STT_MODEL"
```

Verify: 401 (or 403) with a documented error shape. Some providers return
JSON, some plain text — record both.

### 9. oversize-payload

Send a file larger than the provider's documented max size. Captures the
413 (or equivalent) envelope.

```bash
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer $STT_API_KEY" \
  -F "file=@$STT_AUDIO_HUGE" \
  -F "model=$STT_MODEL"
```

Verify: 413, 400, or provider-specific code. Document the exact threshold —
many providers reject before the byte count matches their published limit.

### 10. short-audio

Clip below the provider's billing floor (e.g. 0.4s for a provider that floors
to 1s, or 5s for a provider that floors to 60s). Exposes the floor behavior
in `usage.seconds`.

```bash
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer $STT_API_KEY" \
  -F "file=@short-0.4s.wav" \
  -F "model=$STT_MODEL"
```

Verify: response either reports floor-clamped duration or reports raw
sub-floor duration. Whichever it does, the adapter must clamp the
user-visible `usage.seconds` to match what we bill — see Groq and Alibaba
for prior art.

### 11. empty-audio

Silent clip of the same duration as scenario 1. Many providers return an
empty transcript with zero tokens; others 4xx. Captures the empty-result
behavior.

```bash
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer $STT_API_KEY" \
  -F "file=@$STT_AUDIO_SILENT" \
  -F "model=$STT_MODEL"
```

Verify: response has empty `text` (or equivalent) AND still reports `usage`.
The adapter must not throw on an empty transcript — log a `wLog` and surface
it as a 200 with empty text.

### 12. doc-constraint-validation

For every constraint the provider's docs claim (e.g. "X is mutually
exclusive with Y", "feature A requires feature B", "this field caps at
N tokens"), send a live request that violates the documented constraint
and capture the result. The docs are often wrong, stale, or describe a
deprecated model variant.

```bash
# Example: docs say "language is incompatible with timestamps" — verify.
curl -sS -X POST "$STT_URL" \
  -H "Authorization: Bearer $STT_API_KEY" \
  -F "file=@$STT_AUDIO_5S" \
  -F "model=$STT_MODEL" \
  -F "language=en" \
  -F "timestamp_granularities=segment"
```

Verify: either the constraint is enforced (capture the 4xx envelope) or
the docs lied (capture the 200 response). Each captured constraint goes
in the research note under "Quirks" with the capture filename.

If the docs make no testable constraints, leave `not-applicable.txt`.

## Optional scenarios (provider-specific)

Add captures for each capability the provider exposes that we may want to
support down the road. These do not block adapter shipping; they document
gaps in the v1 surface.

- `with-vocabulary` — custom vocabulary / phrase bias
- `with-diarization` — speaker diarization
- `with-context-bias` — phrase / keyword biasing
- `with-translation` — translate to English (Whisper-style)
- `with-streaming` — streaming chunked response (we do not consume streaming
  today; capture documents what we would gain by adding it)
- `with-system-prompt` — system / instruction biasing (Alibaba pattern)
- `with-region` — non-default region endpoint (Google Cloud pattern)
- `with-file-url` — upstream pulls audio from a URL rather than a multipart
  upload (Mistral pattern)
- `with-oai-passthrough` — pass OpenAI-compat fields (`response_format`,
  `prompt`, `seed`) and capture whether they are honored, silently
  dropped, or rejected. Drives the adapter's `CORE_FIELDS` block list
- `sharding-threshold-probe` — send the same audio at 5s, 15s, 30s, 60s
  to detect whether the provider switches usage shape based on duration
  (e.g. introducing a `request_count` field or dropping `audio_tokens`).
  Adapter response schema must accept both shapes

Each optional scenario follows the same naming convention:
`<scenario>.request.sh` + `<scenario>.response.json` + `<scenario>.response.headers`
in your local scratch dir. As with the mandatory scenarios, the files
are local working artifacts; only the relevant JSON gets inlined into
the research note in Phase D.

## Updating this matrix

Edit this file when a new provider exposes a capability our existing matrix
does not cover. Add the scenario to the optional set unless every provider
will need to capture it — in which case promote it to the mandatory list and
note the addition in the research notes for already-onboarded providers so
we can backfill captures.
