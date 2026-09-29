# Legacy guardrail synchronization operations

B4 makes legacy management and typed-policy persistence one transaction. This document is the writer inventory and fleet handoff for B5. Local verification does not establish deployment readiness: no production deployment, traffic verification, migration watermark, or reconciliation is asserted here.

## Direct writer inventory

The ten legacy persistence primitives below have 16 production caller sites. Their standalone `packages/db` wrappers remain available for fixtures. Production enters the synchronization boundary, while its transaction-taking primitives remain in `packages/db` to avoid a DB-to-guardrails dependency.

| Operation | Production boundary | Caller sites |
| --- | --- | --- |
| Create | `management.createLegacyGuardrail` | Shared `use-cases/create-guardrail` |
| Update | `management.updateLegacyGuardrail` | Shared `use-cases/update-guardrail` |
| Delete | `management.deleteLegacyGuardrail` | Shared `use-cases/delete-guardrail` |
| Workspace-default upsert | `management.upsertLegacyWorkspaceDefaultGuardrail` | Shared `use-cases/update-workspace-default-guardrail` |
| Key assign/reassign | `key-assignments.assignLegacyGuardrailToApiKey` | Shared `use-cases/assign-api-key-guardrail` |
| Key unassign | `key-assignments.unassignLegacyGuardrailFromApiKey` | Shared `use-cases/assign-api-key-guardrail` |
| Bulk key assign/reassign | `key-assignments.bulkAssignLegacyGuardrailToApiKeys` | Frontend `guardrails/bulk-assignment-handlers`; public `guardrails/assignments/bulk-assign-keys` |
| Bulk key unassign | `key-assignments.bulkUnassignLegacyGuardrailFromApiKeys` | Frontend `guardrails/bulk-assignment-handlers`; public `guardrails/assignments/bulk-unassign-keys` |
| Member assign/reassign | `member-assignments.bulkAssignLegacyGuardrailToOrganizationMembers` | Frontend `guardrails/route` and `guardrails/bulk-assignment-handlers`; public `guardrails/assignments/bulk-assign-members` |
| Member unassign | `member-assignments.bulkUnassignLegacyGuardrailFromOrganizationMembers` | Frontend `guardrails/route` and `guardrails/bulk-assignment-handlers`; public `guardrails/assignments/bulk-unassign-members` |

Shared paths are under `packages/guardrails`; frontend/public paths are under `services/cfw-frontend-api/src/routes` and `services/cfw-public-api/src/routes` respectively.

## Other entrypoints and lifecycle writers

| Path | Coverage |
| --- | --- |
| Public and dashboard CRUD | Use the shared create/update/delete use cases above. Existing validation and response shape remain in their current routes. |
| Dashboard copy | `cfw-frontend-api` guardrails route calls the create use case with source configuration and the actual destination workspace. Synchronization converts the persisted destination row. |
| Workspace-default edit and initialize-from-another-workspace | Both call the workspace-default use case. Initialization creates floor and subject-default choices from that retained deterministic identity. |
| Admin/platform configuration | Existing CRUD sanitization handles admin-only legacy fields. No separate recurring platform guardrail writer was found. |
| Mission Control guardrail demo | Calls the public HTTP API. Its in-memory simulation does not write Postgres. |
| Intern/customer/workspace provisioning | No recurring direct guardrail creation or assignment writer was found. Provisioning does not materialize inherited choices; organization cleanup uses the shared account-deletion path. |
| Residual-null-workspace cron | `cfw-internal/src/routes/cron/check-residual-null-workspace-guardrails.ts` is read-only. |
| Workspace soft deletion | `packages/db/workspaces/delete-workspace-if-not-last.ts` and the lower `deleteWorkspace` helper acquire the live owner lock before deletion. Existing triggers remove legacy settings; provenance FKs cascade owned selections and initialization records. |
| Account deletion and DSR | Shared user/organization deletion updates or locks the owner before B3 policy/provenance cleanup. DSR runs from `cfw-internal/src/workflows/data-deletion.ts`; deleted owners cannot synchronize again. |
| Organization membership removal | `packages/db/organization-members/queries.ts` deletes the membership; retained member assignments and typed choices cascade. Subject locks in synchronization prevent a deletion/initialization deadlock. Clerk membership webhooks use this path. |
| Key hard deletion | Existing key FKs cascade assignments and choices. Synchronization locks the key before its assignment and skips a concurrently removed source. |
| Key soft deletion/revocation | Keeps its existing explicit assignment metadata; no new deletion semantics are introduced. |
| Key workspace move | Single and bulk `packages/db/api-keys/move-to-workspace.ts` operations lock the owner and actual workspaces/keys, revalidate creators, and relocate current key choices atomically. A destination conflict aborts the entire move. |
| Key creator reassignment | Changes creator, not owning account. Existing explicit key choices stay unchanged; inherited member choices are resolved dynamically and never copied into key selections. |
| Historical SQL migrations/operator scripts | Not recurring writers. New operator SQL mutations during B5 must use the synchronization boundary or be excluded from the migration window. |

Existing route rejections for new assignments to deterministic workspace-default guardrails remain in place. Historical explicit assignments to those IDs are still real assignments and initialize as such.

