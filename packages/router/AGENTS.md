# Router Agent Guidelines

The router and its adapters run on every inference request. Code here
is hot-path: allocation and retention mistakes multiply across the
whole fleet.

## Memory Retention

- **Avoid instance-level references to request bodies or response
  data.** Adapters and the Router live for the full duration of a
  request (and across endpoint fallback attempts). A class field
  holding a request body, a transformed/serialized upstream request,
  or response data retains that payload — including base64
  image/audio blobs — until the object is collected, long after the
  last read.
- **Thread data explicitly instead.** Build the value in the method
  that creates it and pass it as a parameter to the consumers that
  need it (e.g. `fetch()` builds the upstream request and threads it
  into `captureFetchError()` / `_transformEventStream()`). Scope
  references to the narrowest lifecycle window; if a closure needs the
  value once (e.g. a debug echo on stream start), hold it in a
  mutable local and clear it after use.
- **Derived values should be computed eagerly and the source
  dropped.** If a field only exists so a derived number/summary can be
  computed later (e.g. a flattened prompt string kept for token
  counting), compute the result up front and retain only the result.

## Hot-path Allocations

- **Do not allocate a wrapper object only to satisfy `max-params` in a
  per-chunk or per-token loop.** Reuse an existing request-scoped
  context when one is available. Otherwise, keep the direct parameters
  and add a narrow `oxlint-disable-next-line max-params` comment that
  names the repeated allocation being avoided.

## Router Latency

- **Update the coverage map when you change what router latency
  measures.** A change that adds, moves or removes an own phase or an
  excluded interval, moves the first-dispatch stamp, or changes where
  `compute()` runs must update `docs/router-latency-coverage.html` in
  the same PR. The same applies to a new awaited pre-dispatch step. See
  `packages/instrumentation/router-latency-v2/AGENTS.md` for the
  procedure.

## Fixtures

Fixtures and snapshots pair up: the **fixture** is the input (a
captured raw upstream provider payload in `fixtures/<provider>/`),
and the **snapshot** is the expected output (the recorded result of
piping that fixture through `router.submit` via `toMatchSnapshot()`).
The fixture pins what the provider actually sends; the snapshot pins
what OpenRouter emits for it. See `fixtures/AGENTS.md`.

- **Ship raw upstream fixtures with upstream-response-behavior
  changes.** Any PR that adds or changes an adapter response
  transform, a skin stream/non-stream handler, or parsing of a new
  upstream field, event type, or API param (reasoning params,
  caching, service tiers, refusals, new stream events, etc.) must
  include a captured raw upstream fixture in `fixtures/<provider>/`
  plus a snapshot test that pipes it through `router.submit`. Follow
  the `create-fixtures` skill
  (`.agents/skills/create-fixtures/SKILL.md`) for the collection
  script, registration, and adapter-swap test pattern.
- **Fixtures must be the raw upstream format** the adapter receives
  (provider-native SSE/JSON), not the transformed OpenRouter output,
  and not a synthetic payload hand-written from vendor docs.
- **Never fabricate or hand-edit fixtures** — including copying an
  existing fixture and splicing in expected fields. Every fixture
  must be a verbatim capture from a live provider API call; if the
  behavior can't be triggered live, say so in the PR instead.
- **Not required for** changes that never touch upstream response
  payloads: request-only transforms (reshaping the outgoing request
  body, covered by unit tests on `transformRequest`), pure
  routing/filtering logic, pricing metadata, model ID enums and
  aliases, provider configs, or refactors covered by existing
  fixture snapshots.

## OpenAPI schemas

Zod schemas in `skins/` that contribute to the OpenAPI spec (together with
those in `services/cfw-api/src/routes/`) have to survive Speakeasy's SDK
generation, so shape them for the generator rather than only for runtime
validation.

- **Name every schema** used in a route request or response body with
  `.openapi('PascalCaseName')`, and extract inline `z.object()` out of
  `createRoute()` into a named constant. Anonymous inline objects generate
  duplicate schemas in the spec.
- **Add a `description` and an `example`** to each `.openapi()` call.
- **Add discriminator mappings** to discriminated unions, mapping each
  variant value to its `#/components/schemas/<Name>` ref.
- **Use `.nullable()`**, not `z.union([schema, z.null()])`. The union form
  generates `oneOf` without a discriminator, which Speakeasy cannot resolve
  cleanly.
- **Use `zInt()` or `zDouble()`** instead of bare `z.number()`. A bare
  `z.number()` carries no format and generates `float64` in Go for every
  numeric field. Enforced by the `openrouter/require-typed-zod-number`
  oxlint rule.
- **Verify with `bun run generate:openapi`.** The final output line reports
  warning and hint counts, and both should be zero.

## Test isolation

The suite runs as a few shared-process shards
(`scripts/bun-test-sharded.ts`), not one process per file. Only files
that install module mocks, or carry a `@bun-test-isolate` comment because
they drive a module-level singleton, get their own registry. Anything a test file
installs on a global therefore outlives it and lands on the next file
in that shard, so global state must be scoped to the file that sets it.

- **Restore every global stub in `afterAll` / `afterEach`.** `spyOn`
  is not auto-restored. Capture the handle and restore it:

  ```typescript
  const randomUUIDSpy = spyOn(globalThis.crypto, 'randomUUID')
    .mockImplementation(() => 'fixed');

  afterAll(() => {
    randomUUIDSpy.mockRestore();
  });
  ```

  This applies to `globalThis.fetch`, `crypto.randomUUID`,
  `Math.random`, `getRandomId`, and any module export you spy on.

- **Never freeze the clock at module scope.** `setSystemTime(...)` on
  a bare line leaks a frozen clock into every later file in the shard,
  and a timer-driven retry there waits forever. Pin it in `beforeAll`
  and release it in `afterAll` with a bare `setSystemTime()`.

- **Reset the shared router mocks.** Any file using
  `getRouterTestMocks()` or `setMockPayload()` must call
  `resetRouterTestMocks()` in `beforeEach`; those mocks are
  process-wide singletons and otherwise inherit the previous file's
  `mockImplementation` and queued `*Once` values.

- **Do not pin a global in a shared helper's module body.** `spyOn`
  over an existing spy replaces the implementation, so whichever
  importer's module body runs last owns the global and the helper's
  own reset stops working. Re-claim it per test instead — see
  `pinDeterministicIds()` in
  `tests/openai-responses-fixtures/fixture-suite.ts`.

A leak is invisible when a file runs alone, so check a new test file
against its neighbours rather than on its own:

```bash
BUN_TEST_NO_CONCURRENT=1 bun test ./some-earlier-file.test.ts ./your-new-file.test.ts
```
