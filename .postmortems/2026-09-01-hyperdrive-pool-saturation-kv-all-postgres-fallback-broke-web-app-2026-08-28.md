_Post-mortem for #incident-9-2026_08_28-hyperdrive_unavailability_

# Post-mortem: Hyperdrive pool saturation broke the web app 2026-08-28

| | |
|---|---|
| **Status** | Mitigated. Dedicated cfw-frontend-api Hyperdrive pool [#38410](https://github.com/OpenRouterTeam/openrouter-web/pull/38410) merged and deployed to resolve incident. |
| **Severity** | SEV-2 (IR-9) |
| **Duration** | Customer-visible errors 18:55–21:31 UTC (~2h 36m) |
| **Affected system** | Hyperdrive cached origin pools `or-db-production-pg-us-central1` (primary), replica and east4, and every worker sharing them |
| **Subsystems** | `cfw-api`, `cfw-frontend-api`, `postgres`, `cloudflare`, `infra`, `monitoring` |

## TL;DR

- **Duration:** 2h 36m of customer-visible impact, 18:55–21:31 UTC.
- **Root cause:** Isolates in Cloudflare's DLA (Douala, Cameroon) colo had not been able to fetch our ~10MB router info bundle `KV_ALL` thus were falling back to stale in memory caches since 18:25. When the deployment at 18:47 rolled a new fleet, every inference request to these isolates fell through to a direct fetch of more than 10MB JSON from the cached `or-db-production-pg-us-central1` connection in 2 parallel queries of upwards of 20 seconds each. In conjunction with pressure on the pool from the deployment itself, workers exhausted the pool. Clients in both inference workers _and_ the web API worker `cfw-frontend-api` therefore lost connectivity to the database for queries that used the "cached" pool, which included all writes.
- **Impact:** a severely degraded web app for ~40k logged-in users for ~2.5 hours. ~2,900 new signups had to re-dismiss the onboarding overlay on every page load. Users could not initiate credit purchases. Within the window there were 2,878 purchases ($190k) vs 3,636 ($267k). Most caught up after recovery, but potentially 207 purchases (~$14k) net shortfall. Private-endpoint inference ran slow but other inference was unaffected.
- **Fix:** [Isolated cached Hyperdrive pool](https://github.com/OpenRouterTeam/openrouter-web/pull/38410) for cfw-frontend-api, deployed 21:26–21:29.

## Timeline

| Time (UTC 2026-08-28) | Event |
|---|---|
| 18:25 | KV reads of `KV_ALL` start failing in DLA with `direct KV router config fetch failed, retrying once`. Small KV reads still work. The workers continue to serve inference from their stale in-memory cache. |
| 18:47 | Routine gradual cfw-api rollout begins. Old and new isolates coexist, observable as unique runtime_ids briefly stacking. |
| 18:51:13 | With the stale in-memory cache gone in the new DLA isolates, but KV still inaccessible, the DLA workers start to fall back to Postgres to get routing information. They begin to log `cfGlobalRouterConfigCache failed, falling back to postgres`. 22,094 follow from DLA through 21:45, vs 11 from the next-highest colo. From this point on **every inference request in DLA until 21:45 will result in a query to Hyperdrive to fetch 10MB of data.** |
| 18:52–19:00 | `or-db-production-pg-us-central1` cached HD pool connection usage climbs 46 → 101, before maxing out at ~125–147. |
| 18:59 | Frontend db errors begin at scale: `openrouter.db.error` on `service:cfw-frontend-api` as well as `request-timed-out` and `experienced Postgres error on read-only query`. |
| 19:12 | `or-db-production-pg-us-central1-replica` cached HD pool connection usage climbs. This indicates that queries have fallen through to retrying after 15s not being able to connect to Hyperdrive. |
| 19:13:47 | First alert in #alerts-platform, ~19 min after the first customer errors. |
| 19:17:31 | First human response in #alerts-api. |
| 19:35:56 | IR-9 declared, SEV-2. |
| 19:50:46 | Status page opened: https://status.openrouter.ai/incidents/l4Gmz6NbAW1o |
| 19:52 | Reads repointed to `or-db-production-pg-us-east4` via LiveConfig. |
| 19:58 | East4 saturates in turn, query timeouts continue. |
| 20:35 | Unrelated openrouter.ai/sign-in DDoS attempt, shed at the edge. No contribution to this incident. |
| 21:26–21:29 | [#38410](https://github.com/OpenRouterTeam/openrouter-web/pull/38410) stands up a new Hyperdrive config for `or-db-production-pg-us-central1` which is deployed as a replacement binding for `pg-us-central1` on `cfw-frontend-api`. Reads pointed back to pg-us-central1 from pg-us-east4. `experienced Postgres error on read-only query` and 408s immediately return to almost 0. |
| 21:31:24 | `cfw-api` redeployed. |
| 21:33–21:42 | Another spike in client queueing on `or-db-production-pg-us-central1`, but no impact on cfw-frontend-api or the web app. |
| 21:45:35 | Last DLA fallback log. |
| 22:33 | Status page resolved. |

## Root Cause

When KV is unavailable, the code in inference workers that fetches the router config (`cfGlobalRouterConfigCache`) can fall back to fetching the 10MB `KV_ALL` bundle as two parallel queries via Hyperdrive, `db.listModelsWithAuthor` and `db.listDBEndpointsHydrated`. For unclear reasons, `cfGlobalRouterConfigCache` caches results from KV in memory but not results from the DB. Any worker without access to KV therefore attempts to fetch ~10MB of data from the DB on every request.

The small DLA colo had been unable to fetch `KV_ALL` from KV since 18:25. Its isolates could fall back to in-memory cache until the 18:47-18:52 deployment, which spawned fresh isolates without the cache populated. DLA was producing 3-4 RPS, but they all failed with `Error fetching endpoints: timeout` and took a median 25s to do so.

The database was healthy during this whole period. The increased load did not make it upstream at all. Origin executions of this exact query on central1 held at ~60–80/10min baseline throughout. This indicates the query was in fact being served from the cache.

Interestingly, the day before (08-27), a similar KV impairment in the SIN colo produced ~39k identical fallback logs in about an hour but **no incident**. The fallback alone is not enough to trigger the pool exhaustion.

The main difference is that _right_ as fallback query volume increased in DLA, a gradual deploy doubled the number of isolates connecting through the pool.

One possibility is that during this period Hyperdrive had insufficient connections for the ramping workers, quickly causing these workers' clients to queue ("waiting Hyperdrive clients"). Once we've reached a sufficient queue depth, all queries are stuck waiting for 15 seconds and no progress is made.

**Why inference workers took down the web app.** cfw-api and cfw-frontend-api shared the same Hyperdrive pool. Once the pool was exhausted, every cfw-frontend-api query that used `dbWrite` or `dbRead` with `useCachedConnection` would queue for up to 15 seconds. As frontend routes carry a 10 second route timeout, many of these routes failed with a 408 after hanging for 10 seconds.

Redirecting the primary read workload to the replica (at 19:52, us-east4) did not help, because:

1. There was a latent bug where `dbWrite` queries were pointed at the cached pool instead of uncached pool. Since Hyperdrive ignores the cache for writes, this didn't normally matter. However in this case it made it so the app's most critical workloads were shared with the inference workers' most contended pool.
2. The "fall back to replica" logic was not terminated when the caller had timed out. In effect, a caller could abandon a query at 4 or 5 seconds, and the query itself could time out after 15 seconds and then _go to the replica pool_ and time out again. This meant that the switched-to replica was still contended by fallbacks.

> The 2026-08-07 incident had the same signature — one origin pool, all colos, ms execution once a slot was acquired, healthy Cloud SQL — and CF confirmed it as a Cloudflare network issue at ORD. Cloudflare reported no incidents covering the 08-28 window, so no separate CF-side contribution is indicated beyond the DLA KV impairment itself.

## Impact

- **Web app users.** ~39,900 logged-in users could not use the site for up to ~2.5 hours. Activity/Logs, API-key management and settings pages failed to load (404k failed page data fetches vs a ~500 baseline). Users on feature-flagged experiences got defaults on ~110k page loads.
- **New signups.** Signup itself worked, but **~2.9k new users** got stuck in an onboarding overlay that reappeared on every page load — the completion call failed silently. A post-recovery idempotent pass cleared it. Their acquisition-source answers (~4k) were permanently lost.
- **Credit buyers.** Purchases were widely blocked: checkout's frontend reads failed before reaching Stripe or Coinbase. Deferred, not lost. In-window volume 2,878/$190k vs 3,636/$267k the prior day, catch-up burst after recovery, net shortfall among affected users **207 purchases, ~$14k**. All 4,653 Stripe charges that went through credited normally. No credits lost.
- **Inference customers.** The vast majority saw no effect. Private-endpoint customers saw slow routing: requests completed, but average routing latency rose from 21ms to ~1.8s, and failures spiked to ~8.7% (vs ~1.9% baseline) for one 10-minute stretch.
- **Data quality.** ~100k generations are missing app attribution in rankings and logs. No functional data (credits, keys, generations) lost.
- **Not impacted.** Credits and settlement. ClickHouse ingestion.

## Mitigation

- **21:26–21:31** — dedicated Hyperdrive cached config for cfw-frontend-api ([#38410](https://github.com/OpenRouterTeam/openrouter-web/pull/38410)) deployed.

Frontend 408s fell to 21 in the 21:30–21:35 bucket and 0 after, vs 300–800/5min before. What remained: elevated private-endpoint routing latency (~1.2s average at 21:30, ~0.75s at 21:40, back to its ~20ms baseline by 21:45) and central1 read retries in bursts until ~21:42, so some fire-and-forget writes still failed.

The DLA KV-fetch failures tapered and ended ~21:45. Fallback volume fell from a 20:30–21:00 peak of ~7.6k/30min to ~725 across 21:30–22:00, last fallback log 21:45:35.

## Follow-ups (priority order)

Filed under the Linear project [2026-08-28 Hyperdrive outage](https://linear.app/openrouter/project/2026-08-28-hyperdrive-outage-e3b3be38292e/overview) except where noted.

1. **Partition pools per workload**
   - [x] [PLA-1521](https://linear.app/openrouter/issue/PLA-1521) cfw-frontend-api ([#38410](https://github.com/OpenRouterTeam/openrouter-web/pull/38410))
   - [ ] [PLA-1525](https://linear.app/openrouter/issue/PLA-1525) dedicated cfw-internal pool and a statement-timeout review
2. **Mitigate the router-config Postgres fallback**
   1. [PLA-1654](https://linear.app/openrouter/issue/PLA-1654): cache results of `cfGlobalRouterConfigCache` in memory instead of repeating the operation on every inference request if KV is unavailable
   2. [PLA-1655](https://linear.app/openrouter/issue/PLA-1655): remove the pg fallback entirely. If KV is unavailable, fall back to something semi-independent (eg GCS, R2, or a CF cache maintained separately)
3. [PLA-1530](https://linear.app/openrouter/issue/PLA-1530): **fix the budget inversion.** Queries that time out in 10 seconds should abort the fallback path of queries they called.
4. **Cut per-request Hyperdrive load off the inference hot path, eg private endpoints** ([PLA-1549](https://linear.app/openrouter/issue/PLA-1549))
5. **Incident-time control knobs.** [PLA-1518](https://linear.app/openrouter/issue/PLA-1518) shed app lookups or pg fetches. This is tricky since LiveConfig depends on KV.
6. **Query observability.** [PLA-1550](https://linear.app/openrouter/issue/PLA-1550) row-count and payload span attributes; [PLA-1540](https://linear.app/openrouter/issue/PLA-1540) statsd query accounting ([#38571](https://github.com/OpenRouterTeam/openrouter-web/pull/38571)).
7. **Detection monitors.** [PLA-1569](https://linear.app/openrouter/issue/PLA-1569) per-config pool occupancy at ~70% of ceiling; [PLA-1570](https://linear.app/openrouter/issue/PLA-1570) per-colo KV read failure monitor for large value fetches.
8. **Reduce size of KV bundle**
   - [x] Allowlist fields to reduce KV size ([#38431](https://github.com/OpenRouterTeam/openrouter-web/pull/38431))
   - [ ] Project fewer columns in routing query ([#38430](https://github.com/OpenRouterTeam/openrouter-web/pull/38430))
9. **Graceful degradation on enrichment reads.** [PLA-1571](https://linear.app/openrouter/issue/PLA-1571): return unenriched Activity rows when label lookups fail.
10. **App attribution via queue or batch writer.** [PLA-1572](https://linear.app/openrouter/issue/PLA-1572), instead of inline fire-and-forget writes.
11. **Fix onboarding when the DB is unavailable.** [PLA-1553](https://linear.app/openrouter/issue/PLA-1553): onboarding completion is fire-and-forget and its Postgres read gates the Clerk flag clear, which produced the recurring-overlay failure mode above.
12. **Route writes off the cached Hyperdrive pool.** [PLA-1650](https://linear.app/openrouter/issue/PLA-1650): these should always go on the non-cached pool to avoid future confusion.

## What went well

- **Inference was essentially unaffected.** Over 99.9% of requests succeeded throughout; only private-endpoint routing slowed.
- Carving out a dedicated frontend pool was a Hyperdrive config change plus a binding update, easy to do mid-incident, and it worked immediately: ~25 connections, zero waiters.
- **No credits were lost.** Payments deferred and caught up after recovery, and all Stripe charges credited normally.
- The DBM connection-versus-query evidence (backends +~50 with flat query throughput) plus the 08-27 control day gave a defensible causal chain and ruled the KV fallback out as the demand source.
- The read-retry surge monitor fired without human prompting, and its recovery cleanly bounded the incident.

## What could be improved

- Detection lagged 20 minutes behind the first customer-visible errors, and a pool-occupancy signal was available 20 minutes before the alert fired (follow-up 7).
- Three workload types with different availability expectations and precedence — inference, web app and internal — all drew from one shared Hyperdrive pool across 21 workers, so a pathology in one took down the others (follow-up 1).
- Unbounded serial retries amplified the failure ~3.4M times and exhausted replica pools too (follow-up 3).
- The onboarding completion failure was silent and unrecoverable in-session (follow-up 11).
- No control knobs existed to shed load during the incident (follow-up 5).

## Participants

John Krauss (commander), James Sterling, Robert Yeakel, Abhinav Pola, Audrey Lorberfeld, Matt Young, Dennis Jeong, plus other responders in #incident-9-2026_08_28-hyperdrive_unavailability.
