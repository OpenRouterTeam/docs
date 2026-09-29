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

The CLI builds and authenticates requests and handles HTTP errors. Callers only need to
construct the ingest JSON and choose the appropriate command.

Write every case `description`, target `evidence` reason, `--reason`, `--notes`,
and Slack thread reply per the
[Writing style](../../../packages/kyc/sentinel/SCANNER_SPEC.md#writing-style)
section of `SCANNER_SPEC.md`.

## Permission model

Every ban-candidates route requires a verified identity: an internal-admin Clerk session cookie (Mission Control) or a Devin OIDC bearer (this CLI). There are no signing keys. Devin requests are agent requests: `/enact` and review approvals (`/review`, `/review/batch`) apply the agent policy gates (no full bans, allowlisted kinds, user targets, PAYG-only). Mission Control requests keep the ordinary semantics and may opt into agent gating with `agentEnactment: true`. A request body that names a Clerk user (`reviewerId`, `actingClerkUserId`) is rejected with 400 on every path.

## Authentication

From a Devin session, run the CLI directly. It exchanges the session's general OIDC token (`/opt/.devin/oidc_token`) at the Devin issuer for a 60-second bearer scoped to `https://openrouter.ai/api/v1/internal` and sends it as `Authorization: Bearer`. The exchange first asks for a token bound to the requesting human (`subject_keys=org_id requesting_user_email`) and, when the issuer answers 400 because the session has no human requester, retries bound to the session alone (`subject_keys=org_id`). The server verifies the issuer signature, audience, and Devin org. When the token names a requester, that person must be an `@openrouter.ai` internal admin and mutations are attributed to their Clerk user. Otherwise mutations are attributed to `devin:<devin_id>`, which links back to the session at `https://openrouter.devinenterprise.com/sessions/<devin_id>`.

```bash
bun scripts/sentinel/ban-candidates.ts list pending_review
```

Run the script directly, not through `bun run x` or `bun run sentinel:ban-candidates`: those wrap it in `infisical run`, which has no login session on a Devin box, and the CLI needs no Infisical secrets.

Exit 4 with `Devin OIDC is unavailable` means the session token file is missing or the exchange failed. Exit 6 with HTTP 401 means the token was rejected, or the named requester is not an `@openrouter.ai` internal admin.

Local development can point at a local worker with `CFW_INTERNAL_URL=http://localhost:8794`. In production and automation, `CFW_INTERNAL_URL` is normally unset, so the CLI uses the production `https://openrouter.ai` default.

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
  --notes 'authorized by <reviewer> in thread' <targetId> <targetId> ...
bun run sentinel:ban-candidates enact --yes <targetId> <targetId> ...
bun run sentinel:ban-candidates archive <suggestionId> --reason 'no longer actionable'

# Reverse enacted targets, recording who asked and why.
bun run sentinel:ban-candidates revoke --reason fp_confirmed \
  --note 'lifted at <requester> request in thread' <targetId> <targetId> ...
```

`review` takes up to 1000 target ids per call and posts one Slack notification
per call; `enact` takes up to 500 target ids per call. Both reject a longer list
outright, so a case above those sizes is decided in the smallest number of
full-width chunks — never one call per target. A review whose
targets are not all `pending_review` on the named case fails as a whole with
409, so re-read `targets <suggestionId>` and resend the still-pending set.
Archiving freezes a case at ingest. New detections neither add targets nor
refresh it until a human unarchives it in Mission Control. The CLI never names
an acting Clerk user: mutations are attributed to the requester the OIDC token
names, or to `devin:<devin_id>` when it names none, so put the authorizing
human in `--notes` or `--note`. Unarchive is Mission
Control only.

`revoke` takes up to 500 target ids per call and revokes each target's enacted
restriction. `--reason` is required and must be one of `fp_confirmed`,
`compromised_key_victim`, `duplicate`, `downgrade`, `operator_error`,
`customer_resolved`, or `other`. Name the human who asked for the reversal in
`--note`.

### Compromised-key gate — run before `review` and `enact`

Before approving or enacting any target, run the compromised-key gate — it is
canonical in
[`SCANNER_SPEC.md`](../../../packages/kyc/sentinel/SCANNER_SPEC.md#compromised-key-gate),
including the victim-recognition signals, window discipline, the
relay-uniformity-is-one-signal rule, and BYOK exposure ranking. A trip is a
hard stop: do not `review ... approved` and do not `enact`. File for
visibility, leave every target `pending_review`, escalate to a human for key
revocation, holder notification, and crediting the negative balance, and file
the revocation as its own `targetType: api_key` case (see
[API-key targets](#api-key-targets)) so the human reviews and enacts it in
Mission Control rather than tracking it out of band.

## Abuse rules

The same CLI and ingest key drive the agent surface of the request-time abuse
rules engine at `/api/v1/internal/abuse-rules/agent` (list, create, update).
Agents may only shape `log_only` rules. The server refuses, and the CLI never
offers, anything that changes live enforcement:

- `PUT` on a rule whose stored mode is `enforce` returns 403.
- Request bodies that carry `mode` or `enabled` return 400. A created rule is
  `log_only` and enabled; an update keeps the stored mode and enabled flag.
- Enable, disable, expire, and killswitch mutations are Mission Control only.

Creates and updates are accepted while the killswitch is engaged. The rule is
persisted, but the response reports `"published": false` and
`"killswitch_engaged": true` until a human disengages the killswitch in
Mission Control. `"killswitch_engaged": null` means publication failed
before the killswitch state was read.

```bash
bun run sentinel:ban-candidates rules list [--mode log_only] [--enabled true] [--include-expired]
bun run sentinel:ban-candidates rules create /tmp/rule.json
bun run sentinel:ban-candidates rules update <ruleId> /tmp/rule.json
```

The JSON file is the console editable-field shape (`name`, `description`, `rule_type`, `filters`, `restriction_kind`,
`restriction_params`, `expires_at`). An update additionally needs
`expected_version` set to the `version` returned by `rules list`; a stale value
returns 409. Read `packages/db/abuse-rules/README.md` for the filter grammar.

## Examples

Read-tier commands run against production with the ingest key. The values below
are illustrative placeholders, not live data:

```bash
# Pending suggestions — returns JSON rows like:
# {"id":"00000000-0000-4000-8000-000000000000","source":"autobuy-scanner",
#  "ruleKey":"autobuy_example_bin000000",
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
`frontier_us_models`, with a literal domain or a `*.<apex>` wildcard in
`targetValue`, and are stored as candidates for review. The retired legacy
`domain_block` proposal kind is rejected at ingest. A row with
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
  "ruleKey": "autobuy_example_bin000000",
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
stored `description`, `confidence`, and `urgency` from the new request body, so
re-posting with one observed target is the way to update reviewer-facing
framing on a live suggestion; archived suggestions are frozen and skip this
refresh. Which members to post, denied-member and denied-only-run handling,
re-open reports, and how to set the refreshed description, confidence, and
urgency from the accumulated non-denied set are governed by the spec — see
[Propose via the ban-candidates API](../../../packages/kyc/sentinel/SCANNER_SPEC.md#propose-via-the-ban-candidates-api)
and the
[case-block count format](../../../packages/kyc/sentinel/SCANNER_SPEC.md#case-block-count-format).

### Changing the proposed kind, not filing a second case

A target's `proposedKind` is part of its deduplication identity, so re-posting
an account with a different kind adds a second target beside the first instead
of replacing it. When the accounts are already targets of a live case and only
the remedy is wrong, that is a change to the existing case: change the proposed
kind in place rather than filing a parallel case or minting a new `ruleKey` for
the same accounts. Because the remedy can change under a live key, a new
`ruleKey` names the pattern it identifies and not the kind proposed for it —
`autobuy_example_bin000000`, not `autobuy_example_bin000000_frontier_block`. A
ring an earlier run filed under a remedy-suffixed key keeps that key, taken from
that run's case link; posting a key is not a way to look one up, because a key
with no case gets one.

The change goes through the review-key route
`POST /api/v1/internal/sentinel/ban-candidates/proposed-kind/batch` with
`{suggestionId, targetIds, proposedKind, proposedTarget, proposedParams,
proposedExpiresAt, actingClerkUserId}`, which answers
`{updated, conflicted, skipped, unknown}`. Mission Control's case workspace wraps it: an
administrator selects the pending targets, picks the new kind, and the page
batches the request behind their Clerk session. No CLI command wraps it, and
ingest-key (agent-signed) requests are rejected with 403, so a detection agent
that concludes a different kind fits names the case link, the target ids, and the
kind it wants in the case thread and leaves the case as filed.

The body is a replacement, not a patch: `proposedParams` overwrites the stored
params, so a kind that requires params carries them on every change —
`rate_limit` needs `rpm` or `rpd`, `spend_cap` needs `limit_usd` — and sending
none for those is a 400, not a default. `proposedTarget` and `proposedExpiresAt`
are written unconditionally, so omitting either clears what the target held — an
expiry only a rate-limit kind can carry in the first place. `actingClerkUserId`
is optional and falls back to `ACTING_SYSTEM`; the write leaves no row on the
case, so the `ban_candidate_proposed_kind_change_summary` log line is the only
record of who swapped the remedy, and it lives under log retention. Always send
it.

Every restriction kind the ingest accepts is a valid destination,
`inference_block` included; the body takes the same kind, target, and expiry
rules as ingest and the same params parsing, but ingest additionally requires a
positive spend-cap limit while the change route accepts `limit_usd: 0` so
Mission Control can freeze spending. A scoped kind (`provider_ban`, `model_ban`,
`author_ban`, the scoped rate limits, `spend_cap`) needs the `proposedTarget`
slug it scopes to and an account-wide kind must not carry a non-empty
`proposedTarget`. Scoped targets are checked against real data: models must be
exact model permaslugs, authors existing author slugs, providers known provider
names, and spend caps `daily`, `weekly`, or `monthly`; unknown values return 400
before anything is written. Mission Control's dialog offers the account-wide
kinds plus `spend_cap` with its `daily`, `weekly`, or `monthly` period; a scoped
ban or scoped rate limit needs a slug the dialog has no field for, so it is a
hand-signed request.
The request never fails closed on the target set: it answers 200 and classifies
every id it did not update. `conflicted` counts ids the case does not hold as
pending — missing, belonging to another case, or no longer `pending_review`,
which here usually means `already_restricted`, the status ingest reports as
`targetsAlreadyRestricted`, rather than an approval or a denial. `skipped` counts
ids that are still pending but lost the destination identity (`suggestion_id`,
`target_value`, `proposed_kind`, `proposed_target`): another target for the same
account already holds that kind and slug, or two ids in the request are the same
account and only one of them can take it — a case holding `user_X` twice from an
earlier re-post answers `{updated: 1, skipped: 1}` with no sibling under the
destination kind to find. Resending clears neither. Read
`targets <suggestionId>`, report the sibling and its status, and leave retiring
the redundant target to a human: a denial is terminal and takes the account
off-limits under every `ruleKey`. Changing the kind leaves the targets
`pending_review`; it is neither an approval nor an enactment.
If the post-write target reload fails, `unknown` counts the non-updated ids whose
final state could not be verified; reload the case before acting on them.

### Slack reporting contract

The reporting contract is canonical in
[`SCANNER_SPEC.md` → Output](../../../packages/kyc/sentinel/SCANNER_SPEC.md#output--post-to-slack);
this CLI only supplies its inputs. The response fields that drive it: a
non-null `slack: {channel, ts}` on ingest is the case alert to thread findings
onto (enactment notifications are threaded server-side); `slack: null` means
post one standalone top-level summary in the emoji-routed channel with the
findings in its thread. Never drop findings, never invent a synthetic case
link, and never use `slack-remote` (it appends a "Sent using @Devin" block that
spawns a recursive Devin session). The live automation prompts are thin
wrappers over the spec that live outside this repository; if a change alters
what a wrapper itself must say, update each prompt manually.

## Alert-specific research guidance

The per-alert research procedures (model-lab distillation classification, pre-spend signup-burst detection) live in [`SCANNER_SPEC.md` → Per-scanner deltas](../../../packages/kyc/sentinel/SCANNER_SPEC.md#per-scanner-deltas). This skill covers the CLI only.

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
- `targetType` — `user`, `domain`, or `api_key`.
- `targets` — 1–10000 targets per request (at most 5000 distinct users for
  `user` suggestions), with a cumulative maximum of 10000 targets and 5000
  distinct users for each suggestion identified by `source` + `ruleKey` +
  `targetType`.

Each target contains:

- `targetValue` — non-empty Clerk user ID, domain (literal or `*.<apex>`
  wildcard, see [Domain targets](#domain-targets)), or the decimal
  `api_keys.id` for an `api_key` target (see
  [API-key targets](#api-key-targets)).
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
  `proposedTarget must be empty for proposedKind=rate_limit`. Throttling one author
  is `author_rate_limit`, not a scoped flavor of `rate_limit`.
- `forced_moderation` proposals may omit `proposedTarget` for account-wide
  moderation or provide a known exact-case provider name for provider-scoped
  moderation. The active
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
  of the fast-limiter buckets (`RPM_LIMITER_BUCKETS` in
  `packages/type-utils/rate-limiter-rpm.ts`, currently topping out at 16384)
  because the Cloudflare limiter is the whole control and an in-between value is rejected rather than rounded (`Invalid proposed params for proposedKind=...`). Pass `"slow_enforcement": true` to have a globally-consistent Redis limiter enforce an exact non-bucket rpm, up to the largest bucket; values above it are rejected at ingest. Other kinds use `{}`. Scoped params are strict, so adding `rpd` is rejected and
  there is no scoped daily cap; add a separate account-wide `rate_limit` if a
  daily cap is also required. `spend_cap` requires a strict object with a
  positive numeric `limit_usd`.
- `proposedTarget` — required for the scoped kinds: `model_ban`,
  `provider_ban`, `author_ban`, `model_rate_limit`, `provider_rate_limit`,
  `author_rate_limit`, and `spend_cap`. Provider kinds take the exact display-cased
  `endpoint.provider_name` value — for example, `OpenAI` or `Google AI Studio` —
  not the lowercase provider slug. Model kinds take the dated
  `endpoint.model.permaslug`, not the model slug; for example, the current seed
  pairs `anthropic/claude-opus-5` with permaslug
  `anthropic/claude-opus-5-20260723` (321 of 929 seeded rows differ). Author
  kinds take an author slug. Spend-cap targets must be exactly `daily`, `weekly`,
  or `monthly`. The change route checks scoped targets against real data and
  returns 400 for unknown values before writing. `forced_moderation` may omit
  `proposedTarget` for account-wide moderation or use a known exact-case provider
  name for provider-scoped moderation. Omit `proposedTarget` for other
  account-scoped kinds.
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
  Card-count keys are vocabulary-checked: `distinct_cards` and
  `distinct_payment_methods` are retired and the whole post is rejected with a
  ZodError. Use `distinct_card_entries_attempted`,
  `distinct_card_fingerprints_attempted`, `distinct_card_fingerprints_charged`
  or `distinct_bins_attempted`, computed as in
  `packages/kyc/sentinel/SCANNER_SPEC.md#card-and-payment-method-terminology`.
- `seenAt` — optional ISO datetime.

Cross-field rules:

- Domain targets may use any supported restriction kind except
  `frontier_us_models`, with the domain in `targetValue`, and are stored as
  candidates for review. The retired `domain_block` kind is rejected at ingest.

### Domain targets

`targetValue` is either a literal domain, matched exactly, or a `*.<apex>`
wildcard that matches the apex and every descendant label (`*.example.com`
covers `example.com`, `a.example.com` and `b.a.example.com`). Use the wildcard
for a family that gives every account its own subdomain, where a literal
target would match nothing. Ingest canonicalizes the value (lowercase, no
trailing dot) and rejects with 400 any other wildcard placement, a bare `*`,
and a wildcard on a public or shared suffix (`*.co.uk`, `*.my.id`,
`*.onmicrosoft.com`). A wildcard that would cover a protected, free or
personal mail domain is refused at enact. An exact proposal counts as already
restricted when an active ancestor wildcard policy covers it; a wildcard
proposal only when an identical or broader wildcard does.

### API-key targets

A compromised key is filed as `targetType: api_key`, one target per key, and is
the remedy path for the
[compromised-key gate](#compromised-key-gate--run-before-review-and-enact).
It is not a restriction: the only `proposedKind` is `api_key_revocation`, and
the ordinary restriction kinds are rejected on this target type just as
`api_key_revocation` is rejected on `user` and `domain` targets.

- `targetValue` — the decimal `api_keys.id`. Never key material, a hash, or a
  key prefix; ingest rejects anything that is not a decimal integer.
- `evidence.compromised_at` — required ISO datetime, the proposed moment of
  theft. Every review signal is a before/after split on it, so a case without
  it cannot be reviewed and is rejected.
- `evidence.compromise_note` — optional, up to 500 characters, why we believe
  the key is compromised.
- `proposedParams`, `proposedTarget`, and `proposedExpiresAt` are rejected;
  the shared evidence minimum still applies.

Ingest answers 409 and stores nothing when any id in the batch names no key,
or names a key already disabled or deleted. Re-file with the remaining ids.

Filing is the whole of the agent's authority: key actions are refused on the
agent enact path, so a human reads the key's before/after model, provider,
colo, ASN and spend split against the account's other keys in Mission Control
and enacts. Enactment disables that one key, stamps `api_keys.compromised_at`,
and writes the linked revocation audit row. Undo does not re-enable the key.
Hand-filed reports come from the Mission Control revoke-keys page and land in
the same queue.

```json
{
  "targetValue": "1234567",
  "proposedKind": "api_key_revocation",
  "evidence": {
    "compromised_at": "2026-08-30T12:00:00.000Z",
    "compromise_note": "burst from one ASN on models the key never used",
    "requests_last_hour": 4200
  }
}
```

### Compromised-account targets

A taken-over account is filed as `targetType: user` with
`proposedKind: compromised_account`. Like `api_key_revocation` it is not a
restriction: it is accepted only on `user` targets, `targetValue` must be a
Clerk user id, and `proposedParams`, `proposedTarget`, and `proposedExpiresAt`
are rejected. Agent enactment is refused. A human enacts in Mission Control,
which calls Clerk's set-password-compromised API for the user and stamps
`compromised_account_enacted_at` on the target; a retry after that reports
`already_active`. Undo cannot reverse it, the user clears the state by
resetting their password.

```json
{
  "targetValue": "user_...",
  "proposedKind": "compromised_account",
  "evidence": {
    "signal": "account_takeover",
    "new_signin_asn": 4134,
    "keys_rotated_after_signin": 3
  }
}
```

Password leak versus session or client-token replay: there is no Clerk sign-in event table in ClickHouse, but `clickpipe_postgres_gcp_uscentral1.public_users` carries `last_sign_in_at` (refreshed by the Clerk `user.updated` webhook) and `external_account` / `clerk_initial_external_account` (OAuth provider). Those columns prove an OAuth provider exists, not that no password is set: `password_enabled` is not persisted, so treat password capability as unknown unless read from Clerk. A key-mint burst on `/api/frontend/v1/private/workspace-api-keys` with no `last_sign_in_at` change on any affected account points to session or client-token replay rather than a password leak, but only once the webhook plus CDC lag window (see the CDC lag note above) has elapsed since the burst. Before that, or when classification is urgent, read the Clerk user and sessions directly and phrase the sign-in evidence as supporting rather than conclusive. Also, `compromised_account` enactment (Clerk password-compromised) only forces a reset on password-capable accounts, so say so in the description. Comparing `cf_ja4` on the mint request (`default.user_signals`, `signal_name = 'account.api_key_created'`) with `cf_ja4` on the later `stg_generations` rows of the minted key settles whether the minting client and the draining client are the same operator, which rules out the "third-party product minting keys in users' browsers" reading. `analytics.stg_api_keys` lacks `updated_at`; read deletion state and timing from `public_api_keys` and skip deleted keys, since ingest 409s on them.

Scoped throttles do not apply to BYOK traffic (the endpoint check returns before building either limiter). `slow_enforcement` trades outage behavior for exactness: with it, Redis enforces the exact global rpm and Cloudflare is a rounded-up per-colo prefilter, failing open to roughly bucket-per-colo during an Upstash outage; without it, the bucket value is a hard per-colo cap with no outage path. Choose bucket-only when the cap must survive an Upstash outage and an approximate per-colo ceiling is acceptable.

The `proposedExpiresAt` value is persisted with the candidate target and
re-ingesting the same target key refreshes the expiry; it is not part of the
target's deduplication identity.

Geo comparison is reviewer-side enrichment, not an ingest requirement — see the spec's [Network geo vs card-issuer geo](../../../packages/kyc/sentinel/SCANNER_SPEC.md#network-geo-vs-card-issuer-geo).

If the cumulative target cap is exceeded, the result is
`target_cap_exceeded` (HTTP 400); use the next deterministic shard key, with the
bare stable key as shard one and `<stable_key>_part_2`, `<stable_key>_part_3`,
and so on for later shards, not a run or wave suffix. The same applies to
`user_cap_exceeded` (HTTP 400). The soft budget a scanner stays under, the
pre-post existence check, and the reads that check feeds live in the spec's
[case sizing](../../../packages/kyc/sentinel/SCANNER_SPEC.md#case-sizing) rule.
Ingesting into an archived suggestion returns HTTP 200 with
`{suggestionId,created:false,targetsUpserted:0,targetsAlreadyRestricted:0,slack:null}`
and does nothing — the spec's
[archived-key response](../../../packages/kyc/sentinel/SCANNER_SPEC.md#archived-stable-key)
carries the discriminator and what to do with one.

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
