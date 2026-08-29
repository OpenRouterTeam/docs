# Anthropic Concentration Monitor

Monitor-specific companion to
[SCANNER_SPEC.md](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/kyc/sentinel/SCANNER_SPEC.md).
Read the shared spec first and defer to it for analytics access, read-only
behavior, Slack transport, the status rubric, channel routing, and the memory
protocol. Only the monitor-specific delta lives here.

The question this monitor answers: **is the share of OpenRouter's spend that
comes from Anthropic-concentrated, unenforced billing entities going back up?**
It watches a fraction, not a level. The level moves with weekday and platform
volume; the fraction does not, and it is what changed when enforcement landed —
the ≥99% cut ran 38.0% of platform spend on 2026-07-17 and 9.7% on 2026-07-26.

Report-only. No bans, no ban-candidates, no writes, no enforcement. The shared
materiality gate does not apply.

## Reading the monitor and its SQL

Resolve one `main` commit and fetch every input from that same revision. Two
requests against moving `main` can compose the doc from one commit and its SQL
from the next.

```bash
set -euo pipefail
repo=OpenRouterTeam/openrouter-web
path=packages/kyc/sentinel
revision=''
fetch_failed=0

if ! revision="$(gh api "repos/$repo/commits/main" --jq .sha)"; then
  fetch_failed=1
fi

files=(SCANNER_SPEC.md
       ANTHROPIC_CONCENTRATION_MONITOR.md
       anthropic-concentration-restrictions.sql
       anthropic-concentration-series.sql
       anthropic-concentration-drilldown.sql)

if [[ -n "$revision" ]]; then
  for file in "${files[@]}"; do
    if ! gh api "repos/$repo/contents/$path/$file?ref=$revision" \
      -H "Accept: application/vnd.github.raw" > "/tmp/$file"; then
      fetch_failed=1
    fi
  done
fi

if ((fetch_failed)); then
  if ! git pull --ff-only --no-recurse-submodules; then
    echo "Pinned fetch failed and the checkout could not fast-forward." >&2
  fi
  revision="$(git rev-parse HEAD)"
  for file in "${files[@]}"; do
    cp "$path/$file" "/tmp/$file"
  done
  head_sha="$(git rev-parse HEAD || echo unknown)"
  main_sha="$(git rev-parse origin/main 2>/dev/null || echo unknown)"
  echo "monitor_revision=$revision fallback_head=$head_sha fallback_origin_main=$main_sha"
  echo "Fallback copy is not a pinned main revision; force at least" \
       ":large_yellow_circle:." >&2
  if [[ "$head_sha" != "$main_sha" ]]; then
    echo "Fallback copy is not origin/main; say so in the thread." >&2
  fi
else
  echo "monitor_revision=$revision"
fi

grep -q '^# Anthropic Concentration Monitor$' /tmp/ANTHROPIC_CONCENTRATION_MONITOR.md
grep -q '^### Status rubric' /tmp/SCANNER_SPEC.md
grep -q 'AS frontier_authors' /tmp/anthropic-concentration-restrictions.sql
grep -q '^FROM entity_daily_flagged$' /tmp/anthropic-concentration-series.sql
grep -q '^WHERE entity_id NOT IN (SELECT clerk_user_id FROM non_global_entities)$' \
  /tmp/anthropic-concentration-drilldown.sql

cat /tmp/anthropic-concentration-restrictions.sql \
    /tmp/anthropic-concentration-series.sql    > /tmp/concentration-series-query.sql
cat /tmp/anthropic-concentration-restrictions.sql \
    /tmp/anthropic-concentration-drilldown.sql > /tmp/concentration-drilldown-query.sql
```

Every `grep` anchor above is a line that exists in the file it names, and each
one anchors the load-bearing line rather than a declaration: the drilldown
anchor is the residency `WHERE`, because a drilldown that declares
`non_global_entities` and never joins it would emit EU identifiers to Slack.
Under `set -euo pipefail` an anchor that matches nothing kills the run before a
single query is composed, and **there is no dead-run detector** — a run that
dies here is indistinguishable from a quiet morning. If you change a heading or
rename a CTE, re-run this block and confirm it exits 0 before merging.

