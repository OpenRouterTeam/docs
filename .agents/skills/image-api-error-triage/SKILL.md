---
name: image-api-error-triage
description: >-
  Automated error triage for the Image Generation API. Gathers failure
  signals from two independent sources — Datadog failure logs and Enterpret
  customer feedback — clusters and root-causes them, dedupes against existing
  triaged Linear tickets, files new evidence-backed tickets (and, on scheduled
  runs, opens human-gated fix PRs for small code issues), and posts a summary
  to Slack with hyperlinked tickets. Checks each spike's recent trend before
  filing so already-resolved issues are flagged (or filed-and-closed) as
  non-issues rather than escalated. Runs weekly (Mondays) on a schedule or
  on-demand.
user-invocable: true
---

# Image API Error Triage

Gather → classify → dedupe → file → (optionally) fix → report, for image
generation issues served by the `cfw-image-api` worker. Tracking issue:
[ECO-1746](https://linear.app/openrouter/issue/ECO-1746). The output is
evidence-backed Linear tickets, not speculation, plus a Slack summary.

This runbook is the versioned, reviewable definition of the triage process
(ECO-1746 acceptance criterion). Keep it in sync when the procedure changes.

## Cadence & delivery

- **Schedule:** weekly, every Monday (wire via a Devin Automation whose prompt
  invokes this skill). Detection is cheap (~3–6 ACU/run); fix PRs are separate,
  human-gated sessions.
- **Scheduled runs:** file/update tickets, open fix PRs for small
  code-classified issues (human approves the merge), then post the summary to
  Slack `#metrics-multi-modality` (**mandatory**) — exactly one post, per Step 6.
- **Manual runs:** do the detection + dedupe, then present candidates to the
  user for go-ahead before filing. Ask whether to post the Slack summary.
- **The skill owns the entire Slack footprint.** Leave the automation's
  `start_session` action `slack_channel_id` **unset** so the platform does not
  post a "New session started…" card or mirror the session's progress messages
  into the channel — those duplicate the Step 6 summary and clutter the channel.
  The one thing the channel should see is the single Step 6 post.

## Required access

- `DD_API_KEY`
- `DD_APP_KEY` — must be an **unscoped** application key. Scoped keys lack the
  `built_in_features` scope and are rejected with `Forbidden` by the logs
  analytics endpoint. The shared key in Devin secrets is unscoped and works;
  do **not** provision a scoped logs-read key (it will break — same gotcha as
  `audit-slow-db-queries`).
- Datadog site: `us5.datadoghq.com`. Dashboard:
  https://us5.datadoghq.com/dashboard/r4g-2t9-jc2
- Linear MCP (team **Ecosystem**, project **Multimodal Improvements &
  Reliability**).
- Enterpret MCP (`run_graph_query`, Cypher) for customer-feedback signals.
- Slack: use the native `slack` tool. The automation grants
  `#metrics-multi-modality` (channel `C0BCV3YNZKK`) via
  `tools.slack_channels` and attaches no Slack MCP server. Use the same native
  tool for manual DMs by posting to a user ID as the channel.

## Guardrails

- **Read-only Datadog.** Query only; never mutate DD (monitors/dashboards go
  through Terraform).
- **Ticket-first.** Every finding becomes (or updates) a Linear ticket before
  any code is written. No direct-to-PR without a ticket.
- **No auto-merge.** Fix PRs are opened for review; a human approves the merge
  (mirroring `design-scan`).
- **No auto-close of pre-existing tickets.** Never close or cancel a ticket you
  did not file in the current run. The one exception is the non-issue path in
  Step 2b: a spike-driven ticket that *this run* files and that the
  reproducibility check confirms is already resolved may be filed-and-closed
  (Canceled) with the non-issue explanation — that's intended behavior, not a
  violation.
- **Cost cap on live verification.** Any post-fix verification that issues real
  image requests must stay within a small, explicit budget.
- **Do not commit findings.** Only code fixes and this skill live in the repo.
  Reports are delivered to Slack / the user, never committed (same rule as
  `audit-slow-db-queries`).

## Step 1 — Gather signals

Pull from **two independent sources**. Neither is subordinate to the other: a
Datadog spike with no customer reports is still actionable, and an Enterpret
theme with little Datadog volume is still actionable (customers hit issues our
logs rank low — e.g. auth/access friction that never reaches the adapter). Feed
both into the same classify → dedupe → file pipeline.

### 1a — Datadog failure logs

The image tx log is emitted by `logImageGenerationTxAttempt`; fields land under
`@extra.`. Canonical failure query (last 7d):

```
service:api @script_name:image-api "Transaction attempt" @extra.success:false
```

Use the aggregate endpoint (the Datadog MCP has no group_by/aggregate tool and
rate-limits hard — use raw curl with ~4s spacing between calls):

```bash
curl -sS -X POST \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" \
  -H "Content-Type: application/json" \
  "https://api.us5.datadoghq.com/api/v2/logs/analytics/aggregate" \
  -d '{
    "compute": [{ "aggregation": "count", "type": "total" }],
    "group_by": [{
      "facet": "@extra.adapter_name",
      "limit": 30,
      "sort": { "aggregation": "count", "order": "desc", "type": "measure" }
    }],
    "filter": {
      "query": "service:api @script_name:image-api \"Transaction attempt\" @extra.success:false",
      "from": "now-7d", "to": "now", "indexes": ["*"]
    }
  }'
```

Datadog's aggregate `group_by` defaults to alphabetical ordering, not count.
Always include `sort: { "aggregation": "count", "order": "desc", "type":
"measure" }` inside each `group_by` object; otherwise a large limit can return
only alphabetically early values and omit the actual top clusters.

Cluster by re-running the aggregate with these `group_by` facets:

- `@extra.adapter_name` — which adapter (e.g. `BlackForestLabsImageAdapter`).
- `@extra.outcome_bucket` — `rate_limited` vs `hard_failure` (**the key split**).
- `@extra.endpoint_status` / `@extra.endpoint_error.status` — HTTP status.
- `@extra.endpoint_error.message` — the error text. **Not** full-text
  searchable, so classify it client-side after pulling the grouped values.
  Exact-phrase matching is unreliable when the value contains backticks or is
  long enough for Datadog to store with an ellipsis; use a distinctive
  wildcard substring instead (for example, `@extra.endpoint_error.message:*3686400*`).

For a specific cluster, add the facet to the query, e.g.
`... @extra.adapter_name:BlackForestLabsImageAdapter @extra.outcome_bucket:hard_failure`.

### 1b — Enterpret customer feedback

Query recent image/multimodal feedback and treat each theme as a candidate
issue in its own right (per the "use Enterpret to ground product decisions"
knowledge). Use `run_graph_query` (Cypher); the dialect rejects unregistered
`toLower()`, `timestamp()`, and `duration({...})` UDFs. Use bare ISO
date-string comparisons such as `nli.record_timestamp >= '2026-06-27'` and
case-variant `CONTAINS` alternatives instead. The working traversal is:

```cypher
(nli:NaturalLanguageInteraction)-[:SUMMARIZED_BY]->(fi:FeedbackInsight)
  -[:HAS_TAGS]->(cft:CustomerFeedbackTags)-[:HAS_THEME]->(t:Theme)
```

Filter `t.type <> 'MISC'`, group on `t.display_name`, and use
`COUNT(DISTINCT nli.record_id)`. Avoid slice syntax like `collect(...)[0..3]`;
the compiler rejects `LSQB`. Themes seen for image issues:
"Compliance & Access Barriers for Image Models", "Miscellaneous Image
Generation Issues", "Multimodal request structure breaks image handling".
Capture the theme's citation URL (`https://dashboard.enterpret.com/...`).

For each theme decide: does it map onto a Datadog cluster (attach as customer
evidence on that ticket), or is it a standalone issue Datadog doesn't surface
(file its own ticket / fix PR on its merits)?

## Step 2 — Classify (root cause)

Split every cluster into exactly one class. The **rate-limited vs hard-failure**
distinction matters most: a rate-limit storm is a capacity problem, not a bug,
and lumping it into the headline failure count hides real regressions.

| Class | Signal | Action |
| -- | -- | -- |
| **Provider capacity / rate limit** | `outcome_bucket:rate_limited`, `429`, "exceeded rate limit" | File as ops/routing ticket. **Not** an auto-PR. e.g. ECO-1788 (Azure MAI-Image-2.5, ~269K 429s/7d, one region). |
| **Content moderation (working as intended)** | provider policy refusal, correct `400`, e.g. "xAI blocked this request: it was flagged for sexual or adult content." | Not a product failure. Track separately; ticket only if the *message* hides the reason (that's an adapter-bug, see the **Adapter bug / opaque error** row below). Don't treat as a regression. |
| **User error (working as intended)** | correct `4xx`, e.g. billing hard-limit `402`, capability validation `400` | Skip unless the *message* is unclear. Don't refile. |
| **Adapter bug / opaque error** | generic message, provider error body not surfaced, or wrong status class | Ticket + **auto-PR candidate**. e.g. ECO-1789 (BFL error-body surfacing, mirrors ECO-1466). |
| **Misclassification** | `5xx` that should be `4xx` (or vice-versa) | Ticket + auto-PR candidate (the June Recraft pattern, ECO-1450). |
| **Provider outage** | burst of `5xx`/timeouts on one provider, self-resolving | Note in report; ticket only if sustained. |
| **Customer-reported (Enterpret)** | recurring feedback theme, may have low DD volume | Ticket on its merits; auto-PR if small and code-classified. |

Anchor examples (2026-07-07 sweep):

- Azure MAI-Image-2.5: 270K failures, 269K are `429` capacity — **not** a bug.
- BFL: 2,570 failures, ~2,008 moderation (already correctly `400`) but with
  generic messages — the actionable gap is surfacing the provider error body,
  **not** reclassification.

### Content moderation is not a product failure

The largest slice of `hard_failure` is usually **provider content-moderation
rejections** (e.g. `xAI blocked this request: it was flagged for sexual or adult
content.`, `Gemini blocked this request through content moderation.`). These are the
provider correctly refusing on policy — *not* something we broke. Report them
separately from genuinely actionable hard failures (bad params, download
failures, real `5xx`), and do **not** treat them as regressions. When asked
"why is the success rate low," quantify the moderation share first: in the
2026-07-07 window ~64% of *all* failures were moderation, and excluding
moderation + rate-limits lifted the effective success rate from ~67% to ~91%.
Use `@extra.is_content_moderated:true` as the primary moderation facet
(45,293 of 208,068 failures in the 2026-07-27 window). Message-text
classification is the fallback if the facet is absent.

## Step 2b — Reproducibility & non-issue check (do this BEFORE filing)

A large 7d count is **not** proof of a live problem — spikes are often
front-loaded bursts that already stopped (a provider quota bump, a bad deploy
rolled back, traffic that moved on). Filing a live High-priority ticket for an
issue that fixed itself wastes the fix owner's time. So for **every**
spike-driven cluster, before filing, pull the recent trend and compare it to the
7d total:

```bash
# same query as the cluster, re-run per window
for W in now-1h now-6h now-24h now-7d; do
  curl -sS -X POST \
    -H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" \
    -H "Content-Type: application/json" \
    "https://api.us5.datadoghq.com/api/v2/logs/analytics/aggregate" \
    -d "{\"compute\":[{\"aggregation\":\"count\",\"type\":\"total\"}],\"filter\":{\"query\":\"<cluster query>\",\"from\":\"${W}\",\"to\":\"now\",\"indexes\":[\"*\"]}}"
  sleep 4
done
```

Decide from the trend (not the 7d headline):

| Trend (recent vs 7d) | Verdict | Action |
| -- | -- | -- |
| Still elevated in last 1h/6h | **Live** | File normally at full priority. |
| Tapering — present in 24h but ~0 in last 6h | **Likely resolved** | File, but the ticket must say up front *"this may already be resolved / possible non-issue"* with the trend table, and drop the priority. |
| Effectively zero in last 24h (only historical) | **Confirmed non-issue** | Either skip, or file-and-close as Canceled with a clear *"confirmed non-issue — already resolved"* section and the trend table. Do **not** open a live High-priority ticket, and do **not** ask a human to investigate. |

### Actually try to reproduce (once)

For a **parameter- or request-shaped** failure (a specific param combination, a
prompt/size that trips validation, an adapter returning the wrong status), send
**one** end-to-end request that mimics the failing shape and record the outcome
on the ticket. This is cheap and is the real reproduction — do it rather than
inferring from logs alone. Use the local `cfw-api` / dev-fs-logs flow or a
single live call against a cheap model/endpoint; note the generation ID.

The only thing to avoid is **spamming** — do not fire repeated requests to
"prove" a rate limit or provider outage. One request that either re-trips the
limiter or comes back clean is enough signal; more just burns credits and can
re-trigger the limit. For pure capacity/`429`/outage clusters, one attempt plus
the trend table is sufficient; for everything else, reproduce the exact failing
request once. Either way, write on the ticket what you tried and what happened
(reproduced / not reproduced / could only confirm from logs).

Worked example (ECO-1788): Azure showed 269K `429`/7d but 17/24h and **0**/6h —
confirmed non-issue (someone bumped the provider quota). It was filed with a
"confirmed non-issue" banner and immediately **Canceled**, rather than escalated.

## Step 3 — Deduplicate

Before filing anything, diff each cluster against existing triaged tickets —
**open and recently-closed/canceled** (prior runs left Canceled tickets that
must not be refiled). Runs tag tickets with the `image-api-errors` Linear label;
use it as the dedup key. Via Linear MCP:

- `list_issues` with `label: "image-api-errors"`, `team: "Ecosystem"`,
  `includeArchived: true`.
- Also keyword-search the cluster (adapter name, error text) for non-labeled
  tickets covering the same ground.

For each cluster decide: **new** (file), **update** (append fresh evidence to
the existing ticket), or **dedupe** (reference, don't refile). Record the
verdict for every cluster — including skips — so the run is auditable.

## Step 4 — File / update tickets

Use the established evidence format. Team **Ecosystem**, project **Multimodal
Improvements & Reliability**, `image-api-errors` label (the shared dedup key
above). Tickets filed before 2026-07-27 live in the **Image Generation API**
project; dedup is label + team scoped, so they still surface. Body sections:

```markdown
## Problem
## Datadog query        (exact query + dashboard link)
## Evidence (last 7d)   (counts table: status / outcome_bucket / message)
## Root cause (candidate)
## Proposed fix          (for code-classified issues; cite precedent ticket)
## Files                 (starting-point paths)
## Acceptance criteria
## Customer signal        (Enterpret theme + citation links, if any)
## Classification         (auto-PR candidate? or human/ops)
```

Priority: capacity storms and high-volume regressions → High; scoped
UX/observability fixes → Medium. Reference precedent tickets (e.g. ECO-1466 for
error-body surfacing) so reviewers have the pattern. Examples filed this run:
ECO-1788 (capacity), ECO-1789 (adapter error-body).

## Step 5 — Fix PRs (scheduled runs only)

For **small, code-classified** issues (adapter bug / misclassification /
customer-reported, diff roughly < ~150 lines, clear precedent), open a fix PR —
but never auto-merge. Follow
`packages/image-generation/adapters/AGENTS.md`: extend the right base class,
implement only the provider hooks, add a co-located `index.test.ts`. Link the
PR to its ticket. Anything larger, ambiguous, or cross-cutting goes in the
report's **notables** for human deliberation instead of a PR.

## Step 6 — Slack report

Scheduled runs: mandatory. Manual runs: ask first, or just report to the user.

**One Slack post per run, and keep it terse.** Post a single top-level summary
to `#metrics-multi-modality` (channel `C0BCV3YNZKK`) with the native `slack`
tool, then put the full breakdown in a single threaded reply using the same
tool with `thread_ts` set to the top-level message's `ts`. Never post a second
top-level message or re-post the reply. If delivery is uncertain, inspect the
thread with the native `slack` tool instead.

Raw Slack mrkdwn per `.agents/skills/slack-mrkdwn/SKILL.md`: `*bold*`, `•`
bullets, `<url|label>` links, triple-backtick blocks instead of tables. Run its
sanity check on both messages before posting.

**No @-mentions on scheduled runs.** A weekly digest shouldn't ping anyone. Only
tag a person when a manual invoker explicitly asks — then resolve the Slack ID
from `.github/github-slack-mapping.csv` (`<@UXXXXXXXX>`), never a bare GitHub
handle.

**Keep links out of the top-level message.** Slack's Linear/GitHub apps unfurl
every ticket/PR URL into a preview card, which is what bloats the channel. So
the top-level post carries counts + a one-line headline and **no links**; all
hyperlinked tickets and PRs go in the threaded reply, where the unfurl cards
stay tucked behind the thread. In the reply, always hyperlink — never bare
identifiers — with Slack link syntax `<url|label>`: a ticket is
`<https://linear.app/openrouter/issue/ECO-1789|ECO-1789>` (use the canonical
`url` from the `get_issue` / `save_issue` response verbatim), a PR is
`<https://github.com/OpenRouterTeam/openrouter-web/pull/27482|#27482>`.

Top-level message:

```
:frame_with_picture: *Image API Error Triage — <date>*
Window: last 7d · Total failures: <N> (hard-failure <N> / rate-limited <N> / unknown <N>)
Filed/updated <N> · Auto-PRs <N> · Notables <N> — <one-line headline of the top finding>
Detail in thread :thread:
```

Threaded reply (the full breakdown):

```
*Tickets created/updated*
• <https://linear.app/openrouter/issue/ECO-xxxx|ECO-xxxx> <title> — <class>, <priority>
  (for a confirmed non-issue, say so: "confirmed non-issue — closed")

*Auto-PRs created*
• <https://github.com/OpenRouterTeam/openrouter-web/pull/NNNNN|#NNNNN> <title> → <ticket link> (awaiting review)

*Notables* (need deliberation / too big for auto-PR)
• <cluster or customer theme> — <why it needs a human>

Run cost: ~<N> ACU
```

If there are no new findings, still post the top-level line (a clean run is a
valid result) and note it in the reply.

## Step 7 — Record cost

Note the run's ACU/token usage in the report so cadence can be tuned. Detection
+ dedupe + Enterpret is light (~3–6 ACU); fix PRs are separate sessions.
