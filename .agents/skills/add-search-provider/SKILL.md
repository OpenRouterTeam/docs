---
name: add-search-provider
description: >-
  Add a new web search provider (engine) to OpenRouter's
  search infrastructure. Covers the enum, API client,
  plugin dispatch, server-tools dispatch, cost/SKU,
  environment wiring, frontend UI, OpenAPI docs, and tests.
user-invocable: true
---

# Add a Search Provider

End-to-end checklist for wiring a new search engine into
OpenRouter. The web search system has two parallel
execution paths (plugin path and server-tools path), a
cost/billing layer, frontend UI, and OpenAPI documentation.
Every new engine touches all of them.

## Arguments

- `$ENGINE`: lowercase slug for the engine (e.g.
  `perplexity`, `tavily`, `serper`)
- `$ENGINE_PASCAL`: PascalCase name (e.g. `Perplexity`,
  `Tavily`, `Serper`)
- `$API_KEY_ENV`: environment variable name for the
  provider's API key (e.g. `PERPLEXITY_API_KEY`)

## Prerequisites

- Provider API documentation reviewed, auth mechanism
  understood
- Pricing model confirmed (per-request, per-result, flat,
  etc.)
- API key provisioned for testing (add to Infisical under
  the appropriate path or use `.env.development.local`)

## Steps

### 1. Add the enum value and pricing constants

**File:** `packages/enums/web-search-engine.ts`

Add the new member to the `WebSearchEngine` enum and
define per-request pricing constants below it:

```typescript
export enum WebSearchEngine {
  // ... existing members
  $ENGINE_PASCAL = '$ENGINE',
}

/* $ENGINE_PASCAL per-request user pricing */
export const ${ENGINE_UPPER}_USER_BASE_COST_PER_REQUEST_DOLLARS = <cost>;
export const ${ENGINE_UPPER}_USER_PER_EXTRA_RESULT_COST_DOLLARS = <cost>; // 0 if flat per-request pricing
export const ${ENGINE_UPPER}_USER_BASE_RESULTS_INCLUDED = <count>;
```

Note: Some providers use flat per-request pricing (no
per-result surcharge). Set `PER_EXTRA_RESULT_COST` to `0`
and add a comment explaining the pricing model.

### 2. Add PlatformSKU entries

**File:** `packages/pricing/strategies/base.ts`

Add two new SKU keys:

```typescript
WebSearchRequest$ENGINE_PASCAL: 'platform:web_search_request_$ENGINE',
WebSearchExtraResult$ENGINE_PASCAL: 'platform:web_search_extra_result_$ENGINE',
```

### 3. Wire SKU cost aggregation

**File:** `packages/pricing/strategies/plugin-sku-cost.ts`

Import the new pricing constants and add a billing block
(follows the same pattern as Exa/Parallel):

```typescript
const ${ENGINE}SearchRequests = reducedSKUItems.get(PlatformSKU.WebSearchRequest$ENGINE_PASCAL);
if (${ENGINE}SearchRequests) {
  webSearchCost = webSearchCost.plus(
    bn(${ENGINE}SearchRequests).times(${ENGINE_UPPER}_USER_BASE_COST_PER_REQUEST_DOLLARS),
  );
}

const ${ENGINE}ExtraResults = reducedSKUItems.get(PlatformSKU.WebSearchExtraResult$ENGINE_PASCAL);
if (${ENGINE}ExtraResults) {
  webSearchCost = webSearchCost.plus(
    bn(${ENGINE}ExtraResults).times(${ENGINE_UPPER}_USER_PER_EXTRA_RESULT_COST_DOLLARS),
  );
}
```

### 4. Add the API key to the router environment schema

**Files:**

- `packages/router/env.ts` (add to `RouterEnvSchema`)
- `packages/router/mock-env.ts` (add mock value)

```typescript
// env.ts
$API_KEY_ENV: z.string().optional(),

// mock-env.ts
$API_KEY_ENV: 'test-$ENGINE-api-key',
```

