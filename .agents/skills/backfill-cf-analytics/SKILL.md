---
name: backfill-cf-analytics
description: >-
  Replay Cloudflare GraphQL Analytics into Datadog after the cf-analytics-sync
  cron has been down — find the gap, run scripts/cf-analytics-backfill.ts over
  the missing range, and verify the points actually landed.
user-invocable: true
---

# Backfill Cloudflare Analytics into Datadog

Use when the `[CF Analytics] GraphQL to Datadog sync is dead` monitor fires, or
whenever `openrouter.cloudflare.*` has a hole. The cron
(`CronTask.CF_ANALYTICS_SYNC` in `services/cfw-internal`) only ever queries the
last 30 minutes (`packages/cloudflare/cf-analytics/time-window.ts`), so an
outage longer than that leaves a permanent gap that must be replayed by hand.

## 1. Find the gap

Query with the native `datadog` MCP server (`query_metrics`), not a community
server. A high-volume metric shows the boundaries clearly:

```text
sum:openrouter.cloudflare.workersInvocationsAdaptive.sum.requests{env:production}.rollup(sum,300)
```

Use a `from`/`to` range wide enough to show healthy traffic on both sides of the
hole. Take the last point before the gap and the first point after it; the
buckets adjacent to a gap are usually partially filled, so round outward to
whole minutes.

Confirm the sync itself has recovered before backfilling — otherwise the replay
just leaves a new gap behind it:

```text
sum:openrouter.cf_analytics.sync_complete{env:production,outcome:success}.as_count()
```

## 2. Credentials

`CLOUDFLARE_ANALYTICS_TOKEN` and `DD_API_KEY` must be exported. Both live in
Infisical under `/services/cfw-internal-api`; read them non-interactively per
the Infisical section of the root `AGENTS.md`. Never print or commit values.

## 3. Run the backfill

```bash
LOG_LEVEL=1 infisical run --path=/services/cfw-internal-api -- \
  bun scripts/cf-analytics-backfill.ts --start <ISO> --end <ISO>
```

`LOG_LEVEL=1` makes the sync-side info and error diagnostics visible, including
the failure reasons behind empty, partial, and failed datasets. The script also
prints each window, retry attempt, and final dataset outcome directly to stdout.

Boundaries must be whole minutes and are half-open — `start` inclusive, `end`
exclusive — matching Cloudflare's `datetime_geq` / `datetime_lt` filters. Set
`--end` at least four minutes before the current time (`validateBackfillRange`
enforces this): Cloudflare's adaptive analytics ingestion lags real time — a
minute queried ~2 minutes after it closes carries roughly half of its final
count and settles by ~3-4 minutes — so an earlier `--end` would overwrite the
cron's points with undercounted values. The script splits the range into 30-minute chunks and
replays every dataset the cron syncs, submitting each point at its original
timestamp. Re-running an
already-covered range is safe: the series are gauges, so identical points
overwrite.

The script always prints a stdout summary with the window count and every
window plus query in the `Failures`, `Partial`, and `Empty` sections. A clean
run has no entries in those sections. `partial` means some rows in the window
were not retrieved or submitted, causes a non-zero exit, and requires
re-running that specific window. `empty` means the response did not contain a
rows array, or that the top-colos query returned rows but no colo codes and the
colo datasets were skipped; it causes a non-zero exit. Use the reported query
to distinguish these cases: for other queries check the Cloudflare token scope
and GraphQL response shape, while for the top-colos query inspect the colo
response before re-running that specific window. Do not treat an empty source
range as an `empty` outcome. Other genuine failures cause a non-zero exit. The
script automatically retries each window with a failure or partial outcome a
small, fixed number of times; re-run only the window and query still listed
after those retries, rather than the whole range.

## 4. Verify

Review the stdout summary and address every listed partial or failed window
before considering the replay complete. For an empty entry, correct the
reported structural or top-colos cause before re-running its window. Then
re-query the metric from step 1 and confirm points now exist across the whole
range, at levels comparable to the surrounding traffic. A zero exit code is not
sufficient evidence — and
neither is an empty graph right after the run, because historical points arrive
late (see below). Allow for the latency before concluding anything was lost.

## Historical Metrics Ingestion

Any point whose timestamp is more than an hour older than the submission time is
a _historical_ metric.
[HMI](https://docs.datadoghq.com/metrics/custom_metrics/historical_metrics/)
must be enabled for the metric (Metrics Summary page; counts, rates and gauges
only) or those points are simply not ingested. Re-submitting the same timestamp
is safe: Datadog keeps the most recently submitted value.

Ingested historical points do not appear immediately. Latency depends on how far
back the timestamp is:

| Point age at submission | Ingestion latency                      |
| ----------------------- | -------------------------------------- |
| 1–12 hours              | Near-real-time ingestion, up to 1 hour |
| 12 hours – 30 days      | Up to 14 hours                         |
| Over 30 days            | Over 14 hours                          |

So a same-day gap can take up to an hour to fill in, and anything older than
half a day can take most of a day. Do not re-run the backfill because the graph
still looks empty — wait out the latency window first, then re-verify. Historical
points are billed as indexed custom metrics, so avoid gratuitous re-runs.

## Other limits

- **Cloudflare GraphQL retention.** The minute-granularity adaptive datasets are
  retained for days, not weeks; past that there is no source data.
- Backfill as soon as the gap is known — the older the timestamps get, the worse
  the ingestion latency and the closer the Cloudflare retention cutoff.
