---
name: sentinel-ban-candidates
description: Use the Sentinel ban-candidates CLI to propose ban candidates and read back suggestions and their targets. Detection agents use the ingest key.
allowed-tools: Bash
user-invocable: true
---

# Sentinel ban-candidates

Use this tool when a detection agent needs to submit ban candidates for review
and read back suggestions and their targets. Candidates then flow through the
reviewer/enforcer surface: one `review` call per case, then one `enact` call.
Never loop either command over individual targets — each call posts its own
Slack notification, and a per-target loop floods the case thread.

The CLI builds and signs requests and handles HTTP errors. Callers only need to
construct the ingest JSON and choose the appropriate command.

## Permission model

There are two signing keys:

- `BAN_CANDIDATES_INGEST_SIGNING_KEY` and `BAN_CANDIDATES_REVIEW_SIGNING_KEY`
  both authorize every ban-candidates route (ingest, review, enact, undo,
  archive), but the server binds behavior to the key that verified the HMAC:
  ingest-key requests are treated as agent requests. `/enact` and review
  approvals (`/review`, `/review/batch`) apply the agent policy gates (no full
  bans, allowlisted kinds, user targets, PAYG-only), while `/undo` may reverse
  any enacted restriction. Ingest-key requests to `/review`, `/enact`, `/undo`,
  and `/archive` require a claimed acting identity instead of falling back to
  `ACTING_SYSTEM`. Review-key requests keep the ordinary semantics and may opt
  into agent gating with `agentEnactment: true`. In
  production, all ban-candidates routes are gated server-side on the HMAC. Dev
  bypasses that middleware check; Mission Control's review/enact clients sign
  with an empty key there, while this CLI exits 4 before sending. The
  dev-scoped machine identity cannot read the prod values, which is the ACL
  boundary. Both names share a manifest path (`/services/cfw-internal-api` in
  `env.manifest.json`), but the wrapper injects the whole path: 45
  manifest-listed variables, including `ADMIN_API_KEY`, `CLERK_SECRET_KEY`,
  `CLICKHOUSE_PASSWORD`, `PG_US_CENTRAL1_POOL_DB_URL`, and `S3_SECRET_ACCESS_KEY`.

## Authentication

The ingest key is read from the process environment. The `sentinel:ban-candidates`
package script wraps the CLI in `infisical run`; with a valid Infisical session,
the key is injected for you:

```bash
bun run sentinel:ban-candidates list pending_review
```

If this instead prompts `? Select your hosting option:` and exits 1 with
`Unable to parse domain url`, authenticate the provisioned machine identity
first (agents: see the Secret Management section in root `AGENTS.md`) and run
the Bun command in the same shell. A fresh Devin session has no Infisical login
session, so export `INFISICAL_TOKEN` with the universal-auth login below before
running `bun run sentinel:ban-candidates ...`. (These examples assume a
one-shot/script shell; use `return 1` instead of `exit 1` when sourcing
interactively.)

```bash
INFISICAL_TOKEN=$(infisical login \
  --method=universal-auth \
  --client-id="$INFISICAL_CLIENT" \
  --client-secret="$INFISICAL_SECRET" \
  --plain --silent) || {
  echo "infisical login failed — check INFISICAL_CLIENT / INFISICAL_SECRET" >&2
  exit 1
}
[ -n "$INFISICAL_TOKEN" ] || {
  echo "infisical login returned an empty token — check INFISICAL_CLIENT / INFISICAL_SECRET" >&2
  exit 1
}
export INFISICAL_TOKEN
bun run sentinel:ban-candidates list pending_review
```

If `*_SIGNING_KEY not set` appears with exit 4 under `infisical run`, the value
is empty, absent, or unreadable on that path in that environment, not evidence
that login failed. On dev, an empty review key is expected; for ingest, it means
the key is absent or the identity lacks read access in the selected environment
(for example, a dev-scoped identity against prod).

Local development can point at a local worker with
`CFW_INTERNAL_URL=http://localhost:8794`. In production and automation,
`CFW_INTERNAL_URL` is normally unset, so the CLI uses the production
`https://openrouter.ai` default.

## Usage

```bash
# Propose a suggestion from a JSON file or stdin.
bun run sentinel:ban-candidates post /tmp/candidate.json
echo '{...}' | bun run sentinel:ban-candidates post -

# Read suggestions and their targets.
bun run sentinel:ban-candidates list
bun run sentinel:ban-candidates list pending_review
bun run sentinel:ban-candidates targets <suggestionId>

# Decide a whole case in one request, then enforce it in one request.
bun run sentinel:ban-candidates review <suggestionId> approved \
  --reviewer <clerk_user_id> --notes 'authorized by <reviewer> in thread' \
  <targetId> <targetId> ...
bun run sentinel:ban-candidates enact --yes --acting-user <clerk_user_id> \
  <targetId> <targetId> ...
bun run sentinel:ban-candidates archive <suggestionId> \
  --reason 'no longer actionable' --acting-user <clerk_user_id>
```

`review` takes up to 1000 target ids per call and posts one Slack notification
per call; `enact` takes up to 200 target ids per call. Both reject a longer list
outright, so a case above those sizes is decided in the smallest number of
full-width chunks — never one call per target. A review whose
targets are not all `pending_review` on the named case fails as a whole with
409, so re-read `targets <suggestionId>` and resend the still-pending set.
Archiving freezes a case at ingest. New detections neither add targets nor
refresh it until a human unarchives it in Mission Control. An acting identity is
required for ingest-key (agent) callers: `--reviewer` on `review` and
`--acting-user` on `enact` or `archive`. Unarchive is Mission Control only.

