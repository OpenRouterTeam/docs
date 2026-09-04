---
name: mail-relay-ring-adjudication
description: Adjudicate a Sentinel case that groups accounts by a shared mail relay or mail-domain family — decide whether the relay is operator infrastructure or a commercial host, then derive the per-account signals that justify or refuse enforcement.
allowed-tools: Bash
user-invocable: true
---

# Mail-relay ring adjudication

Use this when a case groups accounts by something their mailboxes share — an MX
relay, a domain family, a catch-all domain — rather than by their own behaviour.
Relay membership is one shared attribute, so it is a lead. This skill turns the
lead into an account-level decision: classify the mail infrastructure, measure
each candidate signal against a control, and enact only what clears the
two-independent-signals bar in
[`SCANNER_SPEC.md`](../../../packages/kyc/sentinel/SCANNER_SPEC.md).

## 1. Classify the mail infrastructure

Resolve every domain in the family before touching account data. The decisive
question is whether the operator could plausibly be a *customer* of the relay or
must be its *owner*.

`dig` is not installed. Resolve over DNS-over-HTTPS:

```bash
curl -s -m 10 "https://dns.google/resolve?name=<domain>&type=MX"
curl -s -m 10 "https://dns.google/resolve?name=<relay-host>&type=A"
```

Classify each domain:

- **Free dynamic-DNS hostname** — a third-level name under a public dyndns pool
  (No-IP and similar: `ooguy.com`, `casacam.net`, `freeddns.org`, `camdvr.org`,
  `mywire.org`, `accesscam.org`, `ggff.net`, `webredirect.org`). A mail host
  cannot sell service on a name it does not control, and no real organisation
  runs its mail on one. A family that contains these is operator-minted, which
  excludes the "cheap commercial host with a skewed customer base" alternative.
- **Registered vanity domain** — a name the operator bought. Neutral on its own;
  read it together with the rest of the family.
- **Brand-shaped or typosquat name** — a hostname imitating a real vendor or
  product. Corroborates operator control.

Also resolve the relay host itself and any sibling relays: several relay
hostnames on one IPv4, or a relay whose own apex advertises temp-mail, is the
same operator behind several families. State this classification explicitly in
the case verdict — the reviewer's decision turns on it.

## 2. Measure the family's realized harm

Enforcement history on the family is the co-tenant signal. Keep the domain list
in a file and interpolate it.

User, key, and restriction state comes from the CDC mirrors
(`clickpipe_postgres_gcp_uscentral1.public_*` with `final` and
`_peerdb_is_deleted = 0`) rather than the `analytics.stg_*` views the rest of the
spec uses, because adjudication reads live account state — a restriction filed or
revoked today must not be inferred from a lagging view. Behavioural data
(generations, spend) still comes from `analytics.stg_*`.

```sql
with fam as (
  select clerk_user_id
  from clickpipe_postgres_gcp_uscentral1.public_users final
  where _peerdb_is_deleted = 0 and deleted = false and email is not null
    and lower(splitByChar('@', assumeNotNull(email))[-1]) in ({domains})
), r as (
  select entity_id, kind, source
  from clickpipe_postgres_gcp_uscentral1.public_restrictions final
  where _peerdb_is_deleted = 0 and revoked_at is null
    and (expires_at is null or expires_at > now())
)
select r.kind as kind, r.source as source, count() as restrictions
from fam inner join r on r.entity_id = fam.clerk_user_id
group by kind, source order by restrictions desc
```

A family whose accounts already carry *behavioural* restrictions filed by other
rules has realized harm; a family whose only restrictions came from
infrastructure sweeps like this one has not, and citing those is circular.

## 3. Derive account-level signals, each against a control

Every signal needs a denominator from outside the family, computed by the same
query. Cohort-match the control: restrict both sides to a comparable signup
window, or a latency percentile over unbounded account history will be dominated
by keys minted years after signup.

**Mailbox generator fingerprint** — one template producing every local part:

```sql
with live as (
  select lower(splitByChar('@', assumeNotNull(email))[-1]) as dom,
         lower(splitByChar('@', assumeNotNull(email))[1]) as local
  from clickpipe_postgres_gcp_uscentral1.public_users final
  where _peerdb_is_deleted = 0 and deleted = false and email is not null
)
select if(dom in ({domains}), 'family', 'platform') as cohort,
       count() as accounts,
       countIf(match(local, '^[a-z]+[0-9]{3}$')) as generated,
       round(100 * countIf(match(local, '^[a-z]+[0-9]{3}$')) / count(), 3) as generated_pct
from live group by cohort order by cohort
```

