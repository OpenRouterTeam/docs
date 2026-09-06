---
name: verify-quality-tournament-scenarios
description: >-
  Cross-cutting end-to-end test scenarios for the quality-tournament
  wizard (ECO-1153) — prompt visibility, run against baseline, pricing
  accuracy, human judging flow, progress bar accuracy, Postgres eval-run
  persistence for both judge modes, and server-side log-filter parity.
  Sub-skill of verify-quality-tournament-wizard-ui.
allowed-tools: Bash,Edit,Read,Write,Browser
user-invocable: true
---

# Verify Quality Tournament Scenarios

Scenario-oriented test plans that cut across multiple wizard steps
(ECO-1153). Use these when testing quality tournament wizard changes
end-to-end. This is Phase 4 of
[`verify-quality-tournament-wizard-ui`](../verify-quality-tournament-wizard-ui/SKILL.md).
Each scenario builds on
[`setup-quality-tournament-env`](../setup-quality-tournament-env/SKILL.md),
[`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md),
and the mock-injection patterns from the per-ticket checklists in
[`verify-quality-tournament-features`](../verify-quality-tournament-features/SKILL.md).
Capture a screenshot at every checkpoint marked **📸**.

## Scenario 1 — Prompt visibility

Verify the Select prompts step shows readable prompt text, token counts,
cost, and handles prompt-logging-disabled rows gracefully.

Setup: inject mock transactions per ECO-1048 (stub `transactions` in
`page.tsx` with a local-only mock array including one row with
`is_openrouter_private_logging_enabled: false`). Enter the wizard and
navigate to Select prompts.

```bash
agent-browser open http://localhost:3000/labs/quality-tournament
agent-browser snapshot
# Click "Try the new wizard" then "New eval"
```

**📸** Capture the populated table:
```bash
agent-browser screenshot /tmp/s1-prompt-table.png
```

- [ ] Each row shows readable prompt text (truncated with ellipsis if
      long), model name, token count, cost in USD, and date
- [ ] Disabled rows (prompt logging off) are grayed out and show the
      "Prompt logging was not enabled for this request" tooltip on hover
- [ ] Select-all skips disabled rows
- [ ] Cross-check: pick a generation ID from the table, navigate to
      `/activity` or `/logs`, locate the same generation, confirm token
      count and cost match

**📸** Capture a disabled-row hover tooltip:
```bash
agent-browser screenshot /tmp/s1-disabled-row.png
```

**📸** Capture the cross-check on `/activity`:
```bash
agent-browser open http://localhost:3000/activity
agent-browser screenshot /tmp/s1-activity-crosscheck.png
```

- [ ] No console errors or Next.js error overlay

## Scenario 2 — Run against baseline

Verify that selecting prompts, configuring candidates + LLM judge, and
running produces replays against baseline and each candidate, with
judging starting after replay completion.

Setup: use the `window.__qtStore` hook (ECO-1055 in
[`verify-quality-tournament-features`](../verify-quality-tournament-features/SKILL.md))
and the ECO-1056 stub setup (fake `runReplaysSA` / `judgePairSA` returning
`ok(...)` payloads with sleeps). Seed prompts, candidates, and judge:

```bash
agent-browser eval "window.__qtStore.getState().setSelectedGenerationIds(['gen-a','gen-b','gen-c']); window.__qtStore.setState({candidateSlugs:['openai/gpt-4o-mini','anthropic/claude-3-haiku'], judgeSlug:'openai/gpt-4o-mini'}); 'seeded'"
```

Advance to Run & review (the run starts automatically).

**📸** Capture the run mid-replay:
```bash
agent-browser screenshot /tmp/s2-run-replaying.png
```

- [ ] Replay phase total = prompts x candidates (3 x 2 = 6); counter
      increments as each replay resolves
- [ ] Replay phase completes (6/6), judging phase starts after

**📸** Capture the judging phase:
```bash
agent-browser screenshot /tmp/s2-run-judging.png
```

- [ ] Judging phase total = prompts x C(candidates+1, 2) pairs
      (3 x 3 = 9); counter ticks up per completed judgment
- [ ] Computing results phase runs and completes (1/1)

**📸** Capture the completion state:
```bash
agent-browser screenshot /tmp/s2-run-complete.png
```

- [ ] "Evaluation complete" heading with emerald check icon
- [ ] Summary strip shows accurate counts: replays = 6, judge calls =
      pair tasks x 2 (for position-swapped calls), duration matches wall
      clock
- [ ] IndexedDB history gains one entry (assert via the
      IndexedDB snippet in
      [`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md))
