---
name: notifications-weekly-report
description: >-
  Weekly metrics report for the notifications feature. Produces one table, a row
  per alert policy and destination with active users, alert events and delivery
  outcomes, and posts one Slack message into #analytics-insights (C0BS9CC9PQD).
user-invocable: true
---

# Notifications Weekly Report

One table, one row per alert policy and destination:

| alert policy | destination | active users | alert events (per policy) | delivered | failed |

`active users` is a state count per entity; the other three are event counts.
They sit in one row for reading, but they are not a funnel and do not divide
into each other.

This runbook is the versioned definition of the report. The Devin automation's
prompt invokes this skill; keep them in sync when the procedure changes.

## Cadence & delivery

- **Schedule:** weekly, Monday 13:00 UTC, via the Devin automation **Weekly
  notifications report**, covering the last 7 complete UTC days against the 7
  before them.
- **Slack footprint:** one head message and exactly one thread reply in
  `#analytics-insights` (`C0BS9CC9PQD`), with no attachments.
- **Manual runs:** accept an end-date override (`--end`, exclusive UTC boundary)
  and a Slack-channel override.

## Required access

- **Datadog** (US5, `DD_API_KEY` / `DD_APP_KEY`) — `service:alert-delivery` logs
  for the event and delivery columns, `openrouter.alert_policy.*` gauges for
  active users. Log retention caps raw-log history at ~15 days; metric history is
  longer.
- Both keys live in Infisical `/services/cfw-api` and are logs/query-scoped —
  enough for every query here, not enough to write a dashboard. The automation
  environment injects them; when it does not, read them from Infisical rather
  than asking for a credential:
  `infisical secrets get DD_API_KEY --env=dev --path=/services/cfw-api --plain`
  (the repo-root `.infisical.json` supplies the project). A non-interactive run
  needs a universal-auth token first — see the `testing-mission-control-local`
  skill for that login line.

## Guardrails

- **Read-only.**
- **Do not commit report output.** Only this skill and its scripts live in the
  repo.
- **Derive dates from the run date**, never hardcode them, and never mix a
  partial day into an average or a week-over-week comparison.
- **Credits-low and credit-expiration notifications are out of scope** — they
  belong to PLA-1210.
- **No destination data in the report.** No endpoint URLs, encrypted
  destinations, Slack tokens, response bodies or raw errors: policy, channel,
  `failure_reason` and counts only.
- **State the numbers the scripts produce.** If two totals disagree, report the
  gap instead of reconciling it silently.
- **Never quote a week-over-week change across an instrumentation change.** If a
  series starts, stops or steps inside the window, report levels and say the
  baseline is partial.
- **An empty result from a mismatched query is not a zero.** Confirm the facet
  exists on the line being queried before reporting absence.

## Definitions

- **Destination** — `webhook`, `slack` or `email`, the delivery channel. Webhook
  and Slack destinations are `alert_delivery_endpoints` rows; email has no
  endpoint row and is addressed from the account.
- **Active users** — entities entitled to the policy, with it enabled, **and**
  with a destination that would actually receive the alert: at least one active
  endpoint of that type for webhook and Slack, a deliverable address for email.
  Enabled-but-undeliverable does not count.
- **Alert events** — the number of distinct alerts the policy produced in the
  window, measured as the cardinality of `dedup_key` on the
  `alert-delivery:event-outcome` lines. It is **not** the sum of
  `delivered_count` and `failed_count`: those are per-endpoint outcome
  counters, so they count a fanned-out alert repeatedly and count a
  republished alert repeatedly. The event line carries aggregate counters
  (`delivered_count`, `failed_count`, `skipped_count`, `errored_count`,
  `eligible_endpoint_count`, `policy_subscribed_endpoint_count`,
  `circuit_open_count`), and has no `outcome` field or `channel` field. Because
  there is no channel, the alert-event figure is per policy and repeats across
  that policy's destination rows. Datadog cardinality is approximate at large
  volumes.
- **Delivered / failed** — final outcomes of the per-endpoint delivery attempts,
  one `alert-delivery:delivered` or `alert-delivery:failed` line each. Per
  endpoint, not per alert event, so they exceed the event count when a policy
  fans out.
