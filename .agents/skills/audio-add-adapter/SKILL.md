---
name: audio-add-adapter
description: "Phase 2: add a speech-to-text (STT) or text-to-speech (TTS) provider adapter, including pricing, registrations, and unit tests. Sub-skill of audio-provider-onboarding."
user-invocable: true
---

## Shared adapter policy

Both modality adapters consume a signed-off research note and must preserve canonical request fields over provider passthrough options. Register the adapter, pricing strategy/SKUs, factory/config mapping, and focused unit tests; use Result monads, Zod for parsed upstream bodies, and the repository's type-safety and logging conventions.

Completeness rule: when the research note documents provider-advertised values (voices, formats, parameters) that the serving enums or schemas (e.g. `SupportedTtsParametersSchema` in `packages/db/endpoints/index.ts`, `TTS_ADAPTER_SUPPORTED_FORMATS`) cannot represent, extend those serving enums/schemas in the same adapter PR. Never author endpoint or model capability metadata the serving schema rejects: the buddy-api model create/update routes validate `supported_tts_parameters` (a models-table column) against `SupportedTtsParametersSchema` at write time and reject with a 400 carrying `capability_issues` naming the offending fields (`services/cfw-internal/src/routes/buddy-api/validate-capability-fields.ts`). Fix the payload — or extend the serving schema in this PR — never drop the capability field to bypass validation.

## STT

Implement the adapter, response schema, pricing strategy, and tests for a new
STT provider. Assumes the research note and fixtures from
[`audio-research-provider`](../audio-research-provider/SKILL.md) already exist —
this skill consumes them.

The pattern is mechanical. Compare any two existing STT adapters
(`packages/stt/adapters/openai/index.ts` and
`packages/stt/adapters/google-cloud/index.ts`) to see how nearly identical
they are. The deltas are documented in the research note — read it first.

### Arguments

- `$PROVIDER_NAME`: PascalCase provider name (e.g. `Deepgram`, `AssemblyAI`)
- `$PROVIDER_SLUG`: kebab/snake provider slug matching `ProviderName.*` (e.g.
  `deepgram`, `assemblyai`)
- `$ADAPTER_DIR`: kebab-case adapter directory name (e.g. `deepgram`)

### When to invoke

After [`audio-research-provider`](../audio-research-provider/SKILL.md) has landed
the research note and fixtures. Do NOT invoke this skill before the research
note exists — every decision the adapter makes (FormData vs JSON, billing
floor, passthrough core-fields blocklist, URL strategy) is sourced from the
note.

### Prerequisites

- `docs/stt-research/$PROVIDER_SLUG.md` exists and the OpenRouter Mapping
  section is filled in
- `packages/stt/adapters/$ADAPTER_DIR/fixtures/{baseline,with-language}.{request,response}.json`
  exist
- `ProviderName.${PROVIDER_NAME}` already exists in
  `packages/enums/providers.ts` (if not, add it first — out of scope for this
  skill)
- `bun install && bun run compile` has completed at the repo root

### Files to touch

```text
packages/enums/adapters.ts                                # +1 STT adapter name
packages/enums/pricing-strategy.ts                        # +1 strategy name
packages/stt/adapters/$ADAPTER_DIR/index.ts               # new
packages/stt/adapters/$ADAPTER_DIR/index.test.ts          # new
packages/stt/adapters/$ADAPTER_DIR/response-schema.ts     # new (when complex)
packages/stt/adapters/$ADAPTER_DIR/response-schema.test.ts# new (when complex)
packages/stt/adapters/adapter-factory.ts                  # +1 switch case
packages/stt/adapters/adapter-factory.test.ts             # +1 it() block
packages/stt/adapters/capabilities.ts                     # +1 registry entry (Record<STTAdapterName,...>, typecheck fails without it)
packages/stt/adapters/capabilities.test.ts                # +1 it() block
packages/stt/configs/get-adapter-name.ts                  # +1 switch case
packages/stt/configs/get-adapter-name.test.ts             # +1 it() block
packages/stt/helpers/resolve-adapter-name-for-model.ts    # +1 slug-prefix entry (Step 10)
packages/stt/helpers/resolve-adapter-name-for-model.test.ts # +1 it() block (Step 10)
packages/pricing/strategies/stt/$ADAPTER_DIR-skus.ts      # new
packages/pricing/strategies/stt/$ADAPTER_DIR-strategy.ts  # new
packages/pricing/strategies/stt/$ADAPTER_DIR-strategy.test.ts # new
packages/pricing/strategies/get-pricing-strategy.ts       # +1 case
packages/pricing/strategies/get-pricing-strategy.test.ts  # +1 REGISTERED_SINGLETONS entry (Record<PricingStrategyName,...>)
```

