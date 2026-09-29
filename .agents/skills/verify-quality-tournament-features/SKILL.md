---
name: verify-quality-tournament-features
description: Per-ticket verification checklists for the quality-tournament wizard (ECO-1043 tree), from baseline page through results tabs. Extend in the same PR when a new surface lands. Sub-skill of verify-quality-tournament-wizard-ui.
allowed-tools: Bash,Edit,Read,Write,Browser
user-invocable: true
---

# Verify Quality Tournament Features

Per-ticket checklists for the wizard surfaces. This is Phase 3 of
[`verify-quality-tournament-wizard-ui`](../verify-quality-tournament-wizard-ui/SKILL.md);
it assumes
[`setup-quality-tournament-env`](../setup-quality-tournament-env/SKILL.md)
(dev stack, admin gate, evidence capture) and
[`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md)
(IndexedDB run seeding, real-generation seeding).

## Checklist (grows per ticket)

Extend this list in the same PR whenever you add a quality-tournament
surface.

## Baseline page (always)
- [ ] `/labs/quality-tournament` loads without redirect (admin gate ok)
- [ ] A seeded run with a patched-transcript warning ([`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md),
      unreplayable-generations section) shows
      the amber warnings box with the warning text verbatim
- [ ] No Next.js runtime error dialog, no console errors
- [ ] Setup tab renders: log picker, candidate models, judge section,
      Run Tournament button

## ECO-1045 storage abstraction
- [ ] Runs tab empty state renders with no seeded data
- [ ] After seeding + reload, Runs tab shows `PAST RUNS (1)` with the
      seeded entry's date, prompt/candidate counts, and judge slug
- [ ] Delete run removes the entry, restores the empty state, and the
      IndexedDB assertion from
      [`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md)
      returns `0`

## ECO-1043 wizard shell
- [ ] "Try the new wizard" button in the page header opens the wizard
      home (Evals heading, New eval + Classic view buttons)
- [ ] "New eval" lands on the Select prompts step
- [ ] Gating with no prompts selected: Next disabled, Back disabled,
      Configure and Run & review stepper buttons disabled, footer reads
      "No prompts selected yet"
- [ ] With prompts selected (shared store state with the classic view),
      Next enables; Configure needs >= 1 candidate to advance; the last
      step shows Done, which returns to the wizard home
- [ ] "All evals" (header) returns to wizard home; "Classic view"
      returns to the legacy page, which still works
- [ ] 375px viewport: stepper collapses to numbered dots, sticky footer
      keeps Back/Next reachable
- [ ] Reload while inside the wizard lands back on the wizard home
      (wizard view/step are intentionally not persisted)

## ECO-1048 select prompts step
Local ClickHouse is empty, so the live page shows the error state. To
exercise the populated and empty states, temporarily stub the
`transactions` passed to `QualityTournamentContent` in `page.tsx` with a
local-only mock array (never commit it), then revert.

- [ ] Error state: with ClickHouse unreachable, the step shows "Logs are
      temporarily unavailable" with a retry button; Next stays disabled
- [ ] Empty state (mock `[]`): "No logged generations found" with a link
      to /settings/privacy; Next stays disabled
- [ ] Populated desktop table: rows show modality pill + generation id,
      model, tokens, cost, date; clicking a row or its checkbox toggles
      selection and updates "N of {limit} selected · $X total spend"
- [ ] Footer Next enables at >= 1 selected and advances to Configure,
      whose footer shows "N prompts"
- [ ] Sorting by Tokens/Cost reorders rows and preserves selection
- [ ] Select-all header checkbox selects every selectable row on the
      page (caps at the selection limit) and unchecking clears them
- [ ] Rows with `is_openrouter_private_logging_enabled: false` are
      disabled with a "Prompt logging was not enabled" tooltip and are
      skipped by select-all
- [ ] 375px viewport: table is replaced by cards; tapping a card toggles
      selection; Select all button works; no nested-button hydration
      error in the dev overlay

## ECO-1049 quick-select chips
Uses the same temporary mock-injection pattern as ECO-1048. Include a
mix of frontier-model permaslugs (opus / gpt-5 / gemini-2.5-pro), a
spread of costs and token counts, and one
`is_openrouter_private_logging_enabled: false` row.

- [ ] Chip row renders between the step intro and the selection count
      with per-chip match counts (Long prompts)
- [ ] Chips with zero matches are hidden
- [ ] Tapping "Long prompts" checks the top-token selectable rows
      (max 10), inverts the chip (`aria-pressed=true`), and updates
      "N of {limit} selected · $X total spend"
- [ ] Disabled rows are never selected by any chip
- [ ] Turning a chip off removes only the rows it added; manual picks
      stay selected
- [ ] Select all / Clear selection resets every chip to inactive
- [ ] 375px viewport: chips wrap to multiple lines, each chip is
      >= 40px tall and tappable

## Server-side log filters (PR #24761)
Requires real seeded data ([`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md),
"Seeding real generations") with a skewed distribution — the
mock pattern above can't reach the server re-query. Sign in, enter the
wizard, "New eval" to the Select prompts step. Note the baseline: how
many rows of your skewed model show in the unfiltered recent-20.

