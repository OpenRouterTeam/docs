# Service Agent Guidelines

Every live-config schema key must have a `.default()`. Every schema passed to
`createGetLiveConfig` must have a colocated test that calls
`validateLiveConfigSchema`. A cold isolate read throws for a key without a
default.

Worker integration tests run in workerd through miniflare against real
Postgres and KV. `services/cfw-api/integration/AGENTS.md` holds the
conventions (what may be mocked, KV seeding, response assertions, banned
patterns); other services follow their own `vitest.*.config.mts`.

Live-config reads must never block on KV. A cold isolate serves the schema
default and refreshes in the background, so do not add `awaitFirstSync` call
sites or any other wait on the KV read in a request path — see `REVIEW.md`.

## Custom metrics for Worker services

Low-level Worker metrics (invocations, CPU/wall time, request duration,
memory, isolates, Workers Cache) are captured automatically by the shared
observability template. Service-specific metrics are owned by the service:

- Emit via `getStatsd()` from
  `@openrouter-monorepo/instrumentation/statsd`.
- Namespace as `openrouter.<service>.*` with snake_case metric names.
- Use only low-cardinality tags. Never tag with user IDs, raw request
  paths, or other unbounded values.
- In the same PR, add the metric's widgets to the service's dashboard by
  passing `custom_widgets` to the service's `cfw_service_dashboard` module
  instance in
  `configs/terraform-monitors/monitoring/cfw_service_dashboard.tf`.
  Do not fork the dashboard module.