- [ ] Done returns to wizard home; stored-run count reflects the new run

## Scenario 3 — Pricing accuracy

Verify cost/token columns in Select prompts, the Configure step's cost
preview card, and the run summary strip all show accurate spend data.

**Step A — Select Prompts cost/token columns:**

Setup per Scenario 1 (mock transactions injected).

```bash
agent-browser snapshot
```

- [ ] Tokens column shows formatted numbers (e.g. `1,200`)
- [ ] Cost column shows USD values (e.g. `$0.0024`)

**📸** Capture the cost columns:
```bash
agent-browser screenshot /tmp/s3-prompts-cost.png
```

**Step B — Configure cost preview card:**

Seed 3 prompts and 3 candidates, enter the Configure step:

```bash
agent-browser eval "window.__qtStore.getState().setSelectedGenerationIds(['gen-a','gen-b','gen-c']); window.__qtStore.setState({candidateSlugs:['openai/gpt-4o-mini','anthropic/claude-3-haiku','google/gemini-2.0-flash-001']}); 'seeded'"
```

**📸** Capture the cost preview card (LLM judge mode):
```bash
agent-browser screenshot /tmp/s3-cost-preview-llm.png
```

- [ ] Replay calls = prompts x candidates (3 x 3 = 9)
- [ ] Judge calls = prompts x C(candidates+1, 2) x 2 (3 x 6 x 2 = 36)
- [ ] Est. spend shows a dollar amount or range with subtext "from model
      pricing" (fully priced) or "rough, some pricing data missing"

Switch to human judge mode:

```bash
agent-browser eval "window.__qtStore.setState({judgeMode:'human'}); 'set human'"
```

**📸** Capture the cost preview card (human mode):
```bash
agent-browser screenshot /tmp/s3-cost-preview-human.png
```

- [ ] Middle column reads "Prompts to review" with prompt count
- [ ] Spend drops to replay-only (lower than pairwise)

**Step C — Run summary strip spend:**

Complete a run (per Scenario 2) and check the summary strip.

**📸** Capture the summary strip:
```bash
agent-browser screenshot /tmp/s3-run-summary-spend.png
```

- [ ] Summary strip includes a `spend` stat with a dollar amount
      derived from actual replay costs (`totalRunSpendUsd`)
- [ ] 375px viewport: cost preview card fits without horizontal scroll

## Scenario 4 — Human judging flow

Verify the human judging path: replays run, judging shows blinded
side-by-side outputs, picking a winner highlights it, and results show
"You" as the verdict source.

Setup: seed for human mode:

```bash
agent-browser eval "
  window.__qtStore.getState().setSelectedGenerationIds(['gen-a','gen-b','gen-c']);
  window.__qtStore.setState({
    candidateSlugs: ['openai/gpt-4o-mini', 'anthropic/claude-3-haiku'],
    judgeMode: 'human',
    judgeSlug: '',
  });
  'seeded'
"
```

**📸** Capture the Configure step in human mode:
```bash
agent-browser screenshot /tmp/s4-configure-human.png
```

- [ ] "Judge it yourself" card selected (highlighted border)
- [ ] Judge model picker is hidden
- [ ] Cost preview middle column reads "Prompts to review"

Advance to Run & review. Replays execute as normal. After replays
complete, the judging phase shows a blinded side-by-side comparison.

**📸** Capture the blinded comparison:
```bash
agent-browser screenshot /tmp/s4-blinded-comparison.png
```

- [ ] Outputs labeled "Output A", "Output B", etc. (blinded — no model
      names visible)
- [ ] Each output shows the completion text

Pick a winner by clicking on the preferred output.

**📸** Capture the winner selection:
```bash
agent-browser screenshot /tmp/s4-winner-picked.png
```

- [ ] Selected output highlighted with emerald ring
- [ ] Pick is registered in state

Complete judging for all prompts and verify the results view.

**📸** Capture the results:
```bash
agent-browser screenshot /tmp/s4-results-human.png
```

- [ ] Summary strip method = "human review"
- [ ] Results subtitle mentions "You" as the judge source
      (`verdictSourceFromResults` returns the human-mode labeling)
- [ ] Breakdown tab: picks read "You picked ..." for each verdict;
      skipped prompts read "You skipped this prompt."
- [ ] "Reveal model names" toggle unmasks all blinded labels (baseline
      shows as "Original") and re-masks them

## Scenario 5 — Progress bar accuracy

Verify the overall progress bar advances smoothly, each phase shows
accurate completed/total counts, phases transition cleanly, and
completion shows the run summary strip.

Setup: 3 prompts, 2 candidates, LLM judge (per Scenario 2 seed).
Advance to Run & review.

