---
name: add-provider-adapter
description: Add a new provider adapter to the router — covers enum, adapter class, factory registration, config mapping, and tests
user-invocable: true
---

# Add Provider Adapter

Follow this checklist when adding a new **sync inference** provider adapter.
The pattern is mechanical — compare any two recent adapters (e.g., `nextbit.ts`
and `ionet.ts`) to see how nearly identical they are.

> **Note:** This skill is for sync inference adapters in
> `packages/router/adapters/`; for embeddings/rerank provider onboarding, use
> [`embeddings-rerank-provider-onboarding`](../embeddings-rerank-provider-onboarding/SKILL.md).
> For Batch API provider adapters, use
> [`add-batch-provider`](../add-batch-provider/SKILL.md) instead.

## Arguments

- `$PROVIDER_NAME`: PascalCase provider name (e.g., `NextBit`, `IoNet`, `AtlasCloud`)
- `$ADAPTER_FILE`: kebab-case file name without extension (e.g., `nextbit`, `ionet`, `atlas-cloud`)
- `$BASE_CLASS`: Base adapter class to extend (default: `OpenAICompatibleInternalStreamAdapter` from `./openai/internal-stream-adapter`; use `VLLMOpenAIAdapter` from `./engine/vllm-openai` for VLLM providers)

## Steps

### 1. Add enum value to `packages/enums/adapters.ts`

Add a new entry to the `AdapterName` enum (maintain existing order — roughly alphabetical):

```ts
// packages/enums/adapters.ts
export enum AdapterName {
  // ... existing entries ...
  ${PROVIDER_NAME}Adapter = '${PROVIDER_NAME}Adapter',
  // ... existing entries ...
}
```

### 2. Create adapter class in `packages/router/adapters/${ADAPTER_FILE}.ts`

Create the adapter file. Follow this structure:

```ts
import type { ErrorT } from '@openrouter-monorepo/instrumentation/error';
import type { AsyncResult } from '@openrouter-monorepo/type-utils/result-monad';
import type { OpenAIParams } from './openai';

import { definedValues } from '@openrouter-monorepo/type-utils';
import { isErr, ok } from '@openrouter-monorepo/type-utils/result-monad';
import { OpenAICompatibleInternalStreamAdapter } from './openai/internal-stream-adapter';

// Define a Params type extending OpenAIParams with provider-specific fields
export type ${PROVIDER_NAME}Params = OpenAIParams & {
  // Add provider-specific request fields here
};

export class ${PROVIDER_NAME}Adapter extends OpenAICompatibleInternalStreamAdapter {
  override async transformRequest(): AsyncResult<${PROVIDER_NAME}Params, ErrorT> {
    const result = await super.transformRequest();
    if (isErr(result)) {
      return result;
    }

    return ok(
      definedValues({
        ...result.data,
        // Add provider-specific transformations here
      } satisfies ${PROVIDER_NAME}Params),
    );
  }
}
```

Key patterns to know:
- **Always** call `super.transformRequest()` first and check `isErr(result)`
- **Always** use `definedValues({...})` to strip undefined keys
- **Always** use `satisfies ${PROVIDER_NAME}Params` for type safety
- Use `ok(...)` to wrap the successful return
- Common extensions:
  - **Reasoning toggle**: Use `shouldApplyReasoningToggleParams(this.endpoint)` from `@openrouter-monorepo/db/endpoints` and `this.parameters.reasoning.enabled`
  - **VLLM providers**: Extend `VLLMOpenAIAdapter` from `./engine/vllm-openai` instead of `OpenAICompatibleInternalStreamAdapter` — this automatically handles `chat_template_kwargs` for VLLM thinking params
  - **Reasoning effort**: Use `buildReasoningParams` from `./utils/build-reasoning-params` for providers that support `reasoning.effort`
  - **Encoded images**: Extend `EncodedImageOpenAIAdapter` from `./encoded-image-openai` (which itself extends `OpenAICompatibleInternalStreamAdapter`) for providers needing image input hydration

### 2b. Pin hard-coded provider limits to the provider's docs

Whenever the adapter hard-codes something the provider publishes — a
`clampRange`/`clampRangeOptional` range, a cap, an injected default, a
capability gate — bind it to the document that justifies it with a `doc-pin`
comment. A weekly Devin automation greps for these tags on `main`, re-fetches
each document, and opens a PR when a pinned claim no longer holds. Nothing
lints them, so a malformed pin is only noticed as `malformed` in the sweep.

Declare the document once per file, then put the claim directly above the line it justifies:

```ts
// doc-pin-source: https://mancer.tech/resources/api-docs-webui.yml

// doc-pin: SamplerParameters.repetition_penalty.minimum = 1 | checked 2026-09-14
repetition_penalty: clampRangeOptional(this.parameters.repetitionPenalty.value, { min: 1 }),
```

Rules of the format:
- `doc-pin-source: <https url>` — one per file. Short pins inherit it.
- `doc-pin: [<https url> |] <claim> | checked YYYY-MM-DD` — the URL is only needed when the pin cites a different document than the file's source.
- `<claim>` is a selector path (for OpenAPI/JSON docs) or a short quoted phrase (for HTML prose), followed by `= <observed value>`, so the sweep can re-evaluate it rather than only notice that the page changed. A bare URL is not a pin.
- `checked` is the date you confirmed the claim against the live document.

Pin only encoded provider facts. Passthrough fields need nothing. See
`packages/router/adapters/mancer.ts`, `cloudflare.ts`, and
`perplexity/index.ts` for seeded examples.

### 3. Register in `packages/router/adapters/adapter-factory.ts`

Add both the import and the factory entry:

