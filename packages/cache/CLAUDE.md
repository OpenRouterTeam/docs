# Cache Package — Agent Guidelines

See the root [AGENTS.md](../../AGENTS.md) for repo-wide rules.

## Upstash Redis Usage Restriction

`redis-cache.ts` and `pending-charges.ts` wrap Upstash Redis. Cloud Run
services (`services/auth/**`, `services/batch-api/**`, `services/jerk/**`,
`services/gcp-*`, `projects/mission-control/**`) must NOT use these modules.
Use Valkey (Memorystore) over the VPC instead — see
`services/auth/src/valkey-cache.ts`.
