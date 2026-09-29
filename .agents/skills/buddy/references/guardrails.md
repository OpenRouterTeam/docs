# Production Staging Guardrails

Durable rules for operating on live provider, model, and endpoint records through the internal Buddy API. They are silent-failure rules: no validator rejects a violation, no error comes back, and the read-back looks correct.

## Preview gate

Never read-then-silently-mutate a provider, model, or endpoint. This governs **every** write: provider create/PATCH, model-field writes (`hf_slug`, …), endpoint PATCH, staging a new model or endpoint, deprecation, hide/unhide, pricing versions, `capability-test` with `apply: true`, duplicates. A direct instruction ("just fix it", "set the hf_slug", "stage it") expresses intent; it is not approval.

1. **Preview the exact change first.** Name the resource being touched (provider name + permaslug, model name + permaslug, or endpoint UUID). Show each field as `field: old → new`; for creates show the complete validated `proposed` row and `stripped_fields`. Include the Mission Control link.
2. **Get explicit human approval**, as a separate question from the preview, and treat it as a hard stop — no write API call until the human says apply. On "edit first", incorporate the feedback, re-preview, ask again. A coding agent never supplies this approval on the human's behalf.
3. **Surface the Mission Control link** on every operation, read or write:

   ```text
   provider:  https://internal.openrouter.ai/provider/{provider-permaslug}/edit
   endpoint:  https://internal.openrouter.ai/endpoint/edit/{endpoint_id}
   model:     https://internal.openrouter.ai/model/edit/{model-permaslug}
   ```

4. **Verify the apply against the Buddy route, not the public API.** Re-read the resource through its Buddy GET (a direct database query) and compare it to the approved preview; Mission Control shows the same row. Where the write has no read route exposing what it changed (`test-cache/clear`, `model-version-groups`), verify from the apply response plus whatever Buddy GET does reflect it. The public catalog (`/api/v1/models`) is served from the KV catalog cache behind an edge cache with `max-age` and stale-while-revalidate (`services/cfw-public-api/src/routes/models/`), so it can return the old value long after a correct apply. A stale public read is not a failed write and never justifies a retry.

Exempt: pure reads and documented dry runs (`apply: false`) that mutate nothing — still link Mission Control. Everything that writes is gated.

## Mission Control model links use the full permaslug

Build model editor URLs from the model record's `permaslug`, exactly as returned, never from the clean public `slug`. Mission Control resolves those pages by permaslug, and a permaslug can carry a date suffix the slug omits.

```text
slug:      qwen/qwen-image-3
permaslug: qwen/qwen-image-3-20260805
correct:   https://internal.openrouter.ai/model/edit/qwen/qwen-image-3-20260805
```

Do not add, remove, or infer a date suffix.

## Permaslug date suffixes

When staging a **new** model, the `permaslug` ends with a `YYYYMMDD` suffix and the public `slug` stays clean. The endpoint's `model_permaslug` references the dated permaslug.

```text
slug:            moonshotai/kimi-k2.6            ✅ clean
permaslug:       moonshotai/kimi-k2.6-20260420   ✅ YYYYMMDD, no dashes
model_permaslug: moonshotai/kimi-k2.6-20260420   ✅ points at the dated permaslug
```

The suffix is the model's **launch date** (the GA or public release date the provider or requester named), not the day you happen to stage it. Resolve it before building any payload:

1. Scan the request and its source material (Slack thread, announcement, launch calendar) for a release or GA date. A date named anywhere in the thread counts, even in a message from someone other than the requester.
2. If no date is named anywhere, default to today (UTC).
3. In the preview, show the launch date and the resolved permaslug on their own labeled line (`launch date: 2026-09-30 → permaslug: voyageai/rerank-3-20260930`) and say where the date came from (`from Dimitri's message in the thread` or `no launch date named, defaulted to today`), so the requester is confirming the date and not only the payload shape.

The permaslug is immutable and the Buddy API has no model or endpoint delete route, so a wrong suffix can only be fixed by a human deleting and recreating the records in Mission Control.

