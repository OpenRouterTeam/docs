# Guardrail policy migration operator runbook

## Scope and release gates

This reviewed dedicated-queue task implements B5 migration and residual reconciliation. Legacy guardrails remain enforcement and recovery authority. The task does not enable policy editing, change feature access, remove legacy rows, or authorize a production launch. Never execute production migration during development or review.

The three retained source populations are `guardrails`, `api_keys_guardrails`, and `organization_members_guardrails`. Every plan covers all three within explicit inclusive UUID bounds, with a fixed creation-time watermark. UUID ranges include v4, deterministic v5, nil, and maximum boundaries. Updates after the watermark are deliberately re-read and converted from their latest committed values.

Production population is unknown until measured. Each run permits 1–4096 partitions per source, at most 12,288 chunks. Each chunk performs a cap+1 enumeration and rejects more than 50 sources before any write. Inventory is evidence, not enforcement: the handler always repeats the cap check. Each source executes in its own owner-locked transaction; one source cannot enqueue successors or scan an unbounded assignment collection.

Reconciliation is read-only with respect to application data, but takes the same owner, workspace, subject, and source row locks as migration. It therefore requires the uncached primary connection with read-write transactions and the deployed runtime role's SELECT plus row-lock UPDATE privileges. A SQL read-only transaction or replica cannot serve it. Local nonowner-role and connection-routing tests establish this permission envelope; verify the live primary/no-cache binding and inherited grants before rollout.

## Inventory and reviewed input

1. Deploy the B3 schema, grants, and constraints and the B4 dual-write fleet before choosing a watermark, so post-watermark rows are covered by dual writes rather than this backfill.
1. Create a JSON trigger input with `operation`, `watermark`, `id_from`, `id_to`, and `partition_count`. Use nil through maximum for full coverage, or document how several adjacent runs cover that complete interval. Partitions split the requested range evenly; when identifiers cluster tightly enough that an even split would exceed the 50-row chunk cap, cover the clustered interval with narrower adjacent runs rather than one over-wide partition. Do not omit empty UUID intervals from the coverage record.
1. Run the read-only inventory with the intended database environment selected through the repository script runner. The script uses the configured primary connection, or local Postgres when none is configured. Verify environment selection before collecting production evidence.

```bash
bun run x scripts/guardrail-policy-migration-inventory.ts input.json inventory.json
```

The report contains every chunk's source, bounds, watermark and population, observation start/end times, total sources, and maximum chunk population. It writes a new file exclusively and refuses to overwrite existing evidence. Counts use sequential primary reads; they are not an atomic fleet snapshot. A failed measurement yields no report. An over-cap report is retained with a failing exit code; review finer complete ranges and inventory again. A run that would exceed 4096 partitions must be split into separately reviewed adjacent runs, never silently truncated.

Running the inventory before Start is a convenience for sizing partitions, not a gate. Start validation requires only a `watermark` that is not in the future; there are no deployment or inventory evidence fields. The runtime safety net is the 50-row-per-chunk cap the handler re-checks before every write, so an over-populated chunk fails closed regardless of what inventory reported. When the inventory or a failed chunk shows identifiers clustered tightly enough to exceed that cap, cover the interval with narrower adjacent runs.

The bundled unlocked preset is a Preview template with the full nil-through-maximum range. Adjust its range, watermark, and partition count for the run you intend rather than pressing Start on the template values.

## Preview, execution, and retry

Use Mission Control Backfills → **Guardrail policies: migrate and reconcile** → Preview → Review → Start. Preview validates and deterministically plans without modifying migration data, queueing, run creation, or Start-readiness checks. The task planner performs no database reads. The legacy trigger rejects this task.

Migration acquires the same live-owner lock as B4, re-reads retained sources, resolves actual owned workspaces, synchronizes the mapping triple and still-source-owned selections, and reconciles before commit. Assignment registrations and completed mapping triples are durable initialization markers. Retry preserves customer policy names, independent choices, opt-outs, and types removed to return to inheritance. A key's stale source-owned choices may relocate only without conflicting destination choices. A key or member assignment whose workspace is soft-deleted is skipped as orphaned, logged per source, and counted in `orphaned_rows` on the completion log. Missing member workspace ids and conflicts fail closed.

