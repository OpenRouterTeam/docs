# Sentinel fraud-scanner spec (shared source of truth)

> **Status:** Living operating spec for the recurring fraud-scanner runs.
>
> **Audience:** the scheduled Devin automations that scan for abuse and file
> Sentinel ban-candidates — currently **Sleeper Scanner**, **Recent Signups
> Scanner**, **Autobuy Scanner**, and the file-only **Leaked Key Scanner** —
> plus the report-only **Anthropic Concentration Monitor**, which does not feed
> the ban-candidates queue.
>
> This file is the single source of truth for everything those scanners share:
> data access, signal sources, the materiality gate, KYC prioritization, the
> restricted-vs-live split, how to propose and enact candidates, and how to
> report to Slack. Detection watches `anthropic` and `openai`, every threshold
> reading a single author's figure (either author at the bar trips it), never a
> blended sum; the invariants below govern everything else.
>
> Each scanner's automation prompt lives outside this repository and should be
> a thin wrapper that states its own **role, scope, trigger set, and (for
> queue-feeding scanners) reporting window and source key** (see
> [Per-scanner deltas](#per-scanner-deltas)), points the run at the fetch in
> [Reading this file](#reading-this-file), and otherwise defers to this file
> without re-pasting its sections. Everything below is common to all scanners
> unless a per-scanner delta overrides it.
>
> Sibling docs: [SPEC.md](./SPEC.md) describes the Sentinel *enforcement system*
> (tables, review queue, enactment); [MEMORY.md](./MEMORY.md) is its refresh
> protocol and history. This file is about the *detection runs* that feed the
> queue, not the enforcement system itself.

## Invariants — never traded away

Each rule's full form and rationale lives in its owning section below; under any context pressure, these win:

1. **Two independent corroborating signals** on the cluster itself before any enactment; a single shared attribute is a lead, never proof.
2. **Measure a grouping key's global fanout before trusting it**; a shared JA3/JA4 is never a cluster and never one of the two signals.
3. **The compromised-key gate is a hard stop**: when it trips, nothing is approved or enacted.
4. **A denial is terminal**: never re-file, re-upsert, or route around it under any `ruleKey`.
5. **If you're not sure, don't do it**: uncertainty means file, never enact.
6. **The materiality gate holds everywhere**: file only clusters with a shared behavioral pattern between actors, and the pattern is at most one of the two signals. The one exception is the [lone-account review filing](#lone-account-review-filing), which is filed for a human and never enacted.
7. **Read production read-only**: enforcement flows only through the ban-candidates API and its server-side gates.
8. **The frontier block is the only block a scanner proposes on its own** — never `account_ban`; `inference_block` only for a human to approve.
9. **Read case and target state from the CLI, never from ClickHouse.**
10. **No raw emails or other direct PII in Slack.**

## Reading this file

Fetch the spec at the start of every run — not from the session's checkout,
which the session-start pull leaves many commits stale whenever the unrelated
`openresponses` submodule fetch fails. Resolve `main` to a commit once, then
fetch the file at that commit, so the body you read and the revision you
report are the same repository state:

```bash
SPEC_SHA=$(gh api repos/OpenRouterTeam/openrouter-web/commits/main --jq '.sha[:12]') &&
  test -n "$SPEC_SHA" &&
  gh api "repos/OpenRouterTeam/openrouter-web/contents/packages/kyc/sentinel/SCANNER_SPEC.md?ref=$SPEC_SHA" \
    -H "Accept: application/vnd.github.raw" > /tmp/SCANNER_SPEC.md &&
  test -s /tmp/SCANNER_SPEC.md
```

The `test -s` matters: the redirect leaves an empty file when the call fails, and
an empty spec fails the same silent way a stale one does. An
`@packages/kyc/sentinel/SCANNER_SPEC.md` prompt token is NOT a substitute — it
resolves against the session checkout, which is the stale copy this avoids.

Carry `spec@$SPEC_SHA` on the report's **Context** line, so a degraded run can
later be correlated with the spec edit that shipped it. Fetch every other
sentinel file a run reads (the `*.sql` queries, the skill) with the same
`?ref=$SPEC_SHA`, so one stamp names the whole rule set.

Needs `api.github.com` in the automation's net policy. If the call fails, fall
back to the checkout after `git pull --ff-only --no-recurse-submodules` and stamp
`SPEC_SHA=$(git rev-parse --short=12 HEAD)` — content and stamp then both come
from that checked-out commit, and the run is already at least yellow. If
`git rev-list --count HEAD..origin/main` is then still non-zero, the run read a
stale spec: report the count in the **Gap** line and force the status to at
least `:large_yellow_circle:`.

## Frontier block — the remedy scanners propose

What a scanner FILES is one account-scoped `frontier_us_models` restriction,
which cuts all three US frontier authors — `anthropic`, `google`, `openai`
(`FRONTIER_US_MODEL_AUTHORS` in
[`packages/db/restrictions/frontier-authors.ts`](../../db/restrictions/frontier-authors.ts)).
A ban on one frontier author leaves the ring free to pivot and keep burning,
which is why the filed remedy cuts all three. Measurement watches `anthropic`
and `openai`, each thresholded separately: a gate trips when either author's
figure hits its bar, never on a blended cross-author sum. `google` is cut by
the remedy but is not a watched measurement basis.

Neither the frontier block nor a frontier-author `author_ban` reaches a
frontier author's open-weight releases: `BannedPreflightPlugin` in
[`packages/router/plugins/banned.ts`](../../router/plugins/banned.ts) skips
both checks when the model carries a non-empty `hf_slug` (e.g.
`openai/gpt-oss-120b`). The watched basis is therefore the CLOSED-weight
releases of `anthropic` and `openai` only: every measured figure, threshold
and coverage test in this file excludes models whose current
`analytics.stg_models.hf_slug` is non-empty. Open-weight spend on those authors
is reported as other-author spend, never as watched burn, because no remedy a
scanner files would stop it.

The frontier block is the routine remedy, not the strongest one on the shelf;
for the account-wide kinds and who approves them, see
[Propose and enact](#read-only-propose-only).

## ClickHouse connection — mandatory, read first

- Connect ONLY to the ANALYTICS cluster:
  `https://btcztfehge.us-central1.gcp.clickhouse.cloud:8443`.
- NEVER connect to `uvu7u9zrcw.us-central1.gcp.clickhouse.cloud` (the production
  cluster). The session network policy blocks it; any helper script or note
  pointing there is obsolete.
- `CLICKHOUSE_URL` points at the analytics cluster and is valid.
- Rebuild the one and only helper, `~/chq.sh`, to target the analytics URL
  above (auth via `$CLICKHOUSE_READONLY_USER` /
  `$CLICKHOUSE_READONLY_PASSWORD` headers) and use
  `curl --max-time 120`, plus the server settings
  `max_execution_time=120&timeout_overflow_mode=throw` — a client disconnect
  does not cancel a ClickHouse query by itself, so the server ceiling is the
  real one. `~/chq_long.sh` is retired.
- A query that cannot finish within 120 seconds is mis-shaped. Fix the query
  shape; never raise the timeout ceiling. Report every timeout in the report's
  **Gap** line, even when there is no previous target set to reuse, and force
  the status to at least `:large_yellow_circle:` (see [Status
  rubric](#status-rubric-green--yellow--red)). If a timed-out run falls back to
  a previous run's target sets, report that explicitly as well.
- `analytics.stg_*` and `default.generations` are equally fresh on the analytics
  cluster; the `fact_*`/`dim_*` marts are batch-built and can lag them by hours
  (`fact_credit_transactions` has been observed ~14h stale while signups kept
  flowing). Check `max()` on a timestamp column before using a mart intra-day,
  and fall back to the staging/raw tables.
- `data_region` on this warehouse takes three values: `global` (the bulk), `us`,
  and `europe`. These scanners cover non-EU traffic, so every generations query
  excludes EU rows with `data_region != 'europe'`. Do not write
  `data_region = 'global'`: that silently drops the `us` rows (a live 24h count
  on 2026-07-27 was 503,611,839 `global` / 383 `us` / 39,666 `europe`). The one
  exception is the [Leaked Key Scanner](#leaked-key-scanner), which reads all
  three regions — see its section for why and for what it may do with the EU
  rows.

## Generations query shapes — mandatory

`analytics.stg_generations` is a plain view over `default.generations`: 110.4B
rows / 13 TiB, `PARTITION BY toYYYYMM(created_at)`, ordered by
`(clerk_user_id, created_at, generation_id)`. Partitions are the pruning unit:
one calendar month. With no `clerk_user_id` predicate, granules are ordered by
user first, so a time range skips almost nothing. A 1h window costs the same
as 24h within a month; only a `clerk_user_id` predicate gets below a month's
rows. Every example below also carries the `data_region != 'europe'` predicate
from the [ClickHouse connection](#clickhouse-connection--mandatory-read-first)
section. Shape every query to use that layout:

- Put the time window in `WHERE created_at >= ...`. A date predicate inside
  `sumIf`/`countIf` does not prune anything; it aggregates all history. Keep `sumIf` only for the split dimensions (per frontier author vs total). A nested trailing
  1h predicate is legitimate when the outer `WHERE` bounds one 24h scan, so
  live and 24h figures can be computed together:

  ```sql
  SELECT
    sumIf(upstream_inference_prompt_cost
      + upstream_inference_completions_cost,
      created_at >= now() - INTERVAL 1 HOUR) AS live_1h,
    sum(upstream_inference_prompt_cost
      + upstream_inference_completions_cost) AS total_24h
  FROM analytics.stg_generations
  WHERE data_region != 'europe'
    AND created_at >= now() - INTERVAL 24 HOUR;
  ```

  Spend per generation in these scanner examples is upstream COGS:
  `upstream_inference_prompt_cost + upstream_inference_completions_cost`.
  The materiality gate's spend figures use this upstream-COGS basis. The queue's
  `spend_30d` is a different 30d figure: the queue's `total_usage` metric,
  billed usage plus BYOK usage. Name the basis and window for every reported
  figure; never present the queue figure as the gate's spend.

  For example:

  ```sql
  WITH open_weight AS (
    -- Frontier-author releases the remedy does not reach (see Frontier block).
    SELECT permaslug
    FROM analytics.stg_models
    WHERE permaslug LIKE 'anthropic/%' OR permaslug LIKE 'openai/%'
    GROUP BY permaslug
    HAVING argMax(ifNull(hf_slug, ''), _peerdb_version) != ''
  )
  SELECT clerk_user_id,
    sumIf(upstream_inference_prompt_cost + upstream_inference_completions_cost,
      model_permaslug LIKE 'anthropic/%'
        AND model_permaslug NOT IN open_weight) AS anthropic_usd,
    sumIf(upstream_inference_prompt_cost + upstream_inference_completions_cost,
      model_permaslug LIKE 'openai/%'
        AND model_permaslug NOT IN open_weight) AS openai_usd,
    sum(upstream_inference_prompt_cost
      + upstream_inference_completions_cost) AS total_usd
  FROM analytics.stg_generations
  WHERE data_region != 'europe'
    AND created_at >= now() - INTERVAL 24 HOUR
  GROUP BY clerk_user_id;
  ```

- Restrict `clerk_user_id` before aggregating. `WHERE clerk_user_id IN
  (SELECT entity_id FROM ...)` uses the sort-key prefix; aggregating every user
  and then joining a small ID set does not.

  For example:

  ```sql
  SELECT clerk_user_id,
    sum(upstream_inference_prompt_cost
      + upstream_inference_completions_cost)
  FROM analytics.stg_generations
  WHERE data_region != 'europe'
    AND clerk_user_id IN (
      -- Illustrative restricted-ID set: the full current-state collapse
      -- (argMax over _peerdb_version) is the covered CTE in
      -- pre-spend-signup-burst.sql.
      SELECT entity_id
      FROM analytics.stg_restrictions
      WHERE _peerdb_is_deleted = 0
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      GROUP BY entity_id
      HAVING countIf(kind IN
          ('frontier_us_models', 'inference_block', 'account_ban')) > 0
        OR uniqExactIf(
             lower(if(startsWith(target, '~'), substring(target, 2), target)),
             kind = 'author_ban'
               AND has(['anthropic', 'openai'],
                       lower(if(startsWith(target, '~'), substring(target, 2), target)))
           ) = 2
    )
    AND created_at >= now() - INTERVAL 24 HOUR
  GROUP BY clerk_user_id;
  ```

- Never use an unbounded `max(created_at)` for freshness/health. Bound it to
  7 days so the monthly partition pruning applies, and run it once per run,
  not once per query batch. An epoch result (`1970-01-01`) means the bounded
  set is empty and the source is stale; report it as a gap rather than treating
  it as a fresh timestamp.

  For example:

  ```sql
  SELECT max(created_at)
  FROM analytics.stg_generations
  WHERE data_region != 'europe'
    AND created_at >= now() - INTERVAL 7 DAY;
  ```

- After a run, an analysis query that read more than a few billion rows is
  mis-shaped by definition. The documented one-per-run bounded freshness scan
  is the exception above. Treat any other over-budget query as a bug to fix in
  this playbook, not expected cost. Check within the query-log retention window
  (under ~30 minutes on the busy pool):

  ```sql
  SELECT query_duration_ms, read_rows, read_bytes,
    formatReadableSize(read_bytes) AS read_size
  FROM clusterAllReplicas('all_groups.default', system.query_log)
  WHERE event_time >= now() - INTERVAL 30 MINUTE
    AND type = 'QueryFinish'
    AND user = currentUser();
  ```

## Propose and enact — the authority boundary<a id="read-only-propose-only"></a>

Every scanner reads production read-only and derives its findings read-only:
never write to any production table directly, never disable an account, never
refund. Enforcement happens only through the ban-candidates API, which is where
a scanner's authority now extends past filing: a scanner may approve and enact
the restriction kinds the server allows an agent to enact, on cases it filed
itself (authorized by John Krauss, 2026-08-22).

What a scanner may do, all via the
[`sentinel-ban-candidates` CLI](../../../.agents/skills/sentinel-ban-candidates/SKILL.md):

- **File** candidates, as before (see
  [Propose via the ban-candidates API](#propose-via-the-ban-candidates-api)).
- **Approve** a case's targets with `review <suggestionId> approved`, one call
  per case, and **enact** them with `enact --yes`, one call per case. Never loop
  either command per target — each call posts its own Slack notification.
- **Undo** an enactment the run later finds wrong, immediately, and say so in
  the report rather than leaving it for a human to discover. `/undo` reverses
  any enacted restriction, which is what makes this authority recoverable in a
  way a ban never was.

**Prefer an inference block to a full account ban.** A scanner's routine remedy
is still the [frontier block](#frontier-block--the-remedy-scanners-propose);
this rule governs the cases where account-wide enforcement is on the table. When
the remedy needs to be account-wide, the default is `inference_block`: it is account-wide, targetless,
permanent, takes `{}` params, and stops every inference request while leaving the
user able to sign in, read their dashboard, and see what happened.
`account_ban` is only correct when locking the user out of the OpenRouter UI is
itself the goal, and a scanner never decides that on its own: name the reason the
UI lockout is needed and leave it to a human. A filed case whose remedy should
have been account-wide is escalated by changing its targets' proposed kind, not
by a second case — a review-key operation, so name the case link, the target ids,
and the kind on the case.

Neither kind is a scanner's to enact unilaterally. `account_ban` is not
agent-enactable, and the global ban application refuses the agent path outright
(`skipped_agent_caller`), so a scanner that believes an account warrants a full
ban files it and says so in Slack for a human, and does not attempt a workaround.
`inference_block` is agent-enactable but not agent-approvable, so a human
approves the case and the run may then enact the approved targets.

The server enforces the boundary rather than trusting the run, in
[`agent-enact-policy.ts`](../../../services/cfw-internal/src/routes/ban-candidates/agent-enact-policy.ts).
An ingest-key-signed request is agent-gated server-side no matter what the
caller sends. The gate admits only allowlisted restriction kinds
(`provider_ban`, `model_ban`, `author_ban`, `frontier_us_models`, `rate_limit`,
`provider_rate_limit`, `model_rate_limit`, `author_rate_limit`,
`forced_moderation`, `spend_cap`, plus `inference_block`, which the run may enact
only after a human approves it), only `user` targets, and only unprotected PAYG
accounts —
any sales-managed or enterprise signal blocks it, and a failed user or
plan lookup blocks it too, because the gate fails closed. Refused targets come
back as `agent_forbidden_kind` — including domain targets, which the gate refuses
as a non-`user` target before enactment is attempted — or
`agent_protected_account`. Read the per-target outcomes and report them; a
skipped target is not an enacted one.

**The gates are a floor, not the standard.** Everything that governed filing now
also governs enactment, and none of it relaxes because enforcement is faster:

- The [materiality gate](#materiality-gate--only-clusters-with-a-shared-pattern-between-actors)
  holds. A cluster that does not clear it is not enactable.
- At least **two independent corroborating signals** on the cluster itself. A
  single shared attribute — card fingerprint, BIN, IP hash, email domain,
  ASN — is a lead, never proof, and never sufficient to enact. A shared JA3 or
  JA4 is not even a lead: see
  [Signal sources](#signal-sources-clickhouse--infradevice-fingerprints-do-exist)
  for why the keys that look most like rings are the least informative.
- For any card-derived cluster, run the per-fingerprint signup time-span check
  BEFORE enacting: a span over roughly 30 days means a payment-intermediary or
  wallet BIN fronting unrelated legitimate users, not a shared physical card,
  so do not enact on it. A real ring's span is hours to days. See
  [Card and payment-method terminology](#card-and-payment-method-terminology)
  for why a fingerprint is not a cardholder.
- A burst alert is unvalidated detection. It can start a run and shape its
  trigger set, and it never substitutes for any bar above.
- The [compromised-key gate](#compromised-key-gate) runs before every proposal,
  approval, and enactment. When it trips, approval and enactment are barred and
  the targets stay `pending_review`.

These bars are enactment bars, not filing bars, because a shared-attribute
expansion that only a human would have caught is now a change the run makes
itself. Before widening a cluster by any shared attribute, read
[Operational safety](./SPEC.md#operational-safety) and the incident record in
[MEMORY.md](./MEMORY.md).

**If you're not sure, don't do it.** Uncertainty is a reason to file rather than
enact, and it needs no further justification. A cluster you believe is a ring but
cannot fully corroborate, a target whose eligibility you cannot confirm, a signal
you cannot separate from a plausible legitimate explanation, a query that timed
out where the answer would have mattered — each one means file it, say what you
could not establish, and leave the enactment to a human. The asymmetry is the
point: an enactment you skipped costs a few hours of continued abuse on an
account we are already watching, while one you should not have made hits a real
customer who did nothing wrong. Never resolve a close call by enacting because
the run would otherwise end without action.

Anything the gates refuse, and any cluster that fails the bars above, remains a
`pending_review` candidate for a human. That is a normal outcome, not a failed
run — report it plainly.

## Compromised-key gate — a replayed key is not an abusive account<a id="compromised-key-gate"></a>

Run this gate on every cluster before proposing, approving, or enacting, and
before calling any account dormant. When it trips, the account holder is a
victim of a harvested API key rather than the operator behind the traffic, and
an account-scoped restriction breaks a paying customer's working integration
while leaving the operator's other keys untouched.

**Recognition. Any of these on an account argues victim, not operator:**

- the key used in the burst was minted well before the burst
- the account has its own funding history, with no card fingerprint or BIN
  shared across the cohort
- prior traffic from a real origin, SDK, or application
- prior traffic on ordinary models, with the burst model new to the account
- the burst ASN is new to the account while its historical egress is dispersed
- the balance being drained is the account's own
- no key-mint or login event correlates with the burst
- the other accounts in the cohort share only the relay or client fingerprint

**Window discipline.** Never call an account dormant from a trailing window
alone. Re-check LIFETIME funding, traffic, origins, and key-creation dates
before treating a wake as a reactivation, and read anything intra-day from
`stg_`/raw sources rather than `fact_`/`dim_` marts.

**Independence.** Attacker-side client and relay uniformity — user agent, proxy
IP hash, `cf_bot_score`, empty origin, synchronized timing, shared ASN — is ONE
shared attribute however many of its facets are counted, so it can never supply
the second independent account-level signal the
[authority boundary](#read-only-propose-only) requires.

**BYOK exposure.** Rank and report exposure on BYOK inference as well as
OpenRouter `usage`. Relayed BYOK traffic bills the holder's own provider
account, so `usage` alone understates the harm by orders of magnitude and misses
the most exposed victims.

A whole wave of replayed keys is the [Leaked Key
Scanner](#leaked-key-scanner)'s subject rather than an incidental gate trip:
hand the wave to it, and read its section for the provenance measurement that
decides victim from operator.

**Action when the gate trips — a hard stop.** Do not approve and do not enact
any restriction, `frontier_us_models` included. File the case for visibility,
leave every target `pending_review`, and route the account to key revocation,
holder notification, and crediting the negative balance, escalating those to a
human. File the revocation itself as its own case rather than a Slack aside —
one target per compromised key, with `evidence.compromised_at` holding the
proposed moment of theft, on the
[API-key target contract](../../../.agents/skills/sentinel-ban-candidates/SKILL.md#api-key-targets).
Key actions are refused on the agent enact path in every case, so filing is
the whole of the agent's authority here: a human reviews the before/after
split and enacts in Mission Control, and undo does not re-enable a key.

When the evidence shows the account itself was taken over rather than one key
leaked (sign-in from new infrastructure followed by key rotation, email or
payout changes), file a compromised-account case alongside, on the
[compromised-account target contract](../../../.agents/skills/sentinel-ban-candidates/SKILL.md#compromised-account-targets).
Filing is again the whole of the agent's authority: a human enacts in Mission
Control, and undo cannot reverse it — the user clears the state by resetting
their password.

When the gate trips on a target already enacted, escalate the undo in the
same run: name those targets to the human and let them undo through Mission
Control, and never report such a target as handled. Undo revokes the
restriction and leaves the target approved; it does not return it to
`pending_review`.

## Materiality gate — only clusters with a shared pattern between actors

Only FLAG, PROPOSE (file to ban-candidates), ENACT, and report an
account/cluster when this holds on its emergent usage:

1. **Shared pattern between actors:** the cluster's member accounts act in a
   shared, coordinated behavioral pattern — e.g. lockstep funding timing and
   amounts, matching signup-to-spend ramps, a common model mix and request
   cadence, or synchronized top-up spacing. The pattern must be behavioral and
   hold across multiple accounts.

There is no frontier-share and no minimum-spend leg: a ring whose spend is
still ramping (e.g. a signup ring moving onto frontier models in a reseller
pattern) is in scope as soon as its shared pattern is established, so
intervention can happen before the spend grows.

- Establish the pattern on the cluster AGGREGATE (across member accounts) over
  the rolling 24h, from `stg_`/raw generations (`analytics.stg_generations` /
  `default.generations`) and funding events — not per-account, not lifetime.
  Report the cluster's 24h spend and share for each frontier author alongside the pattern as evidence.
- A single shared static attribute — email domain, card fingerprint, BIN, IP
  hash, ASN — is how you FIND a candidate cluster, not the pattern itself. An
  attribute-only cluster with no shared behavior is OUT OF SCOPE this run: do
  not file, do not post it as a finding. A single account has no
  between-actors pattern and is likewise out of scope, except above the
  lone-account review bar below. The gate is paid once
  per ring, so a new signup that matches an already-established ring's
  signup-time signature (two or more of its shared signals, one an
  infrastructure fingerprint) is filed into that ring's case and enacted
  under the normal enactment gates before it funds or sends traffic.
- The gate does not replace corroboration. The shared pattern counts as at
  most one signal toward the two independent corroborating signals required to
  enact. With no share or spend bar, that two-signal standard carries the
  false-positive protection: hold clusters to it strictly, and prefer filing
  over enacting when the spend is still small.
- This is a reporting/proposal gate, NOT a change to detection. Keep detecting
  and clustering sub-gate candidates in your playbook/watchlist (with their current per-author frontier shares and 24h spend) so you surface and file them
  the instant a shared pattern between the actors is established — stay silent
  on them until then.

### Lone-account review filing<a id="lone-account-review-filing"></a>

A single account whose trailing-1h closed-weight spend on ANY one watched author is at or above **$20,000** (`anthropic` OR `openai` at the bar, never their sum) is filed for human review, however coherent its identity, unless the enactment gate would refuse it as `agent_protected_account`: mirror that gate's signal list from `getAutoBanProtectionSignal` in [`auto-ban-protected-account.ts`](../../db/ban-actions/auto-ban-protected-account.ts) exactly, reading `analytics.stg_users` plus `analytics.dim_users.plan_tier_plan`, with an org's flags counting for its members. File the [normal shape](#propose-via-the-ban-candidates-api): one `frontier_us_models` target, a stable `ruleKey`, `urgency` `yellow`, per-author 1h and 24h figures, funding record, and KYC judgment in the evidence. A scanner NEVER approves or enacts a lone-account filing, whatever the other gates say: at this spend the account is as likely a real customer as an abuser, and only a human can tell (John Krauss, 2026-09-17, after a held $50k to $170k/h `openai` account proved a prospect). The bar is back-tested in [#44380](https://github.com/OpenRouterTeam/openrouter-web/pull/44380). The pending target keeps the run yellow, not red ([status rubric](#status-rubric-green--yellow--red)); re-posting the `ruleKey` upserts figures. Below the bar a lone account stays a silent watchlist hold.

## Additional log lines (Datadog)

Beyond the CDC'd ClickHouse tables, these application log lines in Datadog record
signup/payment/key actions (with CF bot score + JA3/JA4 fingerprint + IP hash +
country) that corroborate an awakening you'd otherwise miss. Query Datadog via
the native `datadog` MCP where relevant: `Account created`, `Onboarding
completed`, `API key created`, `Credit purchase initiated`, `Credit purchase
settled`, `Top Up: triggered`, `Payment method added`, `Payment method setup
initiated`, `Coinbase checkout initiated`, `Auto top-up trigger updated`.
Use the subset relevant to the scanner (see per-scanner deltas).

### Why logs, when ClickHouse exists

`stg_users`, `stg_credits`, and `stg_restrictions` run 24-36 minutes behind
Postgres (generations alone is seconds-fresh). The log stream is queryable
seconds after the event, so inside that lag window it is the ONLY view of new
signups, key mints, and funding activity. Use logs to trigger, cluster, and
corroborate early. They hold no usage/spend, no settled-funding totals, no
restriction or ban state, and no case state, so the materiality gate, harm
figures, coverage exclusion, and case dedupe still come from ClickHouse and
the ban-candidates CLI. Logs move a trigger earlier; they never lower a bar.

### Shared fields on the key/funding lines

The `API key created`, `Credit purchase initiated`, `Credit purchase settled`,
`Top Up: triggered` (and `Top Up: triggered via SPT`), `Coinbase checkout
initiated`, and `Auto top-up trigger updated` lines all carry, alongside
`clerk_user_id`:

- `email` and lowercased `email_domain` — apply the benign mail-domain
  exclusions on key/funding lines directly, not only on `Account created`.
- `signup_at` (ISO timestamp), `minutes_since_signup`, `days_since_signup` —
  signup age at event time without a `stg_users` join.
  `minutes_since_signup` is the field to use inside the first 24h, where the
  day figure floors to 0.
- `signup_ip_hash` and `signup_asn` — the SIGNUP fingerprints carried onto
  later events. A burst found at signup joins to fresh key mints and funding
  activity on the log stream itself, with no CDC join and no lag wait.
  On lines that also carry request-time CF fields, compare `signup_ip_hash` /
  `signup_asn` against that line's `cf_ip_hash` / `cf_asn` to see infra
  rotation between signup and action.

Request-time `cf_*` fields (`cf_ip_hash`, `cf_asn`, `cf_ja3_hash`, `cf_ja4`,
`cf_ipcountry`, `cf_bot_score`, `cf_verified_bot`, `cf_corporate_proxy`,
`cf_js_detection`) ride the request-path lines: `API key created`, `Credit
purchase initiated`, `Coinbase checkout initiated`, and `Auto top-up trigger
updated`. The `Top Up: triggered` lines run outside a user request, so they
carry the signup/email fields above but no request-time CF context. `Credit
purchase settled` is emitted from the Stripe webhook, outside the user
request, and carries that same nine-field set as a handoff persisted on the
`Credit purchase initiated` request and replayed at settlement — so filter it
on the same facets, but read the values as the checkout request's, not the
webhook's. When the handoff row is missing or its reference is invalid, all
nine come through null on the settled line.

Lines logged before 2026-08 lack these fields. Treat a missing field as unknown,
never as zero or as a cluster of its own — gate fingerprint searches on field
presence (e.g. `@signup_ip_hash:*`, adjusting for the envelope's actual facet
prefix, which `Account created` lines nest under `@extra.*`).

Historical caveat: Coinbase checkouts between 2026-08-27 10:45Z and 2026-09-08
01:00Z were relayed server-side. On rows in that window matching the relay
fingerprint (`cf_asn` 14618/16509, `cf_bot_score` 1, `cf_js_detection` false,
`cf_ipcountry` US/SG) the `cf_*` values describe the relay, not the customer:
treat them as unknown and never cluster on them. Covers `Coinbase checkout
initiated` lines and the `stg_credits` `cf_*` columns they settled into;
non-matching rows in the window and all Stripe rows keep their normal weight.

### Line-specific notes

- `API key created` covers all three key-creation routes, including the legacy
  `/api/v1/keys` route on `service:cfw-api` used by programmatic and
  provisioning clients (its lines also carry `parent_key_hash`). Scripted key
  minting through the API is part of fingerprint clustering, not a blind spot.
- `Credit purchase initiated` is attempt-time: it includes declined, blocked,
  and abandoned purchases, and is the only funding view with live request
  fingerprints on failures. Never sum it as funding.
- `Credit purchase settled` is success-only, emitted from the Stripe webhook
  after the credit persists: `flow`, `credit_amount`, `payment_intent_id`,
  card signals (`card_country`, `card_fingerprint`, `card_funding`), the nine
  `cf_*` handoff fields described above, plus the shared fields above. It
  is the freshest settled-funding and issuer-geo signal inside the CDC lag
  window. It remains corroborating: authoritative funding sums still come
  from `stg_credits` / raw Stripe, and a settled line's absence is unknown,
  not "unfunded".
- The native `datadog` MCP rejects relative time strings such as `now-7d`;
  pass numeric epoch timestamps for the query range.

## Signal sources (ClickHouse) — infra/device fingerprints DO exist

They live in staging, not in `dim_users`.

- **Separate intra-day from historical.** Emergent/last-24h usage is intra-day —
  read it from `analytics.stg_generations` / `default.generations` (per-request
  usage/spend, timing, `client_ip_hash`, `cf_ja3_hash`), NEVER from `fact_`/
  `dim_` marts (marts batch-build and can silently stall for hours). Historical
  dormancy/baselines are a multi-day lookback where marts are appropriate
  (`analytics.fact_daily_generations_activity`, `analytics.dim_users` rollups) —
  sanity-check `fact_daily_generations_activity` with
  `SELECT max(date) FROM analytics.fact_daily_generations_activity` first and
  fall back to `stg_`/raw if stale. `dim_users` has no time column, so its
  freshness cannot be inferred from a timestamp; verify the source freshness
  separately and use that mart only when the source is known current.
- **Fingerprints:** `analytics.stg_users.signup_ip_hash` (salted hash of the
  signup IP; partial coverage) and `signup_ja3_hash` (JA3 at signup; ~83%
  coverage) — same-origin at signup.
  `analytics.stg_generations.client_ip_hash` + `cf_ja3_hash` — same-origin at
  wake/usage time. Cluster on the IP hashes at both signup and wake time and
  combine them to survive rotation; the JA3 columns are subject to the rule
  below and do not cluster anything on their own.
- **A shared JA3 is never a cluster and never one of the two signals.** JA3
  fingerprints the TLS client stack — browser build, OS, or HTTP library — not
  a person, so it groups by "what software dialed us". Its distribution over
  30 days of signups (1.16M accounts) is bimodal and both halves are useless
  as identity: the top value fronts **77k** accounts, the next two 48k and 20k,
  while the tail is 722k distinct values over 1.16M accounts, i.e. mostly
  near-unique because modern clients randomize the hello (GREASE). That shape
  is the trap. Because the tail is near-unique, a JA3 that several accounts
  *share* is almost by construction one of the mass-market head values, so the
  more accounts a JA3 links, the less it means. Treat
  it as a client-software label: usable to describe a cohort ("all 9 came
  through the same Python HTTP client") once the cluster is already established
  on independent evidence, never to establish or widen one. The same reasoning
  applies to JA4 and to any key whose value space is dominated by a few
  popular values.
- **Measure a grouping key's global fanout before treating its group as a
  cluster.** This generalizes the JA3 rule to every shared attribute, and it is
  the same failure mode as a payment-intermediary card fingerprint. Count the
  accounts platform-wide holding the value
  (`SELECT count() FROM analytics.stg_users ... HAVING <key> = <value>`) and
  discard the key when that count dwarfs the group — a value carries
  information only when holding it is rare. A fingerprint that *rotates*
  per-account inside one tight cohort is a ring signal; a fingerprint shared
  with the rest of the platform is not.
- **ASN origin is available now** (not just an equality hash):
  `analytics.stg_users.signup_asn` (~94% coverage on recent cohorts) and
  `onboarding_cf_asn`; `analytics.stg_generations.asn` / `asn_organization`
  (per-request ASN); `analytics.stg_credits.cf_asn` (payment-time ASN; relay-window Coinbase rows carry the relay's ASN; see the relay note under "Shared fields on
  the key/funding lines").
- **Known limits:** a salted `ip_hash` gives equality only — no subnet/CIDR
  clustering. The country fields below provide no city-level or
  residential-vs-VPN/Tor classification. Use the
  [network-geo vs card-issuer-geo signal](#network-geo-vs-card-issuer-geo) for
  country-level comparison; flag the remaining resolution gaps when infra
  reasoning needs more than exact-match or country. The Datadog CF bot score +
  country are the fallback when ClickHouse signals run out.

## Mail-domain provenance — grouping by relay or domain family

Mailboxes are the one attribute every account has, so mail-side grouping (a
shared MX relay, a domain family, a catch-all domain) is easy to reach for and
easy to over-read. It is a shared attribute like any other: subject to the
fanout rule above, and never one of the two signals on its own. Mail relays
exist to front unrelated customers' domains, so a relay group is a lead until the
commercial-host explanation is excluded.

- **Exclude the benign host explanation before filing on a relay.** Resolve
  every domain in the family and ask whether the operator could be a *customer*
  of that relay or must be its *owner*. Free dynamic-DNS third-level names,
  vendor typosquats, and organisation-shaped names whose mail sits on a pool
  hostname the operator cannot own are operator-minted; a family containing them
  is infrastructure, not a customer base. Absent that, the relay stays a lead and
  the case says so.
- **Mailbox shape is enrichment, not a signal.** Generated-looking local parts
  are ~10% of all live accounts platform-wide, and fast key minting after signup
  is what onboarding does. What carries information is one template across a
  whole family, name stems reused across supposedly unrelated domains in it
  (measured against a size-matched set of unrelated domains), and signup minutes
  containing several of the family's domains at once.
- **Co-tenant enforcement history is family-level, not account-level.** Prior
  *behavioural* restrictions on a domain family establish that the family has
  caused realized harm; they say nothing about a specific dormant account, and
  restrictions filed by earlier infrastructure sweeps on the same family are
  circular. Partition the targets by which of them carry their own second signal
  and enact only that partition, leaving the rest `pending_review`.
- **Report what the filing gates hid.** Re-run the family without the rule's own
  dormancy/engagement gates and report the unfiled siblings — including the
  active ones the dormancy gate excluded by construction — and apply the same
  heuristics platform-wide to state their specificity. A heuristic that returns
  tens of thousands of unrestricted accounts is not filable, and reporting that
  is the finding.
- **The remedy for an operator-owned family is registration-side, and it is the
  preferred one.** Once a domain is established as operator-owned (no unrelated
  users on it), file the domain-target case first and treat it as the primary
  remedy: domain enactment fans out to the domain's existing accounts and the
  signup webhook applies the same restriction to every later signup on that
  domain, which per-account cases never do. Only a domain `account_ban` adds
  the Clerk blocklist identifier and refuses registration outright; other kinds
  let the account register already restricted. When the operator mints
  accounts across subdomains of one apex (`a1b2.example.com`,
  `x9y8.example.com`, a fresh label per signup), file one wildcard target,
  `*.example.com`, not one literal domain per subdomain: the wildcard covers
  the apex and every descendant label, while a literal domain matches only
  itself and misses the next label minted. Domain targets are propose-only
  for the run (the agent gate refuses non-`user` targets and `inference_block`),
  so a human approves and enacts them. Add an account-scoped case only for
  members whose own evidence is needed on the record or who sit outside the
  domain; do not re-file the same domain's accounts wave after wave.

Procedure, DNS-over-HTTPS resolution (`dig` is not installed), and the control
queries are in
[`mail-relay-ring-adjudication`](../../../.agents/skills/mail-relay-ring-adjudication/SKILL.md).

## Network geo vs card-issuer geo

These are distinct concepts answering different questions:

- **Network geo:** where the request came from. Signup and onboarding context
  live on Postgres `public.users` (`signup_country`, `onboarding_cf_country`),
  which the reviewer enrichment reads live — not the analytics mirror.
  Payment-time network country is Postgres `public.credits.cf_ipcountry`
  (mirrored as `analytics.stg_credits.cf_ipcountry`); relay-window Coinbase rows carry the relay's country; see the relay note under "Shared fields on the
  key/funding lines".
- **Issuer geo:** where a funding card was issued. The existing reviewer
  metrics join reads the card country from the same succeeded-charge set as
  BINs, as an unordered set over every succeeded charge — it is not tied to any
  one charge. For a specific payment moment use
  `public.credits.card_country` (mirrored as
  `analytics.stg_credits.card_country`), which sits on the same row as that
  payment's `cf_ipcountry`.
- **Declared billing geo:** what the customer entered, not where the card was
  issued. Use it only when the case turns on that distinction; it has no live
  reviewer read, so query it directly from
  `analytics.stg_stripe_charges.billing_detail_address_country`,
  `analytics.stg_stripe_payment_methods.billing_detail_address_country`, or
  `analytics.stg_stripe_customers.billing_country`.

Geo is read at reviewer view time from the existing enrichment and metrics payloads; scanner filing does not persist geo in target evidence.

The network snapshot must match the scanner moment — each delta's geo-evidence bullet names the moment and its columns. Note that the issuer country shown in the reviewer panel spans all succeeded charges rather than the one under adjudication. A mismatch is corroborating only and
can never justify a filing on its own. Among accounts with both sides
populated, roughly 28–31% already differ, so the useful shape is cluster-level:
one issuer country across many unrelated network countries (or the reverse),
especially when stacked with shared-fingerprint linkage. Missing
network data is unknown rather than clean.

Do not cite nonexistent fields: `payment_method_details_card_country`,
`charge.card_country`, `card.bin`, `card.first6`, `_fivetran_deleted`, and
`payment_method_card.country` do not exist.

## Memory (why this is an agent, not a cron)

- Keep your OWN playbook, separate from the other scanners (cross-reference their
  findings, but maintain your own notes). Start each run by loading it: current
  signals + rationale, baselines for what normal looks like, and open hypotheses.
- Treat everything you know as hypotheses, not ground truth. Abuse tactics adapt;
  expect dominant patterns to decay and new ones to appear.
- End each run by writing an updated playbook: promote confirmed signals, retire ones that stopped predicting, adjust baselines, and record open hypotheses with the evidence needed to confirm them. Retiring a query that produces a scanner's trigger set is a playbook decision: write the query name and the reason in the handoff, so the next run inherits the decision and not just the shorter list.

## Window — separate the trigger set from the evidence

- **Trigger set:** the scanner-specific set of accounts/events to adjudicate this
  run (see per-scanner deltas). This is only WHICH accounts to look at, not the
  data you reason over.
- **Evidence:** for each triggered account and the attributes it shares
  (email/domain shape, enrichment, IP/JA3/ASN at signup and at wake time, device,
  geo, name patterns, account age, credit history, usage curve), look back as far
  as the question requires. A lone account is almost never actionable; a CLUSTER
  sharing attributes is the signal, and that only appears with a long lookback
  and cross-account clustering.
- **Baselines:** compare the cohort against rolling history to separate genuine
  coordinated abuse from normal behavior (a real customer resuming, a team
  onboarding, a marketing spike). Rings stagger activity — look for shared
  entities across the cohort, not just a single simultaneous burst. Use only
  signals available at the time you flag; never use a later outcome as an input.

## Dig in — resolve the obvious next questions before reporting

Anticipate a reviewer's questions and answer them in the same run: trace and quantify the full cluster behind any suspicious shared attribute (accounts, usage, spend at risk), and say so when something reduces suspicion (enrichment-confirmed coherent identity, organic prior engagement, a plausible dormancy story, distinct unshared infrastructure). Prefer resolving a question to escalating it; stop only at a clear dead end or a genuine human judgment call, then state what you found, what's blocking, and the decision needed.

## Frontier usage + KYC-based prioritization

- For every account/cluster flagged, measure EACH watched frontier author's
  share of its usage (author slugs `anthropic`, `openai`) and how fast each is
  ramping. Read the author per generation from `analytics.stg_generations` /
  `default.generations` and compute each author's share against the account's
  own total usage, as a proportion — never blended into one frontier share, and
  not a one-off presence check. Frontier capacity is the most expensive and
  most abused, so concentration there is disproportionately costly.
- Form an explicit judgment of whether each flagged account/cluster is likely to
  clear KYC / identity review, from signals you already gather: synthetic or
  generated identities, disposable/gibberish emails and domains, absent or
  incoherent enrichment, shared ring infrastructure and fingerprints, and bot-like
  funding and behavior. The less credible the identity, the lower the odds it
  clears KYC.
- When a flagged account shows a high rate of usage on ANY single frontier
  author AND looks unlikely
  to clear KYC, propose a
  [frontier block](#frontier-block--the-remedy-scanners-propose) — **the ONLY
  block a scanner proposes**, on the filing shape in
  [Propose via the ban-candidates API](#propose-via-the-ban-candidates-api).
  Rank these highest and attach the per-author frontier-usage evidence (share + trend) and KYC rationale to every proposal.
- A clean identity that will clearly clear KYC is a reason to hold, unless the account is above the [lone-account review bar](#lone-account-review-filing), which is filed for a human either way and never enacted.
- New accounts may have little usage yet; when usage is negligible the per-author shares are not yet meaningful, so lean on the KYC judgment and act on single-author frontier concentration as it emerges.

## Restricted vs live — split every reported/filed frontier-spend figure

Every frontier-spend figure you report or file (each per-ring figure and the
aggregate) MUST be split by whether the account that generated it is ALREADY
restricted at report time:

- **Per author, never blended:** every frontier figure here is computed per
  watched author (`anthropic`, `openai`), and every threshold reads a single
  author's figure — `anthropic` at the bar OR `openai` at the bar. A
  cross-author total may be reported as context, never used as a gate input.

- An account is **RESTRICTED** if, right now, it is banned/disabled OR it carries
  an enforced `inference_block` or `frontier_us_models` restriction, or
  author-level bans/restrictions covering BOTH watched authors (`anthropic`
  AND `openai`) — any of which already cuts its watched-frontier access, since
  the watched basis is closed-weight only and the open-weight exemption applies
  to the frontier block and the author bans alike. An
  author ban on only one of them leaves the other burning and does NOT count
  as restricted. Read this
  CURRENT enforcement state from `analytics.*` (the CDC'd Postgres user / ban /
  restriction tables). If a source is unavailable, say so rather than guess.
- **`analytics.*` lags, so it can only add restrictions, never rule them out.**
  The CDC replica lag can exceed a scanner run, so a restriction enacted while
  you were working, or a case you filed this run, may be missing from
  `stg_restrictions` / `stg_ban_candidate_*`. For any account that appears in a
  Sentinel case, take its state from `targets <suggestionId>` and not from
  ClickHouse; treat an `analytics.*` miss as unknown rather than as "not
  restricted", and never report a rule as un-enacted on that basis.
- This is the CURRENTLY-APPLIED enforcement state, NOT the block you are
  proposing this run: a candidate filed but not yet actioned by a human is still
  LIVE.
- **Never assert an enforcement state from list-level counts.** Run `targets
  <suggestionId>` and quote that target's `status`, `restrictionId`, and
  `currentRestrictionStatus`. Two states are gaps: `approved` + null
  `restrictionId` (approved, not enacted), and an enforced restriction still
  generating spend. A `pending_review` target with no restriction is
  adjudication latency, not a gap. An archived case is closed: its targets are
  ignored whatever their `status` says. Archiving leaves target rows at
  `pending_review`, so every pending or approved sweep must `INNER JOIN`
  `stg_ban_candidate_suggestions FINAL` on `suggestion_id = id` with
  `archived_at IS NULL` before it reads target `status`. The lag rule above
  still applies: confirm a sweep hit with `targets <suggestionId>` before it
  pages.
- **restricted $** = the 24h frontier spend summed over the accounts (in that
  ring / aggregate) that are restricted right now.
- **live $ ("still burning")** = per-author frontier spend in the TRAILING 1 HOUR ONLY,
  summed over the accounts that are NOT restricted right now. "Still burning" is
  gated EXCLUSIVELY on the last hour — it is NOT the 24h remainder. A ring/account whose every frontier author's last-1h live $ is ~$0 is treated as extinguished / already-cut this run
  even if its 24h total is large; do not describe it as "still burning" or "live".
- ALSO compute, for the SAME currently-unrestricted accounts, their
  **non-frontier (other-author) spend in the trailing 1 hour**. "Still burning"
  itself stays frontier-only, but a ring with significant last-1h non-frontier
  live spend is worth calling out — e.g. a frontier-restricted ring that pivoted
  to other authors is still burning elsewhere. Surface it alongside the frontier
  live figure with the top author(s) it moved to.
- LEAD with the highest single-author frontier live $, author named, everywhere — it is the decision-driver; the
  presentation rules (bolding, ordering, when to carry the other-author live $)
  live in [Output](#output--post-to-slack).

## Propose via the ban-candidates API

Submit each candidate you'd propose to the Sentinel ban-candidates ingest. Every
candidate lands as `pending_review`; whether this run then carries it through to
enactment is governed by
[Propose and enact](#read-only-propose-only).

**Use the `sentinel-ban-candidates` skill / CLI** — it builds and signs the
requests, handles auth and the correct host once you have an Infisical session,
and documents the full ingest body schema and constraints. Don't hand-roll HMAC.
Read the [Sentinel skill](../../../.agents/skills/sentinel-ban-candidates/SKILL.md)
and authenticate as described in its Authentication block before running these
commands:

```bash
bun run sentinel:ban-candidates list                      # dedup against full queue
bun run sentinel:ban-candidates targets <suggestionId>
echo '{...ingest body...}' | bun run sentinel:ban-candidates post -
```

Scanner-specific rules on top of the skill's schema:

- **File only the account-scoped `frontier_us_models` block** from the [KYC
  section](#frontier-usage--kyc-based-prioritization) — one target per user, no
  `proposedTarget`, `{}` params (the ingest schema rejects a non-empty
  `proposedTarget` on
  an unscoped kind) — never an `account_ban`.
  A case that genuinely needs account-wide enforcement is filed as an
  `inference_block` for a human to approve, per
  [Propose and enact](#read-only-propose-only). The other exception is the
  operator-owned mail-domain case from
  [Mail-domain provenance](#mail-domain-provenance--grouping-by-relay-or-domain-family):
  `targetType: "domain"`, one target per domain or per `*.<apex>` wildcard,
  `proposedKind: "inference_block"` with `{}` params (`frontier_us_models`
  rejects domain targets), for a human to approve.
- **`ruleKey` naming:** use one stable key for each ring or pattern across runs,
  with no run number, timestamp, or per-wave suffix. Name the durable pattern
  the key identifies and not the remedy proposed for it, such as
  `autobuy_bin450306_sg_debit_datacenter`; later runs and re-mint variants of the
  same ring re-post that key and upsert newly found members into it. The remedy
  is a property of the targets and can change on a live case, so a key that
  names one goes stale the moment the proposal does. A different remedy for
  accounts that are already pending targets of a live case is therefore a change
  to that case, not a new key: report the case link, the target ids, and the kind
  that fits, and leave the proposed-kind change to a human, per
  [Changing the proposed kind](../../../.agents/skills/sentinel-ban-candidates/SKILL.md#changing-the-proposed-kind-not-filing-a-second-case).
  Keys already in the queue that name a remedy (`*_frontier_block`,
  `*_anthropic_block_*`) keep their names, read from that run's case link or
  report thread — renaming one forks the deduplication namespace and files a
  duplicate case. Archived cases are absent from `list` and ingest is not a
  lookup — posting a key that has no case files one — so a bare key is only
  for a ring with no prior filing at all. An account whose case a human
  denied stays off-limits for posting under every `ruleKey`; the documented
  materially-new-evidence re-open report path below is the only
  recourse.<a id="archived-stable-key"></a>
- **Archived stable key:** an archived case remains in the deduplication
  namespace. Its archived-key response returns HTTP 200 with `suggestionId`,
  `created: false`, `targetsUpserted: 0`, `targetsAlreadyRestricted: 0`, and
  `slack: null`; because archived cases are absent from `list`, this response
  is the only way to obtain the archived case id. Zero `targetsUpserted` is
  the archived discriminator, because the request requires at least one target
  and a live post reports at least one posted target key even when it re-upserts.
  Treat it as a no-op rather than a landed post. An archived case is closed: a
  human took it out of the queue, so file nothing, do not ask to unarchive it,
  and do not report it as a gap. Mention it once under **Context** with the
  returned case id and move on.
- **Legacy run-key transition:** if a ring has one or more run-suffixed legacy
  cases in the list output, read each candidate's targets and skip cases whose
  targets are all denied, then choose the earliest-created remaining case.
  Re-post new members to that existing key rather than creating a new stable
  key or another case, and link sibling cases in the Slack report. If every
  legacy case is all-denied, do not re-file the ring. A legacy canonical case
  leaves the list when it is adjudicated and archived at the end of its normal
  life; that archived case still holds the ring in the deduplication namespace, so
  the next detection follows [Archived stable key](#archived-stable-key) rather
  than minting a bare key. This is the single tolerated run-suffix exception.
- **Dedup:** a suggestion is identified by `source` + `ruleKey` + `targetType`;
  re-posting the same triple upserts targets, each deduped by `targetValue`.
  Use the unfiltered `list` first to dedup against the full queue, including
  adjudicated cases; archived cases are not discoverable there, so their ingest
  response reveals them — follow the [archived-key response](#archived-stable-key).
  <a id="denied-only-run"></a>
  Post the members observed in this run's window that are not already denied in
  the per-case targets read, including members already on the case rather than
  only newly discovered ones. This covers denials within the case being posted;
  a denial under another case is found by target value on
  `stg_ban_candidate_targets FINAL` (`status = 'denied'` and
  `_peerdb_is_deleted = 0`). Never pad with unobserved members, so `times_seen` remains a
  recurrence count rather than a run counter. If this leaves no targets because
  this run observed only denied members, file nothing and report in the thread
  on each new-in-run case alert for this run, or in the standalone run-summary
  thread when no such alert exists, that only denied members were observed and
  no new non-denied target was filed, and do not call the case open or UPDATED.
  Run status and re-open handling belong to the two bullets below.
- **Human rejection is terminal for every scanner:** a case whose targets are
  all denied is a human decision that the pattern is not abuse: do not re-post
  or upsert it, report it as open or UPDATED in Slack, or file the same
  account under a fresh `ruleKey` to route around the denial.
  Subsequent runs find the denial by target value on
  `stg_ban_candidate_targets FINAL` (`_peerdb_is_deleted = 0`) and skip it at
  detection time. That lookup is per target value: widening a denial to an
  org or cluster is planned follow-up work behind the API. The only path back is the
  [materially-new-evidence re-open](#materially-new-evidence-re-open) report
  path.
  A denied case or suppressed ring's spend belongs with **spend we are
  knowingly holding** in the [Status rubric](#status-rubric-green--yellow--red),
  so it does not by itself make a run yellow or red.
- **Materially new-evidence re-open:** <a id="materially-new-evidence-re-open"></a>
  A denial is final through every scanner and reviewer surface, so the
  scanner's only recourse is to report a candidate re-open in the run thread,
  naming the prior denial and the pattern it did not consider. Renewed burn
  alone is never sufficient to justify raising a re-open; burn may corroborate
  that pattern but cannot establish it. Lifting the denial requires an operator
  to act directly on the row, outside both the review path and the scanner.
  If the denial is ever lifted, the member is an ordinary non-denied member again and the
  normal rule posts it under the ring's existing stable key. Never post the
  target while its status is `denied`.

- Put the dollar figure inside the `evidence` object (e.g. per-author keys: `anthropic_usd_24h`, `openai_usd_24h`), not a top-level field — the ingest schema has no dedicated spend field and
  strips the retired `usdExposure`. Each target's evidence must also carry an
  at-filing snapshot captured on first filing and resent verbatim on later posts
  alongside current figures. The exception is a figure originally filed under a
  retired key: recompute it under the replacement key (retired keys are
  rejected), carrying it forward only when recomputed over the original
  window. Upsert replaces the
  whole evidence blob, so omitted keys are lost. In Slack/output text label it "frontier spend", never "exposure" — see [Terminology](#terminology). For card-derived count keys,
  follow
  [Card and payment-method terminology](#card-and-payment-method-terminology).
- Map the [status rubric](#status-rubric-green--yellow--red) onto the required
  ingest `urgency` field on every ingest: `red` means enforcement is needed
  fast, `yellow` means a human eye is needed, and `green` means there is nothing
  to act on. The agent sets this field in the ingest body and makes an explicit
  judgment call for every finding.
  Re-ingesting an existing case overwrites its description, confidence, and
  urgency. Describe the whole accumulated
  [non-denied set](#non-denied-targets) and set confidence and urgency from that
  set and its findings, not just the new batch. If the case was red and the new
  batch alone would be yellow, keep sending red unless the overall case has
  genuinely de-escalated.
- Use the live reviewer-side geo reads described in
  [Network geo vs card-issuer geo](#network-geo-vs-card-issuer-geo) when
  explaining a case. Geo remains corroborating context, not filing evidence.
  A `description` should carry the cluster-level geo *shape* — "one issuer
  country against 7 unrelated signup countries across 12 targets" — which is
  what the case turns on, rather than a list of per-account country values.
- **Case sizing:** <a id="case-sizing"></a> file up to 3000 distinct users and
  up to 9000 restriction targets in a single case (`source` + `ruleKey` +
  `targetType`) before splitting a ring across cases. Check every ring in the
  unfiltered list before posting. An archived-key response is also an
  existing-case signal and the only way an archived case appears. When that
  existence check finds a case, run `targets <suggestionId>` once before
  posting. Use that one read for the accumulated size budget, the
  new-versus-total target diff, the legacy sibling check, the denied-target
  exclusion or documented re-open check, and other case-state checks as needed.
  The size budget counts every target, including denied ones. Compute the
  distinct-user half from its target values because the list row has no user
  count. Treat a ring as a first filing only when the existence check is empty.
  It has no prior targets, so its accumulated budget starts at zero and every
  posted target is new. The hard ingest caps are higher (5000 distinct users /
  10000 targets per suggestion — see the skill), but stay at 3000/9000 to leave
  headroom for later upserts into the same case.
  Shard one is the bare stable key; later shards use `<stable_key>_part_2`,
  `<stable_key>_part_3`, and so on, with stable partitions and sibling links.
  Never split by run or wave. A 400 `user_cap_exceeded` or `target_cap_exceeded`
  response triggers the next deterministic shard key, not a run or wave suffix.

## Output — post to Slack

**The report is images.** Every finding is drawn as PNG charts, each with a one-line caption. Prose is limited to the one-line top-level post, the **Context**, **Gap**, **Also tracked**, and **Gates** lines, and the captions. Never describe a case, a cohort, or a watchlist item in a prose block. If you are about to write a paragraph about accounts, draw the chart instead. No raw account emails or other direct PII anywhere: not on the top-level line, not in a thread reply, not inside a chart. Use Sentinel links and user ids. Cohort attributes (first-6 BIN, issuer country, funding type, email TLD/domain) are allowed. Names, full card numbers, and addresses are not.

### Top-level post

- **Transport:** ingest owns the per-case alert and case link. Do not post a separate top-level alert or case link from the agent. When ingest returns a non-null `{channel, ts}`, thread the run's findings onto that message. Review decisions are posted as thread replies with the reviewer note. When a case has a stored Slack thread reference, the server threads enactment summaries onto the case alert without repeating the reviewer note. A case with no stored thread reference gets no enactment message.
- A case alert is new-in-run when its `{channel, ts}` is non-null and the Slack `ts` (epoch seconds) is at or after this run's start moment. Post a standalone top-level line unless a new-in-run case alert exists in the channel the run's status routes to and has urgency at least as high as the run's status under the server mapping (green to the runs channel, yellow and red to the alerts channel). For a yellow run filing a yellow case, that alert is in the alerts channel, where the status routes, so no standalone line goes to the runs channel. When that alert exists, the case alerts are the run's top-level messages. Still thread the run's findings onto every non-null case alert. Never drop findings or invent a synthetic case link. A required standalone line may share a channel with a case alert whose urgency is below the run's status.
- Never use `slack-remote` (it appends a "Sent using @Devin" block that spawns a recursive Devin session).
- **One status emoji per run** (see [Status rubric](#status-rubric-green--yellow--red)). When a case is filed, the value is the ingest `urgency`. On a standalone line it is the ONLY emoji and it drives channel routing.
- **Standalone line = ONE line, verdict first, scannable in two seconds:**

  ```text
  <status emoji> <Scanner> <run/UTC> — <verdict in <=6 words> — <the one number that matters> · detail in thread
  ```

  Bold at most ONE number: the STILL-LIVE (last-1h) $ of the single highest-burning frontier author, author named. Append the 24h total unbolded, e.g. `*$Y* anthropic live last 1h · $X 24h frontier total`. No hype adjectives, no :rotating_light: or :warning:, no bullets, no mentions. If nothing cleared the gate, the line says so and still opens the thread. Do not manufacture patterns. If a query timed out, the verdict says `query timeout`.

### Status rubric (green / yellow / red)

The status reflects **what action the run needs**, not whether a tracked account is spending.

- `:red_circle:` — **enforcement needed fast.** A new account or cluster meeting the materiality gate, a new frontier block to file, or an enforcement gap. A gap is a target in `approved` status with `restriction_id IS NULL`, or a target in `pending_review`, whose run-computed live $ for ANY SINGLE frontier author (trailing-1h) is above $50 (`anthropic` at $50 OR `openai` at $50, never their sum), or, for a pivoted ring, whose non-frontier trailing-1h aggregate is above $50. Not a gap: a target skipped as `frontier_us_models_exempt`, a `pending_review` target of a [lone-account review filing](#lone-account-review-filing) whose case is still in the queue (it waits on a human by design and stays yellow at any live $), or any target whose case is archived (`archived_at IS NOT NULL` on `stg_ban_candidate_suggestions`; archiving does not rewrite target rows, so join the case and drop archived ones before reading target status). Page red on the first run that observes a gap. Dedup is per `ruleKey` across every scanner: the comparison figure is the most recent red gap post for that key in `conversations.history` on `C0BJ51BK7P0`. Re-page only when the applicable run-computed amount exceeds the figure last reported red, or when the gap has persisted 8h or more since the last red post. An already-paged unchanged gap is at least yellow, never green: carry it on the **Context** line. The **Gap** line is for degradation and staleness only.
- `:large_yellow_circle:` — **needs a human eye, but enforcement is not clearly warranted yet.** A genuinely ambiguous item that requires human judgment this run, not a settled watchlist entry. A candidate re-open is yellow when it is the run's only finding.
- `:large_green_circle:` — **nothing to act on.** No new gated candidates, nothing pending, no open gap. Spend we are knowingly holding (a coherent lone account below the [review bar](#lone-account-review-filing), a sub-gate stockpile on the watchlist) does not make a run yellow. Chart it in the thread if it changed, but the run is green.

A run that fell back to a stale checkout for the spec ([Reading this file](#reading-this-file)) or hit the query timeout ceiling ([ClickHouse connection](#clickhouse-connection--mandatory-read-first)) is at least yellow, whatever its findings.

- **Route a standalone summary to EXACTLY ONE channel, keyed on the emoji:**
  - `:red_circle:` → `C0BJ51BK7P0` (#alerts-tns).
  - `:large_yellow_circle:` or `:large_green_circle:` → `C0BL5TQG45C` (#tns-scanner-runs), a machine log skimmed daily, not watched. Anything needing timely human action must be red. Never post run reports to `C0BAUNXTXHR` (#brain-talos).
  - If posting to `C0BL5TQG45C` fails (e.g. `not_in_channel`), post to `C0BJ51BK7P0` instead, force at least `:large_yellow_circle:`, and state the delivery failure on the top-level line.
  - Never post the same run to both channels.
### Thread order

Post replies on the run's `thread_ts` in this order. Rank by what a human still has to decide: enforcement-state gaps outrank watchlist and unchanged-cohort items.

1. **Case blocks**, one per NEW or UPDATED case (new candidate, changed target set, changed frontier spend, or newly crossed threshold): one text line plus its charts.
2. **Watchlist charts**: one chart per tracked cluster or account whose numbers changed this run (new members, new funding, new spend, a refund, a chargeback). An unchanged item gets one line under **Also tracked**, never a chart and never a paragraph.
3. **Context** line (every run, including green runs with no case).
4. **Gap** line, only when execution degraded.
5. **Also tracked** tail, only when something is genuinely still open.
6. **Gates** line (every run).

A run with no case block and no changed watchlist item posts no chart. It still posts **Context** and **Gates**, plus **Gap** when execution degraded and **Also tracked** when something remains open.

When a run threads its findings onto ingest case alerts instead of a standalone summary, repeat **Context** (and **Gap** / **Also tracked** when present) plus **Gates** at the end of EVERY case thread, so each thread is self-contained.

<a id="case-block-count-format"></a>
**Case block text line.** Bold `NEW` or `UPDATED`, then `<new_members>` new / `<total>` total non-denied targets when new members exist (optionally a short status annotation, or a verdict alone when none do), the Slack case link `<https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates/<suggestionId>|Open Sentinel case>`, and the `ruleKey` in backticks. Derive `new_members` by diffing the posted set against targets read before posting, not from `targetsUpserted`. When `<new_members>` is below `<total>`, identify the new members in the timeline chart or its caption. If denied targets exist, append their count. Do not list them. Use a `q=` ring queue link only when showing all sibling cases, and say it matches `ruleKey` by substring. Archived queries use `state=archived`. Summarize unchanged re-files in one line ("N clusters unchanged, re-filed as upserts").

**Charts per case block.**

- **Chart 1, mandatory: lifecycle timeline.** One row per wave or cluster (per account when the case has five or fewer new members) on a shared UTC x axis. Mark signup, funding settle, first request, and the enactment moment. Draw the span from first request to enactment as a filled bar labeled with the pre-block spend and its duration in minutes. Label a wave with no pre-block traffic `$0` and the minutes from signup to block. For a case that is not enacted, draw a hollow `not enacted` marker at the run's observation time and label the open span `open <n> min · $<spend>`. Omit any mark whose event has not happened. Draw only observed events.
- **Chart 2, mandatory: money split.** Grouped bars per case: live $ (last 1h) per burning frontier author, frontier $/24h (or the scanner's reporting window), and restricted $. Show `restricted $0` as a zero-height bar with a `$0` label. Add other-author live $ as its own bar when significant.
- **Chart 3, optional: cadence or cohort shape.** Use it when the finding is a pattern over time or over a cohort: inter-wave gap in minutes, signups per bucket, payer-conversion rate versus the age-matched baseline with both denominators, or a cluster-level geo shape. A per-account mismatch or a coverage statistic never earns a chart.

A watchlist chart uses whichever of the three shapes carries the change (a refund or new load goes on the lifecycle timeline, a signup burst on chart 3).

**Caption.** One line of at most 25 words per image, in Slack mrkdwn: what the chart shows, the one number that drives the decision, and the data sources (query names, Datadog lines). No separate source line.

**Rendering.** Build each chart as an SVG from the run's own numbers and render it to PNG. `matplotlib` is not available on scanner machines. Write the SVG directly and render with headless Chrome: `google-chrome --headless=new --no-sandbox --hide-scrollbars --window-size=<w>,<h+150> --screenshot=<out>.png file://<chart>.html`, where the HTML wraps the SVG with a white body and zero margin. Oversize the window height so the bottom legend is not clipped, and size the SVG to its content. Attach the PNG with the native `slack` tool `file_path` argument on the same `post_message` that carries the caption. Keep the SVG and the render script in the run directory of the playbook and reuse them on the next run. Follow `.agents/skills/viz/SKILL.md` for series colors and chrome, with fixed roles: signup, funding, and enactment marks each keep one color across every chart and every run; pre-block spend is the status color for bad; `$0` pre-block is the status color for good.

**Chart content.** Every chart carries a title with the scanner name, run number, and UTC window, an axis label with the unit, and a legend. Label bars and marks so the chart reads without color. The PII rule above applies to chart text. Read the PNG back before posting and check that no label is clipped and that the legend and axis labels rendered. If a chart cannot be rendered, say so on the **Gap** line and post the numbers it would have carried as one fixed-width block.

**Context** (text, one line): trigger set, aggregate counts, materiality crossers, proposed `frontier_us_models` targets, per-author frontier $/24h and shares, restricted $, live $ (last 1h), open gaps. Omit normal or redundant values. If no `ruleKey` appears anywhere in the thread, hang `<https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates?q=&state=all|Open Sentinel queue>` off this line. Always end with the `spec@<sha>` stamp from [Reading this file](#reading-this-file).

**Gap** (text, one line): the concrete degradation, its staleness age, and its impact, e.g. `query timeout; reused r170 ring-membership targets, 1h stale`.

**Also tracked** (text, one line per item): each genuinely still-open watchlist, held-account, method-drift, or sweep item that did not change this run.

**Gates** (text, one line): `fanout ✓ · compromised-key ✓ · denial-dedup ✓ · materiality ✓`. Replace a ✓ with ✗ plus a short reason for any gate that tripped or could not be checked, and with `n/a` for one with nothing in scope. A gate is ✓ only if the run performed it.

Drop per-account rosters, per-account dollar breakdowns, KYC essays, false-positive-risk boilerplate, unchanged-cohort recitations, and restated normal findings. Include false-positive risk only when it is a genuine judgment call, as one caption clause. The filed candidates and their targets live in the Sentinel queue behind the links. Link there instead of dumping account rows or a `.tsv` into Slack.

**Mentions.** Never tag another agent. The one exception is a live KYC ask to Sniffer, an agent that can run a `kyc` check on a specific customer: in the thread only, using `<@U0ANC3T3U0Y>` (plain `@sniffer` does not ping), hard cap two asks per run, normally one, and only for a genuinely new, unanswered KYC question on an ambiguous individual account where a new read could change the decision. Never for an account already filed, restricted, or settled on the watchlist, never fanned across a cohort, and never when a prior Sniffer read is in hand. If unsure whether the question is new, use the plain name and no ping. Human mentions are unaffected. The top-level line never carries any mention.

**Pre-post self-check.** No prose block about a case or cohort. No `**`, `](http`, leading `- `, or `#` in native mrkdwn. No agent mention except the permitted Sniffer ask. Every backticked `ruleKey` outside a case block has its link. Every PNG was read back.

**Example thread.** Each `[image: ...]` line stands for one PNG attached with `file_path`, captioned by the line above it:

```text
*NEW — 12 new / 12 total non-denied targets* · <https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates/00000000-0000-4000-8000-000000000001|Open Sentinel case> · `autobuy_synthetic_quest_bin436797_hk_tw`
Lifecycle of the 12 accounts: first top-up 3 min after signup, first request 11 min, enacted 19:42 UTC. Source: stg_credits, stg_generations.
[image: lifecycle timeline, one row per account, UTC axis]
Money: $3,608 anthropic live last 1h · $4,935 frontier/24h · restricted $0.
[image: money split bars]

*UPDATED — 2 new / 7 total non-denied targets · 3 denied · pending review* · <https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates/00000000-0000-4000-8000-000000000002|Open Sentinel case> · `autobuy_bin450306_sg_debit_datacenter`
Lifecycle of the 2 new accounts: first request 9 min after signup, not enacted, open 41 min · $310 at 19:58 UTC observation. Source: stg_credits, stg_generations.
[image: lifecycle timeline, hollow not-enacted marker at observation time]
Money: $0 live last 1h · $21,125 frontier/24h · restricted $21,125. Enacted for `user_3Gk2vT9qLxWbNpD41sZaYcEfMhR`.
[image: money split bars]

Watchlist cluster BIN 436797: 8 signups in 24h, 6 lockstep $9.20 loads, 1 $9.19 refund, not filed. Source: stg_users, stg_credits.
[image: lifecycle timeline, hollow not-enacted markers]

*Context*
465 top-ups / 361 accounts / $42.3k this hour · 33 materiality crossers · $155.7k frontier/24h total · spec@a1b2c3d4e5f6

*Gap*
query timeout; reused r170 ring-membership targets, 1h stale

*Also tracked*
• Bypass sweep: 1 unrestricted entity, already filed as `autobuy_org_entity_bypass_bin493724` <https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates/00000000-0000-4000-8000-000000000003|case>
• Sweep complete: no new method drift

*Gates*
fanout ✓ · compromised-key ✓ · denial-dedup ✓ · materiality ✓
```

A run with no case and no changed watchlist item:

```text
*Context*
0 new gated candidates · 0 materiality crossers · $0 live last 1h · $0 frontier/24h · restricted $0 · <https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates?q=&state=all|Open Sentinel queue> · spec@a1b2c3d4e5f6

*Gates*
fanout ✓ · compromised-key n/a · denial-dedup ✓ · materiality ✓
```


## Writing style — Simplified Technical English<a id="writing-style"></a>

Write every case `description`, every target `evidence` reason, every
ban-candidates CLI `--reason` and `--notes` value, and every Slack thread reply
in Simplified Technical English. Triage sessions that respond to a case post
follow the same rules.

Rules for every sentence:

- Use active voice. Name the actor.
- Use short common words. Use one name for one thing.
- Put one instruction or one fact in each sentence. Keep each sentence at 20
  words or fewer.
- Do not use contractions or semicolons.
- Do not use phrasal verbs such as "spin up" or "dig in". Do not use marketing
  adjectives.
- State an inference as an inference, not as a fact.
- Keep code, identifiers, rule keys, ids, dollar figures, and URLs unchanged.

**Case narrative.** A reviewer in Mission Control must understand the case in
under one minute. Write the `description` in this order, with these labels:

```text
What happened: <N> accounts <did what> between <start> and <end> UTC.
Signals: (1) <account-owned signal one>. (2) <account-owned signal two>.
Would disprove: <one observation that would show a legitimate explanation>.
Remedy: <proposedKind> on <N> `user` targets. Status: <pending review | enacted>.
Proof: <query names, raw counts, and figures>.
```

Keep the first four lines free of queries and raw counts. Put queries and raw
counts only in the Proof block. Do not repeat a section. Do not add a preamble.

**Target reason.** When a target's `evidence` carries a reason text, write one
sentence. Name the two signals for that account.

**CLI text.** Write `--notes` and `--reason` as one or two short sentences. Name
the action, the two signals, and who authorized it. Example:
`--notes 'Approved <N> frontier_us_models targets. Signals: <signal one>, <signal two>. Authorized by <reviewer> in thread.'`

**Slack.** Keep the threading rules in [Output — post to Slack](#output--post-to-slack)
and the mrkdwn contract in `.agents/skills/slack-mrkdwn/SKILL.md`. Before you
post, check each sentence against the rules above and check that no line
contains `**` or `](http`.

## Terminology

**Non-denied targets** <a id="non-denied-targets"></a> are a case's accumulated
targets whose `status` is not `denied`. That set drives counts, case-block figures,
confidence, and urgency. The [case size budget](#case-sizing) is the exception.

In all Slack output (top-level line, thread, per-cluster lines), label the dollar
figure with its basis and window — for example, "frontier spend ($/24h, upstream COGS)" — never "exposure" (ambiguous). If you report a different
window or the queue's billed-usage-plus-BYOK `spend_30d`, name it explicitly.
When breaking the figure into already-enforced vs still-active portions, label
them "restricted" (banned or frontier-restricted now) and "live" — not
"exposure". (There is no `usdExposure` API field anymore — the ingest schema
strips it; carry the figure in `evidence`.) For card-derived count evidence, use
the vocabulary in
[Card and payment-method terminology](#card-and-payment-method-terminology).

## Card and payment-method terminology

This section covers counts derived from charge attempts only. A payment method
that was attached but never charged is out of scope and has no evidence key.

For `charge_attempts` and `failed_charges`, use
`analytics.stg_stripe_charges` alone with no join:

- `charge_attempts`: `count()` of charge rows with all statuses. This existing
  key remains valid.
- `failed_charges`: `countIf(charges.status = 'failed')`. This existing key
  remains valid.
- `distinct_card_entries_attempted`: `uniqExactIf(charges.card_id,
  charges.card_id IS NOT NULL AND charges.card_id != '')` over charge rows.
  Each entry is a card record created when a card is entered at checkout.
  Counts nest as charge attempts, then card entries, then fingerprints.

The card-derived count keys use the per-account query in
[`card-fingerprint-counts.sql`](./card-fingerprint-counts.sql); run it
verbatim, fetching it the same way as this file when the checkout may be
stale.

The join drops charges with no card row, such as crypto and wallet flows. Keep
the attempt counts and card-entry count on the charges table for that reason.
If this query returns no row for an account, every card-derived key is zero.
Scanners must write every card-derived key rather than omit it, because omission
can violate the shared-key floor. Unless a scanner defines a time window, use
the query's per-account scope.

The query defines `distinct_card_fingerprints_attempted`,
`distinct_card_fingerprints_charged`, and `distinct_bins_attempted`, all over
charge attempts with a matching card row. The reviewer console uses the same
non-empty IIN predicate on succeeded charges only, so its BIN list can differ;
a succeeded-only BIN count must use a scope-suffixed key instead of reusing
`distinct_bins_attempted`.

`distinct_cards` and `distinct_payment_methods` are retired. Scanners must not
write either key. In this vocabulary, "card" always means a Stripe
`cards.fingerprint`, never a cardholder or a physical card. Wallet and payment
intermediary BINs can share one fingerprint across unrelated users, so a
cardholder count is not derivable from this data. Whenever an evidence key or
prose reports a card count, put its scope in the name, such as attempted or
charged. Do not leave the scope implied. A key that counts distinct cards,
meaning distinct fingerprints, must contain
both `card` and `fingerprint` because the reviewer brief keys its
shared-fingerprint precedent off those substrings. Counts of card entries or
BINs are outside this rule.

## Per-scanner deltas

Only these differ between scanners; everything above is shared.

### Model-lab distillation classification

Run this when a model lab reports an account for distillation or one of the `[Abuse] reasoning_extraction refusal burst` monitors (`configs/terraform-monitors/monitoring/reasoning_extraction_refusal_burst.tf` at 1,000/h for any account, `reasoning_extraction_new_account_burst.tf` at 50/h for new accounts, both page `#alerts-tns`) picks one up from prompt-refusal data. It classifies each flagged entity into a routing outcome, files the account-level restriction outcomes as one Sentinel case, and researches contacts for the outreach outcomes.

#### Inputs per entity

- **Abuse rate** — refusals in the reported or observed window divided by total generations in the same window. Refusal counts come from Datadog `moderation_block` logs (`@extra.refusal_category`, grouped by `@extra.entity_id`); denominators from ClickHouse `default.generations` (`refusal_category` persists on generations too, but only since 2026-09-21). Raw refusal count is never sufficient: large legitimate orgs produce high absolute counts at rates near zero.
- **Account metadata** — email and domain class (freemail vs professional), account age, lifetime purchases, max daily spend, billing and traffic country, current restriction state. Read from `analytics.dim_users` / `stg_users`, `stg_credits`, and `default.generations`.
- **Relationship data** — HubSpot contact, lifecycle stage, and owner via the ClickHouse sync (`analytics.stg_hubspot_contacts`), matching on Clerk ID or exact email first, professional domain as fallback. The sync lags live HubSpot, so state the source when reporting owners.

#### Decision script

Steps 1–3 are ordered exit gates: the first match routes the entity to an outreach outcome. An entity that passes all three gates gets the most severe of steps 4–6 whose condition matches (compromised keys or restriction evasion always route to step 6, a rate at or above the step 5 bar to step 5, even when a step 4 condition like freemail also matches).

**New-account rule.** An account under 7 days old at alert time (signup time from `analytics.dim_users` / `stg_users`) is a new account. The new-account monitor filters on the `days_since_signup` field of the `moderation_block` log, logged from the request user record. ClickHouse signup time is the source of truth, and refusals emitted before the field shipped are not counted, so when it fires, still confirm the account age from ClickHouse before anything else: an account 7 days old or older is out of scope for that monitor and gets no run from it (the 1,000/h monitor covers established accounts). Ownership is exclusive the other way too: when the 1,000/h monitor fires on an account under 7 days old, stop and reply that the new-account monitor owns it, since it fires on the same burst. One burst gets one run. Run the script automatically for every in-scope alert without waiting for a requester. Steps 1–3 and the [compromised-key gate](#compromised-key-gate) apply unchanged and each is a hard stop on the enact path below. The rate is refusals divided by total generations over the burst window, both from `default.generations`. The rule applies to monitor-derived cases only: a lab-reported new account runs the ordinary established-account script. For a monitor-derived new account the outcome bars replace the 50%/30% established-account bars:

| Rate over the burst window | Outcome |
|---|---|
| above 25% | `frontier_us_models` **enacted by the agent** (file, `review ... approved`, `enact`), plus an `inference_block` target filed at `pending_review` in the same case |
| above 15%, up to 25% | `frontier_us_models` filed at `pending_review` |
| 15% or below | no proposal from this rule; report as unrouted |

This table is the whole of steps 4 and 5 for a monitor-derived new account. Step 4's rate floor and its freemail disjunct do not apply to such an account: a new freemail account at 15% or below gets no proposal. Step 6 still applies.

The enact path reuses the ordinary case flow and its audit trail, nothing new: file the case with `post` (both targets, `frontier_us_models` with `{}` params and `inference_block` unscoped), then `review <suggestionId> approved` naming only the `frontier_us_models` target id, then `enact --yes` on that target id. The `inference_block` target is never named in `review` or `enact`. Requester-less sessions are recorded as `devin:<devin_id>`, so `--notes` names the rule, the rate, the refusal count, the window and the account age.

1. **Enterprise (CSM, AE, or partnership relationship)** — notify GTM and prepare information to be sent to the customer.
2. **Active HubSpot lead, or account older than 30 days with >$50k lifetime spend or >$5k/day** — notify GTM to gauge the relationship depth.
3. **Professional (non-freemail) email, reasonably believed to have end customers, and no China/HK connection** — prepare information to notify the customer directly.
4. **Author ban** (scoped `author_ban` for the reporting lab) if the abuse rate is below the step 5 bar in the window — a lab-sourced report actions any nonzero rate; for monitor-derived (self-observed) cases use a 30% floor — or the account uses a freemail address (icloud, gmail, yahoo, hotmail). A monitor-derived new account skips this step entirely and follows the new-account table, freemail or not.
5. **Frontier ban** (`frontier_us_models`) if the abuse rate is at or above 50% (a monitor-derived new account: above 25%, enacted, with an `inference_block` proposed alongside; a lab-reported new account follows the ordinary bars here and stays proposal-only), the account is implicated in distillation by multiple labs, or the account is implicated in other lab-reported abuse (cyber, CBRN, scams).
6. **Inference block** (`inference_block`) if the account's keys are believed compromised, or it has 2+ strong connections to an account previously author- or frontier-banned for distillation (restriction evasion).

Known ambiguities, resolved as follows unless the requester says otherwise: steps 1–3 are exit gates, so a step 1–3 match routes to outreach without a ban — flag any step 1–3 account with a rate at or above the step 5 bar to the requester explicitly. "End customers" in step 3 is proxied by a professional email domain. Step 2 reads as HubSpot contact exists, OR (age > 30d AND (lifetime > $50k OR daily > $5k)). Step 6b needs a link analysis over shared IP/JA3/card fingerprints against the previously banned population. An entity that matches no step (e.g. a monitor-derived case below the step 4 floor whose professional email fails step 3 on the China/HK gate, with no compromise or evasion signals) gets no proposal — report it to the requester as unrouted.

#### Filing and outreach

- File all step 4–6 outcomes from one run as **one case** (one `ruleKey` naming the detection, `targetType: user`), each target carrying its own `proposedKind` — `author_ban` with `proposedTarget` set to the reporting lab's author slug, `frontier_us_models` with `{}` params, `inference_block` unscoped. Everything stays `pending_review`, with one exception: the `frontier_us_models` target of a monitor-derived new account above 25% is enacted per the new-account rule. A step 6a target trips the [compromised-key gate](#compromised-key-gate): file it for visibility but never `review ... approved` or `enact` it, and escalate to a human for key revocation and holder notification.
- Skip targets already covered: an account already in a live case for the same conduct, or carrying an equal-or-stronger active restriction (check with `list`/`targets`, not ClickHouse).
- Per-target evidence carries at least the abuse rate, refusal count, window, account age, and the script step that matched (and which bar applied).
- Step 1–3 outcomes get no case. Research who to contact instead: HubSpot owner (name and email) where a contact exists, otherwise the account's own email from `dim_users`, and report an account with no email as having no verified notification path. Deliver the contact list to the requester; outreach itself is a human/GTM action.

### Pre-spend signup-burst detection

Waves of minted accounts fund a small top-up and burn it past zero within
minutes of signup, so a detector that keys on realized spend always fires after
the money is gone. Flag the burst at signup instead, and file its members —
including the ones that have not spent yet — while they are still dormant.

The rule needs three conditions, not one shared attribute: a tight
per-signup-IP-hash burst, a wider per-ASN-per-email-domain burst that survives
the operator rotating IPs mid-wave, and realized harm from the burst's earlier
members. The harm gate is what separates a minting run from ordinary shared
egress — large NAT and cloud-egress buckets produce burst counts all day with no
overdraft behind them — so never file on burst counts alone. The harm gate is
paid once per ring, so a later signup that matches an established ring's
signup-time signature (two or more of its shared signals, one an
infrastructure fingerprint) goes into the ring's case and is enacted under the
normal enactment gates without waiting for it to fund or send traffic. Do not
gate on `signup_email_autogen_score`; plausible-looking generated addresses
score low and the gate drops most real bursts. Per-cluster corroboration of an already-swept ring is a strong signal: the share of signup-IP cluster members with an active
restriction distinguishes a confirmed ring's unenforced remainder from an
unproven cluster.

Count real accounts only. `stg_users` also holds the organization entity created
behind a signup, carrying the same email and signup IP hash, so leaving
`is_organization` rows in inflates both burst counts and lets an account's own
organization satisfy the sibling-harm gate by itself.

The canonical query lives at
[`pre-spend-signup-burst.sql`](./pre-spend-signup-burst.sql).
Run it verbatim rather than re-deriving it, fetched at the same `?ref=$SPEC_SHA`
as this file (see [Reading this file](#reading-this-file)).

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
`data_region != 'europe'`, per the [generations query shapes](#generations-query-shapes--mandatory).

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
applies, and say funding is unknown
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

The key and funding lines carry the burst's own join keys: `API key created`, `Credit purchase initiated`, and the success-only `Credit purchase settled` all log `signup_ip_hash`,
`signup_asn`, `email` / `email_domain`, `signup_at`, and
`minutes_since_signup` (see [Additional log lines (Datadog)](#additional-log-lines-datadog) for the full field contract). So a
burst found on `Account created` follows onto key mints and funding attempts
on the log stream itself — filter those lines on the burst's
`signup_ip_hash` / `signup_asn` values directly — instead of waiting out the CDC lag for `stg_users` to join them. Older lines lack the fields; treat missing as unknown.

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
whose balance is still intact. A cent is the line: below it nothing has been lost, above
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

The coverage exclusion tracks the watched measurement basis, which is the
closed-weight releases of `anthropic` and `openai` (the router exempts
open-weight `hf_slug` models from `author_ban` and `frontier_us_models` alike,
so no filed remedy reaches them and their spend is never watched burn). Only an
existing `frontier_us_models`, `inference_block`, `account_ban`, or `author_ban`
rows covering both watched authors (`anthropic` AND `openai`) count as coverage:
a ban on only one of them leaves the other open, and any rate limit leaves the
path open at a slower pace. (The filed `frontier_us_models` remedy additionally
cuts `google`; an account already banned on both watched authors cannot produce
watched burn, so it is not re-filed for the unwatched leg alone.) Normalize `author_ban` targets before
matching — analytics holds both `anthropic` and `~anthropic` forms, in mixed
case.
Check current case coverage with `list`/`targets` before filing, since
ClickHouse restriction state is a floor (see the skill's [read-status section](../../../.agents/skills/sentinel-ban-candidates/SKILL.md#read-status-from-the-cli-never-from-clickhouse)).

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

### Sleeper Scanner

- **Source key:** `sleeper-usage-scanner`.
- **Role:** catch coordinated "sleeper cell" activation — clusters of
  long-dormant accounts (created a while ago, barely ever used) that AS A GROUP
  start driving significant usage in the last 24h. A lone reactivation is noise;
  synchronized reactivation of linked dormant accounts is the pattern.
- **Trigger set:** long-dormant accounts (well past signup, negligible prior
  usage) that registered significant usage in the rolling last 24h.
- **Scope:** OLD accounts whose usage just emerged. Disjoint from the signups
  scanner (by account age) and the autobuy scanner (key on emergent generation
  usage, not autobuy config). Manual credit re-loads and usage on old dormant
  accounts are yours.
- **Datadog lines:** `Credit purchase initiated`, `Credit purchase settled`,
  `Top Up: triggered`, `API key created`, `Payment method added`,
  `Payment method setup initiated`, `Coinbase checkout initiated`, `Account
  created` (for original signup context). On a wake, `minutes_since_signup` /
  `signup_at` and the signup fingerprints on the reload/key lines give the
  dormancy span and the original-infra comparison without waiting for
  `stg_users`/`stg_credits` to catch up; `Credit purchase settled` is the
  freshest view of a reload landing.
- **Geo evidence:** compare the network country at reload/wake time with the
  funding card's issuer country; geo remains corroborating only. Neither side
  has a live reviewer read at that granularity — for a re-load, query
  `analytics.stg_credits.cf_ipcountry` and `analytics.stg_credits.card_country`
  on that credit row (relay-window Coinbase rows have no usable network country; see the relay note under "Shared
  fields on the key/funding lines"); for a wake with no re-load, use
  `analytics.stg_generations.country` over the emergent-usage window. The
  reviewer panel's signup/onboarding country is the dormant account's original
  network context: keep it as separate context, not as the network slot in this
  comparison.
- **Dormancy:** establish it on lifetime history, never on the trailing window
  the trigger set uses. A wake whose account carries lifetime funding, prior
  traffic, and keys older than the wave is a
  [compromised-key](#compromised-key-gate) candidate, not a sleeper cell.
- **Handoff:** a synchronized wake whose members' burst keys carry prior
  legitimate traffic is a key-replay wave. Hand it to the [Leaked Key
  Scanner](#leaked-key-scanner) and file nothing enactable on it; a lone wake is
  yours to adjudicate, and it is subject to the same provenance check before any
  enactment.
- **Reporting window for filed spend:** 24h.

### Recent Signups Scanner

- **Source key:** `recent-signups-scanner`.
- **Role:** pre-emptive — identify accounts (and clusters) that look stood up to
  abuse the platform, early enough to propose a block before harm. No money is at
  risk yet and blocking a real new customer chills growth, so favor precision:
  prefer clusters with converging evidence over lone borderline accounts, and
  quantify how many real-looking accounts a proposed rule would also catch.
- **Trigger set:** all accounts that signed up in the rolling last 24h, regardless of whether they've added credit. Every run produces the lockstep view of that set with [`signup-lockstep-burst.sql`](./signup-lockstep-burst.sql) (five or more signups on one ASN inside a 10-second bucket, with funding, key and existing-target context), fetched the same way as this file when the checkout may be stale and run verbatim. Its rows are discovery leads, not filings, and the run's own playbook queries add to it rather than replace it.
- **Scope:** disjoint from the autobuy scanner — don't reason from autobuy config
  or autobuy-driven top-ups. Manual / first-load credit behavior stays with you.
- **Datadog lines:** `Account created`, `Onboarding completed`, `API key
  created`, `Credit purchase initiated`, `Credit purchase settled`, `Payment
  method added`, `Payment method setup initiated`, `Coinbase checkout
  initiated`. This scanner's whole trigger window sits inside the CDC lag at
  its leading edge, so lean on the log stream hardest here: cluster fresh
  signups on `Account created`, then follow the cluster onto key mints and
  funding via `signup_ip_hash` / `signup_asn` on `API key created` and the
  purchase lines, using `minutes_since_signup` for signup-to-action timing
  and `email_domain` for the benign exclusions. The materiality gate and harm
  evidence still come from ClickHouse.
- **Geo evidence:** compare signup/onboarding network country with the issuer
  country of the first manual-load card. Both sides have a live reviewer read
  for this scanner, though the panel's issuer set spans all succeeded charges;
  for the first load specifically, read `credits.card_country` on the earliest
  matching credit row. Identity evidence carries extra weight here because
  these accounts have almost no usage history; geo remains corroborating only.
- **Reporting window for filed spend:** last 3d (new accounts have little history;
  a 3d window captures the ramp). Note new accounts may have negligible usage, so
  lean on the KYC judgment.
- **Signal note — scripted mailbox shape + seconds-apart signup batch:** a
  uniform email local-part template across accounts that sign up seconds apart is
  a coordinated-provisioning signal, and it survives when infra fingerprints do
  not (it needs only `email` and `created_at`, so it works on cohorts predating
  signup telemetry). Cluster candidate signups by local-part template — e.g.
  `firstnamelastname` + a 4-digit suffix, or a random alphanumeric run of fixed
  length — and check the intra-cluster signup spacing: human batches do not land
  2-3 seconds apart. A minimum first load (currently $5, read as the earliest
  `status = 'succeeded'` charge per `clerk_user_id` in
  `analytics.stg_stripe_charges`) placed within minutes of signup on every
  member corroborates it; treat the load timing as corroboration only, since
  ordinary new customers also fund immediately. Do not read charges from the raw
  `fivetran_stripe.charge` mirror: it carries `customer_id` only, so
  "first load per account" is not expressible there without a customer join.
  **Mandatory guard before proposing:** the shape alone is not rare — a
  template like `^[a-z]{6,}[0-9]{4}$` has matched most of a day's `outlook.com`
  signups — so compare the cohort's
  payer-conversion rate against an *age-matched* baseline: accounts at the same
  mail domain created in the same window, minus the cohort itself. Both sides
  use one basis, the real-payer bar (currently $50) of lifetime succeeded Stripe
  payments per `clerk_user_id` in `analytics.stg_stripe_charges`, which is keyed
  by account and needs no generations scan. Do not compute this bar as a
  domain-wide all-time aggregate over `analytics.stg_generations`: with no
  `clerk_user_id` predicate that reads every monthly partition and is mis-shaped
  by [Generations query shapes](#generations-query-shapes--mandatory). An
  upstream-COGS variant of the bar is available only for a bounded
  `clerk_user_id` set. Exclude already banned or deleted accounts from both
  denominators, since enforcement stops spend and would depress the cohort rate
  on its own (the baselines rule forbids using a later outcome as an input), and
  report the cohort rate both ways. Report both rates with their denominators.
  Treat the shape as actionable only when the cohort converts several-fold below
  its age-matched baseline, and state the ratio; a cohort converting at or near
  the baseline is a mail-provider default rather than an operator template.
  **The shared materiality gate still applies:** a registration-shape match is
  a static attribute, not by itself the shared behavioral pattern the gate
  requires, so a shape cluster with no established shared behavior stays on
  the watchlist until the pattern is established (see the materiality gate
  reconciliation bullet below).
  Worked example (2026-08-19, `outlook.com`, 4-day cohort): shape-matchers
  converted at 2.36% against an age-matched 11.16% baseline, a ~4.7x gap,
  while the whole-domain all-ages rate (3.4%) would have hidden the
  separation — which is why the baseline must be age-matched.
- **Materiality gate reconciliation:** the shared gate's pattern is established
  on trailing-24h behavior — the 3d window is the *reporting/evidence* window
  (to show the ramp), NOT a substitute threshold window. A brand-new cluster
  whose shared pattern between actors isn't established on the 24h window yet
  is sub-gate: keep it on the watchlist (with its 3d ramp) and file the instant
  the pattern is established. The precision framing here is about how
  conservative to be within that gate, not a looser threshold.

### Autobuy Scanner

- **Source key:** `autobuy-scanner`.
- **Role:** detect abusive autobuy top-up behavior. Derive signals directly from
  the underlying tables; find patterns the rules miss and detect when known ones
  drift.
- **Trigger set:** autobuy top-ups since the last run. A run can also start from
  a Datadog funding-burst alert: the monitors in
  `configs/terraform-monitors/monitoring/autobuy_burst_detection.tf` post to
  `#alerts-tns` carrying the marker `autobuy-scanner-trigger`, which is what the
  automation's Slack trigger matches. On an alert-started run the alerting
  10-minute window is the initial trigger set, then widen to the normal scope.
  The alert is unvalidated detection, not evidence.
- **Scope:** autobuy configuration and autobuy-driven top-ups. Leave brand-new
  account adjudication to the signups scanner and cold-old-account awakenings to
  the sleeper scanner.
- **Datadog lines:** `Auto top-up trigger updated`, `Top Up: triggered` (and
  `via SPT`), `Credit purchase settled`, `Payment method added`, `Credit
  purchase initiated`, `Coinbase checkout initiated`. `Auto top-up trigger
  updated` now carries the signup fingerprints and `minutes_since_signup`, so
  a trigger armed minutes after signup is visible on the line itself;
  `Credit purchase settled` (`flow`, `card_country`, `card_fingerprint`) is
  the freshest settled view of an autobuy charge inside the `stg_credits`
  lag.
- **Signal note:** `analytics.stg_credits.cf_asn` (payment-time ASN) is the most
  relevant ASN for this scanner; weight it alongside the shared
  fingerprint-clustering signals above. Relay-window Coinbase rows carry the relay's ASN;
  see the relay note under "Shared fields on the key/funding lines".
- **Geo evidence:** compare the payment-time network country with the issuer
  country of the card funding the top-up under adjudication. Neither side has a
  live reviewer read at that granularity — query
  `analytics.stg_credits.cf_ipcountry` and `analytics.stg_credits.card_country`
  on the credit row for the top-up under adjudication, which carries both on
  one row alongside the `cf_asn` above. Geo remains corroborating only.
- **Reporting window for filed spend:** 24h.

### Leaked Key Scanner<a id="leaked-key-scanner"></a>

- **Source key:** `leaked-key-scanner`.
- **Role:** catch harvested API keys replayed at scale — one operator driving
  many unrelated accounts' keys through a shared relay, which arrives looking
  like a synchronized ring while the account holders are victims. The run's
  product is the victim/operator split and the blast radius, not an enforcement
  cohort. The other scanners ask whether an account is abusive; this one asks
  whose key it was.
- **Authority — files two kinds of case, enacts neither.** The account-level
  half of this scanner's subject matter is what the
  [compromised-key gate](#compromised-key-gate) forbids acting on, and
  `api_key` targets are refused on the agent enact path in every case, so
  filing is the whole of this scanner's authority. Leave every target
  `pending_review` and put the enforcement recommendation in the thread for a
  human.
- **Data region — the one scanner that reads EU rows.** A replay wave is the
  operator's traffic, and nothing stops them replaying an EU-region holder's key,
  so dropping `europe` would hide victims and undercount the keys to revoke.
  Query all three regions and omit the spec-wide `data_region != 'europe'`
  predicate. This is scoped to measuring the wave: EU members are counted in the
  blast radius and named for key revocation like any other victim, and the
  file-only authority above already forbids enacting on them.
- **Trigger set:** a minutes-wide frontier spend burst whose requests concentrate
  on one client fingerprint, user agent, or egress ASN across many accounts; or
  an account whose balance went negative on traffic it did not fund. Either can
  start a run, and either is unvalidated detection, not evidence.
- **Scope:** the wave, at every account age. Inside a confirmed wave this
  overrides the age split between the sleeper and signups scanners: they hand
  their members here for that window, and this scanner hands an account back when
  provenance shows the burst key was minted for the burst. It does not adjudicate
  an account's behavior outside the wave.
- **Key provenance is the run's core measurement, and it decides the case.**
  Two things have to be true of the keys you measure: each one actually served
  the burst, and its age is its real mint time. Derive the burst participants
  from the burst window itself, per `(clerk_user_id, api_key_id)` pair, and take
  the mint time from `analytics.stg_api_keys.created_at` — the authoritative key
  record. A `min(created_at)` over generations is FIRST OBSERVED USE inside the
  lookback, not creation, so a long-idle legitimate key reads as freshly minted
  and its victim is misclassified as the operator. Do not rebuild the key's
  traffic history here — filing the revocation already produces it, see below.

  The participant and provenance query lives in
  [`leaked-key-burst-provenance.sql`](./leaked-key-burst-provenance.sql),
  fetched the same way as this file when the checkout may be stale. It is the
  one sentinel query that is NOT run verbatim: its `burst` CTE carries a
  `__WAVE_SIGNATURE__` placeholder that ClickHouse rejects as an unknown
  identifier, so the file cannot select participants until you replace the
  placeholder with this wave's signature predicates, each written as its own
  `AND ...` clause (the placeholder stands for the whole conjunction). Change
  nothing else.

  Carry the wave's own request signature into the participant CTE, not just its
  time window: a cohort account keeps serving its ordinary traffic during the
  burst, and a window-only filter pulls those concurrent keys in as revocation
  candidates and inflates the blast radius. Which facets those are is the wave's
  to dictate — a wave can be uniform on user agent while spanning ASNs and
  models, so filter on the facets that confirmed this one and on nothing else,
  and check the filter both ways: it must exclude a cohort account's known
  ordinary key and keep every key the wave visibly drove. A wave with no shared
  request signature to filter on is not a confirmed wave yet.

  Keep the pair, not the key alone: an account can bring several keys to one
  burst, each classified on its own provenance, and one account's compromised key
  says nothing about another's. `stg_generations.api_key_id` is nullable, so a
  row that fails to resolve against `stg_api_keys` is **undetermined**, never
  operator by default. Read that from `a_key_unresolved`, not from the mint
  time: a burst key with no matching key record comes back on the join's
  default fill rather than as NULL, so its mint time reads as the epoch —
  "minted long ago", the victim-shaped answer — while `id` reads 0, which no
  real key holds.

  The key's traffic history comes with the filing, so do not query it. An
  `api_key` target carries the before/after split around
  `evidence.compromised_at` for the key and for its account siblings: requests,
  spend including BYOK, distinct egress and colo, first and last seen, and each
  window's model, provider, colo, ASN and origin mix. It is built on a `pending_review` target, so the reviewer has it before anyone enacts; what this scanner files on is mint time and whose funding drained, so state the classification and the signature in the thread — that is what the split has to show for the recommendation to stand.

  Read the split for a life of its own rather than for volume. Traffic on the
  wave's own signature is the replay, and each dimension is broken out
  separately, so an established key is one whose before window carries traffic
  off that signature on some dimension — a named origin, a model or an egress
  the wave never used. Volume alone does not separate a working integration from
  a key the operator has been replaying for weeks. The same reading applies
  after the burst, where off-signature traffic means a live integration.

  Keep the key lookup prefiltered to the burst's ids in its own CTE, as above,
  rather than joining `analytics.stg_api_keys` whole: a right-side `ON`
  predicate is not a pushed-down filter, so the table is read whole and a wide
  cohort exhausts the memory limit. Aggregate aliases must not collide with
  source column names — `any(asn) AS asn` throws `ILLEGAL_AGGREGATION`.
- **Classify every member, and report the split:**
  - **Victim** — burst key minted well before the burst per `stg_api_keys`, on
    an account whose own funding is what drained. The filed split confirms it:
    a before window off the wave's signature, and off-signature traffic still
    flowing after the burst. Victims are filed for visibility only and are
    never an enactment target, in this run or a later one.
  - **Operator** — burst key minted shortly before the burst per `stg_api_keys`,
    with no independent funding history. Traffic before the burst that sits on
    the wave's own signature is earlier replay, not legitimate history. That is
    account-level access rather than a stolen key, so it belongs to the sleeper
    or signups scanner's turf under the ordinary
    [authority boundary](#read-only-propose-only); hand it over with the
    provenance evidence rather than enacting it here.
  - **Undetermined** — say so. A member whose burst key does not resolve to a
    key record, or a cohort whose provenance is missing or mixed, stays
    undetermined and unenacted, and per the remedy below is never filed for
    revocation in the first place. A filed key the split later disproves — an
    old key whose traffic sits entirely on the wave's signature is neither a
    fresh operator key nor a key with a life of its own — is undetermined too,
    and a note in the thread does not unfile it: deny that target with its
    reason, and archive the case when the whole of it falls. A target left
    `pending_review` stays enactable for whoever reads the case next. Do not
    resolve the ambiguity toward enforcement.
- **The cohort shape is not a cluster.** Relay and client uniformity is ONE
  attacker-side attribute however many facets it has, so a shared relay never
  supplies a second independent signal and never widens the cohort. Measure the
  grouping key's global fanout before trusting it, and derive membership from
  per-account burst behavior instead.
- **Blast radius** is what the report leads with: distinct victim accounts,
  distinct replayed keys, own-balance dollars drained, dollars driven past a zero
  balance, and BYOK inference exposure. Rank on
  `analytics.stg_generations.byok_usage_inference` alongside `usage`: relayed
  BYOK traffic bills the holder's own provider account, so `usage` alone
  understates the harm and hides the most exposed victims.
- **Remedy — propose the revocation, don't hand it off.** Key revocation is a
  filed proposal now, not a Slack aside: one `api_key` target per compromised
  burst key, in its own case separate from the user-target case, on the field
  contract in the [compromised-key gate](#compromised-key-gate) — `targetValue`
  is the decimal `api_keys.id` this scanner already has in `api_key_id`, and
  `evidence.compromised_at` is the proposed moment of theft. Take that moment
  from provenance rather than from the burst window by reflex: a key the
  operator was already driving before this burst was stolen earlier, and a
  too-late timestamp hides the traffic the reviewer splits on. Only keys this
  run classified victim-side get filed — a human enacts, which disables the key,
  and undo does not re-enable it, so an undetermined key on that list costs a
  holder their key permanently. Holder notification and the negative balance
  stay human. Name in the thread every target another run already restricted on
  what this run classifies as a victim, so a human can undo it in Mission
  Control.
- **`ruleKey` naming:** name the durable relay or replay pattern and carry the
  do-not-enact framing in the key itself, e.g.
  `<relay>_replayed_key_burst_watch_do_not_enact`. Keep operator-classed members
  out of that case and under their own key so a human approving one is not
  approving victims.
- **Zero-cost burst traffic is key-liveness probing**, not burn. Report it as
  probing and never as live spend.
- **Status:** unrevoked keys with live burn are `:red_circle:` — the urgency is
  revocation, and the thread must link the filed revocation case rather than
  implying enforcement is pending. A wave whose keys are already revoked and
  whose burn has stopped is `:large_yellow_circle:` while the undo and balance
  decisions are open.
- **Reporting window for filed spend:** 24h.

### Anthropic Concentration Monitor

Report-only and disjoint from the queue-feeding scanners: it files no
ban-candidates and the shared materiality gate does not apply. Its entire
delta — cadence, trigger set, thresholds, residency handling, and its routing
override (every run goes to `C0BJ51BK7P0` #alerts-tns, never the runs
channel) — lives in
[ANTHROPIC_CONCENTRATION_MONITOR.md](./ANTHROPIC_CONCENTRATION_MONITOR.md),
which the monitor fetches alongside this file.
