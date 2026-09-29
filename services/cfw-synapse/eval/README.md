# Synapse eval harness

Measures the review panel against a corpus of cases with known-planted
defects and false-positive traps. **This is the promotion gate for
anything that changes agent behavior**: prompts, models, tools
(workspace, memory), roster changes. If the eval didn't run, the change
isn't proven.

## What a case is

`cases/*.json` — a fixture PR (same shape as `/__smoke/review`) plus
expectations:

- **mustFind** — planted defects the panel must catch. Matchers are
  path-fragment + any-of keywords, optionally pinned to the agent whose
  beat it is (panel-routing check).
- **mustNotFind** — traps: things that LOOK like findings but are
  deliberate bait (design choices declared intentional in the PR body,
  correct code adjacent to a pattern the roster tends to over-flag).
- **maxFindings** — noise ceiling. Exceeding it fails the case even at
  100% detection: an always-complaining reviewer is a failed reviewer.

Scoring reads the round's **rendered output** (line-comment fingerprints
and the consolidated comment), not internal submissions — a finding the
renderer drops counts as a miss.

## Running

```bash
# terminal 1 — dev worker with smoke routes
cd services/cfw-synapse
# OPENROUTER_API_KEY and API_TOKENS=<local bearer token> come from
# Infisical or .env.development.local
SMOKE_ROUTES=1 bun run dev

# terminal 2 — use one API_TOKENS bearer value the dev worker was given
export SYNAPSE_SMOKE_API_TOKEN=<local bearer token>
SYNAPSE_SMOKE_MODEL=<cheap slug> bun eval/run.ts   # cheap harness iteration
bun eval/run.ts                          # whole corpus, roster models
bun eval/run.ts --cases=sql-injection-basic
```

Every case runs real model loops — this is deliberate (fixture models
prove nothing about detection). Costs are bounded by the round budget;
set `SYNAPSE_SMOKE_MODEL=<cheap slug>` while iterating on the harness
itself (it rides each request as the fixture-scoped `modelOverride`),
and run WITHOUT it — the real per-agent roster models — when scoring a
change for promotion.

Thresholds are strict: every case must satisfy all must-find, trap, and
noise-cap expectations. The runner exits non-zero on any regression —
suitable for a manual/nightly CI job, NOT per-PR (token spend).

## Extending the corpus

Agent-facing conventions (the growth policy, the rendered-output scoring
contract) live in [AGENTS.md](./AGENTS.md) — that file is what agent
tooling picks up and enforces. Summary: add a case per incident — when
Synapse misses something in production a human later catches, or flags
something a human dismisses, that PR becomes a case (minimized,
anonymized if needed).

Current corpus:

| Case | Exercises |
| --- | --- |
| `sql-injection-basic` | aegis detection, swallowed-error catch, declared-intentional trap |
| `logic-bug-pagination` | plumb boundary/idempotency detection, declared-intentional perf trap |
| `perf-hot-path` | turbine N+1 + unbounded fetch, correct-Result-monad trap |
| `guideline-violation` | REVIEW.md rule enforcement + guideline prompt-injection flagging |
| `clean-docs-change` | pure noise ceiling — the perfect reviewer says nothing |

Known gaps to grow into: update-round cases (finding persistence/
resolution across two runs), truncated-diff cases (a prior finding past
the 200KB cap must not silently resolve), workspace-tool cases (defect
only visible outside the diff), memory cases (disposition suppression —
needs the memory service in the loop).