### 5. Create the API client

**File:** `packages/router/plugins/web-search/$ENGINE-client.ts`

This is the core HTTP client that calls the provider's
search API, validates the response with Zod, and maps
results to the shared `WebSearchResponse` type.

Pattern to follow (see `exa-client.ts`, `parallel-client.ts`):

```typescript
import type { ErrorT } from '@openrouter-monorepo/instrumentation/error';
import type { WebSearchResponse } from '@openrouter-monorepo/llm-interfaces/plugins/web-search/schemas';
import type { AsyncResult } from '@openrouter-monorepo/type-utils/result-monad';

import { HTTPStatus } from '@openrouter-monorepo/enums/http-status';
import { fetchJsonResult } from '@openrouter-monorepo/helpers/fetch';
import { errT } from '@openrouter-monorepo/instrumentation/error';
import { iLog, wLog } from '@openrouter-monorepo/instrumentation/logger';
import { isErr, ok } from '@openrouter-monorepo/type-utils/result-monad';
import { z } from '@openrouter-monorepo/type-utils/zod';

const ${ENGINE_UPPER}_SEARCH_URL = '<provider endpoint>';

// Define Zod schemas for the provider's response format
const ${ENGINE_PASCAL}SearchResponseSchema = z.object({ /* ... */ });

type Search${ENGINE_PASCAL}Params = {
  apiKey: string;
  query: string;
  maxResults: number;
  maxCharacters?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
};

export function search${ENGINE_PASCAL}(
  params: Search${ENGINE_PASCAL}Params,
): AsyncResult<WebSearchResponse, ErrorT> {
  // 1. Build provider-specific request body
  // 2. Call fetchJsonResult with the Zod schema
  // 3. On error: wLog + return errT (502)
  // 4. On success: map provider results to WebSearchResponse shape:
  //    { results: [{ id, url, title, text }], resolvedSearchType: '$ENGINE' }
}
```

Key requirements:

- Validate the upstream response with Zod (never trust
  provider docs blindly)
- Use `fetchJsonResult` for type-safe fetching
- Return `AsyncResult<WebSearchResponse, ErrorT>`
- Map results to the unified shape: `{ id, url, title, text }`
- Set `resolvedSearchType: '$ENGINE'` so billing resolves
  to the correct engine (you must first extend the union
  type — see Step 5b below)
- If the provider supports a native content-budget param
  (like `max_tokens_per_page`), convert from
  `maxCharacters` using an appropriate heuristic and
  also apply a client-side `slice(0, maxCharacters)` as
  a safety belt

### 5b. Extend `resolvedSearchType` union

**File:** `packages/llm-interfaces/plugins/web-search/schemas.ts`

The `WebSearchResponse.resolvedSearchType` field is a closed
string-literal union. Add `'$ENGINE'` to it so the client
return value type-checks:

```typescript
resolvedSearchType?: 'neural' | 'keyword' | 'firecrawl' | 'parallel' | 'perplexity' | '$ENGINE';
```

Without this, TypeScript will reject the
`resolvedSearchType: '$ENGINE'` assignment in the client.

### 6. Wire plugin dispatch

**File:** `packages/router/plugins/web-search/index.ts`

Three changes:

1. Import the new client:

   ```typescript
   import { search${ENGINE_PASCAL} } from './$ENGINE-client';
   ```

2. Add dispatch branch in `fetchResults()` (before
   the default Exa fallback):

   ```typescript
   if (this.#engine === WebSearchEngine.$ENGINE_PASCAL) {
     return this.#fetch${ENGINE_PASCAL}Results(query);
   }
   ```

