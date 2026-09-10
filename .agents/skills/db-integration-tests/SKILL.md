---
name: db-integration-tests
description: >-
  How to write DB integration tests for packages/db using bun:test
  and Kysely against a real local PostgreSQL instance. Covers test
  structure, DB context setup, test data isolation, fixture
  builders, coverage verification, and banned patterns.
user-invocable: false
---

# DB integration tests for packages/db

DB integration tests run against a real local PostgreSQL
instance (plain Postgres in Docker) using Kysely. They
validate query logic, FK constraints, and data
transformations without mocking the database layer.

**All queries must use Kysely** (`dbRead` / `dbWrite`
or `createDBRequestContextForIntegrationTest()`).

## Location & framework

- **Framework**: `bun:test` (NOT vitest)
- **Location**: `packages/db/integration/<domain>/`
- **Run**: `cd packages/db && bun run test:integration`
- **Focused runs**: pass Bun filters through that script (for
  example, `bun run test:integration -- --test-name-pattern='...'`);
  a file path appended to the package script is not focused because
  the script already supplies `./integration`; for one file, invoke
  `bun test <path>` with the same preload and integration environment
  explicitly. Invoking `bun test` directly omits the preload and can fail with
  `database context not initialized`
- **Requires**: running Postgres instance (via Tilt or
  `bun run db:start`)
- **Preload**: `integration/preload-integration.ts` —
  sets `OR_ENV=test`, loads env overrides, and calls
  `setupDbIntegrationContext()`
- **Timeout**: 30 seconds per test
- **CI**: `ci-postgres.yaml`, triggered by changes to
  `packages/db/**` or `postgres/**`
- **Coverage**: `cd packages/db && bun run test:integration:coverage`
  — runs the same suite with `--coverage` and writes
  results to `packages/db/coverage/`

## Verifying coverage after writing tests

**Always run the coverage script** after writing or
modifying integration tests to confirm that every
exported query function is covered:

```bash
cd packages/db && bun run test:integration:coverage
```

This produces two outputs in `packages/db/coverage/`:
- **text** — console summary with per-file line/branch %
- **lcov.info** — line-level detail for each source file

If unrelated full-suite fixtures are blocked by a local schema mismatch, run the focused file with the same preload and coverage flags and report the broader-suite blocker.

### How to check for untested query functions

1. Open `coverage/lcov.info` and search for the query
   file you are testing (e.g. `SF:users/queries.ts`).
   Each `FN:` / `FNDA:` pair shows whether a function
   was executed. `FNDA:0,<name>` means the function
   was never called — it needs a test.

2. Alternatively, read the console text output: files
   with less than 100% line coverage list the uncovered
   line ranges. Cross-reference those lines with
   exported functions in the source file.

3. Bun coverage only instruments files that are
   actually imported during the test run. If a query
   file does not appear in the report at all, it means
   no integration test imports it — add a test file
   that imports and exercises its exported functions.

### What to do with the results

- Every exported query function in a `queries.ts` or
  `write-queries.ts` file should have at least one
  integration test that calls it and asserts on the
  result.
- If you find untested functions, add tests following
  the template and patterns in this rule.
- Do not consider the task complete until the coverage
  report shows all exported query functions in the
  domain you touched have been exercised.

> **Scope:** These conventions also apply to other
> packages that share the same DB integration
> infrastructure: `packages/guardrails`,
> `packages/orgs`, `packages/achievements`,
> `packages/backfill`, and `packages/script-utils`.
> Each has its own `preload-integration.ts` that calls
> `setupDbIntegrationContext()` from `packages/db`.

## File structure

```text
packages/db/integration/
  <domain>/
    queries.test.ts        # read query tests
    write-queries.test.ts  # write query tests (if separate)
    utils.ts               # domain-specific test helpers
  helpers.ts               # shared test utilities
  setup-db-context.ts      # DB context initialization
  preload-integration.ts   # preload script
  README.md
```

**Read vs write separation:** Keep read query tests
(e.g. `getKeysById`, `getKey`) in `queries.test.ts`
and write/mutation tests (e.g. `createKey`, `updateKey`)
in `write-queries.test.ts`. Do not mix read query
function tests into write test files or vice-versa.

Test files import from source via relative paths
(e.g. `../../api-keys/queries`). Helper/utility files
live alongside test files in the domain directory.

## Test template

