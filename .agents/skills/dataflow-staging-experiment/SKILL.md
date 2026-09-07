---
name: dataflow-staging-experiment
description: >-
  Design, launch, and measure A/B experiments on the usage-record generations
  Dataflow pipeline using ephemeral staging jobs that mirror prod traffic.
  Covers partition/shard isolation so concurrent arms don't contend, Spanner
  request/transaction tagging for per-arm SPANNER_SYS attribution, and the
  measurement pitfalls that make early data lie.
user-invocable: true
---

# Dataflow Staging Experiment

Use this to A/B a change to the `usage-record` generations pipeline
(`services/usage-record/dataflow`) against a copy of live prod traffic, on the
`usage-record-staging` Spanner instance, without touching prod.

The pattern: each staging deploy creates its own ephemeral Pub/Sub subscription
on the **prod** generations topic (gets a full copy of every message), filters
to a slice of entities in-worker, and writes to `usage-record-staging`. Multiple
arms run concurrently, each tagged so its Spanner cost is independently
measurable.

Agents CAN deploy arms themselves via GitHub Actions — see "Launching via
GitHub Actions" below. Only local `bun run x scripts/dataflow-deploy.ts` runs
need a human with `gcloud auth login --update-adc` (see Gotchas). Never fall
back to "a human must deploy" without first trying the `repository_dispatch`
path.

## The two isolation axes (get these right or the experiment is garbage)

These are **different** and easy to confuse:

- **Partition** (`--partition-count N --partition-index i`): consistent hash of
  `billable_entity_id % N`. Selects *which entities* an arm processes. Two arms
  on the same index process the **same entities**.
- **Shard band** (`--min-shard-index` / `--max-shard-index`): which
  `generation_shards` / `budget_usage` rows an arm writes for those entities.
  Disjoint bands = disjoint rows.

**The shard band does NOT filter traffic.** It is a *write-distribution* knob:
the batcher round-robins each entity's writes across the band, so a 2-shard
band and a 4-shard band both process 100% of the arm's partition — the band
width only changes how many rows those writes rotate over (wider band = fewer
transactions per row). The **only** volume knob is the partition:
`--partition-count N` gives each index `1/N` of entities, so to scale an arm's
traffic up or down you change `N` (e.g. 25% of prod traffic each =
`--partition-count=4`), never the shard band. Two arms on the same
count+index see identical traffic regardless of their (disjoint) shard bands.

**Independent jobs must never share a shard band on overlapping entities.** Two
jobs writing the same (entity, shard) rows contend with each other — an
artifact prod never has. Give every concurrently running job its own disjoint
band, in all cases, unless the experiment's explicit purpose is to simulate
uncoordinated multi-writer contention.

Why both matter: `generation_shards` and `budget_usage` are read-modify-write on
`(billable_entity_id, started_at_shard_id)`. If two arms write the **same**
(entity, shard) rows they contend **with each other** — an artifact that
corrupts lock-wait/abort numbers (prod has one writer, not two).

So there are two valid concurrent designs:

1. **Different entities** — same `--partition-count`, different `--partition-index`.
   No shared rows. But each entity (incl. a heavy "whale") lands on exactly one
   arm, so only that arm carries its signal.