### Compromised-key gate — run before `review` and `enact`

Before approving or enacting any target, establish whether the traffic is a
harvested API key replayed against a legitimate account. Any of these on the
account argues victim, not operator: the burst key was minted well before the
burst; the account has its own funding history with no card fingerprint or BIN
shared across the cohort; it has prior traffic from a real origin, SDK, or
application; its earlier traffic was ordinary while the burst model or burst ASN
is new to it; the drained balance is its own; no key-mint or login event
correlates with the burst; the rest of the cohort shares only the relay or
client fingerprint. Establish dormancy on lifetime history, never a trailing
window, and read intra-day state from `stg_`/raw sources.

Relay and client uniformity — user agent, proxy IP hash, `cf_bot_score`, empty
origin, synchronized timing, shared ASN — is one shared attacker-side attribute
and never the second independent account-level signal. Rank and report BYOK
inference exposure alongside OpenRouter `usage`, which understates a relayed
BYOK victim.

A trip is a hard stop: do not `review ... approved` and do not `enact`. File for
visibility, leave every target `pending_review`, and escalate to a human for key
revocation, holder notification, and crediting the negative balance. The full
gate is in
[`SCANNER_SPEC.md`](../../../packages/kyc/sentinel/SCANNER_SPEC.md#compromised-key-gate).

## Examples

Read-tier commands run against production with the ingest key. The values below
are illustrative placeholders, not live data:

```bash
# Pending suggestions — returns JSON rows like:
# {"id":"00000000-0000-4000-8000-000000000000","source":"autobuy-scanner",
#  "ruleKey":"autobuy_example_bin000000_exampleauthor_block_r000",
#  "confidence":0.8,"targetType":"user","targetCount":1,"pendingCount":1,
#  "archivedAt":null,"enactedCount":0,"enactableCount":1}
bun run sentinel:ban-candidates list pending_review

# Targets for one suggestion — per-target status, proposedKind, and evidence
bun run sentinel:ban-candidates targets 00000000-0000-4000-8000-000000000000
```

### Read status from the CLI, never from ClickHouse

`list` and `targets` are the only current source for case and target state.
`analytics.stg_ban_candidate_suggestions`,
`analytics.stg_ban_candidate_targets`, and `analytics.stg_restrictions` are CDC
replicas whose lag can exceed a whole run, so a case filed or a restriction
enacted while you were working may be missing from them.

Treat a ClickHouse read as a floor on enforcement, never a refutation of it.
Never call a case unfiled, a target unreviewed, or an account unrestricted on
the strength of an `analytics.*` query; confirm with `targets <suggestionId>`
and quote the per-target `status` and `restrictionId`. Prefer the CLI whenever
both sources could answer.

ClickHouse still owns what the CLI cannot answer — spend, cohorts,
fingerprints, and the enforcement state of accounts that are not in a case —
with the lag stated alongside any such figure.

### Redundancy sweeps: same-kind status hides stronger coverage

A target's `currentRestrictionStatus` and `existingRestrictionId` reflect only a
restriction matching the target's own `proposedKind`, so a user carrying an
active `account_ban` still reads as `none` on a case proposing
`inference_block`. Never conclude from `none` that a target is unrestricted.
To compare coverage across kinds, fetch `targets` for the enacted cases that
carry the stronger restrictions and union their active targets, treating
`account_ban` as stronger than `inference_block` and both as stronger than
`frontier_us_models`. Enacted targets appear as `status: approved` with a
non-null `restrictionId`, not as a distinct `enacted` status, so filter on
`restrictionId` plus `currentRestrictionStatus === 'active'` and a null
`restrictionRevokedAt`.

Archive only when every pending target is covered by an active restriction at
least as restrictive as the proposal. Full target overlap with a weaker
restriction is an upgrade decision for a human, not redundancy.

Re-read `targets` immediately before archiving. Restrictions land continuously
while a sweep runs, so a snapshot taken minutes earlier can misstate coverage in
either direction. After archiving, verify by absence: archived cases drop out of
the default `list` output entirely rather than appearing with a non-null
`archivedAt`.

For coverage of accounts outside any case, `analytics.stg_restrictions` keys the
account on `entity_id`, has no `user_id` column, and is versioned by
`_peerdb_version` with `_peerdb_is_deleted`. Deduplicate with
`argMax(..., _peerdb_version) GROUP BY id`, alias the projections to names that
differ from the source columns, and filter those aliases in an outer query,
since ClickHouse rejects both aliases shadowing a source column and aggregate
aliases filtered in their own scope.

### Skip archived and already-resolved suggestions

Use the unfiltered `list` output to avoid re-filing or reporting suggestions
that no longer need action. Skip any row where `archivedAt` is non-null or
where `enactableCount > 0 && enactedCount === enactableCount`: the first is
an archived suggestion, and the second means every target eligible for
restriction matching has an active matching restriction. `enactableCount`
counts targets with a non-null `target_value` and a real restriction
`proposed_kind`. Domain targets may use any supported restriction kind except
`frontier_us_models`, with the domain in `targetValue`, and are stored as
candidates for review. The retired legacy `domain_block` proposal kind is
rejected at ingest, and domain enactment is deferred to #30819. A row with
`pendingCount === 0 && enactedCount < enactableCount` is only a candidate for
"fully denied": the list endpoint does not expose `deniedCount`, so fetch
`targets <suggestionId>` and skip it only when every target is `denied`.
Otherwise, surface it as an enforcement gap, including approved targets
awaiting enactment. A partially reviewed case with `pendingCount > 0` still
needs action and must not be skipped. For example, an archived
`autobuy-scanner` suggestion whose targets are all already restricted for the
US frontier authors should be skipped rather than reported as updated.

Both counts are computed over all targets independently of the optional status
filter, so this equality check remains valid on a status-filtered list. Prefer
the unfiltered list for a complete deduplication pass.

A `frontier_us_models` target for a US-frontier-ban-exempt user is the one case
where the equality never arrives: enactment skips it (`frontier_us_models_exempt`)
without writing a restriction, while `enactableCount` still counts it. Such a
suggestion stays permanently below the bar, so fall back to the per-target
`targets` output — a target that is `approved` with a null `restrictionId` and
an exempt user is resolved, not outstanding — rather than re-filing it every
run.

For example, this cheap list-level filter drops archived and fully enacted
suggestions. Run the target check above before dropping a candidate fully
denied case:

```bash
bun run sentinel:ban-candidates list \
  | jq 'map(select(.archivedAt == null and (.enactableCount == 0 or .enactedCount != .enactableCount)))'
```

An ingest body in the shape used by the fraud scanners, which file one
account-scoped frontier block per user (placeholder values):

```json
{
  "source": "autobuy-scanner",
  "ruleKey": "autobuy_example_bin000000_frontier_block",
  "description": "Fresh minters on ring BIN 000000, ~100% Anthropic spend via uniform autobuys",
  "confidence": 0.9,
  "urgency": "yellow",
  "targetType": "user",
  "targets": [
    {
      "targetValue": "user_...",
      "proposedKind": "frontier_us_models",
      "proposedParams": {},
      "evidence": {
        "bin": "000000",
        "anthropic_pct": 100,
        "autobuy_charges": 12,
        "account_age_days": 3
      }
    }
  ]
}
```

On a successful ingest, the response includes `slack` when an alert was posted
(or an existing alert was reused):

```json
{"suggestionId":"00000000-0000-4000-8000-000000000000","created":true,
 "targetsUpserted":1,"slack":{"channel":"C0BJ51BK7P0","ts":"1710000000.000100"}}
```

When Slack is unavailable or the suggestion is archived, `slack` is `null`.
If present, thread subsequent findings on the returned Slack message.

Re-posting an existing `source` + `ruleKey` + `targetType` upserts targets into
the existing suggestion and returns `created:false` with a 200 — that is a
successful upsert, not a failure. The upsert also refreshes the suggestion's
`description`, `confidence`, and `urgency` from the new request body, so
re-posting with one existing target is the way to update reviewer-facing
framing on a live suggestion. Re-ingesting an existing case overwrites its
stored urgency, so set urgency based on the whole case after the update,
including all accumulated targets and findings, rather than only the new
batch. For example, if a case is red and the new batch alone would be yellow,
keep sending red unless the overall case has genuinely de-escalated. Archived
suggestions are frozen and skip this refresh.

### Slack reporting contract

- Ingest owns the per-case top-level alert and Mission Control case link. Do not
  post another per-case top-level alert or case link.
- When ingest returns a non-null `{channel, ts}`, post findings and reasoning as
  a thread reply to that message. Enactment notifications are threaded
  server-side.
- If a filed case has `slack: null`, post one standalone top-level summary for
  the run in the emoji-routed channel and put the findings in its thread. Never
  drop findings or invent a synthetic case link.
- Do not use `slack-remote`; it appends a "Sent using @Devin" block that spawns
  a recursive Devin session.
- Keep one standalone top-level summary for any run with no filed case
  (regardless of status), or a green run with no case thread.
- The three live automation prompts (Sleeper Scanner, Recent Signups Scanner,
  and Autobuy Scanner) live outside this repository and are thin wrappers
  referencing `packages/kyc/sentinel/SCANNER_SPEC.md`, which owns this contract.
  If a change alters what a wrapper itself must say, update each prompt
  manually.

## Pre-spend signup-burst detection

Waves of minted accounts fund a small top-up and burn it past zero within
minutes of signup, so a detector that keys on realized spend always fires after
the money is gone. Flag the burst at signup instead, and file its members —
including the ones that have not spent yet — while they are still dormant.

The rule needs three conditions, not one shared attribute: a tight
per-signup-IP-hash burst, a wider per-ASN-per-email-domain burst that survives
the operator rotating IPs mid-wave, and realized harm from the burst's earlier
members. The harm gate is what separates a minting run from ordinary shared
egress — large NAT and cloud-egress buckets produce burst counts all day with no
overdraft behind them — so never file on burst counts alone. Do not gate on
`signup_email_autogen_score`; plausible-looking generated addresses score low
and the gate drops most real bursts. Per-cluster corroboration of an already-swept
ring is a strong signal: the share of signup-IP cluster members with an active
restriction distinguishes a confirmed ring's unenforced remainder from an
unproven cluster.

Count real accounts only. `stg_users` also holds the organization entity created
behind a signup, carrying the same email and signup IP hash, so leaving
`is_organization` rows in inflates both burst counts and lets an account's own
organization satisfy the sibling-harm gate by itself.

```sql
WITH signups AS (
  SELECT
    clerk_user_id,
    argMax(email, _peerdb_version) AS email,
    argMax(created_at, _peerdb_version) AS signup_at,
    argMax(signup_ip_hash, _peerdb_version) AS signup_ip_hash,
    argMax(signup_asn, _peerdb_version) AS signup_asn,
    argMax(email_domain, _peerdb_version) AS email_domain
  FROM analytics.stg_users
  WHERE created_at >= now() - INTERVAL 24 HOUR
  GROUP BY clerk_user_id
  HAVING signup_ip_hash != ''
     AND argMax(is_organization, _peerdb_version) = 0
     AND argMax(_peerdb_is_deleted, _peerdb_version) = 0
     AND argMax(deleted, _peerdb_version) = false
),
bursts AS (
  SELECT
    *,
    max(ip_trailing_60m) OVER (PARTITION BY signup_ip_hash) AS ip_burst_60m,
    if(
      signup_asn IS NULL OR email_domain = '',
      0,
      max(asn_domain_trailing_60m) OVER (PARTITION BY signup_asn, email_domain)
    ) AS asn_domain_burst_60m
  FROM (
    SELECT
      *,
      count() OVER (
        PARTITION BY signup_ip_hash
        ORDER BY toUnixTimestamp(signup_at)
        RANGE BETWEEN 3600 PRECEDING AND CURRENT ROW
      ) AS ip_trailing_60m,
      count() OVER (
        PARTITION BY signup_asn, email_domain
        ORDER BY toUnixTimestamp(signup_at)
        RANGE BETWEEN 3600 PRECEDING AND CURRENT ROW
      ) AS asn_domain_trailing_60m
    FROM signups
  )
),
usage AS (
  SELECT
    clerk_user_id,
    sum(usage) AS usage_usd,
    sum(
      if(
        isNull(openrouter_non_byok_usage),
        if(provider_api_key_id IS NULL, usage, 0),
        openrouter_non_byok_usage
      )
    ) AS own_model_usd
  FROM analytics.stg_generations
  WHERE data_region != 'europe'
    AND created_at >= now() - INTERVAL 24 HOUR
    AND clerk_user_id IN (SELECT clerk_user_id FROM bursts)
  GROUP BY clerk_user_id
),
funding AS (
  SELECT clerk_user_id, sum(amount) AS funded_usd
  FROM analytics.stg_credits
  WHERE _peerdb_is_deleted = 0
    AND clerk_user_id IN (SELECT clerk_user_id FROM bursts)
  GROUP BY clerk_user_id
),
pool_funded AS (
  SELECT DISTINCT clerk_user_id
  FROM (
    SELECT
      id,
      argMax(clerk_user_id, _peerdb_version) AS clerk_user_id,
      argMax(disabled, _peerdb_version) AS disabled,
      argMax(expires_at, _peerdb_version) AS expires_at,
      argMax(_peerdb_is_deleted, _peerdb_version) AS is_deleted
    FROM analytics.stg_credit_pools
    GROUP BY id
  )
  WHERE is_deleted = 0
    AND disabled = false
    AND expires_at > now()
),
account_harm AS (
  SELECT
    b.clerk_user_id AS clerk_user_id,
    b.signup_ip_hash AS signup_ip_hash,
    toUnixTimestamp(b.signup_at) AS signup_ts,
    ifNull(u.usage_usd, 0) > ifNull(f.funded_usd, 0) + 0.5 AS is_overdrawn,
    greatest(0, ifNull(u.usage_usd, 0) - ifNull(f.funded_usd, 0)) AS unbacked_usd
  FROM bursts AS b
  LEFT JOIN usage AS u ON u.clerk_user_id = b.clerk_user_id
  LEFT JOIN funding AS f ON f.clerk_user_id = b.clerk_user_id
  WHERE b.clerk_user_id NOT IN (SELECT clerk_user_id FROM pool_funded)
),
burst_harm AS (
  SELECT
    c.clerk_user_id AS clerk_user_id,
    countIf(h.is_overdrawn) AS overdrawn_siblings,
    round(sum(h.unbacked_usd), 2) AS unbacked_usd
  FROM bursts AS c
  INNER JOIN account_harm AS h ON h.signup_ip_hash = c.signup_ip_hash
  WHERE h.clerk_user_id != c.clerk_user_id
    AND abs(h.signup_ts - toUnixTimestamp(c.signup_at)) <= 3600
  GROUP BY c.clerk_user_id
),
current_restrictions AS (
  SELECT
    id,
    argMax(entity_id, _peerdb_version) AS entity_id,
    argMax(kind, _peerdb_version) AS kind,
    argMax(target, _peerdb_version) AS target,
    argMax(revoked_at, _peerdb_version) AS revoked_at,
    argMax(expires_at, _peerdb_version) AS expires_at,
    argMax(_peerdb_is_deleted, _peerdb_version) AS is_deleted
  FROM analytics.stg_restrictions
  GROUP BY id
),
covered AS (
  SELECT entity_id
  FROM current_restrictions
  WHERE is_deleted = 0
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  GROUP BY entity_id
  HAVING countIf(kind IN ('frontier_us_models', 'inference_block', 'account_ban')) > 0
     OR length(groupUniqArrayIf(
          lower(if(startsWith(target, '~'), substring(target, 2), target)),
          kind = 'author_ban'
            AND has(['anthropic', 'google', 'openai'],
                    lower(if(startsWith(target, '~'), substring(target, 2), target)))
        )) = 3
)
SELECT
  b.clerk_user_id,
  b.email,
  b.signup_at,
  substring(b.signup_ip_hash, 1, 12) AS signup_ip_hash_prefix,
  b.signup_asn,
  b.ip_burst_60m,
  b.asn_domain_burst_60m,
  h.overdrawn_siblings,
  h.unbacked_usd,
  round(ifNull(f.funded_usd, 0), 2) AS own_funded_usd
FROM bursts AS b
INNER JOIN burst_harm AS h ON h.clerk_user_id = b.clerk_user_id
LEFT JOIN funding AS f ON f.clerk_user_id = b.clerk_user_id
WHERE b.ip_burst_60m >= 5
  AND b.asn_domain_burst_60m >= 10
  AND h.overdrawn_siblings >= 1
  AND b.clerk_user_id NOT IN (SELECT entity_id FROM covered)
  AND b.clerk_user_id NOT IN (SELECT clerk_user_id FROM usage WHERE own_model_usd > 0.01)
  AND b.clerk_user_id NOT IN (SELECT clerk_user_id FROM pool_funded)
ORDER BY b.signup_at
```

Keep the default lookback at 24 hours. Widening it only pays off when enforcement
has not already swept the older band, so check the covered count on the widened
band rather than re-filing candidates.

Every `analytics.stg_*` table here is a CDC replica. The staging views already
keep only the newest row per source `id`, so no extra collapse is needed to sum a
per-row column such as `stg_credits.amount`; what still needs collapsing is any
key coarser than that `id`, plus the deleted flags, before filtering on it:
`stg_users` to one live row per
`clerk_user_id` (an account updated after signup otherwise inflates the burst
counts), `stg_restrictions` to one row per restriction `id` via
`argMax(..., _peerdb_version)` (a superseded version still shows
`revoked_at IS NULL`, so a lifted restriction would silently hide a candidate),
and `stg_credits` filtered on `_peerdb_is_deleted = 0` (tombstoned credit rows
otherwise overstate funding and suppress the harm signal).
Take the burst size as the per-partition maximum of the trailing count, not the
trailing count itself, or the first members of every burst — the ones that spend
first — stay below the threshold forever. That maximum is a partition-wide value
though, so the harm gate cannot reuse the partition: score harm per candidate
over the siblings within 60 minutes of its own signup, or an unrelated
overdrawing account hours away on the same shared egress admits the whole day's
signups behind that IP hash. Count a sibling as overdrawn only past a 50-cent
margin over its funding (`usage > funded + 0.5`): settlement rounding and BYOK
fees leave ordinary spent-to-zero accounts a hair over their deposits, and
without the margin one of those satisfies the harm gate for its whole signup-IP
group. And restrict every generations read to
the burst members with `clerk_user_id IN (SELECT ...)` alongside
`data_region != 'europe'`, per `packages/kyc/sentinel/SCANNER_SPEC.md`.

Use `stg_`/raw sources only. `dim_users` carries no `signup_ip_hash`, and the
`fact_`/`dim_` marts are batch-built, so an intra-day read of them can be hours
stale — a stalled mart makes a live burst invisible.

Every CDC table lags, and only generations does not: `stg_generations` and
`default.generations` run seconds behind live traffic, while `stg_users`,
`stg_credits` and `stg_restrictions` have measured 24 to 36 minutes behind. So
`stg_users` is too slow to be the trigger on a fast ring — that lag is longer
than the signup-to-first-generation span these waves run, so the query above
sees the ring only once part of it has spent. The lag does not invalidate the
harm gate, since the harm comes from the burst's earlier members, which are past
the lag window by the time a later member signs up, and case dedupe reads
Postgres through the CLI rather than ClickHouse. It does invalidate one column:
for a target younger than the current lag, `own_funded_usd = 0` means "not
landed yet", not "unfunded", so never write it into a case as evidence of an
unfunded account — check `max(created_at)` on `stg_credits` against `now()` to
see where the boundary is, bounded to the last 7 days so partition pruning
applies (`packages/kyc/sentinel/SCANNER_SPEC.md`), and say funding is unknown
for anything inside it.
Trigger on the Datadog `Account created`
log instead, which is queryable seconds after signup through the native
`datadog` MCP. It carries the same values the burst partitions need, verified
equal to their ClickHouse counterparts on live accounts:
`@extra.cf_ip_hash` = `signup_ip_hash`, `@extra.cf_asn` = `signup_asn`,
`@extra.cf_ja3_hash` = `signup_ja3_hash`, plus `cf_ja4`, `cf_bot_score`,
`cf_ipcountry`, `signup_timezone`, `email` and `email_domain` — so a burst found
on the log stream joins straight to CDC rows and to existing case evidence once
they land. Over half of those log lines carry no CF context at all, so gate
the search on `@extra.cf_ip_hash:*` and treat a missing fingerprint as unknown
rather than as a cluster of its own.

The key and funding lines carry the burst's own join keys since
openrouter-web#35700: `API key created`, `Credit purchase initiated`, and the
new success-only `Credit purchase settled` all log `signup_ip_hash`,
`signup_asn`, `email` / `email_domain`, `signup_at`, and
`minutes_since_signup` (see the "Additional log lines (Datadog)" section of
`packages/kyc/sentinel/SCANNER_SPEC.md` for the full field contract). So a
burst found on `Account created` follows onto key mints and funding attempts
on the log stream itself — filter those lines on the burst's
`signup_ip_hash` / `signup_asn` values directly — instead of waiting out the
CDC lag for `stg_users` to join them. Lines logged before that PR deployed
lack the fields; treat missing as unknown.

The log stream only moves the trigger earlier; it does not lower the bar. It
holds no funding, usage, restriction or case state, so the harm gate, the
coverage exclusion and the evidence still come from the query above — never file
off burst counts on the stream alone. Funnel speed is not the discriminator
either: the onboarding flow itself mints an API key, so most real signups
produce one within a minute, and "key fast, funded fast" still leaves hundreds
of ordinary accounts an hour. What separates a ring is a signup-IP-hash burst
with uniform mailboxes (generated names on one or two consumer mail domains) and
a shared TLS fingerprint. Clusters on AS13335 are our own e2e tests and are
excluded throughout the dashboard. `gmail.com` is not excluded — the pager can
name a gmail burst, so gmail rows must stay visible — but same-size gmail
clusters are usually carrier NAT: treat a gmail cluster as a lead only when it
also shares the full IP/ASN/JA3 signature, never off domain concentration
alone.

That sequence is laid out as the reading order of the "Signup Burst Detection
(pre-spend)" Datadog dashboard
(`configs/terraform-monitors/monitoring/signup_burst_detection/dashboard.json`),
whose widgets are pure log queries — no generated log metric, so full
fingerprint cardinality stays available at query time. Work it top to bottom
rather than re-deriving the group-bys. Table 1 ranks signup shape per
`cf_ip_hash` (signups, distinct mail domains, distinct JA3s, distinct ASNs and
countries, mean bot score) with e2e traffic (AS13335) already excluded, and 1b/1c
repeat it per ASN and per JA3 to catch the same ring rotating IPs inside one
network or one TLS client. Table 2 ranks key minting and table 3 funding
attempts per `cf_ip_hash`, so a shortlisted hash is cross-checked in each
through the table search bar. Then set the `ip_hash` (or `asn` / `ja3` /
`email_domain`) template variable to that cluster: the drill-down tables below
resolve it into per-`clerk_user_id` rows, a funnel and the raw log lines, which
is the account list a case is filed against.
The shipped dashboard widgets predate #35700: tables 2 and 3 exclude only
AS13335 and group by the network of the payment/key request rather than the
signup. When the drill-down needs the signup view, query the same lines ad
hoc through the `datadog` MCP grouped by `signup_ip_hash` / `signup_asn`,
scoped to the domain the pager named via `email_domain` (which the lines now
carry) rather than behind a blanket `gmail.com` exclusion — that exclusion
would blind the query to a genuine gmail burst.

Each table ranks its own buckets independently, so a hash near the top of table
1 need not appear in tables 2 and 3 even when it has keys and funding — cross-check
by search, never by expecting one joined row. For the same reason every column
inside one table reads a single log search and sorts on event count: mixing
searches or per-column sorts inside a table returns a different bucket set per
column and renders as misaligned rows with blank cells. Bot score is
Cloudflare's, so **low** is bot-like and 99 is human.

The dashboard is a detection surface only: nothing on it is evidence of funding,
restriction, usage or case state, and it cannot rank on harm at all. Sequence
completion, key minting and funding attempts describe intent and shape; the
`Credit purchase initiated` sum is attempted, not settled. `Credit purchase
settled` is the settled counterpart on the stream — the freshest confirmation
that a burst member's top-up actually landed, with `card_country` and
`card_fingerprint` for cross-member funding-instrument links — but it is
corroboration only: a missing settled line is unknown, not unfunded, and
authoritative funding sums stay in `stg_credits` / raw Stripe. Realized harm
and existing coverage come from the ClickHouse query above and the CLI, and
they — not any ranking on this dashboard or line on the stream — decide
whether a cluster becomes a candidate.

Propose `frontier_us_models` for these targets rather than a ban. The evidence
is burst membership plus the realized behaviour of the burst's siblings, which
is one signal short of the two account-level signals a ban needs, and the
restriction still removes the frontier-model burn path (it covers video
generation too). Say plainly in the case description that the targets have no
own-account usage yet, and carry the burst counts, signup timestamp, ASN, the
sibling outcome counts, and each target's own funded amount as per-target
evidence so the reviewer can weigh it.

Keep funded-but-unspent members in the list. An account that has already taken
its top-up and not yet generated is the highest-value catch in the window, not a
reason to skip it — only realized own credit spend takes an account out, because
past that point the loss has already happened and the post-spend path owns it.
Test own model spend, not the existence of a generation row and not total
`usage`: free-model rows are worth $0, and on a BYOK request `usage` holds only
the OpenRouter BYOK fee, so a cent of fee would drop an account whose balance is
still intact. `openrouter_non_byok_usage` is the credit spent on our own
inference and is the field to threshold on, but it is nullable and some write
paths never set it, so read it through the same legacy fallback the rest of the
codebase uses (`packages/clickhouse/analytics/metric-registry.ts`): a NULL with
no `provider_api_key_id` is own spend worth the row's full `usage`. Summing the
bare column instead makes those accounts read as never having spent.

Hold that exclusion at a de-minimis floor rather than at zero. Ring members
routinely fire a fraction-of-a-cent probe generation right after minting a key,
and a strict `> 0` test reads that probe as realized loss and drops accounts
whose balance is still intact — one sweep lost seven burst siblings to a
$0.00007 probe each. A cent is the line: below it nothing has been lost, above
it the burn has started and the post-spend path owns the account.

Pool credits never appear in `stg_credits`, so an account spending from a credit
pool reads as unbacked and one such sibling would admit its whole signup-IP group
— the existing negative-balance query hits the same trap and drops pool holders
from its population (`packages/clickhouse/negative-balance-usage/queries.ts`).
Do the same here: leave accounts with an active, unexpired, enabled pool out of
both the harm computation and the candidate list.

Two staging-table hazards to keep in mind on the signup side. `stg_users` is CDC,
so a tombstone has to be read after the collapse — filtering `_peerdb_is_deleted`
in `WHERE` keeps the account's earlier live versions, which inflates burst counts
and can propose a restriction on a closed account; the application-level `deleted`
flag needs the same treatment. And `signup_asn` is nullable while `email_domain`
defaults to `''`, and ClickHouse puts every NULL/empty key in one partition, so an
unguarded ASN+domain window would lump all unknown-network signups on a popular
mail domain together and satisfy the second gate on what is really one signal.
Zero that count out instead of trusting it.

The coverage exclusion has to match what is being proposed. Since the proposal
is account-scoped `frontier_us_models`, only an existing `frontier_us_models`,
`inference_block`, `account_ban`, or `author_ban` rows covering all three
frontier authors count as coverage: a ban on one author leaves the other two
open, and any rate limit leaves the path open at a slower pace. Normalize `author_ban` targets before
matching — analytics holds both `anthropic` and `~anthropic` forms, in mixed
case.
Check current case coverage with `list`/`targets` before filing, since
ClickHouse restriction state is a floor (see the read-status section above).

PostHog turns a dormant burst member's own onboarding into a second signal, which
is what these candidates otherwise lack. Read `clickpipe_posthog.events` keyed on
`distinct_id = clerk_user_id` — `analytics.int_posthog_identity_map` is
batch-built and holds nothing for accounts minutes old. A scripted mint shows up
as one event per funnel step and no others: `sign_up_v2`,
`onboarding_account_type_selected`, `onboarding_billing_address_added`,
`onboarding_api_key_created`, `click_credits_purchase`. Key creation and billing
entry on an account that has never generated is account-level evidence, and a
uniform `$browser`/`$os`/`$timezone`/screen-size stack across the burst
corroborates it. Do not reach for `$device_id` as the link: these operators use a
fresh profile per account, so it is unique per account and links nothing —
`sign_up_v2` itself carries no `$device_id` at all, so take the signup device
from `sign_up_success:onboarding_started`.

Two timing caveats keep this as corroboration rather than a trigger. Ingest into
ClickHouse runs about twenty minutes behind, which is longer than the whole
signup-to-burn span on the fast rings, so the funnel is visible only after the
spend on the accounts already generating. And `timestamp` is the browser's own
clock, which on these profiles has read hours ahead of UTC — time-gate on
`created_at` instead.

## Ingest request body

The `post` command accepts a JSON object with:

Top-level fields:

- `source` — non-empty detection agent name.
- `ruleKey` — non-empty rule that fired.
- `description` — non-empty explanation.
- `confidence` — number from 0 to 1.
- `urgency` — required self-reported urgency: `red` (enforcement needed fast),
  `yellow` (needs a human eye), or `green` (nothing to act on). The agent must
  make an explicit judgement call for every ingest.
- `targetType` — `user` or `domain`.
- `targets` — 1–10000 targets per request (at most 5000 distinct users for
  `user` suggestions), with a cumulative maximum of 10000 targets and 5000
  distinct users for each suggestion identified by `source` + `ruleKey` +
  `targetType`.

Each target contains:

- `targetValue` — non-empty Clerk user ID or domain.
- `proposedKind` — `inference_block`, `account_ban`, `provider_ban`,
  `model_ban`, `author_ban`, `frontier_us_models`, `rate_limit`,
  `provider_rate_limit`, `model_rate_limit`, `author_rate_limit`, `spend_cap`,
  or `forced_moderation`. The three scoped rate-limit kinds are accepted and
  enacted as restrictions with the same names.
- **For an account-wide stop, propose `inference_block`, not `account_ban`.**
  `inference_block` is unscoped (omit `proposedTarget`, `{}` params, no
  `proposedExpiresAt`) and cuts every inference request while the user keeps UI,
  billing, and support access. `account_ban` additionally bans the user in
  Clerk, so propose it only when locking the user out of the OpenRouter UI is
  the reason for the case, and say in the description why. Neither kind is
  agent-approvable: a human approves the case, and only `inference_block` may
  then be enacted through the agent path.
- A `spend_cap` is an account-scoped spending limit for one `daily`, `weekly`,
  or `monthly` period.
- Pick the scoped kind, not `rate_limit` plus a target: `rate_limit` is
  account-wide by contract and rejects a non-empty `proposedTarget` with
  `Invalid proposed target for proposedKind=rate_limit`. Throttling one author
  is `author_rate_limit`, not a scoped flavor of `rate_limit`.
- `forced_moderation` proposals are unscoped: omit `proposedTarget`. The active
  restriction is enforced at request time by the moderation plugin for sync
  chat/completions and chat-shaped batch traffic, overriding BYOK and
  `disable_moderation`. Embeddings, image, and video surfaces do not run the
  moderation plugin yet; supporting them is a follow-up.
- Use one account-scoped `frontier_us_models` proposal with no
  `proposedTarget` and `{}` params to ban all US frontier authors
  (`anthropic`, `google`, `openai`) instead of three `author_ban` targets.
- `proposedParams` — parameters for the proposed kind. Account-wide
  `rate_limit` requires positive integer `rpm` and/or `rpd`. The scoped
  rate-limit kinds require `rpm` only (no `rpd`), and by default it must be one
  of the fast-limiter buckets — 1, 4, 16, 64, 256, 1024, 4096 — because the
  Cloudflare limiter is the whole control and an in-between value is rejected
  rather than rounded. Pass `"slow_enforcement": true` to have a
  globally-consistent Redis limiter enforce an exact non-bucket rpm, up to a
  ceiling of 4096. Other kinds use `{}`. A scoped non-bucket rpm without
  `slow_enforcement` returns `Invalid proposed params for
  proposedKind=author_rate_limit`; the inner bucket explanation is not returned
  to the agent. Scoped params are strict, so adding `rpd` is rejected and
  there is no scoped daily cap; add a separate account-wide `rate_limit` if a
  daily cap is also required. `spend_cap` requires a strict object with a
  positive numeric `limit_usd`.
- `proposedTarget` — required for the scoped kinds: `model_ban`,
  `provider_ban`, `author_ban`, `model_rate_limit`, `provider_rate_limit`,
  `author_rate_limit`, and `spend_cap`. Provider kinds take the exact display-cased
  `endpoint.provider_name` value — for example, `OpenAI` or `Google AI Studio` —
  not the lowercase provider slug. A wrong provider target is accepted and can
  be enacted, but silently never matches. Model kinds take the dated
  `endpoint.model.permaslug`, not the model slug; for example, the current seed
  pairs `anthropic/claude-opus-5` with permaslug
  `anthropic/claude-opus-5-20260723` (321 of 929 seeded rows differ). A wrong
  model target likewise silently never matches. Author kinds take an author
  slug. Spend-cap targets must be exactly `daily`, `weekly`, or `monthly`.
  Omit `proposedTarget` for other account-scoped kinds.
- `proposedExpiresAt` — optional ISO-8601 datetime for the restriction window.
  The enacted restriction receives this value as `expires_at`; omit it or use
  `null` for a permanent restriction. This applies to `rate_limit`,
  `provider_rate_limit`, `model_rate_limit`, and `author_rate_limit`.
  Omit it or use `null` for ban, forced-moderation, and frontier-model
  proposals.
- `evidence` — required and non-empty. Every target needs at least 3 evidence
  keys; with one target, all 3 are shared by default. Across multiple targets,
  at least 3 keys must be shared by every target in the report. Each target may
  contain at most 50 keys, and serialized evidence is limited to 32768 bytes.
- `seenAt` — optional ISO datetime.

Cross-field rules:

- Domain targets may use any supported restriction kind except
  `frontier_us_models`, with the domain in `targetValue`, and are stored as
  candidates for review. The retired `domain_block` kind is rejected at ingest;
  domain enactment is deferred to #30819.

For example, an account-wide rate limit that expires at a specific time uses:

```json
{
  "targetValue": "user_...",
  "proposedKind": "rate_limit",
  "proposedParams": { "rpm": 16, "rpd": 50 },
  "proposedExpiresAt": "2026-08-01T12:34:56.789Z",
  "evidence": {
    "signal": "repeated_abuse",
    "requests_last_hour": 1200,
    "account_age_days": 3
  }
}
```

An author-scoped anti-abuse throttle — exactly 10 RPM against `openai` for one
user, leaving every other author untouched — uses:

```json
{
  "targetValue": "user_...",
  "proposedKind": "author_rate_limit",
  "proposedTarget": "openai",
  "proposedParams": { "rpm": 10, "slow_enforcement": true },
  "evidence": {
    "signal": "author_concentration",
    "author_share_24h": 0.98,
    "requests_last_hour": 1200
  }
}
```

Scoped throttles do not apply to BYOK traffic: the endpoint rate-limit check
returns before building either limiter when `endpoint.is_byok` is true. Slow
enforcement is preferred here — not the default — because the exact global
number matters. Without it, a bucket-only value such as `rpm: 4` is a hard
per-colo Cloudflare cap with no Upstash outage path; with it, Redis counts
globally and enforces the exact RPM while Cloudflare becomes a rounded-up
prefilter. Slow enforcement fails open during an Upstash outage, so this
example's `rpm: 10` degrades to roughly 16 requests per colo. The prefilter
does limit ordinary Upstash traffic, but an entity spread over N colos can
still drive roughly `bucket * N` requests per minute into Redis, and the
prefilter exists because Upstash has not kept up with real inference-scale
bursts. Choose the bucket-only fast path when the cap must survive an Upstash
outage and an approximate per-colo ceiling is acceptable.

The `proposedExpiresAt` value is persisted with the candidate target and
re-ingesting the same target key refreshes the expiry; it is not part of the
target's deduplication identity.

Geo comparison is reviewer-side enrichment, not an ingest requirement. Review
the live signup/onboarding country and card issuer-country metrics before
describing a cluster; do not persist those values as mandatory target evidence.

If the cumulative target cap is exceeded, the result is
`target_cap_exceeded` (HTTP 400); file a new report under a different
`ruleKey`. Ingesting into an archived suggestion returns
`suggestion_archived` (HTTP 200) with
`{created:false,targetsUpserted:0,targetsAlreadyRestricted:0}` and does
nothing.

A successful ingest reports `targetsAlreadyRestricted`: rows the upsert left in
`already_restricted` because an existing restriction already satisfies them
(same kind, target, params, and at least the proposed expiry). It is counted
from the upsert's `RETURNING status`, not from the restriction lookup, so rows a
human already `approved`/`denied` are excluded even when a restriction covers
them.

User-target ingest responses may include a `fanout` field. Reposting the same
payload is idempotent, so `fanout.derivedInserted: 0` is expected. An identical
re-POST may still report `derivedInserted > 0` when organization membership has
changed. For a user-target ingest, an absent `fanout` field indicates that
fan-out failed, not that fan-out was inapplicable.
