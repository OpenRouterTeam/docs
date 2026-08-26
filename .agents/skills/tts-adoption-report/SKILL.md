---
name: tts-adoption-report
description: >-
  Daily adoption report for text-to-speech (TTS) models. Combines ClickHouse
  usage metrics (default.generations, api_type='tts') with cfw-tts-api Datadog
  reliability logs to track adoption since launch — weekly & daily unique users
  (new vs repeat), cost/revenue and duration by model, model mix, and a
  headline failure rate that excludes policy-block and budget/limit rejections.
  Runs daily on a Devin schedule (weekdays) and posts a single threaded summary
  to Slack #metrics-multi-modality (C0BCV3YNZKK).
user-invocable: true
---

# TTS (Text-to-Speech) Adoption Report

Generate a daily adoption report for text-to-speech models, combining usage
metrics from ClickHouse with reliability data from Datadog. The report is posted
to Slack for the multi-modality team to track adoption trends, model
performance, and failure patterns since launch.

Mirrors the structure of the STT (Speech-to-Text) Adoption Report.

This runbook is the versioned, reviewable definition of the report. It replaces
the inline prompt of the **Daily TTS Adoption Slack** Devin schedule; keep it in
sync when the procedure changes.

## Cadence & delivery

- **Schedule:** daily on weekdays (Mon–Fri), 14:30 UTC, wired via the Devin
  schedule **Daily TTS Adoption Slack** whose prompt invokes this skill. The
  report always covers the most recent complete UTC day ("yesterday").
- **Monday vs. other weekdays** — the report format depends on what day it runs:
  - **Monday**: the headline summary focuses on the **week-over-week
    comparison** (prior complete week vs. the week before that). Weekend daily
    breakdowns (Saturday and Sunday) are posted as additional detail in the
    thread. This avoids surfacing a single low-traffic weekend day as the top
    story.
  - **Tuesday–Friday**: the headline summary focuses on the **day-over-day
    comparison** (yesterday vs. the day before yesterday). Weekend details are
    not relevant.
  - All five report sections (Weekly Users, Daily Users, Cost/Revenue, Model
    Mix, Reliability) are always generated regardless of day. The difference is
    only in what appears in the top-level Slack message vs. the thread.
- **The skill owns the entire Slack footprint.** Leave the schedule's
  `start_session` `slack_channel_id` **unset** so the platform does not post a
  "New session started…" card or mirror the session's progress messages into
  the channel — those would duplicate the Step 10 report and clutter the
  channel. The only thing the channel should see is the single Step 10 post (one
  top-level message + its thread).
- **Manual runs:** allow a **date override** (a specific day to report on
  instead of yesterday) and a Slack-channel override; otherwise defaults apply.

## Required access

- **ClickHouse** `default.generations` (usage metrics) and `analytics.dim_models`
  (model modalities) — read-only.
- **Datadog** logs for `cfw-tts-api` failures (`DD_API_KEY` / `DD_APP_KEY`;
  `get_logs` MCP or the logs API).
- **Slack**: use the native `slack` tool granted by the automation to post to
  `#metrics-multi-modality` (channel `C0BCV3YNZKK`). The automation grants the
  channel via `tools.slack_channels` and attaches no Slack MCP server.
- **PostHog** (project 90142) — HogQL via the PostHog MCP, read-only. Needed for
  the rankings SEO section.

## Guardrails

- **Read-only queries.** Query ClickHouse and Datadog only; never mutate them.
- **Do not commit the report.** Only this skill lives in the repo. Reports are
  delivered to Slack, never committed.
- **No fabricated data.** Combine ClickHouse (successes) + Datadog (failures)
  for reliability; never rely on ClickHouse alone. When `generation_time` is
  fully NULL for the reporting day, do not emit fabricated zeros — emit an
  explicit "duration metrics unavailable" line and continue.
- **Derive dates with functions**, never hardcoded strings — use `today() - 1`
  / `today()` for boundaries and a date function for the day-of-week label
  (avoids year-mismatch errors).

## Launch anchor

