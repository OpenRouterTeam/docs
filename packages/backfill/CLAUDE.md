# Generic backfill control plane

Add a future generic task under `tasks/<task-name>/` with a schema module and
an exported `BackfillTask`. The task data schema validates every queue payload.
The trigger schema validates operator input. Implement `plan` as a side-effect-free
operation returning ordered chunks, a safe input summary, and count details;
the legacy `trigger` callback and `isLegacyTriggerAllowed` marker may remain
only for existing compatibility tasks. New reviewed tasks omit the marker so
the generic trigger route rejects them, and should also make `trigger` reject
and direct internal callers to Preview → Review → Start. The legacy route does
not create durable reviewed history or invoke `validation.start`. The handler
should be idempotent, small, and return a Result. Use `iLog`, `wLog`, or
`eLog`, never `console.log`.

Reject ranges that exceed a safety cap. Never silently truncate a requested
range to fit `maxPlannedChunks` or an operator-provided cap; a successful
partial repair is more dangerous than an explicit rejection. A shorter final
boundary chunk is correct when it covers the complete remaining interval.

Operator metadata is optional on `BackfillTask` for compatibility with existing
purpose-built tasks. Generic control-plane tasks should provide `title`,
`description`, `date`, and `allowedEmails` when an operator guardrail or audit
attribution is useful,
`triggerSchema`, and at least one runbook preset with `label`, `description`,
`input`, and optional `locked`. `allowedEmails` is optional: when omitted, any
authenticated `@openrouter.ai` operator may run the task; when present, the
operator email must match one of the listed addresses. This is an operator
guardrail and audit attribution for the Mission Control path, not an
authorization boundary. The real boundary is the admin key plus Mission
Control's own admin gate. Use it for sensitive or tightly scoped operational
tasks.

Register generic tasks only in the shared registry module under
`services/cfw-internal/src/backfill-control/`. Both HTTP routes and the queue
consumer must import that registry so they agree on the task set. Reuse the
shared `backfill-tasks` queue for ordinary tasks. Declare a dedicated queue
only when isolation, throughput, or retention requirements justify it, and
document the reason in the worker configuration.

The trigger route takes one per-task run lock before enqueueing. Generic enqueue
delays first delivery by 120 seconds so the lock can propagate globally.
Consumers renew
the lock after each settled chunk. Cancellation writes a short-lived
cancellation tombstone and clears the lock. A task must never bypass these
semantics. A per-job cancellation tombstone or foreign lock discards queued
work. An absent lock discards queued work. The queue never infers that a run is
still active from a lock it failed to see, because first delivery is delayed
long enough to remove propagation ambiguity. Cancellation tombstones remain
the authoritative stop signal. A present lock continues to permit work even
when delivery is delayed. If either cancellation tombstone read fails, the
chunk is retried without running because cancellation state is unknown.
Only clean reads of both tombstone forms permit the consumer to check the
lock. All other lock states keep the work retryable.
The queue also honors the task-wide tombstone form for the existing
`endpoint-perf-v5` cancellation contract. That form stores the cancelled job
id as its value, while new generic tasks must use per-job tombstones.
The per-job tombstone expires with the 12-hour lock TTL; a serialized backlog
could theoretically outlive that bound and resume, so real tasks also persist
durable cancelled state. The abort helper intentionally writes a per-job
tombstone and must only be used when abandoning a run after trigger failure.
Real tasks use durable lifecycle callbacks keyed by stable chunk ids; terminal
completion or dead-letter accounting releases only the lock owned by that job.

When a runbook label is supplied, the worker validates and records the label.
For a locked preset, the worker uses the preset input authoritatively. For an
unlocked preset, the preset input is only a starting point and the worker uses
the submitted `trigger_input`. The server enforces this distinction even when
the browser is bypassed.

Add colocated `bun:test` coverage for registry listing, trigger field
derivation, trigger validation, handler success and failure paths, and route
authorization. Do not add mock-based database tests.

The existing purpose-built backfills stay where they are except when explicitly
registered with equivalent queue semantics. `backfill-endpoint-perf-v5` is exposed
through the control plane while retaining its dedicated queue; attestation, startup organization
backfill, and model-example/batches media assets are not migrated or registered
in this generic control plane.

Dead-letter chunk payloads persist for 30 days in the shared
`KV_MODELS_AND_ENDPOINTS` namespace, which is also used by cache data. Keep
chunk payloads limited to identifiers and ranges; never include PII or secrets.
If a task needs sensitive chunk fields, provision a dedicated KV namespace
before registering it. `operator_email` is self-declared: the shared
`ADMIN_API_KEY` is the authentication boundary, while the domain and
`allowedEmails` checks provide operator guardrails and audit attribution, not
authorization.
