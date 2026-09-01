---
name: testing-kv-router-config
description: How to E2E-test router-config KV entries (all / all_v2), live-config gates, and the cfw-api read/fallback path on the local Tilt stack — warmer triggering, local KV writes, cache-TTL timing traps.
---

# Testing router-config KV entries locally

## Stack setup
- Launch Tilt with an Infisical token or many resources fail silently:
  `export INFISICAL_TOKEN="$(infisical login --method=universal-auth --client-id=$INFISICAL_CLIENT --client-secret=$INFISICAL_SECRET --plain --silent)"` then `TILT_PROFILE=lean tilt up`.
- The `kv-cache` resource may not start on its own; if port 8805 refuses connections while the resource shows Ready=False, run `tilt trigger kv-cache`.
- cfw-api: `http://localhost:8787` (health at `/health`); cfw-kv-cache: `http://localhost:8805/kv/<key>`. Local unlimited API key: `sk-or-v1-unlimitedkey`.

## Triggering the KV warmer
`curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'` runs `warmKVModelsAndEndpoints`; the completion log (in tilt output) includes `bytes_cached_all`, `bytes_cached_all_v2`, etc.

## Writing local KV values (live config, router config)
All wrangler dev processes share `--persist-to .wrangler/shared-state` (repo root). Write with:
`cd services/cfw-api && bunx wrangler kv key put <key> <value> --namespace-id <id> --local --persist-to ../../.wrangler/shared-state`
- Live-config namespace (KV_LIVE_CONFIG): `d585bc8446184f5488b55d038337e839`; keys are the schema key names, values JSON scalars (e.g. `router_config_v2_read_sample_rate` = `1`).
- Models/endpoints namespace (KV_MODELS_AND_ENDPOINTS): `a9f19f5cce304de08ce9b0d4eb20a852`; keys `all`, `all_v2`, etc. Use `--path file.json` for large payloads. Back up with `kv key get` before corrupting.

## Timing traps when testing the read path
- Live-config reads never block on KV: after an api restart, the FIRST request sees the schema default (e.g. sample rate 0) and only triggers a background refresh. 
- The router config is memoized in `cfGlobalRouterConfigCache` (FetchDeduper, TTL 5 min), so a changed KV value or sample rate only takes effect on the next revalidation.
- Reliable recipe to exercise a gated/corrupted read: `tilt trigger api` → send one warm-up chat completion → wait ~5.5 min → send a second completion → grep tilt log since a line-count mark for `kv-cache-binding fetch succeeded` (shows `key: 'all_v2'` vs `'all'`) and the fallback warning `KV_ALL_V2 router config fetch failed, falling back to v1`.
- `tilt trigger kv-cache` after overwriting KV keys, or its stale-while-revalidate HTTP cache may serve the old body. Even right after a warmer run, `/kv/<key>` may serve a stale SWR body — verify fresh payloads with `bunx wrangler kv key get <key> --namespace-id <id> --local --persist-to ../../.wrangler/shared-state` instead.
- Warmer DB-query results are deduper-cached per isolate: after seeding or editing rows in local Postgres, run `tilt trigger api` before re-triggering the warmer, or it re-serves the pre-seed data.
- If `tilt trigger api` fails to build with unresolved `@openrouter-monorepo/*` imports (e.g. `@openrouter-monorepo/env`), run `bun install` at the repo root first.
- The live-config change can lag one extra deduper cycle: the 5-min revalidation may still read the stale cached sample rate and only then background-refresh it. If the expected `key: 'all_v2'` fetch doesn't appear after the first wait, wait another ~5.5 min and send one more request before concluding failure.
- A pre-existing `KV cron warmup failed` ERROR from `warmKVServerToolCatalog` (ReDoS gauntlet on `openrouter:bash` allowed_domains pattern) appears every warm cycle locally; it is unrelated to `warmKVModelsAndEndpoints` — don't mistake it for a models/endpoints warmer failure.

## Devin Secrets Needed
- `INFISICAL_CLIENT` / `INFISICAL_SECRET` (universal-auth for local Tilt).