TTS launched **2026-05-01** (per the public announcement at
https://openrouter.ai/announcements/announcing-audio-apis). Some pre-announcement
usage exists from 2026-04-18 onward (soft-launch / beta period), but the
official launch date for "Day N" counting is May 1.

## Steps

1. **Determine the reporting context** — Check what day of the week it is
   (Monday vs. Tuesday–Friday). This determines headline framing:
   - **Monday**: the "prior day" comparisons cover Saturday and Sunday
     individually. The headline summary emphasizes the WoW numbers. Daily
     weekend breakdowns go in the thread.
   - **Tuesday–Friday**: the "prior day" comparison is yesterday vs.
     day-before-yesterday. The headline summary emphasizes the DoD numbers.

2. **Identify TTS models** — Query ClickHouse `default.generations` filtered by
   `api_type = 'tts'` as the canonical source. Alternatively, query
   `analytics.dim_models` for models where `has(output_modalities, 'speech')` is
   true and use the resulting `permaslug` values; both approaches should produce
   the same model set in practice. Do not hardcode the model list — re-derive it
   every run.

3. **Query weekly unique users** — From `default.generations` filtered to TTS
   (`api_type = 'tts'`), compute week-to-date unique users
   (`COUNT(DISTINCT clerk_user_id)`) with at least one TTS generation, broken
   down by model. If a prior complete week exists, compute WoW change
   (absolute + %). Use `toStartOfWeek(created_at, 1)` for Monday-start weeks.

4. **Query daily unique users** — On **Tuesday–Friday**: compare yesterday vs.
   the day before (unique users, absolute + % change). For yesterday, split
   users into repeat vs. new by checking whether each user's earliest TTS
   generation in `default.generations` falls on the reporting day. On
   **Monday**: compute the same metrics for both Saturday and Sunday
   individually (each compared to the prior day). For efficiency on the
   new-vs-repeat split, pre-materialize a CTE / subquery of "users whose
   first-ever TTS call was before the reporting day" rather than joining the
   full `default.generations` table on itself — naive self-joins time out.

5. **Query cost & revenue** — From `default.generations` (TTS):
   - Total generations, total revenue (`usage` column), avg cost per generation
     (overall, then by model)
   - Duration by model: P50, P95, P99, and max using `quantile` functions on
     `generation_time` (Nullable Decimal, units are **milliseconds** — divide by
     1000 to report seconds)
   - On **Tuesday–Friday**: compare yesterday vs. day-before-yesterday with %
     change
   - On **Monday**: compute for both Saturday and Sunday individually

   **Known data gap (flag until fixed):** as of the initial run,
   `generation_time` is NULL on 100% of TTS rows in `default.generations`. When
   all rows for the reporting day are NULL, do *not* emit fabricated `0.0`
   values — instead emit an explicit "duration metrics unavailable —
   `generation_time` not populated by cfw-tts-api" line in the report and
   continue. Stop flagging this once the column becomes populated (>50% non-null
   on the reporting day).

6. **Query model mix** — From `default.generations` (TTS), compute each model's
   share of total generations (count + %), with day-over-day change in share
   (percentage points). On **Monday**, compute for both Saturday and Sunday.
   Highlight in the headline any single-model shift of >= 10 percentage points
   DoD — these typically reflect a single high-volume customer migrating models,
   which is worth surfacing.

7. **Query reliability from Datadog** — TTS failures are emitted by
   `cfw-tts-api` to Datadog logs. ClickHouse `default.generations` only contains
   successful (completed) TTS generations.

   **Successes:** count from ClickHouse `default.generations` (TTS).

   **Failures:** query Datadog logs for the canonical one-per-failure event:
   - Query: `service:api @script_name:tts-api "Unexpected error status returned"`
   - Time range: midnight-to-midnight UTC unix timestamps (seconds) for the
     relevant day(s)
   - This message is emitted once per failed TTS request, so each matching log
     = 1 failed generation.
   - Also count `status:error @script_name:tts-api` separately — these are
     Cloudflare-worker-level failures (memory limit, runtime crash) that do not
     produce the "Unexpected error status returned" log.

   **Pagination:** Datadog's `get_logs` API has a per-request cap of 1000
   results. Paginate by splitting the time window into sub-windows and
   re-querying any window that returns >= 1000 results, recursively, until every
   leaf window returns fewer than the cap. Sum the leaf counts. Throttle between
   calls to avoid Datadog 429s: `get_logs`/`events/search` tolerates short
   sleeps, but the `logs/analytics/aggregate` endpoint is rate-limited far more
   aggressively — allow at least 60 seconds between aggregate calls and prefer
   one grouped aggregate call over many filtered ones. When calling the REST
   API directly, build the request body with a real JSON serializer (e.g.
   Python `json.dumps`); shell string interpolation of the query into a JSON
   literal breaks once the query contains quotes.

   **Categorize failures** by `@extra.error_location`:
   - `tts.invoke` -> *provider-fault* (upstream provider returned an error)
   - `tts.checkBans` -> *policy-block* (OpenRouter correctly blocked a banned
     user)
   - `canMakeGenerations` -> *budget/limit rejection* (user exceeded budget or
     rate limit)
   - status:error (worker-level) -> *worker-fault* (memory limit etc.)
   - other / unknown -> *other*

   Headline failure rate should be computed against *provider-fault +
   worker-fault* only — excluding policy-block and budget/limit rejections,
   which are the system working as designed. Report those counts separately so
   they are visible but do not distort the reliability headline.

   Extract failure reasons from `@extra.error_message` (for `tts.invoke`) or
   `@error.message` (for worker-level errors). Rank failure reasons by count
   within each category.

   Total attempted = ClickHouse successes + provider-fault failures +
   worker-fault failures (policy-block and budget/limit excluded).

   On **Monday**: compute reliability for the full weekend (Saturday + Sunday
   combined) plus each day individually.

8. **Compile the report** — Format all sections into a Slack-readable message
   using Slack mrkdwn. Use monospace-aligned tables in triple-backtick code
   blocks, `*bold*` (never `**bold**`), `_italic_`, backtick inline code, and
   `<url|label>` links (not `[label](url)`). Do not use `#`/`##` headers or
   Markdown tables. Use clear visual separators between sections.
   - **Monday headline**: Lead with the WoW comparison — prior complete week
     totals vs. the week before. Include headline revenue and generation counts
     for the full weekend (Sat+Sun combined). Do NOT lead with a single weekend
     day's DoD numbers.
   - **Tuesday–Friday headline**: Lead with yesterday's DoD comparison (active
     users, generations, revenue, top model by volume).
   - **Always** include "Day N since launch (2026-05-01)" in the headline
     subtitle.

