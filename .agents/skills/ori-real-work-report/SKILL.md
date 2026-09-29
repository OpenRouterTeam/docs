---
name: ori-real-work-report
description: >-
  Weekly real-work metrics report for Ori harness, Ori eval and OpenRouter MCP.
  Recomputes the strict real-work series from Ori CLI telemetry and
  mcp.openrouter.ai logs in Datadog (internal OpenRouter orgs, CI/dev
  environments, protocol/catalog/liveness traffic and failed calls all
  excluded), adds the OpenRouter usage behind harness runs (requests, tokens,
  spend, models from ClickHouse generations with session and API-key
  correlation coverage), renders the branded 4:3 chart PNGs with the repo's viz harness, and
  posts one top-level Slack message per surface with a stats reply in its
  thread. Runs Monday mornings on a Devin automation into
  #weekly-product-insights (C0BS9CC9PQD).
user-invocable: true
---

# Ori / MCP Real-Work Report

Weekly report on **real work** across the three product surfaces — Ori harness,
Ori eval, OpenRouter MCP. Every number counts work someone asked for; heartbeat
telemetry, protocol handshakes, catalog polling, liveness probes and failed
calls never enter a series, and OpenRouter's own organizations are excluded.

This runbook is the versioned definition of the report. The Devin automation's
prompt invokes this skill; keep them in sync when the procedure changes.

## Cadence & delivery

- **Schedule:** weekly, Monday 13:00 UTC, via the Devin automation **Weekly Ori
  harness / eval / MCP real-work report**. The report covers the last 7 complete
  UTC days and compares them against the 7 before that.
- **Slack footprint:** exactly **three top-level messages** in
  `#weekly-product-insights` (`C0BS9CC9PQD`) — harness, eval, MCP, in that order —
  each with **one threaded reply** carrying the detail stats. Charts are attached
  to the top-level messages. Never post a fourth top-level message.
- **Manual runs:** accept an end-date override (`--end`, exclusive UTC boundary)
  and a Slack-channel override; otherwise defaults apply.

## Required access

- **Datadog** (US5 tenant, `DD_API_KEY` / `DD_APP_KEY`) — Ori telemetry and
  `mcp-request` logs. Log retention caps history at ~15 days, so a 14-day window
  is the maximum available and no longer-run trend can be quoted.
- **ClickHouse** (`CLICKHOUSE_HOST`, `CLICKHOUSE_READONLY_USER`,
  `CLICKHOUSE_READONLY_PASSWORD`) — resolves the internal orgs, their member
  accounts and their API-key hash prefixes, and reads `default.generations` for
  the usage section. If those env vars are absent, get the three exclusion lists
  through the `clickhouse-analytics-mcp` server, write them to a JSON file, pass
  `--internal-json` and add `--skip-usage` (the usage section is then omitted
  and the charts and CSVs fall back to the twelve-asset shape).
- **Slack** — the native `slack` tool with `C0BS9CC9PQD` granted by the
  automation, used to post threaded replies.
- **Bun + Playwright** in this repo, for the chart capture harness.

## Guardrails

- **Read-only.** Query Datadog and ClickHouse only.
- **Do not commit report output.** Only this skill and its scripts live in the
  repo; JSON, CSV, HTML and PNG output is generated to a temp directory and
  delivered to Slack.
- **Derive dates from the run date**, never hardcode them, and never mix a
  partial day into an average or a week-over-week comparison.
- **No heartbeat-vs-real-work or protocol-noise charts.** Heavy automation and
  the real-vs-total MCP ratio are caveats in the thread reply, not charts.
- **State the numbers the scripts produce.** If a chart total and a breakdown
  total disagree, report the gap instead of reconciling it silently.

## Definitions

| Surface | Real work is |
| --- | --- |
| Ori harness | `agent_run` telemetry events, `@extra.env_kind:user` |
| Ori eval | `eval_run` telemetry events, `@extra.env_kind:user` |
| OpenRouter MCP | a `tools/call` for an intent-bearing tool that returned HTTP 200 from a resolvable API key |
| Ori usage | rows in `default.generations` whose `app_id` is the Ori app (`analytics.dim_apps` where `title='Ori'` and `origin_url='https://or.bot/'`), internal accounts excluded |

