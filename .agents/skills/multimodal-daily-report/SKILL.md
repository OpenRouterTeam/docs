---
name: multimodal-daily-report
description: >-
  Daily multi-modality adoption report covering Images API, Video, TTS, STT,
  Embeddings and Rerank in one Slack post. Combines ClickHouse usage
  (default.generations) with Datadog reliability logs and analytics.dim_users
  account enrichment, and posts exactly one top-level message plus one threaded
  reply per modality to #metrics-multi-modality (C0BCV3YNZKK). Tue–Fri edition
  leads with week-to-date vs the same weekdays last week; Monday edition is the
  weekly view (WoW, 4wk vs prior 4wk, SEO placeholder). Replaces the six
  per-modality adoption-report skills.
user-invocable: true
---

# Multi-Modal Daily Report

One post per weekday for six modalities. The top-level message carries the
highlights, notable day-over-day swings, escalations and one fixed-width table.
Each modality's detail is a threaded reply. Deeper exploration lives in the Hex
project
<https://hc.hex.tech/openrouter/app/Multi-Modal-Generation-0337WHxYTR9y2JWbqLl6tk/latest|Multi-Modal Generation>,
which the top-level message links.

This runbook is the versioned definition of the report. The Devin automation
**Daily Multi-Modality Report** invokes this skill; keep them in sync when the
procedure changes.

## Cadence & delivery

- **Schedule:** weekdays (Mon–Fri) 05:00 America/Los_Angeles. The report covers the most recent
  complete UTC day ("yesterday") and the week-to-date window that contains it.
- **Tue–Fri edition:** table is week to date (Mon through yesterday) vs the
  same weekdays of the prior week. Yesterday's daily numbers live in the thread.
- **Monday edition:** table is the prior complete week (Mon–Sun) vs the week
  before. Highlights add the trailing 4 complete weeks vs the prior 4 and an SEO
  section. Saturday and Sunday appear in the thread only. Never make a weekend
  day the headline comparison.
- **Slack footprint:** exactly one top-level message and six threaded replies
  in `#metrics-multi-modality` (`C0BCV3YNZKK`). Leave the automation's
  `start_session` `slack_channel_id` unset so the platform does not mirror a
  session card or progress messages into the channel.
- **Manual runs:** accept a reporting-date override and a Slack-channel
  override. Everything else follows the defaults.
- **Out of scope:** the Monday API error triage post (`image-api-error-triage`)
  is a separate automation. This report observes and names anomalies. It does
  not triage, recommend fixes, file tickets or assign owners.

## Required access

- **ClickHouse** read-only: `default.generations` (canonical usage source),
  `analytics.dim_users` (account enrichment), `default.models` /
  `analytics.dim_models` (modality lists), `analytics.fact_daily_generations_activity`
  (daily rollup cross-check),
  `clickpipe_postgres_gcp_uscentral1.public_generations_feedback` (video
  feedback).
- **Datadog** logs, US5 tenant (`https://api.us5.datadoghq.com`,
  `DD_API_KEY` / `DD_APP_KEY`) for image, video, TTS and STT failures.
- **Slack:** the native `slack` tool granted by the automation via
  `tools.slack_channels`. No Slack MCP server.

## Guardrails

- **Read-only.** Never mutate any source.
- **Do not commit report output.** Only this skill lives in the repo.
- **No fabricated data.** Failures come from Datadog, successes from
  ClickHouse. Where no failure data exists, print `n/a`, never `0%`.
- **Derive every date from the run date** with ClickHouse functions
  (`today()`, `toStartOfWeek(created_at, 1)`, `formatDateTime(d, '%a')`). No
  hardcoded date strings or hand-derived weekday names.
- **Complete periods only.** Midnight-to-midnight UTC. Never compare a partial
  day or week against a full one.
- **Re-derive model lists every run.** Never hardcode a model set.
- **State gaps instead of zeros.** When `generation_time` is NULL on the
  reporting day, write "latency unavailable". When a comparison window is
  missing, say so.
