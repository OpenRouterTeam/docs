# SpendGuard outcome query: accounts crossing zero while enforcing

The guard's success criterion — accounts stop crossing below \$0 while
SpendGuard is enforcing — is measured from ClickHouse balances and usage, not
from the operational `openrouter.spend_guard.*` Datadog metrics. It is a
query/dashboard artifact by design, **not a paging monitor**: balances are
reconstructed from a daily snapshot plus post-snapshot credits and usage, so
the signal trails settlement by minutes-to-hours and would page on stale data.

## Semantics

An entity "crossed zero during the window" when its reconstructed balance was
`>= 0` at `{window_start}` and `< 0` at `{window_end}`. Reconstruction follows
the same tables as `packages/clickhouse/negative-balance-usage/queries.ts`:

- `analytics.dim_users` — daily balance snapshot (`outstanding_balance`,
  `balance_as_of_date`)
- `analytics.stg_credits` — credits granted after the snapshot
- `default.user_activity_minute_v7` — per-minute usage spend after the
  snapshot

Per-entity enforcement state is only a Datadog tag (`enforcement:enforce` on
`openrouter.spend_guard.reserve.*`), not a ClickHouse column, so scope the
window to a period where enforcement was active (the live-config rollout
window). Compare the count against an equal-length pre-enforcement window to
read the guard's effect.

The definition is endpoint-only: an account that dipped below zero inside the
window and was topped up before `{window_end}` is not counted. That masking is
asymmetric between the two comparison windows — under enforcement, denied
requests return 402s that prompt top-ups, so the enforcement window hides more
of its crossings than the pre-enforcement baseline does. Keep windows short
(an hour, not a day) to bound the masking, and read a small enforcement-window
count as an upper-bound improvement, not an exact one.

The population is restricted to accounts SpendGuard can actually gate,
mirroring the eligibility filters in
`packages/clickhouse/negative-balance-usage/queries.ts`: the gate
(`packages/rate-limit/spend-guard-gate.ts`) exempts billed-in-arrears
accounts, nonzero negative-balance limits, credit-pool-funded requests, and
positive autobuy negative-balance extensions, and the rollout-only age regime
additionally restricts gating to accounts younger than `NEW_ACCOUNT_AGE_DAYS`
(7, `packages/rate-limit/new-account-rate-limit.ts`) and excludes enterprise
accounts. Counting exempt accounts would inflate both windows with crossings
the guard was never allowed to prevent, and the age bound is the dominant
filter: dropping it roughly doubles the crossing count (7,153 accounts against
4,254 over the validation window below).

The age bound is applied as `created_at > window_start - INTERVAL 7 DAY`, so
the population is every account that was inside the age regime at some point
in the window rather than at the instant it crossed. That direction
over-counts slightly and keeps the filter comparable between the enforcement
and baseline windows.

One gate exemption is deliberately not reproduced. The paid-subscription
exemption (`getNewAccountRegimeExemption`, plan in `pro`/`enterprise`)
resolves plan tiers through KV at request time, and the mart column that looks
equivalent is not usable as a substitute: `analytics.stg_users` has
12,475,665 non-deleted rows whose `subscription_plan` is `standard`, 50
`enterprise`, 40 `business` and 3 `pro`, and zero rows of any plan have
`subscription_plan_expires_at` in the future. Enterprise accounts are excluded
via `is_enterprise`; the residual paid-plan population is at most tens of
accounts and is left in.

The flags are read at query time, not as of the window, so an account whose
eligibility changed between the window and the run can be misclassified —
another reason to run promptly after the window closes.

## Query

Run against the ClickHouse analytics cluster. Substitute `{window_start}` /
`{window_end}` (UTC `YYYY-MM-DD hh:mm:ss`) with the enforcement window.