**📸** Capture the initial progress state:
```bash
agent-browser screenshot /tmp/s5-progress-start.png
```

- [ ] "Running evaluation…" heading visible
- [ ] Overall progress bar at 0% (or very low)
- [ ] Three phases listed:
  1. "Replaying prompts on each model" — active (spinner icon)
  2. "Judging outputs" — pending (numbered circle)
  3. "Computing results" — pending (numbered circle)
- [ ] Phase 1 counter: `0/6` (prompts x candidates)

**📸** Capture mid-replay progress:
```bash
agent-browser screenshot /tmp/s5-progress-mid-replay.png
```

- [ ] Phase 1 counter increments (e.g. `3/6`)
- [ ] Overall progress bar advances proportionally
- [ ] No jumps or stuck states

**📸** Capture the replay→judging transition:
```bash
agent-browser screenshot /tmp/s5-progress-judging.png
```

- [ ] Phase 1: check icon, `6/6` (complete)
- [ ] Phase 2: spinner icon (active), counter ticking up
- [ ] Overall progress bar proportionally past the replay phase

**📸** Capture the judging→computing transition:
```bash
agent-browser screenshot /tmp/s5-progress-computing.png
```

- [ ] Phases 1 and 2: check icons
- [ ] Phase 3: spinner icon (active), `0/1` then `1/1`

**📸** Capture the completion:
```bash
agent-browser screenshot /tmp/s5-complete.png
```

- [ ] "Evaluation complete" heading with emerald check icon
- [ ] Summary strip visible: prompts, models + baseline, method,
      replays, judge calls, duration, and optionally spend
- [ ] Footer Done button enabled; Back button re-enabled

Navigation control checks:
- [ ] During run: Back and Done disabled; stepper steps locked
- [ ] After completion: Back and Done re-enabled
- [ ] Done returns to wizard home
- [ ] Re-entry (new eval → Run & review) starts a fresh run with zeroed
      counters and no stale duration from the previous run
- [ ] 375px viewport: progress bar, phase list, and summary strip fit
      without horizontal scroll

## Scenario 6 — Postgres eval-run persistence (both judge modes)

Beyond the zustand/IndexedDB persistence, completed runs are saved
**server-side** to the `prompt_replay_evals_runs` Postgres table by the
admin-gated private `POST /eval-runs` route. There are two runtime paths that
fire at different times — verify **both** land correct rows:

- **LLM-judge (Council)** — persists in the wizard's `onComplete`
  (`QualityTournamentWizard.tsx`), right after judging finishes.
  Expected row: `judge_mode='single-llm-as-a-judge'`, non-empty
  `judge_model_slugs`, judge's winners in `winner_model_slugs`.
- **Human** — `onComplete` early-returns for pending human runs (no
  judgments exist yet, so persisting there would write empty-winner
  rows). The row is persisted later in `use-human-finalize.ts`, after
  "Finish judging". Expected row: `judge_mode='human'`, **empty**
  `judge_model_slugs`, the user's picks in `winner_model_slugs` —
  never empty.

Read rows directly from local Postgres (psql is not installed on the VM;
go via docker):

```bash
docker exec openrouter-web_db psql -U postgres -d postgres -P pager=off \
  -c "SELECT judge_mode, judge_model_slugs, winner_model_slugs, session_id
      FROM prompt_replay_evals_runs ORDER BY created_at DESC LIMIT 10;"
```

### 6a — In the UI, when a real run is possible

If local ClickHouse has log data and a real tournament can complete:

- [ ] After an **LLM-judge** run reaches "Evaluation complete", a row
      appears with `judge_mode='single-llm-as-a-judge'`, the judge slug,
      and the judge's winner(s).
- [ ] After a **Human** run, no row exists once replays finish but
      *before* you click "Finish judging" (the `onComplete` gate). A row
      appears only after finalize, with `judge_mode='human'`, `{}` judge
      slugs, and your picks as `winner_model_slugs`.

### 6b — Headless fallback (when a real run can't complete locally)

Local ClickHouse rarely has log data, so a full UI run usually isn't
reproducible. To still verify the server-side write path, exercise the
exact shared functions both callers funnel through against local
Postgres:
`buildEvalRunRows` + `judgeModelSlugsForResult`
→ `toPersistEvalRunBody` (camelCase → snake_case column shapes)
→ `PersistEvalRunBodySchema` (the shared route schema, incl. the
`judgeMode ↔ judgeModelSlugs` `superRefine` invariant)
→ `insertPromptReplayEvalsRuns` (the real Kysely insert).

