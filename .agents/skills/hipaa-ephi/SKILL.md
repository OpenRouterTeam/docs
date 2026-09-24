---
name: hipaa-ephi
description: Decide whether a change has HIPAA impact and pick the control it must ship with. Run before opening any PR that reads, transforms, or emits inference content; adds a write sink (Postgres, ClickHouse, Spanner, R2, GCS, KV, queue, Pub/Sub, broadcast, vendor, email, Slack); adds a log line, metric tag, trace attribute, PostHog event, or monitor payload; changes routing or endpoint eligibility; adds a route, worker, proxy mount, UI page, or control a HIPAA workspace could reach; reads is_hipaa_enabled, the HIPAA entitlement, getUser, or the auth cache; or changes prompt logging, deletion, DSR scrubbing, trash sweeps, or retention.
user-invocable: true
---

# HIPAA and ePHI

Every feature owner decides, before opening the PR, whether the change can produce, move, store, log, or display ePHI, and states the answer on the PR's HIPAA / ePHI checklist line. "Does not touch HIPAA" is a claim about data flow, not about whether the word HIPAA appears in the diff. Reviewers check the claim per `REVIEW.md` → HIPAA and ePHI.

## What ePHI is

**ePHI is any inference content or content-derived value tied to a HIPAA workspace.** Prompts, completions, tool-call arguments and results, images, audio, transcripts, embeddings inputs, files, guardrail and classifier outputs, user signals, upstream error bodies that echo the request, and any field derived from them. Identifiers and counts (generation id, workspace id, model, token counts, status) are not ePHI. The mirror worker (`api-hipaa`) and the HIPAA field policies are the only places allowed to hold ePHI, and the mirror never writes a prompt log.

**HIPAA is subtractive and allowlisted.** A HIPAA workspace gets nothing new by default. A new surface, sink, or capability is unavailable to HIPAA workspaces until someone adds it to the relevant allowlist with a stated reason. Do not make a feature reachable from a HIPAA workspace to avoid a 403 or a hidden menu item.

## Triggers

Answer yes to any of these and the change has HIPAA impact:

- **Inference content.** Reads, transforms, or emits request or response content anywhere in `services/cfw-api`, `packages/router`, `packages/routing`, adapters, skins, or a modality worker.
- **New sink.** Adds a write of content or content-derived values to Postgres, ClickHouse, Spanner, R2, GCS, KV, a queue or Pub/Sub topic, a broadcast destination, a third-party vendor, an email, or Slack.
- **Logs and telemetry.** Adds a log line, metric tag, trace attribute, PostHog event, error message, or Datadog monitor payload that could carry content. In `cfw-api` inference routes, anything logged or breadcrumbed before `dispatchToHipaaMirrorIfNeeded` runs on the primary worker for HIPAA requests too, because the fork has not happened yet. The mirror scrubs its own logs and the primary does not.
- **Routing and eligibility.** Changes a `RoutingStepGenerator[]`, BYOK endpoint minting, private or pinned endpoints, data policies, ZDR, data region, or model or endpoint eligibility.
- **Surfaces.** Adds a route, worker, proxy mount, UI page, playground, chat surface, navigation entry, or leaf control that a HIPAA workspace could reach.
- **Posture and auth.** Reads `is_hipaa_enabled`, the HIPAA entitlement, `getUser`, or the auth cache, or changes how a caller's workspace is resolved.
- **Retention and deletion.** Changes prompt logging, data deletion, DSR scrubbing, trash sweeps, or retention windows.

## Controls

When the answer is yes, the change ships with the matching control, and the PR names it:

- **Inference content or a new sink.** Route the write through the table's HIPAA field policy (`applyHipaaPolicy`, `packages/clickhouse/*/hipaa.ts`) or refuse it on HIPAA posture (`isHipaaSideChannelRefused`, `isHipaaBroadcastRefused`). Add the sink to the leak detector rules (`packages/clickhouse/hipaa-leak/`) or state why it cannot receive a HIPAA row.
- **Logs.** Named scalar fields only, per `packages/instrumentation/AGENTS.md`. On the mirror, `hipaaSafeILog` / `hipaaSafeWLog` / `hipaaSafeELog` from `@openrouter-monorepo/instrumentation/hipaa-logger` reject disallowed fields at compile time. Monitors follow `configs/terraform-monitors/HIPAA.md`.
- **Routing.** `filterEndpointsByHipaaEligibility` runs first and again after every `addBYOKEndpoints`, and `openrouter/require-hipaa-filter-in-routing-steps` enforces the placement. Model eligibility sets exclude private endpoints. See `packages/routing/REVIEW.md`.
- **Surfaces.** Classify the capability in `packages/entitlements/workspace-capabilities.ts` and gate through the shared components. A worker that serves a modality HIPAA does not support wires `createHipaaPreRelayGuard` and `createHipaaSurfaceAuth` and registers in `HIPAA_ENFORCEMENT_SITES`. See `packages/entitlements/WORKSPACE_CAPABILITIES.md` and `services/REVIEW.md`.
- **Posture.** Refuse when posture is unknown. Never treat "could not tell" as non-HIPAA.
- **Tests.** Extend the HIPAA E2E suite (`tests/e2e/README.md`, HIPAA Mirror Suite) when the change adds a sink or a surface.

## Local HIPAA workspaces

Locally, `workspaces.is_hipaa_enabled` is what puts a workspace into HIPAA mode: use the HIPAA section of the workspace Settings page, or the seeded HIPAA workspace from `postgres/seed.sql` (`HIPAA_EXPLICIT_WORKSPACE_ID` in `tests/e2e/utils/seed-test-data.ts`). The Mission Control controls are different levers, the Org Settings toggle grants the account entitlement and the Edit Endpoint form sets `endpoints.is_hipaa_eligible`, and neither one enables HIPAA on a workspace.

## When a control fails or you are unsure

Runbooks for what happens when a control fails are in `docs/runbooks/hipaa-*.md`. When unsure whether a change has HIPAA impact, ask the HIPAA project owner in the PR before merging, not after.