- **Name accounts from `analytics.dim_users`.** In the top-level message use
  company name and email domain (plus tier when enterprise). Clerk IDs and key
  names go in the thread only when needed to look the account up.
- **No triage language.** No root-cause claims about other teams' systems, no
  fix recommendations. Unverified causes are stated as unverified.

## Definitions

- **Modality filter** on `default.generations.api_type`: Images `'image'`,
  Video `'video'`, TTS `'tts'`, STT `'stt'`, Embeddings `'embeddings'`, Rerank
  `'rerank'`. Legacy image generation is `api_type = 'completions' AND
  num_media_completion > 0` and appears only in the Images adoption split.
- **Users** `uniqExact(clerk_user_id)` over the window. WTD and weekly user
  counts are distinct users over the whole window, so they exceed daily counts.
- **Volume** `count()` rows. Label it gens (Images, Video, TTS),
  transcriptions (STT) or requests (Embeddings, Rerank). Images also reports
  `sum(num_media_generations)` as images produced.
- **Revenue** `sum(usage)`.
- **WTD** Monday through yesterday of the current week. **LW** the same
  weekdays of the prior week.
- **WoW** (Monday edition) prior complete Mon–Sun week vs the week before.
- **4wk vs prior 4wk** (Monday edition) the last 4 complete weeks vs the 4
  before them. Use this label, never "MoM".
- **Faults** provider faults plus worker faults for yesterday only. Excluded
  from the rate: status 400 input and content rejections, status 429 upstream
  rate limits, policy and ban blocks, account credit and key-limit rejections
  (402/403), geo blocks, provider-returned-no-image. Rate = faults / (ClickHouse
  successes + faults). Excluded buckets are still counted and reported in the
  thread when material.
- **n/a** printed when a modality has no failure source (Embeddings and Rerank
  rows carry NULL `finish_reason` and have no Datadog service).
- **STT exclusion** applied to every STT query:
  `AND NOT (toDate(created_at) = toDate('2026-04-28') AND model_permaslug = 'openai/gpt-4o-transcribe')`.

## Steps

1. **Reporting context.** Compute yesterday, the edition (Monday vs Tue–Fri),
   the current and comparison windows, and the weekday label, all in one
   ClickHouse query.

2. **Table metrics in one pass.** One query over `default.generations` grouped
   by `api_type`, using `uniqExactIf` / `countIf` / `sumIf` for the current and
   comparison windows. Also pull daily revenue per modality for the last 7
   days ending yesterday (Monday: ending Sunday); the two most recent days
   feed the daily detail and all 7 feed the sparkline column. Monday edition
   adds the two 28-day windows ending on the last Sunday for 4wk vs prior 4wk.
   Cross-check daily totals against `analytics.fact_daily_generations_activity`
   (SummingMergeTree, always `GROUP BY`) and note any material gap in the
   thread.

3. **Per-modality daily detail** (yesterday vs the day before; Monday edition
   runs Saturday and Sunday each vs their prior day):
   - Users split new vs returning. Materialize a CTE of users active in the
     window with their first-ever date for that `api_type`, then compare against
     the window start. Self-joins over the full table time out.
   - Volume, revenue, average revenue per unit (per gen, per 1k gens, per 1M
     requests, whichever reads cleanly for that modality).
   - Model mix: share of volume per `model_permaslug` with DoD change in
     percentage points. Any single-model move of 10pp or more is a candidate for
     Notable DoD swings and needs account attribution (step 5).
   - Images: adoption split of new API vs legacy chat completions by requests
     (lead), images, users (with overlap), revenue. One query with
     `WHERE api_type = 'image' OR (api_type = 'completions' AND num_media_completion > 0)`.
   - Video, TTS, STT: latency p50/p95/p99 from `generation_time`
     (milliseconds, divide by 1000) where populated. STT also reports audio
     hours as `sum(stt_audio_input_duration) / 3600` (seconds) and marks the
     total as a floor when any STT row in the window has it NULL.
   - Video: feedback from `public_generations_feedback` with
     `generation_id LIKE 'gen-vid-%' AND _peerdb_is_deleted = 0`, count by
     `category`, plus cumulative count and submitters.
   - Embeddings, Rerank: account concentration (top account and top 5 share of
     requests and revenue). Rerank revenue is dominated by Cohere models and
     request spikes on free models are usually one account.

