---
name: e2e-testing
description: >-
  Run and create end-to-end tests after creating a PR AND after
  every subsequent code push that changes behavior. For API
  changes, run the e2e test suite and inspect dev-fs-logs. For
  frontend changes, record a video, review it for bugs, fix any
  issues found, and re-record until the video shows everything
  working. Never report completion if testing showed failures.
  Create new tests when a bug is fixed or a new feature is
  added — use manual tests for expensive or documentation-only
  tests, and e2e tests for CI-run tests.
user-invocable: true
---

# E2E Testing After PR Creation

After creating a PR — and after **every subsequent code push**
that changes behavior — run the relevant e2e tests and create
new tests for the changes. Determine which category applies by
reading the diff.

> **CRITICAL RULES — read these first:**
>
> 1. **Test after every push, not just PR creation.** If you
>    push a fix, a refactor, or any behavioral change, re-run
>    the relevant tests before reporting back to the user.
> 2. **Never skip testing silently.** If you cannot test (env
>    issues, missing credentials, build failures), tell the user
>    immediately and ask for help. Do NOT report "PR is ready"
>    when testing was skipped or failed.
> 3. **React to what recordings show.** If a video recording
>    reveals bugs (errors, broken UI, stuck states), you MUST
>    fix those issues and re-record. Never send a video that
>    shows failures as your final deliverable.
> 4. **Do not code blindly.** If you have pushed 2+ fixes for
>    the same issue without testing in between, STOP. Spin up
>    the local environment and test before pushing more code.

## When to E2E Test

**Always** run e2e tests when your changes affect:

- Server tools (fusion, web search, datetime)
- API request/response schemas or routing
- Provider adapters or model handling
- Frontend features that call the API
- Plugin behavior

## Determine Change Scope

Read the PR diff and classify the changes:

- **API changes**: touches `packages/router/`, `services/cfw-api/`,
  `packages/providers/`, `packages/db/`, adapter code, skins,
  or API route handlers.
- **Frontend changes**: touches `projects/web/`,
  `projects/mission-control/`, or any UI component / page / style.
- **Both**: run both workflows below.
- **Neither** (e.g. docs-only, CI config, scripts): skip testing
  and note that no e2e tests were needed.

---

## Creating New Tests (MANDATORY)

**Always create tests for any code change that lacks coverage.**
When fixing a bug, adding a feature, or modifying behavior,
check whether a test already exists. If not, you MUST create one.
Choose the right location based on cost and CI suitability.

**Default to `tests/e2e/`** — only use `tests/manual/` when
tests are genuinely expensive, flaky, or investigative. If a
reference implementation exists in `tests/e2e/` for a similar
feature (e.g. `chat-completions/caching/`), create the
analogous test in `tests/e2e/` — do NOT fall back to cURL
snippets, Postman collections, or `tests/manual/` for tests
that are cheap and deterministic.

### Manual tests (`tests/manual/`)

Use for tests that are expensive to run (real API calls with
large payloads), flaky due to provider variability, or serve
primarily as documentation of what went wrong. These are **not**
run in CI.

**When to use:**
- Reproducing and documenting a specific bug
- Tests requiring expensive or long-running API calls
- Tests that depend on specific provider behavior that may change
- Tests that serve as investigative artifacts

**Directory convention:**
```text
tests/manual/bugs/MM-DD-YYYY-short-description/
├── index.test.ts
├── snapshot.json      # The failing request payload
└── fixtures.ts        # Optional: helper factories
```

**Pattern:**
```typescript
import { writeJsonToFile }
  from '@openrouter-monorepo/script-utils/write-to-file';
import { assertOk }
  from '@openrouter-monorepo/lib-result';
import { expect, it, vi } from 'vitest';
import { callChatCompletion } from '@/api/completions/shared';
import snapshot from './snapshot.json';

vi.setConfig({ testTimeout: 60_000 });

it('e2e bug', async () => {
  // @ts-expect-error - raw snapshot
  const result = await callChatCompletion(snapshot);

  await writeJsonToFile({
    fileName: `${Date.now()}`,
    jsonData: result,
    baseUrl: import.meta.url,
  });

  assertOk(result);
  expect(result.data.completion).toBeDefined();
});
```

**Running:**
```bash
cd tests/manual && bunx vitest run bugs/MM-DD-YYYY-your-description
```

`tests/manual` has no direct `zod` dependency; import `z` and `parseSchema`
from `@openrouter-monorepo/lib-zod`, and import only subpaths that a
workspace package exports (unexported paths fail to resolve there).

**Existing manual test locations:**
- `tests/manual/api/completions/` — chat completions
- `tests/manual/api/responses/` — responses API
- `tests/manual/router/plugins/` — plugin tests
- `tests/manual/launches/` — model launch validation
- `tests/manual/bugs/` — bug reproduction tests

### E2E tests (`tests/e2e/`)

Use for tests that should run in CI on every PR. These validate
core API behavior and prevent regressions automatically.

**When to use:**
- Verifying a new API feature works end-to-end
- Regression tests for fixed bugs that are cheap to run
- Contract tests for response structure validation
- Tests that use the shared model groups and test infrastructure

**Directory convention** — organize by API surface area:
```text
tests/e2e/api/
├── chat-completions/    # /api/v1/chat/completions
│   ├── basic/
│   ├── reasoning/
│   ├── multimodal/
│   ├── tool-calling/
│   └── ...
├── responses/           # /api/v1/responses
├── messages/            # /api/v1/messages (Anthropic skin)
├── embeddings/
├── batches/             # Batch API (submit/poll/finalize/results)
└── ...
```

