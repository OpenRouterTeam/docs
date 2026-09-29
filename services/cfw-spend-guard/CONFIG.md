# SpendGuard configuration guide

Every knob lives in one live-config object, `spend-guard` (schema:
`packages/type-utils/spend-guard-config.ts`). The runtime schema reads each
malformed field as its default instead of rejecting the object; the strict
write schema (`SpendGuardConfigWriteSchema`) is what Mission Control
validates against. Reads never block on KV: a cold isolate serves the
defaults below and refreshes in the background.

This guide explains how the knobs compose. For the ledger invariant, DO
topology and caller contract, see [`README.md`](./README.md).

## The pipeline

A request passes through these stages in order. Each stage either exempts
the request (it proceeds unguarded), rejects it, or hands it to the next:

```text
mode / enforce_pct        is the guard on, and is this entity in the enforce arm?
  → gate                  is this account small and new enough to guard at all?
  → exemptions            free models, BYOK, credit pools, spend history
  → cheap-request skip    below min_guarded_weight_dollars: not worth a DO hop
  → entity limiter        edge rate limit so one entity can't queue its own DO
  → reserve RPC           serialized admission against the entity's ledger
  → retry w/ backoff      transport failures retried with full jitter
  → fail-open / -closed   exhausted transport failures: proceed or 429
```

### Master switches

| Key | Default | Meaning |
| --- | --- | --- |
| `mode` | `off` | Kill switch. `off`: nothing runs. `shadow`: full pipeline, decisions logged, nothing rejected. `enforce`: rejections live for the enforce arm. |
| `enforce_pct` | `0` | Percentage of entities (by stable hash) in the enforce arm while `mode` is `enforce`. Everyone else behaves as shadow. |

### Gate (who is guarded at all)

The guard targets small, new, prepaid accounts — the population that can
burst past its balance before billing settles. Everyone else is exempt.

| Key | Default | Meaning |
| --- | --- | --- |
| `gate_ceiling_dollars` | `0` | Entities with an effective balance at or above this are exempt. `<= 0` disarms the guard (`ceiling_unset`). |
| `budget_divisor` | `2` | Reservation budget = `max(balance, 0) / divisor`, i.e. how much of the balance may be in flight at once. |
| `budget_ceiling_dollars` | `0` | Hard cap on that budget. `<= 0` disarms the guard. |
| `max_account_age_days` | `7` | Accounts older than this are exempt. |
| `exempt_usage_daily_dollars` | `null` | Spend-history exemption: recent daily usage above this is exempt. `null` disables. |
| `exempt_usage_weekly_dollars` | `null` | As above, weekly. |
| `exempt_usage_monthly_dollars` | `null` | As above, monthly. |
| `exempt_lifetime_credits_dollars` | `null` | Lifetime credit purchases above this are exempt. `null` disables. |

Free models, all-BYOK requests without paid plugins, and credit-pool-funded
requests are structurally exempt regardless of configuration.

### Estimate and cheap-request skip

| Key | Default | Meaning |
| --- | --- | --- |
| `output_token_cap` | `8000` | Cap on the completion-token component of the weight estimate, so an absent `max_tokens` doesn't price every request at the model maximum. |
| `min_guarded_weight_dollars` | `0.001` | Estimates below this skip the limiter and the DO entirely: the bulk of traffic is too cheap to justify a serialized hop. `0` guards every priced request. |

The weight estimate is arithmetic on prompt tokens, the output cap and
endpoint pricing — no RPC. An unpriceable request fails open
(`unpriced_estimate`).

### Entity limiter

An edge rate limit in front of the DO so a single hot entity cannot queue
its own serialized object past the reserve timeout (which would disarm its
own guard). Configured in worker bindings, not live config. Shadow-arm
entities are shed from the DO but never rejected.

### Reserve, retries and backoff

| Key | Default | Meaning |
| --- | --- | --- |
| `reserve_timeout_ms` | `250` | Deadline per reserve RPC. A late `allowed` is still adopted as the hold if the request has no open reservation yet. |
| `reserve_retry_max_attempts` | `0` | Extra reserve dispatches after a transport failure (timeout or RPC error). `0` preserves the historical single-attempt behavior. Timeouts and RPC errors share this one budget. |
| `reserve_retry_base_delay_ms` | `200` | Full-jitter backoff: each retry sleeps `random(0, min(max_delay, base × 2^retry))`. Must not exceed the max delay. |
| `reserve_retry_max_delay_ms` | `1000` | Cap on any single backoff sleep. |
| `reserve_retry_budget_ms` | `1500` | Wall-clock ceiling on all retry work of one request. Backoff sleeps and retry RPCs draw it down, each clipped to what remains. |

