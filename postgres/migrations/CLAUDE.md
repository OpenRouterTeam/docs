# Migration conventions

For the manual production procedure and its timeout guidance, see
[postgres/README.md](../README.md).

## Lock analysis (required before every migration PR)

Before opening a PR, extract the actual locks the migration
takes by running it in a rolled-back transaction against
local Postgres and inspecting `pg_locks` (skip
`CONCURRENTLY` statements — they refuse to run in a
transaction, which is exactly why they're safe):

```bash
{
  echo 'BEGIN;'
  sed -n '/^-- migrate:up/,/^-- migrate:down/{
    /^-- migrate:/d
    p
  }' postgres/migrations/<your_migration>.sql
  cat <<'SQL'
SELECT c.relname, l.mode
FROM pg_locks l
JOIN pg_class c ON c.oid = l.relation
WHERE l.pid = pg_backend_pid() AND c.relkind IN ('r', 'i')
ORDER BY 1;
ROLLBACK;
SQL
} | psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

Dangerous lock modes on tables that already exist in prod
(locks are held until the transaction commits, and a
pending lock request queues behind long-running queries
while every later query queues behind it):

- **ACCESS EXCLUSIVE** — blocks all reads and writes.
- **EXCLUSIVE** — blocks everything except plain reads.
- **SHARE ROW EXCLUSIVE** / **SHARE** (plain
  `CREATE INDEX`) — block all writes; use
  `CREATE INDEX CONCURRENTLY` on existing tables.
- **SHARE UPDATE EXCLUSIVE** and below are the safe tier —
  reads and writes continue.

From the extracted locks, write a risk assessment: for each
dangerous lock, note the lock mode, whether the statement
holds it only briefly (metadata-only, e.g. `ADD COLUMN`
with a constant default) or for a scan/rewrite of the table
(`ALTER COLUMN ... TYPE`, `SET NOT NULL`, `ADD CONSTRAINT`
without `NOT VALID`), and how hot the table is in prod —
tables on the inference or auth path (e.g. `api_keys`,
`endpoints`, `models`, `transactions`) make even brief
ACCESS EXCLUSIVE locks risky, while low-traffic tables are
usually fine. Include the locks and this assessment in the
PR description, and also add them as SQL comments at the top
of the migration file itself so the lock footprint travels
with the SQL:

```sql
-- Locks:
--   users: ACCESS EXCLUSIVE (brief, metadata-only ADD COLUMN)
-- Prod risk: medium — users is read on the auth path, but the
-- lock is metadata-only; risk is queueing behind long queries.
```

A `CHECK` or foreign key added `NOT VALID` on an existing
table is only half the pattern: follow it with a
`convalidated`-guarded `VALIDATE CONSTRAINT` in the same
`-- migrate:up transaction:false` file, so the metadata-only
`ACCESS EXCLUSIVE` holds commit first and the validation scan
runs under `SHARE UPDATE EXCLUSIVE`. Inside a transactional
migration a `VALIDATE` would scan under the `ADD COLUMN` lock,
and omitting it leaves the constraint `NOT VALID` in the
catalog forever (see
`20260825112327_add_provider_api_keys_is_byok_only.sql`).

## Squawk migration safety lint

`bun run lint:migrations` and the normal `bun run lint` / CI lint job run Squawk concurrently with the existing Postgres migration checks. Squawk is pinned in `scripts/package.json` and configured for Postgres 18 in `.squawk.toml`. It checks the complete `migrate:up` section of added or modified migrations against the PR base, plus staged, unstaged and untracked migrations locally; the historical baseline files and rollback sections are excluded. CI reads migration contents from `HEAD` so leftover working-tree files cannot change the verdict. The runner preserves original line numbers and honors dbmate's `transaction:false` marker. An unavailable Git comparison fails the Squawk check rather than skipping it.

Keep the safety rules enabled. For an intentional exception, use a statement-level `-- squawk-ignore <rule>` with an adjacent explanation of the lock risk and deployment ordering. Squawk only honors the comment on the line directly above the flagged clause, so a multi-clause `ALTER TABLE` needs one ignore line per flagged clause (the reason comment can sit once above the statement). Migrations that predate Squawk carry retroactive suppressions marked "Legacy migration"; they were not re-reviewed. Destructive cleanup must identify the previously released removal of consumers. Do not suppress all rules for a file. Per-file timeout and schema-preference rules are excluded; migration connections inherit timeouts documented in `postgres/README.md`. Squawk's `included_rules` adds to its default rules rather than selecting an allowlist, so retain the exclusions and review new default rules whenever upgrading the pinned version.

Squawk does not replace lock analysis, repo-specific FK/view checks, index-validity checks or review of idempotency and bounded backfills. In particular, it does not inspect DDL inside `DO $$` bodies or prove that `NOT VALID` and validation run in separate transactions. Its transaction rule also permits a single concurrent-index statement, so the existing dbmate-marker check remains necessary. Keep those checks even when Squawk passes.

The legacy `INDEX_CHECK_SKIP_FILES` and `USER_FK_CONSTRAINT_SKIP_FILES` exemptions apply only to their existing checks; Squawk does not inherit them. Editing an exempt migration rechecks its entire forward section, including previously reviewed statements. Use statement-level Squawk suppressions with the original lock/deployment rationale for intentional exceptions, so a new unsafe statement cannot inherit a blanket file exemption. The user-FK exemption concerns delete behavior, which Squawk does not enforce.

## Migration order is proven, not enforced by timestamp

Prod applies pending migrations with `dbmate migrate` without `--strict`, in filename order, on top of whatever it has already applied. A migration dated before an already deployed one is applied late rather than rejected, so an open PR does not go stale as releases ship. What replaces the timestamp floor is `scripts/ci/migration-order-check.ts`, which runs inside `bun run lint:migrations` and the CI lint job whenever a migration is added or modified.

The check reconstructs the sets of migrations prod may already hold by reading `postgres/migrations` at the newest `release-*` tag and at every later `main` commit that touched that directory. It keeps only the sets in which one of the PR's migrations sorts before an already applied one. For each such set it applies that set in a throwaway Postgres container, applies the rest of the working tree on top, and compares the `pg_dump --schema-only` output to a fresh database that applied the whole working tree in filename order. Dumps exclude the `dbmate` bookkeeping schema and are normalized so that column position, catalog emission order and the per-run `\restrict` token do not count as differences. Any other difference, or a failure to apply, fails lint with the diff. When no pending migration sorts before an applied one the check passes without starting Docker.

The proof covers schema. It does not see data written by a migration, effects outside the database, or a migration that only behaves correctly when a later-dated one has already run against populated tables. Write migrations to be idempotent and to depend on their own prerequisites, not on their position in the directory. Read `postgres/README.md` before writing a backfill.

In CI (`CI` set) the check fails when it cannot resolve the release tag, fetch `main`, or start Postgres. Outside CI it skips those cases. A new `.sql` file must still start with a 14-digit UTC timestamp followed by `_`, which `bun run db:migration <name>` produces, and that timestamp must be within the 30 days before lint runs, neither older nor in the future, so a long-lived PR renames its migration before merging. Hotfix runs, the manual migrate workflow, and a release that fails after its migration job do not create a `release-*` tag, so the reconstructed sets can lag what prod has applied. The later `main` commits close most of that gap because every prod apply runs from a `main` commit.

## Primary key types

- **New tables: use UUID.** Define the PK as
  `id UUID PRIMARY KEY DEFAULT uuidv7()`. Postgres 18
  supports `uuidv7()` natively — use it instead of
  `gen_random_uuid()`; UUIDv7 values are time-ordered,
  which gives better index locality on inserts.
- **When NOT to use `uuidv7()`:**
  - **Timestamp leakage:** v7 embeds the row creation
    time, so anyone who sees the ID learns when the row
    was created — an info-disclosure and enumeration
    risk for public-facing or user-visible IDs. Prefer
    v4 (`gen_random_uuid()`) or a separate opaque
    `public_id` there.
  - **Not for secrets/tokens:** v7 has fewer random
    bits — never use it for session tokens, API keys,
    or reset links.
  - **No retroactive benefit:** columns already filled
    with v4 values won't benefit; gains apply only to
    new inserts on new or rewritten tables.

  Bottom line: default to `uuidv7()` for internal,
  insert-heavy PK tables (better index/write perf plus
  free time ordering); keep v4 for anything externally
  exposed or security-sensitive.

- **Legacy tables keep bigint.** Core tables created
  before late 2024 (`api_keys`, `transactions`, `models`,
  `endpoints`, `apps`, etc.) use
  `bigint generated by default as identity`. Do not
  convert these — they have extensive FK relationships.
- **Exposing legacy IDs externally: add a `public_id`
  column.** When a bigint-PK table needs a stable opaque
  ID for the public API, add a
  `public_id UUID DEFAULT gen_random_uuid()` column with
  a unique index instead of changing the PK. Keep
  `public_id` on v4 — it is externally exposed, and v7
  would leak creation time (see caveats above).
- **No bigserial exception.** Even high-volume,
  append-only tables should use UUID — IDs can be
  generated in the application layer without a single
  sequence bottleneck. Use a `created_at` timestamp
  column (with an index) when you need ordering.

## Primary key requirement

Every `CREATE TABLE` in `public` **must** include a
`PRIMARY KEY`. CI will fail if any public table is
missing one after migrations run (see the
"Check all public tables have primary keys" step in
`ci-postgres.yaml`).

## Index design

An index is paid for on every write to the table and in
storage, so add one for a query that exists (or ships in
the same PR), not for a query that might. On an existing
table always `CREATE INDEX CONCURRENTLY`, in its own
migration marked `-- migrate:up transaction:false` (and the
same on `migrate:down`): `CONCURRENTLY` refuses to run
inside a transaction, and dbmate wraps a migration in one
by default. See lock analysis above.

- **Match the index to the query.** The `WHERE` columns
  the query always supplies, then the `ORDER BY` columns
  in the same direction. One composite index that serves
  the query beats several single-column indexes the
  planner has to combine.
- **Equality columns first, then range or sort columns.**
  In a composite B-tree, the columns after the first range
  predicate (`>`, `<`, `BETWEEN`) can no longer narrow the
  scan; they can only be read from the index. So
  `(entity_id, created_at DESC)` serves
  `WHERE entity_id = $1 ORDER BY created_at DESC`, while
  `(created_at, entity_id)` does not.
- **Foreign-key columns need their own index.** Postgres
  indexes the referenced side (the PK) but not the
  referencing column. Without one, joins on the FK and
  `ON DELETE CASCADE` / `ON UPDATE CASCADE` scan the child
  table.
- **Partial indexes for a fixed predicate.** When every
  query carries the same literal filter (`deleted = false`,
  `status = 'pending'`, `is_organization = false`), put it
  in a `WHERE` clause on the index. The index is smaller, and
  the planner only uses it when the query's predicate
  implies the index's (in practice: repeat it verbatim).
- **Key columns for search and order, `INCLUDE` only for
  return-only columns.** A column the query filters, sorts,
  or `DISTINCT`s on goes in the key
  (`pricing_versions_effective_at_idx`). A column the query
  only returns is the `INCLUDE` case, but no index in this
  schema uses it yet, so add one only for a measurably hot
  read and confirm with `EXPLAIN (ANALYZE, BUFFERS)` that
  the plan becomes an `Index Only Scan` with low
  `Heap Fetches`. A plain `Index Scan` on a covering index
  is usually a cost or visibility-map choice (a recently
  written table has few all-visible pages), so `VACUUM` and
  re-check before concluding the index is not covering.
- **Match the index type to the operator.** B-tree for
  `=`, `<`, `>`, `IN`, `ORDER BY`. GIN for JSONB
  containment (`@>`, `?`), array operators (`&&`, `@>`),
  and full-text `tsvector`. For a JSONB field always
  queried by one key, an expression index on
  `(data ->> 'key')` beats a GIN over the whole document.
- **An expression in the query needs an expression index.**
  `lower(email) = $1` is not served by an index on `email`;
  either index `(lower(email))` or store the normalized
  value and index that.
- **Unique constraints are indexes.** A `UNIQUE` constraint
  or unique index already serves lookups on those columns;
  do not add a second plain index on the same prefix.

The query-side rules (bounded reads, keyset pagination,
functions on indexed columns) are in
`.agents/skills/writing-kysely-queries/SKILL.md` §24.

## Don't add tables written on the inference path

Postgres is **not** the place for tables that are written
to or updated on a hot inference path — anything that
happens at the volume of inference requests (e.g.
`/chat/completions`, `/completions`, embeddings, or any
other request-serving endpoint).

Before adding a `CREATE TABLE` migration, ask: _will rows
be inserted or updated O(inference requests)?_ If so, do
**not** put it in Postgres. High-volume request-path data
belongs in the usage-record pipeline, ClickHouse, Spanner,
KV, or another store built for that write volume — route
it through a background job or post-response hook, never a
synchronous write during request serving.

This is the schema-level counterpart to the "No database
writes in inference paths" rule in the top-level
`AGENTS.md` / `CLAUDE.md`: that rule bans the write _code_,
this one cautions against creating the _table_ that would
invite it. CODEOWNERS auto-tags migration PRs for review —
flag any new table that looks like it will be written or
updated on an inference path, and if you're unsure whether
the write volume is too high, ask in `#database` before
adding it.

## Row Level Security

**Do not enable RLS on new tables.** All access goes through
direct Kysely connections, so `ENABLE ROW LEVEL SECURITY` and
`CREATE POLICY` statements are dead weight; RLS only mattered
under the legacy hosted stack, where PostgREST exposed tables
to anon / authenticated roles. Existing tables have RLS
disabled in the baseline schema.

## PII columns and DSR (Data Subject Requests)

Columns containing personally identifiable information
(PII) — names, emails, free-text notes, identifiers that
can be linked back to a person — **must** be nullable so
the Postgres DSR job (`packages/db/users/scrub-user.ts`)
can NULL them out on user deletion.

When adding a table with PII columns:

1. Make the PII columns `NULL`-able (no `NOT NULL`).
2. Add the table + columns to the scrub step in
   `packages/db/users/scrub-user.ts` (search for
   `scrub-csl-screening` as an example of scrubbing a
   related table).
3. If the table has a `clerk_user_id` FK with
   `ON UPDATE CASCADE`, the ID rewrite propagates
   automatically — but PII in other columns still needs
   explicit NULLing.

Common PII column patterns to watch for:

- User-provided names or emails
- Screened / matched names
- Free-text review or admin notes
- External identifiers tied to a person

## `users.clerk_user_id` holds people _and_ organizations

`public.users` stores one row per **account**, not per
person. A personal account's `clerk_user_id` is a Clerk
user ID (`user_…`); an organization's row carries the Clerk
organization ID (`org_…`) with `is_organization = true`.
Both live in the same table, which is why the uniqueness
constraints on person-only attributes (e.g. email) are
partial indexes `WHERE is_organization = false` — an org
row may share an email with a person's row.

Two consequences worth internalizing before writing a
migration or a query:

- **A column holding `orgId ?? userId` can still have an
  FK to `users(clerk_user_id)`.** Entity-scoped columns
  already do — see `akg_entity_fk` and
  `classifiers_entity_fk` in the baseline schema. Do not
  skip an FK on the assumption that organizations are not
  in `users`; they are.
- **A query that means "a person" must say so.** Filter
  `is_organization = false` (as `lookup-queries.ts` does)
  rather than assuming the row you matched is a human.
  Conversely, resolving a name or email for an entity ID
  can return an organization's, so a surface that reports
  _who did something_ must distinguish the two rather than
  presenting an org as a colleague.

When a new column stores an entity ID, say which shapes it
can hold in its `COMMENT ON COLUMN` (see below), since the
column name alone never tells the reader.

## COMMENT ON for new tables and columns

Every `CREATE TABLE` must be followed by a
`COMMENT ON TABLE` and a `COMMENT ON COLUMN` for each of
its columns. A new column added to an existing table gets
a `COMMENT ON COLUMN` too.

Write what a reader cannot infer from the DDL, not a
restatement of the column name:

- What a row represents, and what writes one.
- What the finite literal values of a text or
  check-constrained column mean.
- Why a column is nullable.
- Why an expected foreign key is absent.
- Whether the column is PII scrubbed by the DSR job (see
  the PII section above) — say so in the comment.

These comments live in `pg_description` and show up in
`\d+` in psql, which is why they are the durable place for
this context: a comment in the `.sql` file is read once at
review time, while the catalog comment is there for
whoever is staring at the schema during an incident.

`COMMENT ON` replaces any existing comment, so it is
naturally idempotent — no `IF NOT EXISTS` needed, and it
satisfies the idempotency rule below. It takes only a
brief catalog-level lock and never touches user data, so
it does not change the migration's lock risk profile.

```sql
COMMENT ON TABLE public.signup_identifier_conflicts IS
  'One row per signup attempt that collided with an existing account, written by the Clerk signup webhook handler. Append-only audit trail for abuse review; never read on the inference path.';
COMMENT ON COLUMN public.signup_identifier_conflicts.clerk_user_id IS
  'Clerk user ID of the signup attempt. No FK to users: a rejected attempt may never have produced a users row.';
COMMENT ON COLUMN public.signup_identifier_conflicts.conflict_kind IS
  'identifier_hash_reuse = same device/identifier hash as an existing account; identifier_hash_cap = hash already at its account cap; duplicate_email = email already registered.';
COMMENT ON COLUMN public.signup_identifier_conflicts.outcome IS
  'inserted = signup allowed through; rejected = signup blocked.';
COMMENT ON COLUMN public.signup_identifier_conflicts.signup_country IS
  'PII: country of the signup request. Nullable so the DSR scrub job can NULL it on user deletion.';
```

## Dropping columns: two PRs, two releases

Migrations run before the app deploy, so a `DROP COLUMN`
lands while the previous app release is still querying the
table. Any query selecting the dropped column (explicitly
or via a stale column list) breaks during the rollout
window. Drop columns in **two PRs, released separately**:

1. **PR 1 (app-level removal):** stop selecting the
   column. If the table has an explicit column-list module
   (e.g. `packages/db/api-keys/index.ts`), add
   the column to its `EXCLUDED_*_COLUMNS` list and remove
   it from the main column list — the exhaustiveness check
   allows columns that are explicitly excluded. Remove all
   remaining reads of the column. Release.
2. **PR 2 (migration):** add the `DROP COLUMN IF EXISTS`
   migration, regenerate the Kysely types, and remove the
   column from the `EXCLUDED_*_COLUMNS` list (the
   `satisfies` constraint forces this once the type no
   longer has the column). Release.

## Never rename a column: add, backfill, migrate, drop

`ALTER TABLE ... RENAME COLUMN` is not a safe migration,
however dead the column looks. Migrations run before the app
deploy, so between the migration and a fully rolled-out
release the old release is still selecting the old name, and
the new release is already selecting the new one — one of the
two is querying a column that does not exist. A failed or
slow app deploy (or a rollback) extends that window
indefinitely, and a query on a missing column fails the whole
request, not just the feature: any page or endpoint whose
query touches the table breaks, including pages where the
renamed column sits behind an inactive feature flag or an
entitlement check.

Do the rename as an add/backfill/migrate/drop sequence,
**released separately**:

1. **PR 1 (add + double-write):** add the new column
   (`ADD COLUMN IF NOT EXISTS`, nullable, no rewrite) and
   make every writer write both columns. The double-write
   can live in app logic or in a DB trigger that mirrors one
   column onto the other, whichever the change author judges
   better for the table. A trigger covers writers the app
   does not own (other services, manual SQL, other
   migrations) at the cost of firing on every write. App
   logic is easier to read and delete but only covers the
   call sites you know about. Reads still use the old
   column. Release.
2. **PR 2 (backfill):** copy the old column's values into
   the new one for existing rows. On a large table
   (`users`, `api_keys`, `transactions`, `endpoints`) a
   single `UPDATE` in the migration is the wrong tool: what
   costs the time is the scan, so a narrow-looking
   predicate on an unindexed column still reads every row,
   and hitting `statement_timeout` fails the whole
   migration run — not just the backfill. Either establish
   that the statement is bounded (an index serves the
   predicate, and the matched row count is small — state
   both in the PR description), or write a batched backfill
   script: bounded row count per statement, keyed on the
   PK, with a `WHERE <new> IS NULL` guard so it is
   re-runnable and resumable, and let it drain. Release.
3. **PR 3 (switch reads):** move all reads to the new
   column. Both columns still exist and both are written, so
   this release is reversible on its own. Release.
4. **PR 4 (drop old + stop double-writing):** remove the
   double-write, then `DROP COLUMN IF EXISTS` the old
   column, regenerate the Kysely types, and follow the
   "Dropping columns" rule above for the app-level removal
   ordering. Release.

Each step must be independently deployable and safe to leave
in place indefinitely — do not merge two of them into one
release, and let each release finish rolling out before
merging the next.

The same reasoning applies to any other in-place identity
change on a live table: renaming a table, changing a column's
type, or narrowing a column to `NOT NULL`. Add the new shape,
migrate readers and writers, then remove the old one.

## `timestamptz` columns and JSON-projected consumers

If the table is exposed to another service through `to_jsonb` /
`row_to_json` (for example `users` via `packages/db/auth/get-user-by-key.ts`),
a new `timestamptz` column arrives at consumers as `+00:00`, not `Z`. Every
Zod schema validating that projection needs `.datetime({ offset: true })`;
see `packages/db/REVIEW.md` "`timestamptz` through `to_jsonb`".

## Idempotency

All migrations must be idempotent. Use `IF NOT EXISTS` /
`IF EXISTS` clauses so re-runs never fail:

- `ADD COLUMN IF NOT EXISTS`
- `DROP COLUMN IF EXISTS`
- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `DROP TABLE IF EXISTS`
- `DROP INDEX IF EXISTS`
