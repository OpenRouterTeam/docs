---
name: writing-kysely-queries
description: >-
  Reference for writing correct, type-safe Kysely queries in
  the openrouter-web monorepo. Covers dbRead/dbWrite usage,
  single-row helpers, joins, offset and keyset pagination, JSON
  columns, transactions and locking, batching, query shape and
  cost, Hyperdrive-cached reads, conditional filters, error
  handling, aggregate types, and integration testing.
user-invocable: false
---

# Writing Kysely Queries

Reference for writing correct, type-safe Kysely queries using
`dbRead` / `dbWrite` from `@openrouter-monorepo/db/context`.
All database access in this codebase goes through Kysely —
there is no other query layer.

## Checklist for New Queries

1. Use [`dbWrite()`](#1-dbread--dbwrite-basics) for
   mutations, [`dbRead()`](#1-dbread--dbwrite-basics)
   for reads
2. [Scope every caller-supplied ID to its owner](#23-scope-every-row-to-its-owner)
   in the statement itself — never in a separate check
   before the query
3. [Add an integration test](#2-integration-testing) for
   every new exported query function
4. Choose the right primary-routing option
   ([§3](#3-primary-routing-primaryonly-vs-primarypreferred)):
   `primaryOnly` for correctness guards,
   `primaryPreferred` for read-after-write UX — always
   add a comment explaining why
5. Escape ILIKE input with
   [`escapeIlikeSearch()`](#8-ilike--text-search)
6. [`JSON.stringify()`](#14-jsonjsonb-column-writes) all
   JSON/JSONB column values before `.values()` / `.set()`
7. Use [`$if`](#5-conditional-filters-with-if) for
   conditional filters (not mutable `let query`)
8. Use
   [`<number>`](#12-aggregate-function-type-annotations)
   annotation on aggregate functions
   (`countAll`, `count`, `sum`, `avg`)
9. Compare `numUpdatedRows` / `numDeletedRows` with
   [`=== 0n`](#16-numupdatedrows--numdeletedrows-are-bigint)
   (bigint)
10. Wrap multi-step writes in
    [`sql.transaction().execute()`](#15-transactions) —
    add `.forUpdate()` on reads that drive writes
11. Do not use
    [`$castTo`](#20-do-not-use-castto) — fix schema
    types instead
12. [Bound every multi-row read](#24-query-shape--cost) with
    `.limit()`, or page it by
    [keyset](#keyset-pagination-for-deep-pages-and-full-table-walks)
    — and end every paginated `orderBy` with a unique column
13. [Return early on an empty ID list](#empty-in-lists) before
    building an `in` filter
14. [Batch by ID, never query in a loop](#n1-batch-by-id-instead-of-querying-in-a-loop);
    new getters take `ids[]`, not one `id`;
    [chunk multi-row writes](#chunk-multi-row-writes)
15. [No network calls inside a transaction](#keep-transactions-short);
    take multiple locks in a fixed order
16. [`useCachedConnection` reads stay `IMMUTABLE`](#25-hyperdrive-cached-reads-usecachedconnection):
    no `now()` / `random()` in the SQL, no `new Date()` /
    `Date.now()` / `Math.random()` as bind values

## Table of Contents

- [1. dbRead / dbWrite Basics](#1-dbread--dbwrite-basics)
- [2. Integration Testing](#2-integration-testing)
- [3. Primary Routing: primaryOnly vs primaryPreferred](#3-primary-routing-primaryonly-vs-primarypreferred)
- [4. Single-Row Queries](#4-single-row-queries)
- [5. Conditional Filters](#5-conditional-filters-with-if)
- [6. Reusable Filter Functions](#6-reusable-filter-functions)
- [7. OR Filters](#7-or-filters)
- [8. ILIKE / Text Search](#8-ilike--text-search)
- [9. Joins & Nested Objects](#9-joins--nested-objects-jsonobjectfrom)
- [10. CTEs (.with())](#10-ctes-with)
- [11. Pagination](#11-pagination)
- [12. Aggregate Function Types](#12-aggregate-function-type-annotations)
- [13. Upserts](#13-upserts)
- [14. JSON/JSONB Column Writes](#14-jsonjsonb-column-writes)
- [15. Transactions](#15-transactions)
- [16. bigint Comparisons](#16-numupdatedrows--numdeletedrows-are-bigint)
- [17. NULL-passing Logic](#17--true-null-passing-tri-valued-logic)
- [18. Error Handling](#18-error-handling)
- [19. Type Parsers](#19-type-parsers-supabasecompattypes)
- [20. Do Not Use $castTo](#20-do-not-use-castto)
- [21. Avoid Large Raw SQL](#21-avoid-large-raw-sql-blocks)
- [22. Shared Column Lists](#22-shared-column-lists)
- [23. Scope Every Row to Its Owner](#23-scope-every-row-to-its-owner)
- [24. Query Shape & Cost](#24-query-shape--cost)
- [25. Hyperdrive-Cached Reads](#25-hyperdrive-cached-reads-usecachedconnection)

---

## 1. `dbRead` / `dbWrite` Basics

```ts
import { dbRead, dbWrite } from '@openrouter-monorepo/db/context';
```

- **`dbRead(queryId, operation)`** — read queries (SELECT).
  Routes to a replica by default.
- **`dbRead(queryId, { primaryPreferred: true }, operation)`**
  — tries primary first, falls back to replicas on failure.
  Use for read-after-write UX (UI refetches after saves).
- **`dbRead(queryId, { primaryOnly: true }, operation)`** —
  primary only, no fallback. Use for correctness guards
  (caps, sanctions, uniqueness). See
  [§3](#3-primary-routing-primaryonly-vs-primarypreferred)
  for decision guidance.
- **`dbWrite(queryId, operation)`** — mutations (INSERT,
  UPDATE, DELETE). Always routes to primary.

Both return `AsyncResult<R, ErrorT>`. The `queryId` string is
attached as a SQL comment, visible in `pg_stat_activity` and
observability tools.

```ts
// Basic read — multi-row
return dbRead('db.listEndpoints', (sql) =>
  sql.selectFrom('endpoints')
    .selectAll()
    .where('deleted', '=', false)
    .execute()
);

// Basic write — insert with returning
return dbWrite('db.insertEndpoint', (sql) =>
  sql.insertInto('endpoints')
    .values(endpoint)
    .returningAll()
    .executeTakeFirstOrThrow()
);
```

---

## 2. Integration Testing

All new queries must have integration tests. See the
`db-integration-tests` skill for conventions.

Key points:

- Place under `packages/db/integration/<domain>/`
- Run against real Postgres with `BUN_INTEGRATION_TEST=1`
- Use `assertOk(result)` / `assertErr(result)` for Result
  assertions
- Use unique random identifiers to avoid parallel-run
  collisions
- Verify JSON shapes from `jsonObjectFrom` match expected
  structure
- Pin throw-vs-`err()` behavior on every error branch

---

## 3. Primary Routing: `primaryOnly` vs `primaryPreferred`

By default, `dbRead` routes to a weighted-random replica.
Two options override this to prefer or require the primary:

| Option | Behavior | Use when |
|--------|----------|----------|
| `primaryPreferred` | Try primary first, fall back to replicas on failure | Read-after-write freshness for **UX** — stale data from a replica is a minor glitch, not a correctness bug |
| `primaryOnly` | Primary only, **no fallback** — errors if primary is unreachable | Stale data would violate an invariant (caps, sanctions, uniqueness) |

If there is no preceding write in the same flow, prefer
the default replica routing (no option needed).

**Always add a comment explaining the justification.**

### When to use `primaryPreferred`

The query follows a write and the user expects to see
their change immediately, but serving slightly stale data
is harmless:

```ts
// primaryPreferred: read-after-write — the budget
// settings UI refetches immediately after upsert/delete
// mutations. Falls back to replica if primary is
// unavailable.
return dbRead(
  'db.listBudgetsByWorkspace',
  { primaryPreferred: true },
  (q) => // ...
);
```

Common valid reasons:

- **UI refetch after mutation** — list pages, detail pages,
  or forms that reload after a save.
- **Non-critical read-after-write** — e.g., refetching a
  user row after upsert to return fresh data in a response.

### When to use `primaryOnly`

The query guards a correctness invariant — stale data from
a replica could cause duplicates, bypass limits, or let a
blocked entity through:

```ts
// primaryOnly: replica lag would let a freshly-blocked
// user through.
const blocksResult = await getActiveBlocksForUser(
  clerkUserId,
  { primaryOnly: true },
);
```

```ts
/**
 * Pinned to primary (`primaryOnly: true`): callers run
 * this immediately before inserting a new user via
 * `upsertClerkUser`, and the free-allowance /
 * per-identifier-cap logic relies on a count that
 * reflects every committed write so far. A replica read
 * can lag behind primary writes and would let a newly
 * inserted user slip past the cap.
 */
export async function countUsersByIdentifierHash(
  // ...
) {
  return dbRead(
    'db.countUsersByIdentifierHash',
    { primaryOnly: true },
    (q) => // ...
  );
}
```

Common valid reasons:

- **Cap / uniqueness enforcement** — the count or lookup
  drives a subsequent write and a stale replica could allow
  duplicates or bypass limits.
- **Sanction / block checks** — security-critical reads
  where replica lag could let a blocked entity through.
- **Rate-limit counters** — e.g., promo code redemption
  counts that must reflect the absolute latest state.

### Decision rule

If you cannot articulate why replica lag would **violate a
correctness invariant** (not just annoy the user), use
`primaryPreferred` instead of `primaryOnly`. If there's no
preceding write at all, use neither — let the default
replica routing handle it.

---

## 4. Single-Row Queries

### `executeTakeFirst()` — zero or one row (no uniqueness assertion)

Use for primary-key lookups or unique-constrained columns
where duplicates are structurally impossible. If duplicates
are possible and would indicate a bug, use
`executeMaybeSingle()` (see below) instead.

```ts
return dbRead('db.getUserById', (sql) =>
  sql.selectFrom('users')
    .selectAll()
    .where('id', '=', userId)
    .executeTakeFirst()
);
// Returns T | undefined
```

### `executeTakeFirstOrThrow()` — exactly one row expected

Use when zero rows is an error but duplicates are impossible:

```ts
return dbRead('db.getCreditPool', (sql) =>
  sql.selectFrom('credit_pools')
    .selectAll()
    .where('id', '=', poolId)
    .executeTakeFirstOrThrow()
);
// On zero rows: returns Err with isNotFound: true
```

`executeTakeFirstOrThrow()` throws internally, but
`dbRead`/`dbWrite` catch it and return an err'd
`AsyncResult` — callers never see a thrown exception.
Use `isDBErrNotFound(result.error)` to detect the
not-found case.

### `executeMaybeSingle()` — zero or one, with duplicate detection

Use for invariant-enforcing reads where duplicates indicate a
bug (uniqueness not covered by a DB constraint). Import from
`packages/db/kysely-single.ts`:

```ts
import { executeMaybeSingle } from '../kysely-single';

return dbRead('db.getCredit', { primaryOnly: true }, (q) =>
  executeMaybeSingle(
    q.selectFrom('credits')
      .selectAll()
      .where('stripe_payment_intent_id', '=', paymentIntentId)
      .where('type', '=', type),
  ),
);
// Returns T | undefined — throws on multiple rows
```

### `executeSingle()` — exactly one, with duplicate detection

Use when both zero rows and multiple rows indicate bugs:

```ts
import { executeSingle } from '../kysely-single';

return dbRead('db.getCreditPool', (q) =>
  executeSingle(
    q.selectFrom('credit_pools')
      .selectAll()
      .where('id', '=', poolId),
  ),
);
// Returns T — throws on zero or multiple rows
```

### Writes with returning

For INSERT/UPDATE that return data, use
`.returningAll().executeTakeFirstOrThrow()` — the row count
is guaranteed by the write, so no duplicate guard is needed:

```ts
return dbWrite('db.insertEndpoint', (sql) =>
  sql.insertInto('endpoints')
    .values(endpoint)
    .returningAll()
    .executeTakeFirstOrThrow()
);
```

---

## 5. Conditional Filters with `$if`

**Always prefer `$if` over mutable `let query` + `if`
blocks.** Keeps queries fluent and immutable:

```ts
return q
  .selectFrom('promo_codes')
  .selectAll()
  .where('deleted', '=', false)
  .$if(!!params.searchQuery, (qb) =>
    qb.where(
      'code',
      'ilike',
      `%${escapeIlikeSearch(params.searchQuery!)}%`,
    ),
  )
  .$if(params.workspaceId !== undefined, (qb) =>
    qb.where('workspace_id', '=', params.workspaceId!),
  )
  .execute();
```

The `!` non-null assertion inside the callback is safe
because `$if` only invokes the callback when the condition
is truthy.

---

## 6. Reusable Filter Functions

Extract repeated filter logic into typed helper functions:

```ts
import type { SelectQueryBuilder } from 'kysely';
import type { TypedDatabase } from '../kysely';

function applyKeyFilters<O>(
  qb: SelectQueryBuilder<TypedDatabase, 'api_keys', O>,
  opts: KeyFilterOptions = {},
): SelectQueryBuilder<TypedDatabase, 'api_keys', O> {
  return qb
    .$if(!opts.shouldIncludeDeleted, (q) =>
      q.where('deleted', '!=', true),
    )
    .$if(!opts.shouldIncludeDisabled, (q) =>
      q.where('disabled', '!=', true),
    )
    .$if(!opts.shouldIncludeExpired, (q) =>
      q.where((eb) =>
        eb.or([
          eb('expires_at', 'is', null),
          eb('expires_at', '>', new Date().toISOString()),
        ]),
      ),
    );
}
```

---

## 7. OR Filters

```ts
return dbRead('db.listItems', (sql) =>
  sql.selectFrom('items')
    .selectAll()
    .where((eb) =>
      eb.or([
        eb('workspace_id', '=', workspaceId),
        eb('workspace_id', 'is', null),
      ]),
    )
    .execute(),
);
```

Kysely parameterizes automatically — no manual input
escaping needed for filter values (unlike raw SQL string
building).

---

## 8. ILIKE / Text Search

Always escape user-provided search input with
`escapeIlikeSearch`:

```ts
import { escapeIlikeSearch } from '../escape-ilike';

return dbRead('db.searchEndpoints', (sql) => {
  const escaped = escapeIlikeSearch(filters.search);
  return sql
    .selectFrom('endpoints')
    .selectAll()
    .where((eb) =>
      eb.or([
        eb('model_permaslug', 'ilike', `%${escaped}%`),
        eb('provider_model_id', 'ilike', `%${escaped}%`),
      ]),
    )
    .execute();
});
```

Neither Kysely nor Postgres auto-escape ILIKE wildcards
(`%`, `_`, `\`). Omitting this is an injection vector.

---

## 9. Joins & Nested Objects (`jsonObjectFrom`)

Use `jsonObjectFrom` from `'kysely/helpers/postgres'` for
nested JSON objects. Each call renders as a correlated SQL
subquery (not a JOIN), so result rows stay flat and
deduplicated. Prefer this over `innerJoin`/`leftJoin`
which flatten results and require manual deduplication.
A correlated subquery runs once per outer row, so on a wide
list query it costs one index lookup per row; that is fine
for single-row and small-page reads, but for large lists
prefer a `json_agg` join (below) or a flat `innerJoin`:

```ts
import { jsonObjectFrom } from 'kysely/helpers/postgres';

return dbRead('db.listModelsWithAuthors', async (sql) =>
  sql.selectFrom('models')
    // Always qualify selectAll — see §9a below
    .selectAll('models')
    .select((eb) => [
      jsonObjectFrom(
        eb.selectFrom('model_authors')
          .selectAll('model_authors')
          .whereRef(
            'model_authors.id',
            '=',
            'models.author_id',
          )
      ).as('model_authors'),
    ])
    .where('deleted', '=', false)
    .execute()
);
```

### §9a. `selectAll()` vs `selectAll('table')`

Bare `selectAll()` on a joined query pulls columns from
**all** tables in the FROM clause, producing ambiguous
column names and confusing typecheck errors. Always
qualify with the table name:

```ts
// BAD — ambiguous columns, broken types
sql.selectFrom('models')
  .innerJoin('providers', 'providers.id', 'models.pid')
  .selectAll() // columns from both tables

// GOOD — explicit table scope
sql.selectFrom('models')
  .innerJoin('providers', 'providers.id', 'models.pid')
  .selectAll('models') // only model columns
  .select(['providers.name as provider_name'])
```

### §9b. Prefer explicit column lists over `selectAll`

`selectAll()` ties the query's result type to the generated
schema types, which track migrations — and migrations apply
**before** the application code that depends on them ships.
When a column is dropped, every `selectAll()` on that table
changes shape at runtime with no compile-time signal, which
can break downstream consumers. Prefer an explicit
`select([...])` with a named column list, especially on tables
that change often or feed public API responses. For tables with
a shared list, define it once with a compile-time exhaustiveness
check (see `packages/db/api-keys/index.ts` `API_KEY_COLUMNS`).
`selectAll()` is fine for small, stable tables and internal
tooling.

A named column list is also the cheaper query: Postgres reads
and transfers only those columns, and a query whose columns
are all in one index can be answered by an index-only scan.
Project the columns the caller reads, and drop `returningAll()`
on a write whose result is never read.

Key patterns:

- Use `whereRef` (not `where`) for column-to-column refs
- Nest `jsonObjectFrom` calls for multi-level joins
- Result type is `T | null` — check for null before using
- Use `innerJoin`/`leftJoin` only for flat columns or
  join-based filtering

### Aggregating child rows with `json_agg`

```ts
import { sql } from 'kysely';

const rows = await db
  .selectFrom('presets')
  .selectAll('presets')
  .select(
    sql<DBPresetVersion[]>`coalesce(
      (select json_agg(pv)
       from preset_versions pv
       where pv.preset_id = presets.id),
      '[]'
    )`.as('preset_versions'),
  )
  .where('owner_id', '=', ownerId)
  .execute();
```

The generic `<T>` on `sql<T>` is unchecked by the compiler
— always back these with integration tests.

---

## 10. CTEs (`.with()`)

Use `.with()` for INSERT-then-SELECT in a single statement
— avoids two round-trips and keeps the operation atomic:

```ts
// Insert a user, then immediately join related data
return dbWrite('db.createAuthCode', (sql) =>
  sql
    .with('new_code', (db) =>
      db
        .insertInto('auth_codes')
        .values({
          app_id: appId,
          clerk_user_id: entityId,
          code_challenge: codeChallenge,
          expires_at: expiresAt?.toISOString() ?? null,
        })
        .returningAll(),
    )
    .selectFrom('new_code')
    .selectAll('new_code')
    .select((eb) => [
      jsonObjectFrom(
        eb.selectFrom('apps')
          .selectAll('apps')
          .whereRef('apps.id', '=', 'new_code.app_id'),
      ).as('apps'),
    ])
    .executeTakeFirstOrThrow(),
);
```

Common CTE patterns:

- **INSERT + SELECT joined data** — insert in the CTE,
  query `new_row` joined to related tables in the outer
  SELECT.
- **Upsert with conflict detection** — use
  `.onConflict(...).doNothing().returningAll()` in the CTE,
  then `UNION ALL` an existing-row fallback in the outer
  query (see `insert-provisioned-user.ts`).

Reach for `.with()` instead of two separate `dbWrite` +
`dbRead` calls whenever the second query depends on the
first's inserted row.

---

## 11. Pagination

Every paginated `orderBy` must end in a unique column
(`orderBy('created_at', 'desc').orderBy('id', 'desc')`).
Without the tiebreaker, rows with equal sort values can
appear on two pages or on neither.

### Offset pagination (window function pattern)

Use for shallow, user-facing pages that also need a total
count. Postgres reads and discards every skipped row, so the
cost grows with the offset.

```ts
return dbRead('db.getSlimKeys', async (sql) => {
  const rows = await sql
    .selectFrom('api_keys')
    .select(['id', 'name', 'hash'])
    .select((eb) =>
      eb.fn.countAll<number>().over().as('total_count'),
    )
    .where('clerk_user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  if (rows.length > 0) {
    return {
      data: rows.map(({ total_count: _total_count, ...row }) => row),
      totalCount: rows[0]!.total_count,
    };
  }

  // Offset exceeded results — count-only fallback
  const { total } = await sql
    .selectFrom('api_keys')
    .select((eb) => eb.fn.countAll<number>().as('total'))
    .where('clerk_user_id', '=', userId)
    .executeTakeFirstOrThrow();

  return { data: [], totalCount: total };
});
```

- Kysely returns `[]` for out-of-range offsets (no error).
- Strip `total_count` from returned rows via destructuring.

### Keyset pagination for deep pages and full-table walks

When page depth is unbounded (background jobs walking a
whole table, exports, infinite scroll), page by the last
seen key instead of an offset. Each page is one indexed
range scan regardless of depth, and rows inserted or
deleted between pages cannot shift the window.

```ts
const PAGE_SIZE = 1000;

let cursor: string | undefined;
for (;;) {
  const afterPermaslug = cursor;
  const page = await dbRead('db.listModelsPage', (sql) =>
    sql
      .selectFrom('models')
      .select(['permaslug', 'slug'])
      .where('deleted', '=', false)
      .$if(afterPermaslug !== undefined, (qb) =>
        qb.where('permaslug', '>', afterPermaslug!),
      )
      .orderBy('permaslug', 'asc')
      .limit(PAGE_SIZE)
      .execute(),
  );
  if (isErr(page)) return page;
  // ...process page.data
  if (page.data.length < PAGE_SIZE) break;
  cursor = page.data.at(-1)?.permaslug;
}
```

- The cursor column set must be unique and match the
  `orderBy` exactly. For a non-unique sort column, use a
  row comparison on `(sort_col, id)` via `sql` and order by
  both.
- Keyset cannot jump to page N or give a total count. Use
  offset for that, keyset for everything else.
- See `getAllModelsForAutoStageMatching` in
  `packages/db/models/queries.ts`.

### Head-only count (no data)

```ts
return dbRead('db.countOrgMembers', async (sql) => {
  const row = await sql
    .selectFrom('organization_members')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('organization_id', '=', orgId)
    .executeTakeFirst();
  return row?.count ?? 0;
});
```

---

## 12. Aggregate Function Type Annotations

The custom type parser (`supabaseCompatTypes`) converts
`int8` (OID 20) and `numeric` (OID 1700) to JavaScript
`number` at the driver level. All aggregate functions must
use `<number>`:

```ts
.select((eb) => eb.fn.countAll<number>().as('count'))
.select((eb) => eb.fn.count<number>('id').as('count'))
.select((eb) => eb.fn.sum<number>('amount').as('total'))
.select((eb) => eb.fn.avg<number>('price').as('avg_price'))
```

`count` and `countAll` **require** the generic (no default).
`sum` and `avg` default to `string | number`, so narrow to
`<number>`. `min`/`max` infer from the column type — no
annotation needed.

Do not use `countAll<string>()` or wrap the result in
`Number()`.

---

## 13. Upserts

`INSERT ... ON CONFLICT` is the atomic form of
"select, then insert or update". The two-statement form
races under concurrency and fails on the unique index; the
single statement cannot.

```ts
return dbWrite('db.addWorkspaceMembers', (sql) =>
  sql
    .insertInto('workspace_members')
    .values(members)
    .onConflict((oc) =>
      oc
        .columns(['entity_id', 'workspace_id', 'user_id'])
        .doUpdateSet({
          role: (eb) => eb.ref('excluded.role'),
        }),
    )
    .returningAll()
    .execute(),
);
```

- Use `.columns([...])` for the conflict target.
- `doUpdateSet` specifies which columns to update. Use
  `eb.ref('excluded.<col>')` for incoming values.
- For `ignoreDuplicates`, use `.doNothing()` instead of
  `.doUpdateSet()`.

### `excludedColumns` helper for bulk upserts

When many columns need updating on conflict, use
`excludedColumns` from
`packages/db/kysely/upsert-helpers.ts`:

```ts
import { excludedColumns } from '../kysely/upsert-helpers';

return dbWrite('db.upsertBenchmarks', (q) =>
  q
    .insertInto('artificial_analysis_benchmarks')
    .values(batch)
    .onConflict((oc) =>
      oc.column('aa_id').doUpdateSet(
        excludedColumns<'artificial_analysis_benchmarks'>([
          'aa_name',
          'elo',
          'rank',
          'last_updated_at',
        ]),
      ),
    )
    .execute(),
);
```

The generic parameter constrains the column list to that
table's updateable columns — typos are caught at compile
time.

---

## 14. JSON/JSONB Column Writes

Always `JSON.stringify()` JSON/JSONB column values before
passing them to `.values()` or `.set()`. The `pg` driver
does **not** auto-serialize objects in Kysely's
`.values()`/`.set()` context — Postgres rejects raw objects
with `invalid input syntax for type json`.

### Inline (single column)

```ts
await sql.insertInto('credit_pools')
  .values({
    ...input,
    restrictions: JSON.stringify(input.restrictions),
  })
  .execute();
```

### `stringifyJsonColumns` helper (multi-column)

For tables with multiple JSON columns, define a
compile-time-checked column list:

```ts
// json-columns.ts
import type {
  ExactJsonColumns,
  JsonColumnKeys,
} from '../../kysely-json';
import type { Guardrails } from '../../kysely-types.gen';

export const GUARDRAIL_JSON_COLUMNS = [
  'content_filters',
  'content_filter_builtins',
  'pii_filters',
] as const satisfies ExactJsonColumns<JsonColumnKeys<Guardrails>>;
```

Use in queries:

```ts
import { stringifyJsonColumns } from '../../kysely-json';
import { GUARDRAIL_JSON_COLUMNS } from './json-columns';

const serialized = stringifyJsonColumns(
  updates,
  GUARDRAIL_JSON_COLUMNS,
);
await sql
  .updateTable('guardrails')
  .set(serialized)
  .where('id', '=', id)
  .execute();
```

If a new JSON column is added and not listed, typecheck
fails with `MISSING: <column_name>`.

---

## 15. Transactions

Use transactions for multi-step writes that must be atomic:

```ts
return dbWrite('db.upsertGuardrail', (sql) =>
  sql.transaction().execute(async (trx) => {
    const updated = await trx
      .updateTable('guardrails')
      .set(updates)
      .where('entity_id', '=', entityId)
      .where('is_platform_internal', '=', true)
      .returningAll()
      .executeTakeFirst();

    if (updated) return updated;

    return trx
      .insertInto('guardrails')
      .values({
        entity_id: entityId,
        name: 'Platform Guardrail',
        ...updates,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  })
);
```

### Lock the read row with `FOR UPDATE`

A transaction alone does **not** prevent stale reads. For
read-modify-write logic (permission checks, counter
increments, conditional updates), lock the row:

```ts
return dbWrite('db.updateProvider', (sql) =>
  sql.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('providers')
      .selectAll()
      .where('provider_name', '=', name)
      .forUpdate()   // blocks concurrent writers
      .executeTakeFirstOrThrow();

    if (
      !current.owners.includes(userId) &&
      !current.editors.includes(userId)
    ) {
      throw new PermissionError('Permission denied');
    }

    return trx
      .updateTable('providers')
      .set(updates)
      .where('provider_name', '=', name)
      .returningAll()
      .executeTakeFirstOrThrow();
  })
);
```

Without `.forUpdate()`, two concurrent transactions can both
read the same row and overwrite each other's changes. Always
pair `.forUpdate()` with any SELECT whose result drives a
subsequent UPDATE/DELETE.

### Reusable query functions in transactions

Accept an optional `trx` parameter to make functions
callable standalone or within a transaction:

```ts
import type { TypedDatabaseQuerier } from '../kysely';

export async function createItem(
  params: { name: string },
  trx?: TypedDatabaseQuerier,
): AsyncResult<Item, ErrorT> {
  const insertItem = (
    sql: TypedDatabaseQuerier,
  ): Promise<Item> =>
    sql
      .insertInto('items')
      .values({ name: params.name })
      .returningAll()
      .executeTakeFirstOrThrow();

  if (trx) {
    return ok(await insertItem(trx));
  }
  return dbWrite('db.createItem', (sql) => insertItem(sql));
}
```

Compose inside a transaction:

```ts
const result = await dbWrite('db.createOrder', (sql) =>
  sql.transaction().execute(async (trx) => {
    const itemResult = await createItem(
      { name: 'Widget' },
      trx,
    );
    if (isErr(itemResult)) {
      throw new Error(itemResult.error.message);
    }
    await linkItemToOrder(
      { itemId: itemResult.data.id, orderId },
      trx,
    );
    return itemResult.data;
  }),
);
```

**Defer side effects** (analytics, emails, webhooks) until
after the transaction commits — skip them when `trx` is
provided.

### Keep transactions short

The connection and every lock the transaction holds stay
held until the callback returns, and where
`idle_in_transaction_session_timeout` is set Postgres kills
a transaction that waits too long between statements.

- **No network calls inside `sql.transaction()`.** No
  `fetch`, Stripe, Clerk, KV, or queue calls. Compute
  before, write inside, notify after.
- **Lock in a fixed order.** When one transaction locks
  more than one row (or takes more than one advisory
  lock), sort the keys first so every concurrent
  transaction acquires them in the same order. Two
  transactions locking the same pair in opposite orders
  deadlock.
- **`FOR UPDATE` only the rows you will write.** Locking a
  parent row to guard a child write serializes every
  writer on that parent.

### Advisory locks for invariants without a lockable row

When the invariant spans rows or has no single row to
`FOR UPDATE` (a per-entity cap, a per-code redemption
count, a sender/receiver pair), take a transaction-scoped
advisory lock keyed on the invariant:

```ts
import { sql } from 'kysely';

const LOCK_PREFIX = 'intern-create:';

return dbWrite('db.createInternWithinCap', (db) =>
  db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`${LOCK_PREFIX}${entityId}`}))`.execute(trx);
    // count, check the cap, insert
  }),
);
```

- Namespace the key with a module-specific prefix so
  unrelated features hashing the same ID do not serialize
  each other.
- Use `pg_advisory_xact_lock` (released at commit or
  rollback), never session-level `pg_advisory_lock`. Pooled
  connections do not preserve sessions, so a session lock
  can leak to another caller or never release.
- See `packages/db/credits/atomic-transfers.ts` (two keys,
  sorted) and `packages/db/promo-codes/queries.ts`.

### Queue workers: `FOR UPDATE SKIP LOCKED`

For many workers claiming rows from one table, select with
`.forUpdate().skipLocked()` and `.limit(n)` so each worker
takes unclaimed rows without blocking on rows another
worker holds. Do not use `skipLocked` outside the claim
pattern; a read that silently skips locked rows is a wrong
answer everywhere else.

### Rollback: `throw` inside the callback

Kysely only rolls back a transaction when the callback
**throws**. Returning a sentinel value (including `err()`)
commits the transaction normally — the return value is just
data, not a rollback signal.

```ts
// ✅ CORRECT — throw to rollback
sql.transaction().execute(async (trx) => {
  const row = await trx
    .updateTable('auth_codes')
    .set({ api_key_id: key.id })
    .where('id', '=', code.id)
    .where('api_key_id', 'is', null)
    .returning('id')
    .executeTakeFirst();

  if (!row) {
    throw new Error('Auth code already redeemed');
  }
  return key;
});
```

```ts
// ❌ WRONG — returning err() does NOT rollback
sql.transaction().execute(async (trx) => {
  // ...
  if (!row) {
    return errT({ message: 'Already redeemed' });
    // Transaction COMMITS with this err value!
  }
});
```

When a rollback isn't needed (e.g., a permission check
before any writes), returning a sentinel and handling it
outside the transaction is fine — the key is that no
partial writes are left behind.

---

## 16. `numUpdatedRows` / `numDeletedRows` are `bigint`

Kysely's `.execute()` on UPDATE/DELETE returns
`{ numUpdatedRows: bigint }` or
`{ numDeletedRows: bigint }`. Compare with `0n`, not `0`:

```ts
const result = await sql.deleteFrom('provider_applications')
  .where('id', '=', id)
  .executeTakeFirst();

if (result.numDeletedRows === 0n) {  // NOT === 0
  return err({ status: 404, message: 'Not found' });
}
```

`0n == 0` is `true` (loose equality) but `0n === 0` is
`false` (strict equality). Always use `=== 0n`.

---

## 17. `!= true` (NULL-passing Tri-Valued Logic)

```ts
query = query.where('deleted', '!=', true);
// includes NULL rows
```

This is intentional. `!= true` in SQL passes NULLs
(tri-valued logic). Check the column's `NOT NULL`
constraint — if the column allows NULL, this includes
`deleted IS NULL` rows.

---

## 18. Error Handling

### ErrorT helpers

Import from `packages/db/errors.ts`:

- **`isDBErrNotFound(error)`** — True when
  `executeTakeFirstOrThrow()` found zero rows. The throw is
  caught by `dbRead`/`dbWrite` and tagged with
  `isNotFound: true`.
- **`isDBErrDuplicateKey(error)`** — True on
  unique-constraint violation (Postgres SQLSTATE 23505).
- **`isDBErrForeignKeyViolation(error)`** — True on FK
  violation (SQLSTATE 23503).
```ts
import {
  isDBErrDuplicateKey,
  isDBErrForeignKeyViolation,
  isDBErrNotFound,
} from '../errors';

const result = await dbWrite(
  'db.createKey',
  (sql) => /* ... */,
);
if (isErr(result)) {
  if (isDBErrDuplicateKey(result.error)) {
    return err({
      status: 409,
      message: 'Key already exists',
    });
  }
  return result;
}
```

### Prefer `executeTakeFirst()` + `undefined` check

For simple reads, checking for `undefined` is simpler:

```ts
const row = await sql.selectFrom('users')
  .selectAll()
  .where('id', '=', userId)
  .executeTakeFirst();

if (!row) {
  return err({ status: 404, message: 'User not found' });
}
```

Reserve `isDBErrNotFound` for cases where the not-found
error bubbles up through `dbRead`'s error wrapper (inside
transactions or complex operations).

---

## 19. Type Parsers (`supabaseCompatTypes`)

The custom type parser (`supabaseCompatTypes` — a legacy
name kept for stability) in
`packages/db/replica-routing/connection-pool.ts` aligns pg
driver output with generated types:

- **`timestamp` / `timestamptz`** -> ISO 8601 **strings**
  (not `Date` objects).
- **`int8` / `numeric`** -> JavaScript `number` (pg defaults
  to string for these).
- **`date`** -> `YYYY-MM-DD` string.

```ts
const row = await sql
  .selectFrom('users')
  .selectAll()
  .executeTakeFirst();
typeof row.created_at; // 'string'
row.created_at instanceof Date; // false
// wrap with new Date() if Date methods needed
```

---

## 20. Do Not Use `$castTo`

Kysely infers types from the database schema. `$castTo`
bypasses inference and silently hides type mismatches. If
`.selectAll()` doesn't produce the expected type, fix the
schema types (`Database` interface /
`kysely-types.gen.d.ts`), not the query.

The only exception is raw `sql<T>` tagged templates where
Kysely has no schema context.

---

## 21. Avoid Large Raw SQL Blocks

Prefer Kysely's query builder for structure (selects, joins,
filters, pagination). Small `sql` fragments are fine for
expressions Kysely can't model cleanly:

```ts
.select(
  sql<string>`array_to_json(
    ${eb.ref('table.composite_array')}
  )`.as('arr'),
)
```

Do not replace entire queries with raw SQL templates.

If you do execute a raw `sql` query outside `dbRead` /
`dbWrite` (e.g. via `db.read((q) => ...)` on a
`DBRequestContext`), attach `QueryTagPlugin` explicitly so the
query still emits sqlcommenter `action` / `application` tags:

```ts
import { QueryTagPlugin } from '@openrouter-monorepo/db/query-tag-plugin';

db.read((q) =>
  queryApiKeyLookup(keyHash).execute(
    q.withPlugin(new QueryTagPlugin('auth.queryApiKeyLookup', db.applicationName)),
  ),
);
```

Queries routed through `dbRead` / `dbWrite` get this plugin
automatically.

### Matching many `(a, b)` pairs: bind arrays, not one param per value

A set-based write over N caller-supplied pairs must not expand to
`2N` scalar binds. Postgres caps a statement at 65,535 bind
parameters, so `(a, b) IN (($1, $2), ($3, $4), ...)` fails around
32k pairs and rolls the transaction back. Pass one typed array per
column and zip them with `unnest`, which keeps the bind count
constant and matches pairs positionally instead of cross-matching
two independent `IN` lists:

```ts
.where(
  sql<boolean>`(entity_id, scope_id) IN (
    SELECT * FROM unnest(
      ${sql.val(keys.map((k) => k.entityId))}::text[],
      ${sql.val(keys.map((k) => k.scopeId))}::text[]
    )
  )`,
)
```

Cover the boundary in the real-Postgres test with more pairs than
the scalar shape could bind (see
`packages/db/integration/api-keys/bulk-soft-delete-alert-cleanup.test.ts`,
#40551).

When a pair predicate is not a plain equality (`LIKE k.prefix`,
a range), the planner cannot hash a correlated `EXISTS (... FROM
unnest ...)` and falls back to a seq scan of the target table. Use
`DELETE ... USING unnest(...) AS k(...)` (Kysely `.using(sql\`unnest(...)\`.as(sql\`k(a, b)\`))`)
so it nested-loops from the small unnest set and probes the index per
pair. Check with `EXPLAIN (ANALYZE, BUFFERS)` on a seeded table of
production-like size before claiming the set-based form is faster;
a test-sized table hides the difference (#40551).

---

## 22. Shared Column Lists

When list and get query helpers select the same set of
columns, extract into a shared `public-row.ts` file:

```ts
import type { Selectable } from 'kysely';
import type { BroadcastDestinations } from '../../kysely-types.gen';

export const PUBLIC_DESTINATION_COLUMNS = [
  'id', 'name', 'type', 'created_at',
] as const satisfies readonly (keyof Selectable<BroadcastDestinations>)[];
```

The `satisfies` constraint ensures every entry is a valid
column of the table — typos are caught at compile time.
This prevents drift when columns are added or removed.

---

## 23. Scope Every Row to Its Owner

When a query reads or writes a row identified by a
caller-supplied ID, the owner or tenant predicate goes in
that same statement. Authorization and data access are one
operation.

```ts
export async function deleteGuardrail(
  id: string,
  entityId: string,
): AsyncResult<boolean, ErrorT> {
  return dbWrite('db.deleteGuardrail', async (sql) => {
    await sql
      .deleteFrom('guardrails')
      .where('id', '=', id)
      .where('entity_id', '=', entityId)   // required scope
      .execute();
    return true;
  });
}
```

A caller-side check followed by an unscoped
`getById(id)` / `deleteById(id)` is not an ownership
boundary: the two halves drift apart, and the next call site
inherits the unscoped helper without the check.

Requirements:

- **Make the scope required by the signature.** An optional
  parameter, or an object bag whose scope field is optional,
  lets a call site omit it and still compile. Contrast
  `getKeyByIdAdmin(id)` with its scoped sibling
  `getKeysById({ entityId, ids })` in
  `packages/db/api-keys/queries.ts`, whose required
  `entityId` field the compiler enforces at every call site
  — prefer the scoped form.
- **Keep the predicate unconditional.** A scope applied
  inside `$if(...)` or `if (workspaceId)` disappears when the
  client omits the field.
- **Return the empty/not-found result, not a distinct
  error.** A row belonging to someone else should be
  indistinguishable from a row that does not exist.
- **Do not substitute the caller's entity for the object's
  owner.** In an organization context the caller's
  `entityId` is the organization, so every member passes a
  comparison against it. Resolve the object's own owner.
- **Cover it with a cross-tenant integration test** that
  calls the query with another tenant's ID and re-reads the
  row to prove nothing changed — see
  `packages/db/integration/guardrails/delete.test.ts`.

Role and ownership are separate predicates. A passing role
check establishes privilege level, not that the caller owns
this row; a mutation keyed by a caller-supplied ID needs
both.

For the review-time version of this rule, including the
handler-layer patterns and past regressions, see
[`security-review/classes/authorization.md`](../security-review/classes/authorization.md).

---

## 24. Query Shape & Cost

The production database enforces a `statement_timeout`
(default `8s`, see `postgres/README.md`). A query that is
correct but unbounded fails there, not in tests.

### Bound every multi-row read

Every query whose row count is not already bounded by its
input has a `.limit()`, or is a deliberate full-table walk
paged by
[keyset](#keyset-pagination-for-deep-pages-and-full-table-walks).
A list endpoint without a limit is a full-table read waiting
for the table to grow. A read keyed on a caller-supplied ID
list (`where('id', 'in', ids)`) needs no `.limit()`: its
row count cannot exceed the list, and a limit there would
silently drop rows. The list itself is the bound, so cap
its length where it enters (request schema, job config),
and if the cap is large,
[chunk it](#chunk-multi-row-writes) before querying.
Chunking limits each statement, not the total work.

### Empty `in` lists

Kysely compiles `.where('id', 'in', [])` to `id in ()`,
which Postgres rejects as a syntax error. Return early
before building the query:

```ts
if (ids.length === 0) return ok([]);
return dbRead('db.getKeysById', (sql) =>
  sql.selectFrom('api_keys')
    .select(['id', 'name'])
    .where('entity_id', '=', entityId)
    .where('id', 'in', ids)
    .execute(),
);
```

### N+1: batch by ID instead of querying in a loop

Never call `dbRead` / `dbWrite` inside a loop over IDs.
Collect the IDs and issue one statement with `in`, or
express the relationship as a join / `jsonArrayFrom`. The
same applies to writes: one multi-row `.values(rows)`
instead of one insert per row.

```ts
// BAD — one round trip per key
for (const id of ids) {
  await getKeyById({ entityId, id });
}

// GOOD — one round trip
const keys = await getKeysById({ entityId, ids });
```

Design new getters for the batch case: take `ids: string[]`
and return the rows, rather than a single `id`. A
single-row getter forces every caller with two or more IDs
into the loop above. Add a single-ID variant only when
the contract can never carry more than one ID (a unique
key lookup, a row the caller already holds), or the
wrapper removes real noise at many call sites. A call site
that happens to have one ID today is not a reason. Build
the variant on the batch one.

### Chunk multi-row writes

A multi-row `insertInto().values(rows)` or a large `in`
list binds one parameter per value, and Postgres caps a
single statement at 65,535 bind parameters. Chunk the input
so `rows * columns` stays well under that, and run each
chunk as its own statement so one chunk cannot exceed
`statement_timeout`. Pick the chunk size per workload
(`packages/db/risk-flags/assert.ts`,
`packages/db/alert-policy-settings/index.ts`); there is no
universal constant.

### Let the planner use the index

- **Do not wrap an indexed column in a function** in
  `WHERE` or `JOIN ON` (`lower(email) = $1`,
  `created_at::date = $1`, `id::text = $1`). The B-tree
  index on the bare column cannot serve it. Compare
  against a normalized stored value or rewrite as a range
  (`created_at >= $1 and created_at < $2`).
- **Prefer `EXISTS` when only existence matters**, not
  `IN (subquery)` or a join that then needs `DISTINCT`.
- **Prefer `UNION ALL`** unless duplicate elimination is
  required; `UNION` sorts and dedups the combined set.
- **Filter and sort on indexed columns.** If a new query
  filters or sorts on columns no index covers, add the
  index in the same PR (see the index-design section of
  `postgres/migrations/CLAUDE.md`). Match the composite
  column order and `ORDER BY` direction to the query.

For diagnosing a slow query in production (Datadog DBM,
explain plans, query samples), use the
`audit-slow-db-queries` skill. `EXPLAIN ANALYZE` executes
the statement; never run it against a write, and only
against production with an explicit decision to do so.

---

## 25. Hyperdrive-Cached Reads (`useCachedConnection`)

```ts
return dbRead(
  'db.listWorkspaceSlugs',
  { useCachedConnection: true },
  (sql) => /* ... */,
);
```

`useCachedConnection: true` routes the read through
Hyperdrive, which caches results keyed on the SQL text plus
the bind values, and
[only caches queries it can prove `IMMUTABLE`](https://developers.cloudflare.com/hyperdrive/configuration/query-caching/).
Two things defeat it:

- **A `STABLE` or `VOLATILE` Postgres function anywhere in
  the SQL text** (`now()`, `current_timestamp`,
  `gen_random_uuid()`, `random()`, `nextval()`, even inside a
  SQL comment) makes the whole query uncacheable. The list
  is `VOLATILE_SQL_PATTERN` in
  `packages/helpers/volatile-sql.ts`. Replace it with a
  bind value that is stable across calls (next bullet). If
  the query genuinely needs a fresh value every call, it
  is not a cacheable read: drop `useCachedConnection`.
- **A unique bind value per call** (`new Date()`,
  `Date.now()`, `Math.random()`, a per-request UUID) is a
  cache miss every time. For time filters use
  `getBucketedNow()` from
  `packages/db/endpoints/hydrated-queries.ts` (or a similar
  bucketing scheme) so the parameter is stable within a
  cache window, or filter in application code.

The `openrouter/no-dynamic-cached-query` Oxlint rule
enforces both. Only use `useCachedConnection` for reads
that tolerate stale data for the cache window; it is the
wrong tool for anything §3 would route `primaryOnly`. On
inference hot paths it is a last resort after the auth
service and KV, not a default (root `AGENTS.md`, Inference
Path Performance).
