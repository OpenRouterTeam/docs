---
name: create-k6-load-test
description: Create a k6 load test scenario, covering scenario structure, shared helpers, custom metrics, thresholds, and running tests.
user-invocable: true
---

# Create k6 Load Test

Follow this checklist when creating a new k6 performance test scenario. All tests live in `tests/performance/scenario/` and use TypeScript.

## Arguments

- `$SCENARIO_NAME`: kebab-case scenario name (e.g., `embeddings-api`, `auth-load`, `websocket-smoke`)
- `$TEST_TYPE`: One of `smoke`, `load`, `stress`, `comparison` (determines VU/duration defaults)

## Prerequisites

- k6 installed locally: `brew install k6`
- Environment variables set (copy `tests/performance/.env.example` to `.env.development.local` at repo root):
  - `OPENROUTER_API_KEY` — your OpenRouter API key
  - `OPENROUTER_API_URL` — target API URL (default: `http://localhost:8787/api/v1` for local, `https://openrouter.ai/api/v1` for production)
  - Additional env vars as needed for the specific scenario

## Steps

### 1. Decide which shared helpers to use

Check `tests/performance/shared.ts` for existing helpers before writing HTTP calls:

| Helper | Purpose | Auth required | URL source |
|--------|---------|--------------|------------|
| `completion(model, prompt)` | Single chat completion | ✅ `OPENROUTER_API_KEY` | `OPENROUTER_API_URL` |
| `completionWithMessages(model, messages, maxTokens?)` | Multi-message chat completion | ✅ `OPENROUTER_API_KEY` | `OPENROUTER_API_URL` |
| `completionSingleProvider({model, provider, prompt})` | Chat completion pinned to one provider | ✅ `OPENROUTER_API_KEY` | `OPENROUTER_API_URL` |
| `models()` | GET `/models` | No | `OPENROUTER_API_URL` |
| `providers()` | GET `/providers` | No | `OPENROUTER_API_URL` |
| `getGeneration(id)` | GET `/generation?id=` | ✅ `OPENROUTER_API_KEY` | `OPENROUTER_API_URL` |
| `homepage()` | GET site homepage | No | `OPENROUTER_SITE_URL` |
| `sandbox()` | POST to sandbox API | ✅ `OPENROUTER_API_KEY` | hardcoded URL |

The completion helpers (`completion`, `completionWithMessages`, `completionSingleProvider`) plus `getGeneration` and `sandbox` all require `OPENROUTER_API_KEY` (they send `Authorization: Bearer …`), so missing that env var will silently produce 401s. `models` and `providers` are auth-free and use `OPENROUTER_API_URL`. `homepage` is also auth-free but uses `OPENROUTER_SITE_URL` (defaulting to `https://openrouter.ai`) and sends `User-Agent: k6-loadtest` instead of `X-OpenRouter-Title`. `sandbox` uses a hardcoded URL (`https://api.openrouter.workers.dev/api/alpha/sandbox`) unaffected by `OPENROUTER_API_URL`.

If the existing helpers don't cover your endpoint, add a new helper to `shared.ts` following the same pattern — or create a `$SCENARIO_NAME-shared.ts` file for scenario-specific helpers (see Step 4).

### 2. Create the scenario file

Create `tests/performance/scenario/$SCENARIO_NAME.ts`.

#### Simple smoke test (constant VUs)

Use for quick validation that an endpoint works under minimal load:

```ts
import { check, sleep } from 'k6';
import { completion } from '../shared.ts';

export const options = {
  vus: 3,
  duration: '15s',
};

export default () => {
  const res = completion(
    'meta-llama/llama-3.2-3b-instruct',
    'Write a couple lines of poetry. Just a few.',
  );
  check(res, {
    'is status 200': (r) => r.status === 200,
  });
  sleep(1);
};
```

#### Constant load test

Use for sustained load testing at fixed concurrency:

```ts
import { check, sleep } from 'k6';
import { completion } from '../shared.ts';

export const options = {
  vus: 25,
  duration: '5m',
};

export default () => {
  const res = completion('meta-llama/llama-3.1-8b-instruct', 'Yes or no?');
  check(res, {
    'is status 200': (r) => r.status === 200,
  });
  sleep(1);
};
```

#### Ramping load test (stages)

Use for testing behavior under increasing/decreasing load:

```ts
import { check, sleep } from 'k6';
import { completion } from '../shared.ts';

export const options = {
  stages: [
    { duration: '1m', target: 10 },   // ramp up
    { duration: '1m', target: 25 },
    { duration: '1m', target: 50 },
    { duration: '5m', target: 100 },   // sustain peak
    { duration: '1m', target: 50 },    // ramp down
    { duration: '1m', target: 0 },
  ],
};

export default () => {
  const res = completion('meta-llama/llama-3.1-8b-instruct', 'Hello');
  check(res, {
    'is status 200': (r) => r.status === 200,
  });
  sleep(1);
};
```

#### Load test with thresholds

Use when you need pass/fail criteria:

```ts
import { check, sleep } from 'k6';
import { completion } from '../shared.ts';

export const options = {
  vus: 10,
  duration: '2m',
  thresholds: {
    checks: ['rate>0.90'],                          // 90%+ checks must pass
    http_req_duration: ['p(95)<5000'],               // p95 latency under 5s
    'http_req_duration{endpoint:analyze}': ['p(95)<500'],  // tagged sub-threshold
  },
};

export default () => {
  const res = completion('meta-llama/llama-3.1-8b-instruct', 'Hello');
  check(res, {
    'is status 200': (r) => r.status === 200,
  });
  sleep(1);
};
```

### 3. Add custom metrics (if needed)

For advanced scenarios, use k6 custom metrics. Import from `k6/metrics`:

```ts
import { Counter, Rate, Trend } from 'k6/metrics';

// Trend — track latency distributions (p50, p95, p99)
const e2eLatency = new Trend('my_scenario_e2e_duration', true);  // true = time values in ms

// Counter — count events
const successfulRequests = new Counter('my_scenario_successful_requests');

// Rate — track percentage (0-1)
const successRate = new Rate('my_scenario_success_rate');
```

Naming convention: prefix custom metrics with a scenario-specific namespace to avoid collisions (e.g., `presidio_e2e_`, `model_armor_`, `embeddings_`).

Record metrics in the default function:

```ts
export default () => {
  const startMs = Date.now();
  const res = completion('meta-llama/llama-3.1-8b-instruct', 'Hello');
  const durationMs = Date.now() - startMs;

  e2eLatency.add(durationMs);
  successRate.add(res.status === 200);

  if (res.status === 200) {
    successfulRequests.add(1);
  }

  check(res, {
    'is status 200': (r) => r.status === 200,
  });
  sleep(1);
};
```

Custom metrics can be used in thresholds:

```ts
export const options = {
  thresholds: {
    my_scenario_e2e_duration: ['p(95)<5000'],
    my_scenario_success_rate: ['rate>0.90'],
  },
};
```

### 4. Create a shared module (if the scenario is complex)

If the scenario needs shared payloads, types, or helpers used across multiple test files, create `tests/performance/scenario/$SCENARIO_NAME-shared.ts`.

Conventions from existing shared modules (`presidio-shared.ts`, `model-armor-shared.ts`):

- Export TypeScript types/interfaces for payloads
- Export payload arrays grouped by category (e.g., `SMALL_PAYLOADS`, `MEDIUM_PAYLOADS`, `LARGE_PAYLOADS`)
- Export a weighted random picker function (e.g., `pickPayload()`) that selects from categories with configurable distribution
- Export shared HTTP helpers (e.g., `sendCompletion()`) that accept explicit `baseUrl` and `apiKey` params for multi-key scenarios
- Export response parsing helpers (e.g., `getResponseContent()`, `isBlockedResponse()`)
- Export a `getMaxVus()` helper if the scenario supports VU override via env var

Example picker pattern (assumes each category array is non-empty — guard at module load if needed):

```ts
// Fail fast if payload arrays are empty
if (!SMALL_PAYLOADS.length || !MEDIUM_PAYLOADS.length || !LARGE_PAYLOADS.length) {
  throw new Error('Payload arrays must not be empty');
}

export function pickPayload(): TestPayload {
  const roll = Math.random();
  if (roll < 0.3) {
    return SMALL_PAYLOADS[Math.floor(Math.random() * SMALL_PAYLOADS.length)] ?? SMALL_PAYLOADS[0]!;
  }
  if (roll < 0.7) {
    return MEDIUM_PAYLOADS[Math.floor(Math.random() * MEDIUM_PAYLOADS.length)] ?? MEDIUM_PAYLOADS[0]!;
  }
  return LARGE_PAYLOADS[Math.floor(Math.random() * LARGE_PAYLOADS.length)] ?? LARGE_PAYLOADS[0]!;
}
```