- **Engaged install / account** — emitted at least one `agent_run` that day.
  Presence of any other telemetry event does not make an install active.
- **Intent-bearing MCP tools** — the `WORK_TOOLS` list in
  `scripts/fetch_real_work.py`. Catalog reads (`list-models`, `get-model`,
  `list-model-endpoints`, `list-providers`, `list-benchmarks`), liveness
  (`ping`) and balance checks (`get-credits`) are excluded. This split is an
  analytical judgment about intent, not a field in the data; say so in the MCP
  thread reply.
- **Heavy automation** — installs above 200 agent runs in a day. Kept in the
  totals, reported as a caveat with the human-scale figure beside it.
- **Session correlation** — an `agent_run` carries `props.or_session_id`, the
  `X-Session-Id` the harness sent to OpenRouter, and a generation carries
  `session_id`. Matching the two ties requests, tokens and spend to a run. Not
  every harness propagates the header and not every request carries a session,
  so coverage is measured per harness (`runs_with_session`, `sessions_matched`,
  `requests`) and reported, never assumed. The join is not restricted to the
  Ori app: a harness that sets its own attribution headers (Claude Code does)
  lands under its own app, so `requests_in_ori_app` is the Ori-app subset and
  `apps` lists where the rest is attributed. `usage.session_models` is the
  model mix behind the matched runs across all apps. Model lists are top-N,
  so the model chart's share is among its charted rows, not all requests, and
  a week with no models still renders chart 15 as an empty result.
- **API-key correlation** — the ingest route logs the numeric `api_key_id` of
  the credential a telemetry batch was sent with (`@extra.api_key_id`), and
  generations carry the same `api_key_id`. `key_join.coverage_available` is
  false when no run in the window carried a key id, which says nothing about
  how much Ori traffic exists.
- **Per-harness usage** — `harness_usage.by_harness.<harness>` joins each
  harness's runs to generations through the API keys those runs reported,
  across every app. It carries the daily requests, `requests_in_ori_app`,
  sessions, keys, accounts, tokens and `usage_usd`, the current-week `models`
  and `apps`, telemetry `runs` and `runs_prior`, and `accounts.{current,
  prior,new,retained}` where new means requests on that harness's keys this
  week and none the week before. A key that ran more than one harness is
  attributed to each and counted in `keys_shared`, so per-harness rows can
  overlap and must not be summed as distinct customers. Requests through a
  key with no run in the window are excluded. `harness_usage.runs_daily` is
  the telemetry run count per day and harness behind the growth chart, and
  `harness_usage.keyed_runs_daily` is the number of runs per day that carried
  an `api_key_id` at all. Days at zero there had no joinable runs, so a key
  set observed only late in the window makes `accounts.prior` and `retained`
  a floor and `new` a ceiling. The chart captions and the Slack thread must
  say so whenever the first keyed day is inside the window.
  `requests` on a harness's keys counts every app those keys touched, so it is
  an upper bound on the harness's own traffic and `apps` shows the split.
- **Internal exclusion** — every account in an org whose email domain is
  `openrouter.ai`, every Ori install that ever ran under one of those accounts,
  and every MCP API key they own. It is a **floor**: staff or interns on personal
  accounts are still counted as external.

## Steps

1. **Fetch the series** — run
   `python3 scripts/fetch_real_work.py --out <workdir>` (add `--end` for a
   manual override). It resolves the internal orgs, then writes
   `<workdir>/real-work.json`: the 14-day daily series, the current-week harness
   and eval-outcome breakdowns, and the MCP tool/client breakdowns with the
   all-requests and all-tool-calls totals behind the ratio caveat, and a `usage`
   section: per-day Ori-app requests, sessions, keys, accounts, prompt,
   completion, reasoning and cached tokens and `usage_usd`, the top models for
   the current week, the session and key joins, and a `harness_usage` section
   with the per-harness key-joined usage described above. Expect a few
   minutes of Datadog aggregation calls. The fetcher paces and retries against
   Datadog rate limits and caches each completed stage in `<out>/stages.json`
   keyed to the window and the exclusion inputs; if it dies mid-way, rerun the
   identical command with the same `--out` and window. Changed exclusions (or
   a cache written before they were recorded) recompute every stage.
   The logs analytics endpoint enforces a short quota (observed 2 calls per
   10s), so a 429 is normal on the per-day harness stages; the fetcher sleeps
   for the `X-RateLimit-Reset` the response reports instead of backing off
   exponentially. ClickHouse session joins can exceed the 180s read timeout
   and are retried once at 600s. A full production window takes roughly
   15-20 minutes end to end. Run it in its own shell (`tee` to a log) and
   never restart it with `pkill -f fetch_real_work.py` from the same shell.

