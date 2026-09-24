---
name: buddy
description: Operate on live production provider, model, model-author, and endpoint records through the internal Buddy API (https://openrouter.ai/api/v1/internal/buddy) — staging models/endpoints/pricing, author icons/names, private and BYOK-only endpoints, data policies, endpoint lookup, video parameters, model descriptions, and featured launch examples. Shared operational knowledge for Buddy (the Slack agent) and Devin; either agent runs these workflows the same way. Use when a task touches prod model/endpoint/pricing records rather than local code.
user-invocable: true
---

# Buddy — Production Model & Endpoint Operations

Buddy (the Slack agent) and Devin stage providers, models, endpoints, and pricing in **production** through the internal Buddy API. This skill is the operational knowledge both run on, kept in this repo so either agent (or a human) runs the same workflows.

**This skill is a living document** (see [`../AGENTS.md`](../AGENTS.md)): most of what's here was learned from real staging runs. When a run teaches you something the references got wrong, fix it in the same PR.

## Use this when

- Staging a model, endpoint, or pricing version in **prod** (including private and BYOK-only endpoints).
- Reading or changing live provider / model / endpoint fields: capabilities, data policies, deprecation, hide/unhide, duplicates.
- Fixing a model author's display metadata (`GET`/`PATCH /model-author/{slug}`: `name`, `description`, `icon_uri`), e.g. when a new author's models show the Hugging Face fallback icon.
- Resolving a natural-language reference ("SambaNova's DeepSeek-V3.2") to an endpoint UUID and Mission Control link.
- Writing catalog model descriptions, or driving the image/video featured-example launch gate.

## Do not use this when

- You are working on **local** development or a local DB: use [`../stage-endpoint/SKILL.md`](../stage-endpoint/SKILL.md) (local Postgres + local cfw-api) and its modality siblings (`image-stage-endpoint`, `video-stage-endpoint`, `audio-stage-endpoint`, `embeddings-stage-endpoint`, `rerank-stage-endpoint`).
- You are running a full model launch: the launch runbook is [`../../../docs/runbooks/model-launch.md`](../../../docs/runbooks/model-launch.md), with [`../onboard-frontier-model/SKILL.md`](../onboard-frontier-model/SKILL.md), [`../azure-model-launch/SKILL.md`](../azure-model-launch/SKILL.md), and [`../social-launch/SKILL.md`](../social-launch/SKILL.md). This skill covers the Buddy-API mechanics those flows call into.
- The customer-facing private BYOK onboarding process is owned by [`../onboard-private-byok-model/SKILL.md`](../onboard-private-byok-model/SKILL.md); this skill covers the API mechanics behind it.

## Non-negotiables

1. **Read the code first.** Every reference here is a digest of behavior implemented in this repository, and digests drift. Routes: `services/cfw-internal/src/routes/buddy-api/`; auth: `services/cfw-internal/src/middlewares/buddy-auth.ts`; schemas and enums: `packages/db/`, `packages/enums/`, `packages/pricing/strategies/`, `packages/router/adapters/<provider>/`. When the code disagrees with a reference, the code is right and the reference needs updating.
2. **Every write is preview-by-default.** Omit `apply` (or send `apply: false`) to get `{ applied: false, preview: { current, proposed, diff, stripped_fields } }`. `apply: true` commits. Post the preview, then ask for approval in a **separate** message, then re-send with `apply: true`, then re-read the resource and verify. A coding agent never supplies that approval on the human's behalf — "just fix it" is intent, not approval. The one exception is the launch-readiness default for unpublished media work on a launching model (first featured example per modality, model-scoped Arena fills and judge runs), defined in [`references/launch-examples.md`](references/launch-examples.md) and the [`arena-studio`](../arena-studio/SKILL.md) skill. Every `apply: true` on a budgeted catalog or automation route, and every Arena bulk call, must carry `X-Buddy-Batch-Id` (`<job>-<YYYY-MM-DD>-<HHMM>` with the UTC start time, one fresh id per job, the shape is enforced) even when the job is a single write, or it is refused with `400` before anything is written. The worker rate-limits applies per agent (`429` + `Retry-After`), lands each batch in fixed chunks, and refuses the next chunk until the family wait has passed and a Datadog check-in has been posted for the batch ([`references/bulk-operations.md`](references/bulk-operations.md)).
3. **Surface the Mission Control link** on every operation, read or write. Model links use the full **permaslug**, not the clean public slug. URL formats are in [`references/guardrails.md`](references/guardrails.md).
4. **Never print `$BUDDY_API_KEY`** or any secret value.
5. **Sign your work.** Every endpoint you create carries `internal_note: "staged by <you> for <requester>"` — `staged by devin for @mindi`, `staged by mindi's claude for @john`. The field is writable on PATCH too, which means a stray `internal_note` in an unrelated PATCH silently overwrites someone's note ([`references/guardrails.md`](references/guardrails.md) → `internal_note`).
6. **This is production.** Nothing here runs against a local DB, and mistakes are customer-visible.

Auth for every call, plus the human's email on every write:

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "X-Buddy-Actor-Email: approver@openrouter.ai" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints
```

`BUDDY_API_KEY` is a static secret on the `cfw-internal` worker (not an OpenRouter API key); it authenticates the agent. Each agent holds its own value with the same route scope, and each agent's shell exposes its own value as `BUDDY_API_KEY`, so every example in this skill is run as written. On the worker the two values are separate secrets: Buddy's is `BUDDY_API_KEY`, Devin's is `DEVIN_BUDDY_API_KEY` (Infisical `/services/cfw-internal-api`, Production), rotated independently. `X-Buddy-Actor-Email` is the OpenRouter email of the human whose approval authorizes the change — the person who approved the preview, who is the requester only when they approved their own request — never the agent's own address. It is who catalog writes are attributed to ([`references/buddy-api.md`](references/buddy-api.md) → Actor). Reads and previews work without it. `apply: true` on a catalog route requires it to be on the catalog-editor allowlist (`packages/providers/configs/catalog-editors.ts`); a `403` there means the approver is not an editor — stop and surface it, never retry with a different email.

**Devin sessions authenticate with OIDC instead.** Mint a 60-second bearer with `bun scripts/devin/oidc-token.ts` and send it in place of `$BUDDY_API_KEY`. Run the script directly, not through `bun run x`: the `x` wrapper shells out to `infisical run`, which has no login session on a Devin box and dies on an interactive prompt, and the script needs no Infisical secrets. The worker verifies the Devin issuer signature, audience, and org. When the token names the requesting human (`requesting_user_email`), that person must be an `@openrouter.ai` internal admin; they are only the person who started the session, so still send `X-Buddy-Actor-Email` naming the approver whenever someone else approved, and the write is attributed to the header when present and to the requester otherwise. When the token names no human (an automation-started session), the request is attributed to the Devin session (`devin:<devin_id>`) and `X-Buddy-Actor-Email` is honored exactly as for the static key, so a catalog `apply: true` needs an editor named in that header. `DEVIN_BUDDY_API_KEY` still works during the rollout.

```bash
curl -s -H "Authorization: Bearer $(bun scripts/devin/oidc-token.ts)" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints
```

Resolve the approver's email from their Slack profile, keyed by the Slack user ID on the message that gave the approval. For Devin that is the Slack MCP (`slack_read_user_profile` with that `user_id` returns the email). The requester's email arrives with the message that started a Slack session, but that is the requester, and it is the approver's address only when the same person approved. Never derive the address from a display name, guess it, or fall back to the requester or the agent when the lookup fails — surface it instead.

## Which reference to load

Rows are cumulative, not alternatives: load every reference whose row matches the task, before the first call. A write always matches the first row, so a task like "update a model description" loads `guardrails.md` and `model-descriptions.md`, and `buddy-api.md` for the route schema. Working from memory of a reference is not reading it.

| Task | Reference |
|---|---|
| Any write to a live record; private/BYOK invariants; permaslug + deprecation-date conventions | [`references/guardrails.md`](references/guardrails.md) |
| Any apply: the mandatory `X-Buddy-Batch-Id`, per-agent budgets, chunks and check-ins, break glass (bounded emergency ceiling a human editor opens), live Datadog monitoring, verification, rollback | [`references/bulk-operations.md`](references/bulk-operations.md) |
| Exact request/response schema for a route | [`references/buddy-api.md`](references/buddy-api.md) |
| End-to-end staging of a model and/or endpoint | [`references/staging-workflows.md`](references/staging-workflows.md) |
| Field-level detail: providers, pricing SKUs, parameters, authors, gotchas | [`references/staging-reference.md`](references/staging-reference.md) |
| "provider X's model Y" → endpoint UUID + Mission Control link | [`references/find-endpoint.md`](references/find-endpoint.md) |
| Staging a private model (private slug) | [`references/private-models.md`](references/private-models.md) |
| Staging a private / BYOK-only endpoint | [`references/private-endpoints.md`](references/private-endpoints.md) |
| Driving a private endpoint for a non-engineer (sales/support) | [`references/private-endpoint-walkthrough.md`](references/private-endpoint-walkthrough.md), plus [`references/private-endpoint-intake.md`](references/private-endpoint-intake.md) and [`references/private-endpoint-testing.md`](references/private-endpoint-testing.md) |
| Resolving a `data_policies` UUID / ZDR state | [`references/data-policies.md`](references/data-policies.md) |
| `supported_video_parameters` on video endpoints | [`references/video-parameters.md`](references/video-parameters.md) |
| Writing the catalog model description | [`references/model-descriptions.md`](references/model-descriptions.md) |
| Image/video featured-example launch gate (paid; needs an `OPENROUTER_API_KEY` on the same billable entity as cfw-internal's `MODEL_EXAMPLES_API_KEY`) | [`references/launch-examples.md`](references/launch-examples.md) |
| Verifying a reasoning-effort bump actually changes token usage | [`references/effort-comparison.md`](references/effort-comparison.md) |
| Curl-testing Buddy routes (auth, catalog gate) against a local cfw-internal | [`references/local-testing.md`](references/local-testing.md) |

## Diagnose against production

A prod symptom is diagnosed against prod state. Read the live record through the Buddy API (or Mission Control) before theorizing from code or from a local checkout; then read the code to explain what you saw. Never conclude from a local reproduction alone.
