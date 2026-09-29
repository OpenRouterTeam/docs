# Spanner Migration Review Guidelines

Flag these patterns when reviewing any PR that adds or
changes files in this directory.

## 1. File Naming and Structure

- New migration files must use the next zero-padded
  six-digit sequence number — flag gaps or duplicate
  numbers.
- Each file must start with a comment explaining why the
  change is needed.

## 2. Idempotent DDL

Use idempotent clauses where Spanner supports them
(`CREATE INDEX IF NOT EXISTS`, `DROP INDEX IF EXISTS`, ...).
Flag non-idempotent DDL that has an idempotent equivalent.

## 3. Secondary Indexes Must Use the `ssd_indexes` Locality Group

Every new secondary index must specify
`OPTIONS (locality_group='ssd_indexes')`:

```sql
CREATE INDEX IF NOT EXISTS my_new_index
  ON my_table(col_a, col_b)
  OPTIONS (locality_group='ssd_indexes');
```

Without an explicit locality group, an index inherits its
base table's storage. The `generations` base table lives in
the `generations_spill_to_hdd` locality group, which spills
old rows to HDD — an index on it without
`locality_group='ssd_indexes'` would spill to HDD too and
slow down index-backed reads. Flag any `CREATE INDEX`
missing the locality group option, especially on tables in
HDD-spill locality groups.

## 4. Index Key Design (Hotspots and Commit Timestamps)

Per the [Spanner secondary index docs](https://docs.cloud.google.com/spanner/docs/secondary-indexes):

- Flag indexes whose leading key part is a monotonically
  increasing value (e.g. a timestamp or sequential ID) —
  this creates a write hotspot on a single split. Prefer
  leading with a well-distributed column.
- Flag indexes on columns with `allow_commit_timestamp=true` —
  Spanner does not allow indexing commit-timestamp columns.

## 5. Validation scans on `generations`

Do not make schema changes to the existing `generations` table that
require validation or backfill of every existing row, including
non-`NULL` defaults, check constraints, foreign keys, stored generated
columns, required columns, or `ALTER COLUMN` changes that make a column
required or enable commit timestamps. On
`generations`, this can take on the order of a week and leave the column
unusable. Add new columns nullable and coalesce defaults on the read path.
Review type or length changes manually to confirm they widen the existing
type; narrowing or changing a type can also require a full validation scan.
This rule is enforced by the Spanner migration lint; use
`-- lint:disable spanner-generations-validation-scan` only for a documented
exception.