- [ ] Funnel filter ("Filter by Model, Provider, ...") → Model → pick a
      model: the URL gains `?model_slug=<slug>`, the rows re-query, and
      the count of that model exceeds what was in the unfiltered page
      (proves it queries all logs, not the loaded 20). Same slug on
      `/logs?model_slug=<slug>` shows the same set (parity)
- [ ] "Log filters" dropdown → "Most used models" writes one
      `model_slug` param per top model and re-queries (URL holds all of
      them); the dropdown's "Long prompts" quick-select still works
- [ ] "Clear" / clearing the filter chip drops the params from the URL
      and restores the full recent page, preserving any `user_id` scope
- [ ] Provider / API Key / Modality dimensions push their own params and
      re-query the same way

agent-browser gotchas for the funnel dropdown:
- The model results are `[cmdk-item]` elements. `[role=option]` matches
  the **wrong** listbox (the right-side "Jump to… Model/Provider/…"
  dimension menu) — querying it makes you click a table row by mistake.
- The catalog search is backend-ranked, not a substring filter. `gpt-4o`
  narrows the list reliably; a full display name like `Claude 3.5
  Sonnet` may return the default popular set instead. Poll until the
  exact `[cmdk-item]` whose trimmed text equals the model name appears,
  then `.click()` it. Refs (`@eN`) drift between snapshot and click once
  the list virtualizes, so click via `eval` against the live DOM rather
  than a stale snapshot ref.

## ECO-1050 configure step
The model pickers need a warm KV model catalog. With local ClickHouse
empty, run a stub HTTP server on `localhost:18123` that returns
`{"meta":[],"data":[],"rows":0,"statistics":{"elapsed":0,"rows_read":0,"bytes_read":0}}`
for all requests, point `CLICKHOUSE_URL` (and the readonly vars) at it
via the repo-root `.env.development.local`, restart cfw-api, then
trigger the warm cron:
`curl "http://localhost:8794/__scheduled?cron=*%2F5+*+*+*+*"` and wait
~30s. Reach the step by seeding `selectedGenerationIds` via the
local-only `window.__qtStore` line (see ECO-1055) and clicking Next.

- [ ] Candidate picker lists real models; picking adds a removable chip
      and writes the slug to `candidateSlugs` in localStorage
- [ ] Duplicate picks are no-ops; the 7th pick is rejected (MAX 6) and
      the picker shows the "maximum reached" hint
- [ ] Chip X removes the candidate; footer Next disables below 1
      candidate
- [ ] Judge mode cards: LLM judge selected by default in Text mode;
      clicking "Judge it yourself" hides the judge picker and shows the
      manual-judging banner