- Payload facets: `@data.jsonPayload.extra.policy_key`, `.channel`,
  `.failure_reason`, `.endpoint_id`, `.outcome_scope`, `.is_test`.

## Steps

1. **Fetch the data** — run
   `python3 scripts/fetch_notifications.py --out <workdir>` (add `--end` for a
   manual override). It writes `<workdir>/notifications.json` with every column
   for both windows. Expect a few minutes of paced Datadog calls.

   Active users, `POST /api/v2/query/timeseries` per window, last point of each
   series:

   ```text
   sum:openrouter.alert_policy.active_entities{*} by {policy_key,channel}
   ```

   Delivered, `POST /api/v2/logs/analytics/aggregate` per window, grouped by
   `policy_key` and `channel`, with `count` and `cardinality` of `endpoint_id`.
   Failed uses the same grouping plus `failure_reason`. Both use the
   `DELIVERY_QUERY` filter below:

   ```text
   service:alert-delivery ("alert-delivery:delivered" OR "alert-delivery:failed")
     -@data.jsonPayload.extra.outcome_scope:batch
     -@data.jsonPayload.extra.dedup_key:test\:*
   ```

   Datadog drops log rows missing a group-by facet, so group each facet only on
   lines that carry it.

   Alert events, grouped by `policy_key`, with cardinality of `dedup_key`:

   ```text
   service:alert-delivery "alert-delivery:event-outcome"
     -@data.jsonPayload.extra.is_test:true
   ```

2. **Reconcile** — before posting anything: the failure-reason totals and the
   channel totals each sum to the window's failed attempts. Per-endpoint
   outcomes are at least the alert-event count and exceed it whenever a policy
   fans out or an event is republished. Compare the event total in
   `notifications.json`'s `alert_events_by_policy` against the table's alert-event
   column and state any policy that appears only in the former, because a policy
   with alert events but no delivery attempts has no destination row.