The fallback path has already lost the pinned-revision guarantee, so it forces
at least `:large_yellow_circle:` unconditionally: `git rev-list` and
`git rev-parse origin/main` both fail on a remote-less or `--single-branch`
checkout, and a zero commit count would anyway not prove `HEAD` *is*
`origin/main` — any branch that has merged it counts zero. `SCANNER_SPEC.md` is
pinned alongside the four monitor files because this doc defers to it for the
status rubric and channel IDs; fetching it unpinned would reintroduce exactly
the cross-commit composition this block exists to prevent.

`anthropic-concentration-restrictions.sql` defines the restriction population
exactly once. The other two files begin with a comma and are suffixes for that
common `WITH` clause, so the series and the drilldown can never disagree about
who is enforced.

## Settled day

The mart batch-loads overnight, and **a half-loaded day looks like a spend drop,
not an error**. Never report the current UTC day. Establish the settled day
first:

```sql
SELECT today() AS reference_date, toDate(max(date)) AS latest_date
FROM analytics.fact_daily_generations_activity
WHERE date < today()
```

If that returns no row, a null date, a date after `reference_date`, or an error,
do not emit a zero or a green. Report `DATA_UNAVAILABLE`, say what failed, and
force at least `:large_yellow_circle:`. Never fall back to `stg_` or raw
generations: the thresholds below are defined against the mart.

Cap every query — unbounded versions of these have hit 20+ GB:

```bash
# series — one run covers both cuts
?param_asof=YYYY-MM-DD&param_history_days=49
# drilldown, only when a cut fired, once for that cut's share
# history_days sizes the residency window; 0 would check only the reported day
?param_asof=YYYY-MM-DD&param_history_days=7&param_share=0.99&param_row_cap=25
```

with `max_memory_usage=16000000000&max_execution_time=110`. Measured for the
one-pass series at `asof=2026-07-26, history_days=49`: 3.5–4.6 s wall, 4.1–4.3
GiB peak over five runs, 376,565,938 rows read. The drilldown at
`history_days=7, share=0.99, row_cap=25` ran 1.09 s / 879 MiB. Both sit well
inside the cap; re-measure if the window or the composition changes.

## The measure

Two cuts, both over billing entities not enforced against on that activity date:

- **≥99% Anthropic** — the entity's day is essentially pure Anthropic.
- **≥80% Anthropic** — looser, and the one a ring of resellers is more likely to
  sit inside.

Each is reported as **its share of all platform spend that day** — `c99_usd /
platform_usd` and `c80_usd / platform_usd`. Concentration is measured on spend,
not requests: the request basis is 38–39% narrower and drops exactly the profile
of interest, an account that is ≥99% Anthropic by dollars while sending cheap
non-Anthropic chatter alongside Claude.

**The denominator is all platform spend, including entities we have enforced
against.** Dividing by unenforced spend instead would rebase the fraction every
time somebody is banned — the denominator shrinks, and the share rises for
everyone left, which reads as a regression caused by enforcement working. The
two denominators differ by 1–3 points except during a ban wave.

There is no per-entity spend floor and no entity count in the alert path. A
$3/day account at 100% Anthropic contributes $3 to a numerator measured in
hundreds of thousands, so it cannot move anything on its own.

Say "billing entities", never "users". `clerk_user_id` is polymorphic and holds
`org_*` organization IDs alongside `user_*`; organizations are about 40% of
billed spend.

## Restriction semantics

The population lives in `anthropic-concentration-restrictions.sql`; read it for
the exact predicate. Two properties matter enough to restate:

**Membership is keyed on the activity date, not resolved as-of-now.** A
restriction counts for every day it overlapped at all, so a ban landing at 15:00
covers that whole day. Resolving at `now()` instead strips later-banned entities
out of every past day while leaving the latest day untouched, which makes every
historical share read artificially low.

Both ends of the interval round outward, which biases toward calling a day
enforced. A revocation partway through a day therefore leaves that day enforced
and its remaining hours of spend unreported. That is the same conservatism as
the ban side and is deliberate: the monitor's job is to surface spend nobody has
acted on, not to audit hours.

Kinds that count as enforcement: `account_ban`, `inference_block`,
`rate_limit`, and `spend_cap` unconditionally; `author_ban` and
`author_rate_limit` on a frontier author;
`frontier_us_models`; `model_ban` and `model_rate_limit` whose normalized target
begins with a frontier author. `provider_ban` and `provider_rate_limit` are
provider-scoped and excluded; `forced_moderation` changes moderation rather than
access and is excluded.