```typescript
import { afterAll, beforeAll, describe, expect, it }
  from 'bun:test';
import type { Result }
  from '@openrouter-monorepo/type-utils/result-monad';
import { assertOk, assertErr, isErr }
  from '@openrouter-monorepo/type-utils/result-monad';
import { dbRead, dbWrite } from '../../context';

describe('<domain> queries', () => {
  const nonce = Math.floor(Math.random() * 1e6);

  // Setup: create test data
  beforeAll(async () => {
    // Insert test fixtures using query functions
    // or dbWrite directly
  });

  // Teardown: collect results so every resource
  // gets cleaned up even if one step fails, then
  // aggregate errors at the bottom
  afterAll(async () => {
    const results: Result<unknown, unknown>[] = [];
    // Delete in reverse dependency order
    results.push(
      await dbWrite('test.teardown', (q) =>
        q.deleteFrom('table')
          .where('id', 'in', testIds)
          .execute(),
      ),
    );
    const errors = results
      .filter(isErr)
      .map((r) => r.error);
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        'afterAll cleanup failures',
      );
    }
  });

  it('should insert correctly', async () => {
    const result = await insertThing({...});
    assertOk(result);
    expect(result.data).toMatchObject({...});
  });

  it('should handle not-found', async () => {
    const result = await getThingById('nonexistent');
    // Either assertErr for error results:
    assertErr(result);
    // Or check for null returns:
    assertOk(result);
    expect(result.data).toBeNull();
  });
});
```

## DB context — Kysely only

Use `dbRead` / `dbWrite` from
`@openrouter-monorepo/db/context` for queries. For
direct DB access in setup/teardown, use
`createDBRequestContextForIntegrationTest()`:

```typescript
import { dbRead, dbWrite } from '../../context';
import {
  createDBRequestContextForIntegrationTest,
} from '../../replica-routing/integration';

// Query functions use dbRead/dbWrite (preferred)
const result = await dbWrite(
  'test.setup.createUser',
  (q) => q.insertInto('users').values({...}).execute(),
);

// Direct context for setup/teardown
const db =
  await createDBRequestContextForIntegrationTest();
await db.write((q) =>
  q.insertInto('users').values({...}).execute(),
);
```

## No mocking

Do **NOT** mock database queries or the DB context.
Tests hit the real local PostgreSQL database. Mock
factories (`createMockDbModel`, `createMockDBProvider`,
etc.) are for constructing valid insert payloads —
they do not replace real DB operations.

**Creating new mock-based DB tests is prohibited in
all circumstances — including for Spanner.** Any new
test of a DB query or DB call must be an integration
test against a real database:

- **Postgres** — this suite (real local Postgres)
- **Spanner** — the Spanner emulator suite in
  `services/usage-record/integration/spanner/`

Mocking `dbRead`/`dbWrite`, Kysely, the Spanner
client, or module-mocking a `queries.ts` file proves
nothing about the SQL that actually runs and rots
silently as the schema changes.

When you touch a file that has existing mock-based DB
"coverage", convert those tests to integration tests
where possible, or delete them if an integration test
already covers the behavior. Never extend a
mock-based DB test with new cases — write the new
case as an integration test.

## Test data isolation

Use `Math.floor(Math.random() * 1e6)` nonces for
unique test data to avoid collisions across parallel
runs:

```typescript
const nonce = Math.floor(Math.random() * 1e6);
const testUserId =
  `user_integration_myfeature_${nonce}`;
```

Use descriptive prefixes that identify the test domain
(e.g. `user_queries_ban_`, `org_guardrails_`).

## Key patterns

- Use `assertOk(result)` / `assertErr(result)` —
  NOT `expect(isOk(result)).toBe(true)`
- Use `toMatchObject` for partial matching
- Test CRUD in order: insert -> get -> update -> list
  -> delete, sharing state via describe-scoped
  variables
- Guard dependent steps with throws, not silent returns
- All setup in `beforeAll`, never inside `it` blocks
- Wrap setup Results with `assertOk()` — never
  silently swallow failures
- Use `onConflict` upserts for setup inserts to handle
  reruns gracefully
- A `duplicate key value violates unique constraint
  "<table>_pkey"` failure on a plain insert usually
  means the local table's id sequence lags `max(id)`
  (seed/manual inserts with explicit ids). Fix with
  `setval('<seq>', (select max(id) from <table>))` and
  rerun — note some sequences keep legacy names (the
  `tags` pkey/sequence are named `categories_*`)

