# Cache-Hit Generations Wrote NULL `endpoint_id` — 2026-07-19 → 2026-07-30

<!-- markdownlint-disable MD013 -->
| | |
| --- | --- |
| **Status** | Resolved. Web fix [#29563](https://github.com/OpenRouterTeam/openrouter-web/pull/29563) and warehouse companion [#702](https://github.com/OpenRouterTeam/openrouter-data-warehouse/pull/702) merged. We verified it in prod on 2026-07-30 across five monitoring runs over one hour, all green. |
| **Severity** | Low. Analytics data-quality only. No user-facing impact, no inference-path impact, and no alert. Found through a Slack data investigation. |
| **Duration** | Latent for the lifetime of response caching. The NULL-endpoint volume rose about 10 times starting 2026-07-19. Fixed on 2026-07-30. No backfill of historical rows. |
| **Affected system** | `default.generations` (ClickHouse) `endpoint_id` column for response-cache-hit rows |
| **Subsystems** | `cfw-api`, `clickhouse`, `routing`, `monitoring` |
<!-- markdownlint-enable MD013 -->

---

## TL;DR

Response-cache hits wrote `endpoint_id = NULL`. A NULL value does not separate a cache hit from a row with missing endpoint metadata. Because of this, cache hits inflated the NULL-`endpoint_id` population in `default.generations`.

The NULL-endpoint row count rose about 10 times starting 2026-07-19. The suspect population was about 1.97 million successful generations for one user on `google/gemini-2.5-flash-lite` through `google-vertex`. Each row had zero usage, NULL endpoint and provider metadata, and no BYOK. The investigation found response-cache replay, not a billing bypass.

The fix makes a cache hit write an all-zero sentinel `endpoint_id` (`00000000-0000-0000-0000-000000000000`, exported as `NIL_ENDPOINT_ID`) instead of NULL. A cache hit is now identifiable. It stays zero-billed and stays out of real-endpoint analytics.

This issue is separate from the 2026-07-17 poison-batch backlog. See Related. Both concern the `endpoint_id` value for a generation with no resolved real endpoint.

---

## Root Cause

- **Mechanism:** `buildCacheHitGeneration` (`services/cfw-api/src/utils/cache-hit-generation.ts`) never set `endpoint_id`. The value defaulted to `null` from `createEmptyClickHouseGeneration` (`packages/clickhouse/generations/index.ts`). A cache hit makes no provider call and has no resolved endpoint, so every cache-hit generation had `endpoint_id = NULL`.
- **Why it mattered:** NULL is also the value for a row with truly missing endpoint metadata. A cache-hit row therefore looked the same as a real gap. This polluted the NULL-`endpoint_id` population and blocked a clean exclusion from real-endpoint analytics.
- **Why the spike on 2026-07-19:** one user raised response-cache replay volume to about 1.97 million zero-usage hits. This is permitted. A cache hit is zero-billed by design and has no replay-count limit. This is not a billing bypass. A separate ticket tracks the replay-volume concern (PLA-929).

## Impact

- The impact was analytics data quality only. The NULL-`endpoint_id` share grew, and attribution in `default.generations` became ambiguous. There was no user-facing, billing, or inference-path impact. No alert fired.
- The inserts were valid, because NULL is a legal value for a `UUID` column. There was no ingestion failure and no backlog.

## Fix

- **Web ([#29563](https://github.com/OpenRouterTeam/openrouter-web/pull/29563), merged):**
  - A cache-hit generation writes the sentinel `endpoint_id = 00000000-0000-0000-0000-000000000000`. The constant `NIL_ENDPOINT_ID` is defined in `@openrouter-monorepo/enums`. We placed it there to avoid a `db -> clickhouse` dependency cycle.
  - ClickHouse migration `177` adds `AND endpoint_id != toUUID('00000000-0000-0000-0000-000000000000')` to the `MODIFY QUERY` clause of both `endpoint_perf_minute_v4_mv` and `endpoint_perf_daily_v4_mv`. This keeps cache hits out of endpoint latency, throughput, and request-count metrics.
  - `buildEndpointEditUrl` (`packages/db/generations-feedback/endpoint-edit-url.ts`) returns `null` for the sentinel. The Feedback flow then shows no dead `internal.openrouter.ai/endpoint/edit/000...` link.
  - The change preserves `usage = 0`, `usage_upstream = 0`, and `response_cache_source_id`. It copies the source token counts for analytics and does not zero them. It does not backfill historical rows.
- **Warehouse ([#702](https://github.com/OpenRouterTeam/openrouter-data-warehouse/pull/702), merged):** the upstream-usage discrepancy monitor (`orchestration/airflow/dags/upstream_usage_discrepancy_monitor.py`) excludes the sentinel.

## Verification (prod, 2026-07-30)

- A post-deploy hit had `endpoint_id = 000...0`, `usage = 0`, `usage_upstream = 0`, a populated `response_cache_source_id`, and copied source tokens. A pre-deploy hit had `endpoint_id = NULL`. This gives a clean before-and-after contrast.
- Five monitoring runs across one hour (15:32 to 16:32 UTC) passed. The post-rollout hour showed 100 percent sentinel rows and zero NULL rows. The zero-billing check found zero violations and zero sentinel rows without a source, across about 10,000 to 12,000 sentinel rows per run. `endpoint_perf_minute_v4` and `endpoint_perf_daily_v4` held zero sentinel rows. Datadog showed `cache_hit_generation_recorded` events. The `cache_hit_app_upsert_failed` and `"cache_hit billing"` error queries were empty.
- Query note: `endpoint_id` is not in the `default.generations` sort key (`clerk_user_id, created_at`). To keep a query fast, filter by a tight `created_at` window. In `endpoint_perf_minute_v4`, the time column is `date`, not `minute`.

## Follow-ups

1. **Bound cache-hit replay volume (PLA-929)** — a cache hit currently counts toward no rate limit. The RPM, RPD, user, and model limiters run in the provider-submit path, and the cache-hit branch returns before that path. The proposal is a dedicated per-entity cache-hit RPM and RPD limit that reuses the existing rate-limit infrastructure. This is a separate concern from the data-quality fix.

## Related

- **[ClickHouse Generations Poison-Batch Backlog — 2026-07-17](2026-07-17-clickhouse-generations-poison-batch.md)** — a separate but related incident. That incident wrote a non-UUID string (`router-placeholder-openrouter/bodybuilder`) into the `endpoint_id UUID` column. The string broke the `JSONEachRow` inserts and caused a queue backlog and user-visible dashboard lag. This incident wrote a valid NULL. The NULL inserted without error but polluted analytics. Both incidents share one modeling gap. The open question is what value `endpoint_id` holds for a generation with no resolved real endpoint. The two incidents are causally independent. Cache hits wrote NULL directly through the empty-generation default, not through the non-UUID-to-NULL coercion in #29375. The cache-hit spike started 2026-07-19, before #29375 deployed on 2026-07-20 at 15:43 UTC. Follow-up #4 of that incident, model `endpoint_id` as a branded UUID or `Zod .uuid()`, is the shared thread.

## References

- PR [#29563](https://github.com/OpenRouterTeam/openrouter-web/pull/29563) — cache-hit sentinel `endpoint_id`, perf-MV exclusion, and feedback-link fix (merged).
- PR [#702](https://github.com/OpenRouterTeam/openrouter-data-warehouse/pull/702) — warehouse discrepancy-monitor exclusion (merged).
- Linear PLA-929 — rate-limit response-cache hits (replay-volume follow-up).