- [ ] LLM judge mode: Next stays disabled until a judge model is
      picked; judge chip X clears `judgeSlug` and disables Next again
- [ ] Human mode: Next enables without a judge slug
- [ ] Cost preview placeholder card renders (ECO-1053 slot)
- [ ] "Suggest cheaper models" with fake generation ids surfaces the
      server error message in the inline error slot (locally expected;
      real suggestions need live ClickHouse data)
- [ ] Back returns to Select prompts with selection intact
- [ ] 375px viewport: cards stack, chips wrap, sticky footer reachable,
      no horizontal scroll

## ECO-1053 cost preview card
Reach the Configure step per ECO-1050. Candidates can be seeded with any
slugs via the local-only store hook:
`window.__qtStore.getState().setCandidateSlugs(['m/a','m/b','m/c'])`.
Flat fallback rates (used by ECO-1054 when pricing/token data is
missing): $0.02 per replay call, $0.012 per judge call.

- [ ] With 0 candidates the card shows 0 replay calls, 0 judge calls,
      $0.00
- [ ] Replay calls = prompts x candidates (3 prompts x 3 candidates =
      9); judge calls = prompts x C(candidates + 1, 2) x 2
      (3 x 6 x 2 = 36); est. spend $0.61
- [ ] Switching to "Judge it yourself" relabels the middle column to
      "Prompts to review" (= prompt count) and spend drops to
      replay-only
- [ ] Adding/removing a candidate recomputes all three columns
      immediately
- [ ] 375px viewport: the 3-column card fits with no horizontal scroll

## ECO-1054 real pricing-based spend estimates
Reach the Configure step per ECO-1050. Local generation ids are fake, so
there are no matching transactions; inject token stats via the local-only
hook in `ConfigureStep.tsx` (add `?? globalThis.__qtVerifyStats?.[id]` to
the `statsByGenerationId.get(id)` lookup, never commit it), then in the
browser BEFORE entering Configure:
`window.__qtVerifyStats={'gen-verify-1':{promptTokens:1200,completionTokens:400},...}`.
Pricing comes from the warmed KV catalog; check which slugs are priced via
`/api/frontend/v1/catalog/models` (some, e.g. google/gemini-2.0-flash-001,
have no endpoint pricing locally and trigger the fallback).

- [ ] All candidates + judge priced and token stats present: Est. spend
      shows a `$low-$high` range with subtext "from model pricing"
- [ ] One unpriced candidate: spend still a range but subtext flips to
      "rough, some pricing data missing"
- [ ] No token stats (delete `__qtVerifyStats`, re-set generation ids):
      spend collapses to the flat $0.61 (3 prompts x 3 candidates,
      pairwise) matching the ECO-1053 numbers
- [ ] Human mode: middle column "Prompts to review", spend is
      replay-only and lower than pairwise
- [ ] 375px viewport: range value fits without breaking the 3-column
      card layout
- [ ] Non-text modality (`window.__qtStore.setState({modality:'image'})`
      with token stats present): spend uses flat per-call rates and the
      subtext flips to "rough, some pricing data missing" (token pricing
      only models text costs; image/audio pricing fields are not used)

## ECO-1046 past evals home view
Seed two history entries ([`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md),
"Seeding a past run"): one pairwise run with judgments
that recommend a cheaper model (savings outcome) and one run with no
switch recommendations (keep outcome). Reload after seeding, then enter
the wizard.

- [ ] Empty state (no seeded data): "No evals yet" card with a New eval
      button that advances to Select prompts
- [ ] Populated desktop (md+): "PAST EVALS" table with Name (started-at
      date), Method, Prompts, Models, When (relative time), Outcome
- [ ] Savings run shows "$X projected · N% cheaper"; keep run shows
      "Keep current"; an unfinished run shows "Judging pending"
- [ ] Clicking a row opens that run on the Run & review step
- [ ] "Eval actions" menu > Delete eval opens a confirm dialog naming
      the run; Cancel keeps the row
- [ ] Confirming Delete removes the row, stays on the wizard home (must
      NOT open the run), and the IndexedDB history-length assertion
      (see [`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md))
      drops by one
