---
name: detect-proxy-shaped-relay-accounts
description: Detect accounts reselling US frontier models through a relay or proxy, using account-level user-agent and egress-network dominance in default.generations, and file the survivors as Sentinel ban candidates. Use when asked to sweep for proxy/relay traffic, newapi-style gateways, Go-client traffic on Chinese cloud egress, or to build a frontier-restriction cohort from traffic shape.
allowed-tools: Bash
user-invocable: true
---

# Detect proxy-shaped relay accounts

Goal: find accounts whose frontier spend runs through a relay or proxy, and hand
the survivors to `sentinel-ban-candidates` as `frontier_us_models` proposals.

Two signals are available on `default.generations`, and neither is proof on its
own. The `tagged` CTE in `proxy-shaped-shortlived.sql` holds the authoritative
user-agent and ASN patterns for both; extend the signals there.

- **Self-declared relay user agent** — the gateway stacks that ship a
  recognisable default user agent. Self-reported, so trivially spoofed, and
  absent on any operator who bothered to change the default.
- **Go HTTP client user agent on Chinese cloud or telecom egress** — a Go
  client default paired with a Chinese cloud or telecom ASN. The common relay
  stacks are Go and ship this default, but so does any Go SDK user.

## Rules

1. **Select on account-level dominance, never on matching requests.** Require
   the signal to carry a supermajority (at least 80%) of the account's usage in
   the window. A per-request filter puts large legitimate customers in the
   cohort on the strength of one matching request.
2. **Separate short-lived from long-lived accounts and file them as separate
   cases.** They differ in confidence and in what a reviewer must check, and a
   mixed case forces one decision on both.
   - Short-lived (higher confidence): a span of at most about a day, one API
     key, a handful of models, and spend that stops close to a round cap.
     Uniform lifetime, key count, model count, egress network, and terminal
     spend across independent accounts is a configured ring, not a set of
     independent customers.
   - Long-lived (needs per-account judgement): full-window accounts with broad
     model use. A legitimate product with a Go backend on Chinese cloud egress
     is indistinguishable from a relay on these signals alone. Do not sweep
     these; file them for review with the ambiguity stated.
3. **Propose `frontier_us_models`, not a ban.** Traffic shape plus spend
   concentration is one account-level signal short of a ban, and the restriction
   is reversible.
4. **State the alternative explanation and the disproof in the case
   description.** For each cohort, name what would show the selection is wrong.
