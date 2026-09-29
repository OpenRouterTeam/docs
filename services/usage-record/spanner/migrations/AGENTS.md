# Spanner migration conventions

Migrations for the usage-record Spanner database, applied
with [wrench](https://github.com/cloudspannerecosystem/wrench)
in ascending file order (`000001.sql`, `000002.sql`, ...).

Locally, run them against the emulator with:

```bash
bun run spanner:migrate
```

## Conventions

- Name files with the next zero-padded six-digit sequence
  number.
- Use idempotent DDL where Spanner supports it
  (`CREATE INDEX IF NOT EXISTS`, `DROP INDEX IF EXISTS`, ...).
- Start each file with a comment explaining why the change
  is needed.
- Avoid schema changes to the existing `generations` table that trigger
  validation or backfill of every existing row, including non-`NULL` defaults
  and foreign keys; the migration lint rejects these changes.
  Add new columns nullable and coalesce defaults on the read path.
- When adding written columns or indexes to `generations` or other tables written in the same Dataflow transaction, follow the [mutation-budget check](../../dataflow/AGENTS.md#spanner-mutation-limit-bounds-batch-sizes) in the same PR. Spanner's 80,000-mutation limit applies cumulatively to Mutation API writes per commit, but separately to each DML statement. The existing batch-size test uses a hard-coded estimate and does not detect schema growth automatically.

## Secondary indexes and locality groups

All new secondary indexes must be created in the
`ssd_indexes` locality group (created in `000045.sql`) so
index data stays on SSD storage:

```sql
CREATE INDEX IF NOT EXISTS my_new_index
  ON my_table(col_a, col_b)
  OPTIONS (locality_group='ssd_indexes');
```

Without an explicit locality group, an index inherits its
base table's storage. The `generations` base table lives in
the `generations_spill_to_hdd` locality group, which spills
rows older than the configured spill timespan to HDD, so
an index on it without `locality_group='ssd_indexes'`
would spill to HDD too and slow down index-backed reads.

The same applies to any table moved to an HDD-spill locality
group in the future: keep its secondary indexes in
`ssd_indexes` so index data stays on SSD even when the base
table's cold rows roll off to HDD.

When designing a secondary index, also follow the
[Spanner secondary index docs](https://docs.cloud.google.com/spanner/docs/secondary-indexes):

- **Avoid hotspots.** Do not lead the index key with a
  monotonically increasing value (e.g. a timestamp or
  sequential ID) — all writes land on the same split. Lead
  with a well-distributed column and put the timestamp later
  in the key, or if a timestamp must lead, store it in
  descending order and/or shard the key.
- **No commit timestamps.** Columns with
  `allow_commit_timestamp=true` cannot be indexed.