The strategy directory layout follows existing STT strategies — each
provider gets its own `*-skus.ts` and `*-strategy.ts` pair under
`packages/pricing/strategies/stt/`.

### Step 1 — Read the research note

Pull these decisions out of `docs/stt-research/$PROVIDER_SLUG.md` and pin
them at the top of your scratchpad. Every step below references one of
these:

- **Request body shape** — FormData or JSON
- **URL strategy** — derive from `provider_info.baseUrl` or override
  `getUrl()`
- **Billing floor** — none, or `<N>` seconds (must clamp at adapter AND
  pricing strategy)
- **Billing unit** — seconds, minutes, hours, or tokens (input/output)
- **Passthrough core-fields blocklist** — the set of field names callers
  cannot override via `provider.options.$PROVIDER_SLUG.*`
- **Surcharges** — list of opt-in features that add cost
- **Response field paths** — transcript, usage, request id

### Step 2 — Register the adapter name

Add an entry to `STTAdapterName` in
[`packages/enums/adapters.ts`](../../../packages/enums/adapters.ts):

```ts
export const STTAdapterName = {
  OpenAISTTAdapter: 'OpenAISTTAdapter',
  GroqSTTAdapter: 'GroqSTTAdapter',
  GoogleCloudSTTAdapter: 'GoogleCloudSTTAdapter',
  ${PROVIDER_NAME}STTAdapter: '${PROVIDER_NAME}STTAdapter',
} as const;
```

This is an ESM literal enum (`as const` + `ValueOf<typeof ...>`), not a
TypeScript `enum`. See
`AGENTS.md` → Style Principles.

`STTAdapterName` is baked into `services/cfw-api/src/generated-zod-guards.js`
and CI runs `bun scripts/generate-zod-guards.ts --check` against it. After
adding the enum entry, run `cd services/cfw-api && bun scripts/generate-zod-guards.ts`
and commit the regenerated file in the same layer (it needs a full
`bun install` first, otherwise wrangler fails to resolve workspace imports).

### Step 3 — Register the pricing strategy name

Add an entry to `PricingStrategyName` in
[`packages/enums/pricing-strategy.ts`](../../../packages/enums/pricing-strategy.ts):

```ts
export enum PricingStrategyName {
  // ...
  ${PROVIDER_NAME}STT = '${PROVIDER_SLUG}_stt',
}
```

This enum is still a TypeScript `enum` (legacy). Match the surrounding style.

### Step 4 — Define the pricing SKUs

Create `packages/pricing/strategies/stt/$ADAPTER_DIR-skus.ts`. Choose the SKU
set that matches the provider's billing unit:

**Duration-only (Alibaba, Groq):**

```ts
import type { BigNumberUnionNonNegativeSchemaType } from '@openrouter-monorepo/schema-bignumber';
import type { ValueOf } from '@openrouter-monorepo/type-utils';

import { BigNumberUnionNonNegativeSchema } from '@openrouter-monorepo/schema-bignumber';
import { z } from '@openrouter-monorepo/lib-zod';

/**
 * Minimum billable audio duration in seconds for $PROVIDER_NAME STT.
 * <Cite the research note's billing model section.>
 */
export const ${PROVIDER_NAME_UPPER}_STT_MIN_BILLED_SECONDS = <N>;

export const ${PROVIDER_NAME}STTSKU = {
  AudioSeconds: '${PROVIDER_SLUG}_stt:audio_seconds',
} as const;

export type ${PROVIDER_NAME}STTSKU = ValueOf<typeof ${PROVIDER_NAME}STTSKU>;

export const ${PROVIDER_NAME}STTPricingJsonSchema = z.object({
  [${PROVIDER_NAME}STTSKU.AudioSeconds]: BigNumberUnionNonNegativeSchema,
} satisfies Record<${PROVIDER_NAME}STTSKU, BigNumberUnionNonNegativeSchemaType>);

export type ${PROVIDER_NAME}STTPricingJson = z.infer<typeof ${PROVIDER_NAME}STTPricingJsonSchema>;
```

Omit `MIN_BILLED_SECONDS` entirely if the provider has no floor.

**Duration-or-tokens (OpenAI):** add `InputTokens` and `OutputTokens` SKUs
and use `isTokenBased` selector in the strategy. See
[`packages/pricing/strategies/stt/skus.ts`](../../../packages/pricing/strategies/stt/skus.ts).

Pricing dictionary keys MUST be prefixed with the provider slug
(`<slug>_stt:<unit>`) so unrelated strategies cannot collide.

Include a SKU for **every request-level pricing modifier** in the research
note (e.g. `language=multi` → `<slug>_stt:audio_minutes_multilingual`) —
a missing one silently bills the base rate.

