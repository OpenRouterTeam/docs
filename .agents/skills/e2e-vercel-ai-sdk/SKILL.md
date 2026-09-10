---
name: e2e-vercel-ai-sdk
description: >-
  How to run the Vercel AI SDK E2E tests in
  tests/e2e/api/frameworks/vercel-ai-sdk/
user-invocable: true
---

# E2E Testing: Vercel AI SDK Tests

How to run the Vercel AI SDK E2E tests in `tests/e2e/api/frameworks/vercel-ai-sdk/`.

## Devin Secrets Needed

- `INFISICAL_CLIENT` — Infisical universal auth client ID
- `INFISICAL_SECRET` — Infisical universal auth client secret
- `DEVIN_OPENROUTER_API_KEY` — Production OpenRouter API key; inference tests consume credits.

## Running Tests

### Against Production (no local stack)

Login to infisical first:
```bash
export INFISICAL_TOKEN=$(infisical login --method=universal-auth --client-id=$INFISICAL_CLIENT --client-secret=$INFISICAL_SECRET --silent --plain)
```

Then run individual test files with production overrides:
```bash
cd tests/e2e
OPENROUTER_API_BASE=https://openrouter.ai OPENROUTER_API_KEY=$DEVIN_OPENROUTER_API_KEY \
  bun run test:e2e run api/frameworks/vercel-ai-sdk/<test-dir>/index.test.ts
```

### Against Local Stack

Start the stack using [local-dev-env](../local-dev-env/SKILL.md), then run from the test workspace:
```bash
cd tests/e2e
bun run test:e2e run api/frameworks/vercel-ai-sdk/<test-dir>/index.test.ts
```

- The test script injects the `/tests/e2e` Infisical scope and loads the workspace's Vitest configuration.
- `OPENROUTER_API_BASE` defaults to `http://localhost:8787`; use the API origin reported by Tilt if the port differs.
- `tests/e2e/.env.local` overrides shell values. Check it before switching between local and production targets.

## Important Notes

### Infisical `--recursive` flag may fail
Using `--recursive` with `--path="/"` can fail with 403 errors due to cross-environment secret references (e.g., secrets in `dev` referencing `prod` secrets). Use specific paths like `--path="/tests/e2e"` instead.

### LLM Non-Determinism
These tests hit real LLM APIs. Models may not always invoke tools — they might respond with text instead. This is especially common with reasoning models like O4 Mini. Claude models tend to be more reliable for tool-calling tests.

If a test fails with `expected 0 to be greater than 0` on `toolCalls.length`, it likely means the model didn't invoke the tool rather than a code bug.

### Test Conventions
- Tests use `getE2EAPIKey('custom')` which reads `OPENROUTER_API_KEY` env var
- `getAPIBase()` reads `OPENROUTER_API_BASE` env var
- Test output is written to `.logs/` directories via `writeJsonToFile` — check these for debugging
- Use `parseSchema()` + `assertOk()` from `@openrouter-monorepo/type-utils` for Zod validation (not `.safeParse()`)
- Use `ToolCallPart.input` (not `.args`) — AI SDK v5 naming
- Import `ToolCallPart` type from `'ai'` package