2. **Same entities, offset shard bands** — same `--partition-index`, disjoint
   `--min/max-shard-index`. Both arms process the whale, on disjoint rows, no
   inter-arm contention. **This is the one to use when a single hot entity drives
   the metric you're measuring.** The reader `SUM(shard_total_usage) GROUP BY
   billable_entity_id` is shard-range-agnostic, so offset bands aggregate fine.
   Shard index is a plain INT64 with no CHECK bound — bands like 16-30, 31-45,
   46-60 are valid (the batcher emits `offset + acc%modulus` in `[min,max]`).

**Prefer design 2 for A/B comparisons — design 1 arms are NOT equivalent
traffic.** Different partition indexes see different entity sets, whose volume
and hot-entity mix differ, so cross-partition arms cannot be compared
head-to-head. When adding an arm and shards 0-15 look "taken", do NOT move it
to another partition index: keep the same `--partition-count`/`--partition-index`
as the arms it will be compared against and give it a fresh band above 15
(e.g. 16-19). Staging readers aggregate across all shard values, so bands >15
are safe there. Reserve design 1 for cases where arms must not share entities
(e.g. isolating a whale), not for making room.

**Always set `--min-shard-index` AND `--max-shard-index` together.** The deploy
script rejects one without the other; when both are omitted the lane default
applies. Prod lanes already run on disjoint bands: interactive `0-13`, batch
`14-15` (`generation_lane.py`, `BATCH_LANE_SHARD_COUNT`). An untagged staging
arm inherits the same lane band, so a staging arm compared against a prod-like
baseline arm needs an explicit band above 15 to avoid overlapping it.

## Finding the hot entity's partition

A single "whale" entity often dominates lock-wait. Its partition is
`hash % partition_count`, so it **changes when you change the count** — recompute
every time:

```bash
cd services/usage-record/dataflow
uv run python -c "
import hashlib
e='org_33FqRnbGCqdJB0JlIne8BkdxGEk'  # the known whale
v=int.from_bytes(hashlib.sha256(e.encode()).digest()[:4],'big')
for n in (10,20): print(f'count={n}: index {v%n}')
"
```

There is **no single 'whale shard'** — the batcher round-robins shard indices
independent of entity, so a hot entity spreads across its whole shard band. Don't
try to target a shard; target the partition and offset the band.

## Available staging-only flags (generations stream)

All default-off / no-op when unset, so prod and untagged staging are
byte-identical. Deploy-script flag → pipeline option:

- `--partition-count` / `--partition-index` — entity slice (both required
  together).
- `--min-shard-index` / `--max-shard-index` — shard band (both required
  together; defaults to the lane band, interactive `0-13` / batch `14-15`).
- `--spanner-tag=arm:NAME` — per-arm SPANNER_SYS tag (else auto-derived from
  `--staging-tag`, or `arm:baseline`).
- `--batch-max-size` / `--batch-max-buffering-secs` / `--batch-min-size` —
  batcher tuning.
- `--drop-shard-exclusive-lock` — drop the exclusive lock hint on the early
  `generation_shards` INSERT.
- `--deprivilege-async-job-lock=on|off` — override the async-job settlement
  lock behavior: `on` takes an ordinary (non-exclusive) `async_jobs` read and
  skips the true no-op status UPDATE; `off` restores the exclusive read +
  unconditional rewrite. The batch generations lane defaults to `on`, the
  interactive lane to `off`; `auto` (the default) emits nothing and takes the
  lane default. `on`/`off` is staging-only.
- `--commit-delay-ms` (0-500) — override Spanner `max_commit_delay` (default
  500ms).
- `--reshuffle-bucket-count` — entity bucket count for the small-batch combiner
  (default 1024). The combiner's parallelism is capped at this count; at full
  prod-mirror volume, 64 buckets starved while 1024 was healthy. Tune up for
  high-volume arms.
- `--forget-state-secs` — how long an idle entity's shard-rotation counter is
  retained before reset (default 15s prod, 1s dev). Larger values preserve
  rotation across quiet periods.
- `--skip-post-gen-checks` — omit the post-generation-checks subtree.
- `--staging-tag=X` — distinct job name + sub per arm (required to run arms
  concurrently).
- `--seek-to=<ISO-8601 UTC>` — seek the arm's sub to a past point before launch
  (see "Replaying past traffic" below).

## Launching arms

```bash
cd services/usage-record
bun run x scripts/dataflow-deploy.ts --staging \
  --staging-tag=<short> --partition-count=20 --partition-index=4 \
  --min-shard-index=<lo> --max-shard-index=<hi> \
  --spanner-tag=arm:<name> [lever flags...]
```

### Replaying past traffic (`--seek-to`) — high-throughput & serial tests

The prod generations **topic** retains messages for **6h**
(`message_retention_duration` in `services/usage-record/infra/queue.tf`), and
ephemeral staging subs are created with matching 6h retention +
`retain-acked-messages`. Topic-level retention means a sub can seek to a time
**before its own creation** — so any arm, including a brand-new one, can replay
the last 6h of prod traffic as an **immediate backlog** instead of waiting for
live trickle-in:

```bash
bun run x scripts/dataflow-deploy.ts --staging --staging-tag=<short> \
  --seek-to=$(date -u -d '3 hours ago' +%Y-%m-%dT%H:%M:%SZ) [other flags...]