When staging ahead of launch, ask the requester before building payloads whether they want the model callable for testing before launch. Do not assume either answer, and do not bolt privacy onto payloads after they were approved. If yes, stage it `is_private: true` rather than hidden-only, granting the OpenRouter organization by default for internal testing (see [`private-models.md`](private-models.md) → Step 2: Verify access entities), then preview and apply the private-model and private-endpoint unhide steps before testing. A hidden model cannot be called even when private, so leaving it hidden until launch leaves the first real request for launch day.

Unhiding freezes the endpoint's `is_private` (see [`buddy-api.md`](buddy-api.md) → frozen identity fields), so the tested private endpoint can never become the public one. Plan the launch as a clone: duplicate the endpoint with `is_private: false`, attach pricing, verify it, then hand the final public unhide to a human in Mission Control. Buddy can hide the private model and set `is_private: false` while it is hidden, but it strips `hidden: false` on any public model or endpoint, so the public model unhide and then the public clone unhide (blocked while the parent model is hidden) happen in Mission Control at `https://internal.openrouter.ai/model/edit/{permaslug}` and `/endpoint/edit/{id}`. Retire the private source afterwards. State this transition when asking so the requester chooses private testing knowing the launch-day steps.

This is forward-looking. Plenty of existing permaslugs predate the convention (`moonshotai/kimi-k2-0905`, `minimax/minimax-m2`); read and reuse them as-is and do not rewrite one unless explicitly asked.

## Deprecation dates default to 13:00 UTC

`deprecation_date` is a full ISO 8601 timestamp with hour granularity. When the requester gives only a calendar date, set `13:00:00Z` — 09:00 ET, early in the team's day, so someone is around for fallout. Never default to midnight UTC. Honor an explicitly stated time or timezone exactly, and show the resolved timestamp in the preview.

## Private / BYOK staging invariants

### 1. Exclude `model_version_group_id` when cloning a public model into a private one

Drop the field from the payload; do not copy it from the source. The version group is what makes dated model records resolve as one logical model and drives `~latest` resolution and version pickers — a private BYOK slug inside a public group becomes a candidate in that group's resolution, a catalog-integrity bug that surfaces far from the staging call. A private model is a distinct logical model, not another revision of the public one.

Include it only when the requester explicitly asks to group the private model with named records, and show the resolved group ID in the preview.

### 2. BYOK endpoints must carry non-zero reference pricing

A `is_byok_only: true` endpoint with an all-zero `pricing_json` is a defect, not a valid "customer pays upstream directly" configuration. `pricing_json` on a BYOK endpoint is the **reference rate**: it is not billed to the customer, but the platform multiplies it to compute OpenRouter's percentage cut and to populate cost reporting. With zeros, the BYOK cost path short-circuits to the minimum per-request fee (0), the customer's dashboard reports `$0` upstream cost, the traffic is invisible to spend budgets, and baseline auto-unhide blocks the endpoint for missing pricing.

Use the public list price for the same model on the same provider — read it off the public sibling and copy the SKU key set verbatim:

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  "https://openrouter.ai/api/v1/internal/buddy/endpoint/<public-sibling-uuid>" \
  | jq '.data.current_pricing_version.pricing_json'
```

Use customer-negotiated rates if supplied. If neither exists, stop and ask — never default to zeros. Zeroed pricing is legitimate only for a genuinely free non-BYOK grant.

**Pricing versions are not retroactive.** Generation cost is computed against the version current at request time; a later version does not repair earlier generations. Apply pricing in the same batch as the endpoint create, before any unhide. If an endpoint did serve traffic while mispriced, say so explicitly and state the window — that revenue is not recoverable.

### 3. Every PATCH to a private resource omits `private_access_grants`

The field has **replacement semantics** — the submitted array becomes the entire ACL. Only the Buddy reads `GET /endpoint/{id}` and `GET /models` return it, projected from the server-side join table. Sending it as `[]`, `null`, or from memory on a PATCH whose purpose is anything other than editing the ACL wipes the customer's access. When you are deliberately editing the ACL, read the complete current list from one of those routes and submit the full desired list.

```jsonc
{ "apply": true, "hidden": false }                              // ✅ ACL preserved
{ "apply": true, "hidden": false, "private_access_grants": [] }  // ❌ ACL destroyed
```

Omit it entirely on every PATCH that is not deliberately editing the ACL — unhide, `internal_note`, `deleted: true`, pricing-strategy changes, all of them. When you *are* editing the ACL, read the current list from `GET /endpoint/{id}` or `GET /models` first and send the complete desired list. Create and PATCH apply responses do not echo the field (`services/cfw-internal/src/routes/buddy-api/create-model.ts`, `create-endpoint.ts`, `update-model.ts`, `update-endpoint.ts`) — a missing key in an apply response is not data loss; verify through one of the two reads.

## `internal_note` carries staging attribution

`internal_note` is caller-owned on both endpoint create and PATCH: whatever you send is validated (trimmed, ≤200 chars, no control characters), and `null` or an empty string clears it. Only endpoints have the column — the `models` table has none, so a note sent to the model routes is meaningless.

Stamp attribution on every endpoint you create, naming the agent doing the staging and the human who asked for it:

```json
{ "internal_note": "staged by devin for @mindi" }
```

Use the agent's own name — `staged by devin`, `staged by mindi's claude`, `staged by buddy` — never a generic "staged by an agent". Add a distinguishing qualifier when the endpoint matrix needs one (`staged by devin — global`, `staged by devin — claude on aws`).