### Step 5 — Implement the pricing strategy

Create `packages/pricing/strategies/stt/$ADAPTER_DIR-strategy.ts`. Mirror
[`packages/pricing/strategies/stt/groq-strategy.ts`](../../../packages/pricing/strategies/stt/groq-strategy.ts)
for a duration-based strategy with a floor.

Required methods (inherited from
[`PricingStrategy`](../../../packages/pricing/strategies/base.ts)):

- `schema` — bound to the `*PricingJsonSchema` from Step 4
- `getFinalUsageResponse(context)` — clamps duration to the floor, multiplies
  by the SKU price, returns a `CompletionResponseUsage`. **The floor clamp
  here must match the floor clamp in the adapter's `getResponseUsageSeconds`
  override (Step 7).**
- `getPublicPricing(pricingJson)` — returns the `DisplayPricingItem[]` that
  drives the marketplace UI. The label here (e.g. `'Audio Seconds'`),
  `displayMultiplier` (`1` for all time-based STT SKUs — `pricingJson` price
  is already in the display unit; `1_000_000` only for token-based SKUs),
  and `unitLabel` (e.g. `'per second'`, `'per minute'`, `'per hour'`)
  determine what the model detail page shows. **Verify these end-to-end with
  the UI spot-check in [`audio-e2e-testing`](../audio-e2e-testing/SKILL.md)
  after staging.**
- `getCacheUsage(context)` — STT does not currently have prompt caching;
  return `ok({ cached_tokens: 0 })` unless the research note says otherwise.

With multiple SKUs, fold cost over the SKU enum exhaustively
(`Record<SKU, rate>` + `Object.values(SKU).reduce`) so a future SKU is a
compile error, not a silent free SKU. A fallback to another SKU's rate
is a deliberate design choice — sometimes the provider simply doesn't
publish a rate for a modifier. Keep the fallback, but it must never be
silent: log it (`wLog`), serialize the effective rate into `sku_items`
(no null per-SKU price), test it, and record in the research note which
SKU is unpriced and why, with an escalation to the invoker per
[`audio-research-provider`](../audio-research-provider/SKILL.md) §A.2.

Export a singleton instance at the bottom of the file:

```ts
export const ${PROVIDER_SLUG_CAMEL}STTPricingStrategy = new ${PROVIDER_NAME}STTPricingStrategy();
```

### Step 6 — Register the pricing strategy

Add the strategy to
[`packages/pricing/strategies/get-pricing-strategy.ts`](../../../packages/pricing/strategies/get-pricing-strategy.ts):

```ts
import { ${PROVIDER_SLUG_CAMEL}STTPricingStrategy } from './stt/${ADAPTER_DIR}-strategy';

// ... inside getPricingStrategy switch:
case PricingStrategyName.${PROVIDER_NAME}STT:
  return ok(${PROVIDER_SLUG_CAMEL}STTPricingStrategy);
```

The default branch already uses `name satisfies never` for exhaustiveness;
your new case keeps that intact.

### Step 7 — Implement the adapter

Create `packages/stt/adapters/$ADAPTER_DIR/index.ts`. The class shape:

```ts
export class ${PROVIDER_NAME}STTAdapter extends BaseSTTAdapter {
  async buildProviderRequest(): Promise<FormData | ArrayBuffer> { ... }

  async parseProviderResponse(response: Response): AsyncResult<STTResponse, ErrorT> { ... }

  extractDuration(response: STTResponse): number | undefined { ... }

  getUsage(billing: STTBillingInput): Map<SKUUnion, BigNumberUnion> { ... }

  // Only when the billing floor needs to clamp the user-visible response:
  override getResponseUsageSeconds(rawSeconds: number | undefined): number | undefined { ... }

  // Only when the provider's base URL doesn't match the default `/audio/transcriptions`:
  override getUrl(): string { ... }

  // Only when auth differs from `Authorization: Bearer ${apiKey}`:
  override getHeaders(apiKey: string): Record<string, string> { ... }
}
```

Reference implementations:

- **FormData / OpenAI-compatible**:
  [`packages/stt/adapters/openai/index.ts`](../../../packages/stt/adapters/openai/index.ts)
- **FormData with billing floor**:
  [`packages/stt/adapters/groq/index.ts`](../../../packages/stt/adapters/groq/index.ts)
- **JSON body with hardcoded URL**:
  [`packages/stt/adapters/google-cloud/index.ts`](../../../packages/stt/adapters/google-cloud/index.ts)
- **JSON body with data-URI audio + system-prompt biasing**:
  [`packages/stt/adapters/alibaba/index.ts`](../../../packages/stt/adapters/alibaba/index.ts)
  — canonical reference for both the data-URI request shape and the
  dual-clamp floor pattern.

