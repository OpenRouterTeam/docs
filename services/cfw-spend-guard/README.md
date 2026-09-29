# cfw-spend-guard

Per-entity admission control against burst overspend. Prepaid accounts could
generate far more aggregate spend than their balance because many concurrent
requests were admitted against the same stale balance before billing settled.
This worker holds an authoritative per-entity ledger of in-flight estimated
spend in a Durable Object, so admission decisions see every open request, not
just the stale balance.

RFC: [Burst Overspend DO](https://app.notion.com/p/openrouter/DRAFT-RFC-Burst-Overspend-DO-3c02fd57c4dc8067878efa8f8cb90f84)

## Invariant

A reserve call is admitted only while

```text
sum(open reservations) + recorded unsettled actual spend
  <= min(max(effectiveBalance, 0) / budgetDivisor, budgetCeilingDollars)
```

`recorded unsettled` is the actual cost of released generations that the
authoritative balance has not settled yet; it ages out after a fixed
settlement window.

## Topology

- One `SpendGuard` Durable Object per billable entity, addressed by
  `idFromName(entityId)`.
- The worker exposes no public routes. Consumers reach it only through the
  typed service binding (`SVC_SPEND_GUARD`), which exposes `reserve`,
  `warm`, `release`, and `heartbeat`.
- The DO performs no database reads or writes. All state is DO-local SQLite;
  an alarm expires leaked reservations (`maxReservationMs`) and ages out
  unsettled spend (`settlementWindowMs`).

## Caller contract

The router is the only intended caller. Every guard failure on the caller
side fails open: the request proceeds unguarded and the failure is counted.

```mermaid
sequenceDiagram
    participant R as Router (cfw-api)
    participant SB as Service binding
    participant DO as SpendGuard DO (per entity)

    Note over R: request admitted by auth + rate limits,<br/>dollar weight estimated from endpoint pricing
    R->>SB: reserve({entityId, cfRayId}, {generationId, weightDollars, effectiveBalance}, limits)
    SB->>DO: reserve(input, limits, tracking)
    DO-->>SB: allowed | denied | already_released | invalid_input
    SB-->>R: decision

    alt denied (in_flight_budget_exhausted)
        R->>R: 402 in enforce mode, proceed + log in shadow mode
    else allowed
        Note over R,DO: retry/fallback on the same generation id calls<br/>reserve again; the DO re-runs admission with the<br/>new weight and reprices the existing hold
        loop while generation runs (long generations)
            R->>DO: heartbeat(entityId, generationId, cfRayId)
            DO-->>R: true (TTL refreshed) | false (hold gone, stop)
        end
        Note over R: terminal outcome: retries, fallbacks and plugin<br/>billing done, usage record built, Pub/Sub submitted
        R->>DO: release(entityId, generationId, actualCostDollars, cfRayId)
        Note over DO: hold deleted; positive actual cost is retained as<br/>unsettled until the settlement window ages it out.<br/>Repeat release is a no-op (release marker)
    end

    Note over DO: alarm (1/min while state remains):<br/>expire holds older than maxReservationMs,<br/>age out unsettled rows past settlementWindowMs
```

## Transactional rollups and bounded maintenance

SQLite triggers keep a per-table dollar total, row count, accounting cutoff, and rounding-error bound in `spend_guard_totals`. They execute in the same transaction as reserve, reprice, release, heartbeat, and alarm writes. Existing ledgers bootstrap these two rows once; subsequent cold starts reuse them. No process-local cache owns accounting state.

Admission uses a total only when an indexed existence check proves that no retained row lies between its accounting cutoff and the requested cutoff. Otherwise it uses the original timestamp-filtered sums/counts without advancing accounting or deleting rows on reserve. Near the admission boundary it also recomputes exact SQL sums when the accumulated floating-point error bound could affect the decision. Longer windows and clock reversal therefore remain correct without rebuilding the totals synchronously.

Heartbeats advance accounting over at most 128 rows per table and retain the original rows for diagnostics, idempotency, and later window changes. Timestamp ties are never split: an oversized equal-timestamp group stays on exact-read fallback until physical alarm cleanup makes progress. A heartbeat is opportunistic, not a prerequisite for admission correctness.

Each alarm deletes at most 1,024 expired rows from each of reservations, unsettled spend, and release markers, then performs bounded accounting maintenance. Remaining expired rows cause the next alarm to be scheduled in one second rather than one minute. All work still shares the object's execution thread; batching bounds an individual sweep, not its total cleanup cost.

Exact-read fallback deliberately gives up the rollup speedup while accounting is stale, so a fast warm-object microbenchmark is not a steady-state or production-RPS claim.

## Distributed tracing

The inference Worker's SpendGuard binding captures the active `traceparent` separately for each RPC, and only when the request was already selected for Datadog or trusted benchmark tracing. HIPAA callers strip this context. The optional field is backward-compatible with older callers and is never persisted in the ledger or alarm context.

Sampled requests form `or.spend_guard.rpc reserve` (caller) → `spend_guard.rpc.reserve` (service entrypoint) → `spend_guard.do.reserve` (Durable Object). Warm, release, and heartbeat use the same pattern. The receiver uses the shared `traceDurableObjectCall` helper and the `CF_VERSION_METADATA` binding; missing, malformed, or unsampled parents do not start independent traces. The receiver marks those forwarded traces for Datadog without independently sampling every RPC.

Child spans cover initialization (`spend_guard.initialize`), ledger transactions (`spend_guard.ledger.*`), and storage reads and writes (`spend_guard.storage.*`). Warm and reserve DO spans carry `or.spend_guard.first_touch`. Deferred alarm/context writes remain unawaited by reserve: their tracing context stays open until the background promises settle, without changing Durable Object lifetime guarantees or admission durability.

The DO span measures its handler, not time spent waiting for activation, delivery, or output-gate confirmation. Those costs remain in the enclosing RPC span; child spans can outlive the handler when background work continues. Standalone alarms do not create independent sampled traces. Trace attributes contain phase/first-touch metadata, not the tracking object, entity IDs, or request bodies.

The shared tracing runtime adds a fixed bundle and startup cost that parent-selected sampling does not remove.

## Initialization sequence

Admission is synchronous. Every step that needs a storage round trip — arming
the expiration alarm, persisting the sweep's copy of the limits — is issued
inside the RPC but never awaited by it, so the input gate reopens on the
ledger transaction rather than on storage latency. One reserve against a
fresh instance:

```mermaid
sequenceDiagram
    participant R as Router (cfw-api)
    participant DO as SpendGuard DO
    participant ST as DO storage

    Note over DO: input gate closed for the whole RPC
    R->>DO: reserve(input, limits, tracking)
    DO->>ST: new SpendGuardLedger(storage.sql): schema DDL,<br/>synchronous, first touch only
    DO->>ST: getAlarm(): issued, not awaited
    DO->>ST: transactionSync(ledger.reserve): commits synchronously
    DO->>ST: put(context): issued, not awaited
    DO-->>R: decision. The output gate holds this response<br/>until the context put is durable
    Note over DO,ST: input gate reopens. On first touch a follower can<br/>still queue behind the in-flight getAlarm
    ST-->>DO: getAlarm() resolves
    DO->>ST: setAlarm(now + 60s). The due timestamp is trusted<br/>for ALARM_REVALIDATION_GRACE_MS (five alarm intervals)
    Note over DO,ST: after the grace, the next deferred arm reads<br/>getAlarm() once. A valid future alarm is adopted;<br/>a previously armed missing or overdue one is re-armed and reported<br/>initial arms on objects with no persisted state are not repairs
    Note over DO,ST: a failed arm is reported and retried once as a bare<br/>setAlarm. If that also fails, the next RPC arms again
```

Across requests and alarms:

```mermaid
stateDiagram-v2
    [*] --> Cold: no instance in memory
    Cold --> Warm: first touch, schema DDL, ledger cached, arm dispatched
    Warm --> Armed: arm lands
    Armed --> Armed: reserve, release, heartbeat. due timestamp trusted for five intervals; after grace, next deferred arm revalidates and adopts a future alarm or re-arms and reports a previously armed missing/overdue alarm; initial arms on objects with no persisted state are not repairs
    Armed --> Sweeping: alarm fires, once a minute
    Cold --> Sweeping: an armed alarm fires and re-materializes the object
    Sweeping --> Armed: open holds, unsettled spend or release markers remain, so re-arm
    Sweeping --> Drained: nothing left. deleteAll drops the tables, the context and the alarm
    Drained --> Warm: next RPC rebuilds the schema lazily
    Drained --> Cold: eviction
    Warm --> Cold: eviction before the arm lands, so the next RPC arms again
```

Live configuration — every knob, defaults, how the stages compose, and the
rollout order — is documented in [`CONFIG.md`](./CONFIG.md).

The rules callers must follow (generation-id uniqueness, terminal release,
timeout compensation, heartbeat cadence) and the layout conventions live in
[`AGENTS.md`](./AGENTS.md).
