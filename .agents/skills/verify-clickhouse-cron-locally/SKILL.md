---
name: verify-clickhouse-cron-locally
description: Run a ClickHouse-backed cron (analytics query → Datadog submission) end-to-end from a local harness against the real read-only analytics cluster, with Datadog emitters stubbed. Use when verifying a cron in services/cfw-internal/src/routes/cron that reads analytics ClickHouse and submits metrics/logs.
---

# Verify a ClickHouse → Datadog cron locally

Goal: prove the shipped SQL runs against the real analytics cluster, the rows
parse with the shipped Zod schemas, and the executor builds the right Datadog
payloads — without any Datadog write.

## Misc gotchas

- Assert a harness completion marker as well as its exit code; Bun's custom-config flag is `--tsconfig-override`, and an incorrect flag can exit successfully without running the file.
- Historical report retries need a persisted payload and fixed gauge timestamps/tags. Verify historical ingestion with Datadog's configuration API before treating intake acceptance as delivery; standard intake can ignore points older than one hour. For full-report durability, use a ledger when the logs intake's timestamp limit and lack of an idempotency key prevent replay (see `docs/engineering/ori-product-metrics.md`).
- `/tmp` is wiped between sessions — keep the persistent copy of a harness in
  a home-directory folder (e.g. `~/ch-harness/`), copy it into the service
  `scripts/` dir to run, and delete the service-local copy before committing.
- `terraform fmt -check -recursive` in `configs/terraform-monitors` fails on
  ~50 pre-existing files; scope the check to the touched `.tf` files.
- Result monads live in `packages/lib/result/index.ts` and carry the
  payload on `.data` (not `.value`); `errT` comes from
  `packages/instrumentation/error.ts`.
- Watermark-driven crons: to replay a past window, stub `getWatermark` and pin
  `Date.now` to watermark + ~60s — the staleness check compares the two, so a
  backdated watermark with the real clock is rejected as stale.
- cfw-internal crons also take Postgres deps (`getInventoryModels`,
  `getProviderInfo`, ...); stub them to `[]` when no local Postgres is up and
  note which admissions/tags that removes from the comparison.
- A `git worktree` of `origin/main` cannot run bun scripts (workspace
  `node_modules` are not hoisted). For a baseline run in place, first commit
  or stash so `git status --porcelain` is empty (the checkout below overwrites
  uncommitted edits), then `git checkout origin/main -- <files>`, run, and
  restore with `git checkout HEAD -- <files>`.
- Check the shipped `variant` / `is_byok` filters before quoting ad-hoc
  numbers: a raw query without them can disagree wildly with the cron.
- Run cfw-internal unit tests from `services/cfw-internal` (or via `bun run test` there), not `bun test <path>` from the repo root: the root skips the service's `bunfig.toml` preload, so `resolveEnvironmentForTagging` yields `env:production` and every `env:test` tag assertion fails.

## Local ClickHouse → Postgres producers

For crons that persist flags rather than submit Datadog payloads, prefer the real local worker over the stubbed analytics harness above. In `services/cfw-internal/src/index.ts`, inspect the dedicated scheduled slot before firing it, because shared slots can execute unrelated side effects. For example, `risk-flag-piper` uses `http://localhost:8794/__scheduled?cron=0-59%2F5+*+*+*+*`.

- Boot `bunx wrangler dev --test-scheduled --port 8794 --inspector-port 0` from `services/cfw-internal`, supplying `--var OR_ENV:development`, `--var CLICKHOUSE_URL:http://localhost:8123`, `--var CLICKHOUSE_USERNAME:default`, and `--var CLICKHOUSE_PASSWORD:clickhouse`. Its Hyperdrive local connection strings point to Postgres on 54322. No remote credentials are needed for this local-only data path.
- Apply current migrations before seeding. After `SYSTEM REFRESH VIEW`, use `SYSTEM WAIT VIEW` and inspect `system.view_refreshes.exception` and `last_success_time`. `Scheduled` is the normal idle status after success.
- Families read directly on each run (`fraud_score_user_day`, the payment families, `signup_identity_link`) have no view to refresh: seed the source rows and fire the piper. `bun run ch:bootstrap` adds the `clickpipe_postgres_*` columns `signup_identity_link` reads, the payment families read `default.user_signals` from the ClickHouse migrations, and `fraud_scoring` has no local fixture. Their freshness comes from the source table's own heartbeat, so backdated fixture timestamps are rejected as stale.
- Use uniquely prefixed fixture entities and check persisted rows, not just the scheduled endpoint's HTTP 200. Compare PostgreSQL `xmin` before and after a repeat fire to prove unchanged-write suppression.
- Scheduled cron logs may not appear in `dev-fs-logs`. The development logger exports to the local OTLP collector on 4318 (`packages/cloudflare/instrumentation/dev-log-exporter.ts`), so capture Wrangler stdout too. If the collector is absent, disclose the telemetry gap. An empty filesystem-log directory is not evidence of an error-free run.