3. Add the private method `#fetch${ENGINE_PASCAL}Results`:

   ```typescript
   async #fetch${ENGINE_PASCAL}Results(query: string): AsyncResult<WebSearchResponse, ErrorT> {
     const envResult = ensureEnv();
     if (isErr(envResult)) { /* wLog + errT */ }

     const apiKey = envResult.data.$API_KEY_ENV;
     if (!apiKey) { /* errT: key not set */ }

     return search${ENGINE_PASCAL}({
       apiKey,
       query,
       maxResults: this.maxResults,
       includeDomains: this.#includeDomains,
       excludeDomains: this.#excludeDomains,
     });
   }
   ```

### 7. Wire compute-web-search-cost

**File:** `packages/router/plugins/web-search/compute-web-search-cost.ts`

1. Add `WebSearchEngine.$ENGINE_PASCAL` to the
   `WebSearchCostEngine` union type
2. Add a `compute${ENGINE_PASCAL}Cost()` function.
   The shape depends on the provider's pricing model:
   - **Base + extra-result SKU** (`computeExaCost` /
     `computeParallelCost`): emits a request SKU plus an
     extra-result SKU for results beyond
     `BASE_RESULTS_INCLUDED`.
   - **Flat per-request** (`computePerplexityCost`): emits
     only a single request SKU, no extra-result SKU.
   - **No platform SKU** (`computeFirecrawlCost`): returns
     empty `skuItems: []` (cost handled elsewhere or
     unmetered).
3. Add the case to the `switch` in
   `computeWebSearchInvocationCost()`
4. Add the case to `resolveWebSearchCostEngine()` so
   billing resolves `'$ENGINE'` to the correct handler

### 8. Wire billing in `packages/tools/cost.ts`

**File:** `packages/tools/cost.ts`

This file has `resolveWebSearchBillingEngine()` which maps
the user-requested engine to a billing engine for the
server-tools direct API path. Add the new engine:

```typescript
function resolveWebSearchBillingEngine(
  engineRequested: string | null,
):
  | WebSearchEngine.Exa
  | WebSearchEngine.Parallel
  | WebSearchEngine.Firecrawl
  | WebSearchEngine.$ENGINE_PASCAL {
  switch (engineRequested) {
    // ... existing cases
    case WebSearchEngine.$ENGINE_PASCAL:
      return WebSearchEngine.$ENGINE_PASCAL;
    default:
      return WebSearchEngine.Exa;
  }
}
```

Also update the return type annotation to include the new
engine variant.

### 9. Create server-tools execute function

**File:** `packages/router/plugins/server-tools/web-search/execute-$ENGINE.ts`

This is the server-tools path (used when the model calls
the tool via the agent SDK). Follows the same pattern as
`execute-exa.ts` / `execute-parallel.ts`:

```typescript
import type { SearchContextSizeKey, WebSearchToolResult } from './constants';

import { wLog } from '@openrouter-monorepo/instrumentation/logger';
import { isErr } from '@openrouter-monorepo/type-utils/result-monad';
import { ensureEnv } from '../../../env';
import { search${ENGINE_PASCAL} } from '../../web-search/$ENGINE-client';
import { DEFAULT_MAX_RESULTS, SEARCH_CONTEXT_SIZE_MAP } from './constants';

type Execute${ENGINE_PASCAL}SearchParams = {
  query: string;
  max_results?: number;
  allowed_domains?: string[];
  excluded_domains?: string[];
  search_context_size?: SearchContextSizeKey;
  max_characters?: number;
};

export async function execute${ENGINE_PASCAL}Search(
  params: Execute${ENGINE_PASCAL}SearchParams,
): Promise<WebSearchToolResult> {
  // 1. ensureEnv() + check API key
  // 2. Resolve max_characters vs search_context_size
  // 3. Call search${ENGINE_PASCAL}()
  // 4. Map to WebSearchToolResult shape
}
```

### 10. Register in server-tools dispatch

**File:** `packages/router/plugins/server-tools/web-search/web-search-tool.ts`

1. Add `'$ENGINE'` to `WEB_SEARCH_ENGINE_VALUES`:

   ```typescript
   export const WEB_SEARCH_ENGINE_VALUES = ['auto', 'native', 'exa', 'parallel', 'firecrawl', 'perplexity', '$ENGINE'] as const;
   ```

