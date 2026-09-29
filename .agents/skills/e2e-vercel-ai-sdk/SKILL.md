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

Authenticate once per shell with the helper from [infisical-agent-auth](../infisical-agent-auth/SKILL.md), then run individual test files with production overrides; `infisical_run` injects the `/tests/e2e` folder into the test process only:
```bash
source scripts/infisical/agent-auth.sh && infisical_auth
cd tests/e2e
infisical_run /tests/e2e env TEST_ENV=production OPENROUTER_API_BASE=https://openrouter.ai OPENROUTER_API_KEY="$DEVIN_OPENROUTER_API_KEY" \
  bun run test:e2e run api/frameworks/vercel-ai-sdk/<test-dir>/index.test.ts
```

The overrides sit inside the wrapped command (`env VAR=… bun run …`) so they win over any same-named value in `/tests/e2e`. They do not win over `tests/e2e/.env.local`: `tests/e2e/vitest.setup.ts` loads that file with `override: true` after the process starts, so a stale `OPENROUTER_API_BASE`, `OPENROUTER_API_KEY`, or `TEST_ENV` there silently retargets the run. Check that file (or move it aside) before a production run. `TEST_ENV=production` is required: without it `tests/e2e/utils/check-prerequisites.ts` treats the run as local and fails when no local Postgres is up.

### Against Local Stack

Start the stack using [local-dev-env](../local-dev-env/SKILL.md), then run from the test workspace:
```bash
source scripts/infisical/agent-auth.sh && infisical_auth
cd tests/e2e
infisical_run /tests/e2e bun run test:e2e run api/frameworks/vercel-ai-sdk/<test-dir>/index.test.ts
```

- `bun run test:e2e` is bare `vitest`; it doesn't call Infisical itself, so wrap it in `infisical_run /tests/e2e` to inject that folder.
- `OPENROUTER_API_BASE` defaults to `http://localhost:8787`; use the API origin reported by Tilt if the port differs.
- `tests/e2e/.env.local` overrides shell values, including the `env VAR=…` overrides above. Check it before switching between local and production targets.

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
- Use `parseSchema()` from `@openrouter-monorepo/lib-zod` and `assertOk()` from `@openrouter-monorepo/lib-result` for Zod validation (not `.safeParse()`)
- Use `ToolCallPart.input` (not `.args`) — AI SDK v5 naming
- Import `ToolCallPart` type from `'ai'` package
