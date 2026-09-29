# ClickHouse Package Review Guidelines

## Integration Test Requirements

All new ClickHouse queries must be covered by integration tests.

Because the types are not auto-generated, the only sanity check we have that our DB schema lines up with our Zod schemas is actually running the queries we write in integration tests (exercising the expected behavior).

### How to write integration tests

- Place integration tests under `packages/clickhouse/integration/<domain>/` (e.g., `integration/endpoint-status/`, `integration/endpoint-perf/`)
- Integration tests use `bun:test` and run against a local ClickHouse instance
- Use `randomUUID()` for test endpoint/entity IDs to ensure isolation between test runs
- Insert test data via `insertGenerationsIntoClickHouse` and verify with the query function under test
- Always test the non-existent entity case (should return empty results)
- Never mock the ClickHouse query function under test; insert real data and query it

## Endpoint Performance Table Versioning

V5 is the production endpoint performance version; all endpoint performance helpers read exclusively from V5 tables. The V3 and V4 materialized views and backing tables (`endpoint_perf_{daily,minute}_v3`, `endpoint_perf_{daily,minute}_v4`, and their `_mv` counterparts) are retired (V3 dropped in `129_drop_endpoint_perf_v3.sql`, V4 dropped by a migration-only follow-up); flag any reference to them.

V5 is endpoint-first and workload-aware. Its sort key begins with `endpoint_id, perf_workload, service_tier_bucket, date`; `model_permaslug` and `variant` are aggregate metadata rather than supported filtering or grouping dimensions. V5 keeps the text admission and text E2E semantics of the earlier versions while admitting reviewed non-text workloads with modality-specific guards. Raw latency excludes missing or zero samples and uses `latency_request_count` as its population. Throughput remains text-only and uses `throughput_request_count` as its population. Unknown and not-applicable slice values remain distinct. Minute and daily V5 materialized views aggregate independently from `generations`. A prior cascaded design reduced CPU but worsened p95 insert latency. Revisit it only with a production-representative insert benchmark.

Historical migration files (e.g. `69_add_endpoint_perf_v3_mv.sql`) remain append-only and do not run as live queries.

*Source: [PR #22635](https://github.com/OpenRouterTeam/openrouter-web/pull/22635).*

## Time-series fan-out

Time-series orchestration must chunk independent query windows so a flat
`LIMIT` cannot discard the newest buckets from later windows. Preserve the
ordering and merge semantics when adding dimensions or changing fan-out
parallelism.

## Generation metadata

Generation insert paths must carry Cloudflare bot-signal fields consistently
with the generations schema and migrations. Query or insert changes should
update the relevant schema, mock, and integration coverage together.

## Server-tool analytics rows

Server-tool cost rows belong in spend materialized views, but must remain
excluded from request counts, latency, router, and endpoint-performance
analytics. App and provider activity consumers read V8 only; flag any
reference to the retired V7 tables or materialized views.
