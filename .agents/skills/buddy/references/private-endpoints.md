# Staging Private Endpoints

A *private endpoint* is an endpoint with `is_private: true` and one or more `private_access_grants`. It is only routable for Clerk users/orgs listed in the grants, and is invisible to everyone else. Common use cases:

- Sponsored or comp'd access for a specific org (e.g. give an org access to Opus pricing on a different model slug).
- Custom pricing or feature flags per customer.
- Pre-release access to an internal-only model behind a private gate.

This is a thin wrapper over the standard endpoint creation flow. **Read [`staging-workflows.md`](staging-workflows.md) first** for the canonical Buddy API reference, SKU discovery rules, and Mission Control links — everything there still applies. This document only covers what's *different* about private endpoints.

---

## Who can access a private endpoint (and who can't)

Access is **purely grant-based** — there is no implicit OpenRouter-staff, internal, or "OR org" bypass anywhere in `openrouter-web` (verified: no `OPENROUTER_ORG_ID` default grant, no `isOpenRouterStaff` check, no staff override in the access-resolution path). A request can route to a private endpoint **only if** the caller's authenticated entity is listed in the endpoint's `private_access_grants`.

- The auth layer hydrates each request with `privateEndpointIds` / `privateModelPermaslugs` from `listPrivateModelsAndEndpointsForEntity(entityId)`, where `entityId = orgId ?? userId` (org context resolves to the org ID; otherwise the personal user ID). See `packages/frontend/utils/auth/init.ts`.
- Resolution is `hasEitherPrivateResourceGrant` in `packages/frontend/server-actions/private-resource-access.ts`: the grant must contain the requesting entity's ID — endpoint grants and model grants are independent, either one unlocks the resource. No match → `404`.
- Private endpoints/models never appear in any public catalog, listing, or docs surface — they only show in the *private marketplace* for entities that hold a grant.

**What this means in practice for OpenRouter / openrouter.ai people:** OR team members can test a private endpoint **when their own OR org (or personal user ID) is in the `private_access_grants`** — which is exactly how the private `gpt-5-nano:batch` test endpoint works. It is "invisible to non-OR people" not because OR staff get an automatic bypass, but because the grant list is scoped to the OR entity. So when staging a private endpoint that OR folks need to hit, **you must add their OR org/user `entity_id` to the grants** — being on the OR team alone does not grant access.

### Default for OpenRouter internal testing

When the request is clearly for OpenRouter's own internal testing and no other access scope is specified, default the complete ACL to:

```json
[{ "entity_id": "org_2uMVNwONqhSdZXQy1QtyWuCjTxZ" }]
```

This grants access to anyone operating in the OpenRouter organization context. Still show the exact organization grant in the required preview and obtain explicit approval before applying it. Do not silently add a personal user grant. Do not use this default for customer, partner, sponsored, or other externally scoped endpoints; obtain their exact Clerk entity IDs instead.

---

## The Request Shape

Private endpoints are created via the same `POST /api/v1/internal/buddy/endpoints` route as public ones. The two extra fields are:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `is_private` | `boolean` | Yes — must be `true` | Marks the endpoint private. Without this, `private_access_grants` are ignored. |
| `private_access_grants` | `Array<{ entity_id: string }>` | Yes | One entry per Clerk org or user that should have access. `entity_id` is the Clerk ID — `org_...` for orgs, `user_...` for individuals. |
| `is_byok_only` | `boolean` | Set it explicitly | On create, `is_private: true` with `is_byok_only` omitted defaults to `is_byok_only: true` (`resolveIsByokOnly` in `services/cfw-internal/src/routes/buddy-api/create-endpoint.ts`). A private pre-launch test endpoint that must run on the platform provider key needs `is_byok_only: false` in the payload, or every request fails for lack of a customer key. Check the value in the preview's `proposed` block. |

A minimal private endpoint payload looks like (this one is BYOK-only by default because `is_byok_only` is omitted):

```json
{
  "model_permaslug": "amazon/nova-micro-v1",
  "provider_slug": "anthropic",
  "variant": "standard",
  "provider_model_id": "claude-opus-4-7",
  "is_private": true,
  "private_access_grants": [
    { "entity_id": "org_2uMVNwONqhSdZXQy1QtyWuCjTxZ" }
  ]
}
```

