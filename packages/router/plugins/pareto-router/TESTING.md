# Testing the Pareto Router

This doc covers both day-to-day unit testing and the canonical local/prod rollout path for the `openrouter/pareto-code` router model.

## Unit & pipeline tests

```bash
bun run --filter @openrouter-monorepo/router test packages/router/plugins/pareto-router
```

Test files:

- [`tiers.test.ts`](./tiers.test.ts) — `pickSlugsFromTier` (threshold mapping, RNG injection, fallback order).
- [`index.test.ts`](./index.test.ts) — plugin-in-isolation: config parsing, resolution at each tier, error paths, log metadata.
- [`pipeline.test.ts`](./pipeline.test.ts) — plugin-in-context: drives `ParetoRouterPlugin` through `applyPluginResolveEndpoints` alongside sibling pass-through plugins that stand in for free-router (before) and body-builder (after). Verifies routerRequest threading and endpoint composition.

## End-to-end locally (pre-merge, per developer)

Router models are rows in `public.models` with `group = 'Router'`. The `openrouter/pareto-code` row is created in prod Mission Control (see [Production rollout](#production-rollout-post-merge)) and reaches local dev via the standard models/endpoints seed CSVs — no per-PR seed script, no hand-edited CSVs.

### 1. Make sure the row is in your local seed CSV

If `openrouter/pareto-code` already exists in prod, it will be in `postgres/seeds/models_rows.csv` after the next `Refresh Models and Endpoints` auto-PR lands. Confirm:

```bash
grep openrouter/pareto-code postgres/seeds/models_rows.csv
```

If it's not there yet, either (a) wait for the auto-PR, or (b) add the row in prod Mission Control yourself first (hidden) and trigger the refresh workflow — see the rollout section below.

### 2. Bring up the stack

```bash
bun run db:start
bun run db:reset   # drops + reapplies migrations + reseeds from CSVs
bun run dev        # or `tilt up` — starts web, mission-control, cfw-api
```

Use `TILT_PROFILE=lean tilt up` if encountering OOM.

Defaults: Mission Control `http://localhost:3001`, cfw-api `http://localhost:8787`, web `http://localhost:3000`.

Verify the row is visible:

```bash
curl -sS http://localhost:8787/api/v1/models | jq '.data[] | select(.id=="openrouter/pareto-code")'
```

Router models don't take endpoint rows — `ParetoRouterPlugin` attaches a real endpoint at request time via `createRouterModelPlaceholderEndpoint` and the resolved tier slug.

### 3. Send a request

```bash
curl -sS -X POST http://localhost:8787/api/v1/chat/completions \
  -H "Authorization: Bearer <your-local-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openrouter/pareto-code",
    "messages": [{"role": "user", "content": "write a haiku about a router"}],
    "plugins": [{"id": "pareto-router", "min_coding_score": 0.8}],
    "stream": false
  }' | jq
```

Expected:

- `response.model` is a concrete slug resolved from the high tier — either the dynamic AA-benchmark tier (when `USE_DYNAMIC_TIERS` is on and the AA benchmarks cache is populated) or the static `PARETO_CODE_TIERS.high` fallback.
- `response.provider` is real (not a placeholder).
- cfw-api log stream shows `ParetoRouterPlugin resolved model` with `pareto_min_coding_score=0.8`, `pareto_tier_requested=high`, `pareto_tier_actual=high`, and `pareto_resolved_model=<slug>`.

### 4. Try each tier

```bash
# min_coding_score 0.2 → low tier
curl ... -d '{..., "plugins": [{"id": "pareto-router", "min_coding_score": 0.2}] }'

# min_coding_score 0.5 → medium tier
curl ... -d '{..., "plugins": [{"id": "pareto-router", "min_coding_score": 0.5}] }'

# No min_coding_score → default (high)
curl ... -d '{..., "plugins": [{"id": "pareto-router"}] }'
```

Thresholds live in [`tiers.ts`](./tiers.ts) (`SCORE_THRESHOLD_HIGH = 0.66`, `SCORE_THRESHOLD_MEDIUM = 0.33`).

### 5. Chatroom smoke

1. Open `http://localhost:3000/chat`.
2. Pick `openrouter/pareto-code` from the model picker.
3. Send a message and verify a response comes back. The resolved slug surfaces in the response metadata / cfw-api logs just like the curl flow above.

### Multi-worktree testing

If you already have a Tilt instance running in another worktree (default ports 3000/3001/8787/8788/8801), spin this one up with offset ports instead of killing the other. The repo ships a [worktrunk](https://worktrunk.dev) config at `.config/wt.toml` that writes deterministic offset ports into `.env.worktree` on `wt create`; `bun run dev` / Tilt pick them up automatically. Every port referenced above shifts by the same offset — read the final values from `.env.worktree` and substitute them into the curl commands.

## Production rollout (post-merge)

Same operational path as for every other router row (`openrouter/auto`, `openrouter/free`, `openrouter/bodybuilder`, …).

1. Merge the Pareto code stack to `main`.
2. An operator opens prod Mission Control and adds the `openrouter/pareto-code` row:
   - `group = Router`
   - `slug` / `permaslug` / `hf_slug` = `openrouter/pareto-code`
   - `name` = `Pareto Code`
   - `description` = coding-optimized Pareto router; see [`tiers.ts`](./tiers.ts) for the underlying shortlist.
   - `context_length` = `200000`
   - `input_modalities` = `[text]`, `output_modalities` = `[text]`
   - `hidden = true` until launch.
3. Trigger the `Refresh Models and Endpoints` workflow to pick the row up into the seed CSVs:

   ```bash
   gh workflow run "Refresh Models and Endpoints" --repo OpenRouterTeam/openrouter-web
   ```

   (Or wait for the daily 13:00 UTC cron.) The workflow dumps the prod replica via [`scripts/seed/prod-get-seed-models-endpoints.ts`](../../../../scripts/seed/prod-get-seed-models-endpoints.ts) and opens a PR on branch `automated/refresh-models-endpoints`.

4. Review + merge that auto-PR. `postgres/seeds/models_rows.csv` now contains `openrouter/pareto-code`, so every dev gets the row on their next `bun run db:reset`.
5. When ready to launch, flip `hidden = false` in prod Mission Control. The next refresh PR will propagate that to the seed CSVs.