```ts
// Add import (maintain existing order — roughly alphabetical)
import { ${PROVIDER_NAME}Adapter } from './${ADAPTER_FILE}';

// Add to adapterFactory object (maintain existing order)
export const adapterFactory = {
  // ... existing entries ...
  [AdapterName.${PROVIDER_NAME}Adapter]: ${PROVIDER_NAME}Adapter,
  // ... existing entries ...
} as const;
```

### 3b. Classify in `packages/enums/openai-chat-family-adapters.ts`

`IS_OPENAI_CHAT_FAMILY_ADAPTER` is an exhaustive `satisfies Record<AdapterName, boolean>` map, so adding a new `AdapterName` is a **compile error until you classify it here**. Set it to `true` if the adapter extends `OpenAICompatibleInternalStreamAdapter` (the default for OpenAI chat-completions-wire providers, including `VLLMOpenAIAdapter` and `EncodedImageOpenAIAdapter`), or `false` if it extends a base class with native `reasoning_details` support (Anthropic Messages, OpenAI Responses, Gemini, or any image/internal-stream-only adapter). A router-side test (`packages/router/plugins/normalize-request/get-default-reasoning-return-mechanism.test.ts`) asserts the map matches the set derived from the adapter class hierarchy, so a misclassification fails CI.

### 4. Add mapping in `packages/providers/configs/get-adapter-class.ts`

Most providers use the default `adapterName` from `providerInfo` and do **not** need a special case in this file. Only add a `case` to the `switch (providerName)` block if the provider needs model-specific adapter selection (e.g., OpenAI routes different models to different adapters).

For the typical case, the adapter is configured via the provider's `adapterName` field in the database — no code change needed here.

### 5. Write tests in `packages/router/adapters/${ADAPTER_FILE}.test.ts`

Create tests using `createMockAdapterFromEndpoint` and `assertOk`:

```ts
import { Model } from '@openrouter-monorepo/models/id';
import { createMockModelEndpoint } from '@openrouter-monorepo/providers/test/mock-endpoint';
import { assertOk } from '@openrouter-monorepo/type-utils/result-monad';
import { describe, expect, it } from 'vitest';
import { createMockAdapterFromEndpoint } from '../mocks/mock-adapter';
import { ${PROVIDER_NAME}Adapter } from './${ADAPTER_FILE}';

const endpoint = createMockModelEndpoint(Model.Auto, {
  endpointOverrides: {
    supports_reasoning: true,
    // Add other endpoint overrides as needed
  },
});

describe('${PROVIDER_NAME}Adapter', () => {
  it('transforms request correctly', async () => {
    const adapter = await createMockAdapterFromEndpoint(endpoint, {
      BaseClass: ${PROVIDER_NAME}Adapter,
      rawRequest: {
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
      },
    });

    const result = await adapter.transformRequest();
    assertOk(result);

    // Add assertions for provider-specific fields
  });
});
```

Key testing patterns:
- Use `createMockModelEndpoint(Model.Auto, { ... })` to set up endpoints with specific capabilities
- Pass `BaseClass: ${PROVIDER_NAME}Adapter` to `createMockAdapterFromEndpoint`
- Use `assertOk(result)` (not `expect(isOk(result)).toBe(true)`) for Result type assertions
- Test both present and absent provider-specific params
- For reasoning: test `enabled: true`, `enabled: false`, and undefined cases
- For mandatory reasoning models: add `modelOverrides: { reasoning_config: { is_mandatory_reasoning: true } }`
- For reasoning effort: add `modelOverrides: { reasoning_config: { supports_reasoning_effort: true } }`

### 6. Run tests and checks

```bash
bun run test packages/router/adapters/${ADAPTER_FILE}.test.ts
```

If the new adapter also adds a `ProviderName`, regenerate the cfw-api zod guards or the `typecheck` CI job fails with `generated_zod_guards_are_stale`:

```bash
cd services/cfw-api && bun scripts/generate-zod-guards.ts
```

The `mcp-regen-check` CI job also fails until the MCP toolset picks up the new enum value. Follow the `add-mcp-tool` skill's 3-step regen (`bun run generate:openapi`, then `bun run regen` in `services/cfw-mcp`, then `bun test`) and commit `services/cfw-mcp/generated/`.

## Files touched (summary)

| File | Change |
|------|--------|
| `packages/enums/adapters.ts` | Add enum value |
| `packages/router/adapters/${ADAPTER_FILE}.ts` | New adapter class |
| `packages/router/adapters/adapter-factory.ts` | Import + factory entry |
| `packages/enums/openai-chat-family-adapters.ts` | Classify as OpenAI chat-family or not |
| `packages/router/adapters/adapter-capabilities.ts` | Add to `openAiToolMessageAdapterNames` if the adapter class sets `acceptsOpenAiToolMessages` (allowlist, not exhaustive — enforced by the `openai-chat-adapter-set.test.ts` drift/snapshot test, not the compiler) |
| `packages/router/adapters/adapter-wire-shape.ts` | Add a `case` to the matching wire-shape switch (exhaustive via `satisfies never` in `default` — compile error until categorized) |
| `packages/providers/configs/get-adapter-class.ts` | Only if model-specific routing needed |
| `packages/router/adapters/${ADAPTER_FILE}.test.ts` | New test file |

## Canonical examples

- Simple adapter (reasoning toggle): `packages/router/adapters/nextbit.ts` (48 lines)
- Simple adapter (VLLM thinking): `packages/router/adapters/ionet.ts` (13 lines)
- Adapter with reasoning effort: `packages/router/adapters/openinference.ts` (35 lines)
- VLLM adapter with reasoning effort in `chat_template_kwargs`: `packages/router/adapters/digital-ocean.ts` (40 lines)
- Complex adapter (SKU pricing + reasoning): `packages/router/adapters/byteplus/index.ts` (72 lines)
