---
name: e2e-api-testing
description: >-
  Create and run API-side e2e/manual tests for changes to
  packages/router, services/cfw-api, providers, adapters,
  skins, or API routes.
user-invocable: true
---

# API E2E Testing

Use this skill for API changes: `packages/router/`,
`services/cfw-api/`, `packages/providers/`, `packages/db/`,
adapter code, skins, or API route handlers. See
[e2e-testing](../e2e-testing/SKILL.md) for when to test and how
to determine scope.

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

A deployed `OPENROUTER_API_KEY` exported in the shell also overrides the seeded local key, and every local call then fails with `401 User not found`. Run local suites with `env -u OPENROUTER_API_KEY -u OPENROUTER_E2E_API_KEY bun run test:e2e run <path>`.

For router pipeline metadata, send `X-OpenRouter-Metadata: enabled` and inspect `openrouter_metadata.pipeline` in the response. A body field such as `metadata_level: "full"` does not enable it; see `services/cfw-api/src/utils/parse-metadata-level.ts`. Verify the upstream request separately in `adapters/base-fetch-request.log` so missing metadata is not mistaken for a plugin that did not run.

### Deterministic upstream via local fake-provider

`fake-provider` starts automatically with the stack in both profiles. Wait for it, then run the existing routing helper from the repository root:

```bash
tilt wait --for=condition=Ready uiresource/fake-provider --timeout=300s
bun run x scripts/use-local-fake-provider.ts
```

It changes FakeProvider's base URL, unhides its seeded `openai/gpt-4.1-2025-04-14` endpoint, grants private endpoint access to local API-key owners, warms KV, and requests an API restart. Pass the actual `FAKE_PROVIDER_PORT` and `CFW_API_PORT` if overridden. Check the helper's warnings and confirm the new worker run before testing.

Request `"model": "openai/gpt-4.1-2025-04-14"` with `"provider": {"order": ["fake-provider"], "allow_fallbacks": false}`. The provider restriction keeps the test on the fake upstream. See [Fake Provider](../../../services/fake-provider/README.md) for response controls.

Router logs appear in `tilt logs api`; upstream logs appear in `tilt logs fake-provider`. cfw-api prefers upstream SSE even for a non-streaming caller, so test the relevant upstream transport when changing the fake response generator.

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
- A 200 does not prove the adapter mapped a `file` / `image_url` part. On a row whose model lacks the `file` / `image` input modality the file-parser plugin OCRs the PDF into text and strips the image before the adapter runs, so the outbound body carries OCR text and no native document field. Stage the local model row with the modality, republish the catalog, restart the worker, then re-read `adapters/base-fetch-request.log`.
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
  `cfw-internal` `__scheduled` warm above has run. If it still 503s after the
  warm, add `cfw-frontend-api` to the same `bun run dev` and run
  `bun scripts/api-kv-cron.ts http://localhost:8794 http://localhost:8795 900`
  (what Tilt's `api-kv-cron` runs), which waits for a new catalog head.
  `fake-provider` outside Tilt needs `FAKE_PROVIDER_API_KEY` exported from
  `services/cfw-api/.dev.vars`, or it exits at startup.
  `__scheduled` can return 200 without publishing; to force a refresh run
  `curl -sS --max-time 900 http://localhost:8794/api/v1/internal/cron/trigger -H 'Content-Type: application/json' -d '{"task":"refresh-kv-models-and-endpoints"}'`
  and retry it if the `cfw-internal` log shows `Network connection lost.`

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
- When running `wrangler dev` for the worker by hand instead of through Tilt, pass the placeholder with `--var SEQUENCE_WEBHOOK_SECRET:local-placeholder` (`.dev.vars` does not carry it) and confirm no older `workerd` still holds `:8807`, or the E2E exercises stale code.
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

## Key References

- E2E test infrastructure: `tests/e2e/README.md`
- Manual test patterns: `tests/manual/README.md`
- Test config and model groups: `tests/e2e/config/`
- Shared assertions: `tests/e2e/api/shared/assertions.ts`
- Request factories: `tests/e2e/fixtures/`
- dev-fs-logs output: `services/dev-fs-logs/.logs/`
- Test utilities: `tests/e2e/utils/`

## Related Skills

- [`e2e-testing`](../e2e-testing/SKILL.md) — when to test, scope determination, critical rules
- [`local-dev-env`](../local-dev-env/SKILL.md) — local stack setup, service readiness, and inference tracing
- `create-fixtures` — create upstream SSE fixtures and snapshot
  tests for the adapter → plugins → skin pipeline
- `stage-endpoint` — get a model + endpoint into local Postgres
  and test via curl (prod-first via seeds preferred)
