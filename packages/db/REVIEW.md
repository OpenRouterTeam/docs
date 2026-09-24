# DB Package Review Guidelines

## Domain modules and migrations

New persisted product concepts should have a focused domain module with typed
read/write queries and a matching migration. Keep route-specific orchestration
out of `packages/db`; consumers should depend on the domain module contract.

The activity-explore saved-charts module is the reference shape for CRUD
queries: enforce ownership/workspace scope in the query layer and cover each
exported query with real Postgres integration tests.

## Database Access

All database queries must use Kysely `dbRead` / `dbWrite` from `@openrouter-monorepo/db/context`.

## Accounts vs people in `users`

`users` holds one row per account: personal accounts keyed on a Clerk user ID
and organizations keyed on a Clerk organization ID with `is_organization = true`.
Flag two mistakes in review, both of which follow from forgetting that:

- A claim that an entity-scoped column (one holding `orgId ?? userId`) cannot
  reference `users(clerk_user_id)`. It can, and existing entity FKs do.
- A lookup that treats a matched row as a person without filtering
  `is_organization = false`, or a user-facing surface that renders a resolved
  name or email as a human when the ID may be an organization's.

See `postgres/migrations/AGENTS.md` for the schema-side statement of this.

## Integration Test Requirements

All new Postgres queries or new parameters on existing queries must be covered by integration tests. When adding a new exported query function to a `queries.ts` or `write-queries.ts` file, a corresponding integration test must be added in the same PR.

This baseline test coverage ensures new query logic is verified against a real database.

### No new mock-based DB tests — ever

New tests of DB queries/calls must be integration tests against a real database. Do NOT create new mock-based DB tests under any circumstances. This applies to:

- **Postgres** — test against the real local Postgres instance (see below)
- **Spanner** — test against the Spanner emulator (see `services/usage-record/integration/spanner/`)

Mocking the DB layer (mocking `dbRead`/`dbWrite`, Kysely, the Spanner client, query functions, or module-mocking a `queries.ts` file) verifies nothing about the SQL actually executed and rots silently as the schema changes. Flag any PR that adds such a test in review.

When touching a file that has existing mock-based DB "coverage", convert those tests to integration tests where possible — or delete them if the behavior is already covered by an integration test. Do not extend existing mock-based DB tests with new cases; write the new case as an integration test instead.

### How to write integration tests

For comprehensive conventions (test template, helpers, banned patterns, coverage), see the [DB integration test agent rule](../../.agents/skills/db-integration-tests/SKILL.md).

- Place integration tests under `packages/db/integration/<domain>/` (e.g., `integration/api-keys/`, `integration/workspaces/`)
- Integration tests use `bun:test` and run against a real local Postgres instance
- Set up test data in `beforeAll` using values that are namespaced with some nonce for the run so the suite is idempotent against a shared db
- Use unique, random identifiers (e.g., `` `user_integration_${Math.floor(Math.random() * 1e6)}` ``) to avoid collisions with parallel test runs
- Never mock the function under test; mock only underlying dependencies if needed
- Integration tests are excluded from the default `bun test` run (see `bunfig.toml`) and run separately with `BUN_INTEGRATION_TEST=1`
- Any code the suite is expected to cover must have a path registered in `DB_PATHS` (`ci-paths.ts`) — the `db-lint-and-tests` merge-queue gate runs the suite only when a diff touches a registered path, so an uncovered path merges without Postgres verification

## Kysely Query Patterns

When writing or reviewing Kysely-based code, follow the [Writing Kysely Queries guide](../../.agents/skills/writing-kysely-queries/SKILL.md).

* Use Kysely's `.$if()` for conditional query clauses instead of spread patterns with `undefined` checks. For example, prefer `.$if(value !== undefined, (qb) => qb.set({ column: value! }))` over `...(value !== undefined && { column: value })`.

## Shared Column Lists

When list and get query helpers select the same set of columns (e.g., public API projections), extract the column list into a shared `public-row.ts` file alongside the query family. This prevents drift when columns are added or removed.