5. **Run the compromised-key gate on every account before filing, and never
   approve or enact on this shape.** Relay user agent and egress ASN describe
   the relay, not the account behind it, so a harvested key replayed through the
   relay lands in this cohort looking exactly like an operator. Check whether the
   key predates the traffic, whether the account has its own funding and prior
   traffic from a real origin or SDK, and whether the burst model and ASN are new
   to an otherwise ordinary account. When any of that holds, file for visibility
   only, leave the target `pending_review`, and escalate for key revocation,
   holder notification, and crediting the negative balance. Full gate in
   [`SCANNER_SPEC.md`](../../../packages/kyc/sentinel/SCANNER_SPEC.md#compromised-key-gate).

## Devin Secrets Needed

- `CLICKHOUSE_URL`
- `CLICKHOUSE_READONLY_USER`
- `CLICKHOUSE_READONLY_PASSWORD`

(Usually already in the session environment.)

## Run the query

`proxy-shaped-shortlived.sql` enforces rule 1 plus the span, key-count, and
model-count filters. Cap proximity is evidence only: `usd_to_nearest_cap` is
never filtered on, so the reviewer applies that test.

```bash
CH_PARAMS="?default_format=TSVWithNames&param_lookback_hours=48&param_min_frontier_usd=300"
CH_PARAMS="${CH_PARAMS}&param_min_signal_pct=80"
CH_PARAMS="${CH_PARAMS}&param_max_span_hours=26&param_max_api_keys=2&param_max_models=5"
CH_PARAMS="${CH_PARAMS}&param_round_caps=%5B500%2C1000%2C2000%5D&param_exclude_restricted=1"

curl -sS "${CLICKHOUSE_URL%/}/${CH_PARAMS}" \
  -H "X-ClickHouse-User: $CLICKHOUSE_READONLY_USER" \
  -H "X-ClickHouse-Key: $CLICKHOUSE_READONLY_PASSWORD" \
  --data-binary @.agents/skills/detect-proxy-shaped-relay-accounts/proxy-shaped-shortlived.sql
```

A 48-hour window keeps the sweep proactive. Widening it mostly returns accounts
already restricted by earlier sweeps.

For the long-lived half, run the same file against the same `lookback_hours`
with the shape filters opened up:
`param_max_span_hours=48` (the window itself, the highest span it can report),
`param_max_api_keys=1000`, `param_max_models=1000`. That run is a superset of
the short-lived one, so subtract the short-lived accounts from it before filing,
or rule 2's two cases overlap. Both runs must share `lookback_hours`, or the
subtraction compares different windows.

The query carries no `FORMAT` clause, so swap `default_format=PrettyCompact` in
to eyeball a run and back to `TSVWithNames` to parse it.

## Then file

Follow `sentinel-ban-candidates` for the ingest. One target per account,
`proposedKind: "frontier_us_models"`, no `proposedTarget`, `{}` params, no
expiry. This scanner's own live case proposes that kind for every target it
files, so the only way one of its pending targets carries a different remedy is a
human having changed the proposal after the filing. Those accounts stay in that
case: report the case link, the target ids, and the frontier block, and leave
reverting the remedy to a human rather than filing them again — see
[Changing the proposed kind](../sentinel-ban-candidates/SKILL.md#changing-the-proposed-kind-not-filing-a-second-case).
An account pending under another investigation's case is not this scanner's to
narrow: the change replaces the remedy, so report the proxy-shaped evidence in
that case's thread and leave its proposal alone.

The query's output columns are the per-target evidence: signal,
signal-matched frontier usage, total usage (the denominator behind every
`*_pct`), signal share, request counts, egress ASN and country, top user agents,
key and IP-hash and model counts, active span, first and last seen, signup date
and account age, and distance to the nearest round spend cap. Cohort and window
are not columns: they come from which run produced the row, so record the
parameters alongside the rows.

`active_span_hours` is clamped to the lookback window, so it measures time
active within the window rather than account age, and `usd_to_nearest_cap`
measures window spend rather than lifetime spend. A months-old account with a
nightly batch job can pass the short-lived filters, so read both against
`signup_at` and `account_age_days` before treating a row as a fresh burner.

`signal` is `both_signals` when an account carries relay user agents and
Go-on-CN-cloud egress, and `no_signal` when it carries neither — only reachable
at `min_frontier_usd=0` and `min_signal_pct=0`, since a no-signal account also
has `signal_pct = 0`; `relay_ua_pct` and `go_cn_egress_pct` (plus their request
counts) say how much usage each signal actually accounts for, so cite those
rather than the label alone. `round_caps` is the cap set `usd_to_nearest_cap`
measures against — widen it when a ring's spend concentrates elsewhere.

## Gotchas

- **`analytics.stg_restrictions` lags.** It is a CDC replica, so an enactment
  from the last few minutes or hours is not there yet and the query's
  `exclude_restricted` filter will re-surface those accounts. Treat the SQL
  exclusion as a floor and confirm against `sentinel:ban-candidates list` and
  `targets` before filing.
- **A restriction is only equivalent to this proposal if it covers all three US
  frontier authors.** The exclusion counts `frontier_us_models`,
  `inference_block`, `account_ban`, and the three-author `author_ban`
  combination, and nothing weaker.
- **EU-region traffic is outside the sweep.** The query carries
  `data_region != 'europe'` per `packages/kyc/sentinel/SCANNER_SPEC.md`, so a
  relay running on EU-region keys will not appear. Never narrow it to
  `data_region = 'global'`: that also drops the `us` rows.
- **Frontier spend under-reports BYOK relay traffic.** A relayed account on its
  own provider key bills the holder upstream while OpenRouter records only the
  BYOK fee, so rank and report BYOK exposure alongside the query's usd columns
  rather than ranking on them alone.
- **User agent is empty on a material share of rows and ASN is missing on a
  small one**, so every share this query reports is a slight underestimate.
- **Reference the account-level CTE exactly once.** ClickHouse inlines a CTE
  per reference rather than materializing it, so a second reference re-runs the
  whole `default.generations` scan — measured at double the rows read on a
  48-hour run. Enrich from a table that is cheap to aggregate in full instead of
  filtering it by the cohort.
- **Keep unbounded arrays out of the aggregation.** `topK` is bounded and
  `uniqExact` keeps every distinct value per group, which held up empirically at
  a 7-day window. `groupUniqArray` over keys, IP hashes, user agents, or models
  across all accounts exhausts the query memory limit. If you need full lists,
  aggregate the cohort first, then enrich the reduced account list.
