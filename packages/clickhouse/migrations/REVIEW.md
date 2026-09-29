# ClickHouse Migration Guidelines

## Drop order for versioned tables

When dropping versioned materialized views and tables, drop daily MVs/tables **before** minutely ones. Daily MVs may depend on minutely data, so removing them first avoids dependency errors. Within each pair, drop the MV before its backing table.

Example ordering (see `103_drop_user_activity_v5.sql`):
```sql
DROP VIEW IF EXISTS default.user_activity_daily_v5_mv;
DROP TABLE IF EXISTS default.user_activity_daily_v5;
DROP VIEW IF EXISTS default.user_activity_minute_v5_mv;
DROP TABLE IF EXISTS default.user_activity_minute_v5;
```

## Batch column-adds into one statement; don't split them across statements

Prefer adding related columns in a **single** `ALTER TABLE … ADD COLUMN IF NOT EXISTS …, ADD COLUMN IF NOT EXISTS …` statement in one migration file. Within a single `ALTER`, ClickHouse resolves each `AFTER <col>` against columns added earlier in the same statement, so you can chain `AFTER` clauses to control physical order.

The failure mode (`NO_SUCH_COLUMN_IN_TABLE`) only happens when a **separate** `ALTER TABLE` statement references a column added by an earlier statement — each statement runs on its own, so the later one can't see the not-yet-committed column.

**Bad** — two separate statements in one file (`131_add_response_data_to_gateway_benchmarks.sql`):
```sql
ALTER TABLE default.gateway_benchmark_results
  ADD COLUMN IF NOT EXISTS response_headers JSON DEFAULT '{}' CODEC(ZSTD(3))
  AFTER error;

ALTER TABLE default.gateway_benchmark_results
  ADD COLUMN IF NOT EXISTS response_body Nullable(String) CODEC(ZSTD(3))
  AFTER response_headers;  -- ERROR: response_headers not found
```

**Good** — one statement, multiple `ADD COLUMN … AFTER` clauses:
```sql
ALTER TABLE default.gateway_benchmark_results
  ADD COLUMN IF NOT EXISTS response_headers JSON DEFAULT '{}' CODEC(ZSTD(3)) AFTER error,
  ADD COLUMN IF NOT EXISTS response_body Nullable(String) CODEC(ZSTD(3)) AFTER response_headers;
```

## Never modify an applied migration

`clickhouse-migrations` stores an MD5 checksum for every applied migration. Changing the contents of a file that has already been applied causes a checksum mismatch error and blocks all subsequent migrations. To undo or alter the effect of an applied migration, create a new forward migration instead.

## Keep endpoint performance workload separate from protocol

`endpoint_perf_v5` stores both `perf_workload` and `api_type` because they answer different questions:

- `perf_workload` selects the measured operation, its admission rule, its published speed metric, and throughput eligibility.
- `api_type` records the writer or protocol used for the request.

An image returned through Chat Completions therefore has `perf_workload = 'image_generation'` and `api_type = 'completions'`. Unknown API types classify to `unknown` and fail admission until their timing semantics are reviewed. Keep the minute MV, daily MV, future backfill, and workload tests on the same classifier and bucket definitions.
