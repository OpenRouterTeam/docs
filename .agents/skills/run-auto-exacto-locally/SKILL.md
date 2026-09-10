---
name: run-auto-exacto-locally
description: Run the auto-exacto benchmark workflow end-to-end on a local machine, including endpoint-ID pinning verification. Covers the full stack (postgres, temporal, cfw-api, dev-fs-logs, gcp-bench-worker), required env overrides, the internal-entity API key requirement, and how to verify each generation routed to the pinned endpoint.
user-invocable: true
---

# Run auto-exacto locally

Auto-exacto chain: `scripts/temporal/run-auto-exacto.ts` → `autoExactoWorkflow` → `autoExactoModelWorkflow` (one per deduped endpoint + an unpinned `auto-routing` baseline) → `autoExactoEndpointWorkflow` → `benchmarkWorkflow` → `@openrouter/bench-harness`. Pinning: `endpointId` → the harness sends the `X-OR-Endpoint-Id` header → `applyInternalEndpointPin` records the pin on the user context at ingress → `packages/routing/filters/by-endpoint-id.ts` narrows the candidate set to the matched endpoint (Mutate; later hard gates still apply).

## Prerequisites / gotchas (each one cost real debugging time)

1. **Infisical auth** in every new shell before any `bun run x` / `bun run dev`:
   ```bash
   export INFISICAL_TOKEN=$(infisical login --method=universal-auth \
     --client-id="$INFISICAL_CLIENT" --client-secret="$INFISICAL_SECRET" --plain --silent)
   ```

2. **Internal-entity API key.** `applyInternalEndpointPin` silently ignores the header unless the key's `clerk_user_id` is in `INTERNAL_ENTITY_IDS` (`packages/routing/helpers/constants.ts`). The seed key `sk-or-v1-unlimitedkey` is NOT internal. Create a local key owned by the benchmarking org (`org_35qoLJ12T6wtYbJ1gpIvv8RhWM6`): insert a `users` row (is_organization=true, allow_negative_balance=true), a `credits` row, and an `api_keys` row whose `hash` is the sha256 of your chosen `sk-or-v1-...` token.

3. **Root `.env.development.local`** (repo root, NOT the service dir — `loadEnvOverrides()` reads from root; never commit it):
   ```
   BENCHMARKING_OPENROUTER_API_KEY=sk-or-v1-<your internal key>
   BENCHMARK_MODEL_OPENROUTER_BASE_URL=http://localhost:8787/api/v1
   BENCHMARK_TASK_OPENROUTER_BASE_URL=http://localhost:8787/api/v1
   PG_US_CENTRAL1_POOL_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
   ```

4. **`TEMPORAL_API_KEY` from Infisical breaks local temporal.** Run the trigger script with `TEMPORAL_API_KEY=""` so the client connects plaintext to `localhost:7233`.

5. **Temporal CLI against local server:** `temporal ... --address localhost:7233 --tls=false --namespace default` (env may carry a cloud namespace; override it).

## Start the stack (separate shells)

```bash
bun run dev:up
tilt wait --for=condition=Ready uiresource/api uiresource/api-kv-cron --timeout=300s
temporal server start-dev             # or let the worker dev script start it
tilt enable dev-fs-logs
tilt trigger dev-fs-logs
cd services/gcp-bench-worker && bun run dev   # task queue benchmark-queue; idles out after ~10 min
```

Worker must log "Loaded N override(s)" and "db-context-initialized". The worker webpack-bundles workflows at startup; restart it after changing workflow code.

## Trigger a small pinned run

Pick visible endpoint IDs for an enrolled model (SEED_MODELS in `run-auto-exacto.ts`):

```sql
select id, provider_name from endpoints
where model_permaslug='z-ai/<permaslug>' and deleted=false and is_disabled=false and hidden=false;
```

```bash
TEMPORAL_API_KEY="" bun run x scripts/temporal/run-auto-exacto.ts \
  -e "<endpoint-id-1>,<endpoint-id-2>" --wait
```

SEED_PRESETS already use `limit: 2` (2 questions per benchmark).

## Verify pinning

- DB: `select endpoint_id, provider_name, benchmark_type, accuracy, total_questions from benchmark_results where epoch is null order by created_at desc;` (the `epoch is null` filter selects the per-workflow aggregate row; without it you also get one row per epoch)
- Per-generation logs in `services/dev-fs-logs/.logs/<gen-id>/router/`:
  - `transaction-attempt.log` → `"endpoint_id"` must equal the pinned ID.
  - `routing/step.log` → `"stepName": "Filter by Endpoint ID"` with `"type": "mutate"` and the pinned endpoint slug. Baseline (`auto-routing`) runs show `"reason": "No internal endpoint pin present"` instead.
- Workflow IDs: `temporal workflow list --address localhost:7233 --tls=false --namespace default` — children look like `exacto.<date>.<hash>.<model>.<provider>.<endpoint>.<preset>.eN`.
