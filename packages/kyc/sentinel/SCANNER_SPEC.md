# Sentinel fraud-scanner spec (shared source of truth)

> **Status:** Living operating spec for the recurring fraud-scanner runs.
>
> **Audience:** the scheduled Devin automations that scan for abuse and file
> Sentinel ban-candidates — currently **Sleeper Scanner**, **Recent Signups
> Scanner**, and **Autobuy Scanner** — plus the report-only **Anthropic
> Concentration Monitor**, which does not feed the ban-candidates queue.
>
> This file is the single source of truth for everything those scanners share:
> data access, signal sources, the materiality gate, KYC prioritization, the
> restricted-vs-live split, how to propose and enact candidates, and how to
> report to Slack. Detection stays Anthropic-biased; the materiality gate
> requires a shared pattern between actors; the
> block a scanner proposes is a **full US-frontier block** (`anthropic`, `google`,
> `openai`) — see [Frontier block](#frontier-block--the-remedy-scanners-propose).
>
> Each scanner's automation prompt lives outside this repository and should be
> a thin wrapper that sets its
> own **role, scope, trigger set, and (for queue-feeding scanners) source key**
> (see
> [Per-scanner deltas](#per-scanner-deltas)) and otherwise defers to this file.
>
> Sibling docs: [SPEC.md](./SPEC.md) describes the Sentinel *enforcement system*
> (tables, review queue, enactment); [MEMORY.md](./MEMORY.md) is its refresh
> protocol and history. This file is about the *detection runs* that feed the
> queue, not the enforcement system itself.

## How a scanner uses this file

Each scanner is a Devin automation with a `start_session` prompt. The prompt
should:

1. State the scanner's **role** (what it hunts), **scope** (turf boundaries vs
   the other scanners), and **trigger set**; queue-feeding scanners also state
   their reporting window and **source key**.
2. Reference this file so the run reads it as the operating spec, and point the
   run at the `gh api` fetch below rather than at a checkout (see
   [Reading this file](#reading-this-file)).
3. Otherwise defer to the shared sections below — do not re-paste them into the
   prompt, so there is one place to change data access, the gate, output format,
   and the status rubric.

Everything below is common to all scanners unless a
[Per-scanner delta](#per-scanner-deltas) overrides it.

## Reading this file

Fetch the spec at the start of every run — not from the session's checkout,
which the session-start pull leaves many commits stale whenever the unrelated
`openresponses` submodule fetch fails:

```bash
gh api repos/OpenRouterTeam/openrouter-web/contents/packages/kyc/sentinel/SCANNER_SPEC.md \
  -H "Accept: application/vnd.github.raw" > /tmp/SCANNER_SPEC.md &&
  test -s /tmp/SCANNER_SPEC.md
```

The `test -s` matters: the redirect leaves an empty file when the call fails, and
an empty spec fails the same silent way a stale one does. An
`@packages/kyc/sentinel/SCANNER_SPEC.md` prompt token is NOT a substitute — it
resolves against the session checkout, which is the stale copy this avoids.

Needs `api.github.com` in the automation's net policy. If the call fails, fall
back to the checkout after `git pull --ff-only --no-recurse-submodules`. If
`git rev-list --count HEAD..origin/main` is then still non-zero, the run read a
stale spec: report the count in the **Gap** line and force the status to at
least `:large_yellow_circle:`.

## Frontier block — the remedy scanners propose

What a scanner FILES is one account-scoped `frontier_us_models` restriction,
which cuts all three US frontier authors — `anthropic`, `google`, `openai`
(`FRONTIER_US_MODEL_AUTHORS` in
[`packages/db/restrictions/frontier-authors.ts`](../../db/restrictions/frontier-authors.ts)).
An Anthropic-only `author_ban` leaves the ring free to pivot to Gemini/GPT and
keep burning, which is why the remedy is wider than the signal.

This changes the remedy ONLY. Detection, clustering, and every reported spend
figure remain Anthropic-based, unchanged.

The frontier block is the routine remedy, not the strongest one on the shelf. A
case that calls for account-wide enforcement is filed as an `inference_block`
for a human to approve, and as an `account_ban` only when the account needs to
be locked out of the UI. Those two kinds are never the scanner's own routine
proposal: see [Propose and enact](#read-only-propose-only).

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
  `curl --max-time 120`. Add the server settings
  `max_execution_time=120&timeout_overflow_mode=throw` to the request. A
  client disconnect does not cancel a ClickHouse query by itself; the former
  570-second client ceiling therefore did not stop the 1,385-second server
  scan. `~/chq_long.sh` (the former 570-second variant) is retired.
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
  on 2026-07-27 was 503,611,839 `global` / 383 `us` / 39,666 `europe`).

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
  `sumIf`/`countIf` does not prune anything; it aggregates all history. Keep
  `sumIf` only for the split dimension (Anthropic vs total). A nested trailing
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

  **Wrong:**

  ```sql
  SELECT clerk_user_id,
    sumIf(upstream_inference_prompt_cost + upstream_inference_completions_cost,
      created_at >= now() - INTERVAL 24 HOUR
      AND model_permaslug LIKE 'anthropic/%')
  FROM analytics.stg_generations
  WHERE data_region != 'europe'
  GROUP BY clerk_user_id;
  ```

  **Right:**

  ```sql
  SELECT clerk_user_id,
    sumIf(upstream_inference_prompt_cost + upstream_inference_completions_cost,
      model_permaslug LIKE 'anthropic/%') AS anthropic_usd,
    sum(upstream_inference_prompt_cost
      + upstream_inference_completions_cost) AS total_usd
  FROM analytics.stg_generations
  WHERE data_region != 'europe'
    AND created_at >= now() - INTERVAL 24 HOUR
  GROUP BY clerk_user_id;
  ```

  Measured 2026-07-27: `3.9s / 507M read_rows / 43.41 GiB` — below the guard
  below.

- Restrict `clerk_user_id` before aggregating. `WHERE clerk_user_id IN
  (SELECT entity_id FROM ...)` uses the sort-key prefix; aggregating every user
  and then joining a small ID set does not.

  **Wrong:**

  ```sql
  SELECT u.clerk_user_id,
    sum(u.upstream_inference_prompt_cost
      + u.upstream_inference_completions_cost)
  FROM analytics.stg_generations AS u
  INNER JOIN (
    SELECT DISTINCT entity_id
    FROM analytics.stg_restrictions
    WHERE _peerdb_is_deleted = 0
      AND ((kind = 'author_ban' AND target = 'anthropic')
        OR kind IN ('frontier_us_models', 'inference_block'))
  ) AS b ON b.entity_id = u.clerk_user_id
  WHERE u.data_region != 'europe'
  GROUP BY u.clerk_user_id;
  ```

  **Right:**

  ```sql
  SELECT clerk_user_id,
    sum(upstream_inference_prompt_cost
      + upstream_inference_completions_cost)
  FROM analytics.stg_generations
  WHERE data_region != 'europe'
    AND clerk_user_id IN (
      SELECT DISTINCT entity_id
      FROM analytics.stg_restrictions
      WHERE _peerdb_is_deleted = 0
        AND ((kind = 'author_ban' AND target = 'anthropic')
          OR kind IN ('frontier_us_models', 'inference_block'))
    )
    AND created_at >= now() - INTERVAL 24 HOUR
  GROUP BY clerk_user_id;
  ```

  Measured 2026-07-27: `0.77s / 34.4M read_rows / 1.61 GiB`.

- Never use an unbounded `max(created_at)` for freshness/health. Bound it to
  7 days so the monthly partition pruning applies, and run it once per run,
  not once per query batch. An epoch result (`1970-01-01`) means the bounded
  set is empty and the source is stale; report it as a gap rather than treating
  it as a fresh timestamp.

  **Wrong:**

  ```sql
  SELECT max(created_at)
  FROM analytics.stg_generations
  WHERE data_region != 'europe';
  ```

  **Right:**

  ```sql
  SELECT max(created_at)
  FROM analytics.stg_generations
  WHERE data_region != 'europe'
    AND created_at >= now() - INTERVAL 7 DAY;
  ```

  Measured 2026-07-27: `4.1s / 3.89B read_rows / 32.61 GiB` — the one-per-run
  health scan, whose multi-billion row count is expected from the monthly
  partition and exempt from the guard below.

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
itself. Authorized by John Krauss (`talos`) on 2026-08-22, replacing the earlier
propose-only rule.

What a scanner may do, all via the
[`sentinel-ban-candidates` CLI](../../../.agents/skills/sentinel-ban-candidates/SKILL.md):

- **File** candidates, as before (see
  [Propose via the ban-candidates API](#propose-via-the-ban-candidates-api)).
- **Approve** a case's targets with `review <suggestionId> approved --reviewer
  <clerk_user_id>`, one call per case, and **enact** them with `enact --yes
  --acting-user <clerk_user_id>`, one call per case. Never loop either command
  per target — each call posts its own Slack notification.
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
UI lockout is needed and leave it to a human.

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
any paid, sales-managed, or enterprise signal blocks it, and a failed user or
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

**Action when the gate trips — a hard stop.** Do not approve and do not enact
any restriction, `frontier_us_models` included. File the case for visibility,
leave every target `pending_review`, and route the account to key revocation,
holder notification, and crediting the negative balance, escalating those to a
human. When the gate trips on a target already enacted, escalate the undo in the
same run: the agent CLI has no `undo` command, so name those targets to the
human and let them undo through Mission Control, and never report such a target
as handled. Undo revokes the restriction and leaves the target approved; it does
not return it to `pending_review`.

## Materiality gate — only clusters with a shared pattern between actors

Only FLAG, PROPOSE (file to ban-candidates), ENACT, and report an
account/cluster when this holds on its emergent usage:

1. **Shared pattern between actors:** the cluster's member accounts act in a
   shared, coordinated behavioral pattern — e.g. lockstep funding timing and
   amounts, matching signup-to-spend ramps, a common model mix and request
   cadence, or synchronized top-up spacing. The pattern must be behavioral and
   hold across multiple accounts.

There is no Anthropic-share and no minimum-spend leg: a ring whose spend is
still ramping (e.g. a signup ring moving onto frontier models in a reseller
pattern) is in scope as soon as its shared pattern is established, so
intervention can happen before the spend grows.

- Establish the pattern on the cluster AGGREGATE (across member accounts) over
  the rolling 24h, from `stg_`/raw generations (`analytics.stg_generations` /
  `default.generations`) and funding events — not per-account, not lifetime.
  Report the cluster's 24h Anthropic spend and share alongside the pattern as
  evidence.
- A single shared static attribute — email domain, card fingerprint, BIN, IP
  hash, ASN — is how you FIND a candidate cluster, not the pattern itself. An
  attribute-only cluster with no shared behavior is OUT OF SCOPE this run: do
  not file, do not post it as a finding. A single account has no
  between-actors pattern and is likewise out of scope.
- The gate does not replace corroboration. The shared pattern counts as at
  most one signal toward the two independent corroborating signals required to
  enact. With no share or spend bar, that two-signal standard carries the
  false-positive protection: hold clusters to it strictly, and prefer filing
  over enacting when the spend is still small.
- This is a reporting/proposal gate, NOT a change to detection. Keep detecting
  and clustering sub-gate candidates in your playbook/watchlist (with their
  current Anthropic share and 24h Anthropic spend) so you surface and file them
  the instant a shared pattern between the actors is established — stay silent
  on them until then.

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

These fields shipped with
[openrouter-web#35700](https://github.com/OpenRouterTeam/openrouter-web/pull/35700);
lines logged before its deploy lack them. Treat a missing field as unknown,
never as zero or as a cluster of its own — gate fingerprint searches on field
presence (e.g. `@signup_ip_hash:*`, adjusting for the envelope's actual facet
prefix, which `Account created` lines nest under `@extra.*`).

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

Do NOT conclude "no IP/ASN/device in `analytics.*`". They live in staging, not in
`dim_users`.

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
  more accounts a JA3 links, the less it means. Both values that looked like
  rings in the 2026-08-22 02:00Z autobuy run fronted ~22k accounts each. Treat
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
  (per-request ASN); `analytics.stg_credits.cf_asn` (payment-time ASN).
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
- **The remedy for an operator-owned family is registration-side.** File it as a
  separate domain-target case, propose-only, stating that it does not ask for
  existing accounts on those domains to be restricted; account-scoped frontier
  blocks remain a separate case adjudicated per account.

Procedure, DNS-over-HTTPS resolution (`dig` is not installed), and the control
queries are in
[`mail-relay-ring-adjudication`](../../../.agents/skills/mail-relay-ring-adjudication/SKILL.md).

## Network geo vs card-issuer geo

These are distinct concepts answering different questions:

- **Network geo:** where the request came from. Signup and onboarding context
  live on Postgres `public.users` (`signup_country`, `onboarding_cf_country`),
  which the reviewer enrichment reads live — not the analytics mirror.
  Payment-time network country is Postgres `public.credits.cf_ipcountry`
  (mirrored as `analytics.stg_credits.cf_ipcountry`).
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

Geo is read at reviewer view time from the existing enrichment and metrics
payloads; scanner filing does not persist geo in target evidence. The
cluster-level interpretation belongs in the reviewer-facing case description
when it is part of why the case was filed.

The network snapshot must match the scanner moment: signup/onboarding for
Recent Signups, wake/reload time for Sleeper, payment time for Autobuy, and
request time for request-based checks. Only the signup/onboarding pair has a
live reviewer read; for the payment-time moments query the `credits` columns
above directly, and note that the issuer country shown in the reviewer panel
spans all succeeded charges rather than the one under adjudication. A mismatch is corroborating only and
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
- End each run by writing an updated playbook: promote confirmed signals, retire
  ones that stopped predicting, adjust baselines, and record open hypotheses with
  the evidence needed to confirm them.

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

- For every flag, cluster, or anomaly, anticipate a reviewer's questions and
  answer them in the same run. Don't hand over a finding that begs a follow-up
  you could have run yourself.
- Keep pulling the thread: if a shared attribute looks suspicious, trace the full
  cluster and quantify it (how many accounts, how much usage/spend, how much at
  risk).
- Weigh what reduces suspicion: enrichment-confirmed coherent company identity,
  organic prior engagement, a plausible reason for dormancy-then-resumption,
  distinct unshared infrastructure. Say so when it applies.
- Prefer resolving a question to escalating it. Stop only at a clear dead end
  (no data, diminishing returns) or when proceeding needs a human judgment call;
  then state what you found, what's blocking, and the specific decision needed.

## Anthropic usage + KYC-based prioritization

- For every account/cluster flagged, measure how much of its usage is Anthropic
  (Claude) traffic and how fast that share is ramping. Read the author per
  generation from `analytics.stg_generations` / `default.generations` (author
  slug `anthropic`) and compute the share against the account's own total usage,
  as a proportion — not a one-off presence check. Anthropic is among the most
  expensive and most abused capacity, so concentration there is disproportionately
  costly.
- Form an explicit judgment of whether each flagged account/cluster is likely to
  clear KYC / identity review, from signals you already gather: synthetic or
  generated identities, disposable/gibberish emails and domains, absent or
  incoherent enrichment, shared ring infrastructure and fingerprints, and bot-like
  funding and behavior. The less credible the identity, the lower the odds it
  clears KYC.
- When a flagged account shows a high rate of Anthropic usage AND looks unlikely
  to clear KYC, propose a [frontier block](#frontier-block--the-remedy-scanners-propose):
  file ONE account-scoped candidate per user (`proposedKind:
  "frontier_us_models"`, no `proposedTarget`, `proposedParams: {}`) so Claude,
  Gemini, and GPT access are all cut and the costliest spend is capped while it
  waits for adjudication — an Anthropic-only ban just moves the spend. **This
  frontier block is the ONLY block a scanner proposes** — do NOT file three
  per-author `author_ban` targets, and do NOT file or post a full `account_ban`
  for any account or cluster, in either the queue or the Slack summary. A case
  severe enough to stop the account outright is filed as an `inference_block`
  for a human to approve, never as an `account_ban`
  (see [Propose and enact](#read-only-propose-only)). Rank
  these highest and attach the Anthropic-usage evidence (share + trend) and KYC
  rationale to every proposal.
- A clean identity that will clearly clear KYC is a reason to hold.
- New accounts may have little usage yet; when usage is negligible the Anthropic
  share is not yet meaningful, so lean on the KYC judgment and act on Anthropic
  concentration as it emerges.

## Restricted vs live — split every reported/filed Anthropic-spend figure

Every Anthropic-spend figure you report or file (each per-ring figure and the
aggregate) MUST be split by whether the account that generated it is ALREADY
restricted at report time:

- An account is **RESTRICTED** if, right now, it is banned/disabled OR it carries
  an applied Anthropic restriction — an enforced `inference_block` or
  `frontier_us_models` restriction, or an author-level ban/restriction on the
  `anthropic` author, any of which already cuts its Claude access. Read this
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
  `currentRestrictionStatus`. The three states are distinct and all three are
  gaps: `approved` + null `restrictionId` (approved, not enacted), a
  successful archived-key response with `suggestionId`, `created: false`,
  `targetsUpserted: 0`, `targetsAlreadyRestricted: 0`, and `slack: null` over
  targets still `pending_review` and unrestricted (left the queue undecided —
  frozen, so no human will ever see it; follow the
  [archived-key response](#archived-stable-key) below), and an enforced
  restriction still generating spend. A `pending_review` target with no
  restriction and no archived-key response is adjudication latency, not a gap.
  Zero `targetsUpserted` is the archived discriminator, because the request
  requires at least one target and a live post reports at least one posted
  target key even when it re-upserts.
- **restricted $** = the 24h Anthropic spend summed over the accounts (in that
  ring / aggregate) that are restricted right now.
- **live $ ("still burning")** = Anthropic spend in the TRAILING 1 HOUR ONLY,
  summed over the accounts that are NOT restricted right now. "Still burning" is
  gated EXCLUSIVELY on the last hour — it is NOT the 24h remainder. A ring/account
  whose last-1h live $ is ~$0 is treated as extinguished / already-cut this run
  even if its 24h total is large; do not describe it as "still burning" or "live".
- ALSO compute, for the SAME currently-unrestricted accounts, their
  **non-Anthropic (other-author) spend in the trailing 1 hour**. "Still burning"
  itself stays Anthropic-only, but a ring with significant last-1h non-Anthropic
  live spend is worth calling out — e.g. an Anthropic-restricted ring that pivoted
  to other authors is still burning elsewhere. Surface it alongside the Anthropic
  live figure with the top author(s) it moved to. A ring pivoting to `google` /
  `openai` under a legacy Anthropic-only ban is the case the frontier block
  closes: name those two authors explicitly when they carry the pivot.
- Report both, but LEAD with the Anthropic live $ — it is the decision-driver.
  The 24h total and restricted $ (and restricted as a % of total) are secondary
  context, reported unbolded after it; other-author live $ (last 1h) is called out
  when significant.

## Propose via the ban-candidates API

Submit each candidate you'd propose to the Sentinel ban-candidates ingest. Every
candidate lands as `pending_review`; whether this run then carries it through to
enactment is governed by
[Propose and enact](#propose-and-enact--the-authority-boundary).

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
  section](#anthropic-usage--kyc-based-prioritization) — one target per user, no
  `proposedTarget`, `{}` params (the ingest schema rejects a `proposedTarget` on
  an unscoped kind) — never per-author `author_ban`s and never an `account_ban`.
  A case that genuinely needs account-wide enforcement is filed as an
  `inference_block` for a human to approve, per
  [Propose and enact](#read-only-propose-only).
- **`ruleKey` naming:** use one stable key for each ring or pattern across runs,
  with no run number, timestamp, or per-wave suffix. Name the durable pattern
  and remedy, such as `autobuy_bin450306_sg_debit_datacenter_frontier_block`;
  later runs and re-mint variants of the same ring re-post that key and upsert
  newly found members into it. Do not create a new key merely because the
  target set or the run changed. If a ring already has an
  `*_anthropic_block_*` case, file the frontier block under its own stable
  frontier key and reference the old case by link in the thread, leaving that
  anthropic case untouched. An account whose case a human denied stays
  off-limits under every `ruleKey`, per the rejection rule below.<a id="archived-stable-key"></a>
- **Archived stable key:** an archived case remains in the deduplication
  namespace. Its archived-key response returns HTTP 200 with `suggestionId`,
  `created: false`, `targetsUpserted: 0`, `targetsAlreadyRestricted: 0`, and
  `slack: null`; because archived cases are absent from `list`, this response
  is the only way to obtain the archived case id. Zero `targetsUpserted` is
  the archived discriminator, because the request requires at least one target
  and a live post reports at least one posted target key even when it re-upserts.
  Treat it as a no-op rather than a landed post. Run `targets <suggestionId>`
  from that response before deciding what to do, and inspect every target's
  `status`, `reviewerClerkUserId`, and `decidedAt`. Any target with `status: denied` is
  terminal on its own, regardless of the
  [Cleared by human decision](#cleared-by-human-decision--do-not-re-file)
  section, which is a convenience record, not the authority. If that section
  records suppression for the enumerated members, stop. Otherwise, file
  nothing and ask in this run's report thread for the person who archived the
  case to unarchive it, linking the returned case id without naming an actor.
  Record that pending unarchive ask once, with its date and covered members, in
  the [pending unarchive asks](#pending-unarchive-asks--do-not-suppress)
  section. Until the case is unarchived, report the ring as archived,
  unenforced, and undecided on later runs without re-asking. Its live burn is
  not knowingly held spend and cannot make the run green. When suppression is
  confirmed,
  record the answering human's name and date and enumerate the target values
  covered by that decision. For an org-keyed entry, exclude accounts that this
  run's own clustering places in that org.
- **Legacy run-key transition:** if a ring has one or more run-suffixed legacy
  cases in the list output, read each candidate's targets and skip cases whose
  targets are all denied, then choose the earliest-created remaining case.
  Re-post new members to that existing key rather than creating a new stable
  key or another case, and link sibling cases in the Slack report. If every
  legacy case is all-denied, do not re-file the ring. A legacy canonical case
  leaves the list when it is adjudicated and archived at the end of its normal
  life; the ring's next detection then mints the bare stable key. This is the
  single tolerated run-suffix exception.
- **Dedup:** a suggestion is identified by `source` + `ruleKey` + `targetType`;
  re-posting the same triple upserts targets, each deduped by `targetValue`.
  Use the unfiltered `list` first to dedup against the full queue, including
  adjudicated cases; archived cases are not discoverable there, so their ingest
  response reveals them — follow the
  [archived-key response](#archived-stable-key). Post the members
  observed in this run's window, new or still active, never unobserved members,
  so `times_seen` remains a recurrence count rather than a run counter.
- **Human rejection is terminal for all three scanners:** before filing or
  upserting, dedup against the FULL queue, including adjudicated cases, not
  only `pending_review`. A case whose targets are all denied is a human
  decision that the pattern is not abuse: do not re-post or upsert it, report
  it as open or UPDATED in Slack, or file the same account under a fresh
  `ruleKey` to route around the denial.
  Record the cleared account or cluster in the
  [Cleared by human decision](#cleared-by-human-decision--do-not-re-file)
  section with who decided and when, so subsequent runs skip it at detection
  time rather than rediscovering it. The only path back is materially new
  evidence of a different pattern; state the prior denial explicitly in the
  case block so the reviewer sees that it is a re-open — and material live
  (last-1h) burn, since a re-open resting on a 24h figure alone is not net-new
  signal.
  A denied case or suppressed ring's spend belongs with
  **spend we are knowingly holding** in the
  [Status rubric](#status-rubric-green--yellow--red), so it does not by itself
  make a run yellow or red.

- Put the dollar figure inside the `evidence` object (e.g. an `anthropic_usd_24h`
  key), not a top-level field — the ingest schema has no dedicated spend field and
  strips the retired `usdExposure`. Each target's evidence must also carry an
  at-filing snapshot captured on first filing and resent verbatim on later posts
  alongside current figures. The exception is a figure originally filed under a
  retired key. Recompute it under the replacement key instead of renaming or
  resending the old value because retired keys are rejected. Upsert replaces the
  whole evidence blob, so omitted keys are lost. In Slack/output text label it "Anthropic spend", never
  "exposure" — see [Terminology](#terminology). For card-derived count keys,
  follow
  [Card and payment-method terminology](#card-and-payment-method-terminology).
- Map the [status rubric](#status-rubric-green--yellow--red) onto the required
  ingest `urgency` field on every ingest: `red` means enforcement is needed
  fast, `yellow` means a human eye is needed, and `green` means there is nothing
  to act on. The agent sets this field in the ingest body and makes an explicit
  judgment call for every finding.
  Re-ingesting an existing case overwrites its description, confidence, and
  urgency. Describe the whole accumulated case and set confidence and urgency
  from all accumulated targets and findings, not just the new batch. If the case
  was red and the new batch alone would be yellow, keep sending red unless the
  overall case has genuinely de-escalated.
- Use the live reviewer-side geo reads described in
  [Network geo vs card-issuer geo](#network-geo-vs-card-issuer-geo) when
  explaining a case. Geo remains corroborating context, not filing evidence.
  A `description` should carry the cluster-level geo *shape* — "one issuer
  country against 7 unrelated signup countries across 12 targets" — which is
  what the case turns on, rather than a list of per-account country values.
- **Case sizing:** file up to 3000 distinct users and up to 9000 restriction
  targets in a single case (`source` + `ruleKey` + `targetType`) before splitting
  a ring across cases. Check every ring in the unfiltered list before posting.
  An archived-key response is also an existing-case signal and the only way an
  archived case appears. When that existence check finds a case, run
  `targets <suggestionId>` once before posting. Use that one read for the
  accumulated size budget, the new-versus-total target diff, and the legacy
  sibling check. Compute the distinct-user half from its target values because
  the list row has no user count. Treat a ring as a first filing only when the
  existence check is empty. It has no prior targets, so its accumulated budget
  starts at zero and every posted target is new. The hard ingest caps are higher
  (5000 distinct users / 10000 targets per suggestion — see the skill), but stay
  at 3000/9000 to leave headroom for later upserts into the same case. Shard one
  is the bare stable key; later shards use
  `<stable_key>_part_2`, `<stable_key>_part_3`, and so on, with stable
  partitions and sibling links. Never split by run or wave. A 400
  `user_cap_exceeded` or `target_cap_exceeded` response triggers the next
  deterministic shard key, not a run or wave suffix.

### Pending unarchive asks — do not suppress

This is a non-suppressing record for an archived case's one-time unarchive ask.
Each entry carries the case id, date asked, and target values covered. Do not
use it to skip re-filing or classify spend as knowingly held. Remove the entry
when the case is unarchived or when a denial or confirmed suppression is
recorded in the cleared-decision section.

### Cleared by human decision — do not re-file

This appendable list is keyed on the cleared account or cluster, not its
`ruleKey`, so a re-detection remains covered. When a human denies one of its
cases, or a reviewer confirms that an archived ring or pattern is suppressed,
add an entry here in the scanner refresh PR or in a small docs PR so the
decision is durable and reviewable rather than living only in a session
scratchpad. Every new entry must enumerate the target values it covers. For an
org-keyed entry, the run excludes accounts its own clustering places in that
org. Only denial and confirmed suppression entries here suppress re-filing and
count as spend we are knowingly holding. Remove an entry only with a documented
human reversal.

- JuicyChat, Clerk org `org_2xf8t0wKrZYzNJxLAB2BqbHyqEL` —
  `sleeper-usage-scanner` /
  `sleeper_juicychat_aws_reload_burn_anthropic_block_r22` (case
  `019f9c73-361d-72ca-a30f-1f3652e2e047`), denied by John Krauss on 2026-07-26:
  reviewed and found not T&S-violating; high Anthropic-concentrated spend on a
  reloaded dormant account is legitimate usage here. Scanners must not re-file,
  re-upsert, or re-report this account, and its spend does not color a run
  yellow or red.

## Output — post to Slack

- **Transport:** ingest owns the per-case alert and case link. Do not post a
  separate top-level per-case alert or case link from the agent. When ingest
  returns a non-null `{channel, ts}`, post the findings and reasoning as a
  thread reply to that message. Review decisions are posted as thread replies
  with the reviewer note. When a case has a stored Slack thread reference, the
  server threads enactment summaries onto the case alert without repeating the
  reviewer note. Cases without a stored thread reference receive no enactment
  Slack message.
- A filed case alert is new when its non-null `{channel, ts}` has a Slack `ts`
  at or after this run's start moment, not the detection lookback window.
  Slack `ts` is an epoch-seconds timestamp; an older one is a reused alert from
  an earlier run. A standalone top-level line is required only when no
  new-in-run case alert exists in the server-routed channel for this run's
  status, meaning no case was filed or every returned ref is reused from an
  earlier run. A case alert created during the run carries that status as its
  urgency and lands in that channel, so it is the run's top-level message.
  Still thread per-case findings onto every non-null case alert. Never drop
  findings or invent a synthetic case link.
- **Transport warning:** Do NOT use `slack-remote` (it appends a "Sent using
  @Devin" block that spawns a recursive Devin session).
- For a non-green run with a new case alert, keep the agent's findings in that
  ingest-owned thread reply. Do not create a synthetic case link or a second
  top-level message in the same channel.
- **Classify every run with one status emoji** (see [Status
  rubric](#status-rubric-green--yellow--red)). Always set it — when a case is
  filed, the value is sent as the ingest `urgency`. For a standalone summary,
  it is the ONLY emoji on the top-level line and drives channel routing.
- **Standalone top-level post = ONE line, verdict first, scannable in two
  seconds:** This applies whenever the condition above requires a standalone
  line. Otherwise, the new case alert is the top-level message.

  ```text
  <status emoji> <Scanner> <run/UTC> — <verdict in <=6 words> —
  <the one number that matters> · detail in thread
  ```

  Bold at most ONE number, and that number is the STILL-LIVE (last-1h) Anthropic
  $ — the spend that can still burn is the decision-driver. The 24h total is
  secondary: append it unbolded, e.g. `*$Y* live last 1h · $X 24h Anthropic
  total`. Never bold the 24h total. No hype adjectives ("escalated hard",
  "ACTIVELY BURNING", "highest yet"), no :rotating_light: or :warning:
  decoration, no bullets on the top-level line. If nothing cleared the gate, that
  one line says so and stands alone — still open the thread for standing detail.
  Don't manufacture patterns. If a query timed out, the verdict must say
  `query timeout` so a degraded run cannot look like a quiet one.

### Status rubric (green / yellow / red)

The status emoji is semantic and reflects **what action the run needs**, not
merely whether any tracked account is spending:

- `:red_circle:` — **enforcement needed fast.** We want to move to enforce
  restrictions quickly: a new account/cluster meeting the materiality gate, a new
  frontier block to file, or an enforcement gap that meets the rule below. A gap
  is a target in `approved` status with `restriction_id IS NULL`, or a target in
  `pending_review`, whose run-computed live $ (trailing-1h Anthropic) is above
  $50 or, for a pivoted ring, whose run-computed non-Anthropic trailing-1h
  aggregate is above $50. A target whose enactment was skipped as
  `frontier_us_models_exempt` is resolved and never constitutes a gap.
  Page red on the first run that observes the gap. For the same `ruleKey`, the
  comparison figure is the figure in the most recent red gap post for that key
  in `conversations.history` on `C0BJ51BK7P0` (#alerts-tns); this history is
  shared across all three scanners, so first-observation and re-page dedup are
  per `ruleKey`, not per-scanner playbook. Re-page only when the applicable
  run-computed amount — Anthropic live $ or the pivot aggregate — exceeds the
  figure last reported red or when the gap has persisted for ≥8h since the last
  red post. An already-paged unchanged gap is at least
  yellow, never green; list it under the **Context** slot and post per its
  emoji like any other run. The **Gap** line remains for degradation and
  staleness.
- `:large_yellow_circle:` — **needs a human eye, but enforcement is not clearly
  warranted yet.** A genuinely ambiguous/borderline item that requires human
  judgment this run — not a settled watchlist entry.
- `:large_green_circle:` — **nothing to act on.** No new gated candidates,
  nothing pending, enforcement gap closed. This is green **even if allowed or
  watchlisted accounts are still spending** — spend we are knowingly holding
  (e.g. a lone account with a coherent identity, or a sub-gate stockpile we're
  watching) does NOT make a run yellow. Report it in the thread, but the run is
  green.

Rule of thumb: if the only "signals" are things already decided (held accounts,
sub-gate watchlist) and there is no open action, the run is green. Reserve yellow
for a real judgment call and red for "act now".

- **Standalone-summary channel routing — post any standalone summary from the
  condition above to EXACTLY ONE channel, keyed on the emoji:**
  - `:red_circle:` → the alerts channel `C0BJ51BK7P0` (#alerts-tns).
  - `:large_yellow_circle:` or `:large_green_circle:` → the runs channel
    `C0BL5TQG45C` (#tns-scanner-runs). Do NOT post run reports to
    `C0BAUNXTXHR` (#brain-talos) — that channel is for humans directing the
    agents, not for scanner run logs.
  - `C0BL5TQG45C` (#tns-scanner-runs) is a machine log reviewed on a best-effort
    daily skim, not actively watched. Anything needing timely human action this
    run must be red; yellow remains routed there by design.
  - If posting to `C0BL5TQG45C` fails (e.g. `not_in_channel`), post the run to
    `C0BJ51BK7P0` (#alerts-tns) instead, force the status to at least
    `:large_yellow_circle:`, and state the delivery failure on the top-level
    line, not in the **Gap** thread reply.
  - Never post the same run to both channels.
- The top-level line and every thread reply — standalone or on an ingest case
  alert — must not contain raw account emails or other direct PII. Use Sentinel
  queue links and user ids. Cohort-level attributes inside `ruleKey`s and
  evidence — first-6 BIN, issuer country, funding type, and email TLD/domain —
  are allowed; direct identifiers (raw emails, names, full card numbers, and
  addresses) are not.

One exception overrides green: a run that fell back to a stale checkout for the
spec (see [Reading this file](#reading-this-file)), or reached the query timeout
ceiling (see [ClickHouse connection](#clickhouse-connection--mandatory-read-first)),
is at least yellow, whatever its findings — its findings were produced against
stale instructions or degraded execution, so the status must not read as clean.


- **Thread (replies to the top-level post)** — everything a reviewer needs, kept
  out of the channel:
  - Rank by what a human still has to decide: enforcement-state gaps (approved
    but not enacted, archived while pending, enacted but still burning) outrank
    watchlist and unchanged-cohort recitations, which collapse to one line.
  - Use this order: actionable NEW / UPDATED case blocks first, one mandatory
    **Context** line on every run (including green runs with no cases), then a
    **Gap** line when execution degraded, then an **Also tracked** tail when
    genuinely open watchlist, held-account, drift/method, or sweep items remain.
  - When a run files cases and threads its findings onto ingest-returned case
    alerts instead of a standalone summary, repeat the run-level **Context**
    (and **Gap** / **Also tracked** when present) at the end of EVERY case
    thread the run posts to, so each case thread is self-contained and a
    reviewer never has to hunt through sibling cases for run-level context.
  - Each NEW / UPDATED case block owns its data: bold `NEW` or `UPDATED` plus
    `<new_members>` new / `<total>` total targets when new members exist,
    optionally followed by a short status annotation, or a verdict alone when
    none do, the `ruleKey` in backticks, and one line of selected facts. Derive
    `new_members` by diffing the posted set against targets read before posting,
    not from `targetsUpserted`, which counts posted target keys. When
    `<new_members>` is below `<total>`, identify the new members in the case
    thread.
  - Keep at most ~2 facts per NEW / UPDATED case. The money fact is the
    mandatory live-led split — live $ (last 1h), 24h Anthropic spend, and
    restricted $ — and counts as one fact; never drop or collapse this split.
    When significant, carry other-author live $ (last 1h) and its top author(s)
    in that same money fact. Report `restricted $0` explicitly when it is zero.
    Drop uninteresting detail such as per-account rosters or per-account dollar
    breakdowns, KYC essays, false-positive-risk boilerplate, unchanged-cohort
    recitations, and restated normal findings. Include false-positive risk only
    when it is a genuine judgment call. Aggregate or context numbers get one
    short line, not a separate section.
  - A cluster-level geo shape — one issuer country across many unrelated
    network countries, or the reverse — may occupy one selected fact slot when
    it is part of the rationale. A per-account mismatch or a coverage statistic
    never earns a Slack fact slot.
  - The mandatory **Context** line may summarize the trigger set, aggregate counts,
    materiality crossers, proposed `frontier_us_models` targets, Anthropic spend
    ($/24h), Anthropic share, restricted $, live $ (last 1h), and enforcement
    gaps. Keep it to one line and omit normal or redundant values. If there are
    no NEW / UPDATED case blocks, the thread still contains this line and adds
    **Gap** when execution degraded and **Also tracked** only when something is
    genuinely still open.
  - **Gap** is concrete degradation plus its staleness age and impact, not merely
    "fell back to previous target sets": e.g. `query timeout; reused r170
    ring-membership targets, 1h stale`. Include it whenever a timeout or other
    degraded execution affected this run.
  - **Also tracked** is a demoted tail: use one line per genuinely still-open
    tracked thing (for example, a sweep result, watchlist item, or method
    drift), not a second case list.
- **Never tag another agent.** An agent handle may appear only for the live KYC
  ask to Sniffer described below. Every other agent reference — research
  recaps, status, a decision waiting on a human, or a cohort — uses the plain
  name with no handle. A handle is a work order; a recap is not. Human
  mentions are unaffected, and the top-level line never carries any mention.
- **KYC escalation to Sniffer** — Sniffer is an agent that can run a `kyc` check
  and research a specific customer, the escalation path for a genuine,
  unresolved, new KYC ask when an account has high usage and it is genuinely
  unclear whether it is legitimate. Ask in the thread only and sparingly, using
  prod `sniffer` with `<@U0ANC3T3U0Y>`; plain `@sniffer` text does not ping.
  The hard cap is two asks per run (normally one). Reserve them for genuinely
  ambiguous or borderline individual accounts where a new KYC read could change
  the decision. Never raise one for an account already filed, already
  restricted, or settled on the watchlist; do not fan asks out across a cohort.
  Use the handle only for a genuinely new, unanswered KYC question: no prior
  Sniffer read is in hand, and the report does not reference, summarize, or
  build on one. Any account whose Sniffer research the report references,
  summarizes, or builds on is plain-name and unpinged, even while the item
  remains open and the pending decision is material. If it is unclear whether
  the question is new, fail closed to plain-name and unpinged; never ping on an
  unverified "probably not answered yet." The top-level line never contains
  these asks and remains one line with only the status emoji.
- **Sentinel links** — for every NEW or UPDATED case (new candidate, changed
  target set, changed Anthropic spend, or newly crossed threshold), put its
  Slack-formatted case link first in the case block:
  `<https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates/<suggestionId>|Open Sentinel case>`.
  Use a `q=` ring query only when showing all sibling cases, and say that it
  matches `ruleKey` by substring. Use `state=archived` for archived queries.
  Summarize unchanged re-files in one line ("N clusters unchanged, re-filed
  as upserts"). This `internal.openrouter.ai` URL is a human-facing UI link
  behind Cloudflare Access for a Slack reader to open in a browser — it is NOT
  a programmatic API call, so it is unaffected by how the CLI reaches the
  ingest API.
- **Every `ruleKey` named outside a NEW / UPDATED case block is a link.** In
  practice, this applies to **Also tracked** bullets: keep the key backticked
  and use a rule-key queue link when showing sibling cases, or a case-id link
  when naming one specific case. The case-block convention above remains
  unchanged. Archived cases use `state=archived` instead of `state=all`. If no
  rule key appears anywhere in the thread, hang one unfiltered queue link off
  the **Context** line:
  `<https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates?q=&state=all|Open Sentinel queue>`.
- **Pre-post self-check** — before posting, resolve every `<@...>` / `@name` in
  the composed post/thread to its target identity; remove agent-targeted
  mentions except the permitted live, unresolved, new KYC ask to Sniffer
  described above, while leaving human mentions intact. Also scan for any
  backticked rule key outside a NEW / UPDATED case block not accompanied by a
  queue link, or a case-id link when naming one case, and fix it.
- The filed candidates and their per-account targets (full identifiers, evidence,
  per-target Anthropic spend) live in the Sentinel queue reachable by those links
  — link there instead of dumping account rows or a full-email `.tsv` into Slack.
- A compact thread should render like this; keep this fenced example so scanner
  runs can pattern-match the structure:

  ```text
  *Autobuy Scanner · run 184 · 19:00–20:00 UTC*

  *NEW — 12 new / 12 total targets*
  <https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates/00000000-0000-4000-8000-000000000001|Open Sentinel case>
  `autobuy_synthetic_quest_bin436797_hk_tw_frontier_block`
  Synthetic `.quest` ring · $3,608 live last 1h · $4,935 Anthropic/24h · restricted $0

  *UPDATED — 2 new / 7 total targets · pending review*
  <https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates/00000000-0000-4000-8000-000000000002|Open Sentinel case>
  `autobuy_bin450306_sg_debit_datacenter_frontier_block`
  Enacted for `user_3Gk2vT9qLxWbNpD41sZaYcEfMhR` · $0 live last 1h · $21,125 Anthropic/24h · restricted $21,125

  *Context*
  465 top-ups / 361 accounts / $42.3k this hour · 33 materiality crossers · $155.7k Anthropic/24h total

  *Gap*
  query timeout; reused r170 ring-membership targets, 1h stale

  *Also tracked*
  • Watchlist hold: one coherent identity remains below the action gate
  • Bypass sweep: 1 unrestricted entity, already filed as `autobuy_org_entity_bypass_bin493724_frontier_block` <https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates/00000000-0000-4000-8000-000000000003|case>
  • Sweep complete: no new method drift
  ```

  A green zero-case run should render like this:

  ```text
  *Context*
  0 new gated candidates · 0 materiality crossers · $0 live last 1h · $0 Anthropic/24h · restricted $0 · <https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates?q=&state=all|Open Sentinel queue>
  ```

## Terminology

In all Slack output (top-level line, thread, per-cluster lines), label the dollar
figure with its basis and window — for example, "Anthropic spend ($/24h,
upstream COGS)" — never "exposure" (ambiguous). If you report a different
window or the queue's billed-usage-plus-BYOK `spend_30d`, name it explicitly.
When breaking the figure into already-enforced vs still-active portions, label
them "restricted" (banned or Anthropic-restricted now) and "live" — not
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

The card-derived count keys use the following per-account query:

```sql
SELECT
  charges.clerk_user_id AS clerk_user_id,
  uniqExactIf(
    cards.fingerprint,
    cards.fingerprint IS NOT NULL AND cards.fingerprint != ''
  ) AS distinct_card_fingerprints_attempted,
  uniqExactIf(
    cards.fingerprint,
    cards.fingerprint IS NOT NULL
      AND cards.fingerprint != ''
      AND charges.status = 'succeeded'
  ) AS distinct_card_fingerprints_charged,
  uniqExactIf(
    cards.iin,
    cards.iin IS NOT NULL AND cards.iin != ''
  ) AS distinct_bins_attempted
FROM analytics.stg_stripe_charges AS charges
INNER JOIN analytics.stg_stripe_card AS cards
  ON charges.card_id = cards.id
WHERE charges.clerk_user_id IN {clerkUserIds:Array(String)}
  AND charges.card_id IS NOT NULL
  AND charges.card_id != ''
GROUP BY charges.clerk_user_id
```

The join drops charges with no card row, such as crypto and wallet flows. Keep
the attempt counts and card-entry count on the charges table for that reason.
If this query returns no row for an account, every card-derived key is zero.
Scanners must write every card-derived key rather than omit it, because omission
can violate the shared-key floor. Unless a scanner defines a time window, use
the query's per-account scope.

- `distinct_card_fingerprints_attempted`: `uniqExactIf(cards.fingerprint, cards.fingerprint IS NOT NULL AND cards.fingerprint != '')` over charge attempts with a matching card row.
- `distinct_card_fingerprints_charged`: `uniqExactIf(cards.fingerprint, cards.fingerprint IS NOT NULL AND cards.fingerprint != '' AND charges.status = 'succeeded')` over succeeded charge attempts with a matching card row.
- `distinct_bins_attempted`: `uniqExactIf(cards.iin, cards.iin IS NOT NULL AND cards.iin != '')`
  over charge attempts with a matching card row. The reviewer console uses the same non-empty IIN
  predicate on succeeded charges only, so its BIN list can differ. A
  succeeded-only BIN count must use a scope-suffixed key instead of reusing
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

On repost, resend the at-filing snapshot verbatim alongside current figures.
The exception is a figure originally filed under a retired key. Recompute it
under the new key instead of renaming or resending the old value. Carry it
forward only if it was recomputed over the original window.

## Per-scanner deltas

Only these differ between scanners; everything above is shared.

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
  on that credit row; for a wake with no re-load, use
  `analytics.stg_generations.country` over the emergent-usage window. The
  reviewer panel's signup/onboarding country is the dormant account's original
  network context: keep it as separate context, not as the network slot in this
  comparison.
- **Dormancy:** establish it on lifetime history, never on the trailing window
  the trigger set uses. A wake whose account carries lifetime funding, prior
  traffic, and keys older than the wave is a
  [compromised-key](#compromised-key-gate) candidate, not a sleeper cell.
- **Reporting window for filed spend:** 24h.

### Recent Signups Scanner

- **Source key:** `recent-signups-scanner`.
- **Role:** pre-emptive — identify accounts (and clusters) that look stood up to
  abuse the platform, early enough to propose a block before harm. No money is at
  risk yet and blocking a real new customer chills growth, so favor precision:
  prefer clusters with converging evidence over lone borderline accounts, and
  quantify how many real-looking accounts a proposed rule would also catch.
- **Trigger set:** all accounts that signed up in the rolling last 24h,
  regardless of whether they've added credit.
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
  **Mandatory guard before proposing:** the shape alone is not rare — on
  `outlook.com`, `^[a-z]{6,}[0-9]{4}$` matched 3,880 of 5,016 signups on
  2026-08-15 and 5,810 of 6,321 on 2026-08-16 — so compare the cohort's
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
  Worked example, measured 2026-08-19 on the payments bar above over
  `outlook.com` accounts created 2026-08-15 through 2026-08-18: the 11,704
  shape-matching accounts converted at 2.36% (276 payers, none enforced) against
  3,118 same-window non-matching accounts at 11.16% (348 payers), a ~4.7x gap.
  For contrast, the whole-domain all-ages rate is 3.4% (11,140 of 328,080),
  which is *not* a valid baseline for a 4-day-old cohort: it mixes account ages
  and would understate the separation. The signal's first filing came from a
  human-directed dormant-funded-account analysis rather than a scanner run
  ([case 01a0184a](https://internal.openrouter.ai/admin-utils/sentinel/ban-candidates/01a0184a-097e-75e2-a36f-10246df7810e),
  181 targets, `frontier_us_models`, `pending_review`).
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
  fingerprint-clustering signals above.
- **Geo evidence:** compare the payment-time network country with the issuer
  country of the card funding the top-up under adjudication. Neither side has a
  live reviewer read at that granularity — query
  `analytics.stg_credits.cf_ipcountry` and `analytics.stg_credits.card_country`
  on the credit row for the top-up under adjudication, which carries both on
  one row alongside the `cf_asn` above. Geo remains corroborating only.
- **Reporting window for filed spend:** 24h.

### Anthropic Concentration Monitor

- **Cadence:** daily.
- **Role:** track whether the share of platform spend coming from
  Anthropic-concentrated billing entities not currently enforced against is
  going back up. It reports a fraction, not a dollar level: the level moves with
  weekday and platform volume, and a leak large enough to matter is a rounding
  error against total spend.
- **Trigger set:** the latest settled UTC day in
  `analytics.fact_daily_generations_activity`. Never the current UTC day — that
  mart settles nightly and a half-loaded day reads as a spend drop, not an
  error. Apply the monitor's freshness gate before interpreting any result.
- **Reporting:** report-only and disjoint from the three fraud scanners. It
  files no ban-candidates, and the shared materiality gate does not apply. Every
  post links the
  [Anthropic Ban Impact Hex app](https://app.hex.tech/091db13f-d26f-4224-a185-6fce9df76f90/app/Anthropic-Ban-Impact-033tvUU2vmL90YPpTEhjt9/latest).
- **Routing:** overrides the shared emoji-keyed routing: every run, whatever the
  emoji, goes to the alerts channel `C0BJ51BK7P0` (#alerts-tns), never the runs
  channel `C0BL5TQG45C` (#tns-scanner-runs).
- **Residency:** no exception was granted and none is claimed. The aggregate
  series reads daily spend out of
  `analytics.fact_daily_generations_activity`, which carries no prompt or
  completion bytes and no residency dimension, so its totals include
  EU-attributed dollars and
  [.claude/rules/regional-routing.md](../../../.claude/rules/regional-routing.md)
  — scoped to "prompt/completion data" — does not reach them. The
  identifier-bearing drilldown is where this file's global-only scoping bites:
  it drops any entity whose `data_region` is anything other than `global` over
  the fetched window before a name reaches Slack. Consequence to state in the
  thread when it happens: a RED can be driven by an entity the drilldown then
  refuses to name, so the alert has nothing to open. Report the trigger, say the
  drilldown returned fewer rows than the trigger implies, and stop there.
- See
  [ANTHROPIC_CONCENTRATION_MONITOR.md](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/kyc/sentinel/ANTHROPIC_CONCENTRATION_MONITOR.md)
  for the cut definitions, restriction population, queries, and thresholds.