## Synchronization and lock ordering

`withGuardrailOwnerTransaction` first acquires the shared lifecycle advisory barrier for the owner, the actor (`assignedBy` or `last_edited_clerk_user_id`), and every member subject, then `users FOR UPDATE` for the live resolved owner, then revalidates the references: a missing or deleted actor and a deleted member fail the write, while a historical member without a user row is still governed by the membership FK. Account deletion and DSR acquire the exclusive barrier before user locks, so cross-owner actor or member cleanup cannot race or invert lock order with management, and a writer that starts after cleanup sees the deleted flag. The shared barrier allows unrelated management owners to proceed concurrently. Management, workspace deletion, key moves, and B5 source chunks serialize on that row. Account deletion and DSR already acquire or update it before cleanup. Workspace-deletion advisory locks come after the owner lock.

Key management callers pass an explicit authorization scope: account-wide or a specific approved workspace. The approved workspace is checked again against the locked current key before assignment or unassignment; a key that moved away fails without changing either store. Historical B5 initialization continues to resolve the actual workspace independently. Keys and memberships are locked before assignment persistence or source-row locks. This matters because ordinary parent deletion can cascade without acquiring the account lock. A source reader locks the actual parent, then reads the source row. Missing subjects are not rebuilt. Multiple keys, members, and explicitly locked workspaces are sorted. Within the account-serialized flows, source guardrails, mappings, registrations, and choices are locked only after the necessary parent checks; source-configuration synchronization never fans out through its assignments.

Normal source edits convert the complete persisted legacy row, reuse an exactly equivalent policy of the same owner/type, and update mappings without mutating shared policy configuration. A complete mapping triple registers floor/default initialization. Durable assignment registration survives selection deletion. Retries update still-owned types while preserving independently changed choices and intentional inheritance. Explicit v1 assignment deliberately restores all three types, after releasing the previous source-owned selections.

B5 calls the three `synchronizeLegacy*InTransaction` APIs after acquiring the owner lock. Each source kind has its own bounded chunks. An enumerated source that disappeared is skipped; a source that changed is read again inside the transaction. Existing key-owned selections left in an older workspace are relocated only while their exact source provenance remains intact. Relocation preserves policy and selection identity and aborts on conflicts. It does not recreate absent types or copy inherited state.

Historical NULL key workspace metadata is resolved through an actual live owned workspace using the existing auth resolution rule. A derived ID alone never proves existence. Deterministic workspace guardrails with retained NULL metadata resolve against actual owned workspaces. Unsupported or mismatched live data fails the transaction for operator review.

## B5 fleet handoff

Before taking the B5 watermark, record all of the following in the reviewed backfill readiness evidence:

1. Applied additive B1/B3 migrations, validated constraints, indexes, and service grants, including completion timestamps. Confirm the effective writer role has SELECT and UPDATE privileges on `users`, `workspaces`, `api_keys`, `organization_members`, and `workspace_members`; PostgreSQL requires UPDATE for `FOR UPDATE` and `FOR SHARE`. These are existing management prerequisites, not proven live privileges merely because the local synthetic-role test passes.
2. Active deployment/build IDs and completed rollout times for `cfw-public-api` and `cfw-frontend-api`, with traffic evidence that every active writer version includes B4.
3. Active `cfw-webhooks` and `cfw-internal` deployment/build IDs carrying B3 deletion cleanup, including membership deletion and the DSR workflow. Include provisioning services when their deployed cleanup code can delete accounts.
4. Confirmation that no older writer version or separately scheduled operator mutation can write legacy guardrails outside this boundary.
5. Source inventory timestamp and counts for guardrails, key assignments, and member assignments, followed by a watermark taken after the completed fleet rollout.
6. B5 reconciliation evidence for policy mappings, retained identities, source ownership, explicit assignments, and budget limit/reset/BYOK configuration; retain rejected-record and conflict details for operator resolution.

A successful local run or zero currently missing mappings is insufficient fleet evidence. An old writer could modify a previously migrated source after those checks. If a writer is missing from the deployed inventory or rollout is incomplete, do not take the migration watermark or start B5 apply.

## Verification

The B4 real-Postgres suite is `packages/guardrails/integration/legacy-sync-{writers,deletion,initialization,concurrency,references,authorization,use-cases,runtime-grants,retention}.test.ts`. It covers all ten writer successes and real-constraint rollback failures, copy-on-write, renamed shared policies, partial ownership, opt-out/inheritance, deterministic source IDs, missing actual workspaces, membership/account/workspace deletion, single/bulk key moves, historical relocation, and conflicting destination rollback.

The lifecycle barrier regression proves management waits for exclusive account cleanup before locking its owner. The reference suite proves every actor-writing operation waits for the actor's exclusive cleanup and then rejects the deleted actor, that an unknown actor is rejected, and that a deleted member is rejected even while their membership row survives. The other concurrency cases hold a key or membership parent row, wait until database lock state confirms the initializer/assigner is blocked, then delete the parent. Initialization skips the removed source; explicit assignment fails on missing subject; neither leaves typed choices. Promise barriers and database observations coordinate the tests without elapsed-time sleeps.