Write a throwaway `*.test.ts` colocated in
`projects/web/app/[locale]/(user)/(dashboard)/labs/quality-tournament/` (do NOT
commit it). Reuse the fixture builders from `persist-eval-run.test.ts`
(`makePrompt`, `makeCompletionRow`, the council/human judgment shapes) to
build a representative Council result and a finalized-Human result, then
run each through the functions above. Key fixture details:

- Include `ORIGINAL_CANDIDATE_SLUG` in `candidateModelSlugs`, else
  `buildEvalRunRows` skips the prompt (candidate-only runs persist
  nothing).
- Council judgment `verdict: TournamentVerdict.B` → the alternate wins.
- Human judgment `verdict: TournamentVerdict.A` → `ORIGINAL_CANDIDATE_SLUG`
  maps back to the baseline `sourceModelSlug`.
- `JudgeMode.Pairwise` is not currently user-selectable in the wizard
  (`ConfigureStep.tsx` exposes only Council + Human), but it's still
  accepted by `PersistEvalRunBodySchema` and shares the Council persist
  path. If it's ever re-exposed, add a third fixture covering it here.

The local DB context is hardcoded to
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` in
`@openrouter-monorepo/db/replica-routing/integration`. Add a throwaway
preload that calls `setupDbIntegrationContext` from
`@openrouter-monorepo/db/integration/setup-db-context` so `dbWrite` /
`dbRead` resolve the ambient context, then run:

```bash
bun run db:start   # if not already up
cd projects/web && bun test \
  --preload "<qt-dir>/tmp-preload.ts" \
  "<qt-dir>/tmp-persist-local-e2e.test.ts" --timeout 30000
```

- [ ] Council fixture inserts a `single-llm-as-a-judge` row with the
      judge slug and the alternate as winner.
- [ ] Human fixture inserts a `human` row with `{}` judge slugs and the
      baseline as winner (not empty).

**Clean up**: delete the test rows
(`DELETE FROM prompt_replay_evals_runs WHERE clerk_user_id LIKE '<your-prefix>%';`)
and remove the throwaway test + preload files. Nothing here is committed.

## Scenario 7 — Server-side log-filter parity (PR #24761)

Verify the Select prompts filters query **all** your logs server-side
(URL params + `fetchUserTransactions`), matching `/logs`, instead of
filtering the loaded ~20-row page in memory. This is the only scenario
that needs **real** seeded data — mock injection is bypassed by the
server re-query (see "Seeding real generations" in
[`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md)
for why and how to seed).

Setup: seed per that section with a skewed distribution (e.g. 21 GPT-4o
total, only ~5 in the recent-20). Sign in as the seed owner, enter the
wizard, "New eval" to Select prompts.

**📸** Baseline — capture the unfiltered page and count your skewed
model's rows (here: 5 GPT-4o among 20 mixed):
```bash
agent-browser screenshot /tmp/s7-unfiltered.png
agent-browser snapshot | grep -oiE 'cell "GPT-4o"' | wc -l
```

Apply the model filter via the funnel (see the agent-browser gotchas
under "Server-side log filters" in
[`verify-quality-tournament-features`](../verify-quality-tournament-features/SKILL.md)
— use `[cmdk-item]`, poll
the search, click via `eval`):
```bash
# open funnel -> Model -> search "gpt-4o" -> click the exact "GPT-4o" item
agent-browser eval "window.location.href"   # -> ...?model_slug=openai/gpt-4o
agent-browser snapshot | grep -oiE 'cell "GPT-4o"' | wc -l
```

**📸** Filtered wizard:
```bash
agent-browser screenshot /tmp/s7-filtered.png
```

- [ ] URL gains `?model_slug=openai/gpt-4o`; a "Model is GPT-4o" chip shows
- [ ] The filtered count (e.g. 20) is **greater** than the unfiltered
      count (e.g. 5) — proof the filter re-queried all logs, not the page
- [ ] `/logs?model_slug=openai/gpt-4o` shows the same set of rows
      (cross-check against ClickHouse:
      `SELECT model_permaslug, count() FROM generations WHERE ... GROUP BY 1`)
- [ ] "Most used models" preset writes one `model_slug` param per top
      model (`?model_slug=a&model_slug=b&model_slug=c`) and re-queries
- [ ] Clearing the filter drops the params and restores the full recent
      page, preserving any `user_id` scope

**📸** `/logs` parity:
```bash
agent-browser open "http://localhost:3000/logs?model_slug=openai/gpt-4o"
agent-browser screenshot /tmp/s7-logs-parity.png
```

- [ ] No console errors or Next.js error overlay through the whole flow
