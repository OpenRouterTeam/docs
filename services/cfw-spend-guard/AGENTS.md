# cfw-spend-guard agent guidelines

See `README.md` for the architecture, invariant, and sequence diagram.

## Caller contract

The router is the only intended caller. Every guard failure on the caller
side fails open: the request proceeds unguarded and the failure is counted.

- `entityId` is the authenticated billing entity. The DO trusts it blindly;
  isolation between tenants is the caller's responsibility.
- `traceparent` is optional, trusted caller-owned tracing metadata. Forward only an already sampled active Datadog/benchmark trace, never a raw client header. Keep it out of persisted state and leave HIPAA calls untraced.
- `generationId` is unique per generation and never reused. Idempotent
  release and reserve-after-release detection rely on this.
- Call `reserve` before each upstream attempt, including retries and
  endpoint fallbacks with a different cost estimate. A repeat reserve for
  the same generation id never double-books.
- Call `release` exactly once, at the terminal outcome, with the actual
  cost. A reserve that timed out on the caller side may still resolve to
  `allowed` while the request is running; adopt that late reservation and
  settle it at the terminal actual cost, or release it at the request's
  actual billed cost when adoption is no longer possible (zero only when
  the settlement billed nothing).
- Heartbeat open reservations on an interval shorter than
  `maxReservationMs`; stop when `heartbeat` returns `false`.
- `warm` is fire-and-forget, typically dispatched through `waitUntil`. It
  is sent for every request ahead of reserve, books nothing, and does not key
  anything on the generation id; callers do not await it. An unmatched warm
  costs one alarm invocation plus an empty-ledger `deleteAll` sweep, which is
  accepted and harmless because it creates no reservations and books nothing.

## Layout conventions

- `src/index.ts` — worker entrypoint; exports the `SpendGuard` DO class and
  serves no public routes. Do not add public routes.
- `src/durable-objects/spend-guard.ts` — DO wrapper: transaction boundaries,
  limits persistence, alarm scheduling, telemetry.
- `src/durable-objects/spend-guard-ledger.ts` — pure SQLite state machine.
  Keep it free of Cloudflare imports so it stays unit-testable under
  bun:test.
- Shared request/decision types live in
  `packages/cloudflare/spend-guard-types.ts`; define them once there and
  import them.
- Run DO wrapper tests from this directory (`bun test src/durable-objects/`),
  not the repo root, so `cloudflare:workers` resolves.
