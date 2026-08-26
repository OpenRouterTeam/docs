---
name: rerank-adoption-report
description: >-
  Daily adoption report for rerank models. Combines ClickHouse usage metrics
  (default.generations, api_type='rerank') with status-field reliability
  signals to track daily and weekly users, requests, revenue, cost per request,
  model mix, and failures. Runs daily on a Devin schedule (weekdays) and posts
  a single threaded summary to Slack #metrics-multi-modality (C0BCV3YNZKK).
user-invocable: true
---

# Rerank Adoption Report

Generate a daily adoption report for rerank models from ClickHouse. The report
tracks user growth, request volume, revenue, model mix, and reliability for
the rerank API and is posted to Slack for the multi-modality team.

This runbook is the versioned, reviewable definition of the report. It replaces
the inline prompt of the **Daily Rerank Adoption Slack** Devin schedule; keep
it in sync when the procedure changes.

## Cadence & delivery

- **Schedule:** daily on weekdays (Mon–Fri), 14:30 UTC, wired via the Devin
  schedule **Daily Rerank Adoption Slack** whose prompt invokes this skill.
  The report always covers the most recent complete UTC day ("yesterday").
- **Monday vs. other weekdays**:
  - **Monday:** the headline leads with the week-over-week comparison (prior
    complete week vs. the week before). Saturday and Sunday daily breakdowns go
    in the thread, not the headline.
  - **Tuesday–Friday:** the headline leads with the day-over-day comparison
    (yesterday vs. the day before yesterday).
  - Generate all report sections every run; only headline vs. thread framing
    changes.
- **The skill owns the entire Slack footprint.** Leave the schedule's
  `start_session` `slack_channel_id` unset so the platform does not post a
  duplicate session card or mirror progress into the channel. The only channel
  output is the single Step 10 post and its thread.
- **Manual runs:** allow a date override and a Slack-channel override;
  otherwise use the defaults above.

## Required access

- **ClickHouse** `default.generations` (read-only), filtered by
  `api_type = 'rerank'`.
- **ClickHouse** `analytics.fact_daily_generations_activity` (read-only) as
  the certified dbt rollup cross-check from the `openrouter-data-warehouse`
  project.
- **Slack**: use the native `slack` tool granted by the automation to post to
  `#metrics-multi-modality` (channel `C0BCV3YNZKK`). The automation grants the
  channel via `tools.slack_channels` and attaches no Slack MCP server.
- **PostHog** (project 90142) — HogQL via the PostHog MCP, read-only. Needed for
  the rankings SEO section. It is often not exposed to this automation's
  sessions, so check `mcp_tool list_servers` at the start of every run and mark
  the rankings SEO reply explicitly unavailable when it is absent.

## Guardrails

- **Read-only queries.** Query ClickHouse only; never mutate warehouse data.
- **No fabricated data.** `default.generations` is the canonical source.
  Compare totals with `analytics.fact_daily_generations_activity` when its
  grain and freshness permit, and flag discrepancies rather than silently
  reconciling them.
- **No legacy adoption section.** Rerank has no legacy chat-completions
  equivalent. Do not invent an adoption-vs-legacy comparison; state explicitly
  that no such comparison applies.
- **Reliability has no Datadog source.** There is no Datadog rerank service to
  query. Use only the available ClickHouse status/finish fields and document
  the resulting coverage and limitations. Do not invent Datadog queries or
  failure events.
- **Derive dates with functions**, never hardcoded strings: use
  `today() - 1` / `today()` for boundaries and a date function for the
  day-of-week label.

## Context & rationale

Baseline comparison as of Jul 2026:

| Report | Daily users | Daily volume | Daily revenue |
|---|---:|---:|---:|
| Images | ~2,800 | ~108k gens | ~$5.7k |
| Video | ~990 | ~24k gens | ~$18.3k |
| STT | ~2,260 | ~467k | ~$414 |
| TTS | ~1,070 | ~141k | ~$535 |
| embeddings | ~17–19k | ~30M req | ~$1.5k |
| rerank | ~650 | ~200–450k req | ~$300–480 |

Rerank is smaller but growing, with roughly 2.3x as many requests over 30 days.
Daily DoD movement can be dominated by a handful of accounts; for example,
free `nvidia/llama-nemotron-rerank-vl-1b-v2` spikes can distort the headline.
Flag this concentration. If daily reports make the channel noisy, use a
weekly cadence or fold rerank into the embeddings post as the fallback.
Revenue is dominated by Cohere rerank models.

## Steps

1. **Determine the reporting context** — Derive the day of week with a real
   date function. Monday uses WoW framing plus Saturday/Sunday detail;
   Tuesday–Friday uses DoD framing. "Yesterday" is the most recent complete
   UTC day, bounded with `today() - 1` and `today()`.

2. **Identify the model set** — Re-derive active models every run from
   `default.generations` filtered by `api_type = 'rerank'`, grouping by
   `model_permaslug`. Keep raw permaslugs for accurate reporting.

3. **Query weekly users** — Compute week-to-date unique users from
   `default.generations`, broken down by model where useful, and compare with
   the prior complete week using absolute and percentage changes. Use
   `toStartOfWeek(created_at, 1)` for Monday-start weeks.

