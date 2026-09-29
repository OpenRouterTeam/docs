# Postgres Migration Review Guidelines

## Lock Analysis

For any PR that adds files here, check that the PR description and the top of each migration file (as SQL comments) include the extracted locks and a prod-risk assessment per the "Lock analysis" section of `postgres/migrations/AGENTS.md`. Flag dangerous lock modes (ACCESS EXCLUSIVE, EXCLUSIVE, SHARE ROW EXCLUSIVE, SHARE) on tables that already exist in prod, especially hot inference/auth-path tables.

## Column renames

Flag any `RENAME COLUMN` (or `RENAME TABLE`, `ALTER COLUMN ... TYPE`, `SET NOT NULL`) on a table that already exists in prod. These are not safe in a single release: migrations run before the app deploy, so the old release queries a column that no longer exists and every page or endpoint whose query touches that table fails — including surfaces where the column sits behind an inactive feature flag or entitlement check. Require the sequence from the "Never rename a column" section of `postgres/migrations/AGENTS.md`: add the new column and double-write, backfill, switch reads, then drop the old column and the double-write, each released separately. "The column is unused in prod" is not an exemption — request the split.

Also flag any migration that backfills a large existing table (`users`, `api_keys`, `transactions`, `endpoints`) with a single `UPDATE`. The cost is the scan, not the number of rows updated, so a `WHERE` clause over an unindexed column still reads the whole table and a `statement_timeout` failure takes down the entire migration run. Ask the author either to show the statement is bounded (an index serves the predicate and few rows match) or to move the copy into a batched, resumable backfill script keyed on the PK with a `WHERE <new_column> IS NULL` guard.

## COMMENT ON

For any PR that adds a `CREATE TABLE` or an `ADD COLUMN`, check that the migration also includes a `COMMENT ON TABLE` and a `COMMENT ON COLUMN` for every new column, per the "COMMENT ON for new tables and columns" section of `postgres/migrations/AGENTS.md`. Flag comments that only restate the column name, and missing comments on the things a reader cannot infer from the DDL: what a row represents, what the finite literal values of a text or check-constrained column mean, why a column is nullable, why an expected foreign key is absent, and whether the column is PII scrubbed by the DSR job.

## New tables on inference paths

Postgres is the wrong store for anything written at the volume of inference requests (`/chat/completions`, `/completions`, embeddings, or any request-serving endpoint). When reviewing a `CREATE TABLE`, ask whether rows will be inserted or updated O(inference requests); if so, that data belongs in the usage-record pipeline, ClickHouse, Spanner, KV, or another high-write-volume store, written from a background job or post-response hook rather than synchronously during request serving. This is the schema-level counterpart to the "No database writes in inference paths" rule in the root `AGENTS.md`.