- [ ] Deleting the last run restores the empty state
- [ ] 375px viewport: table is replaced by stacked cards with the same
      name/meta/outcome and a working actions menu

## ECO-1047 savings rollup card
Uses the same two seeded runs as ECO-1046 (one savings, one keep).
Note: persisted pairwise runs cannot rehydrate as judging-pending (the
store migration finalizes them), so to exercise the hidden state mutate
the seeded entries to `judgeMode: 'human'` with empty `scores` and
`humanPicks` while on a different page, then navigate back. Mutating
IndexedDB while the wizard page is open gets overwritten by the live
store; always seed/mutate from another route.

- [ ] With the savings + keep seed: emerald "PROJECTED SAVINGS" card at
      the top shows the dollar total with exactly two decimals and
      "avg N% cheaper" (78% with the standard seed)
- [ ] Copy reads "Across 1 of your 2 completed evals, ..." matching the
      seeded counts
- [ ] Delete the savings run: card switches to the zero-state copy
      ("No cheaper model has held quality yet...") with $0.00 and
      avg 0% cheaper
- [ ] Delete the last run: card disappears with the empty state
- [ ] Pending-only history (human-mode mutation above): rows show
      "Judging pending" and the card is hidden
- [ ] 375px viewport: card wraps with the amount below the copy, no
      overflow

## ECO-1055 staged run progress view
Seed prompts and candidates before entering the run step (no real
runner yet; the run is driven by simulated phase events). The store is
not exposed on `window`; add a local-only line at the bottom of
`store.ts` (never commit it), then revert after the pass:

```ts
if (typeof window !== 'undefined') {
  Object.assign(window, { __qtStore: useQualityTournamentStore });
}
```

Then from the Select prompts step:

```bash
agent-browser eval "window.__qtStore.getState().setSelectedGenerationIds(['gen-a','gen-b','gen-c']); window.__qtStore.setState({candidateSlugs:['openai/gpt-4o-mini','anthropic/claude-3-haiku']}); 'seeded'"
```

Note: New eval (startNewEval) clears the selection, so seed after
entering the wizard step, not before.

- [ ] Next > Run evaluation lands on Run & review showing "Running
      evaluation…" with an overall progress bar and three phases:
      Replaying prompts on each model (prompts x candidates), Judging
      outputs (prompts x pairs incl. baseline), Computing results (1)
- [ ] Phase counters tick up live; active phase shows a spinner,
      finished phases a check, pending phases a numbered circle
- [ ] While running: footer Back and Done are disabled, stepper steps
      are locked
- [ ] On completion: "Evaluation complete" with a summary strip
      (prompts, models + baseline, method, replays, judge calls,
      duration); Back and Done re-enable
- [ ] The run persists on completion: IndexedDB history-length
      assertion (see
      [`seed-quality-tournament-data`](../seed-quality-tournament-data/SKILL.md))
      increments by one
- [ ] Done returns to the wizard home; the stored-run count line
      reflects the new run
- [ ] Re-entering Run & review starts a fresh run with zeroed counters
      (no stale duration from the previous run)
- [ ] 375px viewport: phase list, progress bar, and summary strip fit
      without horizontal scroll; sticky footer keeps Done reachable

## ECO-1056 real tournament-runner phase events
The wizard run step now drives the real `TournamentRunPhaseEvents`
driver (per-prompt `runReplaysSA`, per-pair `judgePairSA`). With empty
local ClickHouse and no model credits, stub the two server actions
locally: in `QualityTournamentWizard.tsx`, swap the `deps` passed to
`TournamentRunPhaseEvents` for local fakes returning `ok(...)` payloads
with sleeps (never commit). The driver, progress math, summary strip,
and IndexedDB persistence stay real. Seed prompts/candidates AND a
judge: include `judgeSlug` in the store seed (empty judge skips the
judging phase with a warning).