9. **Query rankings SEO engagement** — Query PostHog (project 90142) via the
   PostHog MCP (HogQL, read-only) for the same reporting UTC day the rest of
   the report covers, scoped to the rankings page `/rankings/speech`:
   - **Page traffic** — count of `$pageview` events whose `$current_url` /
     pathname matches `/rankings/speech` (full-rate).
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
     usage"). Hardcode the pathname `/rankings/speech` for this skill; do not
     derive it from the skill name. TTS maps to `/rankings/speech` (not
     `/rankings/transcription`) intentionally.

10. **Slack report** — Post exactly one top-level headline summary with the
   native `slack` tool to channel `C0BCV3YNZKK` (`#metrics-multi-modality`).
   Capture its returned `ts`, then post every detail section with the native
   `slack` tool as a threaded reply using `thread_ts` set to that top-level
   message's `ts`. Never post a second top-level message or re-post a reply.
   If delivery is uncertain, inspect the thread with the native `slack` tool
   instead. Keep each message within Slack's character limits (~4000 chars per
   message). Post the rankings SEO section as one additional threaded reply
   using the same `thread_ts`; do not add a second top-level message.
   - **Monday thread order**: Post the WoW detail section first, then Saturday's
     daily breakdown, then Sunday's daily breakdown, then reliability →
     Rankings SEO.
   - **Tuesday–Friday thread order**: Weekly Users -> Daily Users ->
     Cost/Revenue -> Model Mix -> Reliability → Rankings SEO.

## Specifications

- All day-over-day comparisons use complete 24-hour UTC periods
  (midnight-to-midnight). Never compare a partial day against a full day.
- "Yesterday" = the most recent complete UTC day. Use ClickHouse relative date
  functions like `today() - 1` and `today()` for date boundaries rather than
  hardcoded date strings to prevent year-mismatch errors.
- On Monday, "yesterday" is Sunday. The report must also cover Saturday. Query
  both days.
- The report must contain all 5 sections: Weekly Users, Daily Users,
  Cost/Revenue, Model Mix, Reliability.
- Every metric that has a prior-period comparator must show both absolute values
  and % change.
- Reliability must combine ClickHouse (successes) and Datadog (failures) — never
  rely on ClickHouse alone for failure data.
- The headline failure rate MUST exclude policy-block (`tts.checkBans`) and
  budget/limit (`canMakeGenerations`) failures. See step 7.
- When `generation_time` is fully NULL for the reporting day, do not emit
  fabricated zeros — emit an explicit "duration metrics unavailable" line and
  continue.
- Validation: before posting, verify that total attempted generations
  (successes + provider-fault + worker-fault failures) is reasonable. Flag any
  discrepancy.
- Always use a proper date-formatting function (e.g., ClickHouse's
  `formatDateTime` or equivalent) to derive the day-of-week label. Never guess
  or hardcode the day name from the date.
- The rankings SEO section's `rankings_section_view` counts are 10%-sampled —
  scale by `sample_rate`; use them for ranking sections relative to each other,
  not exact counts. `$pageview` and `click_rankings_section_nav` are full-rate.

## Advice and pointers

- Key columns in `default.generations` for TTS: `model_permaslug` (model
  identifier), `clerk_user_id` (user), `usage` (revenue/cost), `generation_time`
  (duration in seconds, Nullable Decimal — currently NULL for TTS, see step 5),
  `api_type` (= `'tts'` for TTS generations), `created_at` (UTC, partitioned by
  `toYYYYMM(created_at)`).
- Key columns in `analytics.dim_models`: `permaslug`, `name`,
  `output_modalities` (Array of Strings). Use `has(output_modalities, 'speech')`
  to filter for TTS models.
- The date column on `default.generations` is `created_at`, NOT `date`. A query
  like `WHERE date >= today() - 1` will fail with `UNKNOWN_IDENTIFIER`.
- For Datadog `get_logs` queries, use unix timestamps (seconds) for `from` and
  `to` parameters — the MCP tool expects these, not ISO strings.
- To derive day-of-week for report titles, use
  `formatDateTime(toDate('2026-05-11'), '%a')` in ClickHouse (returns `Mon`) or
  the equivalent in your runtime language. Do not manually map dates to day
  names.
- When the schedule fires on Monday, `today() - 1` = Sunday and `today() - 2` =
  Saturday. Use both for weekend coverage.
- When new-vs-repeat user split queries time out on `default.generations`, the
  usual cause is a self-join over the full table. Materialize a CTE of users
  with their first-TTS date and JOIN/ANTI-JOIN against that instead.
- TTS generation IDs follow the format `gen-tts-*` (visible in Datadog
  breadcrumbs as `@breadcrumbs.generation_id`).