#### 7-pre. `validateRequest` (when the provider rejects some canonical input)

`BaseSTTAdapter.validateRequest()` returns `ok(true)` by default. Override it
when the provider only accepts a subset of input the OpenRouter schema
allows (e.g. Meta only takes mono 16-bit PCM WAV at 16/24 kHz and answers
other shapes with a 503). The router calls it after construction and before
any endpoint attempt, wraps the error with `withRequestBuildCause()`, and
returns it as a client-input rejection with no fallback and no
endpoint-attempt row. Return `errT({ status: HTTPStatus.S400_Bad_Request })`
from a pure header check on the decoded bytes so the failure is deterministic
and never counts against provider health. See
`packages/stt/adapters/meta/wav-header.ts`.

#### 7a. `buildProviderRequest`

For FormData providers, follow OpenAI's blocklist pattern:

```ts
const CORE_FIELDS = new Set([
  'file',
  'model',
  'response_format',
  'language',
  'temperature',
]);

async buildProviderRequest(): Promise<FormData> {
  const formData = new FormData();
  const providerOptions = this.getProviderPassthroughOptions();
  if (providerOptions) {
    for (const [key, value] of Object.entries(providerOptions)) {
      if (CORE_FIELDS.has(key)) continue;
      // append primitives only
    }
  }
  // canonical fields next (file, model, response_format, language, ...)
  return formData;
}
```

For JSON providers, build a typed object, stringify, return as `ArrayBuffer`:

```ts
const body = { model: ..., input: { ... }, parameters: { ... } };
return new TextEncoder().encode(JSON.stringify(body)).buffer;
```

The passthrough core-fields blocklist comes from the research note's
"OpenRouter mapping" section. Callers MUST NOT be able to override fields
the adapter owns (model id, audio bytes, response_format).

#### 7b. `parseProviderResponse`

Pattern: parse the upstream JSON with `parseSchema`, normalize to
`STTResponse`, parse that with `STTResponseSchema`. Never use `.parse()` or
`.safeParse()` directly — enforced by the `openrouter/prefer-parse-schema`
oxlint rule in [`scripts/oxlint/rules-schema.ts`](../../../scripts/oxlint/rules-schema.ts).

```ts
async parseProviderResponse(response: Response): AsyncResult<STTResponse, ErrorT> {
  if (!response.ok) {
    const errorBody = await wrap(() => response.text());
    return errT({
      location: '${PROVIDER_NAME}STTAdapter.parseProviderResponse:providerError',
      rawError: new Error(
        isOk(errorBody) ? `Provider ${response.status}: ${errorBody.data}` : `Provider ${response.status}`,
      ),
      status: getHttpStatusOr(response.status, HTTPStatus.S502_Bad_Gateway),
    });
  }

  const rawResult = parseSchema(${PROVIDER_NAME}STTRawResponseSchema, await response.json());
  if (isErr(rawResult)) {
    return errT({
      location: '${PROVIDER_NAME}STTAdapter.parseProviderResponse:rawSchema',
      rawError: rawResult.error,
      status: HTTPStatus.S502_Bad_Gateway,
    });
  }

  const raw = rawResult.data;
  const sttResponse: Record<string, unknown> = { text: extractTranscriptText(raw) };
  if (raw.usage?.seconds !== undefined) {
    sttResponse['usage'] = { seconds: raw.usage.seconds };
  } else if (sttResponse['text']) {
    // Surface the gap so monitoring catches a billing fallback.
    wLog('${PROVIDER_NAME} STT returned transcript without usage.seconds', {
      model: this.endpoint.provider_model_id,
    });
  }

  return parseSchema(STTResponseSchema, sttResponse);
}
```

If the research note shows the provider returns word-level timestamps or
utterances, implement `verbose_json` support now (set
`supportsVerboseJson`, map `words[]` → `STTWordSchema`, utterances →
segments — mirror the OpenAI adapter). If you defer it, flag it as an
open question so capability data isn't staged as supported.

Every `if (isErr(...))` branch MUST log via `eLog` / `wLog`. Every `errT`
MUST set `location` to `'${PROVIDER_NAME}STTAdapter.<method>:<phase>'`. See
`packages/instrumentation/AGENTS.md`
and
`packages/instrumentation/AGENTS.md` → Logging.

#### 7c. `getUsage`

Return the SKUs from Step 4 keyed by their string ids. Example for a
duration-only adapter:

```ts
getUsage(billing: STTBillingInput): Map<SKUUnion, BigNumberUnion> {
  return new Map<${PROVIDER_NAME}STTSKU, BigNumberUnion>([
    [${PROVIDER_NAME}STTSKU.AudioSeconds, bn(billing.audioDurationSeconds ?? 0)],
  ]);
}
```