```

(Via GHA: put `--seek-to=...` in `extra_deploy_args`.)

Two main uses:

- **Max-throughput tests:** hours of prod volume land at once, driving the
  pipeline at its ceiling rather than at live ingest rate.
- **Tests-in-serial on consistent data:** because acked messages are retained,
  you can run arm A, then re-seek to the **same timestamp** and run arm B over
  the *identical* message set — a consistent replay corpus without needing
  concurrent arms.

Rules:

- Timestamp must be ISO-8601 **with an explicit UTC offset** (`Z` or `±HH:MM`),
  not in the future, and within the 6h window — the deploy fails fast otherwise.
  Staging-only.
- The seek surface also exists on **prod** subs now: with topic retention, a
  seek-back on the prod dataflow sub would replay 6h of traffic into prod
  (dedup absorbs it, but don't). The deploy script hard-gates `--seek-to` to
  staging.
- Without `--seek-to`, every deploy seeks to *now* (drops any backlog), so
  redeploying an arm resets it to live traffic.

### Launching via GitHub Actions (no local gcloud needed)

`deploy-dataflow-staging.yaml` runs the same deploy script (with `--staging`
hardcoded) under the `dataflow-deploy@` WIF identity, so arms can be launched
without local ADC. It is staging-only by construction — production deploys live
in the separate `deploy-dataflow.yaml`, which has no repository_dispatch
trigger. Two triggers:

- `workflow_dispatch` (humans / tokens with Actions:write):

  ```bash
  gh workflow run deploy-dataflow-staging.yaml --ref <arm-branch> \
    -f pipeline=generations \
    -f staging_tag=<short> -f partition_count=20 -f partition_index=<i> \
    -f extra_deploy_args="--min-shard-index=<lo> --max-shard-index=<hi> --spanner-tag=arm:<name>"
  ```

- `repository_dispatch` (bots with Contents:write but not Actions:write, e.g.
  Devin — `gh workflow run` returns HTTP 403 for these tokens; that 403 does
  NOT mean you can't deploy): same fields via `client_payload`, plus `ref` for
  the branch to deploy (the event itself always runs on the default branch):

  ```bash
  gh api repos/OpenRouterTeam/openrouter-web/dispatches \
    -f event_type=deploy-dataflow-staging \
    -f 'client_payload[pipeline]=generations' \
    -f 'client_payload[ref]=<arm-branch>' \
    -f 'client_payload[staging_tag]=<short>' \
    -f 'client_payload[partition_count]=20' \
    -f 'client_payload[partition_index]=<i>' \
    -f 'client_payload[extra_deploy_args]=--min-shard-index=<lo> --max-shard-index=<hi> --spanner-tag=arm:<name>'
  ```

  A successful dispatch returns no response body. Find and watch the run with
  `gh run list --workflow=deploy-dataflow-staging.yaml --limit 3` and
  `gh run watch <run-id> --exit-status`.

The workflow validates `pipeline` against a fixed list (`generations` and
`async-jobs`). Branch-only pipeline variants (e.g.
`--java-generations`) are NOT valid `pipeline` values — pass `generations` and
put the variant selector flag in `extra_deploy_args`.

Fixed-size arms (no autoscaling noise): pass `num_workers` (initial/target
worker count) and add `--min-workers=N --max-workers=N` to `extra_deploy_args`
to pin the range (N/N/N).

If an arm's branch carries a Spanner schema change, apply it to
`usage-staging` first (`deploy-spanner-migration.yaml` with
`environment=staging`, run from the branch) or the new writes fail.

Each arm needs a **distinct `--staging-tag`** or they collide on the same job
name (`usage-record-staging-generations-p4-1`) and parallel-replace each other.
Job name is `usage-record-staging-<tag>-generations-p<idx>-<n>` and must stay
≤ **40 chars** — with `-p4-1` that leaves room for only a **1-2 char** staging
tag (e.g. `c`/`x`/`b`/`d`). `--spanner-tag` is the readable metric label and is
independent of the job-name tag, so keep it descriptive (`arm:control`).

Run deploys **serially** (each builds + pushes a Docker image; first build slow,
rest hit cache). Confirm each reaches RUNNING before trusting it:

```bash
gcloud dataflow jobs describe <JOB_ID> --region=us-central1 \
  --project=openrouter-core --format='value(currentState)'
