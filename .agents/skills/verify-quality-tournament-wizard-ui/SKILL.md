---
name: verify-quality-tournament-wizard-ui
description: >-
  Verify the /labs/quality-tournament wizard UI end-to-end on local dev
  with agent-browser. Pointer skill that sequences the verification
  phases and routes to the sub-skill that owns each one — environment
  setup (admin gate, dev Clerk login, ffmpeg evidence capture), data
  seeding (IndexedDB runs, real Spanner/ClickHouse generations),
  per-ticket feature checklists (ECO-1043 tree), cross-cutting scenarios
  (ECO-1153), running a full tournament locally with mock data or real
  API calls, and verified API request fixtures. Run after every
  quality-tournament code push and attach evidence to the PR.
allowed-tools: Bash,Edit,Read,Write,Browser
user-invocable: true
---

# Verify Quality Tournament Wizard UI

Pointer skill for verifying the quality-tournament surfaces. It sequences
the phases and tells you which sub-skill owns each one; the detailed
procedures live in the sub-skills.

The goal: walk the quality-tournament surfaces in a real browser against
the local dev stack and capture proof (screenshots + state assertions)
for the PR description. The feature checklist grows with each ticket in
the Evals and Replays wizard work (ECO-1043 tree); extend it when your
PR adds a new surface.

## When to invoke

- After every code push that touches
  `projects/web/app/[locale]/(user)/(dashboard)/labs/quality-tournament/`
- Before reporting a quality-tournament PR as ready — attach the
  screenshots/recording to the PR description

## Phase map

```
Phase 1 — Environment setup     (setup-quality-tournament-env)
   dev stack, dev Clerk login, admin gate, agent-browser,
   ffmpeg evidence capture
   ↓
Phase 2 — Seed data             (seed-quality-tournament-data)
   IndexedDB run history; real Spanner/ClickHouse generations when a
   scenario needs the server re-query path
   ↓
Phase 3 — Feature checklists    (verify-quality-tournament-features)
   per-ticket checks for every wizard surface (ECO-1043 tree)
   ↓
Phase 4 — Cross-cutting scenarios (verify-quality-tournament-scenarios)
   end-to-end scenario plans (ECO-1153): prompt visibility, baseline
   runs, pricing accuracy, human judging, progress bars, Postgres
   persistence, log-filter parity
```

Two more sub-skills sit alongside the phases, used as needed:

- [`run-quality-tournament-locally`](../run-quality-tournament-locally/SKILL.md)
  — when you need an **actual** tournament (replay + judge calls) to run
  end-to-end with mock data, or with real API calls on cheap models
- [`quality-tournament-api-fixtures`](../quality-tournament-api-fixtures/SKILL.md)
  — verified real API request fixtures (TTS, image, chat + tool calls,
  streaming/reasoning/vision/structured-output matrix, Codex replay
  transcript) for sanity-checking a modality before tournament testing

## Sub-skills

| Phase | Sub-skill | Owns |
|-------|-----------|------|
| 1 | [`setup-quality-tournament-env`](../setup-quality-tournament-env/SKILL.md) | Dev stack startup, dev Clerk login, admin gate grant, agent-browser connection, screenshot + ffmpeg recording workflow, environment notes |
| 2 | [`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md) | IndexedDB run seeding, unreplayable-generation warnings, seeding real generations for server-side log-filter tests |
| 3 | [`verify-quality-tournament-features`](../verify-quality-tournament-features/SKILL.md) | Per-ticket checklists: baseline page, storage abstraction, wizard shell, select prompts, quick-select chips, server-side log filters, configure step, cost preview, real pricing, past evals, savings rollup, run progress, runner phase events, results tabs |
| 4 | [`verify-quality-tournament-scenarios`](../verify-quality-tournament-scenarios/SKILL.md) | Cross-cutting scenarios 1–7 (ECO-1153), incl. Postgres eval-run persistence for both judge modes |
| as needed | [`run-quality-tournament-locally`](../run-quality-tournament-locally/SKILL.md) | Mock transaction + prompt-hydration injection, Pairwise and Council runs, revert procedure, cheap-model real-API runs |
| as needed | [`quality-tournament-api-fixtures`](../quality-tournament-api-fixtures/SKILL.md) | Verified request fixtures in its `examples/` dir and how to replay them |

## Deliverables

- Screenshots at every checkpoint marked **📸** in the sub-skills, plus
  an ffmpeg recording for flow-level changes
- Checked-off items from the feature checklist and any scenario relevant
  to the change
- Evidence attached to the PR description before reporting it ready

## What this skill does NOT do

- Implement or fix quality-tournament product code — it only verifies
- Commit any of the mock/stub injection code the sub-skills describe —
  those are local-only and must be reverted
- Replace e2e or unit tests — this is browser-level verification on top
  of them

## Extending

When your PR adds a new quality-tournament surface, extend the checklist
in `verify-quality-tournament-features` (or add a scenario to
`verify-quality-tournament-scenarios`) in the same PR.