## Devin Secrets Needed

These are needed for the analytics harness, not the local-only producer path.

- `CLICKHOUSE_URL`
- `CLICKHOUSE_READONLY_USER`
- `CLICKHOUSE_READONLY_PASSWORD`

(Both readonly vars are usually already in the session environment. Everything
else can come from Infisical — see the Secret Management section of `AGENTS.md`.)

## Run the shipped query functions

`packages/clickhouse/client.ts` reads `CLICKHOUSE_USERNAME` / `CLICKHOUSE_PASSWORD`,
so map the readonly creds onto those names:

```bash
cd /path/to/openrouter-web
CLICKHOUSE_USERNAME="$CLICKHOUSE_READONLY_USER" \
CLICKHOUSE_PASSWORD="$CLICKHOUSE_READONLY_PASSWORD" \
OR_ENV=production \
bun run scripts/tmp-harness.ts
```

`OR_ENV` decides the `env:` tag on emitted metrics/logs — use `production` if you
want to check that the tag matches a Terraform monitor scoped to `{env:production}`.
`getClickHouseAnalyticsClient()` refuses to run if it detects a production
ClickHouse write target, so read-only queries are the intended use here.

For `cfw-internal` cron harnesses, place the temporary script under
`services/cfw-internal/scripts` and run it from that workspace, or import the
cron module by a relative path. Bun does not resolve the service's `@/*` alias
for a root-level temporary script.

In the harness, build a `…Deps` object (crons in this repo export their deps type
precisely so emitters can be stubbed) with the real `query*` functions and
`emitMetrics` / `emitLogs` replaced by recorders returning `ok(undefined)`.
Cron modules do not export their default deps (no `__testDefaultDeps`), so
import each `query*` function from `packages/clickhouse/dd-sync/` directly.
Assert on the recorded payloads (metric name, `type`, one point per row, tag
prefixes, log `message`/`level`/`extra` keys) rather than eyeballing them.

## Raw HTTP queries (ad-hoc SQL, clause ablation)

The HTTP endpoint needs a trailing slash and a format param — a bare URL 404s,
and multi-statement bodies are rejected:

```bash
curl -sS "${CLICKHOUSE_URL%/}/?default_format=PrettyCompact" \
  -H "X-ClickHouse-User: $CLICKHOUSE_READONLY_USER" \
  -H "X-ClickHouse-Key: $CLICKHOUSE_READONLY_PASSWORD" \
  --data-binary @query.sql
```

Gotchas:

- Correlated subqueries fail with `UNSUPPORTED_METHOD … allow_experimental_correlated_subqueries`.
  Rewrite ad-hoc probes as `LEFT JOIN` + `GROUP BY`.
- To prove an eligibility exclusion is load-bearing, don't just show the row is
  absent — re-run with only that clause deleted and show the row appears
  (counterfactual). Individual clauses often overlap, so a single ablation can
  yield zero new rows; ablate the group, then narrow.
- Always include a positive control ID that IS eligible, so a probe returning
  0 rows everywhere can't be mistaken for a passing test.

## Exclusions on an AggregatingMergeTree must be decided per bucket

