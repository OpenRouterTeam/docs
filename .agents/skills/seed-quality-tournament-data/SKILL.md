---
name: seed-quality-tournament-data
description: >-
  Seed data for quality-tournament wizard verification — IndexedDB run
  seeding (zustand-persisted history), the unreplayable-generation filter
  concept, and seeding real Spanner/ClickHouse generations for server-side
  log-filter parity tests. Sub-skill of
  verify-quality-tournament-wizard-ui.
allowed-tools: Bash,Edit,Read,Write,Browser
user-invocable: true
---

# Seed Quality Tournament Data

Seed run history and log data for quality-tournament verification. This
is Phase 2 of
[`verify-quality-tournament-wizard-ui`](../verify-quality-tournament-wizard-ui/SKILL.md);
it assumes the environment from
[`setup-quality-tournament-env`](../setup-quality-tournament-env/SKILL.md)
is up and signed in.

## Seeding a past run

Local ClickHouse rarely has log data, so you usually can't run a real
tournament. Seed history directly into the zustand-persisted IndexedDB
state instead (key `or-quality-tournament-v1` in the default idb-keyval
`keyval-store`/`keyval` database):

```bash
agent-browser eval "(async () => {
  const entry = {
    id: 'seed-run-1',
    result: {
      judgeMode: 'pairwise',
      judgeModelSlug: 'openai/gpt-4o-mini',
      judgments: [],
      candidateModelSlugs: ['openai/gpt-4o-mini', 'anthropic/claude-3-haiku'],
      startedAtIso: new Date(Date.now() - 300000).toISOString(),
      finishedAtIso: new Date().toISOString(),
      prompts: [],
      scores: [],
      warnings: [],
      judgingStatus: 'done',
    },
  };
  const payload = JSON.stringify({
    state: { candidateSlugs: [], judgeSlug: '', modality: 'text', history: [entry], activeRunId: null },
    version: 1,
  });
  const db = await new Promise((res, rej) => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { const tx = db.transaction('keyval', 'readwrite'); tx.objectStore('keyval').put(payload, 'or-quality-tournament-v1'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  return 'seeded';
})()"
```

Gotchas:
- `judgeSlug` must be `''`, never `null` (a null crashes
  `isJudgeConfiguredFor` with "Cannot read properties of null").
- `judgeMode` must be `'pairwise'`, `'single-llm-as-a-judge'`, or `'human'`; anything else is dropped
  by the rehydration migration.
- Reload the page after seeding; zustand only rehydrates on mount.

To assert persisted state after a UI action:

```bash
agent-browser eval "(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const v = await new Promise((res, rej) => { const tx = db.transaction('keyval'); const rq = tx.objectStore('keyval').get('or-quality-tournament-v1'); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  return JSON.parse(v).state.history.length;
})()"
```

## Concept: unreplayable generations are filtered out

Generations whose private prompt log is unavailable or non-message-based
can't be replayed. This includes transcripts that contain tool calls
(assistant `tool_calls`, a `tool`-role message, or `tool_use`/`tool_result`
content parts — no original tools to invoke; strict providers like
Moonshot/Anthropic/OpenAI 400 on an incomplete tool loop, ECO-1111) and
generations flagged as logged but missing a retrievable log. The tournament
filters them out server-side via `isExcludedPreview`: `fetchPromptPreviewsSA`
flags them so the Select Prompts step hard-excludes them, and
`loadHydratedPrompts` skips any that slip past the preview cap, pushing a
per-generation warning like:

```
Generation gen-... uses tool calls, which the tournament can't replay; skipped.
```

It renders in the amber warnings box on the run/results view (classic
`TournamentResults` today; the wizard Run & review step inherits the
same `warnings` array). To verify without real data, seed a run
("Seeding a past run" above) whose `warnings` contains a string of that shape and
confirm the amber box shows it verbatim. Real tool execution during
replays is future work (ECO-975).

## Seeding real generations (for server-side log-filter tests)

The `page.tsx` mock-injection pattern (sections ECO-1048/1049 in
[`verify-quality-tournament-features`](../verify-quality-tournament-features/SKILL.md))
**cannot** test the Select prompts log filters. Picking a model /
provider / API key / modality in the funnel — and the "Most used models"
preset — writes URL params (`model_slug`, etc.) and re-queries
`fetchUserTransactions` server-side, exactly like `/logs`
(PR #24761). A mocked `transactions` prop is bypassed by that re-query,
so filtering a mock always returns nothing. To exercise filters you need
real rows in the local Spanner emulator + ClickHouse.

Seed via the usage-record dev script (write a local-only
`seed-*.local.ts` under `services/usage-record/scripts/`, never commit
it), wrapping the run in Infisical so Spanner/ClickHouse creds inject:

```bash
infisical run --include-imports=false --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 \
  --env=dev --path=/ --recursive -- bun services/usage-record/scripts/seed-qt-demo.local.ts <billable_entity_id>
```

Requirements that bit me, in order of how much time they cost:

- **`is_openrouter_private_logging_enabled = true` on every seed row.**
  The wizard marks a row selectable only when this Spanner column is
  true (`wizard/select-prompts.ts`: `isSelectable: ... === true`). Without it
  the step renders "No logged generations found" even with 70+ rows
  seeded. Add the column to the script's `SPANNER_COLUMNS` and set the
  value to `true`.
- **Skew the distribution so the diff is visible.** The page loads only
  the ~20 most-recent rows. Seed a model with many total but few in that
  recent-20 (e.g. 21 GPT-4o overall, 5 in the recent page). Filtering to
  it then surfaces all of them — the proof that filtering hits all logs,
  not the loaded page. If every model is evenly spread you can't tell a
  server re-query from in-memory filtering.
- **Use a unique generation-id prefix** (e.g. `gen-qtdemo-*`) and a
  reset script (`client.TEST_deleteByPrefix('generations', [org,
  shardId])`) so re-seeds don't hit the `generations_by_id` UNIQUE
  index.
- Seed slugs must exist in the **live model catalog** to be filterable
  in the funnel dropdown (it searches the catalog, not your logs).
  `openai/gpt-4o` and `anthropic/claude-3.5-sonnet` resolve; retired
  slugs like `mistralai/mixtral-8x22b` do not appear in the search and
  can't be picked even though their rows exist.