## Fixture lifecycle (mandatory)

DB fixtures (`insertApp`, `insertModel`, `createTestUser`,
direct `dbWrite` inserts, etc.) MUST be created in
`beforeAll` and torn down in `afterAll`. They MUST NOT be
inserted inside an `it` block.

- The fixture is the precondition the test relies on. It is
  not the system-under-test (SUT) call.
- The SUT call (e.g. the function whose behavior the test is
  pinning) stays inside `it`. Only the rows it depends on
  move to `beforeAll`.
- Every fixture row inserted in `beforeAll` MUST be tracked
  in a describe-scoped array (or single `let` for one-off
  fixtures) and cleaned up in `afterAll`. No exceptions —
  even tests that "delete the row as part of setup" must
  still register a defensive cleanup so the suite never
  leaks rows when the test errors mid-execution.
- When a single test needs a unique fixture distinct from
  the rest of the suite, wrap it in a nested `describe` with
  its own `beforeAll` / `afterAll`. Do not piggy-back on the
  outer scope's `createdAppIds` / cleanup if the fixture's
  invariants are local.
- For fixtures whose behavior depends on recency, set `updated_at`
  explicitly in the insert. A `BEFORE UPDATE` timestamp trigger can
  otherwise make a row appear newly changed even when `created_at` is old.

### Counter-example — DO NOT do this

```typescript
it('should err when the row was deleted between read and update', async () => {
  const seed = await insertApp({ ... }, testCreatorId); // ❌ fixture in test body
  assertOk(seed);
  const db = await createDBRequestContextForIntegrationTest();
  await db.write((q) => q.deleteFrom('apps').where('id', '=', seed.data.id).execute());

  const result = await updateIfAllowed(seed.data, { ... }, {
    clerkUserId: testCreatorId,
  });
  assertErr(result);
});
```

### Correct — fixture in `beforeAll`, SUT call in `it`

```typescript
describe('with a row deleted between read and update', () => {
  let snapshot: AppForGenerations;

  beforeAll(async () => {
    const seed = await insertApp({ ... }, testCreatorId);
    assertOk(seed);
    snapshot = seed.data;

    const db = await createDBRequestContextForIntegrationTest();
    const deleted = await db.write((q) =>
      q.deleteFrom('apps').where('id', '=', snapshot.id).execute(),
    );
    assertOk(deleted);
  });

  afterAll(async () => {
    const db = await createDBRequestContextForIntegrationTest();
    const cleanup = await db.write((q) =>
      q.deleteFrom('apps').where('id', '=', snapshot.id).execute(),
    );
    assertOk(cleanup); // dbWrite returns ok even when 0 rows match
  });

  it('should err (not throw) when updateIfAllowed targets a row that no longer exists', async () => {
    const result = await updateIfAllowed(
      snapshot,
      { referrerUrl: snapshot.origin_url, referrerTitle: 'Renamed' },
      { clerkUserId: testCreatorId },
    );
    assertErr(result);
    expect(result.error).toBe('App update failed');
  });
});
```

### CRUD test ordering

For create/list/get/update/delete flows, share state
via `let` and guard dependent steps loudly:

```typescript
let createdId: string | undefined;

it('should create', async () => {
  const result = await createItem(input);
  assertOk(result);
  createdId = result.data.id;
});

it('should get by id', async () => {
  if (!createdId) {
    throw new Error(
      'Expected createdId from create step',
    );
  }
  const result = await getItemById(createdId);
  assertOk(result);
});
```

## Test helpers

Reuse existing helpers instead of writing raw inserts:

- `createTestUser(userId)` — from
  `../auth/utils` or domain-specific `utils.ts`
- `createTestOrganization(orgId)` — ensures
  `is_organization: true`
- `createTestApiKeyWithHash(entityId, hash)` — from
  `../auth/utils`
- `createTestMembership({orgId, userId, membershipId})`
- `createTestGuardrail(entityId, name)` — from
  `../auth/utils` or `../guardrails/utils`

Check the domain's `utils.ts` or `helpers.ts` for
domain-specific helpers before writing new ones.

### setupTestEndpointStack

Creates a model + provider + endpoint chain for
endpoint-dependent tests:

```typescript
import {
  setupTestEndpointStack,
  cleanupTestEndpointStack,
} from '../helpers';

const stack = await setupTestEndpointStack({
  nonce,
  providerName: `test-provider-${nonce}`,
  permaslug: `test-author/test-model-${nonce}`,
});
// stack.endpointId, stack.providerName, stack.permaslug
```

Teardown (afterAll):

```typescript
await cleanupTestEndpointStack({
  endpointIds: [stack.endpointId],
  providerNames: [stack.providerName],
  permaslugs: [stack.permaslug],
});
```

### Fixture builders (currently named "mock factories")

Despite the `createMock*` naming, these are **fixture
builders** — they produce real insert payloads, not
test doubles. The `createMock*` prefix is a legacy
misnomer and will be renamed to `createFixture*`.

Use fixture builders with `overrides` for compile-time
validated insert data — this avoids repeating
boilerplate for required fields across tests:

```typescript
import { createMockDbModel } from '../../models/mock';
import {
  createMockDBProvider,
} from '../../providers/mock';

const model = createMockDbModel({
  permaslug: `author/test-model-${nonce}`,
  slug: `author/test-model-${nonce}`,
});
```

## Test quality

- Confirm each test would fail if the query were
  broken (e.g. return wrong columns, miss a WHERE
  clause)
- Confirm individual tests pass in isolation, not
  only as part of the full suite
- Assert that the specific entity under test is the
  one found/manipulated/deleted — don't rely on
  unrelated rows or empty-table behaviour
- For entities that support soft-deletion, test both
  soft-delete and that soft-deleted rows are excluded
  from normal queries
- When a query returns complex objects (e.g. JSON
  columns), add a dedicated test that verifies the
  complete shape via `toMatchObject`, in addition to
  individual property checks
- For queries that use `selectAll()`, add a dedicated
  response-shape test that asserts `Object.keys(row)
  .sort()` against a sorted array of expected column
  names. This catches accidental column omissions
  when a query is refactored.
- When a query accepts optional filter parameters
  (e.g. `workspaceId`, `includeNullWorkspaceId`),
  test all branches: without the filter (returns all),
  with the filter (returns only matching), and with
  any `includeNull` variant (returns matching OR
  null). These optional-filter paths are the most
  error-prone to get right in the Kysely expression
  builder.
- Some entities have audit-log triggers; use
  soft-delete for cleanup when hard-delete would
  violate trigger constraints

## Return types: `null` vs `undefined` for not-found

Kysely's `.executeTakeFirst()` returns `undefined`
when no row matches. Tests should assert
`toBeUndefined()` for not-found cases, not
`toBeNull()`.

## jsonb columns round-trip to parsed values

A value written to a `jsonb` column as
`JSON.stringify('active')` reads back as the parsed
JSON value (`'active'`), not the serialized string
(`'"active"'`). Assert against the parsed form.

## Banned patterns

- Don't use vitest — these are `bun:test`
- Don't mock DB queries — hit the real database
- Use Kysely (`dbRead` / `dbWrite` /
  `createDBRequestContextForIntegrationTest`) for all
  queries
- Don't use `any` types — use `unknown` or precise
  types
- Don't skip teardown for write tests
- Prefer `Math.floor(Math.random() * 1e6)` for nonces
  in new tests — it avoids collisions if tests ever run
  in parallel. Some existing tests use `Date.now()`;
  migrate them to random nonces when touching those files
- Don't silently swallow setup errors — always
  `assertOk` or throw on `isErr`
- In `afterAll` teardown, push every `dbWrite` result
  into a `Result<unknown, unknown>[]`, then filter
  with `isErr` and throw an `AggregateError` at the
  end — instead of `assertOk` per step. Fail-fast in
  teardown skips remaining cleanup and leaves test
  data in the shared DB. The `assertOk` rule targets
  `beforeAll` setup and test assertions, not teardown
- Don't guard assertions with `if (isOk(result))` —
  this silently passes when the result is an error.
  Use `assertOk(result)` which fails the test on error
- Prefer `assertOk(result)` to narrow Result types
  over `result.data!`. Use `!` only after an
  `expect(x).toBeDefined()` guard or when a
  deeply-nested optional field is guaranteed by the
  test's own setup
- Don't use raw SQL strings — use Kysely query builder
- Don't edit seed files (`postgres/seeds/`) — seeds
  are read-only