`default.user_activity_minute_v7` rows are partial aggregates: the same logical
bucket (its whole sort key — `clerk_user_id, workspace_id, creator_user_id,
api_key_id, app_id, model_permaslug, variant, endpoint_id, date`) can sit in
several unmerged parts. A row-level predicate on an aggregate counter (e.g.
`WHERE a.byok_requests = 0`, meant to drop BYOK spend) therefore keeps the
non-BYOK part of a mixed bucket, and the result flips as merges happen. Group by
the sort key and decide in `HAVING sum(...) = 0` instead.

Two things this implies for tests: the integration fixture must put both
generations in *one* bucket — `createMockGeneration` randomizes `endpoint_id`,
so pin it explicitly or the "mixed bucket" is really two buckets and the test
passes against the broken query — and the unit test should assert the
`GROUP BY … HAVING` text, since that (not the predicate) is the invariant.

Price the grouping by ablating just the `HAVING` line over raw HTTP or the
shipped builder, 3 runs each: measured 4.2–5.4s (shipped) vs 4.4–6.8s (ablated),
i.e. the extra grouping is free at this window size.

## Exercise threshold-gated branches

Crons that only emit detail when a value clears a floor (e.g. `$100`) usually
won't trip on live data. Temporarily lower the module constant, re-run, then
revert and confirm `git diff` is empty. Keep the temp harness scripts out of the
PR (put them in `/tmp` or delete them before reporting).

## Force the failure path without stubbing the query

To verify a cron's degraded branch (e.g. "detail query failed → emit fallback
logs") through the real query path, don't swap in a stub that returns `err()` —
temporarily shrink the wrapper's own budget (`QUERY_TIMEOUT_SECONDS`) below the
query's measured latency. The query really runs against ClickHouse and really
aborts, surfacing as `message: "The user aborted a request."` (client-side abort)
rather than `"Timeout error."` (client `request_timeout`) — two distinct strings
worth grepping for separately. Revert afterwards and confirm `git diff` is empty.

## Watch the client timeout ceiling

`getClickHouseClient()` sets `request_timeout: 5_000` and
`getClickHouseAnalyticsClient()` sets `request_timeout: 15_000`, so a query
wrapper that sets its own longer budget (e.g. `max_execution_time: 20`) is
silently capped at 15s, surfacing as `message: "Timeout error."` with
`status: null`. Multi-CTE aggregations over `default.user_activity_minute_v7`
joined to `analytics.*` dims do not fit in 15s — use
`getClickHouseHeavyQueryClient()` (`request_timeout: 120_000`) and set the
wrapper's own budget below it (PR #34624 moved to the heavy client with a 60s
`max_execution_time` + abort budget). Unit tests with a mocked client never hit this ceiling; only the harness does, so run it before assuming the default client fits.

Always time a new analytics query over **several** runs, not once: latency on
the shared cluster has a heavy tail. One such query measured 12.1–12.6s across
six consecutive runs but 22–27s under load and once blew a 60s budget outright.
Budget for the tail, and make sure the cron degrades gracefully (records a
partial outcome, still submits what it has) rather than failing the whole run.

## Capture the heartbeat / outcome tags a dead-man monitor depends on

Crons record their own completion with a `…sync_complete` heartbeat carrying an
`outcome:success|partial|error` tag, and dead-man monitors scope on those tags
(e.g. `{env:production,!outcome:error}`). There are two submission paths in this
repo — check which one the cron under test uses before writing the harness:

**A. Datadog `/api/v1/series` (same `deps.emitMetrics` call as the gauges).**
Preferred for dead-man heartbeats: statsd drops points independently of the job,
while on the series path a lost heartbeat implies lost gauges. The heartbeat is a
`type: 'count'` metric with `points: [[ts, 1]]` and tags `['env:<resolved>',
'outcome:<x>']` — note `env:` **is** attached by the app here (via
`resolveEnvironmentForTagging`), unlike statsd. Because the heartbeat shares the
emitter with the gauges, a naive always-failing `emitMetrics` stub conflates
"gauge submission failed" with "heartbeat submission failed". Classify each stub
invocation by payload metric name and fail selectively:

```ts
emitMetrics: async (m: Metric[]) => {
  batches.push(m);
  const isHeartbeat = m.some((x) => x.metric.endsWith('.sync_complete'));
  if (scenario === 'heartbeat_submit_fail' && isHeartbeat) return failure();
  if (scenario === 'gauge_submit_fail' && !isHeartbeat) return failure();
  return ok(undefined);
},
```