3. **Post** — send exactly one head message followed by exactly one thread reply
   in Slack mrkdwn. The automation session's first response is the top-level
   channel message:

   1. A bold title line, rendered exactly as this template:
      `**:bar_chart: Notifications · <Mon D>–<Mon D>, <YYYY>**`
      Nothing else goes on that line: no `weekly`, no `(UTC)`, and no
      `vs <prior window>` suffix. The prior window is named in the thread
      reply's title instead.
   2. A one-line KPI strip, rendered exactly as this template:
      `:envelope: <N> alert events <trend> · :white_check_mark: <N> delivered <trend> · :x: <N> failed <trend>`
      where `<trend>` is `:chart_with_upwards_trend: +<P>%` for a rise,
      `:chart_with_downwards_trend: -<P>%` for a fall, and `(unchanged)` when
      the prior week is comparable and the value did not move. A KPI with no
      comparable prior week says so in words in place of the percentage. Never
      write the strip as prose without the emoji.
   3. The policy/destination table in a triple-backtick block, plain
      space-separated columns with a hyphen rule under the header, no box-drawing
      characters. Left-align the two label columns, right-align the four number
      columns, pad each column to its widest cell, and separate columns by two
      spaces. Keep the header words short so the widest line stays at or under
      ~72 characters, since a wider block wraps in Slack on a narrow view. Alert
      events are per policy and repeat across that policy's destination rows.

      ```
      policy                dest     active users  events  delivered  failed
      --------------------  -------  ------------  ------  ---------  ------
      api-key-budget-limit  email               4       1          1       0
      budget-limit          webhook             2       4          0       0
      model-deprecated      email           2,922       0          0       0
      ```
   4. One closing sentence naming the single thing that actually changed this
      week and ending with `detail in the thread`.

   The session's next message is the thread reply:

   1. A bold line:
      `**Detail · Notifications, <this window> vs <prior window>**`.
   2. Hyphen bullets for week-over-week movement per policy and destination.
   3. A triple-backtick block for the failure breakdown by policy, channel and
      `failure_reason`, omitting entries with no data.
   4. A `Caveats:` paragraph containing only the gaps that apply this week,
      including the test-button caveat and [PLA-1694](https://linear.app/openrouter/issue/PLA-1694)
      whenever failures could not be filtered at the attempt level.
   5. If the head message needs correction, state it plainly in the reply.

   Use `**double asterisk**` for bold, never single asterisks. Do not use
   headers, Markdown tables or attachments. Keep the head message under ~2000
   characters and the reply under ~4000 characters.

## Specifications

- 7 complete UTC days versus the 7 before; partial days never appear.
- One head message and exactly one thread reply generated from freshly fetched data.
- One row per policy and destination.
- The head-message table uses plain space-separated columns, and its widest line
  stays at or under ~72 characters. The active-users column header reads
  `active users`, never `active`.
- Counts of four or more digits carry a thousands separator (`2,922`, never
  `2922`), in the KPI strip and in the table.
- A row is absent when alert events, delivered, failed and known active users are
  all zero; retain it when active users are `"unavailable"`.
- Delivered and failed are per endpoint. Never present them as a count of alerts
  or of users notified.
- A destination row's active users and its alert-event figure can describe
  different entities: the event figure is per policy and repeats across the
  policy's rows. Zero deliveries on a row with active users is therefore not a
  delivery gap on its own. Before reporting one, query that policy's
  `alert-delivery:event-outcome` lines and read `eligible_endpoint_count` per
  event: it is per event, so `notifications.json` does not carry it.
- Every reported metric carries its week-over-week change or states why it has
  none.

## Data gaps to state

- **`active users` comes from the evaluator gauge.** The report sums
  `openrouter.alert_policy.active_entities` across `scope_type`, grouped by the
  gauge's `policy_key` and `channel` tags. Its channel values are `email`,
  `webhook` and `slack`, the same values used by the delivery logs. Do not
  substitute `enabled_entities`, which counts entities with no working
  destination. That sum assumes each policy declares one scope; if a policy
  declares both tenant and api-key scopes, group by `scope_type` instead because
  an entity configured at both scopes is counted once per scope.
- **Test sends in delivery counts.** Per-endpoint `delivered`/`failed` lines
  have no `is_test` marker, so the filter excludes test sends by `dedup_key`
  prefix. Every test send the frontend publishes carries the `test:` prefix, so
  the filter is exact today and rests on that convention: if a test path ever
  publishes a differently shaped key, its sends count as customer traffic until
  the filter is updated. [PLA-1694](https://linear.app/openrouter/issue/PLA-1694)
  replaces the convention with an attempt-level marker.
- **Producer-gated dry runs.** `model-deprecated` and `model-price-drop`
  publication is disabled in production: both flags are `"false"` in
  `services/gcp-model-dep-alert-producer/infra/cloud-run.tf`, so zero alert
  events are configuration-driven rather than adoption evidence. Report their
  event levels when non-zero, never read their absence as an adoption signal,
  and remove this caveat when the flags flip.
- Delivery attempts also produce an aggregate `outcome_scope:batch` failure line
  per email batch. Exclude it from per-endpoint aggregation, as the monitors do.
- A policy with alert events but no delivery attempts has no destination row and
  is therefore absent from the table. Suppression (`policy_disabled`, no eligible
  endpoint) looks identical to no traffic. Compare the event total in
  `notifications.json` against the table's alert-event column and state any
  policy that only appears in the former.
- The fetch aborts rather than publishing if any group-by limit is reached. Raise
  the corresponding limit while keeping the product under 10,000, then re-run.
- Datadog log retention bounds raw execution history at ~15 days. The
  `alert_delivery.attempt` / `.failure` log metrics carry `policy_key` and
  `channel` since #39390, so per-policy history outlives the log window from
  that point forward, but earlier weeks are not backfillable.
- No endpoint-to-tenant inventory in the warehouse, so the report says what
  happened to deliveries, not how many destinations exist.
- **Render the head templates literally.** Fill only the bracketed slots in the
  title and KPI strip. Rewording either into prose, or dropping a thousands
  separator, is drift from this spec.

## Advice and pointers

- Delivery logs are `service:alert-delivery` with the payload under
  `@data.jsonPayload.extra.*`.
- Datadog log analytics rate-limits aggressively; the fetcher paces and retries,
  so let it run rather than issuing the queries by hand in parallel.
- A log aggregation is rejected when the group-by limits multiply past 10,000
  combinations. Policy and channel are both bounded, so keep the per-facet limit
  small.
- The log metrics outlive the logs, so a metric day total can exceed what the log
  query returns. Check the metric daily series before calling any weekly number a
  rate — one incident day can be the whole history.
