# Multi-Region Replica Failover Runbook

How to manually shift main-database **reads** onto `pg_us_east4` when the default read path through `pg_us_central1` fails, as it did in the 2026-08-07 Hyperdrive pool-exhaustion outage ([post-mortem](https://openrouter.slack.com/docs/T053YQ6R5TR/F0BNFNBKS3H), Linear [PLA-1024](https://linear.app/openrouter/issue/PLA-1024/multi-region-replica-failover-runbook)).

This is a read shift, not a primary promotion. Writes, forced-primary reads, and the first attempt of primary-preferred reads keep targeting `pg_us_central1`, so a successful shift degrades the incident to **mostly writes-only disruption** (see Known limits). Nothing in this runbook changes which connection accepts writes.

## When to use this

Use it when the `pg_us_central1` connection path is failing but the database itself is healthy — the signature of the 2026-08-07 outage:

- `openrouter.db.retry{db.instance:pg_us_central1}` steps up while other instances stay flat, from all edge colos at once. Pool-exhaustion and connect timeouts arrive as `db.retry.reason:connection`; Postgres-reported errors use `db.retry.reason:error`.
- Queries complete in milliseconds once a pool slot is acquired; wall times cluster at the pool timeout.
- Cloud SQL itself looks healthy (low CPU, connections far under max).

Topology facts that make `pg_us_east4` the right target:

- The Hyperdrive origin pool for `pg_us_central1` is anchored at the Cloudflare datacenter nearest the origin (ORD for us-central1). A fault there takes out the pool for the whole fleet.
- `pg_us_east4` sits behind a different Cloudflare datacenter and a different network path to Google Cloud, so it survives an ORD-path fault.
- `pg_us_central1_replica` has its own pool but **shares the affected path** — it is NOT a safe fallback for this failure mode. Do not shift reads to it.

## How read routing works

Routing is driven by one config key, `main_database_replicas` (schema: `packages/type-utils/db-replica-config.ts`), stored in **two places** that must both be updated:

| Store | Consumers | Propagation |
| --- | --- | --- |
| Workers KV `LiveConfig` namespace | All `cfw-*` Workers (`packages/cloudflare/db-context.ts`); Node services with `CF_KV_API_TOKEN` (mission-control, gcp-* workers, batch-api, alert-evaluator, alert-delivery) | ~10 s (SWR TTL) |
| Vercel Edge Config | `projects/web` (`projects/web/instrumentation.ts`) | ~60 s (deduper TTL) |

Semantics (`packages/db/replica-routing/index.ts`):

- Connections with **weight > 0** share regular read traffic (weighted random).
- Connections with **weight 0** (not disabled) get no regular traffic but are tried as last-resort fallbacks when all positive-weight connections fail.
- `disabled: true` removes a connection from routing entirely.
- `primary` names the connection that receives all writes and forced-primary reads, regardless of weights.

Known limits — set expectations before you flip:

- **Writes still fail** while the primary path is down (that is the accepted degradation), and so do reads that force the primary (`primaryOnly`, read-your-writes paths).
- **Primary-preferred reads stay slow.** Reads with `primaryPreferred` are routed `[primary, ...replicas]` regardless of weights (`#resolveReadInstances`), so they still attempt the broken `pg_us_central1` first and pay one full connect timeout before falling back — after the shift the fallback is the healthy `pg_us_east4`, so they succeed slowly instead of timing out entirely. There are dozens of such call sites across packages, services, and web.
- **The auth service does not follow this config.** It compiles a static routing config (`services/auth/src/db.ts`) with both replicas at weight 0, so it already falls back to `pg_us_east4` automatically when the primary fails, but its steady-state reads cannot be shifted from here. Its fallback is serial too: each auth read burns a pool timeout on `pg_us_central1` and then `pg_us_central1_replica` (which shares the broken path) before reaching `pg_us_east4`, so expect auth reads to stay slow or time out during this failure mode.
- Workers reach `pg_us_east4` through their `HYPERDRIVE_PG_US_EAST4` binding. If a Worker lacks that binding it logs `replica enabled in routing config but Hyperdrive binding is missing` and keeps using whatever bindings it has.
- `pg_us_east4` taking the full read load is not routinely exercised — watch its latency and error rate after the shift (step 4).

## Procedure

### 1. Confirm the failure mode

Check the fault signature above. If the primary database itself is unhealthy (not just the connection path), this runbook does not apply — a read replica cannot take writes.

Do not assume the automatic zero-weight fallback makes this shift unnecessary. Fallback is serial: each read burns the full pool timeout on `pg_us_central1` (and then `pg_us_central1_replica`) before reaching `pg_us_east4`, so callers time out first. The per-attempt connect timeout is 3 s in Workers (`CONNECTION_TIMEOUT_SECS`, `packages/cloudflare/db-context.ts`) and 5 s in the web app (`connectionTimeoutMillis`, `projects/web/instrumentation.ts`), so two broken attempts cost ~6–10 s per read before east4 is even tried. During the 2026-08-07 window, `pg_us_east4` received only tens of read attempts per five minutes while `pg_us_central1` logged >100k. The weight flip makes east4 the first attempt, which is what actually restores reads.

Pre-flight: confirm `pg_us_east4` replication lag is at its steady state of ~0 s (`gcp.cloudsql.database.replication.replica_lag{database_id:*east4*}` in Datadog) — shifted reads serve whatever the replica has. If lag is elevated, check whether the primary → east4 leg's monitor is alerting — `replication_lag_us_central_to_us_east` watches the physical walsenders on `pg-us-central1` (which feed `pg-us-east4`) and fires above 5 minutes (`configs/terraform-monitors/monitoring/replication_lag_primary_to_us_central.tf`); sustained lag beyond a few seconds means shifted reads will be visibly stale, so weigh that staleness against the read outage before flipping.

### 2. Write the failover config to BOTH stores

Preferred path: **Mission Control → Admin Utils → Live Config** (`/admin-utils/live-config`, `projects/mission-control/app/admin-utils/live-config/`). The page shows both stores side by side, validates against the write schema, records an audit entry, and posts to the infra changelog Slack channel. Writes are restricted to the emails in `LIVE_CONFIG_WRITE_EMAILS` (`constants.ts` in that directory) — page someone on that list if you are not.

Failover value (shift reads to `pg_us_east4`, keep writes on the primary):

```json
{
  "primary": "pg_us_central1",
  "pg_us_central1": { "weight": 0, "disabled": false },
  "pg_us_central1_replica": { "weight": 0, "disabled": false },
  "pg_us_east4": { "weight": 1, "disabled": false }
}
```

Notes:

- Keep `primary: "pg_us_central1"` — pointing `primary` at a read replica would send writes to a database that cannot accept them.
- Leave `pg_us_central1` at weight 0 rather than `disabled: true` so it remains a last-resort fallback and recovers gracefully.
- The write schema rejects configs where the primary is disabled or no enabled connection has positive weight.
- Zero-weight fallbacks are tried in `DATABASE_CONNECTION_NAMES` order (`pg_us_central1`, then `pg_us_central1_replica`), so if `pg_us_east4` itself fails after the shift, reads fall back through the **broken** path — the failover only helps while east4 is healthy.

Write it to **both** the KV card and the Edge Config card. Updating only one store leaves the other surface (Workers vs. web app) on the broken path.

If Mission Control itself is down:

- **Workers KV**: edit the `main_database_replicas` key by hand in the Cloudflare dashboard — the `LiveConfig` namespace page is `https://dash.cloudflare.com/056879e63aa83db17aadc76220f52953/workers/kv/namespaces/d585bc8446184f5488b55d038337e839` (derived in `packages/cache/kv/constants.ts`).
- **Vercel Edge Config**: `PATCH` `https://api.vercel.com/v1/edge-config/<edge-config-id>/items?slug=openrouter` with an `upsert` of the key and a Vercel account token — the same request the Live Config page's "Manual backup" dialog generates (`manual-backup-curl.ts`); pre-save that curl before an incident since the dialog is unavailable when Mission Control is down. To find the `<edge-config-id>` without Mission Control, use the Vercel dashboard (team `openrouter` → Storage → Edge Config) or the `EDGE_CONFIG` env var on the web project, whose connection string is `https://edge-config.vercel.com/<edge-config-id>?token=...` (parsed by `parseEdgeConfigConnectionString` in `packages/cache/edge-config.ts`). The request body shape (matching `edgeConfigSet` in the same file) is:

  ```json
  { "items": [{ "operation": "upsert", "key": "main_database_replicas", "value": { "primary": "pg_us_central1", "pg_us_central1": { "weight": 0, "disabled": false }, "pg_us_central1_replica": { "weight": 0, "disabled": false }, "pg_us_east4": { "weight": 1, "disabled": false } } }] }
  ```

### 3. Wait for propagation

Workers and KV-reading Node services pick the change up within ~10 seconds; the web app within ~60 seconds. No deploy or restart is needed. The ~10 s is the per-consumer SWR cache TTL; Cloudflare KV is eventually consistent across regions and can take up to ~60 s to propagate the write everywhere, so a partial traffic shift (some colos on east4, others still on central1) during that window is expected, not a failed write.

### 4. Verify

- `openrouter.db.query_duration_ms` grouped by `db.instance` shifts to `pg_us_east4`; error-driven retries against `pg_us_central1` stop climbing for read traffic.
- The same metric grouped by `db.attempts` (`packages/db/context.ts`) drops back to 1 — reads reaching east4 on the first attempt instead of falling back through broken instances is the most direct confirmation the shift took effect.
- `projects/web` logs `edge-config: revalidation succeeded` (`CachedDBConfigProvider`, `packages/db/replica-routing/config.ts`) when the deduper refreshes (the `edge config: main_database_replicas resolved` line with the weights is only emitted at process start, e.g. on a new instance). The revalidation line confirms a refresh happened but does not show the resolved weights — treat the `openrouter.db.query_duration_ms` shift above as the primary confirmation.
- Watch `pg_us_east4` latency/error rate as it absorbs the read load.
- Expect continued write failures until the primary path recovers — that is the accepted degradation, not a failed shift.

### 5. Roll back after recovery

Once the `pg_us_central1` path is confirmed healthy, restore the default in **both** stores:

```json
{
  "primary": "pg_us_central1",
  "pg_us_central1": { "weight": 1, "disabled": false },
  "pg_us_central1_replica": { "weight": 0, "disabled": false },
  "pg_us_east4": { "weight": 0, "disabled": false }
}
```

This matches `DEFAULT_MAIN_DATABASE_REPLICAS` (`packages/type-utils/db-replica-config.ts`), which is also what consumers fall back to when the key is absent or unreadable.

If Mission Control is still down, use the same manual fallbacks as step 2 (Cloudflare dashboard for Workers KV, Vercel Edge Config PATCH) with this rollback value in place of the failover value.

Verify the rollback the same way as step 4: `openrouter.db.query_duration_ms` grouped by `db.instance` shifts back to `pg_us_central1`, and grouped by `db.attempts` stays at 1.