For duration-or-tokens adapters, branch on `this.isDurationBased` and emit
either the duration SKU or the token SKUs (not both).

#### 7d. `getResponseUsageSeconds` (when there is a floor)

When the pricing strategy enforces a floor, override
`getResponseUsageSeconds` so the user-visible `usage.seconds` matches what
gets billed. Mirror Groq / Alibaba:

```ts
override getResponseUsageSeconds(rawSeconds: number | undefined): number | undefined {
  if (rawSeconds === undefined) return undefined;
  return rawSeconds < ${PROVIDER_NAME_UPPER}_STT_MIN_BILLED_SECONDS
    ? ${PROVIDER_NAME_UPPER}_STT_MIN_BILLED_SECONDS
    : rawSeconds;
}
```

Forgetting this is the most common STT adapter bug. The API response
silently shows raw seconds while the cost reflects the floor, so dashboards
disagree with invoices. `packages/stt/REVIEW.md` checks for this explicitly.

### Step 8 — Implement the raw response schema

When the upstream response has more than a handful of fields, split the
schema into `response-schema.ts`. Alibaba's pattern:

```ts
// packages/stt/adapters/$ADAPTER_DIR/response-schema.ts
import { z, zDouble, zInt } from '@openrouter-monorepo/lib-zod';

const ${PROVIDER_NAME}STTUsageSchema = z.object({
  seconds: zDouble().optional(),
  // ... other usage fields, all .optional()
});

export const ${PROVIDER_NAME}STTRawResponseSchema = z.object({
  // ... top-level fields the adapter reads
});

export type ${PROVIDER_NAME}STTRawResponse = z.infer<typeof ${PROVIDER_NAME}STTRawResponseSchema>;
```

Use `zInt()` / `zDouble()` from
[`packages/lib/zod/index.ts`](../../../packages/lib/zod/index.ts), never
bare `z.number()` — enforced by the `openrouter/require-typed-zod-number`
oxlint rule in [`scripts/oxlint/rules-schema.ts`](../../../scripts/oxlint/rules-schema.ts).

Mark every field `.optional()` unless the provider's contract guarantees it
on every successful response. We have been burned by vendor docs that lie.

Inline the schema in `index.ts` for trivial cases (one or two fields).
OpenAI does this; Google Cloud and Alibaba split.

### Step 9 — Register the adapter in the factory

Add a switch case in
[`packages/stt/adapters/adapter-factory.ts`](../../../packages/stt/adapters/adapter-factory.ts):

```ts
import { ${PROVIDER_NAME}STTAdapter } from './${ADAPTER_DIR}';

// inside createSTTAdapter:
case STTAdapterName.${PROVIDER_NAME}STTAdapter:
  return ok(
    new ${PROVIDER_NAME}STTAdapter(endpoint, request, {
      streamingContext: streamingContextForAdapter(${PROVIDER_NAME}STTAdapter, streamingContext),
      upstreamFetchTimeoutMs,
    }),
  );
```

The third constructor argument is required — every existing STT adapter
passes `{ streamingContext, upstreamFetchTimeoutMs }`. `streamingContextForAdapter`
is the helper in the same file that matches each adapter's
`fetchOffloadKey`; omitting it silently disables Durable Object offload
dispatch and the per-request upstream timeout for your adapter.

The default branch (`name satisfies never`) will surface a compile error
until you have wired both the enum (Step 2) and the switch case.

Add an `it()` block to
[`packages/stt/adapters/adapter-factory.test.ts`](../../../packages/stt/adapters/adapter-factory.test.ts)
asserting `createSTTAdapter` returns an instance of the new class.

### Step 10 — Register the provider → adapter mapping

Add a switch case in
[`packages/stt/configs/get-adapter-name.ts`](../../../packages/stt/configs/get-adapter-name.ts):

```ts
case ProviderName.${PROVIDER_NAME}:
  return ok(STTAdapterName.${PROVIDER_NAME}STTAdapter);
```

Add an `it()` block to
[`packages/stt/configs/get-adapter-name.test.ts`](../../../packages/stt/configs/get-adapter-name.test.ts)
asserting the new provider resolves to the new adapter, and a regression
test asserting `providerInfo.adapterName` still overrides the default.

Also add the model's slug prefix (the author part, e.g. `x-ai`) to
`SLUG_PREFIX_TO_ADAPTER` in
[`packages/stt/helpers/resolve-adapter-name-for-model.ts`](../../../packages/stt/helpers/resolve-adapter-name-for-model.ts)
plus an `it()` block in its test. The transcribe route uses this map for
capability gates before routing — without it, `verbose_json` requests
for the new model are rejected with 400 even when the adapter class
sets `supportsVerboseJson = true`.