**Pattern:**
```typescript
import { assertOk }
  from '@openrouter-monorepo/lib-result';
import { describe, expect, it } from 'vitest';
import { TestModelGroups } from '@/config/test-models';
import { RequestBuilder } from '@/fixtures';
import { callApi } from '@/utils/call-api';
import { assertSuccessfulCompletion }
  from '@/api/shared/assertions';

describe('Feature Name', () => {
  describe.each(TestModelGroups.fast)('Model: %s', (model) => {
    it('does the expected thing', async () => {
      const result = await callApi(
        '/api/v1/chat/completions',
        { body: RequestBuilder.simple(model) },
      );

      assertOk(result);
      assertSuccessfulCompletion(result.data.data);
    });
  });
});
```

**Key utilities:**
- `callApi` — wrapper with Result monad for type-safe error
  handling (`tests/e2e/utils/call-api.ts`)
- `RequestBuilder` — factories for common request shapes
  (`tests/e2e/fixtures/request-factory.ts`)
- `TestModelGroups` — predefined model lists by capability
  (`tests/e2e/config/test-models.ts`)
- `assertSuccessfulCompletion`, `assertStreamComplete` — shared
  assertion helpers (`tests/e2e/api/shared/assertions.ts`)
- `parseStream`, `assembleStreamedMessage` — streaming helpers
  (`tests/e2e/api/shared/stream-parser.ts`)
- `parseChatCompletionResponse` — Zod schema validation
  (`tests/e2e/api/shared/schemas.ts`)
- `extractAnnotations` — check web search annotations
- `measuredFetch` — when you need raw response access
- `filterTestRequests` + `TestSuite` — fixtures pattern
  for multi-model test matrices

**Running:**
```bash
cd tests/e2e && bun run test:e2e run <path-to-test>
```

### Guidelines for writing tests

- Keep tests readable and maintainable — no nested branching
- Use Zod schema parsers for response validation
- Use `sendToFsLog` / `writeJsonToFile` for introspection
- Use `assertOk` / `assertErr` from the Result monad — do not
  use try/catch
- Log output to dev-fs-logs for debugging
- Use `Model` enum from `@openrouter-monorepo/models/id`
  for type-safe model references
- Always use `writeJsonToFile` to persist responses — they
  go to `.logs/` and are gitignored
- Set timeouts from the test's expected duration; investigate stalls before increasing them
- Check `isDefinedAndNotNull` when filtering
  `extractAnnotations` results

---

## Running API E2E Tests

### Setup

Start and wait for the stack using [local-dev-env](../local-dev-env/SKILL.md). Enable the worker under test and `dev-fs-logs`; enable usage pipelines when checking persisted billing.

The harness defaults to `TEST_ENV=local`, API origin `http://127.0.0.1:8787`, and the seeded `sk-or-v1-unlimitedkey`. Set `OPENROUTER_API_BASE` to the actual `api` origin from Tilt when ports differ. It takes an origin without `/api/v1`. Other workers have separate overrides in `tests/e2e/utils/config.ts`, including `OPENROUTER_PUBLIC_API_BASE` and `OPENROUTER_WEBHOOKS_BASE`.

`tests/e2e/.env.local`, when present, overrides shell values. Check its target and key settings before switching between local and deployed tests. Provider credentials belong in the worker's Infisical scope; the local caller key is not a provider credential.

### Deterministic upstream via local fake-provider

`fake-provider` starts automatically with the stack in both profiles. Wait for it, then run the existing routing helper from the repository root:

```bash
tilt wait --for=condition=Ready uiresource/fake-provider --timeout=300s
bun run x scripts/use-local-fake-provider.ts
```

It changes FakeProvider's base URL, unhides its seeded `openai/gpt-4.1-2025-04-14` endpoint, grants private endpoint access to local API-key owners, warms KV, and requests an API restart. Pass the actual `FAKE_PROVIDER_PORT` and `CFW_API_PORT` if overridden. Check the helper's warnings and confirm the new worker run before testing.

Request `"model": "openai/gpt-4.1-2025-04-14"` with `"provider": {"order": ["fake-provider"], "allow_fallbacks": false}`. The provider restriction keeps the test on the fake upstream. See [Fake Provider](../../../services/fake-provider/README.md) for response controls.

Router logs appear in `tilt logs api`; upstream logs appear in `tilt logs fake-provider`. cfw-api prefers upstream SSE even for a non-streaming caller, so test the relevant upstream transport when changing the fake response generator.

### Capturing the upstream request body with a local sink

To verify what the router *sends* to a real provider (request-only adapter
changes, e.g. server-side tool shapes) without a paid call, repoint that
provider's `base_url` at a tiny local sink that records the body and
returns 503, then pin routing with `provider: { only: ["<slug>"] }`. The
`UPDATE` alone is not enough: routing reads the URL from warmed KV and
cfw-api caches the warmed config per isolate. After the `UPDATE`, re-warm
KV, restart `api`, and confirm the first request lands in the sink before
running scenarios; repeat the same sequence when restoring `base_url`
(reference: `warmKV` then `restartCfwApi` in
`scripts/use-local-fake-provider.ts`). The client sees
`Provider returned error`, which is expected: the evidence is the captured
body (cross-check `adapters/base-fetch-request` in `dev-fs-logs`).
Endpoint feature flags such as `supports_native_web_search` come from the
seed, so no extra setup. If `psql` is not installed on the box, run it
inside the Postgres container.

