# STT Review Checklist

Patterns to flag when reviewing STT adapter and pricing changes.

## Type safety and adapter contract

- No `any` in adapter or pricing-strategy code; no `as` cast on runtime data —
  vendor responses are parsed with Zod via `parseSchema`, using `zInt()` /
  `zDouble()` for number fields.
- When the provider uses FormData, a `CORE_FIELDS` `Set<string>` blocks the
  passthrough loop from overriding canonical fields (see
  `packages/stt/adapters/openai/index.ts`).
- When `provider_info.baseUrl` does not match the sync transcription URL,
  `getUrl()` is overridden with a docstring explaining why.

## Billing floor (dual clamp)

- When the provider has a billing floor, `<PROVIDER>_STT_MIN_BILLED_SECONDS`
  is exported from the SKU file and clamped in exactly two sites: the
  adapter's `getResponseUsageSeconds` and the strategy's
  `getFinalUsageResponse` — both using the same constant. A third clamp in
  `parseProviderResponse` is redundant; a single-sided clamp makes
  `usage.seconds` and billed cost diverge.

## Pricing and SKUs

- SKU keys follow `<slug>_stt:<unit>`; every request-level pricing modifier
  from the research note has its own SKU selected from the request, never
  silently billed at the base rate.
- Cost calculation folds over the SKU enum exhaustively
  (`Record<SKU, rate>` + `Object.values(SKU).reduce`) so a new SKU is a
  compile error, not a silent free SKU.
- A SKU falling back to another SKU's rate is logged, serialized into
  `sku_items`, tested, and documented in the research note — a silent
  fallback is a finding.

## Error handling, fetch hygiene, and logging

- No `throw` outside `wrap(...)`; no `try`/`catch` where Result monads
  belong; `errT` locations follow `'<Class>.<method>:<phase>'`.
- Unread `fetch()` bodies are cancelled; no `Promise.race` (use `safeRace`).
- `parseProviderResponse` logs (warn) on schema-validation failure;
  billing-relevant vendor fields that fall back to a default log a
  `vendor_field_missing` payload before defaulting.

## Response normalization and capabilities

- Normalization writes only the fields in
  `packages/stt-interfaces/schemas/response/index.ts`; provider extras live
  in `usage` only.
- `extractDuration` reads the normalized `STTResponse`, after
  `parseProviderResponse`.
- Capability flags (`supportsVerboseJson`, word timestamps, segments) match
  what the adapter actually returns — deferred capabilities are open
  questions, not silently advertised.

## Fixtures and tests

- `fixtures/baseline.request.json` and `fixtures/baseline.response.json`
  exist, match the adapter's real request/response, and carry no secrets;
  every fixture is referenced by at least one test.
- Tests cover the caller permutations (baseline, language, temperature,
  timestamps, provider options) and the captured error paths (4xx upstream,
  malformed JSON, missing usage).
- `getPublicPricing` tests assert `sku_label`, `unitLabel`, and
  `displayMultiplier`; the primary SKU is first in the returned array, and
  `displayMultiplier` is `1` for duration SKUs (`1_000_000` only for
  token-based SKUs).