A throttle is not a ban. Including `rate_limit` means "restricted spend"
contains spend that is still flowing, because a ban zeroes an entity while a
throttle only reduces it. As of 2026-07-27 every rate-limit kind has **zero**
active rows, so those clauses are future-proofing and will not move a number.

The frontier author list in the SQL is held equal to
[`FRONTIER_US_MODEL_AUTHORS`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/db/restrictions/frontier-authors.ts)
by
[`packages/db/restrictions/anthropic-concentration-sql-sync.test.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/db/restrictions/anthropic-concentration-sql-sync.test.ts),
which parses the SQL text. The same test holds the SQL's included and excluded
restriction-kind lists equal to `RESTRICTION_KIND`, and asserts no excluded kind
reaches the predicate, so a kind added to the enum without a decision here fails
the build rather than reading as unenforced. That test lives in `packages/db`,
and CI's affected-package graph only runs it when `packages/db` is affected — an
edit to the SQL alone marks `@openrouter-monorepo/kyc`, which nothing depends
on, so CI catches an enum edit that skips the SQL but not an SQL edit that skips
the enum. Run it by hand when you touch these files:
`bun test packages/db/restrictions/anthropic-concentration-sql-sync.test.ts`.

`analytics.stg_restrictions` begins **2026-07-17 with no backfill**. Before that
date nobody reads as enforced, so every share from an earlier day is inflated
and is not comparable to a threshold set today. See
[Measured baselines](#measured-baselines).

## Freshness

Compute, on the settled day, the ratio of active entities to the mean of the **7
prior matching weekdays**. The denominator has to be recent: against a long
baseline the ratio runs above 1.1 and a 0.8 gate would need a shortfall it could
never see.

Over the 105 days of the committed replay where the baseline exists, the ratio
ran **0.9808 to 1.1282** (median 1.0607). The partial day it exists to catch
reads **0.314**: sampled at 04:26 UTC on 2026-07-27, that day held 122,524
entities against a Monday 7-week mean of 390,672.

Force at least `:large_yellow_circle:` when the latest date is older than
expected, or the ratio is below **0.8**. Emit the count, the baseline, and the
ratio every run. Never reinterpret either condition as a spend drop or an `OK`.

A partial load moves the numerator and the denominator of the share together, so
it does not obviously distort the share — but it distorts which entities cleared
their concentration cut, and the resulting number is not comparable to a
threshold. Do not report a share off a day that failed this gate.

## Status

Follow the shared [status
rubric](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/kyc/sentinel/SCANNER_SPEC.md#status-rubric-green--yellow--red)
but override its channel routing: every run, whatever the emoji, goes to the
alerts channel `C0BJ51BK7P0`; never the noncritical channel `C0BL5TQG45C`.

**`:red_circle:` — concentration is climbing back.** On the settled day, either:

- `c99_share_pct > 15`, or
- `c80_share_pct > 25`.

Single day. No sustained-rise requirement: 2026-07-20 spiked to 26.1% from 15.1%
the day before and fell back the next day, and that day should page.

**`:large_yellow_circle:` — needs an eye.** A freshness caveat, a
`DATA_UNAVAILABLE` settled-day lookup, or a stale spec fallback.

**`:large_green_circle:`** otherwise.

This monitor files no ban-candidates, and its runs land in the alerts channel
whatever the emoji, so read the emoji rather than the channel for what a run
needs. A `:red_circle:` needs the same action the scanners' reds need: decide
whether to enforce. What it cannot do is hand over a case file — it names
entities in the thread and stops. On the committed replay, red fires on three of
the nine honest days (07-18, 07-19, 07-20) and on **none** of the six days
since, so at these thresholds it is not a daily page; if that changes, move the
thresholds rather than the channel, and say in the thread when a red is
marginal.

Both thresholds are set against the nine honest days since 2026-07-18, and each
fires on three of them — 07-18, 07-19 and 07-20, the tail of the bad stretch.
That is a thin basis. Revisit both numbers once there are a few months of
post-enforcement history; until then treat them as provisional and say so if one
fires marginally.

## Drilldown

When a cut fires, run `anthropic-concentration-drilldown.sql` for that cut's
share and name the largest entities inside it. It is context for the alert, not
a trigger: nothing it returns changes the status.

It is the only surface that emits billing entity identifiers. Run it only after
a threshold fired — never on a freshness caveat — and cap it at 25 rows. Never
commit its output.

The drilldown drops any entity whose `data_region` is anything other than
`global` at any point in the fetched `[asof - history_days, asof]` window — at
the documented `history_days=7` that is the reported day and the seven before
it, and an entity whose last EU generation predates that window is still named.
An unrecognized `data_region` drops the entity rather than passing as global.
The aggregate series carries EU spend in its totals; this identifier-bearing
surface names nobody who served EU traffic inside that window.

## Reporting

One top-level line per run per the shared spec, verdict first, one bolded
number: the **≥99% share of platform spend**. The ≥80% share, both dollar
levels, and platform spend are unbolded context.

The thread carries, on every run: both shares, both dollar levels, platform
spend, the freshness ratio with its baseline, and the previous day's shares for
direction. When a cut fires, add the drilldown rows.

Every top-level line links the
[Anthropic Ban Impact Hex app](https://app.hex.tech/091db13f-d26f-4224-a185-6fce9df76f90/app/Anthropic-Ban-Impact-033tvUU2vmL90YPpTEhjt9/latest),
so a reader can go from the verdict to the interactive view without hunting for
it. The residency drop below is a control over what **this monitor** posts, not
over what that app renders: it sits behind Hex SSO and applies whatever
filtering its own queries apply. Treat the link as an authenticated internal
tool, not as an extension of the drilldown's guarantee, and do not paste rows
out of it into the channel.

## Replay

A replay is a change of `param_asof` alone. The series recomputes the whole
window from the mart and resolves enforcement as it stood on each day, so a past
day replays to the same numbers it would have reported at the time — subject to
the pre-2026-07-17 caveat below.

`replay/anthropic-concentration-replay-2026-07-26.tsv` is one such run, 154 days
ending 2026-07-26. It cost 14.66 s and **12.91 GiB** against the 16 GB cap,
against 4.2 GiB for the 49-day daily window: memory grows with the window, so
chunk a replay longer than ~180 days into several `asof` runs rather than
raising the cap.

## Known gaps

- **Banning an org's owner does not mark the org.** `packages/db/restrictions/`
  has no organization path, and the restriction tables hold ~59 `org_*` rows
  against ~32,425 `user_*`. An owner ban therefore leaves that org's spend
  counted as unenforced, which inflates both shares. Not fixed here.
- **No dead-run detector.** Nothing emits a heartbeat for this monitor, and a
  run that dies in the fetch block looks exactly like a quiet morning. Do not
  claim a heartbeat exists until something writes one.
- **Shares before 2026-07-17 are not comparable to the thresholds.** No
  restriction data exists for those days, so every entity counts as unenforced.
- **A ring is not directly detectable here.** The ≥80% cut is where a set of
  coordinated resellers would sit, and a large enough ring moves that share —
  but nothing in this monitor correlates accounts with each other, so a ring
  small enough to stay under 25% of platform spend passes unremarked. Detecting
  that needs a different signal: shared payment instruments, signup bursts,
  near-identical model mix or request cadence.

## Measured baselines

Measured against the analytics cluster on 2026-07-27. Re-measure before relying
on any of them.

Share of platform spend, the nine days for which restriction data exists:

| day | ≥99% | ≥80% |
| --- | ---: | ---: |
| 2026-07-18 | 26.7% | 32.5% |
| 2026-07-19 | 15.1% | 25.8% |
| 2026-07-20 | 26.1% | 35.3% |
| 2026-07-21 | 12.9% | 21.7% |
| 2026-07-22 | 13.5% | 20.0% |
| 2026-07-23 | 9.3% | 17.7% |
| 2026-07-24 | 8.8% | 17.5% |
| 2026-07-25 | 9.0% | 17.7% |
| 2026-07-26 | 9.7% | 17.7% |

2026-07-17 read 38.0% and 47.4%, and the ≥99% cut ran 17.2–39.9% between
2026-06-01 and 2026-07-16 — but no entity is enforced on those days, so those
figures are upper bounds rather than a comparable baseline.

Every figure in this section, the freshness range above, and both thresholds are
recomputable from
[`replay/anthropic-concentration-replay-2026-07-26.tsv`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/kyc/sentinel/replay/anthropic-concentration-replay-2026-07-26.tsv),
which is the series output for `asof=2026-07-26, history_days=153` plus two
derived columns. Its header pins the two SQL files by content hash rather than
by commit, because this branch squash-merges; regenerate it if either hash
stops matching.

Latest settled day, 2026-07-26: platform spend $1,741,454; ≥99% cut $169,225;
≥80% cut $308,987; 349,224 active entities.
