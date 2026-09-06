# Tournament Replay Hardening — Requirements

**Date:** 2026-06-22
**Status:** Draft (brainstorm output, pre-planning)
**Topic:** Reliable quality-tournament replays via candidate-grain sharding
**Related:** PR #25588 (ECO-1114, soft per-shard deadline)

## Problem

The quality-tournament lab replays captured prompts against candidate models.
Today the work is sharded **per prompt**: one `runReplaysSA` call handles one
prompt × *all* its candidates, inside a single Vercel function capped at
`maxDuration = 300`s (`projects/web/app/[locale]/(user)/(dashboard)/labs/quality-tournament/page.tsx:30`).

We are at the Vercel **Pro** ceiling — 300s is fixed and cannot be raised
without a plan change. Within that fixed wall, the per-prompt shard has three
failure modes:

1. **Breakage.** A prompt with many candidates and/or a slow reasoning model
   exceeds 300s. Before #25588 this returned a bodyless 504 and the client
   discarded the whole prompt's finished candidates. #25588 softened this to a
   partial result at 270s, but the underlying cause — N candidates sharing one
   300s budget — remains.
2. **Trust.** A "completed" run can hide empty completions, deadline-cancelled
   candidates, and silently-skipped stacked passes, so the leaderboard doesn't
   tell you *why* each candidate is in its final state.
3. **Unguarded hydration.** Each shard calls `fetchUserTransactions` and
   `fetchPrivatePromptLog` *before* any `chatSend`. `fetchInternalJsonApi` has
   **no timeout** (`packages/frontend/utils/fetch-internal-api.ts:41,68,145`),
   so hydration can hang the shard before the request timeout is even in play.

## Near-term driver: a cost-savings experiment

The immediate reason for investing here: this is a **client-side tool to
validate whether replaying captured prompts against candidate models yields a
cost saving** versus the original generations. The tool's primary job right now
is to *answer that question* with trustworthy numbers. Reliability work is in
service of the measurement — a run that silently drops candidates would corrupt
the cost conclusion.

Decision on record: the full re-grain build is in scope. This is **not**
premature hardening — the tool is already exhibiting **instability failures in
practice**, so the re-grain is a reactive fix for observed breakage, not
speculative future-proofing. The minimal measurement-only alternative was
considered and declined for this reason.

## Goal

Make a tournament run **survive** slow/failing candidates, **self-heal** the
recoverable ones, **report honestly** on the rest, and **surface the cost
comparison** that motivates the tool — by changing the shard grain so candidate
count stops consuming the fixed 300s ceiling.

The core lever: **re-grain from per-prompt shards to per-candidate execution,
so each candidate attempt gets its own 300s budget instead of 8 candidates
sharing one.**

## Users & Scale

- **Now:** admin-only, interactive wizard, small runs (default 10 prompts × 3
  candidates). Synchronous request/poll model is adequate.
- **Aspirational (NOT this doc):** public exposure, 100s of prompts × many
  concurrent users. That scale breaks the synchronous-request model entirely
  and is explicitly out of scope here (see Non-Goals). This doc targets the
  near-term admin use and is built so it doesn't *fight* a future re-home.

## Approach: hydrate-once / fan-out-per-candidate

Split the per-prompt shard into two stages:

### Stage 1 — hydrate once (per prompt)
`loadHydratedPrompts` runs a single time per prompt and pays the internal IO
(`fetchPrivatePromptLog` / `fetchUserTransactions`) exactly once. The hydrated
prompt (messages, media, replay params) becomes the payload that candidate
cells consume.

### Stage 2 — fan out per candidate
Each `(prompt, candidate)` cell runs in its own function with a full 300s,
carrying the **already-hydrated** messages. No candidate re-pays hydration.
`BaseRunPhaseEvents` orchestrates at candidate grain; its existing
skip-completed / retry-missing logic
(`projects/web/app/[locale]/(user)/(dashboard)/labs/quality-tournament/wizard/BaseRunPhaseEvents.ts:95-137`)
now operates on cells rather than prompt shards.

**Why hydrate-once over naive re-hydration:** a naive split (one
`runReplaysSA` per candidate, each re-running `loadHydratedPrompts`) would pay
the unguarded internal IO N× per prompt. Decided against; the IO cost and the
load it puts on the timeout-less internal API make the clean split worth the
refactor.

## What re-graining absorbs

Because a cell is one upstream call in its own 300s budget, several hand-rolled
mechanisms become unnecessary or trivial:

- **#25588's soft 270s deadline + partial-result machinery** — mostly
  unnecessary for the sharded path: a cell has nothing else in its budget to
  protect. **Open question for planning:** keep #25588 as-is for the
  single-call `runTournament` path (replays + judging share one function), or
  simplify it there too.
- **"Retry the failed candidate in a fresh budget"** — falls out for free: a
  cell *is* the retryable unit; retry = re-dispatch one cell, which already has
  its own 300s.

## Requirements (additive work that survives re-graining)

### R1 — Hydration timeout
Wrap the stage-1 hydrate step (`fetchUserTransactions`, `fetchPrivatePromptLog`)
with an explicit timeout so it cannot hang before execution starts. This is
load-bearing regardless of grain.

### R2 — Targeted retry classification
A new pure `classifyReplayFailure` that decides which failed cells earn a fresh
budget:
- **Retry:** deadline-cancelled, and transient errors (429, 5xx, network).
- **Stay failed (surface in eval):** deterministic errors (404 "No endpoints
  found", 400, model-not-found).

Reuses the existing `statusCode` extraction in `describeSdkError`
(`openrouter-sdk-client.ts:45-46`). **Capped at one retry round** to bound a
genuinely-slow-forever candidate. Mirrors the pure-function + test pattern
#25588 established (`decideEmptyRetry`, `describeReplayFailure`).

### R3 — Trust accounting
Each candidate ends a run in an **explicit, visible** terminal state:
`finished` / `failed-deterministic` / `recovered-on-retry` /
`gave-up-after-retry` / `skipped-low-budget`. The run summary must surface
these so a "completed" run doesn't mask the uncertainty that motivated this
work. State is per-cell, which makes the accounting cleaner than today's
per-shard summary.

### R4 — Client backstop
A client-side wall-clock catch for a cell whose function returns no body at all
(the original 504 pathology). Cheap insurance above the per-cell budget.

### R5 — Durable per-cell results
Results persist as each cell completes (not only at run end), so a partial run
keeps its finished cells and "reliable" means durable, not survived-the-request.
(This is also the seam that keeps a future async re-home cheap — but it earns
its place here on its own merits.)

### R6 — Cost comparison (the experiment's payload)
The tool must surface **original spend vs. replay spend** per candidate (and
aggregated per run) so it can answer its motivating question: does replaying
against candidate models save money? Replay cost is already captured per cell
(`costUsd` on `CompletionRow`); the requirement is to pair it with the source
generation's cost and present the delta. Without this the tool cannot fulfill
its near-term purpose, so it ranks alongside the reliability requirements rather
than as polish.

## Success Criteria

- A prompt with N candidates no longer fails as a unit when one candidate is
  slow; each candidate has its own 300s.
- A slow-but-healthy candidate is retried once in a fresh budget and recovers.
- A deterministic failure (404) is *not* retried and is visible in the run
  output.
- Hydration cannot hang a run indefinitely.
- The run summary reports a definite terminal state for every candidate.
- No regression in the default admin run (10 × 3).

## Non-Goals

- **Temporal / async orchestration / job-queue re-home — out of scope.** Even
  as a documented phase 2. The synchronous fan-out is *the* build.
- **Public / 100s-of-prompts / many-concurrent-users scale.** The synchronous
  model does not carry it; targeting it is a separate future decision, not this
  doc.
- **Raising `maxDuration`.** Confirmed impossible at the current Vercel Pro cap.
- **Cancellation work.** Set aside by request.
- **Changing #25588's soft-deadline mechanism for the single-call path** beyond
  the open question noted above.

## Key Risks / Unknowns

- **Hydrated-payload boundary (primary risk).** Messages + media now cross the
  function boundary as payload between stage 1 and stage 2. Size, serialization,
  and large-media handling need a sizing check in planning.
- **Invocation count.** Per-candidate fan-out multiplies function invocations
  (N candidates × M prompts). Confirm this is acceptable at admin run sizes and
  within existing concurrency limits (`REPLAY_CONCURRENCY = 8`,
  `REPLAY_REQUEST_CONCURRENCY = 4`).
- **`runTournament` single-call path.** Decide whether it adopts the same
  fan-out or keeps #25588's shared-function shape.

## Open Questions for Planning

1. Keep or simplify #25588's soft deadline on the single-call `runTournament`
   path?
2. Exact hydrated-payload transport — re-fetch a cached hydration by key, or
   pass the full hydrated messages as the cell's input?
3. Retry cap confirmed at one round, or budget-based (retry while shard-set
   wall-clock allows)?