### Step 11 — Adapter unit tests

Create `packages/stt/adapters/$ADAPTER_DIR/index.test.ts`. Import the
fixtures from Step E of the research phase and build a `createAdapter()`
helper that mirrors Alibaba's pattern (`createMockModelEndpoint` + minimal
`STTRequestInput`).

Required `it()` blocks (each is its own block — no nested branching, no
shared state across cases):

```typescript
describe('${PROVIDER_NAME}STTAdapter', () => {
  describe('getUrl', () => {
    it('pins to the documented endpoint regardless of provider.baseUrl', () => { ... });
  });

  describe('getHeaders', () => {
    it('sets Bearer auth and correct content-type', () => { ... });
  });

  describe('buildProviderRequest', () => {
    it('produces the canonical body shape', async () => { ... });
    it('forwards request.language into the documented field', async () => { ... });
    it('merges passthrough options with the documented precedence', async () => { ... });
    it('top-level fields win over passthrough on conflicts', async () => { ... });
    it('matches the fixture for baseline', async () => { ... });
    it('matches the fixture for with-language', async () => { ... });
  });

  describe('parseProviderResponse', () => {
    it('parses a successful 200 with usage data', async () => { ... });
    it('parses a successful 200 with no usage and logs the gap', async () => { ... });
    it('returns errT on 4xx upstream', async () => { ... });
    it('returns errT on malformed upstream JSON', async () => { ... });
  });

  describe('getUsage', () => {
    it('emits the correct SKU map for duration-based billing', () => { ... });
    // for token-or-duration adapters, add a token-based case
  });

  describe('getResponseUsageSeconds', () => {
    it('clamps sub-floor durations to the billing floor', () => { ... });
    it('passes through durations above the floor', () => { ... });
    it('returns undefined when raw seconds are undefined', () => { ... });
  });
});
```

Fixture import pattern (mirrors Alibaba):

```ts
import realRequest from './fixtures/baseline.request.json' with { type: 'json' };
import realResponse from './fixtures/baseline.response.json' with { type: 'json' };
```

Parse request bodies with a typed Zod schema rather than asserting on
stringified blobs, so future formatting changes in the upstream client do
not churn the test. See
[`.agents/skills/unit-test-writing/SKILL.md`](../unit-test-writing/SKILL.md)
for assertion conventions.

### Step 12 — Pricing strategy unit tests

Create
`packages/pricing/strategies/stt/$ADAPTER_DIR-strategy.test.ts`. Mirror
[`packages/pricing/strategies/stt/groq-strategy.test.ts`](../../../packages/pricing/strategies/stt/groq-strategy.test.ts).

Required cases:

- `getFinalUsageResponse`:
  - sub-floor duration is clamped to the floor (cost matches floor × rate)
  - above-floor duration is passed through (cost matches rate × seconds)
  - zero duration is clamped to the floor (matches Phase C reconciliation
    for the `short-audio` capture)
  - invalid pricing_json returns `errT`
- `getPublicPricing`:
  - returns one `DisplayPricingItem` per SKU
  - `sku_label`, `displayMultiplier`, `unitLabel` match what the
    marketplace UI renders (see the UI spot-check in
    [`audio-e2e-testing`](../audio-e2e-testing/SKILL.md))
- `getCacheUsage`: returns 0 cached tokens

If the adapter has surcharges (Step 1), add a case asserting the surcharge
is applied (or, if the surcharge is opt-in, that the default path does NOT
charge for it).

### Step 13 — Lint, typecheck, test

Run scoped to the touched packages — the monorepo-wide `bun run lint` /
`bun run typecheck` are slow. Use the scoped commands below instead.

```bash
cd packages/stt && bunx oxlint --fix --config ../../oxlint.config.ts --no-error-on-unmatched-pattern .
cd packages/stt && bun run typecheck
cd packages/pricing && bunx oxlint --fix --config ../../oxlint.config.ts --no-error-on-unmatched-pattern .
cd packages/pricing && bun run typecheck

# Tests scoped to the affected packages:
bun run test --filter @openrouter-monorepo/stt
bun run test --filter @openrouter-monorepo/pricing
```

All four must pass before moving on. Do NOT modify a test to make it pass;
if a test fails, fix the adapter.

### Acceptance criteria

- [ ] All files from "Files to touch" exist (including the
      `resolve-adapter-name-for-model` slug-prefix entry from Step 10)
- [ ] `STTAdapterName.${PROVIDER_NAME}STTAdapter` and
      `PricingStrategyName.${PROVIDER_NAME}STT` are registered
- [ ] Adapter implements all five abstract methods plus any overrides the
      research note required
- [ ] Pricing strategy floor (if any) matches adapter
      `getResponseUsageSeconds` floor exactly