Each source commits independently. If a later source fails, earlier sources in the same chunk can remain committed. Re-running the same chunk is required to prove safe recovery; identities and already-completed state remain stable. Source deletion observed after enumeration produces no new policies. Unsupported stored configurations, incomplete mapping triples, or reconciliation failures roll back that source's transaction and leave the chunk retryable.

Cancellation uses the shared durable lifecycle and tombstones. It stops future deliveries; an already-running chunk may finish up to its bounded 50 sources. Cancellation does not reverse committed sources. Terminal completion, failure, and enqueue compensation retain the generic lock ownership and durable accounting semantics. Do not clear tombstones or manually send queue messages to bypass a cancelled run.

## Failure, dead-letter recovery, and reversal

Search task logs for `guardrail_policy_backfill_source_failed` and the generic job/chunk lifecycle records. `guardrail_policy_backfill_chunk_complete` records source kind, operation, inclusive range, watermark, processed/deleted counts, source-owned choices, independent choices, and absent choices. The task metric `openrouter.backfill.guardrail_policy_sources.reconciled` has only source/operation tags; it is an attempt/outcome signal, not a unique-source migration total because retries can repeat it. Metrics must never determine correctness.

The task runs on its own queue, `backfill-guardrail-policies` (consumer concurrency 10), so slower tasks on the shared `backfill-tasks` queue cannot starve it of consumer slots; its DLQ is `backfill-guardrail-policies-dead-letter`. Failed payloads persist for 30 days in `KV_MODELS_AND_ENDPOINTS` under `backfill:dead-letter:backfill-guardrail-policies-dead-letter:<message_id>`. Find the exact key in `backfill-dead-letter-payload-persisted`, retain the original run/chunk coordinates, and inspect only the identifier/range payload. After correcting the root cause, create a new reviewed run covering the failed source ranges, repeat inventory/readiness as needed, and then reconcile the complete requested coverage. Do not replay a cancelled job ID. Recover before the 30-day record expires; the retained operator manifest remains necessary when a DLQ record is no longer available.

This is an invariant repair rather than a destructive row rewrite. The exact legacy IDs, names, descriptions, settings, assignment IDs, actors, and timestamps remain the reversal record in the legacy tables; runtime analytics/usage counters are not rewritten. Recovery is to keep legacy enforcement active, cancel further migration, correct the implementation, and rerun reconciliation/migration. Do not delete shared typed policies or registrations as a rollback: several sources may deduplicate to one policy, and registrations protect intentionally cleared choices from resurrection. Removing independently edited typed state requires a separate reviewed recovery procedure with explicit affected identities and preserved customer edits.

## Completion and residual checks

Queue completion proves execution only. Set `operation` to `reconcile` and review the identical full range union and watermark. Reconciliation reads the primary under the owner lock and writes neither store. It fails for missing mappings or assignment registrations, different normalized typed configurations (including budget limit, reset interval, and BYOK behavior), malformed selected policies, wrong owner/type, invalid opt-out provenance, stale workspace/subject identities, or mismatched source-owned selections. A query or validation failure is a failed residual check, never a clean report.

Retain the Preview plan, inventory, durable run outcomes, and every completed reconciliation chunk's range/watermark/counts. A subrange result must be labeled with that exact interval. Before declaring fleet migration complete, prove that the union covers nil through maximum UUID for all three sources at the same watermark, every planned reconciliation chunk completed successfully, and no failed, cancelled, missing, or dead-letter chunks remain. Newer sources are covered by the separately proven B4 dual-write deployment. Sources that disappeared after the watermark must be explained by retained deletion counts and inventory differences. Reconciliation never substitutes inherited or independent selections for missing provenance.

## Preview-only production verification

With production task development/review, collect read-only inventory only when authorized, open the actual task, submit the range to Preview, and retain the exact plan and warnings. Do not press Start for this production task during implementation or review. The inert shared-queue example is the only appropriate task for exercising Start/Cancel UI behavior without production writes.
