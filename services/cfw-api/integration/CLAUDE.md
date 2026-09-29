# Integration tests for cfw-api

These tests run in the real workerd runtime via miniflare, hitting
real Postgres and KV while mocking only external
services (Clerk, Spanner, rate limiters). Spanner is
mocked here because cfw-api uses it as an external
usage-record store, not as the DB under test. Tests of
Spanner queries themselves (in
`services/usage-record/integration/spanner/`) must
hit the real Spanner emulator — never mock the DB
layer.

## Infrastructure

- **Framework**: vitest + `@cloudflare/vitest-pool-workers`
  (workerd runtime, NOT bun)
- **Config**: `vitest.integration.config.mts` per service
- **Setup**: `integration/vitest.setup.mts` per service
- **Location**: `services/<svc>/integration/` directory,
  organized by feature (NOT colocated with source)

- **Run**: `bun run test:integration` from the service dir
- **Timeout**: 30 seconds per test

Other cfw-* services (e.g. `cfw-video-api`) use different patterns —
consult their `vitest.*.config.mts` directly.

## Fetch pattern

Use `SELF.fetch()` from `cloudflare:test` so requests
go through the full workerd handler and `c.env` is
populated with real Cloudflare bindings.

```typescript
// BAD — bypasses workerd, c.env is empty
import { app } from '@/index';
const res = await app.request('/api/v1/models');

// GOOD — full workerd request pipeline
import { env, SELF } from 'cloudflare:test';
const res = await SELF.fetch(
  'http://localhost/api/v1/models',
);
```

## Mocking philosophy

Only mock **external services** that cannot run in
the miniflare test environment:

- Clerk auth (`@openrouter-monorepo/clients/clerk/hono-middleware`)
- Cloudflare Cache API (`openCloudflareCache`)
- Spanner (`getUsageRecordService`)
- Rate limiters (`checkRateLimits`, `checkIPRateLimit`)
- Durable Objects (`KVCacheController`)
- `configurePrecompiledZodGuards` from
  `@openrouter-monorepo/lib-zod` — the
  positional guard order only applies to the full
  production graph, so this must be a no-op
- `FetchDeduper` from
  `@openrouter-monorepo/cache/fetch-deduper` — use a
  pass-through implementation so the real KV read
  path (`cfGlobalRouterConfigCache`) is exercised;
  do NOT stub it out completely

Do **NOT** mock:

- Core business logic or use-cases
- Database queries (hit real Postgres for cfw-api;
  Spanner query tests use the Spanner emulator)
- KV reads (seed fixture data instead)

Centralize shared mocks in `vitest.setup.mts`.
Individual tests override per-test with
`vi.mocked(fn).mockResolvedValueOnce(...)`.

```typescript
// vitest.setup.mts — default unauthenticated state
vi.mock('@/auth/get-user', () => ({
  getUser: vi.fn().mockResolvedValue(
    errT({
      location: 'test',
      rawError: 'No auth',
      status: HTTPStatus.S401_Unauthorized,
    }),
  ),
}));

// individual test — override for authenticated state
vi.mocked(getUser).mockResolvedValueOnce(
  ok({
    user: mockUser,
    userProviderAPIKeys: [],
    usesCookie: false,
  } satisfies MakeUserContextOpts),
);
```

Always call `vi.clearAllMocks()` in `beforeEach`.
Note: `clearAllMocks` resets call history but does
**not** flush unconsumed `mockResolvedValueOnce`
queues. If a test sets an auth override but exits
before the mock is called (e.g. rate limiter fires
first), the queued value leaks into the next test.
Watch for this when debugging flaky auth behavior.

## Auth mocking patterns

Four auth paths, each with its own mock:

- **Bearer**: `getUser` from `@/auth/get-user`
- **Cookie**: `getUserIdFromCookie` from
  `@/auth/get-user-id-from-cookie`
- **Cookie**: `getUserFromCookie` from
  `@/auth/get-user-from-cookie`