2. **Sanity-check the series** — before drawing anything, confirm: no day is
   zero across every metric (a zero day means a failed query, not a quiet day);
   `human_runs + heavy_runs == agent_runs` on every day; the harness breakdown
   sums to the current-week `agent_runs`; the eval-outcome breakdown sums to the
   current-week `eval_runs`; the MCP `by_tool` total equals the current-week
   `mcp_real_calls`; `usage.session_join.<harness>.sessions_matched` never
   exceeds `runs_with_session`; `harness_usage.runs_daily` summed over the
   current week matches the `harness` breakdown per harness (runs without a
   `harness` prop appear in neither) and each harness's `runs_with_key` never
   exceeds its `runs` plus `runs_prior`. Investigate any mismatch before posting — do
   not paper over it. Expect single ClickHouse reads for the session and key
   joins to run for minutes; the fetcher retries a timed-out read once with a
   longer budget.

3. **Build the charts** — run
   `python3 scripts/build_charts.py --data <workdir>/real-work.json --out <workdir>/charts`.
   Token-driven HTML assets plus a `manifest.json`, grouped
   `01`–`05` harness, `06`–`08` eval, `09`–`12` MCP, and when the JSON has a
   `usage` section `13`–`15` usage (requests and sessions, tokens, top models),
   and with a `harness_usage` section `16`–`19` per-harness trends (requests,
   accounts and agent runs per day for the top five harnesses, new accounts
   by harness) plus `20`+ one model-mix chart per top-four harness by
   requests.

4. **Validate and capture** — from `tests/web-e2e`, validate every asset
   (`bun scripts/validate-viz-asset.ts <file>`) then capture at 4:3:

   ```bash
   VIZ_SOURCE_DIR=<workdir>/charts VIZ_OUTPUT_DIR=<workdir>/charts/output \
   VIZ_ARTBOARD_WIDTH=1280 VIZ_ARTBOARD_HEIGHT=960 VIZ_CAPTURE_MODE=framed \
     bun scripts/viz-assets.ts
   ```

   PNGs land under `<workdir>/charts/output/framed/<asset>/{dark,light}.png` at
   2560×1920. Post the **dark** ones. A capture failure naming an artboard
   overflow means a headline or KPI row grew — shorten the copy rather than
   shrinking the type, which is sized for social timelines.

5. **Export the data** — run
   `python3 scripts/export_csv.py --data <workdir>/real-work.json --out <workdir>`
   for the daily-series and breakdown CSVs plus, with a usage section, the
   `real-work-usage-{daily,models,correlation,apps}.csv` files and, with a
   `harness_usage` section, `real-work-harness-usage-{daily,models,accounts,apps}.csv`.
   Attach them to the
   MCP thread reply so the whole report is inspectable.

6. **Compose the three messages** — raw Slack mrkdwn per
   `.agents/skills/slack-mrkdwn/SKILL.md`: `*bold*`, `•` bullets, backtick
   inline code, triple-backtick blocks for tabular data, `<url|label>` links.
   No headers, no Markdown tables. Run its sanity check before posting. Every
   metric gets its 7-day daily average, the week-over-week change, and the week
   total where it reads better. Lead each message with the window and "real
   work only, internal usage excluded".

   - **Ori harness** (charts `01`–`05`, usage charts `13`–`15`): agent
     runs/day, engaged installs and accounts/day, runs per engaged install,
     first runs/day, then Ori-app OpenRouter requests/day, tokens/day,
     spend/day and the top models behind session-matched harness runs (chart
     `15` falls back to Ori-app models when no session matched), then the
     per-harness charts `16`–`20`+.
     *Reply:* the week-over-week table, the heavy-automation caveat with the
     human-scale number, a per-harness block (runs, key coverage, requests,
     spend, accounts current/new/retained, top model, and the Ori-app share of
     requests) with the shared-key overlap stated, the session-correlation
     coverage per harness and the
     key-correlation coverage (or that it is not yet available), and the
     definition and exclusion lines. Say plainly that usage counts
     OpenRouter-routed Ori traffic only.
   - **Ori eval** (charts `06`–`08`): eval runs/day, eval-running installs/day.
     *Reply:* the infrastructure-failure share called out, the week-over-week table, the
     `env_kind:user` filter and the internal-exclusion floor.
   - **OpenRouter MCP** (charts `09`–`12`): successful intent-bearing calls/day,
     keys making such a call per day.
     *Reply:* the no-user-agent gap, real calls as a share of all `tools/call`
     and of all requests, the key-prefix-is-not-a-user limitation, and the note
     that the intent-bearing split is a judgment call.