*Source: [PR #21309](https://github.com/OpenRouterTeam/openrouter-web/pull/21309)*

## Dropping Columns: Two PRs, Two Releases

Migrations run before the app deploy, so a `DROP COLUMN` lands while the previous app release is still querying the table. Any query selecting the dropped column breaks during the rollout window. Drop columns in two PRs, released separately:

1. **PR 1 (app-level removal):** stop selecting the column. If the table has an explicit column-list module (e.g., `api-keys/index.ts`), move the column from the main column list into its `EXCLUDED_*_COLUMNS` list — the compile-time exhaustiveness check allows explicitly excluded columns. Remove all remaining reads. Release.
2. **PR 2 (migration):** ship the `DROP COLUMN IF EXISTS` migration, regenerate the Kysely types, and remove the column from `EXCLUDED_*_COLUMNS` (the `satisfies` constraint forces this once the type no longer has the column). Release.

See `postgres/migrations/AGENTS.md` "Dropping columns" for the full workflow.

## Unnecessary Logging

Do not add `wLog` calls for obviously invalid inputs that will return no data (e.g., malformed UUIDs in lookup queries). The `assertValidUuid` guard already short-circuits to an empty result; logging adds noise without value.

*Source: [PR #21309](https://github.com/OpenRouterTeam/openrouter-web/pull/21309)*

## Non-Atomic Multi-Row Operations

When extracting existing non-atomic multi-row operations (e.g., sequential inserts) into `packages/db`, preserve the existing atomicity semantics exactly. Document the non-atomicity gap and wrap in a transaction using `sql.transaction()` where possible.

*Source: [PR #21104](https://github.com/OpenRouterTeam/openrouter-web/pull/21104)*

## Transaction-taking helpers return bare promises

A helper that *accepts* an existing transaction (a `Transaction<DB>` /
`RestrictionTransaction` / `Kysely<DB>` parameter, conventionally named
`db`/`trx`, often suffixed `…InTransaction`) must return a bare `Promise<T>`,
not an `AsyncResult<T, E>`. These helpers run inside a caller-owned
`db.transaction().execute(...)` block; wrapping their own result in a `Result`
forces every call site to unwrap mid-transaction and obscures where the real
error boundary is. Let expected failures surface as the resolved value (e.g.
`Promise<Restriction | null>`) or as a thrown error the enclosing transaction
already handles.

The `AsyncResult` boundary belongs to the *entrypoint* that opens the
transaction (via `dbWrite` / `db.transaction().execute`) and translates the
outcome for callers — e.g. `createRestriction`, `revokeRestriction`,
`updateRestriction`, `enactBanCandidateTarget`. Those correctly return
`AsyncResult`; the inner helpers they call (`createRestrictionInTransaction`,
`reclaimExpiredRestrictionInTransaction`, `insertRestriction`,
`revokeRestrictions`, `updateUserPlanTierInTransaction`, …) return bare
promises.

Narrow exception: a private in-function closure may resolve to a `Result` when
it must carry a *typed* error out through `db.transaction().execute(...)` while
distinguishing it from an ordinary `null`/empty outcome (see the `update`
closure in `updateRestriction`). This applies only to local closures, never to
exported helpers.

*Source: [PR #29603](https://github.com/OpenRouterTeam/openrouter-web/pull/29603)*

## Error Metadata Conventions

When returning typed errors from query functions, follow existing patterns for structured error metadata. Do not invent new error shapes; look at how neighboring functions in the same domain return errors and follow those conventions.

*Source: [PR #21104](https://github.com/OpenRouterTeam/openrouter-web/pull/21104)*

## Document primaryOnly Justification

When using `primaryOnly: true` in `dbRead` calls, verify and document whether there is an actual read-after-write dependency. If the caller does not perform a preceding write in the same flow, prefer the default replica routing. Add a code comment explaining the justification when `primaryOnly` is required.

*Source: [PR #21461](https://github.com/OpenRouterTeam/openrouter-web/pull/21461)*

## Intern credential reuse enforcement

`addInternConnectionCredential` in `packages/db/interns/queries-credentials.ts` intentionally does NOT enforce single-binding for credentials with `can_be_reused = false` (Slack workspace bot, Teams, Discord, Zoom, sandbox — i.e. every per-intern chat install). The binding lives in the `intern_connection_credentials` junction table; the composite primary key `(intern_id, credential_id)` only prevents the same intern from linking the same credential twice, not the same credential from being linked to two different interns.

When adding a new route that attaches a non-reusable chat credential to an intern, the route MUST first check (via `getInternsForCredential`) that no other intern already references the credential, otherwise two interns can silently share the same per-intern install. Reusable credentials (`can_be_reused = true`) like the entity-level GitHub App or Slack admin token are exempt.

`addInternConnectionCredential` also hard-excludes `CredentialType.SlackAdmin` from the EXISTS subquery even though it's `chat`-archetype and `can_be_reused = true`. `slack_admin` is the entity-level Slack configuration token used by the provisioner to mint per-intern Slack apps; it must never land in `intern_connection_credentials`, which workers treat as per-intern bot-install credentials. The `type != 'slack_admin'` predicate is the DB-side backstop for that contract.

*Source: [PR #21697](https://github.com/OpenRouterTeam/openrouter-web/pull/21697)*

## Credential revocation cleanup

`revokeCredential` in `packages/db/interns/credentials/queries.ts` stamps `revoked_at` on the credential row but does **not** remove the matching row from `intern_connection_credentials`. The junction's `ON DELETE CASCADE` only fires on a hard `DELETE` of the credential row, not on the soft-revoke. `getInternsForCredential` joins through the junction without re-checking `intern_credentials.revoked_at`, so it returns interns with stale links until they are explicitly cleaned up.

When a route revokes a **chat-archetype** credential, it MUST also call `getInternsForCredential` and then `N × removeInternConnectionCredential` (one per returned intern) as part of the same flow. The FK columns `vcs_credential_id` and `runtime_credential_id` are handled automatically by `ON DELETE SET NULL`; the gap is specific to the junction, which preserves rows on soft-revoke for audit purposes.

The hard-delete path (e.g. credential cleanup janitor) does NOT need this fan-out: `DELETE FROM intern_credentials WHERE id = ?` cascades through the junction's `ON DELETE CASCADE` and removes every link automatically.

*Source: [PR #21697](https://github.com/OpenRouterTeam/openrouter-web/pull/21697) — perry-the-pr-reviewer.*

## Intern provisioning caps: member and workspace limits

`packages/db/interns/queries.ts` exports two create paths. `createInternWithinCap`
counts the creator's existing rows and the workspace's existing rows and inserts
inside one transaction serialized by `pg_advisory_xact_lock`, refusing past the
independent `MAX_INTERNS_PER_MEMBER` and `MAX_INTERNS_PER_WORKSPACE` limits
(`interns/quota-contract.ts`). The member cap is checked first. The transaction
locks the workspace key first and the creator key second. Every caller must keep
that order to avoid deadlocks. `createIntern` performs the same insert with **no
cap check at all**.

`createIntern` is retained because ~85 integration-test call sites use it to seed rows
without a quota in the way, and because a caller that has already decided an intern may
exist should not re-litigate it. It is not deprecated, so it carries no `@deprecated`
tag — that would warn on every legitimate seed.

**In review: flag any new production caller of `createIntern`.** Routes and workers
create interns on a user's behalf and must go through `createInternWithinCap`; a
`createIntern` call on a request path silently reinstates the unlimited provisioning
this cap exists to close. Today the only production caller of either is
`services/cfw-frontend-api/src/routes/labs/interns/route.ts`, which uses the capped path.

Do not "fix" this by re-checking the count in the route before calling `createIntern` —
a `SELECT count(*)` followed by a separate `INSERT` lets two concurrent creates both
pass a cap of N and land N+1. The count and the insert have to share the transaction.

*Source: [PR #36245](https://github.com/OpenRouterTeam/openrouter-web/pull/36245)*

## `interns ↔ intern_credentials` is a junction table, not an array column

Intern-to-credential links live in `intern_connection_credentials (intern_id, credential_id, creator_user_id, created_at)` with real foreign keys (both `ON DELETE CASCADE`), not in a `UUID[]` column on `interns`. The junction is deliberate, and a PR that reintroduces an array column for these links should be rejected:

1. **Referential integrity**: a junction row cannot point at a non-existent intern or credential, and a hard-deleted credential automatically detaches every link.
2. **Per-link audit**: `creator_user_id` records the teammate who attached the credential to this specific intern (matches `organization_members_guardrails`, `presets`, `auth_codes`).
3. **Reverse lookup hygiene**: `getInternsForCredential` is a typed `JOIN`, not an `array_contains` filter against a GIN index.

The `SELECT` shape follows from this: `getInternsForEntity`, `getInternByIdForEntity`, and `getInternByIdForEntityWithProgress` materialise `connectionCredentialIds: string[]` via an `array_agg` correlated subquery to keep their public-API shape without N+1 fan-outs; the cost is one subquery per row, served by the index on `intern_connection_credentials(credential_id)`.

Per-link `created_at` / `creator_user_id` on rows backfilled from the earlier array column default to the owning intern's values, so per-link history from before the backfill is not reliable.

## Usage columns live in Spanner, not Postgres

Postgres holds no usage columns and no trigger maintains usage. `analytics_users`, `api_keys`, and `analytics_organization_members` have none of `total_usage`, `usage`, `usage_daily/weekly/monthly`, `usage_updated_at`, `total_byok_usage_inference`, `byok_usage_inference_daily/weekly/monthly`, `requests_byok_monthly`, `requests_free_daily`, or the `pre_cutover_*` family. Flag a migration or query that reintroduces or reads any of them.

Usage fields are populated exclusively by the Spanner overlay (`overlaySpannerUsage` in `services/cfw-api/src/routes/keys/usage-overlay.ts` and its per-route siblings). The `UserAnalytics`, `APIKey`, and `DBAnalyticsOrganizationMember` types re-declare these fields with a comment noting the Spanner source.

*Source: [PR #21420](https://github.com/OpenRouterTeam/openrouter-web/pull/21420)*

## `timestamptz` through `to_jsonb` serializes as `+00:00`, not `Z`

A `timestamptz` column selected through `to_jsonb(...)` / `row_to_json(...)` (for example the `to_jsonb(u) AS user` projection in `auth/get-user-by-key.ts`) reaches consumers as `2027-08-22T02:29:24.819+00:00`. Zod's `z.string().datetime()` and `z.iso.datetime()` reject numeric offsets by default, so a consumer schema on that projection passes while the column is `NULL` and fails the first time a row is populated.

Flag when either side changes:

- A migration that adds a `timestamptz` column to a table exposed through a JSON projection: find every schema that validates that projection (grep the field name across `services/` and `packages/`) and confirm each timestamp field uses `.datetime({ offset: true })`, with a `+00:00` fixture in its test.
- A new consumer schema for a DB-projected object: same requirement, do not copy `Z`-only fixtures from client-facing schemas.

*Source: [PR #40381](https://github.com/OpenRouterTeam/openrouter-web/pull/40381)*

## User deletion: no `original_clerk_user_id`

`user_deletions` has no `original_clerk_user_id` column and must not get one back — it would retain PII indefinitely. The trigger uses the `clerk_user_id` (NULLed on completion) and `replacement_user_id` arms. The dedup index is `WHERE status NOT IN ('cancelled', 'completed')` — ON CONFLICT predicates in `queries.ts` must match exactly.

*Source: [PR #22916](https://github.com/OpenRouterTeam/openrouter-web/pull/22916)*

## OpenRouter key envelope lives in typed columns, not `interns.metadata`

`interns.openrouter_key_hash TEXT` (sha256 of the raw `sk-or-*` secret) and `interns.openrouter_key_encrypted JSONB` (`{ciphertext, nonce}` envelope encrypted with `PROVIDER_ENCRYPTION_KEY`) are dedicated columns, read together with the typed `openrouter_key_id` FK by the provisioner worker (`services/cfw-intern-provisioner`) on every VM bootstrap. A typed column projection is cheaper (no JSON path expressions, no Zod parsing of the catch-all bag for fields that are conceptually first-class) and safer (the column type encodes the shape rather than relying on schema convention) than the `interns.metadata` JSONB bag.

Consequences for callers:

- `PublicIntern` omits `openrouterKeyHash` and `openrouterKeyEncrypted` entirely — these are server-side secrets, not API surface. `toPublicIntern` destructures them out before serializing.
- `InternMetadataSchema` and the worker-side `InternMetadataMirrorSchema` do not list `openrouter_key_hash` / `openrouter_key_encrypted`. Other fields may be added to `metadata`, but the OpenRouter key envelope must never go into the JSONB bag.
- `upsertInternOpenrouterKey` is a single `UPDATE interns SET openrouter_key_id = ?, openrouter_key_hash = ?, openrouter_key_encrypted = ?`, not an FK update followed by a `patchInternMetadata` round-trip.

## Task-type taxonomy lives in `packages/db`, not `packages/classifier`

`classifiers/task-type-taxonomy.ts` is the single source of truth for the task-type tag set, consumed by both the internal `TaskTypeClassifier` (`packages/classifier`) and the customer-facing "Task type" gallery preset (`classifiers/classifier-presets.ts` / `dimension-library.ts`). It is deliberately placed in `packages/db` so the preset and dimension library can import it without `packages/db` depending on `packages/classifier` (which would be a circular dependency). `packages/classifier/constants.ts` re-exports `TaskTypeTag` / `TASK_TYPE_TAGS` from here rather than defining them.

When adding, removing, or renaming a tag, edit only `task-type-taxonomy.ts` — both the classifier prompt and the preset dimension values derive from it, and a sync test (`packages/classifier/classifiers/task-type-preset-sync.test.ts`) enforces that they stay aligned. Note that adding tags can push the preset past `MAX_VALUES_PER_DIMENSION` (35 in `classifiers/index.ts`, sized to the current taxonomy).

## Restrictions and ban-candidate writes

Restriction mutations must use the typed restriction layer and append the
audited changelog entry in the same write transaction. Legacy moderation
paths may shadow-write best-effort, but request auth context overlays active
restrictions without an extra query and merges limits conservatively.
Ban-candidate approve and deny writes use optimistic concurrency; do not
silently overwrite a newer review decision.
