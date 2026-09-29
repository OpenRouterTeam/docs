# ClickHouse Migrations — Agent Guidelines

See the root [AGENTS.md](../../../AGENTS.md) for repo-wide rules and
[REVIEW.md](./REVIEW.md) for detailed examples.

## Key rules

1. **Batch related column-adds into a single statement.**
   Prefer one `ALTER TABLE … ADD COLUMN IF NOT EXISTS …, ADD COLUMN
   IF NOT EXISTS …` statement in a single migration file over a
   separate migration per column. `AFTER` is safe within that
   statement — ClickHouse resolves each `AFTER <col>` against
   columns added earlier in the same `ALTER`, so you can chain
   `ADD COLUMN <b> … AFTER <a>, ADD COLUMN <c> … AFTER <b>` to
   control physical order. Example:

   ```sql
   ALTER TABLE default.events
       ADD COLUMN IF NOT EXISTS provider_id UInt32 DEFAULT 0,
       ADD COLUMN IF NOT EXISTS latency_ms UInt16 AFTER provider_id,
       ADD COLUMN IF NOT EXISTS model_slug LowCardinality(String) AFTER latency_ms;
   ```

2. **Never modify an applied migration.**
   `clickhouse-migrations` checksums every applied file. Editing
   an already-applied `.sql` file breaks all subsequent runs.
   Always create a new forward migration to undo or change
   prior schema.

3. **Drop order: daily before minutely.**
   When dropping versioned MVs/tables, drop daily MVs/tables
   before minutely ones to avoid dependency errors. Within each
   pair, drop the MV before its backing table.

4. **Use `IF EXISTS` / `IF NOT EXISTS`.**
   All DDL must be idempotent so re-runs are safe.

5. **Wait for dependent metadata changes.**
   Set `alter_sync=2` at the top when statements depend on
   metadata written earlier in the same file or run. Cloud's
   default of `0` can cause code 517 `CANNOT_ASSIGN_ALTER` or
   `UNKNOWN_IDENTIFIER` failures on lagging replicas.

6. **Sequentially number files.**
   Check for the latest migration number on `main` **and** in
   open PRs before choosing a number — duplicate numbers cause
   collisions on merge.