The DO serializes per entity, so a transport failure usually means the
entity's queue ran past the deadline — overload is its own signal to back
off. Retries re-dispatch with the same `generationId`, which the ledger
treats as a repricing of the same hold, never a double-booking, so a retry
can only tighten the admission decision. Definitive outcomes (`allowed`,
`denied`, `invalid_input`, `already_released`) are never retried. No
heartbeat runs during backoff.

Both retry budgets are per request, not per endpoint. A request that falls
through k endpoints re-asks the object at most `k + reserve_retry_max_attempts`
times, and the retry latency it can accumulate is `reserve_retry_budget_ms`
in total rather than once per endpoint. Each endpoint's first dispatch is
not retry work and keeps the full `reserve_timeout_ms`, so the worst-case
admission latency of a k-endpoint request is
`k × reserve_timeout_ms + reserve_retry_budget_ms`.

### Fail-open vs fail-closed

When every dispatch in the retry budget fails in transport, the historical
behavior is to fail open: proceed unguarded, count it, log it. That is still
the default. Fail-closed narrows it for the requests that can actually hurt:

| Key | Default | Meaning |
| --- | --- | --- |
| `fail_closed_mode` | `off` | `off`: always fail open. `shadow`: log the would-be rejection (`spend_guard_shadow_fail_closed`), still fail open. `enforce`: reject with a retryable 429. |
| `fail_closed_weight_dollars` | `0.25` | Ceiling of the fail-closed threshold. |
| `fail_closed_balance_fraction` | `0.005` | Scales the threshold down with the entity's effective balance. |

The threshold an exhausted request is judged against:

```text
threshold = min(fail_closed_weight_dollars,
                fail_closed_balance_fraction × max(effective_balance, 0))
```

Estimated weight at or above the threshold fails closed; below it fails
open. The fraction exists because the per-request threshold is also the
per-request leak bound: a burst of N parallel fail-opens can lose up to
N × threshold. Scaling by balance keeps that bound proportional to what the
account can cover — at $5 of balance the default threshold is $0.025, so a
500-wide burst leaks at most ~$12.50 instead of the account's ceiling.

At `effective_balance <= 0` the threshold is exactly `0`. Effective balance
is unclamped (`credits + free allowance - usage`), so it is negative for
exactly the already-overspent accounts this feature targets. Every request
that reaches fail-closed evaluation has a positive estimated weight above
`min_guarded_weight_dollars` (cheaper ones skip the guard entirely), so at a
zero threshold every one of them fails closed once its retries are
exhausted. To predict a customer's threshold, read it as "everything above
`min_guarded_weight_dollars`", not "nearly anything".

`fail_closed_mode` is subordinate to the master switches: rejections require
both `mode: enforce` (with the entity in the enforce arm) and
`fail_closed_mode: enforce`. Any shadow layer downgrades the rejection to a
logged would-be rejection. The 429 carries `Retry-After` and is retryable —
balance was never evaluated, nothing was booked.

A fail-closed rejection ends the request: the verdict is about the entity's
admission state rather than the endpoint's health, and the request's retry
budget is spent, so the router aborts instead of falling through to the next
endpoint.

### DO-side limits

Forwarded to the Durable Object with each reserve; the sweep persists them.

| Key | Default | Meaning |
| --- | --- | --- |
| `settlement_window_ms` | `120000` | How long released actual spend stays counted against the budget while billing settles. |
| `max_reservation_ms` | `120000` | Holds older than this are expired by the alarm (leak protection). Heartbeats refresh the clock for long generations. |
| `heartbeat_interval_ms` | `30000` | Router-side heartbeat cadence; keep well under `max_reservation_ms`. |

## Worked example: the $5 account

A fresh account with $5 of credits, guard fully armed
(`mode: enforce`, `enforce_pct: 100`, `gate_ceiling_dollars` above $5,
`budget_ceiling_dollars` set, `fail_closed_mode: enforce`, retries at 2):

- Reservation budget: `min($5 / 2, budget_ceiling)` = $2.50 of estimated
  spend in flight at once.
- A $0.001 request skips the guard (cheap skip).
- A $0.07 request reserves; the DO admits it while open holds + unsettled
  spend stay under $2.50.
- If the reserve times out, two jittered retries follow. If all three
  dispatches fail in transport: threshold = `min($0.25, 0.005 × $5)` =
  $0.025, so the $0.07 request is rejected with a 429 rather than run
  unguarded — while a $0.01 request still fails open.

## Rollout order

1. `mode: shadow` — pipeline runs, nothing rejected, decisions measurable.
2. `mode: enforce` + `enforce_pct` ramp — denials live for the enforce arm.
3. `reserve_retry_max_attempts: 2` — transport failures resolve to real
   decisions instead of fail-opens; watch `spend_guard.fail_open` drop.
4. `fail_closed_mode: shadow` — count would-be rejections
   (`spend_guard_shadow_fail_closed`) at the configured threshold.
5. `fail_closed_mode: enforce` — the 429 goes live.