```

`JOB_STATE_FAILED` right after submit is usually a preflight IAM error — check
the worker SA has consume on the ephemeral sub (the deploy script grants it
per-sub; needs `setIamPolicy` on the deploy SA, applied in
`services/usage-record/infra/dataflow.tf`).

## Confirming arms consume

Don't trust the `received generation` debug log (off by default → false
"not consuming"). The primary observability tool is the **Staging Dataflow
Experiment** Datadog dashboard (`configs/terraform-monitors/monitoring/usage_record_staging_experiment/`),
which shows Pub/Sub sent≈ack per sub, Dataflow job health, and Spanner
contention guardrails.

For ad-hoc checks, use per-step element counts or the gcloud CLI:

```bash
# sent vs ack should track; backlog stable, not climbing unbounded
gcloud monitoring ... pubsub.googleapis.com/subscription/{sent,ack}_message_count
```

Note: each ephemeral sub gets 100% of the prod topic; the partition filter runs
**in-worker after the read**, so Pub/Sub volume is identical across arms — the
slice happens before Spanner, not at ingestion. Partition pass-through is ~1/N
of *entities*, but *generation volume* per partition varies a lot (entity skew):
a 1/20 partition can be 3-6% of volume, not a clean 5%.

## Measuring with SPANNER_SYS — and the pitfalls

Staging Spanner: `--instance=usage-record-staging --database=usage-staging
--project=openrouter-core`. Tables: `*_TOP_MINUTE` (one interval),
`*_TOP_10MINUTE` (retains ~10 min, multiple overlapping intervals).

### Tags

`transaction_tag` is set per batch as `arm:<name>:<homo|hetero>` (homogeneous =
all generations in the batch share one `billable_entity_id`). `request_tag` is
per statement: `arm:<name>:<homo|hetero>:<statement>` where statement is
`gen_exists` / `entity_insert` / `shard_insert` / `shard_update` /
`budget_insert` / `budget_update` / `backfill_*`. So:

- **TXN_STATS / LOCK_STATS** → grouped by `transaction_tag` (whole-txn: aborts,
  latency, locks).
- **QUERY_STATS** → grouped by `request_tag` (per-statement CPU, rows). Because
  QUERY_STATS groups by tag, the per-statement suffix is what keeps individual
  statements from collapsing into one row.

### Pitfall 1 — early data is cold-start garbage

The first ~6 min after launch is index fill, not steady state. Wait, and
discard early snapshots.

### Pitfall 2 — stale tags AND tag reuse across relaunches

Two distinct hazards, both because SPANNER_SYS aggregates purely by tag string:

1. **Other jobs:** filter to the suffixed tags (`arm:%:homo`/`arm:%:hetero`);
   bare `arm:checks` etc. are unrelated jobs.
2. **Reusing a tag after relaunch (the subtle one):** if you drain an arm and
   relaunch it with the **same `--spanner-tag`** (e.g. fixing a bug and
   re-running `arm:noxlock`), any interval that spans the drain→relaunch
   boundary **blends the old job's stats into the new tag.** This is worst for a
   pathological arm (its old aborts inflate the new numbers) and shows up as a
   metric that drifts the wider your window gets. **Mitigation:** get the new
   jobs' `createTime` (`gcloud dataflow jobs describe ... --format='value(createTime)'`)
   and filter `interval_end >= <first full interval strictly after relaunch>`.
   There's usually a tell — an interval with **0 commits** at the drain/relaunch
   gap; only trust intervals after it. (Alternatively, use distinct tags per
   relaunch generation, e.g. `arm:noxlock2`.)

### Pitfall 3 — single TOP_MINUTE is too small; sum within ONE interval only

Two failure modes:

- **Don't `SUM` abort/attempt across overlapping `TOP_10MINUTE` buckets** —
  buckets recount, producing >100% abort ratios.
- **A single latest `TOP_MINUTE` interval is a thin (~1 min) sample** and reads
  near-zero-abort even when steady-state contention exists.

The right tool is the **latest single `TOP_10MINUTE` interval** (one clean
10-min window, ~10x the sample, no overlap): `WHERE interval_end = (SELECT
MAX(interval_end) FROM ...TOP_10MINUTE)`. Combine with the post-relaunch filter
from Pitfall 2 so the window is both clean and uncontaminated. (Observed: the
same arm read 0.8% abort on one TOP_MINUTE interval but 4.5% on a clean
post-relaunch 10-min window — the minute was just too small.)

### Pitfall 4 — don't attribute LOCK_STATS lock-wait per arm

`LOCK_STATS` keys by `row_range_start_key`; `transaction_tag` only appears in
*sampled* `sample_lock_requests`. Summing `lock_wait_seconds` per unnested tag
double-counts. Report lock-wait at the **table level only** (parse the table
from `row_range_start_key`). Use abort rate + commit latency (TXN_STATS, which
*does* key by tag) as the per-arm proxy.

### Pitfall 5 — Pub/Sub subscription metrics do not show pipeline backlog

Streaming Engine acks on read, so `num_undelivered_messages` /
`oldest_unacked_message_age` stay small while the pipeline falls arbitrarily far
behind. Judge whether an arm is keeping up with
`gcp.dataflow.job.data_watermark_age` and `gcp.dataflow.job.system_lag`, per
stage when a single stage is suspect.

### Pitfall 6 — a width-1 band caps throughput; contention shows as latency, not aborts

Writes for one entity serialize on its single `generation_shards` /
`budget_usage` row, so an arm's ceiling is roughly
(active entities × 1/commit latency) and **more workers or more admitted traffic
cannot raise it** — they only deepen the in-pipeline backlog. `max_commit_delay`
(`generation_stream.py`) is inside that serialized latency. Spanner blocks the
queued writer rather than aborting it, so read commit latency, not abort/retry/
DLQ counts, to see this backpressure. Corollary: manufactured single-row
contention yields the short wound-wait `RetryInfo` hint, not the long hints that
come from waits exceeding the transaction deadline. `--commit-delay-ms` and the
transaction timeout change that regime; band width and worker count don't.

### Pitfall 7 — batch size tracks backlog, not worker count

The batcher flushes on a fixed timer, so rows/txn is the per-key arrival rate
over one flush window. A **backlogged** arm drains a queue each flush and so
commits larger, prod-shaped batches; the same arm caught up commits much
smaller ones. Raising workers to chase prod-shaped batches is backwards.

### Working queries

Use `TOP_10MINUTE` at its single latest interval (clean 10-min sample, no
overlap). If you relaunched arms with reused tags, replace `interval_end =
latest.ie` with `interval_end >= TIMESTAMP('<first interval after relaunch>')`
per Pitfall 2.

```sql
-- TXN_STATS: per-arm aborts + latency, LATEST 10-min interval, suffixed tags
WITH latest AS (
  SELECT MAX(interval_end) ie FROM SPANNER_SYS.TXN_STATS_TOP_10MINUTE
)
SELECT REGEXP_EXTRACT(transaction_tag, r'^(arm:[a-z0-9]+)') AS arm,
       SUM(commit_attempt_count) commits,
       SUM(commit_abort_count)   aborts,
       ROUND(SAFE_DIVIDE(SUM(commit_abort_count),
                         SUM(commit_attempt_count))*100, 1) abort_pct,
       ROUND(AVG(avg_total_latency_seconds)*1000, 0) avg_ms