Multiple grants are permitted:

```json
"private_access_grants": [
  { "entity_id": "org_2uMVNwONqhSdZXQy1QtyWuCjTxZ" },
  { "entity_id": "org_3aB9CdEfGhIjKlMnOpQrStUvWxYz" },
  { "entity_id": "user_2sBcDeFgHiJkLmNoPqRsTuVwXyZ" }
]
```

---

## End-to-End Workflow

The pattern below covers the most common request: *"create a private endpoint that mirrors an existing public endpoint, but scoped to org X"*.

### Step 1: Identify the source endpoint

The user will usually phrase the ask as: *"make a private endpoint for model A that points at model B's deployment"* or *"give org X access to model A at the price of model B"*. Translate that into the source endpoint to clone.

```bash
# Look up the source by permaslug
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints \
  | jq '[.data[] | select(.model_permaslug == "<source-permaslug>" and .deleted == false)]'
```

If the user references the source by *slug* (e.g. `anthropic/claude-opus-4.7`), remember slug ≠ permaslug. Resolve via the models list first:

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/models \
  | jq '.data[] | select(.slug == "<user-provided-slug>") | {slug, permaslug}'
```

Pick the canonical sibling endpoint to clone — usually the first-party deployment (e.g. `provider_name: "Anthropic"` with `provider_overrides: {}`). If multiple deployments exist (Anthropic, Bedrock, Vertex, Azure), ask the user which one they want to mirror — *especially* for `provider_overrides` and pricing, which can vary across deployments.

### Step 2: Verify the target model exists

Private endpoints attach to existing models (you don't usually create a new model just to point a private endpoint at it — the private endpoint *is* the deviation). Confirm the target permaslug is real:

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/models \
  | jq '.data[] | select(.permaslug == "<target-permaslug>") | {slug, permaslug, hidden, deleted}'
```

If it's missing, stop and confirm with the user before doing anything else.

> ⚠️ **A spec claiming "no endpoint exists on this model yet" is often wrong.**
> Endpoints created via the Buddy API start `hidden: true`, and hidden endpoints
> do not show up on any public surface — so whoever wrote the spec genuinely
> could not see them. Always resolve the live endpoint list yourself before
> concluding a model is bare:
> ```bash
> curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
>   https://openrouter.ai/api/v1/internal/buddy/endpoints \
>   | jq '[.data[] | select(.model_permaslug == "<target-permaslug>" and .deleted == false)
>          | {id, provider_name, provider_model_id, hidden, is_private}]'
> ```
> Staging a duplicate because the spec said the model was empty leaves an
> undeletable row behind (there is no DELETE — see Gotchas).

### Step 2.5: Verify the `provider_slug` BEFORE building the payload

The Buddy API rejects unknown `provider_slug` values with `404 Provider not found for slug: …`. The slug is **not** the same as the `provider_name` you see on existing endpoints. For example:

| `provider_name` (display) | `provider_slug` (URL-friendly) |
|---|---|
| `Anthropic` | `anthropic` |
| `OpenAI` | `openai` |
| `FakeProvider` | `fake-provider` (note the hyphen!) |
| `Amazon Bedrock` | `amazon-bedrock` |
| `Google` | `google` (or `google-vertex` for Vertex) |

The conversion isn't always a simple lowercase. **Never guess.** Discover the slug by inspecting an existing endpoint of the same provider:

1. **Preferred**: The slug is hardcoded in the [`OpenRouterTeam/openrouter-web` repo](https://github.com/OpenRouterTeam/openrouter-web) in `packages/enums/providers.ts` → `providerSlugMap`. If you have access, read it there.
2. **Fallback**: Inspect an existing live endpoint via Buddy API to read `provider_overrides.slug` (when set, this *is* the slug; otherwise the provider's default slug applies — usually a lowercased+hyphenated form of the display name):
   ```bash
   curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
     https://openrouter.ai/api/v1/internal/buddy/endpoints \
     | jq '[.data[] | select(.provider_name == "<display-name>") | .provider_overrides.slug] | unique'
   ```
   If the result is `[null]`, the provider's default slug applies and you need to look it up in the openrouter-web repo or guess from the display name (lowercase + hyphens).

> ⚠️ **Do NOT probe by sending real `POST /endpoints` requests with
> different slug guesses.** The Buddy API has no DELETE for endpoints — every
> probe that "happens to work" creates a real DB row that requires manual
> cleanup. If you must probe, only do so against a permaslug you don't mind
> orphaning, and immediately PATCH the resulting endpoint into a usable
> state instead of leaving stubs.

### Step 3: Discover pricing SKU keys

**Never hardcode SKU keys.** Pull them straight from the source endpoint's live `pricing_json` via the buddy route (works for hidden and visible endpoints — resolve the UUID with `find-endpoint` first):

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  "https://openrouter.ai/api/v1/internal/buddy/endpoint/<source-endpoint-uuid>" \
  | jq '.data.current_pricing_version.pricing_json'
```

Copy the *exact* key set. The values can be the same as the source (mirroring the public price), zeroed out (free for the granted org), or overridden to a custom rate — just confirm with the user which.

> ⚠️ **Pricing lives under `current_pricing_version.pricing_json`** on the read
> projection — *not* a top-level `pricing` or `pricing_json` key. Both of those
> read `undefined`, which looks like "this endpoint has no pricing" when it is
> actually priced. Use the exact jq path above.

**If the endpoint is `is_byok_only: true`, zeros are not an option.** A zeroed BYOK endpoint earns OpenRouter 0% instead of the 5% cut, reports `$0` upstream cost to the customer, is invisible to spend budgets, and is blocked from baseline auto-unhide. Use the public list price for the same model on the same provider as the reference rate, or the customer's negotiated rate if they gave you one. Never default to zeros. Full reasoning: [`guardrails.md`](guardrails.md) → Private / BYOK staging invariants Rule 2.

If the source's strategy is non-default, the strategy is set via `provider_overrides.pricingStrategy` on the endpoint — copy that field too. See [`staging-workflows.md`](staging-workflows.md) for the full strategy/SKU discovery reference.

### Step 4: Build & confirm the preview (REQUIRED)

Same hard stop as any other staging flow: **never apply a write without explicit human approval**. Preview each call with `apply` omitted, post the payloads and the preview response, then ask for confirmation in a separate message. The preview must show:

- Source endpoint being cloned (id + provider + permaslug)
- Target `model_permaslug`, `provider_slug`, `provider_model_id`, `variant`
- All `provider_overrides`, `features`, `additional_parameters`, `excluded_parameters` being copied
- The `is_private: true` flag and **every** `entity_id` in `private_access_grants`
- The full `pricing_json` payload for the pricing version
- That the endpoint stays `hidden: true` and `is_private: true` until someone unhides it in Mission Control

### Step 5: Create the endpoint

Only after explicit approval:

```bash
curl -X POST https://openrouter.ai/api/v1/internal/buddy/endpoints \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "apply": true,
    "model_permaslug": "<target-permaslug>",
    "provider_slug": "<provider-slug>",
    "variant": "standard",
    "provider_model_id": "<upstream-model-id>",
    "quantization": "<source-quantization>",
    "context_length_override": <source-context>,
    "max_completion_tokens": <source-max-completion>,
    "has_chat_completions": true,
    "has_completions": false,
    "supports_reasoning": <source-supports-reasoning>,
    "is_private": true,
    "private_access_grants": [
      { "entity_id": "<clerk-org-or-user-id>" }
    ],
    "features": <source-features>,
    "provider_overrides": <source-provider-overrides>,
    "additional_parameters": <source-additional-parameters>,
    "excluded_parameters": <source-excluded-parameters>
  }'
```

All Buddy API mutation routes are preview-by-default: omitting `apply` returns `{ "applied": false, "preview": { "proposed": ..., "stripped_fields": [...] } }` without writing. Since Step 4 already gathered explicit approval, send `apply: true` here.

The response includes `data.id` — capture it for the pricing call.

### Step 6: Create the pricing version

```bash
curl -X POST https://openrouter.ai/api/v1/internal/buddy/pricing-versions \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "apply": true,
    "endpoint_id": "<endpoint-id-from-step-5>",
    "pricing_json": { ... cloned or customised SKUs ... }
  }'