2. Import and add a `case '$ENGINE':` to the `switch` in
   `executeWebSearch()`:

   ```typescript
   import { execute${ENGINE_PASCAL}Search } from './execute-$ENGINE';

   case '$ENGINE':
     return execute${ENGINE_PASCAL}Search({
       query,
       max_results,
       allowed_domains,
       excluded_domains,
       search_context_size,
       max_characters,
     });
   ```

3. Update the `WebSearchEngineSchema` `.openapi()`
   description string to list the new engine.

4. Update `WebSearchMaxResultsSchema`,
   `WebSearchContextSizeSchema`, and
   `WebSearchMaxCharactersSchema` descriptions if the new
   engine supports those parameters.

### 11. Frontend: plugin configure modal

**File:** `projects/web/app/[locale]/(user)/(dashboard)/workspaces/[workspaceId]/plugins/PluginConfigureModal.tsx`

Add a `<SelectItem>` in the engine dropdown:

```tsx
<SelectItem value={WebSearchEngine.$ENGINE_PASCAL}>$ENGINE_PASCAL</SelectItem>
```

### 12. Frontend: playground server-tool config

**File:** `projects/web/features/playground/definitions/server-tool-config.ts`

Add field configuration for the new engine in
`WEB_SEARCH_SDK_ENGINE_FIELDS`:

```typescript
$ENGINE: [
  'engine',
  'search_context_size',
  'max_characters',
  'max_results',
  'max_uses',
  'max_total_results',
  'allowed_domains',
  'excluded_domains',
],
```

`max_uses` is enforced at the tool level (not per-engine), so
include it for every engine. Only include the other fields the
provider actually supports.

### 13. Frontend: UI definitions

**File:** `projects/web/features/playground/ui/Composer/server-tool-ui-definitions.ts`

Two additions:

1. Add label override in `LABEL_OVERRIDES`:

   ```typescript
   $ENGINE: '$ENGINE_PASCAL',
   ```

2. Add description case in
   `getWebSearchEngineDescription()`:

   ```typescript
   case '$ENGINE':
     return 'Use the $ENGINE_PASCAL search API';
   ```

### 14. OpenAPI documentation

The OpenAPI spec at
`projects/docs/openapi/openapi.yaml` is generated.
Update the source descriptions in the TypeScript schema
files (Step 10 and the `llm-interfaces` schemas) so the
next generation run picks up the new engine name in
relevant field descriptions (e.g. `allowed_domains`,
`excluded_domains`, `max_characters`,
`search_context_size`).

### 15. Tests

Create/update the following test files:

1. **Client unit test:**
   `packages/router/plugins/web-search/$ENGINE-client.test.ts`
   (mock fetch, validate Zod parsing, error paths)

2. **Server-tools execute test:**
   `packages/router/plugins/server-tools/web-search/execute-$ENGINE.test.ts`
   (mock env + mock client, verify param mapping)

3. **Cost computation test:**
   `packages/router/plugins/web-search/compute-web-search-cost.test.ts`
   Add a `describe('$ENGINE')` block testing base cost
   and extra-result cost calculations.

4. **Plugin SKU cost test:**
   `packages/pricing/strategies/plugin-sku-cost.test.ts`
   (if it exists) or verify existing coverage handles the
   new SKU keys.

5. **Tool invocation cost test:**
   `packages/tools/cost.test.ts`
   Verify `resolveWebSearchBillingEngine` routes
   `'$ENGINE'` to `WebSearchEngine.$ENGINE_PASCAL`.

### 16. Local verification

```bash
bun run verify

# Run relevant tests
bun test packages/router/plugins/web-search/
bun test packages/router/plugins/server-tools/web-search/

# Manual smoke test
# 1. Add $API_KEY_ENV to .env.development.local
# 2. Start the API:
bun run dev cfw-api
# 3. Send a request:
curl -X POST localhost:8787/api/v1/chat/completions \
  -H 'Authorization: Bearer sk-or-v1-unlimitedkey' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "latest AI news"}],
    "tools": [{"type": "web_search", "search": {"engine": "$ENGINE"}}]
  }'
```

