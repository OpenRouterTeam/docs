---
name: add-provider-monitor
description: Add a new provider monitor config — covers schema definition, StandardMonitor creation, and registration in the all-monitors index
user-invocable: true
---

# Add Provider Monitor

Follow this checklist when adding a new provider monitor. The pattern is consistent across all monitors — compare recent examples like `nextbit`, `modelrun`, `io-net`, or `aion-labs`.

For an embeddings/rerank provider launch, start with
[`embeddings-rerank-provider-onboarding`](../embeddings-rerank-provider-onboarding/SKILL.md)
and use this skill for the monitor phase.

## Arguments

- `$PROVIDER_NAME`: The `ProviderName` enum value (e.g., `ProviderName.NextBit`, `ProviderName.IONet`)
- `$DIR_NAME`: kebab-case directory name (e.g., `nextbit`, `io-net`, `aion-labs`)
- `$MONITOR_VAR`: camelCase variable name for the monitor export (e.g., `nextBitMonitor`, `ioNetMonitor`)
- `$API_URL`: The provider's model listing API endpoint (e.g., `https://api.nextbit256.com/v1/models`)

## Steps

### 1. Create config directory and file

Create `packages/provider-monitors/configs/${DIR_NAME}/index.ts`.

Choose the appropriate template based on the provider's API:

#### Template A: Simple monitor (no auth, standard response shape)

Use when the provider's `/v1/models` endpoint is public and returns `{ data: [...] }`.

```ts
import { ProviderName } from '@openrouter-monorepo/enums/providers';
import { z } from '@openrouter-monorepo/type-utils/zod';
import {
  StandardModelDataSchema,
  StandardMonitor,
} from '@openrouter-monorepo/provider-monitors/classes/standard';

const ${PROVIDER_NAME}ModelSchema = StandardModelDataSchema.partial()
  .extend({
    id: z.string(),
    // Add provider-specific fields here
  })
  .transform((d) => ({
    ...d,
    name: d.name ?? d.id,
    // Add field normalizations here
  }));

export const ${MONITOR_VAR} = new StandardMonitor(
  ProviderName.${PROVIDER_NAME},
  '${API_URL}',
  {
    schema: ${PROVIDER_NAME}ModelSchema,
  },
);
```

> **Note:** Both `@openrouter-monorepo/provider-monitors/classes/standard` (package path) and `'../../classes/standard'` (relative path) work. The canonical `nextbit` example uses the package path; other monitors use relative. Be consistent within your file.

#### Template B: Monitor with auth headers

Use when the provider requires an API key (most providers).

```ts
import { ProviderName } from '@openrouter-monorepo/enums/providers';
import { z } from '@openrouter-monorepo/type-utils/zod';
import { getAuthorizationHeaders } from '../../classes/base/utils';
import { StandardModelDataSchema, StandardMonitor } from '../../classes/standard';

const ${PROVIDER_NAME}ModelSchema = StandardModelDataSchema.partial()
  .extend({
    id: z.string(),
    // Add provider-specific fields here
  })
  .transform((d) => ({
    ...d,
    name: d.name ?? d.id,
    // Add field normalizations here
  }));

export const ${MONITOR_VAR} = new StandardMonitor(
  ProviderName.${PROVIDER_NAME},
  '${API_URL}',
  {
    getHeaderMap: async () =>
      getAuthorizationHeaders({
        location: '${PROVIDER_NAME}Monitor.getHeaderMap',
        getKey: (env) => env.${ENV_KEY_NAME},
      }),
    schema: ${PROVIDER_NAME}ModelSchema,
  },
);
```

#### Template C: Monitor with custom response schema

Use when the provider's API does not return `{ data: [...] }` (e.g., returns `{ models: [...] }`).

```ts
import { ProviderName } from '@openrouter-monorepo/enums/providers';
import { z } from '@openrouter-monorepo/type-utils/zod';
import { getAuthorizationHeaders } from '../../classes/base/utils';
import { StandardModelDataSchema, StandardMonitor } from '../../classes/standard';

const ${PROVIDER_NAME}ModelSchema = StandardModelDataSchema.partial()
  .extend({
    id: z.string(),
    // Add provider-specific fields here
  })
  .transform((d) => ({
    ...d,
    name: d.name ?? d.id,
  }));

// Custom response schema to normalize the API response shape
const ${PROVIDER_NAME}ResponseSchema = z
  .object({
    models: z.array(z.object({}).passthrough()),  // Adjust the field name to match the API
  })
  .passthrough()
  .transform((data) => ({
    data: data.models,  // Normalize to { data: [...] } shape
  }));

export const ${MONITOR_VAR} = new StandardMonitor(
  ProviderName.${PROVIDER_NAME},
  '${API_URL}',
  {
    getHeaderMap: async () =>
      getAuthorizationHeaders({
        location: '${PROVIDER_NAME}Monitor.getHeaderMap',
        getKey: (env) => env.${ENV_KEY_NAME},
      }),
    responseSchema: ${PROVIDER_NAME}ResponseSchema,
    schema: ${PROVIDER_NAME}ModelSchema,
  },
);
```

### 2. Define the model schema

Extend `StandardModelDataSchema` with provider-specific fields using `.partial().extend()`.

