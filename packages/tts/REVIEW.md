# TTS Review Checklist

Patterns to flag when reviewing TTS adapter and pricing changes.

## Pricing units

- The billed unit in `getUsage()` (or the default `input.length`) matches the
  research note's billable-character definition, including multi-byte
  behavior; the rate traces to the provider's primary source for the API
  mode the adapter uses.
- Endpoint pricing JSON validates against the strategy's Zod schema, and the
  per-character vs per-1M-characters scale is consistent between the
  strategy math and the staged pricing.

## SKU choice

- Generic `TTSSKU.Characters` is used only when character billing is proven;
  a custom strategy is registered in `packages/enums/pricing-strategy.ts`
  and `get-pricing-strategy.ts` with tests.
- No dead SKUs: every SKU the strategy can emit is priced, and nothing
  priced is never emitted.

## Surcharge params: billed or blocked

- Every provider param that changes the price (premium voice, HD codec,
  timestamps, callbacks) is either represented in billing or blocked from
  passthrough — none silently forwarded for free.

## Voice/model ownership and passthrough protection

- `endpoint.provider_model_id` vs `request.voice` roles match the research
  note; default voice behavior is deliberate.
- Passthrough options are spread before canonical fields in
  `transformRequest()` — canonical `model`/`input`/`voice`/format/speed
  always win; other providers' passthrough options are isolated.
- Callback/webhook/URL params cannot be injected via passthrough (SSRF).

## Format / MIME / PCM correctness

- `TTS_ADAPTER_SUPPORTED_FORMATS` lists exactly the proven formats, and the
  upstream Content-Type matches what we advertise per format.
- `getPcmParameters()` matches captured sample rate, bit depth, endianness,
  and channels; returns `null` only if PCM is unsupported.
- Unsupported formats fail in `validateRequest()` with a 400, not an
  upstream error.

## Stream, errors, and request IDs

- `streamAudioBytes()` yields raw decodable audio for the provider's actual
  stream shape.
- Non-OK upstream responses propagate a useful error body — no swallowed
  bodies, no unconsumed-body leaks (`response.body?.cancel()` where
  applicable); no `try`/`catch` where Result monads belong.
- The upstream request id is captured and surfaces via `adapter.upstreamId`.

## General quality

- No `any`; Zod validation for parsed upstream JSON; logging via
  `iLog`/`wLog`/`eLog` with snake_case context.
- Tests cover every adapter-observable row above (see the test list in
  `.agents/skills/audio-add-adapter/SKILL.md`).