FROM SPANNER_SYS.TXN_STATS_TOP_10MINUTE, latest
WHERE interval_end = latest.ie
  AND transaction_tag LIKE 'arm:%:%'
GROUP BY arm ORDER BY arm;

-- LOCK_STATS: by TABLE only (latest 10-min interval)
WITH latest AS (SELECT MAX(interval_end) ie FROM SPANNER_SYS.LOCK_STATS_TOP_10MINUTE)
SELECT REGEXP_EXTRACT(
         SAFE_CONVERT_BYTES_TO_STRING(row_range_start_key),
         r'^(_?[A-Za-z_]+)\(') tbl,
       ROUND(SUM(lock_wait_seconds),1) lock_wait_s
FROM SPANNER_SYS.LOCK_STATS_TOP_10MINUTE, latest
WHERE interval_end = latest.ie
GROUP BY tbl ORDER BY lock_wait_s DESC;

-- QUERY_STATS: per-statement RMW cost (latest 10-min interval)
WITH latest AS (SELECT MAX(interval_end) ie FROM SPANNER_SYS.QUERY_STATS_TOP_10MINUTE)
SELECT request_tag, SUM(execution_count) execs,
       ROUND(AVG(avg_cpu_seconds)*1000,2) avg_cpu_ms
FROM SPANNER_SYS.QUERY_STATS_TOP_10MINUTE, latest
WHERE interval_end = latest.ie
  AND request_tag LIKE 'arm:%:%'   -- ALL statements, not just shard_*
