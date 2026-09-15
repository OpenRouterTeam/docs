---
name: add-reviewed-backfill
description: Add or review a reusable, operator-reviewed data backfill on the generic backfill platform. Use when creating a Postgres or ClickHouse repair task, choosing a shared versus dedicated queue, adding deterministic planning and an idempotent handler, wiring a runbook and monitoring, or auditing an existing reviewed backfill before PR review.
---

# Add a reviewed backfill

Build backfills as tasks on the existing reviewed control plane. Do not add a
bespoke Mission Control route, page, server action, hook, ledger, or consumer.

## Confirm the platform fits

Use this platform only when operator input can produce a finite, deterministic
chunk list without reading mutable external state, every chunk can be retried
idempotently, and one task plus one queue can describe the run.

Stop and design a purpose-built workflow or a lower-layer platform extension
when the operation needs live database gap discovery during Preview, adaptive
or multi-phase planning, cross-task dependencies, secret/configuration
rotation, multiple approval roles, or a write that cannot safely be retried.
Do not force a historical manual runbook onto the platform unchanged. In
particular, an `AggregatingMergeTree` INSERT that double-counts on retry must be
redesigned as delete/verify/insert or otherwise made idempotent first.

## Start with the contract

Add `packages/backfill/tasks/<task-name>/` with:

- `schema.ts`: Zod schemas for operator input and every queued chunk.
- `index.ts`: one `ReviewedBackfillTask` with title, description, date, queue,
  `maxPlannedChunks`, deterministic `plan`, runbook, handler, and monitoring.
- `index.test.ts`: planner, handler, error, idempotency, and contract coverage.
- Additional focused tests beside pure helpers or schemas.

Register the task once in `packages/backfill/tasks/types.ts` and once in
`services/cfw-internal/src/backfill-control/router.ts`. Add it to
`packages/backfill/task-contract.test.ts`.

Keep `plan` synchronous and side-effect free. Return ordered chunks, a safe
input summary, and low-cardinality details. Never include credentials, raw
customer payloads, or response bodies in chunks or summaries. Set a positive
`maxPlannedChunks`; the server rejects empty or oversized plans before lock or
ledger creation.

Reject input that exceeds a task or operator safety cap. Never silently truncate
the requested range to fit a cap: a partial plan can complete successfully while
leaving the operator believing the full range was repaired.

A shorter final boundary chunk is valid when it exactly covers the remainder of
the requested interval. "Do not truncate" means do not omit requested coverage;
it does not require every chunk to have identical width or every interval to be
evenly divisible by the preferred chunk size.

`BackfillTask` still carries the legacy `trigger` callback and an explicit
`isLegacyTriggerAllowed` compatibility marker. New reviewed tasks must omit the
marker; the generic `/trigger` route then rejects them before taking a lock or
enqueueing. Also make `trigger` return a rejected Result directing internal
callers to Preview → Review → Start as defense in depth. The legacy route does
not create durable reviewed history or invoke `validation.start`. The inert
example is the only onboarding compatibility exception, not the production
template.

## Choose the queue declaratively

Use `{ kind: 'shared' }` for ordinary tasks. Shared tasks reuse
`backfill-tasks`, its consumer, lifecycle accounting, cancellation, DLQ, and
bounded recovery records.

Use `{ kind: 'dedicated', name: '<queue-name>' }` only when throughput,
retention, payload sensitivity, or failure isolation requires it. Document the
reason. Add the producer binding and primary/DLQ consumers in
`services/cfw-internal/wrangler.toml`, then add one entry to
`BACKFILL_QUEUE_REGISTRY` in
`services/cfw-internal/src/backfill-control/queue-routing.ts`. Do not add a
dispatch conditional or separate router. The parameterized wrangler test must
cover the new entry automatically.

Also add the binding to `CfwInternalBindings` in
`services/cfw-internal/src/env.ts`, the `BackfillQueueConfig.binding` union, and
`BackfillQueueBindings`. A registry entry and Wrangler stanza without these
type-level bindings is incomplete.

## Separate Preview from Start

Use the trigger schema and planner for Preview-safe validation. Put readiness
that depends on activation time, audited production input, or mutable
operational state in `validation.start`. Add `validation.preview` only for a
check that is genuinely safe and necessary during Preview. Preview must never
enqueue, take a lock, create a run, or invoke Start readiness.

Use `preflight` for operator checklist items. Use `fieldGroups` only to improve
presentation of existing trigger fields. Generic runtime and Mission Control
must consume these values without checking `task.type`.

## Make execution recoverable

Implement the handler as a small idempotent function returning a Result. Thread
request/chunk data through parameters; do not retain it on long-lived objects.
For delete-first repairs, verify deletion before insert and verify the insert
before success. Use stable upstream query/idempotency keys where retries can
overlap. Preserve cancellation tombstones, durable chunk settlement, terminal
lock release, compensation on enqueue failure, and DLQ replay coordinates.

Tests must prove retry behavior, not merely call the handler once. Run the same
chunk twice against a real integration boundary or a pure idempotency seam and
assert the target state is unchanged after the second call. If that proof is
not possible, the task is not ready for this queue runtime.

Never start a production backfill while developing or reviewing it. Use the
inert example for Start/Cancel and production tasks for Preview-only evidence.

## Add the operator runbook and monitoring

Provide at least one reviewed preset with label, description, and input. Mark
audited production presets `locked: true`; the server treats locked input as
authoritative even when the browser submits edits.

Emit a low-cardinality adoption/outcome signal and task-specific structured
completion and failure logs. Generic queue metrics do not replace the
task-specific evidence an operator needs. Document:

- expected population and maximum chunks;
- idempotency and retry behavior;
- cancellation and compensation behavior;
- DLQ lookup/replay procedure and retention;
- residual invariant or completion/failure monitor;
- exact Preview-only production verification steps.

For row-rewriting repairs, document the exact reversal record and procedure.
For invariant repairs, add a residual-state check that fails closed when the
measurement itself fails. Neither capability is supplied automatically by the
task contract.

Add or update Terraform monitoring when a failure signal requires an alert.
Use the `add-datadog-monitor` skill for monitor mechanics.

## Slice the PRs by ownership

Follow the `stacked-prs` skill and keep one owner per file:

1. Land reusable contract changes first only when the platform contract is
   genuinely missing something required by more than one task.
2. Land the task schema, planner, handler, runbook, and task tests together.
3. Add runtime/config changes only for a justified dedicated queue.
4. Land task-specific monitoring independently when it has a different owner.

Do not add scaffolding from one production example. The inert example is the
minimal shared-queue reference; `backfill-endpoint-perf-v5` is the isolated
ClickHouse/dedicated-queue reference. Wait for a second real implementation
before designing an automatic code generator.

## Verify before review

Run:

```bash
bun test packages/backfill/task-contract.test.ts
bun test services/cfw-internal/src/backfill-control/wrangler-queue-pinning.test.ts
bun scripts/ci/lint-skills.ts
```

Review the diff for enum/router registration, colocated handler tests, an
explicit monitoring signal, and complete dedicated-queue bindings. Keep
screenshots and visual walkthroughs in PR descriptions only. Ask a review
agent to check platform fit, idempotency, redaction, rollback correctness,
monitoring quality, and whether mutable readiness belongs in
`validation.start`; the contract tests cannot prove those properties.

Then run scoped task/runtime tests. If the repository baseline is broken, record the unrelated errors and still prove every changed package independently.