```

Pricing versions are irreversible via the API — if you have any doubt about the SKUs, send the same body without `apply` first and check the previewed `pricing_json` before committing.

**The pricing preview resolves `endpoint_id` and nothing else.** `model_permaslug` is not a substitute — the route reads only `endpoint_id`, so a preview without one echoes the normalized `pricing_json` but cannot report the pricing version it would supersede (`create-pricing-version.ts`). Show the intended SKU key set and values in the endpoint preview batch, and preview the pricing version itself once the real `endpoint_id` exists.

**Apply pricing in the same batch as the endpoint create — never later.** Generation cost is computed against the pricing version current at request time, and pricing versions are **not retroactive**. An endpoint that serves traffic before it is priced bills those generations at the wrong rate permanently. If that already happened, say so explicitly in your summary with the time window — the requester needs to know, and the revenue is not recoverable.

### Step 7: Post Mission Control link & next steps

Always post the link after a successful create:

```
https://internal.openrouter.ai/endpoint/edit/<endpoint_id>
```

Remind the user that:

- The endpoint is **`hidden: true`** after creation. It can be unhidden in Mission Control or through `PATCH /api/v1/internal/buddy/endpoint/{id}` while it remains private and has at least one effective grant.
- The endpoint is **`is_private: true`** — it will not appear in any public listing and is only visible to the granted entities.
- Existing-endpoint PATCH supports `is_private`, `hidden`, and `private_access_grants` under the private-resource guardrails in [`guardrails.md`](guardrails.md). Grant updates have **replacement semantics**: always send the complete desired ACL, because any omitted entity loses access. A private, visible endpoint must retain at least one grant.
- **`is_private` is only editable while the endpoint is hidden *and* has never been unhidden.** Once `first_unhidden_at` is set, privacy is part of the endpoint's frozen identity: PATCH strips the change into `stripped_fields` and the write silently does nothing else. Flip privacy on an already-exposed endpoint by [duplicating it](buddy-api.md#post-apiv1internalbuddyendpointendpointidduplicate) under a new id, then hiding or deprecating the original. Grants themselves stay editable — only the `is_private` flag freezes.
- When privatizing, granting, and unhiding a hidden endpoint, prefer one previewed request so the resolved state is reviewed together. Include `is_byok_only` explicitly: it is independently configurable, and PATCH does not automatically apply the private-create default.

---

## Unhiding an Existing Private Endpoint

An endpoint that is already `is_private: true` and has at least one effective access grant may be unhidden directly with the ordinary endpoint PATCH. **Do not run `baseline-unhide` just to expose an already-private endpoint.** Baseline activation tests are required for public endpoints; the Buddy API's visibility guardrail allows direct `hidden` changes only when the resulting endpoint is private.

1. Read the endpoint through `GET /api/v1/internal/buddy/endpoint/{endpointId}`.
2. Confirm `is_private: true`, `hidden: true`, and that `private_access_grants` in the GET response is non-empty. **Omit the field from your PATCH entirely** so the existing grants survive.

> ⚠️ **Never send `private_access_grants` on an unhide PATCH.** The field has
> replacement semantics, so `[]` or `null` wipes the customer's
> access silently. This applies to every non-ACL PATCH: `hidden`,
> `internal_note`, `deleted`, pricing strategy, all of them. See
> [`guardrails.md`](guardrails.md) → Private / BYOK staging invariants Rule 3.
3. Preview a direct PATCH with only `{"hidden": false}` and no `apply`.
4. Post `hidden: true → false`, `is_private: true (unchanged)`, the endpoint ID, and its Mission Control link. Confirm `stripped_fields` is empty.
5. Ask the human for explicit approval in a separate message, even if they already said "go ahead".
6. Repeat the same PATCH with `{"apply": true, "hidden": false}` plus `X-Buddy-Actor-Email` set to the approver. Without the header the apply is refused with `403` and nothing is written.
7. Re-read the endpoint and verify `hidden: false` and `is_private: true`.

```bash
# Preview — no write
curl -X PATCH "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"hidden": false}'

