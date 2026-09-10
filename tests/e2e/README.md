# OpenRouter E2E Test Infrastructure

E2E testing infrastructure with model capability mapping,
test fixtures/factories, and type-safe helpers.

> **Writing or reviewing tests?** Read
> [REVIEW.md](./REVIEW.md) for common footguns that break the
> nightly suite.

## Quick Start

### Against Production

```bash
cd tests/e2e
cat >> .env.local << EOF
OPENROUTER_API_KEY=<your-api-key>
CF_WORKER_VERSION_OVERRIDE=<version-uuid>
EOF
```

```bash
TEST_ENV=production bun run test:e2e
```

### Against Local

1. Start the stack from the repository root using [local-dev-env](../../.agents/skills/local-dev-env/SKILL.md):

```bash
bun run dev:up
```

1. Run tests:

```bash
cd tests/e2e
bun run test:e2e
```

- Use the API origin reported by Tilt as `OPENROUTER_API_BASE` when ports differ from the defaults.
- `tests/e2e/.env.local` overrides shell values, including the target origin and API key.

### Opt-In Anthropic Compaction Tests

The live Anthropic compaction tests are skipped by default because they make
real beta requests through OpenRouter and depend on your local `cfw-api`
having a working `ANTHROPIC_API_KEY`.

```bash
cd tests/e2e
RUN_ANTHROPIC_COMPACTION_STREAMING_E2E=1 \
bun run test:e2e api/messages/beta-features/compaction-streaming.test.ts
```

```bash
cd tests/e2e
RUN_ANTHROPIC_COMPACTION_NON_STREAMING_E2E=1 \
bun run test:e2e api/messages/beta-features/compaction-non-streaming.test.ts
```

Notes:

- These tests target the local worker by default (`http://127.0.0.1:8787`)
- The local `cfw-api` process must be running with `ANTHROPIC_API_KEY` configured
- You can keep using the default local unlimited test key, or set
  `OPENROUTER_API_KEY` / `OPENROUTER_API_BASE` if you want to point the harness
  somewhere else
- Both requests use `context_management.edits[].type = compact_20260112` with
  two oversized prior turns plus a short follow-up user turn, matching the
  known-good direct-to-Anthropic compaction payload
- Each file now covers both the compaction path and a non-compaction base case
  so the live matrix exercises both behaviors per transport mode
- The streaming test follows Anthropic's streaming compaction docs rather than the
  `pause_after_compaction` flow, so it expects streamed `compaction` block events
  and a non-null final `stop_reason`, not necessarily `stop_reason = "compaction"`
- The non-streaming test expects a final response containing a `compaction`
  content block, at least one `text` block, and `usage.iterations` with both
  `compaction` and `message` entries; its base-case variant asserts the absence
  of compaction blocks and compaction iterations

The separate `api/messages/beta-features/compaction.test.ts` file stays focused on
request-path behavior like validation, header handling, and replay acceptance. Use
the two files above when you want to manually confirm that Anthropic compaction is
actually triggering through OpenRouter.

## Running Tests


Run a specific test file:

```bash
cd tests/e2e
bun run test:e2e bugs/08-24-2025-parallel-tool-calling
```

Or pass them inline for a one-off run:

```bash
cd tests/e2e
TEST_ENV=production OPENROUTER_API_KEY=<your-api-key> bun run test:e2e
```

Notes:

- `TEST_ENV=production` routes requests to `https://openrouter.ai`
  instead of the local worker (`http://127.0.0.1:8787`)
- Special test keys (`sk-or-v1-unlimitedkey`, etc.) do not exist
  in production — use a real API key
- `TEST_ENV=staging` works the same way for the staging environment

### Targeting a Specific Worker Version

Set `CF_WORKER_VERSION_OVERRIDE` to the Cloudflare Worker version ID UUID
(e.g. `ef07125d-c4e2-4f19-9d1b-db8371114dd5`). The test harness wraps it in
the required `api="…"` header format automatically. Setting the full
`api="…"` value in the env var will not work correctly.

### Running Against a Specific Production Worker Version in CI