Gotchas when synthesizing upstream logprobs or changing endpoint capabilities:

- Synthetic logprob items MUST include `bytes: null` on every token and
  top_logprob entry — `normalizeLogprobs` in
  `packages/router/adapters/base/make-output/normalize-logprobs.ts` Zod-guards
  with a required (nullable) `bytes` field and silently drops the whole
  logprobs object if it's missing, making it look like a router bug.
- After changing endpoint capabilities or pricing, use local-dev-env's cache-refresh steps.
- Restart `fake-provider` after changing its response generator and verify a direct request before testing through the router.
- HIPAA tests need the `api-hipaa` resource and its `hipaa-dev` Infisical scope. Use the seeded HIPAA fixtures and the [HIPAA Mirror Suite](../../../tests/e2e/README.md#hipaa-mirror-suite); a missing mirror or credential is not a routing result.
- To force the supersize/DO-hydration path on a chat request, send
  `x-offload-large-fields: 1`; a large multimodal body alone does not
  route through the Durable Object. Confirm with a `process-stream-json:*`
  log line in the run's `dev-fs-logs` artifact.
- To simulate caller geography (`geoData.country` / `colo`), edit wrangler's
  fixture at `services/cfw-api/node_modules/.mf/cf.json` and restart
  `cfw-api` — it is read at worker start, not per request. Do not use `CN`
  or `HK` to test adapter-level behavior on a closed OpenAI/Anthropic/Google
  model: the routing geo gate
  (`packages/routing/filters/gate-endpoints-with-geo-restrictions.ts`)
  returns `403 This model is not available in your region.` before any
  adapter runs. Pick a country the gate does not cover, and restore the
  fixture afterwards.
- Restoring source files with git after a temporary bypass does not
  trigger a wrangler rebuild. Touch `services/cfw-api/src/index.ts` and
  wait for the reload before capturing a "before" or control run, or the
  worker still serves the patched code.
- To read a persisted generation field (e.g. `experiments`, Fortuna
  columns) from local ClickHouse, run `cfw-api` with
  `PUBSUB_EMULATOR_HOST=localhost:8086` and start the
  `insert-generations-clickhouse` worker against the same emulator. A
  complete dev-fs-logs artifact does not imply the row landed. Query
  `http://localhost:8123` as `default:clickhouse`; `generations` is keyed
  by `generation_id` and `experiments` is a JSON string.

### Faking an OpenAI Responses-adapter upstream (provider error / refusal paths)

`services/fake-provider` only speaks Chat Completions, so it cannot drive
the `InternalStreamOpenAIResponsesAdapter` (preflight non-2xx JSON,
`response.failed`, top-level `error` SSE events). When you need those:

- Write a throwaway Bun server outside the repo (e.g. `/tmp/mock-upstream`)
  that serves `POST /v1/responses` with OpenAI-Responses-shaped JSON/SSE,
  select the scenario from a marker in the prompt text, and log
  `hit=<n> model=<m> scenario=<s>` per call. Return `id: resp_mock_<n>` so
  each cfw-api `Transaction attempt` (`native_generation_id`) correlates to
  a mock hit. Do not edit seed files or `services/fake-provider`.
- Repoint the real provider row: `update providers set
  base_url='http://localhost:3010/v1' where permaslug='openai';`
  (`providers` has `permaslug`, not `slug`/`name`; `endpoints` has
  `model_permaslug`, no `base_url`). Warm with
  `curl 'http://localhost:8794/__scheduled?cron=*/5+*+*+*+*'` — the cron
  string must be exactly `*/5 * * * *` or `dispatchCronTrigger` logs
  `Unknown cron event` and warms nothing.
- For Chat Completions mocks, accept `/chat/completions` when the temporary
  base URL omits `/v1`, as well as the usual `/v1/chat/completions` path.
- Pick a model that has several endpoints for the same model (e.g. OpenAI +
  Azure) so "skips remaining endpoints of the same model" is observable:
  compare `attempted_endpoints` vs `potential_endpoints` in the
  `Transaction attempt` log / `router/transaction-attempt.log`.
- Use two models of the same provider for `models=[A,B]` fallback and make
  the mock refuse only on A (marker suffix like `@nano`).
- Most OpenAI models stream upstream even for non-stream client requests, so
  the adapter's true non-stream JSON path (`isUpstreamSSE === false`) is only
  exercised by a model such as `openai/o1-pro`. Cover a failed full Response
  body with both a usage object and `usage: null` there.
- Preflight (non-2xx) errors return no generation id in the body; correlate
  them with `dev-fs-logs/.logs/` by timestamp.
- Fault attribution: read `is_error_upstream_fault` from the
  `Transaction attempt` block, not from the `Endpoint returned error` iLog —
  the latter hard-codes `is_error_upstream_fault: true` for every failed
  attempt (`packages/router/index.ts`) and is not the health signal.
- Restoring `providers.base_url` afterwards does not take effect quickly:
  `getKVProviders` reads `KV_ALL_PROVIDERS` with a 300 s edge `cacheTtl`
  and the in-process ListCaches keep the old `provider_info.baseUrl`. After
  the UPDATE + re-warm, restart `bun run dev cfw-api` and confirm
  `fetch_url` in the newest `router/transaction-attempt.log` points at the
  real provider (with no new mock hit) before declaring cleanup done.
  Order matters in both directions (repoint and restore): UPDATE → warm →
  restart → probe. Restarting before the warm, or a cfw-api started before
  the UPDATE, keeps the old URL in the in-process provider cache
  (`cfGlobalProvidersCache` in `services/cfw-api/src/kv/index.ts`, a 30 min
  `FetchDeduper`): verify the KV blob holds the new URL before restarting.
- The local seed makes the providers loader log
  `Error loading providers from DB { errors: ['Invalid provider: Hyperbolic'] }`
  on every warm; it is pre-existing noise, not caused by your repoint.
- To assert provider-specific field forwarding or stripping (e.g. a new
  tool flag) against the real upstream, read the outbound body in
  `services/dev-fs-logs/.logs/gen-<id>/adapters/base-fetch-request.log`
  for each attempt. A live `400 unsupported_value` from the provider still
  proves the field reached it; only a locally-enabled model that accepts the
  feature can prove the 2xx round trip.
- Testing a *preflight* (non-2xx) error class — status mapping, error type,
  `permission_denied` vs a typed refusal — requires
  `provider.allow_fallbacks: false` (or a single-endpoint model). Otherwise
  the router retries the same model's other endpoint (e.g. Azure), and that
  endpoint's own failure (a 401 with no local key) becomes the client-visible
  status, masking the assertion. Mid-stream (post-2xx) failures don't need
  this, but the same-model endpoint skip is worth asserting via
  `attempted_endpoint_count`.
- Post-2xx failures on the Responses skin return HTTP 200 with
  `status: "failed"` plus `error` / `error_type` in the body; the mapped HTTP
  status (403 for a refusal, 502 for `server_error`) only shows up as `status`
  in the `Transaction attempt` log and on preflight errors. Assert both places.
- Whether an attempt "accrued usage" (the hard-stop trigger, see
  `didAttemptProduceOutput`) is visible as `native_tokens_completion` /
  `native_tokens_reasoning` on the generation row. A usage block on a failed
  event may be seen by the adapter (`adapters/base-stream-event.log`) and
  still not land on the transaction — compare those two files before
  concluding a hard stop should/shouldn't have fired. Mock Responses usage
  with `output_tokens >= reasoning_tokens` (reasoning tokens are a subset of
  output tokens); `output_tokens: 0` takes accounting's no-tokens short
  circuit and the row never gets reasoning tokens.
- The `infisical` CLI login session expires between runs: `bun run dev …`
  then drops into an interactive login prompt and exits with
  `error: script "dev" exited with code 1`. Re-mint with
  `infisical login --method=universal-auth --client-id=$INFISICAL_CLIENT
  --client-secret=$INFISICAL_SECRET --plain --silent` and export it as
  `INFISICAL_TOKEN`. A machine-identity token has no default project, so
  `infisical run --env=dev --path=/tests/e2e -- …` (what the `tests/web-e2e`
  `e2e` and `test:vr:dashboard` scripts wrap) fails with
  `Project ID is required when using machine identity`: pass
  `--projectId <workspaceId from .infisical.json>` and call
  `bunx playwright test …` through it directly. Start the stack detached with stdin closed
  (`setsid nohup bun run dev … < /dev/null > log 2>&1 &`) — with an inherited
  stdin it dies on EOF (`error: ^D`).
- Outside Tilt, run every worker you need in one `bun run dev cfw-api
  cfw-internal dev-fs-logs fake-provider` with `WRANGLER_INSPECTOR_PORT=0`
  exported (the Tiltfile sets it; a second `bun run dev` invocation fails
  with `Address already in use (127.0.0.1:9229)`). A fresh KV has no router
  config, so `cfw-api` answers every inference request with
  `503 Router config unavailable: could not be read from KV` until the
  `cfw-internal` `__scheduled` warm above has run.

### Testing billing routes on local cfw-frontend-api (stripe-credit-purchase)

`POST /api/frontend/v1/private/stripe-credit-purchase` needs more than a
signed-in dev Clerk session before the handler's guards even run:

- A freshly minted Clerk user 403s with `no_active_workspace`; use the
  seeded `dev+clerk_test@openrouter.ai` user instead.
- The user's `users.stripe_customer_id` must point at a test-mode Stripe
  customer that has a **name and a US billing address**, or the route
  returns `Customer not found` (500), `Customer name is required` (400),
  or `Billing address is invalid` (400) before the purchase logic.
- The handler calls the `usage-record` service binding. Confirm that Tilt resource is running; inspect its startup logs and required environment if billing calls fail.

A successful call returns `200 {"data":{"clientSecret":"pi_..."}}` and logs
`Credit purchase initiated` and `Top Up: triggered` in the worker stdout.

### Testing workspace-scoped policy (e.g. `disabled_server_tools`)

Read the workspace off the key you are sending
(`select workspace_id from api_keys where label = '<key>'`) — the seeded key
sets it explicitly, so deriving one from an entity id updates a row no
request reads and everything returns 200 as if the policy were broken.

Include one request an already-enforced branch of the same policy blocks as
a sanity gate: if that one isn't blocked, the row isn't in play and the path
under test proved nothing. Restore the column when done.

### Testing inbound webhook handlers (cfw-webhooks)

Shared handlers in `packages/webhook-handlers` are reachable locally through
the `webhooks` Tilt resource on `:8807` (see `tests/e2e/webhooks/`):

- The routes are `/api/webhooks/<provider>`, not `/webhooks/<provider>`
  (the latter 404s).
- `GET /healthz` returns 500 `env invalid` until every secret in
  `services/cfw-webhooks/src/env.ts` is set; a missing
  `SEQUENCE_WEBHOOK_SECRET` blocks the Clerk route too. Add a placeholder to
  `.env.development.local` (gitignored) and `tilt trigger webhooks`.
- Sign requests with `svix` using the `CLERK_WEBHOOK_SECRET` the dev script
  wrote to `services/cfw-webhooks/.dev.vars`; a hand-written `whsec_...`
  literal in a test trips the pre-commit secret scan, so build any deliberately
  wrong secret at runtime.
- No inference runs, so `dev-fs-logs` stays empty. Evidence is the test's
  `.logs/*.ignore.json` response captures plus `tilt logs webhooks` for the
  handler's structured log lines.
- The Vitest setup gate checks the configured cfw-api origin even for webhook-only runs. `SKIP_CFW_API_CHECK=1` skips that API check; local Postgres is still required.
- `tests/e2e/webhooks/route-contract.test.ts` pins the Stripe, Coinbase
  Business and Sequence HTTP contract (invalid signature status, empty error
  bodies, `405` + `Allow: POST` on non-POST). The signed cases read
  `STRIPE_WEBHOOK_SECRET`, `COINBASE_BUSINESS_WEBHOOK_SECRET` and
  `SEQUENCE_WEBHOOK_SECRET` from the test process env and skip when unset, so
  export the same values the worker's `.dev.vars` holds to run them.

### Support Agent API routes (cfw-support)

The `support` Tilt resource is manual and needs Infisical. Without Tilt,
start the worker on its own from `services/cfw-support` with
`OR_ENV=development CFW_SUPPORT_PORT=8817 WRANGLER_INSPECTOR_PORT=9317 bun run dev`
after exporting `INFISICAL_TOKEN` (machine identity:
`infisical login --method=universal-auth --client-id=... --client-secret=... --plain --silent`).
`bun run dev` sets `SUPPORT_DEV_AUTH_BYPASS=true`, so requests need no
Cloudflare Access headers, and anything gated on that flag (the
ownership-check budget, for one) is skipped, so 429 paths are unit-test
evidence only. Hyperdrive reads the local Postgres on `:54322`. No inference
runs, so `dev-fs-logs` stays empty; the evidence is the worker log's
`support_api_request_complete` line plus the handler's `iLog` line. When the
worker cannot reach ClickHouse, ClickHouse-backed reads report
`source_unavailable`, so cover that path with unit tests.

### Batch API Tests

Follow [batch-api-testing](../batch-api-testing/SKILL.md#driving-the-live-local-stack) for the exact resources, rate-limiter check, and Pub/Sub subscription readiness. `cfw-batch-api` depends on `gcp-batch-api`, fake GCS, and the fake upstream; confirm all of them are Ready.

```bash
cd tests/e2e && bun run test:e2e run api/batches
```

Some batch suites skip when dependencies are unavailable. Check that the intended cases executed.

Run batch files one at a time. Parallel files steal each other's finalize Pub/Sub messages. `api/batches/finalize-takeover.test.ts` covers the Cloud Run finalize takeover (first worker dies mid-finalize, sweep reclaims with a new generation, second worker bills exactly once). It needs `BATCH_SWEEP_FRESHNESS_SECONDS=10` on `gcp-batch-api` (set in the Tiltfile) and the `dev-all` role for the `x-batch-finalize-failpoint` header. Details in [batch-api-testing](../batch-api-testing/SKILL.md#e2e-finalize-takeover-eco-4064).

### Run Tests

1. Identify which test files cover the changed functionality by
   searching `tests/e2e/api/` for related test names.
2. Run the relevant subset:
   ```bash
   cd tests/e2e && bun run test:e2e run <path-to-relevant-test>
   ```
   If the change is broad (e.g. a core adapter refactor), run
   the full suite: `cd tests/e2e && bun run test:e2e run`
3. After tests complete, check dev-fs-logs for the most recent
   generation:
   ```bash
   ls services/dev-fs-logs/.logs/
   ```
   Collect sample log files to verify request/response behavior.
   dev-fs-logs writes one `gen-<id>/` directory per inference
   generation only. A change on a non-inference route (auth
   middleware, `/api/v1/credits`, key management) leaves `.logs/`
   empty; use the worker request log from `tilt logs api`
   as the evidence instead and say so in the PR (PR #39640).

### Report

- Share pass/fail results with the user.
- Attach sample dev-fs-logs output for relevant generations.
- If tests fail, investigate and fix before reporting completion.

### Verifying billing against production rates

A pricing change only takes effect when *both* the code deploy and the
endpoint's new pricing version are live, and pricing versions are applied
separately (often by Buddy, minutes after the merge). Confirm the deploy job
for the serving worker succeeded and the pricing version's effective time
precedes your first request — otherwise a "no change" result proves nothing.

Local runs read local seed pricing, so they cannot verify a prod rate. Drive
production with a real key (`OPENROUTER_SAMPLE_GEN_API_KEY` under
`/services/cfw-image-api` in Infisical) and reconcile from the response:
`usage.cost_details` splits input and output cost, which is enough to solve for
the billed subset when the API only reports aggregate token counts. The
`x-generation-id` response header (not `x-openrouter-generation-id`) is what
`/api/v1/generation?id=` takes; the per-SKU breakdown is not exposed there.

Solving a split from cost is inference, not observation. Confirm it once
against the provider by replaying the same payload directly against the
vendor API and reading its usage details.

---

## Frontend E2E Testing

### Setup

Start the app and sign in using [local-dev-env](../local-dev-env/SKILL.md). Use the actual web origin from Tilt. For auth or onboarding tests that need a new identity, use the optional [isolated-user workflow](../local-dev-env/references/isolated_users.md).

For production-bundle verification, serve the build with
`bun run --cwd projects/web start`, not `next dev`. Copy a prebuilt artifact
into the web project's Next output directory rather than symlinking one from
outside the monorepo,
and record its BUILD_ID. If Clerk stays `loaded=false` and chat or sign-in
renders a skeleton, reproduce the same route on a baseline build with the same
origin and environment before attributing it to the change. That establishes a
pre-existing blocker, not coverage of the hidden controls; never substitute
fake auth.

For `force-static` ISR pages that fetch their own origin during build, check
whether the origin was listening at build time. A failed build-time fetch
bakes fail-open HTML into the prerender. After the route's `revalidate`
window passes, request it to trigger regeneration, then reload after that
regeneration completes. Reproduce on the merge-base build before attributing
the state to the PR. Pass only once real rows render.

For public-route-only checks, `TILT_PROFILE=lean tilt up --stream -- --lite`
(see `Tiltfile`) runs local web with production public frontend-API reads.
Wait for `uiresource/web`; no local database or login is needed for those
reads. Do not mistake visible fallback cards for successful backend coverage:
the home page's `app/[locale]/(home)/actions.ts` uses a private featured-models
route that lite mode may not serve. Report that fetch separately from the
visible navbar/hero/cards, and use the full frontend-API stack to verify it.

### Browser Tool Selection

Before asserting a hover-only visual defect (for example, the shared
`packages/frontend/components/CardCarousel` edge gradients), inspect
`matchMedia('(hover:hover)').matches` and `matchMedia('(pointer:fine)').matches`.
`:hover` can match while Tailwind's hover media query is disabled. Mobile
viewport emulation may reset these capabilities even after restoring desktop
dimensions; recheck before desktop hover tests, or run phone-width checks last.
Allow enter/exit transitions to settle before asserting opacity or clicking
through a closing dialog; an immediate screenshot can capture the fade itself.

Use whatever browser tool is available in your environment:

- **Playwright MCP** (Claude Code) — use `browser_navigate`,
  `browser_snapshot`, `browser_click`, `browser_type`, etc.
- **Built-in browser** (Devin) — use Devin's browser tool
- **Browser preview** (Cursor) — use the built-in preview

Do not assume a specific browser tool is connected.
Check what tools are available before proceeding.

For deployed-site Playwright tests (`tests/web-e2e/`), credentials are injected from Infisical at `/tests/e2e`:

```bash
bun run --filter @openrouter-monorepo/test-web-e2e e2e
```

This command defaults to `https://openrouter.ai`; it does not target the local stack. `E2E_CLERK_USER` and `E2E_CLERK_PASSWORD` belong to the deployed Clerk tenant.

If a PR preview is protected by organization SSO, record that as a preview-access blocker rather than treating the SSO page as application coverage. Public production routes can provide supplementary resolved-page evidence, but must be labeled separately from PR verification.

For local route smoke tests, use the runner that builds the production app, mints a development ticket, and provisions local fixtures:

```bash
cd tests/web-e2e && bun run e2e:local
```

It requires the local stack and an authenticated Infisical session. `BASE_URL` defaults to `http://localhost:3000`; set it to the local web origin when ports differ. The runner temporarily disables Tilt's web dev server while it builds and serves the app. Set `LOCAL_ROUTE_SMOKE_NEXT_PORT` to a free port if the default (web port + 1) is occupied.

`LOCAL_ROUTE_SMOKE_RUNS=3` repeats for flakiness. `LOCAL_ROUTE_SMOKE_WORKERS` defaults to 4. `LOCAL_ROUTE_SMOKE_BUILD=never` reuses an existing build, so use it only when that is the build under test. See `tests/web-e2e/scripts/run-local-route-smoke.ts` for options and result checks.

Gotchas the runner already handles, worth knowing when you script around it:
- The `/projects/web` Infisical path injects `NODE_ENV=development`; set
  `NODE_ENV=production` inside the `infisical run -- ...` command, not in
  the parent shell, or `next build` prerenders with development React.
- Clerk session tokens live 60s. A fresh Playwright context per test
  replays the Clerk handshake redirect on every navigation, which is slow
  and occasionally lands on `/sign-in`; navigation-only suites should
  share one signed-in context per worker (see
  `suites/smoke/all-routes-navigation.test.ts`).

### Sign In Flow (local manual browser testing)

1. Sign in with a [Clerk sign-in ticket](../clerk-dev-signin-token/SKILL.md), as described in local-dev-env.
1. Confirm the session is active.
1. Select **Personal** for personal-account tests, or the organization required by the test.

**Verify which context is actually active before asserting auth
behavior** — a restored session can come back with an org active,
which changes both the auth branch taken and the entity that owns
any written rows:

```js
window.Clerk.organization?.id; // null => personal context
```

Cross-check in Postgres with `select clerk_user_id, is_organization
from users where clerk_user_id = '<org_ or user_ id>'`. Org-owned
rows are keyed by the `org_…` id (e.g. `credits.clerk_user_id`), so a
write that appears to have done nothing to the personal account may
have correctly landed on the org.

To cover both paths in one session, switch with the account switcher
in the top-right nav (it lists **Personal** plus each org) instead of
scripting `setActive`, so the recording shows the switch.

### Record and Test

For a CSS feature-detection override (for example forcing `CSS.supports('color: hsl(from white h s l)')` false to reach Clerk's legacy appearance parser, `packages/frontend/providers/clerk-theme-color.ts`), install it before page scripts and check `CSS.supports` in the recorded tab after navigation: raw CDP `Page.addScriptToEvaluateOnNewDocument` is ignored until `Page.enable` has run. Remove the script and reload before asserting modern behavior. On Clerk forms a malformed email only trips native HTML validation; a nonexistent valid-syntax address reaches a real Clerk danger alert.

For public forms, wait for client hydration after reload before filling or
submitting (a settled auth control such as **Sign Up** is a useful signal).
Server-rendered inputs may be visible before their React handlers are ready.

For newsletter error/retry checks, distinguish malformed input (client
validation, no request) from valid syntax rejected by the backend. Choose
rejection fixtures using `packages/email/validation/is-autogenerated-email.ts`:
a short numeric suffix need not cross the bot-score threshold. Use a realistic
non-disposable address for success, verify `newsletter_subscribers.source`
and `newsletter_consent_events.event`, then delete only test consent events
before their subscribers (the foreign key restricts deletion).

For TanStack Query refocus timing, a tab switch in Chrome launched with
`--disable-backgrounding-occluded-windows` does not emit a visibility change.
Use `document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))`
while the page is visible and annotate it as a synthetic trigger. The event
must bubble because query-core listens on `window`. Measure stale age from
the last response, not from navigation. Count query-layer fetches, not raw
Network entries: `Other`-initiator preloads pair with each fetch and appear
on baseline too.

> **Gotcha (Devin `agent-browser record`):** `record start` spins up a
> *fresh* browser context that does **not** carry the Clerk session, so it
> redirects to `/sign-in`. Start the recording first, re-consume a
> `clerk-dev-signin-token` ticket inside the recording context
> (`window.Clerk.client.signIn.create({ strategy: 'ticket', ticket })` +
> `setActive`), then navigate to the page under test.

> **Gotcha (`agent-browser record start <path> --fps 60`):** the recorder passes `-fps_mode` to ffmpeg, which needs ffmpeg 5 or newer. Ubuntu's system ffmpeg 4.4 rejects it and the recording silently ends up empty. Check `ffmpeg -version` first and put a static ffmpeg 7 on `PATH` if needed, then confirm the output with `ffprobe -count_frames -show_entries stream=r_frame_rate,nb_read_frames <path>`.

1. Start a screen recording.
2. Navigate to each page or component affected by the diff.
3. Annotate key moments:
   - `type="setup"` for navigation and login steps.
   - `type="test_start"` with an `"It should ..."` description
     for each feature being verified.
   - `type="assertion"` with pass/fail result after checking
     each behavior.
4. Verify: no console errors, layout renders correctly, the
   feature works as intended.
5. Stop the recording.

### Video Review Loop (MANDATORY)

After stopping the recording, **review what happened**:

1. Check the recording summary — did any assertions fail?
   Did the UI show errors, stuck states, or broken layouts?
2. If **everything passed** — proceed to report.
3. If **anything failed or looked broken**:
   a. Identify the root cause from the recording + console.
   b. Fix the code.
   c. Push the fix.
   d. **Re-record from scratch** — go back to step 1.
   e. Repeat until the recording shows everything working.
4. **Never send a recording that shows failures** as your
   final deliverable. The video you share with the user must
   demonstrate the feature working correctly.

Common failure patterns to watch for:
- "Processing" spinner stuck for >30 seconds
- `ERR_NETWORK_CHANGED` in console (wait for Docker to
  stabilize, then retry)
- Toast errors like "Item Save Error"
- UI elements not rendering (missing components, null returns)
- API returning 500s (check cfw-api logs)
- With `agent-browser`, refresh refs after every interaction; dismiss fixed
  maintenance banners before clicking lower-page controls.
- Wait for a hydrated control (not just navigation completion) before a
  full-page screenshot; RSC pages can finish navigating while the grid is
  still a skeleton.
- For streamed not-found SEO checks, inspect raw HTML (Googlebot UA curl)
  and the hydrated DOM separately, and report the HTTP status separately
  from the visible not-found boundary: `notFound()` on a dynamic route
  streams `robots=noindex` into a 200 response.

### Comparing API vs UI

When validating that a server tool produces the same
output via the API and the UI:

1. Run the manual API test first — inspect the JSON output
2. Open the UI feature in the browser
3. Sign in and run the same operation
4. Compare: models used, completion content, annotations

### Report

- Send the video to the user as an attachment.
- Include screenshots of affected pages in the PR description.
- If issues are found, fix them and re-record.
- **Do NOT report the PR as "ready" if the video shows
  failures.** Either fix and re-record, or clearly tell the
  user what is broken and why you could not fix it.

---

## Chatroom / Playground Testing

When changes affect the chatroom or playground features
specifically, follow these additional steps.

### Local Login

Sign in with a [Clerk sign-in ticket](../clerk-dev-signin-token/SKILL.md), as described in [local-dev-env](../local-dev-env/SKILL.md#sign-in).

### Known Issues

**Browser `ERR_NETWORK_CHANGED` during Docker startup:** wait for the required resources to become ready, then reload. For persistent failures, inspect Docker network events with `docker events --filter type=network`.

**Chat requests fail while the page loads:** check `tilt logs api` and the API readiness result. Resolve the reported service or credential failure before treating the UI interaction as an end-to-end pass.

### Testing System Prompt

1. Navigate to `/chat` on the web origin shown by Tilt
2. Sign in using local-dev-env if needed
3. Select a model (click on a model icon in the flagship
   models section)
4. Click the three-dot menu (`:`) next to the model name
   in the tab bar
5. The character config dialog shows the "System Prompt"
   section
6. Verify the prompt contains:
   - Model name and author
   - Frozen date line
   - Formatting rules block

### Testing Server Tools

The `getServerTools()` function in `prepare-api-request.ts`
constructs the tools array. To verify:
1. The datetime tool (`openrouter:datetime`) is always included
2. Web search tool is conditionally included based on
   `isWebSearchEnabled`
3. To inspect the actual request payload, set up a fetch
   interceptor in the browser console before sending a message

### Key Chatroom Files

- System prompt: `projects/web/features/playground/definitions/defaults.ts`
- API request builder: `projects/web/features/playground/state/chat/helpers/send-to-character/prepare-api-request.ts`
- Model info types: `packages/models/model-info/index.ts`
- Model constructor: `packages/routing/models/constructor.ts`

---

## Key References

### Multilingual browser setup

Before recording locale UI (for example the navbar language picker), verify
native labels visually, not only in the DOM. On Linux, check CJK font coverage
with `fc-list :lang=zh`, `fc-list :lang=ja`, and `fc-list :lang=ko`, and install
`fonts-noto-cjk` if any is empty. Chrome keeps its missing-glyph fallback after
installation, even across reloads and new tabs. Restart Chrome at the process
level (`chrome://restart`) while preserving its user-data directory, then
confirm glyphs and authentication before recording.

### Local feature-flag and responsive UI verification

The development panel is available to local development users. Open it with
`Ctrl+.` (`Cmd+.` on macOS), choose **Feature Flags**, and filter by the Statsig
gate name before selecting **On**, **Off**, or **Default**. Confirm the evaluated
value as well as the override selection. These controls are implemented in
`projects/web/components/dev-panel/FeatureFlagsPanel.tsx`.

When switching locales, re-inspect accessible names: the developer panel is
translated too (for example, `Search flags…` becomes `Flags suchen…` in German).
Do not reuse an English-only search or button locator after locale navigation.

If native computer control is unavailable and CDP fallback is authorized, keep
one persistent browser connection while using mobile device metrics. Disconnecting
between actions can restore Chrome's minimum physical window width. Check
`innerWidth` and visually review the captured recording, not just screenshots.
Auto-edited recordings may compress CDP-only actions excessively; retain the raw
recording and render timestamped annotations onto a real-time copy when necessary.

### Newsletter popup artwork checks

The Dev Panel gate override also works signed out, so an `everyone` audience capture unit needs no Clerk login. Seed real `newsletter_popup_config` rows with path-specific `included_paths` so desktop/mobile and fallback fixtures coexist without editing rows mid-recording. The public capture-units API response and the client query are each cached for 60 seconds. Between presentations, clear only the newsletter-prefixed local/session storage keys (see `projects/web/components/newsletter/newsletter-storage.ts`), then reload. Wait for the dialog opening animation and check `img.complete && img.naturalWidth > 0` before screenshotting. URL-without-alt fixtures cannot be tested through the API because the creative schema rejects them and the serializer nulls malformed stored creative. Submission needs `NEXT_PUBLIC_NEWSLETTER_TURNSTILE_SITE_KEY` and matching backend Turnstile configuration, so artwork-only checks do not prove it.

- E2E test infrastructure: `tests/e2e/README.md`
- Manual test patterns: `tests/manual/README.md`
- Test config and model groups: `tests/e2e/config/`
- Shared assertions: `tests/e2e/api/shared/assertions.ts`
- Request factories: `tests/e2e/fixtures/`
- dev-fs-logs output: `services/dev-fs-logs/.logs/`
- Test utilities: `tests/e2e/utils/`

## When to Re-Test

Re-run the relevant testing workflow whenever you:

- Push a code fix (even a "trivial" one-liner)
- Rebase or merge and resolve conflicts
- Change anything in the streaming layer, skins, or adapters
- Modify UI components that render API responses
- Address PR review feedback that changes behavior

Do NOT assume a fix works just because it compiles or passes
lint. If the change affects runtime behavior, test it.

---

## Related Skills

- [`local-dev-env`](../local-dev-env/SKILL.md) — local stack setup, service readiness, and inference tracing
- `create-fixtures` — create upstream SSE fixtures and snapshot
  tests for the adapter → plugins → skin pipeline
- `stage-endpoint` — get a model + endpoint into local Postgres
  and test via curl (prod-first via seeds preferred)