4. **Reliability from Datadog** for yesterday (Monday edition: Saturday and
   Sunday each, plus combined). Prefer `POST /api/v2/logs/analytics/aggregate`
   with a `count` compute for totals and facet breakdowns. Fall back to
   `get_logs` (1000 cap, split windows recursively) only to read bodies.
   - Images: `@script_name:image-api "All endpoints failed [image-generation.submit]"`
     grouped by `@breadcrumbs.provider` for provider faults, plus
     `status:error @script_name:image-api` for worker faults. Account-limit
     rejections have no provider and drop out of the provider grouping. Also
     count upstream 429s separately and name any key cluster with
     near-identical counts.
   - Video: `service:api @entrypoint:VideoGenerationJob "Video generation upstream fetch failed"`
     grouped by `@extra.error.debug.raw_status`, `@breadcrumbs.model`,
     `@breadcrumbs.provider_name`. Classify messages with wildcard facet queries
     such as `@extra.error.message:*SensitiveContentDetected*`; a bare quoted
     term does not match inside that attribute. Sensitive-content 400s dominate
     the raw count and are excluded from the fault rate.
   - TTS: `service:api @script_name:tts-api "Unexpected error status returned"`
     grouped by `@extra.error_location`. `tts.invoke` is provider fault,
     `tts.checkBans` policy block, `canMakeGenerations` budget/limit. Plus
     `status:error @script_name:tts-api` worker faults.
   - STT: same shape with `stt-api`, `stt.invoke`, `stt.checkBans`.
   - Embeddings, Rerank: no query. Print `n/a`.
   - Rank the faults by provider and model, and flag any cluster concentrated
     in a few hours or a few accounts as an escalation candidate. Report the
     rate excluding that cluster alongside the headline rate.