7. **Post** — the automation session's own final response is the top-level
   message for each surface with that surface's PNGs attached, which puts the
   images in the channel. Then post that surface's reply with the native
   `slack` tool using the top-level message's `ts` as `thread_ts`. Keep each
   message under ~4000 chars. If delivery looks uncertain, read the channel
   back with the `slack` tool rather than re-posting.

## Specifications

- The window is 7 complete UTC days versus the 7 before; partial days never
  appear.
- Three top-level messages, one reply each, in harness → eval → MCP order.
- Charts are regenerated every run from freshly fetched data. Never reuse a
  previous week's PNG.
- Chart PNGs are 4:3 at 2560×1920 and sized to read in a social timeline; keep
  the type scale in `build_charts.py` intact.
- Every reported metric names its source surface and carries its
  week-over-week change.
- The MCP client-family chart is short of the authoritative tool total by the
  no-user-agent count; report that gap explicitly wherever the client mix
  appears.
- Categorical labels the token maps in `build_charts.py` do not know (a new
  harness, tool or client family) get a deterministic categorical token rather
  than aborting the run; add the label to the map when it becomes a regular.
- `harness-unknown` in the harness mix is the CLI's own fallback label for a run
  with no harness telemetry id, not a harness. Label it as an instrumentation
  gap if it appears.
- A category with no events in the window is absent from the breakdown, not
  present with a zero: a quiet week is a result to render, never a reason to
  abort the run.
- A metric with no prior-week activity has no week-over-week ratio and reads
  `new`.

## Advice and pointers

- Ori telemetry is `message:"Ori telemetry event"` with the payload under
  `@extra.*`; the Ori app id is `4318848` and the CLI posts to
  `/api/v1/ori/telemetry`.
- Ori telemetry carries an account id on only some events, so internal
  exclusion is install-level: drop any install that ever ran under an internal
  account.
- MCP logs identify the caller only by `@breadcrumbs.key_hash_first_ten`. A
  10-char prefix is effectively unique across the key table, so it joins to an
  owner, but a key is not a user — one person can hold many, and a shared
  integration key looks like one caller.
- Datadog caps a grouping at 10,000 groups across all dimensions: group by one
  facet at a time and loop, which is why the harness and outcome breakdowns run
  one query per value.
- Datadog aggregation retries transient statuses and caches completed stages; if
  a run is rate-limited, rerun the same command with the same window.
- Ori app attribution in ClickHouse is a floor for inference spend, not a
  usage number: Ori driving Claude Code or Codex against the user's own
  provider key never reaches OpenRouter. State this beside every usage figure.
- `analytics.dim_apps` is SharedMergeTree: look the Ori app up with
  `GROUP BY app_id`, never `FINAL` or `DISTINCT`. Token columns on
  `default.generations` are `tokens_prompt`, `tokens_completion`,
  `native_tokens_reasoning_int64` and `native_tokens_cached`; `usage` is USD.
- Headline usage (daily series, `usage.models`, key join) carries the
  `app_id IN` filter. The session join deliberately does not: harness runs
  under `harness-claude` show up under the Claude Code app, not Ori's, so an
  Ori-app-only join reports zero for them. Read `requests_in_ori_app` and
  `apps` per harness to see the split, and treat the Ori-app daily series as
  a floor for harness inference.
- The session join collects `or_session_id` values one harness and one UTC day
  per Datadog call. A single grouping over the week or a two-facet grouping
  trips the 10,000-group cap.