# Apply only after the preview is approved
curl -X PATCH "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "X-Buddy-Actor-Email: approver@openrouter.ai" \
  -H "Content-Type: application/json" \
  -d '{"apply": true, "hidden": false}'
```

This direct path does not run baseline tests. It also does not make the endpoint public: `is_private` and the existing ACL remain unchanged, so only granted entities can resolve or route to it. If the endpoint is public, has no effective grants, or the preview strips `hidden`, stop and use the public `baseline-unhide` flow or repair the privacy configuration first.

---

## BYOK-Only Endpoints (Customer-Key Onboarding)

The customer-onboarding shape: a private model per customer deployment, each with one endpoint carrying `is_private: true` **and** `is_byok_only: true`. The customer supplies and scopes their own provider key; we never handle it.

On our side, three things matter:

- **`is_byok_only: true` must be explicit.** It is independently configurable and PATCH does **not** apply the private-create default — if you later PATCH the endpoint and care about this flag, state it in the payload.
- **`provider_model_id` goes upstream verbatim.** For dedicated or reserved deployments (a customer "wave" account, a named capacity reservation), the exact string is what appears in the provider's own logs and billing. Send it bare — no prefix, no suffix, no normalisation — or the customer cannot reconcile their invoice.
- **Reference pricing is mandatory and non-zero.** See Step 3 and [`guardrails.md`](guardrails.md) → Private / BYOK staging invariants Rule 2.

### What to tell the customer about key scoping

Key scoping happens entirely in the customer's dashboard, and the defaults do not do what customers assume. Relay these three facts during onboarding — verified against `provider_api_keys` handling in `OpenRouterTeam/openrouter-web`:

1. **Multiple keys per provider per org are supported.** The uniqueness constraint is on the key's own ID, not on `(org, provider)`. A customer can hold several keys for the same provider and point different private slugs at different keys.
2. **Scoping is three AND-combined filters** — `allowed_models`, `allowed_api_key_ids`, `allowed_user_ids`. Empty or null on any axis means *unrestricted on that axis*. So a freshly created key with nothing set matches **every** endpoint for that provider, including all the customer's other private slugs and every public model they call on that provider.
3. **"Always use" is `is_required`, and it is provider-wide — not per-model.** Customers routinely read the toggle as "always use this key for this model". It is not. It forces the key for every request to that provider.

The practical failure mode: a customer creates a second key intending a 1:1 mapping to one new private slug, leaves it unscoped, and now two keys match that slug. Routing fans out one endpoint copy per *matching* key, each pinned via `byok_provider_key_id` with an identical `endpoint.id`, and selection between them falls to `sort_order` — so the intended mapping quietly does not hold.

The fix is the **Models** filter on each key. Have the customer set it through the dashboard dropdown rather than by hand: `allowed_models` matches against `endpoint.model_variant_permaslug`, so it stores **dated variant permaslugs**, and hand-typed clean slugs will not match. Give them an explicit per-key mapping table of which slugs each key should cover.

---

## Common Patterns

### "Give org X access to model A at model B's pricing"

Two interpretations — clarify with the user before staging:

1. **Same upstream, different price** — endpoint sits on model A's permaslug, uses model A's `provider_model_id`, but its pricing version uses model B's SKU values. The org sees model A's slug; only the price differs.
2. **Different upstream, same slug** — endpoint sits on model A's permaslug but its `provider_model_id` points at model B's deployment. The org calls model A's slug, but bytes flow through model B's upstream. Pricing can be anything (model A's, model B's, or custom).

Pattern 2 is what was used for the example case (a private `amazon/nova-micro-v1` endpoint pointing at `claude-opus-4-7` with Opus pricing). It's powerful but unusual — confirm before staging.

### Multi-entity grants

`private_access_grants` is a flat array — list every entity that should have access in a single request. There's no nesting or inheritance. On PATCH, the array replaces the entire ACL: to add one entity later, first preserve every existing entity in the submitted list, then include the new one.

### Free-for-the-granted-org

If the goal is to give the granted org free access to a paid model, use a zeroed pricing version. **Don't** set `variant: "free"` — that's the public free tier, not a per-org override. Keep `variant: "standard"` and set the SKU values to `"0"` (as strings, matching the source's key set).

**This pattern does not apply to BYOK endpoints.** Zeroing the SKUs on an `is_byok_only: true` endpoint is a defect, not a free grant — the customer is already paying their provider directly, and the zeros only destroy OpenRouter's percentage cut and the customer's own cost reporting. Zeros are legitimate here only for a genuinely free, non-BYOK, comp'd grant.

---

## Gotchas

- **`is_private` without `private_access_grants`** locks everyone out, including the bot account that created it. Always include at least one grant.
- **Wrong `provider_slug`** is the easiest mistake. The user's example payload often uses `openai` as a placeholder — match the *source endpoint's* provider, not the target model's author. (E.g. cloning a Claude endpoint onto a Nova model means `provider_slug: "anthropic"`, not `amazon`.)
- **Provider slug ≠ provider_name**: the URL-friendly slug is often, but not always, a lowercase version of the display name. `FakeProvider` → `fake-provider` (with hyphen), `Amazon Bedrock` → `amazon-bedrock`. See Step 2.5 for the discovery procedure. **Never probe with real `POST` requests** — failed probes that *happen* to succeed create undeletable endpoint rows.
- **Adapter mismatch**: if the source uses a non-default adapter via `provider_overrides.adapterName`, copy the override verbatim. The endpoint has to speak the source's upstream protocol, not the target model's.
- **Pricing strategy mismatch**: same rule. Copy `provider_overrides.pricingStrategy` from the source if it's set. The SKU keys belong to the *strategy*, not the model — getting this wrong renders pricing as blank fields in Mission Control even though the row exists.
- **Hidden flag**: every endpoint created via the Buddy API is `hidden: true`. Private endpoints are no exception. Tell the user explicitly.
- **Zeroed pricing on a BYOK endpoint is a defect.** Nothing warns you. It costs OpenRouter the 5% cut on every request, reports `$0` to the customer, hides the traffic from spend budgets, and blocks baseline auto-unhide. Use the public list price for the same provider as the reference rate. See [`guardrails.md`](guardrails.md) → Private / BYOK staging invariants Rule 2.
- **Pricing versions are not retroactive.** Price the endpoint in the same batch as the create, before any unhide. Traffic served while mispriced is billed wrong permanently — a later version does not repair it.
- **`private_access_grants` replaces on write.** `GET /endpoint/{id}` returns the current ACL, but sending the field as `[]` or `null` wipes it silently. Omit it entirely on every PATCH that is not deliberately editing the ACL, and when you are, submit the complete list read from the GET. See Rule 3 in the same rules file.
- **Reads give `provider_name`; writes take `provider_slug`.** The read projection returns `provider_name: "Fireworks"` and `provider_slug: undefined`. Do not round-trip a GET straight into a POST — look the slug up per Step 2.5. Similarly, pricing reads from `current_pricing_version.pricing_json`, never a top-level `pricing` key.
- **There is no Buddy API deletion route for endpoints.** Endpoint PATCH strips `deleted` (it is in `ALWAYS_EXCLUDED_FIELDS`), so `deleted: true` leaves the row active and only shows up in `stripped_fields`. The most a Buddy API write can do is hide the endpoint; retirement itself happens in Mission Control. This is why duplicate or mis-provisioned endpoints are expensive: every stray row needs human cleanup. Resolve the live endpoint list before creating anything.

---

## Reference

- [`staging-workflows.md`](staging-workflows.md) — canonical endpoint API reference, SKU discovery, Mission Control URLs, error codes.
- [`private-models.md`](private-models.md) — staging private *models* (with `is_private: true` on the model itself). Run that one first if the target model doesn't exist yet.
- [`guardrails.md`](guardrails.md) — the three silent-damage private/BYOK rules: exclude `model_version_group_id`, non-zero BYOK reference pricing, and omit `private_access_grants` on every non-ACL PATCH.
