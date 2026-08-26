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
  from '@openrouter-monorepo/type-utils/result-monad';
import { expect, it, vi } from 'vitest';
import { callChatCompletion } from '@/api/completions/shared';
import snapshot from './snapshot.json';

vi.setConfig({ testTimeout: 47_000_000 });

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
  from '@openrouter-monorepo/type-utils/result-monad';
import { describe, expect, it } from 'vitest';
import { TestModelGroups } from '@/config/test-models';
import { RequestBuilder } from '@/fixtures';
import { callApi } from '@/utils/call-api';
import { assertSuccessfulCompletion }
  from '../../shared/assertions';

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
cd tests/e2e && bun run test:e2e <path-to-test>
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
- Set long timeouts (`47_000_000`) for fusion tests that
  make multiple LLM round-trips
- Check `isDefinedAndNotNull` when filtering
  `extractAnnotations` results

---

## Running API E2E Tests

### Deterministic upstream via local fake-provider (no Tilt)

To exercise the router against a controllable upstream without Tilt,
route the seeded private model `openrouter/fake` (FakeProvider) at the
local fake provider:

1. Start it with `FAKE_PROVIDER_PORT=3002 bun run dev` in
   `services/fake-provider`, setting `FAKE_PROVIDER_API_KEY` to the value
   read from Infisical (`infisical secrets get FAKE_PROVIDER_API_KEY`
   with `--env=dev --path=/services/cfw-api` and the repo project ID from
   the root AGENTS.md).
2. Repoint the provider in local Postgres:
   `update providers set base_url='http://localhost:3002/v1' where provider_name='FakeProvider';`
3. `openrouter/fake` is `is_private=t`, so grant the seeded dev user:
   `insert into private_model_access (model_permaslug, entity_id) values ('openrouter/fake-20260806','user_2xyeKet6gI2xZ0U4UoshenrrGi1');`
4. Warm the KV cache (`rm -rf services/cfw-api/.wrangler/state/v3/kv`,
   then `cd services/cfw-api && bun run test:cron`) — requires the local
   ClickHouse container (see stage-endpoint skill) or the warm cron fails.
5. Call with `Authorization: Bearer sk-or-v1-unlimitedkey` and
   `"model": "openrouter/fake"`.

Router `wLog`/`iLog` output (e.g. new observability log lines) appears in
the `bun run dev cfw-api` wrangler stdout — capture it to a file to grep.
cfw-api talks to the upstream via SSE by default even for non-streaming
client requests, so a temporary fake-provider patch that only changes the
non-streaming JSON branch won't be exercised — patch the streaming chunk
generator too.

Gotchas when synthesizing upstream logprobs or changing endpoint capabilities:

- Synthetic logprob items MUST include `bytes: null` on every token and
  top_logprob entry — `normalizeLogprobs` in
  `packages/router/adapters/base/make-output/normalize-logprobs.ts` Zod-guards
  with a required (nullable) `bytes` field and silently drops the whole
  logprobs object if it's missing, making it look like a router bug.
- Endpoint `supported_parameters` come from `providers.supported_parameters`
  in local Postgres (not a column on `endpoints`). After changing them,
  re-warm the running worker with
  `curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'` (what
  `test:cron` runs) — no KV wipe or worker restart needed.
- `tsx --watch` on fake-provider may not reload reliably; restart the
  process (in a dedicated shell) after patching and verify with a direct
  curl to :3002 before testing through the router.

### Setup

1. Start dev-fs-logs: `bun run dev dev-fs-logs`
2. Start the API server: `bun run dev cfw-api`
   - If `CF_API_TOKEN` errors occur, comment out the `[ai]`
      binding in `cfw-api/wrangler.toml` as a workaround.
   - If every model returns 400 "not a valid model ID", the
     local database is unseeded — run `bun run db:seed` first.
3. Ensure `tests/e2e/.env.local` has a valid
    `OPENROUTER_API_KEY`. If not, source it from Infisical or
    the stored secret.

### Testing workspace-scoped policy (e.g. `disabled_server_tools`)

Read the workspace off the key you are sending
(`select workspace_id from api_keys where label = '<key>'`) — the seeded key
sets it explicitly, so deriving one from an entity id updates a row no
request reads and everything returns 200 as if the policy were broken.

Include one request an already-enforced branch of the same policy blocks as
a sanity gate: if that one isn't blocked, the row isn't in play and the path
under test proved nothing. Restore the column when done.

### Batch API Tests

Batch tests require the full batch stack:
```bash
tilt up cfw-batch-api dataflow-async-jobs
```

If submissions return a 429 mentioning `openrouter_limiter_unavailable`, enable
the local `redis` and `serverless-redis-http` resources before retrying.

The tests self-skip when services are unavailable. Run with:
```bash
cd tests/e2e && bun run test:e2e api/batches
```

