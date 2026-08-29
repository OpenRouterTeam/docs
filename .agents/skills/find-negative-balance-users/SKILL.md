---
name: find-negative-balance-users
user-invocable: true
description: Query the ClickHouse analytics cluster for users whose current (intraday-corrected) balance is negative, using the same balance-correction and eligibility logic as the negative-balance-usage-sync cron. Use when asked who currently has a negative balance, how far in the red an account is, or to pull a fresh overspender list for a fraud/ban investigation.
---

# Find users with negative balance in ClickHouse

Goal: list accounts whose live balance is below a threshold right now, matching
the semantics of the `negative-balance-usage-sync` cron
(`services/cfw-internal/src/routes/cron/negative-balance-usage-sync.ts`), whose
SQL lives in `packages/clickhouse/negative-balance-usage/queries.ts`.

The copy here is one-way: nothing in `queries.ts` knows it exists. Diff the two
before trusting results, so an eligibility-filter change there does not strand
this query silently.

## How the balance is computed

`analytics.dim_users.outstanding_balance` is a daily mart snapshot, so it is
corrected to a live value exactly as the cron does:

```
balance = dim_users.outstanding_balance          (snapshot, may lag ~1 day+)
        + post-snapshot credits                  (analytics.stg_credits, fresh)
        - post-snapshot usage                    (default.user_activity_minute_v7, fresh)
```

Credits count only from the day after `balance_as_of_date` (same-day credits
are already inside the snapshot), and the credit lookback follows the oldest
snapshot in the mart, clamped to 3–30 days, so a stalled mart cannot
double-count a top-up or make the scan unbounded.

Excluded accounts, matching the cron's eligibility filters: deleted users,
`allow_negative_balance`, non-zero `negative_balance_limit`, enterprise,
billed-in-arrears, active autobuy triggers (`analytics.stg_triggers`), and
active credit pools (`analytics.stg_credit_pools`).

One deliberate difference from the cron: the cron only looks at entities active
in its most recent five-minute bucket. This skill's candidate set is instead
"below `max(threshold, 0)` in the mart snapshot" UNION "any activity since the
snapshot", so it answers "who is negative right now" rather than "who is
spending while negative".

## Devin Secrets Needed

- `CLICKHOUSE_URL`
- `CLICKHOUSE_READONLY_USER`
- `CLICKHOUSE_READONLY_PASSWORD`

(Usually already in the session environment.)

## Run it

`negative-balance-users.sql` in this skill directory is the query. Parameters:
`threshold` (balance floor in USD, e.g. `-10`; use `0` for all negatives) and
`row_limit`.

```bash
curl -sS "${CLICKHOUSE_URL%/}/?default_format=PrettyCompact&param_threshold=-10&param_row_limit=100" \
  -H "X-ClickHouse-User: $CLICKHOUSE_READONLY_USER" \
  -H "X-ClickHouse-Key: $CLICKHOUSE_READONLY_PASSWORD" \
  --data-binary @.agents/skills/find-negative-balance-users/negative-balance-users.sql
```

Takes ~10-20s, whatever the sign of `threshold`. Use
`default_format=TSVWithNames` (or `CSVWithNames`) for machine-readable output.
Returns `clerk_user_id`, corrected `outstanding_balance`, `email`, `signup_at`,
most negative first.

Need ring/fraud evidence columns (signup IP hash, JA4, ASN, bot score, etc.)?
Add columns from `ENTITY_SIGNAL_COLUMNS` in
`packages/clickhouse/negative-balance-usage/queries.ts` to the final SELECT —
they all come from the already-joined `analytics.stg_users`. Three of them —
`outstanding_balance`, `email`, `signup_at` — are already in the final SELECT,
so don't re-add them (`outstanding_balance` is not an `stg_users` column at all;
it is computed from `dim_users` plus the correction CTEs).

## Caveats

- If a listed account tops up while you work, the list is stale — re-run
  rather than acting on old numbers.