Rewriting an existing note is a destructive edit of human context: it belongs to whoever wrote it. Never send `internal_note` on a PATCH whose purpose is something else (unhide, pricing, `deleted: true`) — that silently replaces the note. Overwrite only when a human asks for the new text, show the old and new values in the preview, and get the usual approval.

Older rows may carry a bare `staged by buddy` or no note at all; an existing row's note says nothing about the current contract.

## Production-first diagnostics

When asked why a live endpoint, provider, automation, or test is failing, run the safe live diagnostic before source archaeology:

1. Resolve the exact live resource ([`find-endpoint.md`](find-endpoint.md)).
2. Run the closest safe reproduction — `baseline-unhide` or `capability-test` with `apply: false`, the read-only `test-endpoint` route, other dry runs. An `apply: false` automation run still executes its live tests where the route contract says it does; it only suppresses the final mutation. Its test rows, upstream request bodies, provider errors, and blocked reasons are the primary evidence.
3. Extract the concrete failing cases and exact errors.
4. Read source only to explain an observed result, distinguish a validator failure from an upstream rejection, or identify the fix.
5. Lead the answer with the live result: what ran, pass/fail counts, remaining failures and why. Implementation references come after.

Do not answer with causes inferred from code when a safe live route can produce the actual cause, and do not claim a dry run used cached results unless the route implementation does. If the live diagnostic cannot run, say exactly why (missing route, unavailable auth, mutation-only path, timeout) and label conclusions as inferred rather than observed. This rule authorizes no writes; the preview gate still applies.

## Auth failures: 401 vs 403

A `401` from the Buddy auth middleware means a key is configured and the agent key did not match it (no key configured at all is a `500`). Routes that run a live provider call forward the upstream error status (`test-endpoint` does), so a `401` from one of them can be the provider rejecting its own key after the agent key was accepted. Tell the two apart with a read-only route that makes no upstream call (`GET /models`): a `200` there clears the agent key and points the `401` at the provider credential. When the agent key is the failure, before suspecting deploy timing or a key mismatch, check that the secret exists in Infisical Production at `/services/cfw-internal-api` under the exact name the worker reads (`BUDDY_API_KEY` for Buddy, `DEVIN_BUDDY_API_KEY` for Devin) and that the worker secret sync has run since it was added. A secret at any other Infisical path is invisible to the worker. A secret added by hand in the Cloudflare dashboard is reported to be removed on the next sync (the sync configuration lives outside this repo), so do not treat it as durable. When reporting a `401`, say which of these checks ran and label the cause as inferred until one confirms it.

A `403` on `apply: true` is a different failure: the key was accepted and `X-Buddy-Actor-Email` is missing, not a valid email, or not on the catalog-editor allowlist (`catalog-editor-gate.ts` returns the same `403` for all three). Confirm the header was sent before concluding the approver is not an editor. Stop and surface it, never retry with another email (see Preview gate and `SKILL.md`).

## Launch discounts get a GTM heads-up

If a launch includes an inference discount or promotional period, remind the launch owner to notify GTM so they can coordinate advance communications with top apps and customers. Skip it when the launch context already covers GTM, and don't ask about promotions on every launch.
