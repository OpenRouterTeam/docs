# Sentinel spec memory

> **Purpose:** Durable history and refresh state for
> [SPEC.md](./SPEC.md).
>
> **Last manual audit:** 2026-07-23 03:53 UTC.
>
> **Last automation rescan represented:** rescan 19, completed
> 2026-08-06 12:00 UTC.

## How to use this file

`SPEC.md` is a snapshot. This file explains how the snapshot evolved and gives
the refresh automation enough memory to detect real changes without repeating
old discoveries.

Preserve information here when it answers at least one of these questions:

- When did a capability become current?
- Which PR merged, closed, or superseded another approach?
- Which prior gap was resolved or narrowed?
- Which incident changed the required system safeguards?
- Which open work is intentionally excluded from the concise spec?

Do not preserve ordinary prose churn, cosmetic UI changes, or every commit in a
stack. Git remains the source for that level of detail.

## Refresh protocol

For each scheduled run:

1. Search the repository's open PRs for the exact title
   `docs(sentinel): refresh SPEC.md`.
1. If one matching PR exists, check out its head branch and update it from the
   latest `main` without force-pushing.
1. If no matching PR exists, create a branch from the latest `main`. Use that
   branch for the refresh and open a PR titled
   `docs(sentinel): refresh SPEC.md` after pushing the first commit.
1. If multiple matching PRs exist, stop and resolve the duplicate PRs instead
   of choosing a branch implicitly.
1. Read `SPEC.md` and this file in full.
1. List all open Trust & Safety PRs, regardless of age.
1. List relevant PRs merged or closed since the checkpoint below.
1. Verify important claims against code on `main`.
1. Classify each discovery as one of:
   - current behavior;
   - open architectural work;
   - merged transition;
   - closed without merge;
   - superseded approach; or
   - unrelated use of the word "signal."
1. Update `SPEC.md` only for current behavior, material open work, and unresolved
   gaps.
1. Append a short dated entry to this file for meaningful transitions.
1. Commit and push both files to the refresh PR's head branch.
1. Update the checkpoint only after the PR head update succeeds.

### Accuracy rules

- A merged PR means code landed on `main`; it does not prove rollout or a gate
  is enabled.
- An open PR is not current behavior.
- A field or route mentioned in an old PR must still exist in code before it is
  described in `SPEC.md`.
- A resolved gap belongs here, not in the active gaps list.
- Do not infer production configuration from schema defaults alone.
- Prefer direct code paths and tests over PR descriptions when they disagree.
- Do not copy an old "open" or "merged" label forward without checking GitHub.
- Avoid scan-relative phrases such as "this run" in `SPEC.md`.
- Format PR references as shortcut links such as `[#NNNNN]`, with a matching
  GitHub pull-request URL definition at the bottom of the same file.
- Discover the destination branch from the open refresh PR. Never store a branch
  name in this file as the next-run destination.

## Scan checkpoint

The current content checkpoint is:

- last full GitHub and code audit: 2026-08-06 12:00 UTC;
- last automation rescan represented: rescan 19 at 2026-08-06 12:00 UTC; and
- prior scan window: all open T&S PRs plus merged and closed work since the
  previous 2026-07-23 12:00 UTC checkpoint.

This checkpoint is a scan cursor, not a branch or PR identity. The next run
should scan from the timestamp above, then discover or create the refresh PR as
described in the protocol.

## Manual audit after rescan 17

The original rescan 17 document was already stale when the spec was split:

- [#29236] merged. The Sentinel CLI and agent skill are now on `main`.
- [#29893] merged. Signup and onboarding ASN columns are now sortable.
- [#29289] closed without merging. The bulk Clerk unban helper did not land.
- [#29337] closed without merging. The large Storybook seed fixture did not land.

The audit also corrected these structural inaccuracies:

- The restrictions read/write cutover is open, not merged-dark. Only the
  additive overlay is present in the audited `main` snapshot.
- The Mission Control Sentinel review surface is merged, not open.
- Spend velocity is merged, while its disable/notification phases are not.
- `usd_exposure` is removed and should not appear in current data-model prose.
- The signal diagram's old `[#26720] open` label was stale.
- Resolved gap #3 and the resolved part of gap #16 were removed from the active
  gap list.
- The old "before/after" signal diagram incorrectly implied that [#29284] added
  a card BIN. It added card fingerprint, country, funding, and Radar risk. BIN
  remains separate work.
- Hardcoded signup domain lists bypass Sentinel review, but their author-ban
  mutations do shadow-write `restrictions`. The old spec incorrectly described
  them as entirely outside the centralized audit path.

## Durable subsystem history

### Restrictions centralization

- [#29032] created `restrictions` and its changelog.
- [#29033] added typed read and write helpers.
- [#29037] added best-effort shadow writes from legacy mutation paths.
- [#29063] added the request-time additive overlay.
- [#29233] added Clerk webhook synchronization for account bans.
- [#29338] made Mission Control views optionally include active restrictions.
- [#29500] added a full restriction-history card in Mission Control.
- [#29603] added current-restriction display and atomic reclaim of an expired but
  unrevoked slot during Sentinel enactment.
- [#29237] unified the Mission Control operator ban tooling into one Ban Users
  page that either dual-writes admin-sourced restrictions or opens a Sentinel
  case.

The restriction row carries a `last_edited_clerk_user_id` actor (default
`ACTING_SYSTEM` = `system`), recorded on the append-only changelog. The operator
Ban Users path from [#29237] records the acting administrator there. Sentinel
enactment now threads the reviewing Clerk user through the enact path;
[#29956] merged that attribution.

The authoritative cutover remains open as a train:

- [#29065]: backfill from legacy state;
- [#29067]: per-kind authoritative read policy;
- [#29069]: trusted gate transport;
- [#29070]: batch read alignment;
- [#29078]: legacy-write cutover; and
- [#29202]: relax legacy account bans in key auth.

Do not describe the table as the sole source of truth until this train lands and
is enabled.

### Sentinel core pipeline

- [#29150] added the ingest API scaffold.
- [#29155] added the Postgres suggestion and target data layer.
- [#29235] added review writes.
- [#29285] added the signed review endpoint.
- [#29286] added user-target enactment into `restrictions`.
- [#29109] added the Mission Control review queue and administrator-authenticated
  console reads.
- [#29310] and [#29311] fixed the Mission Control internal URL at build time.
- [#29320] clarified approved versus enacted lifecycle state.
- [#29447], [#29452], [#29456], and [#29460] replaced the queue-owned detail
  sheet with a dedicated case workspace, account metrics, stable columns, and
  target drilldown.
- [#29472] and [#29473] removed `usd_exposure` from UI, API, data access, and
  storage.
- [#29463] and [#29507] added evidence and target validation.
- [#29665] raised the target cap to 1,000 while adding a 200-user cap.
- [#29513] added reversible case archive and ingest freeze.
- [#29236] added the CLI and agent skill.
- [#29893] made signup and onboarding ASN columns sortable.
- [#29572] populated card BIN in the ban-candidate console from ClickHouse
  account metrics.

The following are still absent from current behavior:

- domain enactment ([#29778]); and
- re-enactment of a target whose restriction was revoked.

Batch-enact notification is no longer absent: [#30118] merged the Slack
notification sent after a batch enactment completes.

Lifecycle metrics and funnel are no longer absent: [#30069] merged the
observability dashboard.

Case undo is no longer absent: [#30502] merged an administrator-gated
`cfw-internal` `undo` route and the Mission Control action that calls it for a
selected batch of enacted targets. Undo revokes the linked restriction but
leaves the target's `restriction_id` set, so the re-enactment gap above
remains.

Authoritative human identity on the restriction actor is no longer absent:
[#29956] merged threading the reviewing Clerk user through the Sentinel enact
path.

### Review-surface convergence

Five early Mission Control alternatives remain open:

- [#29110] Investigation Console;
- [#29111] Criteria Studio;
- [#29115] Casebook;
- [#29116] Anomaly Workbench; and
- [#29120] Attention Router.

They were exploratory alternatives to the now-merged baseline. Do not list them
as active architecture unless the team explicitly revives one.

A later efficiency spike train also remains open or was abandoned:

- [#29326] combined approve and enact;
- [#29327] inline approve and deny;
- [#29329] decisive-signal presentation;
- [#29330] keyboard review;
- [#29331] bulk-first staging; and
- [#29337] Storybook seed data, closed without merge.

These spikes are useful design history but should not dominate the current
spec. The dedicated case workspace is the shipped surface.

### Signals

The signal substrate arrived in several layers:

- [#28566], [#28582], [#28591], [#28593], [#28819], and [#29184] established Cloudflare
  and request telemetry foundations.
- [#29077] and [#29086] added signup signals and corrected JS-detection timing.
- [#29083] added ASN and organization to generations.
- [#29280] added sealed-signup integrity and live onboarding fields.
- [#29282] improved seal attachment on imperative signup flows.
- [#29281] added replay protection, AAD binding, and seal-age recording.
- [#29283] added payment Cloudflare fields, payment-method context, handoffs, and
  cleanup.
- [#29284] added Stripe card fingerprint, country, funding, and Radar risk to
  credits.
- [#29288] persisted autogenerated-email and Early Fraud Warning signals.
- [#29638] allowed Clerk Protect collection through the site's CSP.

Signal names that must not be conflated:

- `payment_method_fingerprints` contains Cloudflare context by payment method;
- `credits.card_fingerprint` contains Stripe's card fingerprint; and
- [#28670] proposes a separate queryable card-fingerprint registry.

### Detection and isolated controls

- [#29016] fixed Stripe fraud bans so Clerk synchronization does not undo them.
- [#29292] added the Fable transaction-attempt monitor.
- [#29652] reduced its threshold, added known-account exemptions, and moved the
  alert to the Trust & Safety channel.
- [#26720] added the phase-one spend-velocity cron. It detects and alerts; it does
  not disable keys.
- [#29423] added manual top-up limits of one per minute and three per hour.
- [#30169] raised the manual top-up hourly cap to five and made it a soft cap
  (observed but not blocked) for paid subscription plans
  (pro/business/enterprise); the per-minute cap stays hard for all plans.
- [#29654] expanded frontier-author corporate-domain bans.
- [#29740] expanded the Anthropic-author exact-domain list.
- [#29722] proposed a TLD fallback and closed without merge.

Open detector or payment-control work includes [#29142], [#29239], [#29713], and
PR [#29731]. None is a general signal-to-Sentinel bridge.

### Provider safety and attestations

- [#28923] added the Meta safety-identifier blocklist mechanism.
- [#29225] emptied its default set while retaining the mechanism.
- [#29341] scoped OpenAI and Azure upstream identity by client `user` or
  `safety_identifier` and preserved reverse-mapping data.
- [#28787] added required-attestation model metadata and the definition registry.
- [#28803] added attestation storage, auth hydration, and self-attest routes.
- [#28813] added sync inference and batch-admission enforcement.

The attestation enforcement rung is merged, but the product is not operationally
complete:

- no audited model declares `required_attestation_types`;
- [#29867] proposes shared, cross-modality routing enforcement; and
- [#28823] proposes the frontend interstitial.

### Guardrails and administration

- [#28985] exposed the detect-only sensitive-information `flag` action.
- [#29197] surfaced flag outcomes in preview.
- [#29551] merged the intended flag-scan and PII dashboard widgets.
- [#29248], [#29303], and [#29365] remain open duplicates or follow-ups to that
  same dashboard work.
- [#29426] exposed a deterministic default guardrail ID on workspace APIs.
- [#29564] scoped default-guardrail member display to workspace membership.

PR [#14948] proposed platform guardrails as the source of truth for bans and
moderation. That direction was abandoned in favor of `restrictions` and is being
removed. The PR closed without merge on 2026-07-23. Its removal train landed
[#29931] (write-path removal, 1 of 3) with [#29933] (read paths, 2 of 3) and
[#29937] (columns, 3 of 3) still open. Keep it as superseded history; do not
restore it to `SPEC.md`.

## Incident memory

### 2026-07-21 false-positive mass enactment

An automated Devin fraud-review pass treated a card-fingerprint pattern as an
account ring. It enacted 2,722 restrictions, including 2,360 account bans, in
about 14 minutes. The pattern was a payment-intermediary artifact rather than a
real abuse ring.

The restrictions were reversed, but some legitimate accounts were blocked for
hours. The enactment did not produce a sufficiently loud operational signal.

The incident established the "reversible, observable, loud" requirements:

- exact case-scoped undo;
- immediate batch-enact notification;
- lifecycle metrics and funnel visibility; and
- safeguards that do not rely only on reviewer UI friction.

PRs [#29703], [#29710], and [#29702] were the original proposals for those
requirements but were superseded: batch-enact notification merged in [#30118]
and lifecycle metrics merged in [#30069]. [#29712] contains the proposed
post-mortem and also remains open.

## Resolved or narrowed gaps

Keep these out of the active gaps section unless they regress.

### Sentinel end-to-end user enactment

Resolved by [#29285] and [#29286] on 2026-07-19. User targets can be reviewed and
enacted into live restrictions. Domain targets remain a separate unresolved
gap.

### Human review surface

Resolved at the baseline level by [#29109], then replaced and expanded by the
case-workspace stack. Durable actor attribution landed in [#29956]. The
remaining unresolved gap is re-enactment after the linked restriction is
revoked.

### Expired restriction slots

Narrowed by [#29603]. Sentinel can reclaim an expired but unrevoked active slot.
General re-enactment after the linked restriction is revoked remains unresolved.

### Attestation enforcement rung

Resolved technically by [#28813] for sync inference and batch admission. Product
configuration, cross-modality coverage, and frontend flow remain open.

### Guardrail dashboard duplication

Partially resolved when [#29551] merged. [#29248], [#29303], and [#29365] are
still open and should close or rebase rather than be described as three separate
features.

## Closed or superseded work

- [#29079] closed after [#29202] replaced its key-auth cutover approach.
- [#29182] closed without merging its domain-input normalization changes.
- [#29289] closed without merging the bulk Clerk unban helper.
- [#29337] closed without merging the large Storybook seed fixture.
- [#29466] and [#29471] closed after Archive supplied a safer cleanup primitive.
- [#29474] closed without changing case auto-advance behavior.
- [#29722] closed without merging the Anthropic TLD ban fallback.
- [#14948] closed without merging the platform-guardrail source-of-truth
  direction; its read/write paths and columns are being removed instead.
- [#29893] is merged and must not remain in an in-flight table.
- [#29236] is merged and must not remain in an in-flight table.
- [#29237] is merged and must not remain in an in-flight table.

## Automation rescan log

This log retains meaningful state transitions from the original running spec.
It intentionally omits cosmetic UI churn and unrelated billing-signal work.

### 2026-08-06 — rescan 19

- [#29956] merged threading the reviewing Clerk user through the Sentinel enact
  path; authoritative human identity on the restriction actor is no longer absent.
- [#30118] merged Slack notification sent after a batch enactment completes;
  batch-enact notification is no longer absent.
- [#30069] merged lifecycle metrics and funnel tracking; lifecycle metrics are
  no longer absent.

### 2026-07-23 — rescan 18

- [#29237] merged the unified Mission Control operator Ban Users page: direct
  admin restriction dual-writes recording the acting administrator, or opening a
  Sentinel case.
- [#29572] merged card-BIN enrichment in the ban-candidate console.
- [#29931] merged platform-guardrail write-path removal (1 of 3); [#14948]
  closed without merge; [#29933] and [#29937] remain open.
- [#29956] opened to attribute Sentinel enactments to the reviewing Clerk user.
- [#29238] remains open (per-user/org restrictions panel).

### 2026-07-23 — rescan 17

- [#28813] merged the attestation enforcement rung for sync and batch.
- [#29603] merged expired-slot reclaim and current-restriction display.
- [#26720] merged phase-one spend-velocity detection.
- [#29423] merged manual top-up limits.
- [#29654] and [#29740] merged hardcoded author-domain list expansions.
- [#29867], [#29848], and [#29893] opened.
- [#29722] closed without merge.

### 2026-07-22 — rescan 16

- [#29341] merged per-end-user OpenAI and Azure safety identity scoping.
- [#28787] and [#28803] merged attestation metadata, storage, hydration, and
  self-attestation.
- [#29778] opened the domain-enactment path.
- [#28823] opened the attestation frontend flow.

### 2026-07-22 — rescan 15

- [#29697] merged bounded-concurrent batch moderation preflights.
- [#29652] tuned the Fable monitor.
- [#29551] merged the guardrail dashboard widgets.
- [#29731] opened the auto-top-up limiter.
- [#29712] opened the incident post-mortem.

### 2026-07-22 — rescan 14

- [#29229] merged chunked batch moderation.
- [#29703], [#29710], and [#29702] opened after the mass-enact incident.
- [#29713] opened Radar account-sharing signal collection.
- [#29603] changed from a display-only proposal into expired-slot reclaim.

### 2026-07-22 — rescan 13

- [#29665] split ingest limits into 200 users and 1,000 targets.
- Case-workspace financial columns and stage filtering continued to land.
- [#29638] enabled Clerk Protect signal collection through CSP.
- [#29654] and [#29648] opened.

### 2026-07-21 — rescan 12

- Target-sheet review, sticky review controls, and signup/onboarding ASN columns
  merged into the case workspace.
- [#29603], [#29610], and the competing BIN approaches were identified as new work.

### 2026-07-21 — rescan 11

- [#29472] and [#29473] completed removal of `usd_exposure`.
- [#29463] and [#29507] added ingest validation.
- [#29500] added restriction history.
- [#29513] added case archive and replaced bulk reject.

### 2026-07-21 — rescan 10

- [#29447], [#29452], [#29456], and [#29460] landed the dedicated case workspace.
- [#29338] made centralized restrictions visible in Mission Control.
- The new case page replaced the recently merged in-queue detail sheet.

### 2026-07-21 — rescan 9

- [#29320] merged explicit Sentinel lifecycle presentation.
- [#29431] merged identity and account-age enrichment.
- [#29423] opened the manual top-up limiter.
- The case-workspace stack opened.

### 2026-07-20 — rescan 8

- No material Trust & Safety merge occurred.
- [#29402], [#27448], and a third duplicate guardrail-dashboard PR opened.
- [#27838] closed without merge.

### 2026-07-20 — rescan 7

- [#29341] opened after an organization-wide provider policy block was traced to
  shared upstream identity.
- No detect-to-enact wiring changed.

### 2026-07-20 — rescan 6

- [#29284] merged card fingerprint and Radar risk fields.
- [#29281] merged signup-seal replay and AAD hardening.
- The Sentinel review-efficiency spike train opened.
- [#29338] opened centralized-restriction display in Mission Control.

### 2026-07-20 — rescan 5

- [#29283] merged Cloudflare signals across payment flows.
- [#29288] merged autogenerated-email and Early Fraud Warning persistence.
- [#29320] and [#29324] opened as review-surface follow-ups.

### 2026-07-19 — rescan 4

- [#29109] merged the Mission Control review queue.
- [#29310] and [#29311] fixed its production internal-service routing.
- The human UI became usable end to end, while restriction actor attribution
  remained `system`.

### 2026-07-19 — rescan 3

- [#29280] and [#29282] merged signup-seal and onboarding signal work.
- [#29292] merged the Fable monitor.
- The five exploratory review UIs, spend velocity, autobuy hold, and replay
  hardening appeared as open work.

### 2026-07-19 — rescan 2

- [#29285] and [#29286] merged review and enactment.
- Sentinel became functional end to end for user targets.
- Context dossiers, card registry, persisted fraud signals, and bulk moderation
  appeared as open work.

### 2026-07-19 — initial spec

- Recorded the restrictions schema, data layer, dual writes, and additive
  overlay.
- Recorded the Sentinel ingest and review data layer before enactment merged.
- Identified the source-of-truth migration, signal-to-action gap, domain gap,
  API overlap, and incomplete human attribution.

### 2026-07-19 — data-collection comparison

- Added the historical comparison from siloed billing telemetry to joinable
  signup, generation, and payment signals.
- That comparison was later removed from `SPEC.md` because several details had
  become stale and it mixed history into the current-state reference.

## Anthropic concentration monitor

- Retain only aggregate dates, baselines, hypotheses, and retired signals.
- Do not store billing-entity identifiers or per-entity dollar figures here.
- Use [ANTHROPIC_CONCENTRATION_MONITOR.md](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/kyc/sentinel/ANTHROPIC_CONCENTRATION_MONITOR.md)
  for the current query contract and threshold rationale; entity-level context
  stays in the Slack thread only.

<!-- Link definitions for pull-request references. -->
[#14948]: https://github.com/OpenRouterTeam/openrouter-web/pull/14948
[#26720]: https://github.com/OpenRouterTeam/openrouter-web/pull/26720
[#27448]: https://github.com/OpenRouterTeam/openrouter-web/pull/27448
[#27838]: https://github.com/OpenRouterTeam/openrouter-web/pull/27838
[#28566]: https://github.com/OpenRouterTeam/openrouter-web/pull/28566
[#28582]: https://github.com/OpenRouterTeam/openrouter-web/pull/28582
[#28591]: https://github.com/OpenRouterTeam/openrouter-web/pull/28591
[#28593]: https://github.com/OpenRouterTeam/openrouter-web/pull/28593
[#28670]: https://github.com/OpenRouterTeam/openrouter-web/pull/28670
[#28787]: https://github.com/OpenRouterTeam/openrouter-web/pull/28787
[#28803]: https://github.com/OpenRouterTeam/openrouter-web/pull/28803
[#28813]: https://github.com/OpenRouterTeam/openrouter-web/pull/28813
[#28819]: https://github.com/OpenRouterTeam/openrouter-web/pull/28819
[#28823]: https://github.com/OpenRouterTeam/openrouter-web/pull/28823
[#28923]: https://github.com/OpenRouterTeam/openrouter-web/pull/28923
[#28985]: https://github.com/OpenRouterTeam/openrouter-web/pull/28985
[#29016]: https://github.com/OpenRouterTeam/openrouter-web/pull/29016
[#29032]: https://github.com/OpenRouterTeam/openrouter-web/pull/29032
[#29033]: https://github.com/OpenRouterTeam/openrouter-web/pull/29033
[#29037]: https://github.com/OpenRouterTeam/openrouter-web/pull/29037
[#29063]: https://github.com/OpenRouterTeam/openrouter-web/pull/29063
[#29065]: https://github.com/OpenRouterTeam/openrouter-web/pull/29065
[#29067]: https://github.com/OpenRouterTeam/openrouter-web/pull/29067
[#29069]: https://github.com/OpenRouterTeam/openrouter-web/pull/29069
[#29070]: https://github.com/OpenRouterTeam/openrouter-web/pull/29070
[#29077]: https://github.com/OpenRouterTeam/openrouter-web/pull/29077
[#29078]: https://github.com/OpenRouterTeam/openrouter-web/pull/29078
[#29079]: https://github.com/OpenRouterTeam/openrouter-web/pull/29079
[#29083]: https://github.com/OpenRouterTeam/openrouter-web/pull/29083
[#29086]: https://github.com/OpenRouterTeam/openrouter-web/pull/29086
[#29109]: https://github.com/OpenRouterTeam/openrouter-web/pull/29109
[#29110]: https://github.com/OpenRouterTeam/openrouter-web/pull/29110
[#29111]: https://github.com/OpenRouterTeam/openrouter-web/pull/29111
[#29115]: https://github.com/OpenRouterTeam/openrouter-web/pull/29115
[#29116]: https://github.com/OpenRouterTeam/openrouter-web/pull/29116
[#29120]: https://github.com/OpenRouterTeam/openrouter-web/pull/29120
[#29142]: https://github.com/OpenRouterTeam/openrouter-web/pull/29142
[#29150]: https://github.com/OpenRouterTeam/openrouter-web/pull/29150
[#29155]: https://github.com/OpenRouterTeam/openrouter-web/pull/29155
[#29182]: https://github.com/OpenRouterTeam/openrouter-web/pull/29182
[#29184]: https://github.com/OpenRouterTeam/openrouter-web/pull/29184
[#29197]: https://github.com/OpenRouterTeam/openrouter-web/pull/29197
[#29202]: https://github.com/OpenRouterTeam/openrouter-web/pull/29202
[#29225]: https://github.com/OpenRouterTeam/openrouter-web/pull/29225
[#29229]: https://github.com/OpenRouterTeam/openrouter-web/pull/29229
[#29233]: https://github.com/OpenRouterTeam/openrouter-web/pull/29233
[#29235]: https://github.com/OpenRouterTeam/openrouter-web/pull/29235
[#29236]: https://github.com/OpenRouterTeam/openrouter-web/pull/29236
[#29237]: https://github.com/OpenRouterTeam/openrouter-web/pull/29237
[#29238]: https://github.com/OpenRouterTeam/openrouter-web/pull/29238
[#29239]: https://github.com/OpenRouterTeam/openrouter-web/pull/29239
[#29248]: https://github.com/OpenRouterTeam/openrouter-web/pull/29248
[#29280]: https://github.com/OpenRouterTeam/openrouter-web/pull/29280
[#29281]: https://github.com/OpenRouterTeam/openrouter-web/pull/29281
[#29282]: https://github.com/OpenRouterTeam/openrouter-web/pull/29282
[#29283]: https://github.com/OpenRouterTeam/openrouter-web/pull/29283
[#29284]: https://github.com/OpenRouterTeam/openrouter-web/pull/29284
[#29285]: https://github.com/OpenRouterTeam/openrouter-web/pull/29285
[#29286]: https://github.com/OpenRouterTeam/openrouter-web/pull/29286
[#29288]: https://github.com/OpenRouterTeam/openrouter-web/pull/29288
[#29289]: https://github.com/OpenRouterTeam/openrouter-web/pull/29289
[#29292]: https://github.com/OpenRouterTeam/openrouter-web/pull/29292
[#29303]: https://github.com/OpenRouterTeam/openrouter-web/pull/29303
[#29310]: https://github.com/OpenRouterTeam/openrouter-web/pull/29310
[#29311]: https://github.com/OpenRouterTeam/openrouter-web/pull/29311
[#29320]: https://github.com/OpenRouterTeam/openrouter-web/pull/29320
[#29324]: https://github.com/OpenRouterTeam/openrouter-web/pull/29324
[#29326]: https://github.com/OpenRouterTeam/openrouter-web/pull/29326
[#29327]: https://github.com/OpenRouterTeam/openrouter-web/pull/29327
[#29329]: https://github.com/OpenRouterTeam/openrouter-web/pull/29329
[#29330]: https://github.com/OpenRouterTeam/openrouter-web/pull/29330
[#29331]: https://github.com/OpenRouterTeam/openrouter-web/pull/29331
[#29337]: https://github.com/OpenRouterTeam/openrouter-web/pull/29337
[#29338]: https://github.com/OpenRouterTeam/openrouter-web/pull/29338
[#29341]: https://github.com/OpenRouterTeam/openrouter-web/pull/29341
[#29365]: https://github.com/OpenRouterTeam/openrouter-web/pull/29365
[#29402]: https://github.com/OpenRouterTeam/openrouter-web/pull/29402
[#29423]: https://github.com/OpenRouterTeam/openrouter-web/pull/29423
[#29426]: https://github.com/OpenRouterTeam/openrouter-web/pull/29426
[#29431]: https://github.com/OpenRouterTeam/openrouter-web/pull/29431
[#29447]: https://github.com/OpenRouterTeam/openrouter-web/pull/29447
[#29452]: https://github.com/OpenRouterTeam/openrouter-web/pull/29452
[#29456]: https://github.com/OpenRouterTeam/openrouter-web/pull/29456
[#29460]: https://github.com/OpenRouterTeam/openrouter-web/pull/29460
[#29463]: https://github.com/OpenRouterTeam/openrouter-web/pull/29463
[#29466]: https://github.com/OpenRouterTeam/openrouter-web/pull/29466
[#29471]: https://github.com/OpenRouterTeam/openrouter-web/pull/29471
[#29472]: https://github.com/OpenRouterTeam/openrouter-web/pull/29472
[#29473]: https://github.com/OpenRouterTeam/openrouter-web/pull/29473
[#29474]: https://github.com/OpenRouterTeam/openrouter-web/pull/29474
[#29500]: https://github.com/OpenRouterTeam/openrouter-web/pull/29500
[#29507]: https://github.com/OpenRouterTeam/openrouter-web/pull/29507
[#29513]: https://github.com/OpenRouterTeam/openrouter-web/pull/29513
[#29551]: https://github.com/OpenRouterTeam/openrouter-web/pull/29551
[#29564]: https://github.com/OpenRouterTeam/openrouter-web/pull/29564
[#29572]: https://github.com/OpenRouterTeam/openrouter-web/pull/29572
[#29603]: https://github.com/OpenRouterTeam/openrouter-web/pull/29603
[#29610]: https://github.com/OpenRouterTeam/openrouter-web/pull/29610
[#29638]: https://github.com/OpenRouterTeam/openrouter-web/pull/29638
[#29648]: https://github.com/OpenRouterTeam/openrouter-web/pull/29648
[#29652]: https://github.com/OpenRouterTeam/openrouter-web/pull/29652
[#29654]: https://github.com/OpenRouterTeam/openrouter-web/pull/29654
[#29665]: https://github.com/OpenRouterTeam/openrouter-web/pull/29665
[#29697]: https://github.com/OpenRouterTeam/openrouter-web/pull/29697
[#29702]: https://github.com/OpenRouterTeam/openrouter-web/pull/29702
[#29703]: https://github.com/OpenRouterTeam/openrouter-web/pull/29703
[#29710]: https://github.com/OpenRouterTeam/openrouter-web/pull/29710
[#29712]: https://github.com/OpenRouterTeam/openrouter-web/pull/29712
[#29713]: https://github.com/OpenRouterTeam/openrouter-web/pull/29713
[#29722]: https://github.com/OpenRouterTeam/openrouter-web/pull/29722
[#29731]: https://github.com/OpenRouterTeam/openrouter-web/pull/29731
[#29740]: https://github.com/OpenRouterTeam/openrouter-web/pull/29740
[#29931]: https://github.com/OpenRouterTeam/openrouter-web/pull/29931
[#29933]: https://github.com/OpenRouterTeam/openrouter-web/pull/29933
[#29937]: https://github.com/OpenRouterTeam/openrouter-web/pull/29937
[#29948]: https://github.com/OpenRouterTeam/openrouter-web/pull/29948
[#29956]: https://github.com/OpenRouterTeam/openrouter-web/pull/29956
[#30069]: https://github.com/OpenRouterTeam/openrouter-web/pull/30069
[#30118]: https://github.com/OpenRouterTeam/openrouter-web/pull/30118
[#30502]: https://github.com/OpenRouterTeam/openrouter-web/pull/30502
[#29778]: https://github.com/OpenRouterTeam/openrouter-web/pull/29778
[#29848]: https://github.com/OpenRouterTeam/openrouter-web/pull/29848
[#29867]: https://github.com/OpenRouterTeam/openrouter-web/pull/29867
[#29893]: https://github.com/OpenRouterTeam/openrouter-web/pull/29893