- `usage` in the minute table is OpenRouter credit spend; on BYOK requests
  that is only the BYOK fee, which is correct for balance math (unlike the
  cron's accrual metric, which drops BYOK buckets entirely).
- If the mart stalls for more than ~30 days the credit correction is clamped
  and results may flag entities that already settled; check
  `max(balance_as_of_date)` freshness if numbers look off.
- `usage_start` floors at `ref_time - 3 DAY`, so if the mart stalls for more
  than three days both the activity arm of the candidate set and the usage
  correction stop at three days back. That direction hides genuinely-negative
  accounts rather than over-flagging them.
- Neither candidate arm catches an account pushed negative purely by a
  post-snapshot negative `stg_credits` row (chargeback, refund, expiration) with
  no minute-table activity since `usage_start` — it is never corrected or
  listed. Pre-existing, not introduced by this query's shape.
- A negative balance is a lead, not proof of fraud — never propose bans from
  this list alone; T&S ban decisions require multiple independent signals and
  human review.
- Keep the query on the shipped correction pattern — do not simplify to raw
  `dim_users.outstanding_balance`, which is intra-day stale (see the mart
  freshness rule in `packages/kyc/sentinel/SCANNER_SPEC.md`).

## Investigating an accrual spike (ring investigation)

This was the runbook of the removed "[T&S] Negative balance accrual by model"
Datadog alert. The cron still publishes the metrics and logs it references.

Start from the logs the cron publishes each run (`negative_balance_top_users`
is published every run; `negative_balance_model_usage` is skipped when no
model clears the flag gate, so a below-gate window has none):

- [Accounts accruing per model](https://us5.datadoghq.com/logs?query=%22negative_balance_model_usage%22&agg_m=%40extra.outstanding_balance&agg_m_source=base&agg_t=min&agg_q=%40extra.clerk_user_id%2C%40extra.email&cols=host%2Cservice&flat_group_bys=true&messageDisplay=inline&refresh_mode=sliding&sort_m=%40extra.outstanding_balance&sort_m_source=base&sort_t=min&storage=hot&stream_sort=desc&top_n=100&top_o=bottom&viz=query_table&x_missing=true&fromUser=true&live=true)
  — narrow to one model with `@extra.model_permaslug:"<permaslug>"`.
- [Highest individual negative balances in the scanned window](https://us5.datadoghq.com/logs?query=%22negative_balance_top_users%22&agg_m=%40extra.outstanding_balance&agg_m_source=base&agg_t=min&agg_q=%40extra.clerk_user_id%2C%40extra.email&cols=host%2Cservice&flat_group_bys=true&messageDisplay=inline&refresh_mode=sliding&sort_m=%40extra.outstanding_balance&sort_m_source=base&sort_t=min&storage=hot&stream_sort=desc&top_n=100&top_o=bottom&viz=query_table&x_missing=true&fromUser=true&live=true)
  — ranked by corrected balance across all models; start the balance
  investigation here.

Per-account ring evidence is on both log events: every `ENTITY_SIGNAL_COLUMNS`
field (`packages/clickhouse/negative-balance-usage/queries.ts`) plus
`usage_usd` and `requests` is present as `@extra.<field>`, so cohorts can be
grouped in the logs UI without a ClickHouse round trip. The
logs only cover the scanned window; for overspenders outside it start from
[this Hex query](https://app.hex.tech/091db13f-d26f-4224-a185-6fce9df76f90/hex/Hourly-Negative-Balances-0340yJ6bVBnLR4HFthhEHA/draft/logic?rhid=019fc9c0-5dc1-758b-94f0-20bfd984ab18)
or the query in this skill.

Rules for filing:

- A negative balance can mark a compromised API key rather than an abusive
  account. Run the
  [compromised-key gate](../../../packages/kyc/sentinel/SCANNER_SPEC.md#compromised-key-gate)
  before proposing anything: a key that predates the burn, the account's own
  funding history, prior traffic from a real origin or SDK, a burst model or ASN
  new to an otherwise ordinary account, and a cohort sharing only the relay or
  client fingerprint all argue victim. When it trips, never approve or enact —
  leave the targets `pending_review` and escalate for key revocation, holder
  notification, and crediting the negative balance.
- Rank exposure on BYOK inference as well as OpenRouter `usage`. A relayed BYOK
  victim bills its own provider account, so its balance barely moves and a
  balance-ranked list misses it.
- Require a minimum of three independent shared signals (for example signup
  IP hash, JA4, ASN, email domain, signup window) before grouping accounts
  into a ring. One shared attribute is not evidence — shared ASN or country
  alone routinely groups unrelated accounts.
- File each qualifying cohort as a Sentinel ban-candidate suggestion
  (`bun run sentinel:ban-candidates`, see
  `.agents/skills/sentinel-ban-candidates/SKILL.md`) so it lands in
  `pending_review` for a human to approve. Include cohort members that have
  not overspent yet by proposing restrictions for them. Do not ban or enact
  anything directly.
- Report each filed case with its Mission Control link
  (`https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates/<id>`),
  its target count, and what would refute the grouping.
- If a model's detail logs are missing and a
  `negative_balance_model_usage_detail_unavailable` log is present, either
  the detail query failed or its row cap dropped the model. The
  `negative_balance_usage_detail_query_failed` and
  `negative_balance_usage_detail_truncated` eLogs tell the two apart. Rerun
  the query after a failure; after truncation a rerun returns the same capped
  set, so query the model's entities directly before concluding no accounts
  are behind the accrued balance.
- Balance eligibility comes from a daily mart corrected by post-snapshot
  credits (counted from the day after `balance_as_of_date`), so an account
  that settled up in the last few minutes may still appear.
  Confirm the current balance before proposing a ban.