GROUP BY request_tag ORDER BY request_tag;
```

## Reading the results — what actually matters

- **Read PER-STATEMENT, not aggregate.** Aggregate transaction latency washes
  out the signal. The interesting deltas live in individual statements — e.g.
  the lock fix cut `shard_insert` latency ~8x (360ms→42ms) while barely moving
  the transaction total.
- **Always include `budget_update` / `budget_insert`.** Counterintuitively,
  `budget_update` is the **single most expensive statement** in the generation
  transaction (observed ~80ms CPU, ~650ms latency — ~10x any `generation_shards`
  statement). It's easy to tunnel-vision on `generation_shards` (the table the
  lock experiment targets) and miss that budget is the real cost center. Query
  all six tagged statements: `gen_exists`, `entity_insert`, `shard_insert`,
  `shard_update`, `budget_insert`, `budget_update`.
- **Abort rate is TRANSACTION-level, not per-statement.** It lives in TXN_STATS
  by `transaction_tag`; QUERY_STATS has no abort column. An abort rolls back the
  whole transaction, so report abort% as a per-arm header that spans all that
  arm's statements — you cannot attribute it to one statement.
- **CPU vs latency tells you wait vs compute.** If latency differs across arms
  but CPU is flat, the difference is lock-wait, not work.
- **Watch for cost displacement.** A lever can move contention rather than
  remove it — e.g. dropping the shard exclusive lock cut `shard_insert` latency
  but *raised* `budget_insert` latency (25ms→117ms) and added aborts. Look at
  every statement + the abort rate before declaring a winner.

## Anchor to prod for scale

Staging is a small slice (~5%/arm) and a hot entity concentrated onto one
partition is *more* contended per-row than prod, so staging's absolute latencies
run higher than prod — only the relative ordering across arms is trustworthy.
To sanity-check scale, compare against prod on the SAME statements. Prod's
generation-writer statements are **untagged** (the `arm:` request tags are
staging-only), so match by SQL `TEXT` instead of tag, against the prod instance
(`--instance=usage-record --database=usage`):

```sql
WITH latest AS (SELECT MAX(interval_end) ie FROM SPANNER_SYS.QUERY_STATS_TOP_10MINUTE)
SELECT CASE
         WHEN text LIKE '%UPDATE budget_usage%'                       THEN 'budget_update'
         WHEN text LIKE '%INSERT%budget_usage%'                       THEN 'budget_insert'
         WHEN text LIKE '%UPDATE generation_shards%'                  THEN 'shard_update'
         WHEN text LIKE '%INSERT OR IGNORE INTO generation_shards%'   THEN 'shard_insert'
         WHEN text LIKE '%generations@{FORCE_INDEX=generations_by_id}%'
                                                                    THEN 'gen_exists'
         ELSE 'other' END stmt,
       SUM(execution_count) execs, ROUND(AVG(avg_cpu_seconds)*1000,2) cpu_ms,
       ROUND(AVG(avg_latency_seconds)*1000,2) lat_ms
FROM SPANNER_SYS.QUERY_STATS_TOP_10MINUTE, latest
WHERE interval_end = latest.ie
  AND (text LIKE '%budget_usage%' OR text LIKE '%generation_shards%'
       OR text LIKE '%generations_by_id%')
