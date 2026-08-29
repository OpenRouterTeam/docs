---
name: seed-activity-explorer-data
description: Seed deterministic ClickHouse usage data for a specific Clerk user and workspace so Activity Explorer verification has predictable top-N, Other, granularity, and export data.
---

# Seed Activity Explorer data

The Activity pages read from ClickHouse. A fresh local stack can therefore
show no activity until rows are seeded.

## Prerequisites

1. Start a lean stack with the web app and frontend API:
   `TILT_PROFILE=lean tilt up -- web frontend-api`
   ClickHouse and its migrations start as dependencies. Export `INFISICAL_TOKEN`
   before starting Tilt so Postgres migrations can authenticate.
2. Sign in through the Clerk dev sign-in token flow.
3. Record both the Clerk user ID and workspace ID. Rows are filtered by both.

## Seed deterministic data

Run the committed seeder from the repository root:

```bash
cd packages/clickhouse
env CLICKHOUSE_URL=http://localhost:8123 \
    CLICKHOUSE_USERNAME=default CLICKHOUSE_PASSWORD=clickhouse \
    PG_US_CENTRAL1_POOL_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
    bun run x scripts/seed-user-activity.ts \
      --clerkUserId=user_... \
      --workspaceId=... \
      --fromDate=2026-08-01 \
      --toDate=2026-08-12 \
      --nModels=15 \
      --emptyDays=3,7 \
      --seed=activity-explorer
```

`--nModels` defaults to 15 when omitted. `emptyDays` is a comma-separated
list of zero-based day indexes from `fromDate`. The deterministic mode skips
today even when today falls inside the requested range. Omit all deterministic
arguments to preserve the existing random all-users seed used by the Tilt
`clickhouse:seed-activity` button.
The deterministic command is safe to re-run. Before inserting, it clears only
the selected user's selected workspace and the requested date window's past
portion from both the minute and daily Activity tables. Today and later dates
are never cleared, so pre-existing current-day rows survive a re-run. If the
requested window starts today or later, no delete mutation is issued.
If the numbers look 2x, the data was seeded with an older build that appended
rows. From `packages/clickhouse`, `bun run ch:clean` is the blunt full reset.

To prove the clear is scoped rather than global, seed a second control window
for the same user and workspace (see the 35-day TTL note below), re-seed the
first window, and confirm the control window's row count and `sum(usage)` are
unchanged.

The no-argument legacy path seeds every user over a full year and can exhaust a
small local ClickHouse: it may exit non-zero with
`(total) memory limit exceeded ... maximum: 921.60 MiB` from an insert. The
container is capped around 1 GiB by default, so raising that cap (or accepting
the partial seed) may be the workaround. It only appends, so a failure does not
delete existing rows, and deterministic mode is unaffected.

The deterministic command fails with a nonzero exit status when no endpoints
are available and reports that local setup is incomplete. The legacy no-args
path keeps its existing best-effort behavior.

The dataset should contain 15 distinct models. The first 10 have large daily
values and the remaining 5 have small values that vary by day, placing them
in the chart's top-N `Other` bucket. Empty days exercise bucket backfilling,
and the no-today rule prevents current-day rows from changing the result while
you verify it.

## Confirm the rows landed in ClickHouse

Two query traps when checking counts directly:

- In `user_activity_minute_v7`, `date` is a `DateTime` carrying a minute
  offset, so `date <= 'YYYY-MM-DD'` silently drops that final day. Use
  `date < '<toDate + 1 day>'`. The daily table's `date` is a real `Date`.
- That table has `TTL date + 35 days`. Control or comparison windows older
  than ~35 days survive only in `user_activity_daily_v7`; pick a recent
  window if you need minute-level rows.

Allow a few seconds after seeding before querying — the materialized view
propagation and part merges are not instantaneous, so an immediate count can
read low.

## Verify Activity Explorer

- Open `/activity/explore` after signing in.
- **Freshly seeded numbers can look stale.** The analytics response is cached
  server-side per user and query for 5 minutes (1 minute for minute
  granularity) — see `getCacheTtlFromGranularity` in
  `services/cfw-public-api/src/routes/analytics/utils.ts`. A normal or hard
  reload does not bypass it. Either wait out the TTL, or change any control
  that alters the request (for example the `Top` selector) to force a cache
  miss. Budget for this before concluding a seed did not work.
- Set a daily, weekly, or monthly rollup from `Rollup: Total`.
- Enable `Show "Other"` from the popover with
  `aria-label="Chart display settings"` and `#show-other-toggle`.
- Check the aggregate table's Min, Max, Avg, Sum, `Current Period`/`Latest
  Period`, and `% of Total` against the expected tail-model totals.
- Use `Download CSV` and verify the empty day and no-today behavior.
- Chrome refuses to render downloaded CSV files through `file://` with
  `ERR_ABORTED`. Copy the file to `.txt` before opening it in Chrome.

Granularity truncates the chart to one dimension. Classifier primary
dimensions require an account with configured classifiers and may be
unavailable on a fresh development account.