Also run the realistic full-Datadog-outage case (both batches fail): the run
should still return `ok()` and log a `*_heartbeat_submit_failed` breadcrumb.

**B. statsd** (`getStatsd().incr(key, 1, ['outcome:…'])`). To verify the tag
emitted per branch, install a recorder before running the executor:

```ts
import { setStatsd } from '@openrouter-monorepo/instrumentation/statsd';
const recorded: { key: string; tags: string[] }[] = [];
setStatsd({
  incr: (key, _v, tags) => recorded.push({ key, tags: tags ?? [] }),
  distribution: () => {}, histogram: () => {}, gauge: () => {},
});
```

Then assert there is exactly **one** heartbeat per run and that its
`outcome:` tag matches the branch you forced. Force branches by returning
`errT({...})` from the stubbed `emitMetrics` / `emitLogs` deps (import `errT`
from `@openrouter-monorepo/instrumentation/error`, not from `lib-result`) or
by returning `errT` from the stubbed `query*` dep.

On the statsd path the `env:` tag is **not** added by the app: `CloudflareStatsd` only merges
its constructor `defaultTags` (e.g. `service:cfw-internal`), and `env:production`
is attached downstream by the tail-worker → PubSub → DD-agent pipeline. So a
locally recorded heartbeat legitimately shows only `outcome:*`; cross-check the
`{env:production}` part of a monitor query against an existing monitor over the
same pipeline (e.g. `openrouter.cf_analytics.sync_complete{env:production,…}`)
instead of expecting the tag in the harness output.

## Prove a "correction can only clear, never flag" claim on live data

Eligibility queries that correct a stale daily mart with a fresher table (e.g.
subtracting post-snapshot credits from `dim_users.outstanding_balance`) claim to
be one-sided: they can clear an entity but never manufacture one. Verify it by
slicing the CTE prefix out of the shipped builder and swapping only the bound
under test, so both variants share the shipped eligibility logic:

```ts
const shipped = buildModelUsageSql(new Date());
const prefix = shipped.slice(0, shipped.indexOf('  SELECT\n    a.model_permaslug'));
const base = `${prefix}SELECT clerk_user_id FROM eligible_entities`;
const old = base.replace('created_at >= credits_start', 'created_at >= window_end - INTERVAL 3 DAY');
if (old === base) throw new Error('swap did not apply'); // always assert the swap landed
```

Then compare the two `clerk_user_id` sets: `new \ old` must be empty (subset =
"cannot manufacture an accrual metric"), and report `|old \ new|` as the
quantified delta.

Two gotchas:

- **The live mart is usually fresh enough that both variants are identical**
  (observed 25 690 = 25 690 with `dim_users` two days stale and a three-day
  lookback). That proves no regression but not the fix. Also simulate the
  degraded state the fix targets by rewriting the staleness inputs — e.g. move
  the per-entity de-dupe boundary and the "oldest snapshot" scalar to 6 days
  back — which surfaced 754 entities the old fixed lookback kept eligible.
- **A scalar `WITH` alias cannot be selected directly at all** — not via
  `FROM system.one`, not via `FROM numbers(1)`, not with no `FROM`. Once the
  chain contains a sub-select, ClickHouse fails with `Unknown expression or
  function identifier <alias>`. Read the bound through the CTE that *consumes*
  it instead: if `recent_credits` filters `created_at >= credits_start`, then
  `${prefix}SELECT toString(min(created_at)), count() FROM recent_credits`
  reports the effective bound and the scan size it implies. Poison the scalar
  sub-select (string-replace it with `(SELECT toDateTime('2019-01-01','UTC'))`)
  to prove a clamp binds: observed floor (3d), derived (8d-stale snapshot), and
  ceiling (30d, 1.05M credit rows) all from the same shipped prefix.
- **Clamped bounds need three probes, not one**: the floor case (live mart),
  the derived case (poisoned to a moderately stale date), and the ceiling case
  (poisoned to an ancient date), plus a NULL case (scope `WHERE 1 = 0`) to show
  the `coalesce` fallback. A scoping change to the sub-select (`WHERE deleted =
  false AND …`) also wants a direct `min/max/count` on the source table to show
  the scoped and unscoped minima agree today.