```sql
WITH
  toDateTime('{window_start}', 'UTC') AS window_start,
  toDateTime('{window_end}',   'UTC') AS window_end,
  -- Constant scan bound so ClickHouse can prune granules: the balance
  -- snapshot is daily, so post-snapshot credits/usage are at most days old,
  -- and never-snapshotted accounts are new. Widen if snapshots are stale.
  window_start - INTERVAL 45 DAY      AS scan_start,

  -- Accounts SpendGuard exempts (never gated): autobuy-extension and active
  -- credit-pool entities, mirroring negative-balance-usage/queries.ts.
  auto_top_up_entities AS (
    SELECT DISTINCT clerk_user_id AS clerk_user_id
    FROM analytics.stg_triggers
    WHERE type = 'autobuy'
      AND disabled = false
      AND _peerdb_is_deleted = 0
  ),

  credit_pool_entities AS (
    SELECT DISTINCT clerk_user_id AS clerk_user_id
    FROM analytics.stg_credit_pools
    WHERE disabled = false
      AND _peerdb_is_deleted = 0
      AND expires_at > window_end
  ),

  -- Credits granted after each entity's balance snapshot, split at the two
  -- window boundaries. Credits and usage are aggregated in separate CTEs so
  -- the two one-to-many relations never fan out against each other. dim_users
  -- is LEFT JOINed: entities with no snapshot row yet or NULL snapshot
  -- columns (new accounts, the prime burst-overspend cohort) count all their
  -- credits and usage and reconstruct from a zero base, mirroring the
  -- activity-anchored population in
  -- packages/clickhouse/negative-balance-usage/queries.ts.
  post_snapshot_credits AS (
    SELECT
      c.clerk_user_id                               AS clerk_user_id,
      sumIf(c.amount, c.created_at < window_start)  AS credited_before_start,
      sum(c.amount)                                 AS credited_before_end
    FROM analytics.stg_credits AS c
    LEFT JOIN analytics.dim_users AS d
      ON d.clerk_user_id = c.clerk_user_id
    WHERE c._peerdb_is_deleted = 0
      AND (
        d.balance_as_of_date IS NULL
        OR toDate(c.created_at) > d.balance_as_of_date
      )
      AND c.created_at >= scan_start
      AND c.created_at < window_end
    GROUP BY c.clerk_user_id
  ),

  post_snapshot_usage AS (
    SELECT
      a.clerk_user_id                        AS clerk_user_id,
      sumIf(a.usage, a.date < window_start)  AS spent_before_start,
      sum(a.usage)                           AS spent_before_end
    FROM default.user_activity_minute_v7 AS a
    LEFT JOIN analytics.dim_users AS d
      ON d.clerk_user_id = a.clerk_user_id
    WHERE a.date >= scan_start
      AND a.date < window_end
      AND toDate(a.date) > coalesce(d.balance_as_of_date, toDate('1970-01-01'))
    GROUP BY a.clerk_user_id
  ),

  -- Population anchored on activity/credits, not the mart: an account created
  -- after the last daily mart build has no dim_users row, and an entity with
  -- neither post-snapshot credits nor usage cannot have crossed zero inside
  -- the window.
  entities AS (
    SELECT clerk_user_id FROM post_snapshot_credits
    UNION DISTINCT
    SELECT clerk_user_id FROM post_snapshot_usage
  )

SELECT
  e.clerk_user_id AS entity,
  coalesce(toFloat64(d.outstanding_balance), 0)
    + coalesce(c.credited_before_start, 0)
    - coalesce(u.spent_before_start, 0)  AS balance_at_start,
  coalesce(toFloat64(d.outstanding_balance), 0)
    + coalesce(c.credited_before_end, 0)
    - coalesce(u.spent_before_end, 0)    AS balance_at_end
FROM entities AS e
LEFT JOIN analytics.dim_users AS d
  ON d.clerk_user_id = e.clerk_user_id
LEFT JOIN post_snapshot_credits AS c
  ON c.clerk_user_id = e.clerk_user_id
LEFT JOIN post_snapshot_usage AS u
  ON u.clerk_user_id = e.clerk_user_id
INNER JOIN analytics.stg_users AS s
  ON s.clerk_user_id = e.clerk_user_id
WHERE coalesce(d.deleted, false) = false
  AND s.deleted = false
  AND s._peerdb_is_deleted = 0
  AND s.allow_negative_balance = false
  AND coalesce(s.negative_balance_limit, 0) = 0
  AND s.is_enterprise = false
  AND coalesce(s.is_billed_in_arrears, false) = false
  -- Rollout-only age regime: SpendGuard only gates accounts younger than
  -- NEW_ACCOUNT_AGE_DAYS (7). Without this the count roughly doubles with
  -- crossings by accounts the guard never gated.
  AND s.created_at > window_start - INTERVAL 7 DAY
  AND e.clerk_user_id NOT IN (SELECT clerk_user_id FROM auto_top_up_entities)
  AND e.clerk_user_id NOT IN (SELECT clerk_user_id FROM credit_pool_entities)
  AND balance_at_start >= 0
  AND balance_at_end < 0
ORDER BY balance_at_end ASC
```

The reconstruction mirrors the battle-tested CTE structure in
`packages/clickhouse/negative-balance-usage/queries.ts`
(`post_snapshot_credits`, `post_snapshot_usage`, activity-anchored
population). `scan_start` bounds both scans with a constant so ClickHouse can
prune granules; the 45-day lookback covers daily-snapshot lag plus
never-snapshotted new accounts — widen it when snapshots are stale or when
auditing accounts older than the lookback with no snapshot.

Run the query promptly after the window closes: the post-snapshot filters
compare against each entity's latest `balance_as_of_date`, so once the daily
snapshot advances past `window_start` the reconstruction no longer isolates
the window. Validated 2026-08-19 against the analytics cluster with a
positive control: over the pre-enforcement window `2026-08-18 14:00:00`–
`2026-08-19 14:00:00` UTC the query detects eligible accounts crossing from
`>= 0` to `< 0` (~28s), the worst ending at roughly -$2,132 — real crossings
the guard is meant to prevent, confirming detection, not just that the query
parses. A quiet-hour window (`2026-08-18 00:00:00`–`01:00:00` UTC) returned 0
rows the same day. Re-measured 2026-08-20 over the same window with the age
bound added: 4,254 crossings inside the age regime against 7,153 across all
account ages.

`analytics.dim_users` is one row per `clerk_user_id` (12,474,609 rows,
12,474,609 distinct ids, `SharedMergeTree` sorted by `clerk_user_id`, measured
2026-08-20), so the snapshot joins in the two CTEs do not fan out credits or
usage. Re-check that if the mart ever gains history rows, because the
reconstruction would then double-count.

The SpendGuard Datadog dashboard (`spend_guard.dashboard.json`, section 5) carries a note
widget pointing here; there is no ClickHouse datasource in our Datadog org, so
the query cannot be embedded as a live widget.