5. **Account attribution.** For every candidate swing (volume or revenue moved
   25% or more DoD or 20% or more WTD, a model-mix move of 10pp or more, or
   one account above 25% of a modality's day), find the accounts that explain
   it: group the delta by `clerk_user_id` (or `org_id`) and model, take the top
   contributors, and join to `analytics.dim_users` for
   `enriched_company_name`, `user_email_domain`, `org_username`,
   `customer_tier`, account age. Name the account in the bullet and restate the
   metric excluding it ("ex-burst gens -X%"). If enrichment is empty, say
   "one unnamed account" and put the Clerk ID prefix in the thread.

6. **Compose the top-level message** in this order, in raw Slack mrkdwn per
   `.agents/skills/slack-mrkdwn/SKILL.md`: `*bold*`, `•` bullets, `<url|label>`
   links, the table as one triple-backtick block. No `#` headers, no Markdown
   tables, no attachments. Keep it under ~3000 chars.

   1. Title line: `*Multi-modal daily, <Www YYYY-MM-DD>* · <hex-url|Hex>`.
      Monday edition: `*Multi-modal weekly, week of <YYYY-MM-DD>* · <hex-url|Hex>`.
      No DoD or launch-day suffix.
   2. `*Highlights*`. Tue–Fri edition: 2 to 4 bullets with Media GMV
      (image + video + TTS + STT) for the window and its comparison, the
      largest WTD revenue and user movements with the named account when one
      explains it, series highs or lows. Monday edition: the Media GMV bullet
      plus one bullet per modality with WoW, 4wk vs prior 4wk and the new vs
      returning shift.
   3. `*Notable DoD swings*` 0 to 3 bullets, yesterday vs the day before,
      each with the named account and the ex-account figure. Omit the section
      when nothing crosses the step 5 thresholds. Monday edition uses Saturday
      and Sunday only when a swing is material to the week.
   4. `*Escalations*` 0 to 3 bullets for fault clusters, 429 storms and
      abuse-shaped bursts, each with the affected modality, count, window,
      account count and the rate excluding the cluster. Omit when empty.
   5. Monday edition only: `*SEO*` followed by `coming soon` until the
      cross-modality SEO section is designed. Never include SEO in the Tue–Fri
      edition.
   6. The table, rows fixed in this order and columns aligned to this header
      (`WoW*` replaces `WTD*` on Monday):

      ```
      WTD*        users   vs LW   volume    vs LW   revenue   vs LW  faults**  7d rev
      Images      9,863  +12.5%   935.3k   +74.0%   $38,748  +21.7%   1.18%   ▇▆▇▁▁▆█
      Video       3,018   +3.7%    56.7k    +1.4%   $44,630   +6.1%   0.46%   ▇▅▆▂▁▅█
      TTS         3,967   +9.7%   556.4k   -52.2%    $2,275   +7.4%   1.37%   ▁▃▄▃▄▇█
      STT         6,221  +15.6%    4.75M    +5.0%    $2,621  +50.8%   0.05%   ▆█▅▁▂█▇
      Embeddings 29,160   +4.2%    78.6M   -13.3%    $5,225  -38.9%     n/a   ▄█▇█▄▁▂
      Rerank      2,006  +21.4%    4.48M  +112.6%    $3,961  +79.3%     n/a   ▂▁▁▂▄█▅
      ```

      Users with thousands separators, volume abbreviated to `k` or `M` with
      one decimal, revenue in whole dollars, percentages to one decimal with a
      sign, faults to two decimals. `7d rev` is a sparkline of the 7 daily
      revenue values from step 2, oldest on the left: scale each row to its
      own min and max and map to `▁▂▃▄▅▆▇█` (a flat row prints `▄` seven
      times). Exactly 7 glyphs, no trend arrows or other markers next to it.
   7. Two footnote lines, exactly this shape and this order:
      `* <Mon+Tue> vs the same days last week. 7d rev = daily revenue, last 7 days. <Tue> daily numbers in thread.`
      `** <Tue> provider and worker faults, excluding 400, 429, policy and account blocks. n/a = no failure data for embeddings and rerank.`
      Monday edition: `* <Mon D>–<Sun D> vs the prior week. 7d rev = daily revenue, last 7 days. Sat and Sun daily numbers in thread.` and
      `** Sat+Sun provider and worker faults, excluding 400, 429, policy and account blocks. n/a = no failure data for embeddings and rerank.`
   8. Last line: `Per-modality detail in :thread:`

7. **Compose six thread replies**, one per modality, in table row order:
   Images API, Video, TTS, STT, Embeddings, Rerank. Each opens with the title
   line `*<Modality>, <Www YYYY-MM-DD>*` (Monday edition:
   `*<Modality>, week of <YYYY-MM-DD>*`), using the modality name exactly as
   listed and no "Adoption", DoD, weekday-name or launch-day suffix. Then 5 to
   7 `•` bullets, under ~2000 chars: users with new/returning,
   volume, revenue and unit price, top model and mix moves, modality extras
   (adoption split, duration, feedback, concentration), reliability with the
   excluded buckets named, and the account detail behind any top-level bullet
   about that modality. Monday edition: the same bullets for the week, then
   Saturday and Sunday one line each. Include the STT exclusion footnote once
   in the STT reply.

8. **Sanity check before posting.** The Images, Video, TTS and STT revenue
   rows sum to the Media GMV bullet. No `**` anywhere in the seven messages
   except the faults footnote marker in the table header and footnote line.
   No line starts with `- `; every bullet starts with `•`. Every sparkline is
   exactly 7 glyphs from `▁▂▃▄▅▆▇█` and its rightmost glyph matches
   yesterday's revenue relative to the other 6 days.
   Successes plus faults are plausible against volume for each modality. Every
   percentage has both sides of the comparison available. Every named account
   came from `analytics.dim_users`.

9. **Post.** One top-level message with the native `slack` tool, capture its
   `ts`, then the six replies with `thread_ts` set to that `ts`, in order. Never
   a second top-level message, never a re-post. If delivery is uncertain, read
   the thread back before doing anything else.

## Specifications

- Six modality rows, fixed order, one table, one top-level message, six
  replies.
- Tue–Fri table is WTD vs same weekdays LW. Monday table is prior full week vs
  the week before. DoD appears only in Notable DoD swings and in the thread.
- Faults column is yesterday only (Monday: Sat+Sun) and uses the common fault
  definition for every modality. `n/a` for Embeddings and Rerank.
- Footnote markers: `*` on the window header, `**` on faults. Two short lines.
- The only graphic in the Tue–Fri edition is the `7d rev` sparkline column.
  No trend arrows, status emoji or images. Anything worth calling out goes in
  Notable DoD swings.
- Every large movement in Highlights or Notable DoD swings names the account
  when one account explains it, and gives the metric excluding that account.
- SEO appears only in the Monday edition, as `coming soon` until designed.
- No triage or remediation content. Observations only.
- Thousands separators on every count of four digits or more.
- Numbers come from freshly run queries every run. Nothing is carried over from
  a prior post.

## Advice and pointers

- `default.generations` date column is `created_at`, not `date`. Partitioned
  by `toYYYYMM(created_at)`, so always bound `created_at` on both sides.
- The ClickHouse MCP runner rejects a trailing `FORMAT` clause and
  `SETTINGS max_execution_time`. Keep queries under its 30s limit by bounding
  dates tightly and running one modality-heavy query at a time.
- `analytics.dim_users` joins on `clerk_user_id`. Useful columns:
  `enriched_company_name`, `user_email_domain`, `org_username`,
  `customer_tier`, `created_at` (account age). It has no `org_id`.
- `public_generations_feedback` identifies the submitter as
  `creator_clerk_user_id`.
- `generation_time` is latency in milliseconds despite the name and is NULL
  for all TTS and STT rows and for some early video rows. Audio length lives in
  `stt_audio_input_duration` (seconds), not in `generation_time`.
- OpenAI `gpt-4o*` and `gpt-transcribe` STT rows report no audio duration, so
  STT audio hours are a floor.
- Datadog `get_logs` wants unix seconds for `from` / `to`. Any aggregate
  `group_by` used to rank buckets needs a `sort` of
  `{"aggregation":"cardinality","metric":"@generation_id","order":"desc","type":"measure"}`
  or the `limit` returns an arbitrary slice. The aggregate endpoint
  rate-limits hard: one grouped call beats many filtered ones, retry 429s with
  backoff, never fire in parallel. Build request bodies with a JSON serializer,
  not shell interpolation.
- Images: `@generation_id` cardinality is the right measure on 402/403 and
  response-status pools (logs duplicate per request) but degrades on older
  days of the "All endpoints failed" pool, so use raw counts there and keep the
  same measure on both sides of a comparison.
- Content-moderation, geo and provider-no-image buckets are not reliably
  matched by full-text search. Report them as unmeasured rather than zero
  unless a facet-grouped aggregate returns them.
- The STT `@extra.success:false` facet returns zero. Failures are separate
  warn/error logs, so use the failure-specific queries above.
- Rerank rows carry NULL `finish_reason` and `normalized_finish_reason` with
  `cancelled = false`. That is "no failure data", not a 0% failure rate.
- Chat-completion calls to image-only models are bridged to the image API and
  already count as `api_type = 'image'`.
- Rerank and embeddings request spikes on free models and image bursts from
  young accounts are the usual sources of a single-account swing. Check account
  age and key count when naming them.