Generated-looking local parts are common platform-wide (~10%), so the share
alone proves nothing. What carries information is the *same* template across the
whole family, and name stems reused across unrelated domains in it — measure
stem reuse against a size-matched set of unrelated domains, not against the
platform.

**Key-mint latency** — signup to first live API key:

```sql
with u as (
  select clerk_user_id, created_at as signup_at,
         lower(splitByChar('@', assumeNotNull(email))[-1]) as dom
  from clickpipe_postgres_gcp_uscentral1.public_users final
  where _peerdb_is_deleted = 0 and deleted = false and email is not null
    and created_at >= {cohort_start} and created_at < {cohort_end}
), k as (
  select clerk_user_id, min(created_at) as first_key_at
  from clickpipe_postgres_gcp_uscentral1.public_api_keys final
  where _peerdb_is_deleted = 0 and deleted = false
  group by clerk_user_id
)
select if(u.dom in ({domains}), 'family', 'control') as cohort,
       count() as accounts_with_key,
       countIf(dateDiff('second', u.signup_at, k.first_key_at) <= 30) as key_within_30s
from u inner join k on k.clerk_user_id = u.clerk_user_id
group by cohort order by cohort
```

Onboarding mints a key by itself, so fast minting is enrichment, never a
standalone signal. Cross-domain concentration is the stronger form: count
signup minutes containing accounts from several different domains in the family.

**Own-model spend** — what has actually been lost:

```sql
select uniqExact(clerk_user_id) as users, count() as generations,
       round(sum(if(isNull(openrouter_non_byok_usage),
                    if(provider_api_key_id is null, usage, 0),
                    openrouter_non_byok_usage)), 6) as own_spend
from analytics.stg_generations
where data_region != 'europe' and clerk_user_id in ({targets})
```

Zero own spend means the block is pre-spend, not that the accounts are harmless.
Free-model volume is capacity consumption, not overdraft — report it separately
and do not convert it into a spend claim.

## 4. Find what the case missed

The filing rule's own gates hide part of the population. Re-run the family
without them, excluding the filed targets and anyone already restricted, and
report what comes back: dormant accounts the rule skipped, and *active* accounts
its dormancy gate excluded by construction. Then check specificity — apply the
same heuristics platform-wide, without the family filter. A heuristic that
returns tens of thousands of unrestricted accounts is not filable on its own,
and saying so is the finding.

## 5. Decide, then act

- Run the
  [compromised-key gate](../../../packages/kyc/sentinel/SCANNER_SPEC.md#compromised-key-gate)
  on every target first. An account whose burst runs on a key that predates it,
  with its own funding and prior traffic from a real origin, is a
  compromised-key victim: never approve or enact against it — leave it
  `pending_review` and escalate for key revocation, holder notification, and
  crediting the negative balance.
- Enact only where the account's own mailbox provenance plus a second
  independent account-level signal both hold. Partition the targets and name the
  partition in the review notes.
- Leave every target that fails the bar `pending_review`. Do not drop them.
- Never propose a full account ban for a dormant pre-spend account through the
  agent path; file it and hand it to a human. Where the remedy is meant to stop
  inference rather than lock the user out of the UI, the kind to propose is
  `inference_block`, not `account_ban`.
- When this case already holds those accounts as pending targets and only the
  proposed kind is wrong, the change belongs on that case rather than in a
  second case for the same accounts: report its case link, the target ids, and
  the kind that fits, and leave the change to a human — it is a review-key
  operation the agent path cannot sign. See
  [Changing the proposed kind](../sentinel-ban-candidates/SKILL.md#changing-the-proposed-kind-not-filing-a-second-case).
  Every kind the ingest accepts is a valid destination for that change,
  `inference_block` included.
- The root-cause control for an operator-owned family is registration-side, not
  account-side: file it as a separate domain-target case, propose-only, and say
  in the case that it does not ask for the existing accounts to be restricted.

Mechanics and the review/enact batch limits are in
[`sentinel-ban-candidates`](../sentinel-ban-candidates/SKILL.md).