- **Price the new sub-select**: run shipped vs the same SQL with the sub-select
  replaced by a literal, 3 runs each (measured 4.1–4.9s vs 4.0–4.2s, i.e. noise).

## Verify the caller's error handling, not just the executor's

When a commit moves logging from the cron executor to its caller ("the caller
already logs the propagated error"), testing `executeXSync` directly can no
longer prove "exactly one error log". Drive the shipped caller —
`executeCronTask(CronTask.X, { DD_API_KEY: 'fake' })` in
`services/cfw-internal/src/routes/cron/tasks.ts` — with default deps, and:

- force the failure with a real one (e.g. run with a deliberately invalid
  `CLICKHOUSE_PASSWORD` so the model query genuinely fails auth) rather than a
  stub, since default deps cannot be injected through `executeCronTask`;
- monkeypatch `globalThis.fetch` to intercept any `datadoghq` URL, record the
  parsed body and return a local `202` — this is what keeps the real
  `submitMetrics` path exercised while submitting nothing;
- count log *lines*, not regex matches: `inspectErrorT` embeds the same message
  twice in one JSON line (`message` and `error.message`), so naive matching
  double-counts a single log.

## Prove a row-cap / `LIMIT n BY` change on live data

Row caps (`LIMIT 20 BY model_permaslug` + a global `LIMIT 200`) usually do not
bind on live volume, so "one entity group can no longer starve the others" is
not observable by just running the shipped SQL. Scale the caps down instead:
take the shipped statement text from the builder, string-replace the caps to
small numbers (e.g. `LIMIT 2 BY <key>` + `LIMIT 6`), and run three variants over
raw HTTP — shipped, shipped-with-the-per-group-cap-removed, and the pre-change
ordering — then compare `distinct groups` and `max rows for one group`. One
observed result: without the per-group cap a single model took 5 of 6 rows
(2 groups covered); with it, 4 groups were covered.

Two things to keep separate when a commit changes ordering *and* adds a cap:
the cap bounds any one group, but an ordering keyed on the group total makes the
global cap fill top-group-first, so low-ranked groups get zero rows rather than
a thin slice. Check whether the caller reconciles "groups I flagged" against
"groups I got rows for" and records the gap — that reconciliation is what makes
the truncation safe, and it is worth asserting on directly (one fallback log per
missing group, plus a degraded outcome tag).

To force the truncation branch without waiting for real cap pressure, wrap the
real query dep and drop every row for one group from the successful result — the
executor then sees exactly the "flagged but no detail rows" state.

## A "value is capped at X" claim needs the right bucket, not just any bucket

When a query narrows a metric (e.g. per-minute negative-balance accrual capped
at that minute's non-BYOK model spend, PR #35179), build the comparison number
by slicing the shipped builder's CTE prefix and re-projecting the CTE the old
metric summed (`SELECT model_permaslug, sum(usage_usd) FROM window_activity
GROUP BY …`). Both variants then share the shipped eligibility/BYOK logic, so
the only difference is the projection — that is the pre-change metric, exactly.

Expect the cap to be *non-binding* in most buckets: an account already deep
below the threshold with no in-window credits accrues exactly its spend each
minute, so `accrued == spend` for every model and the run proves the invariant
but not the fix. The reduction only shows up in buckets where an account crosses
the threshold mid-window or receives in-window `stg_credits`. Sweep several
offsets in one harness run (`BUCKET_OFFSETS_MIN=0,5,15,45,120,360`) and report
the strictly-less count per bucket — busier/older buckets are much more likely
to contain a crossing (observed 0/28 and 0/27 in two adjacent quiet buckets, but
8/32, 8/29 and 20/47 at −15m, −120m and −360m). Do not report a bucket where
every model equals spend as evidence the narrowing works.

Sweeping *adjacent* buckets is not a sweep: eight consecutive 5-minute buckets
(40 minutes of wall clock) produced 0/191 models below spend, while the same
harness at −120m and −360m found 1/26 and 7/29 (accrued $39.08 vs spend $49.08,
ratio 0.796 — the gap was exactly the $10 floor of one crossing account). Step
the offsets in hours, not buckets. Independently of live sampling, prove the cap
is load-bearing by ablating it in the shipped text (drop the `least(…, u)`
wrapper) and diffing the two totals under an injected refund — that is
deterministic and does not depend on finding a lucky bucket.

Assert, per submitted series: sum of points `<=` the probe's spend, sum of
points `==` the row's total field (catches a broken minute-map key type), one
point per window minute with every timestamp inside the bucket, and no negative
points. Also assert the *absence* of the renamed metric (`metric.includes(
'model_spend_usd')`) and grep the repo for the old name so Terraform monitors
and dashboards are not left pointing at a metric that stopped being submitted.

Latency note for this cron family: the shipped model query measured 21.8–36.0s
of wall time across six runs and blew the 60s budget once on a cold first run
(surfacing as `"The user aborted a request."`). Re-run before calling a single
abort a regression.

When reconstructing a window-start balance from a corrected closing balance,
add back exactly the credits and usage that closing balance is net of. Adding
back a filtered per-model slice makes the start balance too negative and raises
accrual. Eligible accounts often have zero BYOK or non-model in-window usage on
live data, so this bug can be invisible in production sampling and needs a
fixture test.

String-matching a CTE's text asserts nothing about its behavior. A balance-walk
suite needs a seeded eligible account with an in-window credit and a zero-cost
activity minute, or the credit term and the divide-by-zero guard are both free
mutants.

SQL comments inside these builder template literals must not use backticks,
because backticks terminate the template string.

Two mechanical traps when appending to a sliced CTE chain: the slice ends without
a trailing comma, so an appended CTE needs one (`${chain},\n  walk AS (`), and
scalar `WITH` aliases such as `window_start` do **not** resolve inside a nested
subquery of the appended final `SELECT` (`Unknown expression … window_start`) —
inline the bounds as `toDateTime('…','UTC')` literals in probe queries.

## Prove a balance-walk / "accrued" metric, not just that the SQL runs

A cron whose value changes from "sum spend" to "sum the increase in arrears"
usually looks *identical* on live data: accounts that are already far below the
negative-balance floor accrue exactly their spend every minute, so a shipped-vs-
old comparison prints `total_accrued == total_spend` to the last cent. That
agreement is a useful invariant (accrual must never exceed spend) but it proves
nothing about the walk. Force the divergent states by poisoning the walk's inputs in the
shipped statement text and running over raw HTTP, four variants:

- **Never negative** — replace `any(w.outstanding_balance) AS balance_end` with
  `toFloat64(1000.)`. Expect total accrual exactly `0` while spend is unchanged;
  the old spend-based query would have reported the full spend.
- **Crosses zero inside the window** — replace it with `toFloat64(-0.5)`. Expect
  each account whose window spend exceeds $0.50 to accrue exactly $0.50 (only the
  below-zero portion), so total accrual < total spend.
- **Credit lands mid-window** — inject into the deltas lambda:
  `+ if(k = a.minute_starts[3], 1000000., 0.)`. Expect the credited minute to
  accrue `0` despite real spend in it. Note `balance_end` is held fixed, so an
  injected credit implies a *lower* reconstructed start balance — later minutes
  legitimately keep accruing. Asserting "no accrual after the credit" is a wrong
  expectation, not a bug.
- **Refund / chargeback larger than model spend** — inject a *negative* credit:
  `+ if(k = a.minute_starts[3], -1000., 0.)`. With a per-minute cap the credited
  minute must accrue exactly that minute's model spend; run the same statement
  with the cap ablated to show what would otherwise be attributed (measured
  $9.47 capped vs $546.57 uncapped).

Verifying an "add back *all* in-window usage" change needs care in two ways.
First, compute both delta definitions **inside one statement** (a second CTE
reusing `account_activity` / `window_credits` / the all-usage CTE), because
sequential raw-HTTP runs against a recent window read a still-filling table and
manufacture differences of 5–12% that vanish under a same-snapshot comparison.
Second, hidden (BYOK / non-model) usage injected into a *single* minute changes
nothing once a per-minute cap exists: it shifts the reconstructed start balance
and the cumulative sum by the same amount, so only the first minute's pre-cap
accrual moves and the cap clips it back. Spread the injection across every minute
(`+ h/5` in the all-usage lambda) to make the effect observable — that showed the
shipped add-back strictly *lower* than the old model-slice add-back ($17.43 vs
$38.27) and never higher, which is the intended direction.

Also assert the allocation, not just the total: instrument the per-row CTE
(`activity_row.3 AS row_spend`, `accrued[indexOf(...)] AS minute_accrual`), group
by (account, minute) and check `abs(sum(accrued) - minute_accrual) <= 1e-9`
(exhaustive) and `uniqExact(round(accrued / row_spend, 9)) = 1` (proportional).
Filter `minute_accrual > 0` in `HAVING`, not `WHERE` — an aggregate alias in
`WHERE` fails with `ILLEGAL_AGGREGATION`.

Zero-cost (free) minutes are the null-leak risk in a ratio allocation. Count them
(`countIf(usage_usd = 0)` over `window_activity`) and probe the accrual CTE for
`countIf(isNull(accrued_usd)) / isNaN / < 0` — all must be 0.

### Absolute numbers drift between reruns of the *same* window

The eligible population is corrected with mutable tables (`analytics.stg_credits`
arrives via peerdb after the fact, `dim_users` refreshes), so re-running an
identical `refTime` minutes later can return a much smaller set. Compute every
comparison inside a single run, and never diff totals across runs.

### Result-monad gotcha in harnesses

`isOk(result)` / `isErr(result)`, not `result.ok` — the monad is
`{ __kind: 'OK' }`, so `result.ok` is `undefined` and a naive truthiness check
reports a passing run as a failure.

## Distribution-metric crons: assert containment, not just "it ran"

A cron that submits `DatadogDistributionPoint[]` (raw values per point, e.g.
`openrouter.gateway_bench.gateway.network_latency`) has a different assertion set
from a gauge/series cron. Drive it with `emitDistributions` / `emitMetrics`
recorders and assert, per submitted entry:

- exactly one `emitDistributions` batch, and one entry per tag combination
  rather than per point — an entry carries every point of its combination;
- every point timestamp inside the half-open window the executor derived
  (`window.start/1000 <= ts < window.end/1000`), which also catches a bucketing
  expression drifting off the column the window is bounded on;
- every value finite and non-negative, reporting min/p50/p95/max — the intake
  accepts negatives silently, so only an explicit check surfaces them;
- no entry with an empty values array (the intake rejects the whole payload);
- exactly one heartbeat metric, `type: 'count'`, tags matching the Terraform
  monitor query string character-for-character.

**A single live window is not a data-quality sample.** One 5-minute window can be
clean while the metric carries bad values fleet-wide. Re-run the join over 6–24h
grouped by the tag dimension with `countIf(value < 0)` per group before claiming
"no negative values". A metric derived from two clocks can be negative for one
group and clean for every other.

**Window adjacency needs an entity-level disjointness probe, not just timestamps.**
Run the executor for `t` and `t + cadence`, assert `windowA.end === windowB.start`,
then cross-check over raw HTTP that the *source key* sets (e.g. `generation_id`)
of the two windows intersect in 0 rows while both are non-empty.

## Cron routing without workerd

`executeCronTask(CronTask.X, env, { scheduledTime })` runs fine under plain `bun`
for a task whose handler only needs `env.DD_API_KEY` plus the ClickHouse env
(no DO/db bindings): pass a hand-built `env` object cast to the env type, and
monkeypatch `globalThis.fetch` to intercept `datadoghq` URLs (record the parsed
body, return a local `202`). That exercises the real default deps and the real
`submitMetrics` / `submitDistributionPoints` code paths while submitting nothing.
The cron-string → task mapping itself is pinned by
`services/cfw-internal/src/cron-triggers.test.ts`, which diffs the `CRON_SCHEDULE`
expressions in `src/routes/cron/schedule.ts` against `wrangler.toml` `crons` 1:1 —
run that test instead of trying to drive the scheduled handler.