```bash
agent-browser eval "window.__qtStore.getState().setSelectedGenerationIds(['gen-a','gen-b','gen-c']); window.__qtStore.setState({candidateSlugs:['openai/gpt-4o-mini','anthropic/claude-3-haiku'], judgeSlug:'openai/gpt-4o-mini'}); 'seeded'"
```

- [ ] Run evaluation: replay phase total = prompts x candidates and
      ticks up as replay calls resolve (stub delays make this visible)
- [ ] Judging phase total re-anchors to the real comparison count
      (prompts x pairs over candidates + baseline) when the phase starts
- [ ] While running: Back/Done and all stepper buttons disabled
- [ ] On completion the summary strip shows REAL counts: replays =
      prompts x candidates, judge calls = pair tasks, duration matches
      wall clock (not the simulated placeholder numbers)
- [ ] IndexedDB history gains a real `PairwiseTournamentResults` entry:
      assert `history[0].result` has the seeded prompt count,
      `judgments.length` = judge calls, non-empty `scores` including
      `__original__`, `judgingStatus: 'done'`, `id` = `startedAtIso`
- [ ] Wizard home stored-run count line increments after Done
- [ ] Empty `judgeSlug` seed: judging shows 0/0, run completes, stored
      result has no judgments and a missing-judge warning
- [ ] 375px viewport: run + summary fit without horizontal scroll

## ECO-1057 results recommendations tab
Note: this UI lands via PR #24086 and #24087; this section applies once
those merge to main.

Uses the same ECO-1056 stub setup (fake `runReplaysSA` / `judgePairSA`,
seeded prompts + candidates + judge). After the run completes the
minimal summary is replaced by the full results view.

- [ ] RunSummary strip above the tabs shows replays, judge calls,
      method (LLM judge or Human), duration, and spend
- [ ] Tabs render Recommendations | Breakdown with Recommendations
      selected by default
- [ ] Recommendations tab shows one SourceRec card per source model:
      "Switch and save" cards name the cheaper winner with per-prompt
      win counts, "Keep current" cards explain why the original holds
- [ ] Projected savings rollup banner totals the switch cards' savings
      and shows avg % cheaper plus the judge-agreement confidence label
      (e.g. High / 100%); hidden when there are no switch recommendations
- [ ] Pairwise runs show council-confidence labeling from the judge
      data; human-mode runs label verdicts as your blind picks
- [ ] Tab switch to Breakdown and back preserves the strip and cards
- [ ] 375px viewport: strip wraps, cards stack one column, no overflow

## ECO-1059 results breakdown tab
Note: this UI lands via PR #24086 and #24087; this section applies once
those merge to main.

Same stub setup as ECO-1057. Open the Breakdown tab on the results
view.

- [ ] One collapsible comparison card per prompt, first card expanded;
      header shows the prompt text and chevron toggles open/closed
- [ ] Each expanded card: blinded output columns labeled Output A/B/C
      with cost · latency in the header and the completion body below
      (text or media via the shared renderer)
- [ ] Blinded ordering differs across prompts (the baseline must not
      sit in the same column on every card) and stays fixed across
      expand/collapse and reveal toggles
- [ ] Winner column gets the emerald ring + check; the card header
      shows a winner badge ("judge pick" blinded, model name revealed)
- [ ] Judge picks section lists each judgment: judge slug, picked
      output (blinded label pre-reveal), reasoning text; ties read
      "picked a tie"
- [ ] Human-mode runs: picks render as "You picked ..."; tie picks say
      a tie, skipped prompts say "You skipped this prompt."
- [ ] "Reveal model names" toggle unmasks every blinded label across
      all cards at once (baseline shows as "Original") and back; image
      alt-text must not leak slugs while blinded
- [ ] Prompts with no decisive winner show no badge and no highlight
- [ ] 375px viewport: output grid stacks to one column, toggle stays
      tappable (>= 40px), no horizontal scroll

