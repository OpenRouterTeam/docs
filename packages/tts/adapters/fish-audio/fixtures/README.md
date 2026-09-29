# Fish Audio TTS fixtures

Response bodies for `POST https://api.fish.audio/v1/tts` used by adapter tests.
Fixtures are verbatim live captures from the research sessions documented in
`docs/tts-research/fish-audio.md`.

- `error-402.response.json` — live capture (2026-07-15, zero-credit key):
  insufficient provider API credit. Fish can also return this envelope for an
  unknown `model` header, so the adapter sanitizes upstream 402 responses to a
  public 502 rather than blaming the OpenRouter user or exposing the Fish
  top-up URL. BYOK endpoints are exempt: there the exhausted wallet is the
  user's own Fish account, so the 402 passes through.
