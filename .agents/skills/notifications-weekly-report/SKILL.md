---
name: notifications-weekly-report
description: >-
  Weekly metrics report for the notifications feature. Produces a seven-day
  delivery table and a right-now configuration snapshot, then posts one Slack
  message into #weekly-product-insights (C0BS9CC9PQD).
user-invocable: true
---

# Notifications Weekly Report

Runs Mondays at 9:00 America/New_York. Post one head message and one thread reply, no attachments, to `#weekly-product-insights` (`C0BS9CC9PQD`). Cover the last 7 complete UTC days against the 7 before them. Manual runs accept `--end` (exclusive UTC date) and a different channel.

## Rules

- Read-only. Never commit report output.
- Derive dates from the run date. Never include a partial day.
- Report the numbers the script produces. If two totals disagree, state the gap instead of reconciling it.
- A prior-week zero is not a percentage: write "no comparable traffic last week". Do not quote a week-over-week change across an instrumentation change.
- An empty result is not a zero until you confirm the facet exists on the queried line.
- No destination data: no endpoint URLs, tokens, response bodies, or raw errors. Only policy, channel, `failure_reason`, and counts.
- Credits-low and credit-expiration are out of scope.

## What each number means

- **Alert events**: distinct `alert_key` per policy. Not the sum of delivered and failed.
- **Delivered / failed**: final per-destination outcomes; `failed` excludes `should_retry:true` attempts. On a bulk notice one line is one tenant, never one email.
- **Configured**: `max:openrouter.alert_policy.active_entities` by `policy_key`, `channel`, `scope_type`, at run time. Not part of the seven-day window. Never use `enabled_entities`.
- **Tenant-alert publications**: distinct `dedup_key` on `alert-delivery:event-outcome`. Thread reply only.
- **Retried alerts**: distinct `dedup_key` on `should_retry:true` failed lines.

The script excludes test sends (`test:` `dedup_key` prefix, see [PLA-1694](https://linear.app/openrouter/issue/PLA-1694)) and per-email `outcome_scope:batch` lines.

## Steps

1. **Fetch.** `DD_API_KEY` / `DD_APP_KEY` (US5) live in Infisical at `/services/cfw-api`. If the automation has not injected them, inject them without printing:

   ```bash
   WORKDIR=$(mktemp -d)
   source scripts/infisical/agent-auth.sh && infisical_auth \
     && infisical_run /services/cfw-api python3 .agents/skills/notifications-weekly-report/scripts/fetch_notifications.py --out "$WORKDIR"
   ```

   Output: `$WORKDIR/notifications.json`. Takes a few minutes. On a group-by-limit abort, raise that limit (keep the product under 10,000) and re-run. It marks the snapshot unavailable if a gauge sample is older than three hours.

2. **Check** before posting:
   - Failure-reason totals and channel totals both equal the failed total.
   - Every policy in `alert_events_by_policy` has a table row. If not, name it: if it is in `retried_alerts_by_policy`, it had retries but no final outcome within the window; otherwise it had no delivery attempts.
   - If `retried_alerts_by_policy` is non-zero, check the `[Alert Delivery] DLQ has undelivered messages` monitor for the window. If it fired, say in the thread that dead-lettered alerts are missing from `failed`.
   - If `zero_delivery_counter_events_by_policy` is non-zero, say in the thread that the policy's alert-event count is a lower bound.
   - Before calling zero deliveries on a configured row a gap, check `eligible_endpoint_count` on that policy's `event-outcome` lines.
   - Before calling a quiet notice week a delivery problem, check `gcp-model-dep-alert-producer` in GCP Cloud Logging (`openrouter-core`).

3. **Post** in raw Slack mrkdwn per [slack-mrkdwn](../slack-mrkdwn/SKILL.md), and run its sanity check. Fill only the bracketed slots in the templates; bold is single `*`, never `**`. Counts of 1,000 or more take a thousands separator. The head message stays under ~2,000 characters and the reply under ~4,000.

   Head message:

   1. `*:bar_chart: Notifications · <Mon D>–<Mon D>, <YYYY>*`
   2. `:envelope: <N> alert events <trend> · :white_check_mark: <N> delivered <trend> · :x: <N> failed <trend>`, where `<trend>` is `:chart_with_upwards_trend: +<P>%`, `:chart_with_downwards_trend: -<P>%`, or `(unchanged)`.
   3. A delivery table in a code block, with the policy and events cells printed only on each group's first row. Omit rows that are all zero.

      ```text
      policy                events  dest     delivered  failed
      --------------------  ------  -------  ---------  ------
      budget-limit               3  email            3       0
                                    webhook          0       1
      ```

   4. `Configuration snapshot · now`, then a code block with the columns `policy  dest  scope  configured`, in JSON order. Omit rows where `configured` is 0.
   5. ``_events = distinct alerts · delivered/failed = final outcome per destination (per tenant on bulk notices) · configured = can receive it now_``
   6. The single biggest change in at most 15 words, ending with `· detail in thread`.

   Keep each code block's lines at or under ~72 characters: left-align the labels, right-align the numbers, and separate columns with two spaces.

   Thread reply:

   1. `*Detail · Notifications, <this window> vs <prior window>*`
   2. `•` bullets with week-over-week movement per policy and destination.
   3. A code block with failures by policy, channel, and `failure_reason`, if there are any.
   4. `Caveats:` listing only the gaps that apply this week, always including the test-send caveat with PLA-1694.
   5. A plain correction if the head message was wrong.

## Known gaps

- Datadog keeps raw logs for about 15 days.
- A policy suppressed before delivery (`policy_disabled`, no eligible endpoint) looks the same as no traffic.
- There is no endpoint-to-tenant inventory, so the report describes deliveries, not how many destinations exist.