- **Management key**: `getAuthedManagementKey` from
  `@/auth/utils`

Do NOT add dummy cookie headers to `SELF.fetch()`
calls — auth is fully mocked so headers have no
effect.

## KV seeding

Seed KV with fixture data in `beforeAll`, do not
mock the `@/kv` module.

```typescript
import { seedKVRouterConfig } from
  '../helpers/seed-kv';

beforeAll(async () => {
  await seedKVRouterConfig(
    env.KV_MODELS_AND_ENDPOINTS,
  );
});
```

Type fixtures with `satisfies` for compile-time
validation:

```typescript
const FIXTURE_MODEL = {
  slug: 'openai/gpt-4o-mini',
  // ...
} satisfies ModelInfo;
```

Add a separate `describe` block without KV seeding
**placed before** the seeded `describe` to document
failure behavior when KV is empty. Miniflare KV is
shared across the entire test file — seeding in one
`beforeAll` affects all later `describe` blocks.

## Response assertions

### Happy path

Parse with the **production Zod schema**, then assert
fields:

```typescript
// BAD — any shape passes
const parsed = parseSchema(
  z.array(z.unknown()),
  await res.json(),
);

// GOOD — uses the real response schema
import { ModelsListResponseSchema } from
  '@/routes/models/schemas';

const parsed = parseSchema(
  ModelsListResponseSchema,
  await res.json(),
);
assertOk(parsed);
expect(parsed.data.data.length).toBeGreaterThan(0);
```

### Error path

Assert **both** HTTP status **and** response body.
Status-only checks hide regressions:

```typescript
// BAD — status-only, body unchecked
expect(res.status).toBe(401);

// GOOD — status + body validation
expect(res.status).toBe(
  HTTPStatus.S401_Unauthorized,
);
const body = parseSchema(
  honoErrorSchema,
  await res.json(),
);
assertOk(body);
expect(body.data.error.code).toBe(
  HTTPStatus.S401_Unauthorized,
);
```

Define `honoErrorSchema` (`{ error: { message, code } }`)
once at module level.

### Optional properties

Use `assert(result.data)` for type narrowing, never `!`
non-null assertions or `toBeDefined()` followed by `!`.

## Test data setup

### Isolation

Use `Date.now()` nonce for all generated IDs:

```typescript
const nonce = Date.now();
const testUserId = `user_int_byok_${nonce}`;
```

### DB helpers

Use existing helpers instead of raw SQL/Kysely:

```typescript
// BAD — raw insert
await db.insertInto('users').values({...}).execute();

// GOOD — existing helper
import { createTestUser } from
  '@openrouter-monorepo/db/integration/...';
await createTestUser(testUserId);
```

### Lifecycle

- All setup in `beforeAll`, never inside `it` blocks
- `Date.now()` nonces for unique IDs avoid the need
  for teardown in most cases
- When strict isolation requires teardown, use
  `afterAll` with children before parents (FK order)
- Wrap setup Results with `assertOk()` — never
  silently swallow failures

### CRUD test ordering

For create/list/get/update/delete flows, share state
via `let createdId: string | undefined` and guard
dependent steps:

```typescript
// BAD — silently passes if create didn't run
if (!createdId) {
  return;
}

// GOOD — fails loudly
if (!createdId) {
  throw new Error(
    'Expected createdId from the create step',
  );
}
```

## Banned patterns

- `z.unknown()` for top-level response envelopes
  (use production schemas; `z.unknown()` is acceptable
  only for nested fields with no exported schema)
- Status-only assertions without body checks
- `sleep()` / arbitrary delays in tests
- Accepting `500` as a valid response status
- Mocking business logic, use-cases, or DB queries
- Raw DB inserts when test helpers exist
- Dummy `cookie` headers in `SELF.fetch()` calls
- Redundant tests querying the same data multiple
  times (consolidate into one test)
- `app.request()` instead of `SELF.fetch()`
