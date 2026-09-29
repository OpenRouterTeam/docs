# PR reviews

Every App-installed repo gets a first-pass review PANEL on every PR —
automatically when the `synapse-webhook-reviews` Statsig gate is on, or on
demand via
`POST /api/review` (openrouter-web is the flagship target; `REVIEW_REPOS`
narrows scope for both entry points). N independent agents — each with its own focus directive
(`src/uses/review/agents.ts`; the panel: **aegis** security · **plumb**
correctness · **turbine** performance · **sherpa** DX/UX/A11y) — review in parallel; a coordinator consolidates
everything into ONE PR comment kept up to date in place, one worst-of
review event per round, and auto-resolves line threads whose finding was
addressed. The PR always shows feedback for the CURRENT state. The reviewer is a single
`callModel` loop over PR read/write tools.

## Lifecycle

```
pull_request {opened|synchronize|reopened|ready_for_review}
  → verify signature → REVIEW_REPOS allowlist → draft/state guards
  → synapse-webhook-reviews gate (off → 202 ack, no round) → delivery-id dedupe
  → self-update skip (keep-fresh clean updates don't re-review)
  → one-ROUND-per-head-SHA dedupe
POST /api/review {owner, repo, number, force?}   (manual — webhook gate not required)
  → API_TOKENS bearer → REVIEW_REPOS allowlist → live PR fetch (open? head SHA)
  → shared one-ROUND-per-head-SHA dedupe (force bypasses, for lost rounds)
  → openRound (roster row per agent) + fan-out {agent_review} × N
    (opened: immediate; updates: 60s delay to coalesce force-pushes)
  → each agent: stale-head guard → eager context + guidelines → read tools
    → submit_findings (structured; posts nothing)
  → last finisher wins the atomic round claim → finalizeRound:
      worst-of verdict → advisory-only cap (code: every event is COMMENT)
      fingerprint diff vs stored open findings
      consolidated comment: create once / update in place
      ONE review event (+ new line comments batched; skipped if unchanged)
      addressed findings → resolveReviewThread (GraphQL)
```

## Update rounds and resolution

Findings carry agent-chosen stable slug ids (e.g.
`sql-injection-user-lookup`). On an update round each agent sees its own
prior findings listed with ids and re-verifies them against the current
diff — reusing an id marks the issue persisting; omitting it marks it
addressed. The coordinator diffs fingerprints (`agent:path:id`, with a
headline-similarity rescue for renamed slugs — `review.fingerprint_rescued`
is the drift metric) and:
- posts line comments only for genuinely NEW findings,
- resolves the threads of addressed ones (GraphQL `resolveReviewThread`;
  a 403 degrades to the Postgres mark + the comment's resolved section),
- rewrites the consolidated comment in place (`<!-- Synapse:consolidated -->`
  marker; id persisted in `pr_state`; recreated if a human deleted it).

The review EVENT is only re-posted when the verdict changed or new line
comments exist — a no-change push produces zero timeline noise.

Draft PRs are skipped until `ready_for_review`. Closed PRs are skipped.

## Verdicts

Per-agent verdicts consolidate worst-of: any request_changes is the
panel's word — but every review EVENT posts as COMMENT. Synapse is
**advisory-only**: it never approves and never formally requests changes —
both stay human acts (see
[security.md](../security.md#advisory-only-no-approvals)). The panel's
verdict still renders per-agent in the consolidated comment.

Each agent judges the CODE identically for every author; the gate is
coordinator code, not agent concern.

## Review format contract

GitHub squashes wide Markdown tables, so the renderer (`render.ts`) owns
layout, not the model:

- The consolidated comment is organized for the READER by finding
  CATEGORY (Security, Performance, Experience …), never by agent name —
  agents are internal plumbing. Layout: marker → `## Synapse review —
  <sha>` → category status badge row (✅/💬/❌ per category) → per-category
  findings (severity-sorted, fold >4 into `<details>`; clean categories
  collapse to their badge) → folded "resolved since last push" history.
  Multiple agents may feed one category; it renders once, worst-of.
- `findings[].where` must be an exact repo-relative `path:line` /
  `path:start-end` — rendered as **clickable head-SHA blob links**.
  Unlinkable anchors fall back to inline code.
- Line comments are labeled with the finding's CATEGORY; the hidden
  `<!-- Synapse:fp=agent:id -->` marker keeps the agent identity for
  cross-round thread resolution.
- Never tables, anywhere. Evidence cited inline; no filler.

## Cost & bounds

`DEFAULT_REVIEW_MODEL` (`anthropic/claude-opus-5`), `stepCountIs(24)`,
`maxCost` ($2.00) stop conditions. Each is a checked-in **default** in
`src/config.ts`, overridable at runtime via the KV live config document
`synapse:review-config` (read by `src/live-config.ts` at the start of
every agent run — no deploy needed). Overrides are Zod-validated with
hard ceilings (cost ≤ $10, steps ≤ 50); an invalid or partial document
falls back to the config.ts defaults **wholesale**, never field-by-field.
Typical run 2–8 turns, ~$0.06–0.75 on Opus.
Logged per turn (`run.turn` with per-call cost) and per run
(`run.done`) by the run harness.

Set or update the live overrides with:

```sh
wrangler kv key put --binding=KV_LIVE_CONFIG 'synapse:review-config' \
  '{"defaultReviewModel":"anthropic/claude-opus-5","agentMaxCostUsd":2,"agentMaxStepCount":24}'
```

## Smoke-testing a live review

Open a scratch PR with a deliberate flaw against an installed repo; label
it clearly as disposable; watch `wrangler tail` for
`review.round_enqueued → run.start → run.turn… → run.done`; close
unmerged and delete the branch. Every review event is a COMMENT by code
policy (advisory-only), so smoke PRs can never be formally blocked — the
panel's verdict is in the consolidated comment.
