# Rate Limit Package — Agent Guidelines

See the root [AGENTS.md](../../AGENTS.md) for repo-wide rules.

## Upstash Redis Usage Restriction

This package wraps Upstash Redis. Cloud Run services (`services/auth/**`,
`services/batch-api/**`, `services/jerk/**`, `services/gcp-*`,
`projects/mission-control/**`) must NOT use this package. Use Valkey
(Memorystore) over the VPC instead — see `services/auth/src/valkey-cache.ts`.

## Documented Exception: Denial-Only Block Cache

`block-cache.ts` holds a module-level, isolate-local `Map` of rate-limit
denial expiries. The root [AGENTS.md](../../AGENTS.md) rule **No per-isolate
caching** otherwise forbids this for state that varies per user or request.
This is an explicit, approved exception
([#38018](https://github.com/OpenRouterTeam/openrouter-web/pull/38018)).

It holds only under all of the following. Break any one of them and the
exception no longer applies:

- **Denials only.** The cache stores `identifier -> block expiry`, never an
  allowance. A cache miss falls through to Redis, so isolate divergence can
  only under-enforce; it can never admit a caller Redis would have limited.
- **Bounded.** `MAX_BLOCK_CACHE_ENTRIES` (4096) caps the shared store across
  all scopes, with expired-first then oldest-first eviction.
- **Self-expiring.** Every entry expires at the end of the limiter window it
  was written in, so there is no staleness beyond one window and no
  invalidation path to get wrong.
- **Scoped by limiter configuration.** Entries are keyed by the vendor's
  prefixed identifier plus `requests`, `interval` and `algorithm`, so a
  limiter whose cap is computed per request cannot deflect a caller whose cap
  has since changed. A caller whose token cost varies per request must pass
  `variableRate: true`, which opts out of the cache entirely.
- **Observable.** Deflected checks are tagged `outcome:cache_blocked` on
  `openrouter.ratelimit.slow_check_ms`, so the cache's effect is visible in
  monitoring rather than hidden in an isolate.

The reason this is not an approved shared mechanism: the whole saving is the
round trip. Redis, KV and a Durable Object would each reintroduce the network
call this cache exists to avoid, and the Redis write it removes is already the
cheapest of those.

Do not generalize this to other caches in this package. A new isolate-local
cache needs its own documented exception, argued on its own terms.