## File inventory (quick reference)

| Layer | File | What to add |
|-------|------|-------------|
| Enum | `packages/enums/web-search-engine.ts` | Enum member + pricing constants |
| SKU | `packages/pricing/strategies/base.ts` | Two SKU keys |
| SKU cost | `packages/pricing/strategies/plugin-sku-cost.ts` | Billing aggregation block |
| Env | `packages/router/env.ts` | API key in schema |
| Mock env | `packages/router/mock-env.ts` | Mock API key |
| Client | `packages/router/plugins/web-search/$ENGINE-client.ts` | HTTP client + Zod validation |
| llm-interfaces schema | `packages/llm-interfaces/plugins/web-search/schemas.ts` | Extend `resolvedSearchType` union |
| Plugin dispatch | `packages/router/plugins/web-search/index.ts` | Import + branch + private method |
| Cost | `packages/router/plugins/web-search/compute-web-search-cost.ts` | Cost function + switch cases |
| Server-tools exec | `packages/router/plugins/server-tools/web-search/execute-$ENGINE.ts` | Execute function |
| Server-tools dispatch | `packages/router/plugins/server-tools/web-search/web-search-tool.ts` | Engine value + switch case + schema descriptions |
| Billing (direct API) | `packages/tools/cost.ts` | `resolveWebSearchBillingEngine()` case + return type |
| Frontend modal | `projects/web/.../plugins/PluginConfigureModal.tsx` | SelectItem |
| Frontend config | `projects/web/features/playground/definitions/server-tool-config.ts` | Engine field map |
| Frontend UI | `projects/web/features/playground/ui/Composer/server-tool-ui-definitions.ts` | Label + description |
| Tests | Various `.test.ts` files | Client, execute, cost, tool-cost tests |

## Common pitfalls

- **Forgetting `resolvedSearchType`**: The client must
  return `resolvedSearchType: '$ENGINE'` so cost
  attribution resolves to the correct billing function.
  Without it, costs fall through to the Exa default.
  You must also extend the `resolvedSearchType` union in
  `packages/llm-interfaces/plugins/web-search/schemas.ts`
  (Step 5b) or the assignment won't type-check.

- **`WEB_SEARCH_ENGINE_VALUES` vs `WebSearchEngine` enum**:
  The server-tools path uses a string literal array
  (`WEB_SEARCH_ENGINE_VALUES` in `web-search-tool.ts`)
  separate from the `WebSearchEngine` enum in
  `packages/enums/`. Both must be updated.

- **OpenAPI spec is generated**: Never edit
  `projects/docs/openapi/openapi.yaml` directly.
  Update the `.openapi()` description strings in the
  TypeScript schema files.

- **`default` exhaustiveness**: The `switch` in
  `executeWebSearch()` uses `assertNever()` and the cost
  switch uses `engine satisfies never`. Adding an enum
  value without handling it in these switches causes
  compile errors (which is the point).

- **`packages/tools/cost.ts` billing resolution**: The
  server-tools direct API path resolves billing through
  `resolveWebSearchBillingEngine()` in `packages/tools/cost.ts`.
  This is separate from `resolveWebSearchCostEngine()` in
  `compute-web-search-cost.ts` (used by the plugin path).
  Both must handle the new engine.

- **Provider-specific API constraints**: Some providers
  have mutually exclusive parameters (e.g. Perplexity
  rejects `search_context_size` + `max_tokens_per_page`
  together). Handle these constraints in the execute
  function and document them.

- **Client-side safety belt**: Even if the provider
  accepts a native content-budget parameter, apply a
  `slice(0, maxCharacters)` on the returned text as a
  safety guarantee. Providers sometimes over-return.