4. **Query daily users and new vs. repeat** — Compute yesterday's unique users
   and compare with the day before. Classify a user as new when their earliest
   rerank generation is on the reporting day; otherwise classify them as
   repeat. Materialize a first-seen-user CTE or equivalent rather than
   self-joining the full table. On Monday, report Saturday and Sunday
   individually.

5. **Query requests and revenue** — Compute daily request count (`count()`),
   total revenue (`sum(usage)`), and average cost per request overall and by
   model. Include absolute and percentage prior-period changes. Cross-check
   daily totals against `analytics.fact_daily_generations_activity` when
   available, and identify that Cohere models dominate revenue.

6. **Query model mix and shifts** — Report each model's request count and
   share, with day-over-day share change in percentage points. Alert on any
   single-model shift of at least 10 percentage points and identify the model,
   direction, and whether a concentrated account appears to explain it. Pay
   particular attention to free
   `nvidia/llama-nemotron-rerank-vl-1b-v2` spikes.

7. **Query reliability from ClickHouse status fields** — Count successful and
   failed/unsuccessful requests using the status, finish-reason, and other
   documented outcome fields present in `default.generations`. Report the
   failure rate as failed requests divided by all classified attempted
   requests, and break out unknown/unclassified outcomes. Do not infer all
   missing rows as failures. Rerank rows generally carry NULL `finish_reason`
   and NULL `normalized_finish_reason` with `cancelled = false`; when that
   holds, report 0% classified and no failure rate — never a 0% failure rate.
   State that this is ClickHouse-only reliability because no rerank Datadog
   service exists; do not run Datadog queries.

8. **Compile the report** — Use concise Slack mrkdwn, monospace tables in
   triple-backtick blocks, `**bold**` per the organization's Slack
   communication standard, `_italic_`, backtick
   inline code, and `<url|label>` links (not `[label](url)`). Do not use
   `#`/`##` headers or Markdown tables. Use clear separators. The
   Tuesday–Friday headline leads with daily users (new/repeat), requests,
   revenue, average cost/request, top model, model-mix alerts, and the
   ClickHouse-only reliability result. The Monday headline leads with WoW
   figures and the weekend breakdown goes in the thread. Explicitly note that
   legacy comparison is not applicable and call out account concentration.

9. **Query rankings SEO engagement** — Query PostHog (project 90142) via the
   PostHog MCP (HogQL, read-only) for the same reporting UTC day the rest of
   the report covers, scoped to the rankings page `/rankings/rerank`:
   - **Page traffic** — count of `$pageview` events whose `$current_url` /
     pathname matches `/rankings/rerank` (full-rate).
   - **Section engagement** — `rankings_section_view` grouped by the
     `section` property, ranked by volume. This event is 10%-sampled, so
     scale by the `sample_rate` property for any absolute figure and state
     that it is sampled; use the raw counts to rank sections relative to each
     other, not as exact totals.
   - **Deliberate navigation** — `click_rankings_section_nav` grouped by
     `section` (full-rate).
   - **Framing** — pair the page traffic against this report's own adoption
     number (e.g. daily users / generations) to express the
     traffic-vs-adoption signal ("lots of eyes on the page, little actual
     usage"). Hardcode the pathname `/rankings/rerank` for this skill; do
     not derive it from the skill name.

10. **Slack report** — Post exactly one top-level headline with the native
   `slack` tool to `#metrics-multi-modality` (channel `C0BCV3YNZKK`), capture
   its `ts`, then post every detail section with the native `slack` tool as a
   threaded reply using that `thread_ts`. Never post a second top-level message
   or duplicate a reply. If delivery is uncertain, inspect the thread with the
   native `slack` tool instead. Keep each message within ~4000 chars. Post the
   rankings SEO section as one additional threaded reply using the same
   `thread_ts`; do not add a second top-level message.
   Tuesday–Friday thread order: Weekly Users → Daily Users → Requests &
   Revenue → Model Mix → Reliability → Context/limitations → Rankings SEO.
   Monday order: WoW detail → Saturday breakdown → Sunday breakdown →
   Reliability → Context/limitations → Rankings SEO.

## Specifications

- All comparisons use complete midnight-to-midnight UTC periods.
- Every comparator shows both absolute and percentage change where meaningful.
- Daily active users must be split into new and repeat.
- Reliability is based only on ClickHouse status fields; never claim
  Datadog-backed coverage for rerank.
- The report must not contain an adoption-vs-legacy section: there is no legacy
  chat-completions equivalent for rerank.
- Validate request totals and the certified daily rollup cross-check before
  posting, and flag material discrepancies.
- Flag concentrated-account effects, especially free
  `nvidia/llama-nemotron-rerank-vl-1b-v2` spikes. Recommend weekly cadence or
  folding into embeddings if daily noise becomes operationally unhelpful.
- Derive the day-of-week label with a date function, never by hand.
- The rankings SEO section's `rankings_section_view` counts are 10%-sampled —
  scale by `sample_rate`; use them for ranking sections relative to each other,
  not exact counts. `$pageview` and `click_rankings_section_nav` are full-rate.

## Advice and pointers

- Key columns in `default.generations`: `api_type`, `model_permaslug`,
  `clerk_user_id`, `usage`, `created_at`, and the documented status/finish
  fields available in the current schema.
- The date column is `created_at`, not `date`.
- Use `analytics.fact_daily_generations_activity` only as a certified
  cross-check; preserve `default.generations` as the canonical source for
  user-level and model-level metrics.
- Do not hardcode the model list or assume a fixed model mix.