- [ ] Fixtures imported in `index.test.ts` and asserted against
- [ ] `getPublicPricing` returns labels / units that will render correctly
      (verify with the UI spot-check in
      [`audio-e2e-testing`](../audio-e2e-testing/SKILL.md) after staging)
- [ ] `bun run typecheck` clean, `bunx oxlint --config ../../oxlint.config.ts --no-error-on-unmatched-pattern` clean
- [ ] `bun run test --filter @openrouter-monorepo/stt` and
      `--filter @openrouter-monorepo/pricing` pass
- [ ] No `any`, no `as` on runtime data, no `console.log`, no `try`/`catch`
- [ ] All `errT` calls have `location: '${PROVIDER_NAME}STTAdapter.<method>:<phase>'`

Before opening the PR, review the change against `packages/stt/REVIEW.md`.

### Troubleshooting

**`name satisfies never` compile error in the factory.** You added the
switch case but not the enum entry. Re-check Step 2.

**Pricing test asserts `cost: 0` instead of expected cost.** The
`isDurationBased` check in the strategy is reading the wrong field, or the
endpoint mock's `pricing_json` does not have the SKU key the strategy
expects. Print `pricingJson` before the cost calc and verify the keys.

**Adapter test fails with `ZodError: Required` on a field your fixture
clearly has.** Two likely causes: (1) the schema in `response-schema.ts`
made the field required when the provider actually returns it optionally,
or (2) the fixture has a typo. Always trust the live capture over the
schema — update the schema to `.optional()`, not the fixture.

**`getProviderPassthroughOptions()` returns undefined when you expect data.**
The provider slug in the test must match exactly. Alibaba's test sets
`provider_slug: ProviderName.Alibaba` via
`endpointOverrides.provider_name`; the slug must round-trip through
`isValidProviderSlug`.

**`response.body?.cancel()` lint error on the error path.** Body cancellation
applies when you read the body and then bail out of the consumer chain.
For the error path you have already consumed `response.text()`, so no
cancel is required. The lint rule has an exception for already-consumed
bodies. See
`AGENTS.md` → Async.

**`bun run test --filter @openrouter-monorepo/stt` cannot find the fixture
JSON.** The `with { type: 'json' }` import attribute requires the file path
to be present at compile time. Make sure both fixture files are committed
and the path is relative to the test file.

### Related skills

- [`audio-research-provider`](../audio-research-provider/SKILL.md) — produces
  the inputs this skill consumes
- [`audio-stage-endpoint`](../audio-stage-endpoint/SKILL.md) — stage the new
  model + endpoint in local Postgres and verify end-to-end (Step 11)
- [`audio-provider-onboarding`](../audio-provider-onboarding/SKILL.md) — the
  full flow

Before opening the PR, review the change against `packages/stt/REVIEW.md`
(STT) or `packages/tts/REVIEW.md` (TTS).

### Key source files for reference

| File | Read it for |
| --- | --- |
| `packages/stt/adapters/base.ts` | Adapter contract; abstract method signatures |
| `packages/stt/adapters/openai/index.ts` | Canonical FormData adapter with `CORE_FIELDS` blocklist |
| `packages/stt/adapters/groq/index.ts` | Inheritance + `getResponseUsageSeconds` floor |
| `packages/stt/adapters/google-cloud/index.ts` | JSON body + hardcoded URL override |
| `packages/pricing/strategies/stt/strategy.ts` | OpenAI duration-or-token strategy |
| `packages/pricing/strategies/stt/groq-strategy.ts` | Duration-only strategy with floor |
| `packages/pricing/strategies/base.ts` | `PricingStrategy` base class + `DisplayPricingItem` |
| `packages/stt-interfaces/schemas/request/index.ts` | `STTRequestInput` shape |
| `packages/stt-interfaces/schemas/response/index.ts` | `STTResponse` shape (target normalization) |


## TTS

Phase 2 of [`audio-provider-onboarding`](../audio-provider-onboarding/SKILL.md).
Requires a signed-off research note from
[`audio-research-provider`](../audio-research-provider/SKILL.md) — every
decision below (auth scheme, voice mapping, PCM params, billable unit)
should already be answered there.

Reference adapters: `packages/tts/adapters/openai/` (minimal),
`packages/tts/adapters/azure/` (custom URL/headers/body),
`packages/tts/adapters/mistral/` (validateRequest + custom fetch/stream
decode), `packages/tts/adapters/google-vertex/` (PCM-only + custom
getUsage).

### Step 1 — Register the adapter name

Add `<Provider>TTSAdapter` to `TTSAdapterName` in
`packages/enums/adapters.ts`.

### Step 2 — Implement the adapter

