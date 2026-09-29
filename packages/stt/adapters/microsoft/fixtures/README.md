# Microsoft STT Fixtures

Captured from Azure Speech API (`api-version=2025-10-15`) on 2026-06-02
against the `openrouter-foundry-east-resource` endpoint.

These captures predate the adapter sending `enhancedMode` (it was in
private preview at capture time, so all captures use the standard,
non-enhanced path). The adapter now sends
`enhancedMode: { enabled: true, model: "<provider_model_id>" }` (e.g.
`mai-transcribe-1.5`) by default to select the MAI-Transcribe model; the
captured response shapes are unaffected.

## Scenarios

### `baseline`
Empty `definition: {}`. Standard transcription with auto-detected locale.
7.6s espeak-ng synthesised English speech.

### `with-language`
`definition: { "locales": ["en-US"] }`. Same audio, explicit locale.
Produces higher confidence scores and slightly different word timings.

### `short-audio`
0.5s near-silence WAV. Verifies sub-floor billing and empty-transcript
handling (`combinedPhrases[0].text: ""`, `phrases: []`).

## MAI-Transcribe enhanced-mode captures (2026-09-03)

Captured against the dedicated `eastus-foundry-resource` endpoint (the
only resource where `enhancedMode.model` is served) with the
`AZURE_FOUNDRY_EAST_US_API_KEY`. Audio is `two-speakers.mp3`, a ~20s
two-voice espeak-ng clip. Re-collect with
`fixtures/scripts/collect-azure-speech-mai-transcribe.ts`; each
`.request.json` is the exact `definition` part the adapter builds for the
scenario.

### `2026-09-03-mai-transcribe-2-json`
`response_format: "json"` default. Phrases are returned but every
`offsetMilliseconds`/`durationMilliseconds` is `0` and there are no
`words`, so the adapter only surfaces `text` and `usage` for this shape.

### `2026-09-03-mai-transcribe-2-verbose-segment`
`enhancedMode.modelOptions.timestamps: "segment"` (what the adapter
sends for `verbose_json` without a `word` granularity). Phrases carry
real offsets/durations, no `words`, no `speaker`.

### `2026-09-03-mai-transcribe-2-verbose-word-diarization`
`timestamps: "word"` plus top-level `diarization: { enabled: true }`.
Phrases carry `speaker` (0/1) and nested `words` with offsets/durations.
Azure emits `speaker` on phrases only, never on words.

### `2026-09-03-mai-transcribe-1.5-timestamps-rejected`
HTTP 400 body for `timestamps: "segment"` on `mai-transcribe-1.5`.
Diarization fails the same way. This is why 1.5 is in the adapter's
`verboseJsonUnsupportedModelSlugs`.
