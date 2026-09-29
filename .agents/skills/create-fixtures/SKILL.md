---
name: create-fixtures
description: Create upstream fixtures for a provider and generate snapshot tests
  that pipe them through router.submit with a provider-specific adapter. TRIGGER
  whenever a change adds or modifies handling of upstream provider behavior —
  new API params (reasoning, caching, service tiers), new stream event types,
  new response fields, refusal/error shapes, or adapter/skin transforms. These
  changes must ship with a captured fixture in the same PR, not a follow-up.
user-invocable: true
---

# Create Fixtures Skill

End-to-end workflow: collect a real upstream SSE fixture from a provider API,
wire it into `fixtures/`, and write a snapshot test that exercises the full
`adapter → plugins → skin` pipeline via `router.submit`.

**Fixtures vs snapshots:** they pair up. The *fixture* is the input — a
captured raw upstream provider payload checked into `fixtures/<provider>/`,
pinning what the provider actually sends. The *snapshot* is the expected
output — the recorded result of piping that fixture through `router.submit`
(`toMatchSnapshot()`, stored in `__snapshots__/`), pinning what OpenRouter
emits for it. Any transform change then surfaces as a snapshot diff against
real provider data.

## When fixtures are required

Ship a fixture + snapshot test **in the same PR** whenever the change touches
what the router receives from a provider:

- New API params or param semantics (e.g. `reasoning.mode`, `reasoning.context`,
  explicit prompt caching, service tiers, `phase`)
- New upstream stream event types or response fields (e.g. refusal
  `stop_details`, citations, mid-session system messages)
- Adapter response transform changes
- Skin stream/non-stream handler changes (`from-internal-stream/`)
- New provider adapters (see `add-provider-adapter`)