### Run Tests

1. Identify which test files cover the changed functionality by
   searching `tests/e2e/api/` for related test names.
2. Run the relevant subset:
   ```bash
   cd tests/e2e && bun run test:e2e <path-to-relevant-test>
   ```
   If the change is broad (e.g. a core adapter refactor), run
   the full suite: `cd tests/e2e && bun run test:e2e`
3. After tests complete, check dev-fs-logs for the most recent
   generation:
   ```bash
   ls services/dev-fs-logs/.logs/
   ```
   Collect sample log files to verify request/response behavior.

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

1. Start the local stack: `tilt up` (use `TILT_PROFILE=lean tilt up` if encountering OOM)
2. Wait for services:
   ```bash
   tilt wait --for=condition=Ready \
     uiresource/postgres uiresource/postgres-migrate \
     uiresource/postgres-seed uiresource/web \
     --timeout=300s
   ```
3. Ensure database is seeded: `bun run db:reset`
4. Log in at `http://localhost:3000` using the
   [`clerk-dev-signin-token`](../clerk-dev-signin-token/SKILL.md)
   skill (headless sign-in token against the dev Clerk tenant — no
   shared password account, no lockouts).
5. If the flow calls a private `/api/frontend/v1` route, start the
   local `cfw-frontend-api` service as well; a standalone web server
   returns 404 for those same-origin paths.

### Browser Tool Selection

Use whatever browser tool is available in your environment:

- **Playwright MCP** (Claude Code) — use `browser_navigate`,
  `browser_snapshot`, `browser_click`, `browser_type`, etc.
- **Built-in browser** (Devin) — use Devin's browser tool
- **Browser preview** (Cursor) — use the built-in preview

Do not assume a specific browser tool is connected.
Check what tools are available before proceeding.

For automated Playwright tests (`tests/web-e2e/`), credentials are
injected by Infisical at path `/tests/e2e`. Run with:
```bash
bun run --filter tests/web-e2e e2e
```
These are read by `tests/web-e2e/global-setup.ts` to
authenticate before Playwright tests. `E2E_CLERK_USER` /
`E2E_CLERK_PASSWORD` belong to the **prod** Clerk tenant — do not
use them against localhost.

### Sign In Flow (local manual browser testing)

1. Mint and consume a sign-in ticket per the
   [`clerk-dev-signin-token`](../clerk-dev-signin-token/SKILL.md)
   skill — no sign-in form, password, or email code needed.
2. Wait for the session to become active (reload any page).
3. Call `window.Clerk.setActive({ organization: null })` to deactivate any active org, ensuring the saved session runs in personal-account context

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

> **Gotcha (Devin `agent-browser record`):** `record start` spins up a
> *fresh* browser context that does **not** carry the Clerk session, so it
> redirects to `/sign-in`. Start the recording first, re-consume a
> `clerk-dev-signin-token` ticket inside the recording context
> (`window.Clerk.client.signIn.create({ strategy: 'ticket', ticket })` +
> `setActive`), then navigate to the page under test.

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
Use the
[`clerk-dev-signin-token`](../clerk-dev-signin-token/SKILL.md)
skill to sign in on localhost (requires Infisical access to
`/projects/web`; see `AGENTS.md` § Secret Management for the auth
snippet).

### Known Issues

**Docker network causes browser ERR_NETWORK_CHANGED:**
When tilt starts, Docker creates and modifies networks
repeatedly. This causes Chrome to throw `ERR_NETWORK_CHANGED`
errors for several minutes. Wait 3-5 minutes after `tilt up`
for Docker networking to stabilize. If the browser is stuck,
restart it and wait before navigating.

To monitor Docker network events (useful for diagnosing
persistent network issues):
```bash
docker events --filter type=network
```

**Firecracker / lightweight-VM issues:** See the
[tilt-testing skill § 9](../tilt-testing/SKILL.md#9-firecracker--lightweight-vm-known-issues)
for Flannel VXLAN crashes, DNS resolution failures, and memory
constraints on ≤16 GB VMs.

**cfw-api may not start** without `CLOUDFLARE_API_TOKEN`.
The chatroom UI will load but API requests will fail with
500 errors. You can still verify frontend behavior (system
prompt, UI state) but not end-to-end API responses.

### Testing System Prompt

1. Navigate to `http://localhost:3000/chat`
2. Login via the [`clerk-dev-signin-token`](../clerk-dev-signin-token/SKILL.md) skill if not already logged in
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

- `tilt-debug` — trace an inference request through the full
  local Tilt stack (cfw-api → usage-record → dataflow → Spanner)
- `create-fixtures` — create upstream SSE fixtures and snapshot
  tests for the adapter → plugins → skin pipeline
- `stage-endpoint` — get a model + endpoint into local Postgres
  and test via curl (prod-first via seeds preferred)