The `E2E Tests (CF Version)` workflow runs the `tests/e2e` suite against
production with requests built through the shared helpers and
`config.headers.standard` pinned to an actively deployed `cfw-api` version.
The pinning-audit rule and reproducible candidate-path check are maintained in
the [E2E review guidelines](./REVIEW.md#10-audit-cloudflare-version-pinning-coverage).
The preflight check fails if the supplied version UUID is not part of the
current deployment, because Cloudflare silently ignores overrides for inactive
versions.

A green run proves only that the requested version appeared in the deployment
at the preflight and post-test samples. It does not prove Cloudflare honored
the override header. To confirm that, dispatch a post-merge run against a
non-100% version and check Datadog for the suite requests carrying
`cf.worker.version.id`, which is populated through `version_metadata` in
`services/cfw-api/wrangler.toml` and tagged in
`packages/cloudflare/instrumentation/context.ts`. Both deployment guards sample
only the endpoints of the run, so a promotion during the test window can still
slip through.

Run it from the GitHub Actions `workflow_dispatch` form, supplying
`cf_version_id` and an optional `test_filter` (a Vitest filter or test path,
which may not start with `-`). The dispatch recipe for agents lives in
[`AGENTS.md`](./AGENTS.md).

## Inspecting with dev-fs-logs

The `dev-fs-logs` service captures structured logs from local
development runs for inspection and debugging.

```bash
bun run dev dev-fs-logs
```

Once running, logs are written to
`services/dev-fs-logs/.logs/<name>.log` for each request.

Note: logs are only written during local development — not
during `bun run test` or in production/Kubernetes environments.

## HIPAA Mirror Suite (`api/hipaa`)

`api/hipaa` covers the `api-hipaa` service-binding mirror end to end (ENT-2052): dispatch from the primary and its fail-closed 503, the unsupported-surface 403 on every non-text worker (post-auth and pre-relay), BAA-eligibility routing, and sink isolation (prompt storage, Pub/Sub task topics, broadcast destinations, Spanner, Postgres) with a non-HIPAA positive control for every negative.

It is local-only. Remote runs skip every file, and each file also skips — with a `[WARN]` naming the missing piece — when part of the stack is down, so a partial `tilt up` still runs what it can. To run all of it:

1. Run `bun run dev:up` using [local-dev-env](../../.agents/skills/local-dev-env/SKILL.md). Confirm the named services used by the tests are Ready; trigger `stt-api` and `tts-api` if they have not started.
2. Start the mirror: `tilt trigger api-hipaa`, or `cd services/cfw-api && bun run dev:hipaa`. The mirror reads the `hipaa-dev` Infisical scope; until `/services/cfw-api` is populated there, run it the way CI does — copy `services/cfw-api/.dev.vars` to `.dev.vars.hipaa` and start `wrangler dev --env hipaa --port 8818 --persist-to ../../.wrangler/shared-state`. The primary must have been started through `bun run dev` (not bare `wrangler dev`), which generates the `wrangler.dev.toml` that carries the `SVC_CFW_API_HIPAA` binding.
3. `bunx tsx tests/e2e/utils/seed-test-data.ts` for the sink-control entity and keys. The fixture models (`openrouter/fake-hipaa`, `openrouter/fake-hipaa-ineligible`) come from `bun run db:seed`; after a fresh seed, re-warm KV (`curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'`) and restart both workers so they pick the models up.
4. `cd tests/e2e && bunx vitest run api/hipaa`.

When the primary runs without the mirror binding (how the nightly `TEST_ENV=local` workflow starts it), `dispatch.test.ts` runs its fail-closed assertions instead of the dispatch ones. When the binding exists but no `api-hipaa` session answers, the files skip with instructions rather than fail. The broadcast assertions in `sink-isolation.test.ts` need the `PROVIDER_ENCRYPTION_KEY` cfw-api runs with; the file reads it from the environment or from `services/cfw-api/.dev.vars` and skips only those assertions when it is unavailable. The suite's webhook listener binds `HIPAA_E2E_WEBHOOK_PORT` (default 47331).

## Features

### Model Configuration

Centralized model capability mapping for easy test organization:

```typescript
import { TestModelGroups, getModelsWithCapabilities }
  from '@/config/test-models';
import { ModelCapability } from '@/config/model-capabilities';

// Use predefined groups
describe.each(TestModelGroups.reasoning)('Test: %s', (model) => {
  // Tests run for all reasoning models
});

// Query by capability
const multimodalModels = getModelsWithCapabilities([
  ModelCapability.ImageInput,
  ModelCapability.ToolCalling,
]);
```

Capabilities tracked:

- Tool calling, structured output, JSON schema
- Image/video/audio input, image output
- Reasoning modes, streaming, long context
- Web search, prompt caching

### Test Fixtures & Factories

Type-safe factories with Result monad pattern:

```typescript
import { createTestUser, TestApiKeyBuilder } from '@/fixtures';

const userResult = await createTestUser();
const keyResult = await TestApiKeyBuilder.unlimited({
  createUser: true,
});

const depletedKey = await TestApiKeyBuilder.depleted();
const disabledKey = await TestApiKeyBuilder.disabled();
```

### API Helper

Clean wrapper with Result monad for type-safe error handling:

```typescript
import { callApi } from '@/utils/call-api';
import { assertOk }
  from '@openrouter-monorepo/type-utils/result-monad';

const result = await callApi('/api/v1/chat/completions', {
  body: {
    model: 'anthropic/claude-4.6-sonnet-20260217',
    messages: [{ role: 'user', content: 'Hello' }],
  },
});

assertOk(result);
console.log(result.data);
```

## Directory Structure

```text
tests/e2e/
├── config/          # Model capability configuration
│   ├── model-capabilities.ts
│   ├── models.ts
│   └── test-models.ts
├── api/
│   ├── messages/    # End-to-end API coverage (excerpt below shows the compaction tests)
│   │   └── beta-features/
│   │       ├── compaction.test.ts
│   │       ├── compaction-streaming.test.ts
│   │       └── compaction-non-streaming.test.ts
│   │       └── ...
│   ├── batches/     # Batch API (submit/poll/finalize/results)
│   └── ...
├── fixtures/        # Test data factories
│   ├── user-factory.ts
│   ├── api-key-factory.ts
│   ├── message-factory.ts
│   ├── request-factory.ts
│   └── index.ts
├── intern-provisioner/  # Hermetic E2E suite for cfw-intern-provisioner
│   ├── fixture.ts       # Boots stub server (:8795) + wrangler dev (:8794)
│   ├── stubs/           # HTTP stubs for GitHub, Slack, Cloudflare, GCP
│   └── *.test.ts        # happy-path, failure-path, idempotent-reenqueue, override-coverage
├── utils/           # Utilities and helpers
│   ├── call-api.ts
│   ├── config.ts
│   └── seed-test-data.ts
└── bugs/            # Bug regression tests
```

## Adding New Models

1. Update `tests/e2e/config/models.ts`:

```typescript
{
  id: Model.New_Model,
  pinnedTo: Provider.SomeProvider,
  capabilities: [
    ModelCapability.ToolCalling,
    ModelCapability.Streaming,
  ],
  contextWindow: 128_000,
}
```

`pinnedTo` is the inference provider that serves this model in tests. It's
used both to strictly route requests (`provider.only: [pinnedTo]`) and to
filter test models by provider — see `Provider` in
`config/model-capabilities.ts`. For closed-author models (Anthropic, OpenAI,
Google, xAI) this is usually the author. For open-weight models pin to the
specific hoster you want to exercise.

1. Mark the old model as deprecated:

```typescript
{
  id: Model.Old_Model,
  isDeprecated: true,
  deprecatedBy: Model.New_Model,
}
```

1. Tests using `TestModelGroups` automatically use the new model.

## Troubleshooting

### Tests Timeout

Increase the timeout in the test file:

```typescript
vi.setConfig({ testTimeout: 60_000 });
```

### API Key Issues

Verify your `tests/e2e/.env.local` has correct values:

```bash
cat tests/e2e/.env.local
```

### dev-fs-logs Not Writing Logs

1. Ensure service is running: `bun run dev dev-fs-logs`
1. Check you're not in test mode (logs don't write during `bun run test`)
1. Verify `sendToFSLog` is called in the code path you're testing

### Type Errors

```bash
bun run typecheck
```