The base `StandardModelDataSchema` already includes:
- `id`, `name`, `created`, `description`
- `context_length`, `max_prompt_tokens`, `max_completion_tokens`
- `quantization`, `hf_slug`
- `supported_sampling_parameters`, `supported_features`
- `pricing` (prompt/completion/image/audio/request/cache)
- `deprecation_date`, `discount_to_user`, `architecture`
- `is_ready` (provider-controlled launch signal)

Common provider-specific extensions:

```ts
// Provider uses different field names
.extend({
  id: z.string(),
  hugging_face_url: z.string().optional(),      // → normalize to hf_slug via getHuggingFaceSlugFromUrl
  hugging_face_id: z.string().nullish(),         // → StandardMonitor resolves hf_slug automatically
  max_output_length: z.number().nullish(),       // → normalize to max_completion_tokens
  quantization: z.enum(Quantization).nullish(),  // Import from @openrouter-monorepo/enums/quantizations
})
```

### 3. Add field normalizations in `.transform()`

Common normalizations:

```ts
.transform((d) => {
  // Map supported_features to supported_sampling_parameters
  const parametersFromFeatures = mapFeaturesToParameters(d.supported_features ?? []);

  return {
    ...d,
    name: d.name ?? d.id,                                        // Fallback name to id
    hf_slug: d.hf_slug ?? getHuggingFaceSlugFromUrl(d.hugging_face_url),  // Only needed for hugging_face_url
    max_completion_tokens: d.max_completion_tokens ?? d.max_output_length,  // Normalize max tokens
    supported_sampling_parameters: unique([                      // Merge features into params
      ...(d.supported_sampling_parameters ?? []),
      ...parametersFromFeatures,
    ]),
  };
})
```

Imports needed for `mapFeaturesToParameters` and HuggingFace URL normalization:
```ts
import { getHuggingFaceSlugFromUrl, unique } from '@openrouter-monorepo/helpers/misc';
import { mapFeaturesToParameters } from '../../classes/base/utils';
```

> **Note:** `StandardMonitor` automatically resolves `hf_slug` from `hugging_face_id` at build time (see `classes/standard.ts` line 469). You only need to normalize `hugging_face_url` in your transform. If the provider returns `hugging_face_id` directly, simply pass it through as-is — no manual normalization required.

### 4. Create `StandardMonitor` instance

The `StandardMonitor` constructor takes:
1. `providerName` — The `ProviderName` enum value
2. `url` — The provider's model listing API URL
3. `opts` — Optional configuration object:
   - `schema` — Zod schema for individual model data
   - `responseSchema` — Zod schema for the full API response (if non-standard shape)
   - `getHeaderMap` — Async function returning auth headers
   - `skuPricingMapper` — Custom SKU pricing mapper (for providers with custom pricing SKUs)
   - `disableAutoHideRemovedEndpoints` — Boolean to prevent auto-hiding models removed from the API

### 5. Register in `packages/provider-monitors/configs/all/index.ts`

Add the import and include the monitor in the `getProviderMonitors()` array:

```ts
// Add import (maintain existing order — roughly alphabetical)
import { ${MONITOR_VAR} } from '../${DIR_NAME}';

// Add to getProviderMonitors() array (maintain existing order)
export function getProviderMonitors(): ProviderMonitor[] {
  return [
    // ... existing monitors ...
    ${MONITOR_VAR},
    // ... existing monitors ...
  ];
}
```

### 6. Add the API key environment variable (if auth required)

If the provider requires authentication, add the API key to the providers env type at `packages/providers/env.ts` (within `ProvidersEnv`). The key name should follow the pattern `${UPPER_SNAKE_CASE_PROVIDER}_API_KEY`. This env type is already composed into `ProviderMonitorsEnv` via `packages/provider-monitors/env.ts`, so no changes are needed there.

### 7. (Optional) Add `vendor.test.ts`

Most monitor configs include a `vendor.test.ts` file for testing vendor API responses. Create `packages/provider-monitors/configs/${DIR_NAME}/vendor.test.ts` if the provider has specific response shapes worth validating. See existing `vendor.test.ts` files (e.g., `nextbit/vendor.test.ts`, `io-net/vendor.test.ts`) for examples.

## Files touched (summary)

| File | Change |
|------|--------|
| `packages/provider-monitors/configs/${DIR_NAME}/index.ts` | New monitor config |
| `packages/provider-monitors/configs/all/index.ts` | Import + array entry |
| `packages/providers/env.ts` | Add API key env var to `ProvidersEnv` (if auth needed) |
| `packages/provider-monitors/configs/${DIR_NAME}/vendor.test.ts` | Vendor test file (optional) |

## Canonical examples

- Simple (no auth, standard features): `packages/provider-monitors/configs/nextbit/index.ts` (38 lines)
- With auth: `packages/provider-monitors/configs/modelrun/index.ts` (31 lines)
- With auth + custom response schema: `packages/provider-monitors/configs/aion-labs/index.ts` (40 lines)
- With feature-to-parameter mapping: `packages/provider-monitors/configs/io-net/index.ts` (47 lines)
- Complex (auth + SKU pricing): `packages/provider-monitors/configs/mistral/index.ts` (67 lines)
- With custom pricing normalization: `packages/provider-monitors/configs/ionstream/index.ts` (70 lines)
- With auth + disableAutoHideRemovedEndpoints: `packages/provider-monitors/configs/gmicloud/index.ts` (34 lines)
