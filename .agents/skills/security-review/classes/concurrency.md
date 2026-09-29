# Concurrency Review

This class applies when a change:

- Reads a balance, count, cap, or "already done" marker and then performs a
  write whose validity depends on that read: refunds, redemptions, credit
  grants, quota consumption, one-shot state transitions.
- Adds or changes code under `packages/db/credits` or
  `packages/db/promo-codes`.
- Adds a `max_*` cap, a `*_count` counter, or a uniqueness expectation that is
  enforced in application code rather than by a constraint.
- Validates a write against a separate row read that can return no row.

## Rule

**The read that checks a limit and the write that consumes it must be one
serialized operation.** A cap verified on a snapshot taken outside the write
transaction is not a cap: N concurrent callers all observe it unspent and all
commit.

## Failure modes to reject

### Check on a snapshot, write in a transaction

The self-serve refund path computed the refundable amount and the daily limit
from reads taken before the write, so concurrent refund requests could each
pass and over-refund (SEC-118, PR
[#31270](https://github.com/OpenRouterTeam/openrouter-web/pull/31270)).
Promo-code redemption evaluated `max_redemptions` against a pre-transaction
read of `redeemed_count`, so concurrent redeemers of one code could all
commit and over-issue credits; the per-user UNIQUE constraint bounded each
account to one grant but placed no bound on the total (SEC-170, PR
[#33077](https://github.com/OpenRouterTeam/openrouter-web/pull/33077)).

The accepted primitive is a transaction-scoped advisory lock taken as the
first statement of the write transaction, followed by an in-lock re-read of
the limit:

```ts
await sql`SELECT pg_advisory_xact_lock(hashtext(${`${PREFIX}${id}`}))`.execute(trx);
```

Evidence: `packages/db/credits/atomic-refund-reservation.ts:55-58` and
`lockAndCheckPromoCodeRedemption` in
`packages/db/promo-codes/queries.ts:204-232`. Copy two details: namespace the
lock key with a constant prefix, because `pg_advisory_xact_lock` keys share
one global int32 space, and keep any pre-transaction check only as a fast
path, never as the enforcement.

When the limit is scoped to a single existing row, `SELECT ... FOR UPDATE`
on that row is an equally accepted primitive: the per-workspace classifier
cap locks the workspace row, then re-counts and inserts in the same
transaction (SEC-95, PR
[#29987](https://github.com/OpenRouterTeam/openrouter-web/pull/29987);
`createClassifierWithinCap` in `packages/db/classifiers/queries.ts`). Prefer the
advisory lock when the limit is global or spans rows that do not share one
lockable parent row.

### Validation conditioned on the read succeeding

A guard written as `target !== undefined && <invalid>` is vacuous whenever the
read misses: the write proceeds unvalidated. A `packages/db` read routed
`primaryPreferred` falls back to a replica and returns ok-empty rows
(`packages/db/replica-routing/index.ts`), while the following UPDATE matches on
the primary, so replica lag alone skips the check (PR
[#36782](https://github.com/OpenRouterTeam/openrouter-web/pull/36782)). Read
and parse failures already surface as `err` before such a guard, so an empty
result is not evidence the row is absent.

The accepted remedy is to fail closed with an `unverifiable-*` error unless the
caller supplied the value the guard needs; the error path writes nothing, so a
retry succeeds once the row is readable. Evidence: `reviewBanCandidateTarget`
in `packages/db/ban-candidates/write-queries.ts` and its cases in
`packages/db/integration/ban-candidates/write-queries.test.ts`. Ask what the
guard does when its input row is absent, and whether anything downstream
re-checks the invariant: when enactment copies the value through and no CHECK
constraint exists, this guard is the only enforcement.

## What the primitives do not give you

An advisory lock serializes only the callers that take the same key. Every
write path that consumes the limit must take the lock; a new call site that
skips it reopens the race. The lock also does not reach writes issued by
another service or a deferred webhook, and the in-lock re-read sees a
competing increment only because the lock is held for the whole transaction,
so the winner's commit lands before the loser's re-read under READ COMMITTED.
Moving the lock out of the transaction, or re-reading before taking it,
silently restores the snapshot check.

## Test requirement

A change in scope ships an integration test that races two concurrent callers
against a limit of one and asserts exactly one success, one refusal, and a
final counter or balance consistent with one grant. Copy
`should enforce the redemption cap across concurrent users` in
`packages/db/integration/promo-codes/promo-code-internals.test.ts`. Report a
missing test as `TEST GAP`, never as a vulnerability finding.

## Calibration

Three incidents as of 2026-08-12 (SEC-118, SEC-170, SEC-95), mostly
money-adjacent, all
found in paths that already had a correctness check whose only defect was
running outside the write transaction. The signal is the gap between the
check and the write, not the absence of a check.