GROUP BY stmt ORDER BY cpu_ms * execs DESC;
```

Confirmed in prod (same window): **`budget_update` is the dominant write cost
there too** — ~46ms CPU × ~59k execs/10min, vs `shard_update` ~7ms and
`gen_exists` ~13ms. So "budget, not generation_shards, is the cost center" is a
real prod property, not a staging artifact. Note the prod `budget_usage`
*reads* (a `SELECT billable_entity_id, budget_entity_type ...`, ~520k execs) are
the auth/API path, not the writer — exclude them from write comparisons.

### If you want prod observability (you probably don't need request tags)

Tempting conclusion: "turn on the request tags in prod too." Usually
unnecessary, and there's a trap.

- **`QUERY_STATS` already gives you per-statement prod data for free**, grouped
  by SQL `TEXT` (the query above). The whole per-statement `request_tag`
  machinery exists only because staging runs *multiple arms with identical
  statement text* that must be told apart. Prod has one "arm", so text grouping
  already yields the per-statement breakdown — no tagging needed.
- **What prod actually lacks is TXN/LOCK_STATS attribution** (commit latency,
  aborts, lock-wait) for the generation writer, since those tables key on
  `transaction_tag`, not text. If you want that, set a single static
  `transaction_tag` (e.g. `"gen-writer"`) — that's the one already-guarded line
  in `SpannerTransactionSink` (`if self._spanner_tag is not None: ...`). Cheap
  (~µs), low-cardinality, safe.
- **Do NOT enable prod tagging by setting `--or_spanner_tag` on a prod deploy.**
  In the deploy script the spanner tag and `--or_generation_id_salt` are pushed
  together and the salt is *derived from the tag* — and the salt **mutates
  `generation_id`** (prefixes it), which is catastrophic in prod (breaks the
  unique index, dedup, and every downstream lookup). Salting must stay
  hard-gated to `isStaging` forever. Prod tagging, if ever wanted, means
  decoupling the tag from the salt first and defaulting a static
  transaction_tag in code — not reusing the staging flag.

## Interpreting lever tradeoffs

Each lever trades against something else — abort rate is the universal guardrail
(the early exclusive lock exists to *suppress* aborts). Empirical (one staging
run on the whale partition; relative ordering is the signal, absolute numbers
are inflated vs prod):

- `--drop-shard-exclusive-lock` → biggest cut to `shard_insert` lock-wait
  (~8x), BUT **highest abort rate** (~4% vs ~3% control) and displaces cost to
  `budget_insert`. A targeted fix for shard-insert wait, not a free win.
- `--commit-delay-ms` lower → lowest abort rate and lowest overall txn latency
  in practice; neutral on per-statement CPU at staging volume. The safest
  all-rounder. (Theory says it costs Spanner CPU via less group-commit
  amortization — watch for that at higher volume.)
- bigger batches → fewer transactions per hot row, so it most reduces the
  dominant cost (`budget_update` CPU & latency). Strong on the real cost center.

Compare arms at **steady state and balanced volume**; if a treatment arm has far
fewer commits than control it's still ramping — don't conclude yet.

## Stopping an arm

**Do not stop jobs from the command line.** Stopping a Dataflow job is
irreversible, and this skill deliberately documents no destructive commands.
When you need to stop an arm, do it by hand in the **Cloud Console UI** so a
person confirms each action:

1. Open the [Dataflow jobs
   list](https://console.cloud.google.com/dataflow/jobs?project=openrouter-core)
   (region `us-central1`), find the `usage-record-staging-*` job, and **Drain**
   it there. Always Drain, never Cancel — a drain lets in-flight work commit,
   whereas Cancel drops it; when in doubt, drain.
2. Stopping a job does **not** remove its ephemeral Pub/Sub subscription — the
   sub keeps receiving (backlog climbs) until its 1-day TTL expires. If you want
   it gone sooner, delete it by hand from the [Pub/Sub subscriptions
   list](https://console.cloud.google.com/cloudpubsub/subscription/list?project=openrouter-core)
   (look for the `*-dataflow-staging*` name).

The `*-dataflow-staging*` subs are excluded from the backlog Datadog monitor
(in `configs/terraform-monitors/`), so they won't page — confirm that exclusion
is actually applied before a long run, and you can let a short-lived sub age out
on its own rather than deleting it.

## Gotchas

- **ADC, not just CLI login.** The deploy script's `JobsV1Beta3Client` (job
  lookup) uses Application Default Credentials. `gcloud auth login` alone isn't
  enough — run `gcloud auth login --update-adc` (or `gcloud auth
  application-default login`) or it fails with `invalid_rapt` / reauth after the
  image build.
- **Image freshness.** Flags only take effect in a freshly built image; arms
  launched on an older image silently lack new flags/tags. Relaunch after code
  changes.
- **`transaction.insert()` rows aren't in QUERY_STATS.** The raw `generations`
  insert is a buffered mutation (not DML), takes no `request_options`, and is
  covered only by `transaction_tag` at commit — you can't get a per-statement
  QUERY_STATS row for it.
- **At staging scale, the lock-wait profile can differ from prod.** Observed
  `_Index_generations_by_id` lock-wait exceeding `generation_shards` in staging
  even though prod data had `generation_shards` dominant — don't assume the prod
  bottleneck reproduces; measure it.