A synthetic inline payload hand-written from vendor docs is **not** a
substitute — it encodes your assumptions, not the provider's actual wire
format. Historically, feature PRs shipped without fixtures and needed
follow-up `test(router):` backfill PRs (e.g. #23774, #27962); include the
fixture up front instead.

**Never fabricate or hand-edit a fixture.** This includes copying an
existing fixture and splicing in fields you expect the provider to send
(e.g. editing a usage object to add tool-call counters). A doctored file
looks like a capture but carries the same assumption-encoding problem as a
synthetic payload, and is worse because it masquerades as real provider
output. Every fixture file must be a verbatim capture from a live provider
API call. If you cannot trigger the behavior against the live API, say so
in the PR instead of forging the fixture.

**Not required for** changes that never touch upstream response payloads:
request-only transforms (reshaping the outgoing request body, covered by unit
tests on `transformRequest`), pure routing/filtering logic, pricing metadata,
model ID enums/aliases, provider configs, or refactors covered by existing
fixture snapshots.

## Overview

1. **Collect** the raw upstream SSE response from the provider API
2. **Add** the fixture JSON to the provider directory under `fixtures/`
3. **Write** a snapshot test using the `vi.mock` adapter swap pattern
4. **Generate** the initial snapshot with `--update-snapshots`

---

## Step 1 — Collect the fixture

Every checked-in fixture must be reproducible from a collection script in
`fixtures/scripts/` — add your scenario to the provider's existing
`collect-<provider>-*.ts` script (or create one) and generate the fixture by
running it, so the exact request that produced the capture is committed
alongside the fixture. Do **not** check in a fixture produced by an ad-hoc
curl with no corresponding scenario in the script; an unreproducible capture
can't be re-collected when the provider's behavior changes. Ad-hoc curls are
fine for exploration, but promote the request into the script before
committing the fixture. The scripts also write the parsed `.json` companion
next to the `.sse.txt` — commit both.

Collection scripts resolve imports through `fixtures/package.json`, not the
root — if your script imports a workspace package (e.g.
`@openrouter-monorepo/providers` for key schemas) or an npm dep (e.g.
`aws4fetch` for SigV4-signed providers) that isn't listed there yet, add it
to `fixtures/package.json` and run `bun install` (commit the `bun.lock`
change), or `bunx tsx` fails with `ERR_MODULE_NOT_FOUND`. Modules under
`packages/helpers` that import their own package by name (e.g.
`openai-error.ts` importing `@openrouter-monorepo/helpers/get-http-status-or`)
also fail to resolve under `tsx` from a fixture script even though
`@openrouter-monorepo/helpers` is listed — define a script-local Zod schema for
the shape you need instead of importing such a module.

Run the collection script and provide env via Infisical:

```bash
infisical run --env=dev --path=/_providers --include-imports=false \
  --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 \
  -- bunx tsx fixtures/scripts/collect-<provider>-reasoning.ts [scenario-name]
```

Before reusing an older script, confirm its endpoint env var still points at
the intended provider. Shared slots such as `STEALTH_API_URL_*` get
reassigned between providers; prefer the provider's fixed URL in the script.

The agent wrapper (`scripts/infisical/agent-auth.sh` → `infisical_run`) only
accepts folders listed in `env.manifest.json`; `/_providers` is not one, so
look the key up there (`jq '.links | to_entries[] | select(.value|tostring|test("GMI_CLOUD_API_KEY")) | .key'`)
and use that folder (provider keys are under `/services/cfw-api`).

Some provider edges (GMI Cloud) answer a request with no `User-Agent` header
with a Cloudflare 403; set one explicitly in the script's `fetch` headers.

Prompt-cache scenarios: a single warmup request does not guarantee a cache
read. Drain the warmup body (don't `cancel()` it) and re-run until the
recorded `cached_tokens` is a substantial share of `prompt_tokens`.

**Key rule:** the fixture must be the **raw upstream format** that the adapter
receives, not the transformed OpenRouter output.

- **Anthropic** — native Anthropic message stream format
  (`message_start`, `content_block_start`, `thinking_delta`, etc.)
- **OpenAI / xAI / most others** — OpenAI Chat Completions SSE
  (`choices[0].delta.content`, etc.)
- **Gemini** — Google `candidates[0].content.parts` SSE with
  `thought: true` for thinking parts — requires `includeThoughts: true` in
  `thinkingConfig` to get thinking output
- **Mistral** — array-style thinking chunks
  (`delta.content: [{type: "thinking", ...}]`) require
  `reasoning_effort: "high"` on a reasoning-capable model (e.g.
  `mistral-small-latest`); the older magistral `prompt_mode: "reasoning"`
  is deprecated and rejected with error 3051

---

## Step 2 — Register the fixture

No registration step is needed — tests import directly from the provider
directory:

```ts
import myFixture from '@openrouter-monorepo/fixtures/<provider>/YYYY-MM-DD-<model>.json';
```

Optionally export a helper from `fixtures/<provider>/index.ts`:

```ts
export function getMyFixtureSse() {
  return getSseFromTxtFile({
    // @ts-relative-path
    filePath: 'YYYY-MM-DD-<model>.sse.txt',
    baseUrl: import.meta.url,
  });
}
```

---

## Step 3 — Write the test (adapter swap pattern)

The critical pattern, copied from `packages/router/tests/anthropic-output-config.test.ts`:

```ts
import { createMockAdapterFromEndpoint } from '../mocks/mock-adapter';
import { getRouterTestMocks } from '../mocks/mock-router-dependencies';

vi.useFakeTimers();

// 1. Grab the shared `createTextModelAdapter` mock that MockRouter delegates to.
//    `MockRouter.createAdapter` calls this mock directly via a protected method
//    override — no module mock or hoisting needed.
const { createTextModelAdapterMock } = getRouterTestMocks();

// 2. Wire the provider adapter into the factory mock for this test file.
createTextModelAdapterMock.mockImplementation(async (params) => {
  const { AnthropicMessageAdapter } = await import('../adapters/anthropic-message');
  // or: InternalStreamGoogleAIStudioGeminiAdapter, OpenAICompatibleInternalStreamAdapter, etc.

  // Spread endpoint so the adapter inherits all fields,
  // then override what's needed (e.g. supports_reasoning).
  const endpoint = { ...params.endpoint, supports_reasoning: true };
  return ok(
    await createMockAdapterFromEndpoint(endpoint, {
      BaseClass: AnthropicMessageAdapter,   // <-- the key: provider adapter
      mockPayload: toSSEPayload(myFixture),
      rawRequest: params.rawRequestBody,
      pluginPrefs: params.pluginPrefs,
      context: params.context,
      headers: params.requestHeaders,
      options: params.options,
    }),
  );
});

// 3. Load mock-router last so any other vi.doMock calls in the file (e.g.
//    web-search clients, helper-fetch) take effect before router/index.ts
//    is evaluated.
const { createMockRouter } = await import('../mocks/mock-router');
```

Then in the test body:

```ts
it('transforms <fixture> through Chat Completions skin', async () => {
  const request = createMockRawRequest({
    model: Model.<ModelEnum>,
    stream: true,
    input: { messages: [{ role: 'user', content: '...' }] },
  });

  const router = await createMockRouter({
    request,
    endpoints: [
      createMockModelEndpoint(Model.<ModelEnum>, {
        endpointOverrides: { supports_reasoning: true },
      }),
    ],
    shouldInit: true,
  });

  const edgeStream = createOpenAIChatCompletionsEdgeStream({
    generationId: router.generationID,
    normalizedRequest: router.normalizedRequest,
    disableStalling: true,
  });

  const resultPromise = router.submit(edgeStream);
  const text = await decodeTextStream(edgeStream.readable);
  const result = await resultPromise;

  assertOk(result);
  expect(text).toMatchSnapshot();
});
```

Adapter-level `internal-stream.test.ts` files use `loadSseFixture` from
`packages/router/adapters/internal-stream-test-utils.ts` instead. It returns
a one-shot `ReadableStream`, so a `FixtureScenario` object cannot be shared
between two `it` blocks — build it through a factory per use, or the second
run fails with "Body object should not be disturbed or locked".

To snapshot the **non-stream** renderer, set `stream: false` on the
OpenRouter request but keep feeding the adapter the SSE fixture via
`toSSEPayload(...)`. `InternalStream*` adapters always consume upstream SSE
regardless of the outer request mode, so a raw JSON body as `mockPayload`
never completes and the test hangs until its timeout (see
`packages/router/tests/anthropic-fable-refusal-fixtures.test.ts`).

**Error-body fixtures** (refused calls that never produce a stream): commit the verbatim upstream JSON error as `<name>-rejection.json` and import it statically — no `getSseFromTxtFile`, no `index.ts` helper. Serve it by subclassing the provider adapter inside the test and overriding `_internalFetch()` to return `new Response(JSON.stringify(fixture), {status, headers: {'content-type': 'application/json'}})`, then pass `shouldOverrideFetch: false` to `createMockCreatedAdapterFromEndpoint` so the real `transformRequest` still runs while every upstream call returns the captured refusal. Failed submits never close the edge stream: drain `edgeStream.readable` through an owned reader and `reader.cancel()` after `router.submit` resolves, or the test hangs. Assert with `assertErr(result)` then snapshot `result.error`; for ownership decisions also check `result.error.internal[ERROR_OWNERSHIP_CAUSE_KEY]`. Reference: `packages/router/tests/novita-response-format-rejection-fixture.test.ts`, `groq-json-tools-rejection-fixture.test.ts`.

---

## Step 4 — Generate the snapshot

Only use `--update-snapshots` when:

1. **Creating brand-new tests** — no snapshot exists yet
2. **Intentionally updating** an existing snapshot in a
   non-breaking way (e.g. a new field was added to the
   output format)

Never blindly run `--update-snapshots` on failing tests — a snapshot
mismatch means the output changed, which may be a real
regression. Inspect the diff first.

```bash
cd packages/router && bun test tests/response-plugins-<name>.test.ts --update-snapshots
```

Then verify the snapshot contains expected content:

```bash
grep "reasoning_details\|reasoning\|thinking" \
  tests/__snapshots__/response-plugins-<name>.test.ts.snap
```

---

## Why this pattern works (no module mock needed)

`MockRouter` overrides the protected `createAdapter` method on the `Router`
class and delegates to a shared `createTextModelAdapterMock` (returned by
`getRouterTestMocks()`). `Router.submit` calls `this.createAdapter(...)`
internally, so swapping the mock implementation is sufficient — no
`vi.mock('../adapters/adapter-factory')` and no hoisting is required.

If the test file _does_ need to mock other modules with side-effecting static
imports (e.g. `'@openrouter-monorepo/helpers/fetch'` or web-search clients),
declare those `vi.doMock(...)` calls **before** the dynamic
`await import('../mocks/mock-router')` so the mocks are in place when
`router/index.ts` is first evaluated.

---

## Adapter class reference

| Provider | BaseClass |
|---|---|
| Anthropic | `AnthropicMessageAdapter` from `../adapters/anthropic-message` |
| Google Gemini (AI Studio) | `InternalStreamGoogleAIStudioGeminiAdapter` from `../adapters/google-ai-studio/internal-stream-gemini` |
| Google Gemini (Vertex) | `InternalStreamGoogleVertexGeminiAdapter` from `../adapters/google-vertex/internal-stream-gemini` |
| Google Interactions (AI Studio) | `InternalStreamGoogleAIStudioInteractionsAdapter` from `../adapters/google-ai-studio/internal-stream-interactions` |
| Google Interactions (Vertex) | `InternalStreamGoogleVertexInteractionsAdapter` from `../adapters/google-vertex/internal-stream-interactions` |
| OpenAI / default | `OpenAICompatibleInternalStreamAdapter` from `../adapters/openai/internal-stream-adapter` (default, no override needed) |
| xAI | `InternalStreamXAIResponsesAdapter` from `../adapters/x-ai-responses/internal-stream` |

## Async (polling) adapters

Video adapters under `packages/video-generation/adapters/` do not go through
`router.submit`. Capture the raw submit body and the raw *terminal* poll body
as `<name>.submit.json` / `<name>.poll.json`, plus `<name>.poll.http.json`
with the poll's HTTP status, because a provider can report a terminal
outcome on a non-2xx poll (xAI answers a moderation rejection with a 400
body that still carries `usage.cost_in_usd_ticks`). The snapshot test reads
the fixture with `readFileSync(new URL(name, FIXTURES_DIR))`, serves it from
a mocked `globalThis.fetch` with that status, and snapshots
`adapter.checkStatus(...)` plus `adapter.skuItems` — see
`packages/video-generation/adapters/x-ai-video/index.test.ts` and
`fixtures/scripts/collect-xai-video.ts`. Every scenario renders a real
video, so each collection run is billed.

## Examples

See:
- `packages/router/tests/anthropic-output-config.test.ts` — canonical adapter
  swap pattern
- `packages/router/tests/response-plugins-reasoning-anthropic.test.ts` —
  Anthropic thinking fixture snapshot
- `packages/router/tests/response-plugins-reasoning-gemini.test.ts` — Gemini
  thinking fixture snapshot
- `fixtures/scripts/collect-anthropic-reasoning.ts` — fixture collection script