Create `packages/tts/adapters/$PROVIDER_SLUG/index.ts` extending
`BaseTTSAdapter` (`packages/tts/adapters/base.ts`). Override only what the
research note says differs from the defaults:

- **`transformRequest()`** (required, abstract): map OpenRouter's
  canonical fields (`endpoint.provider_model_id`, `request.input`,
  `request.voice`, `request.response_format`, `request.speed`) to the
  provider's body. Spread `this.getProviderPassthroughOptions()` **first**
  so canonical fields always win over user passthrough, and never forward
  callback/webhook URL params from passthrough (SSRF). `request.voice`
  must always be honored — if the provider encodes the voice in its
  upstream model ID, map the request `voice` to that param and validate
  it against the supported voice list; never pin the endpoint's
  `provider_model_id` and ignore `voice`.
- **`validateRequest()`** when the provider can't serve some canonical
  inputs — return `errT(...)` with a 400 and an actionable message (see
  Mistral's mp3-only check) instead of letting the upstream 4xx leak.
- **`getUrl()`** when the path isn't `/audio/speech`. Base it on
  `this.endpoint.provider_info.baseUrl` so passthrough/base-URL overrides
  keep working — don't hardcode the provider host.
- **`getHeaders()`** when auth isn't `Authorization: Bearer` + JSON
  (e.g. Deepgram's `Token <key>`, Azure's subscription-key header).
- **`getPcmParameters()`** whenever `pcm` is a supported format: return
  the exact `TTSPcmParameters` (sample rate, bit depth, channels) from
  the research captures.
- **`streamAudioBytes()`** when the provider's byte stream isn't raw
  audio (e.g. SSE-wrapped base64 chunks) — decode to raw audio bytes.
- **`getUsage()`** when generic character billing
  (`TTSSKU.Characters` = `input.length` UTF-16 code units) is inaccurate
  per the research note — report provider-reported usage or token counts
  captured during streaming instead (see `google-vertex`).
- **Request-ID handling**: `BaseTTSAdapter.fetch()` auto-captures
  `request-id` / `x-request-id` / `x-amzn-requestid` /
  `apim-request-id`. If the provider uses a different header, capture it
  (override `fetch()` like Mistral does when you need response
  post-processing anyway).

Follow repo style: Result monads over throws, no `any`, Zod for any
response bodies you parse, early returns.

### Step 3 — Register the adapter

- `packages/tts/adapters/adapter-factory.ts`: map the new
  `TTSAdapterName` to the class.
- `packages/tts/adapters/supported-formats.ts`: add the adapter's entry
  to `TTS_ADAPTER_SUPPORTED_FORMATS` with exactly the formats proven in
  research.
- `packages/tts/configs/get-adapter-name.ts`: add a `ProviderName` case
  if the provider should default to this adapter.

### Step 4 — Pricing

- Generic path: the endpoint's pricing JSON uses `TTSSKU.Characters`
  (`packages/pricing/strategies/tts/skus.ts`) with the existing
  `TTSPricingStrategy` — no code change.
- Custom path (tokens / provider-reported usage / premiums): add a
  strategy under `packages/pricing/strategies/<provider>-tts/`, register
  it in `packages/enums/pricing-strategy.ts` and
  `packages/pricing/strategies/get-pricing-strategy.ts`, mirroring
  `gemini-tts`.

### Step 5 — Unit tests

`packages/tts/adapters/$PROVIDER_SLUG/index.test.ts` (bun:test, fixtures
from research). Required coverage:

- model/voice mapping: `provider_model_id` and `request.voice` land in
  the right upstream fields, alternate voice switches
- auth + content type: exact headers from `getHeaders()`
- request shape: full `transformRequest()` output against fixtures
- formats/encoding: each supported `response_format` maps to the right
  provider param; unsupported formats rejected by `validateRequest()`
- speed: forwarded when supported, omitted/ignored when not
- PCM metadata: `getPcmParameters()` matches the research captures
- provider-option isolation: passthrough options for **other** providers
  never leak into the body
- canonical fields win: passthrough attempting to override `model` /
  `input` / `voice` loses
- callback/URL SSRF protection: callback/webhook params from passthrough
  are dropped
- binary/streamed audio: `streamAudioBytes()` yields the expected raw
  bytes for the provider's stream shape
- exact billing units: `getUsage()` for ASCII **and** multi-byte
  (emoji/CJK) input matches the research note's billable-unit
  definition, including custom-SKU strategies when present

### Done when

- Adapter + registrations compile with no leftover `switch`
  exhaustiveness errors
- `bun test packages/tts` and any new pricing-strategy tests pass
- The change is reviewed against `packages/tts/REVIEW.md`; proceed to
  [`audio-stage-endpoint`](../audio-stage-endpoint/SKILL.md)