Example VU override helper:

```ts
export function getMaxVus(defaultVus: number): number {
  const envVal = __ENV.MY_SCENARIO_MAX_VUS;
  if (envVal) {
    const parsed = Number.parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return defaultVus;
}
```

### 5. Add a setup function (if env vars are required)

Validate required environment variables in an exported `setup()` function so the test fails fast with a clear error:

```ts
export function setup(): void {
  if (!__ENV.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }
  if (!__ENV.OPENROUTER_API_URL) {
    throw new Error('OPENROUTER_API_URL environment variable is required');
  }
}
```

### 6. Add a JSDoc comment at the top

Describe what the test does, its prerequisites, and how to run it:

```ts
/**
 * $SCENARIO_NAME load test — <description of what it tests>.
 *
 * Prerequisites:
 *   1. <any setup steps, e.g., create API keys, start services>
 *
 * Usage:
 *   k6 run scenario/$SCENARIO_NAME.ts \
 *     -e OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
 *     -e OPENROUTER_API_URL=$OPENROUTER_API_URL
 */
```

### 7. Run the test

```bash
# From tests/performance/ directory:
source .env.development.local

# Run the scenario:
k6 run scenario/$SCENARIO_NAME.ts \
  -e OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
  -e OPENROUTER_API_URL=$OPENROUTER_API_URL

# Override VUs (if the scenario supports it):
k6 run scenario/$SCENARIO_NAME.ts \
  -e OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
  -e OPENROUTER_API_URL=$OPENROUTER_API_URL \
  -e MY_SCENARIO_MAX_VUS=50
```

### 8. Typecheck

Ensure your TypeScript compiles:

```bash
cd tests/performance && bun run typecheck
```

The package uses `@types/k6` for type definitions. k6-specific globals like `__ENV` and `check` are provided by the k6 runtime and typed by `@types/k6`.

### 9. Document baselines (for comparison tests)

If you wrote a baseline comparison test, create `tests/performance/scenario/$SCENARIO_NAME-baselines.md` documenting:

- How to set up the required API keys
- Observed baseline numbers (p50, p95, p99 latencies)
- When to re-run baselines (e.g., after changing guardrails)
- Threshold rationale

Also update `tests/performance/README.md` with a section describing the new scenario.

## File structure summary

| File | When to create |
|------|----------------|
| `tests/performance/scenario/$SCENARIO_NAME.ts` | Always |
| `tests/performance/scenario/$SCENARIO_NAME-shared.ts` | Complex scenarios with shared types/payloads |
| `tests/performance/scenario/$SCENARIO_NAME-baselines.md` | Comparison tests with documented thresholds |
| `tests/performance/shared.ts` | Add helpers here if they are reusable across scenarios |
| `tests/performance/README.md` | Update with new scenario documentation |

## Canonical examples

- Minimal smoke test: `scenario/smoke.ts`
- Constant load test: `scenario/load-light.ts`
- Ramping load test: `scenario/homepage.ts`
- Provider-pinned load: `scenario/single-provider-loadtest.ts`
- Custom metrics + thresholds: `scenario/guardrails/presidio/presidio-load.ts`
- Shared module pattern: `scenario/guardrails/presidio/presidio-shared.ts`
- E2E comparison test: `scenario/guardrails/presidio/presidio-e2e-baseline.ts`
- Guardrail load test: `scenario/guardrails/presidio/presidio-e2e-guardrail.ts`
- Stress payload generation: `scenario/guardrails/model-armor/model-armor-shared.ts`

## Common patterns

- **Always call `sleep()` at the end** of the default function (typically `sleep(1)` or `sleep(0.5)`) to avoid hammering the server between iterations
- **Always use `check()`** to validate responses — k6 reports check pass rates in output
- **Use `http.post()` tags** (`tags: { endpoint: 'analyze', size: 'small' }`) to get per-tag metrics in k6 output
- **Use `.ts` extension in imports** — k6 requires explicit extensions (e.g., `import { completion } from '../shared.ts'`)
- **Parse response bodies carefully** — `r.body` is `string | null`, always `String(r.body)` before parsing and handle parse errors
- **Use `??` with array indexing** — always provide a fallback when indexing arrays (e.g., `arr[idx] ?? arr[0]!`). The `!` assertion is only safe when the array is guaranteed non-empty — add a guard or assertion at module load if the array could be empty
