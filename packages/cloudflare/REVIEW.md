# Cloudflare Package Review Guidelines

Flag live-config schema keys without `.default()` and schemas passed to
`createGetLiveConfig` without a colocated `validateLiveConfigSchema` test. A
cold isolate read throws for a missing default; there is no KV fallback.

## Live-config reads must stay non-blocking

`LiveConfigReader.get` / `getMany` must return the cached value or the schema
default and refresh KV through `waitUntil`. Reject any change that makes a read
wait on network I/O, including:

- reintroducing an `awaitFirstSync`-style option on `get`, in any worker
- awaiting an in-flight revalidation, the KV read, or the background refresh
  task inside `get` / `getMany` / `#startRevalidation`
- any new option, wrapper, or helper whose effect is that a request waits for
  KV before proceeding

The schema default is the value a cold isolate answers with, including for
auth-critical gates, so it must track the gate's intended steady state — a gate
defaulting off while production KV has it on 401s real traffic at the rate
isolates churn. When a gate cannot tolerate its default, change the default or
the gate's failure mode instead of blocking the read.

This governs `LiveConfigReader` itself. The Statsig ruleset helper's
`shouldAwaitFirstSync` (`packages/feature-flags-edge`) is a separate opt-in for
rare, latency-tolerant paths — webhook ingress, queue consumers, user-initiated
settings routes — and must stay out of inference request paths.

*Source: reverting [PR #36993](https://github.com/OpenRouterTeam/openrouter-web/pull/36993).*
