# Staging Workflows — Models and Endpoints

How models and endpoints are configured on OpenRouter, and the two end-to-end workflows for staging them through the internal Buddy API.

## Read the code, not this digest

This document is a digest of behavior implemented in this repository. The code is the contract; the digest drifts.

**Read the implementation whenever you:**

- write or update guidance about OpenRouter staging behavior;
- stage or patch a model, endpoint, provider, pricing version, capability, or modality; or
- make a factual claim about a route, schema, enum, adapter, default, invariant, or database contract.

Derive every payload value from code. Do not promote copied documentation text, an older SDK, Mission Control display labels, prior chat messages, or memory into a contract. Cite the source path or symbol in the work notes, and fix this file in the same PR whenever it disagrees with the code.

Hot spots to check by topic:

| Topic | Where to look |
|---|---|
| Buddy API routes (incl. `baseline-unhide`, `capability-test`, `test-cache/clear`) | `services/cfw-internal/src/routes/buddy-api/` |
| Baseline-automation contract (request/response schemas, blocked-reason enum) | `packages/provider-monitors/steps/baseline-automation-contract.ts` |
| Capability-automation contract (request/response schemas, blocked-reason enum) | `packages/provider-monitors/steps/capability-automation-contract.ts` |
| Capability test mapping (which params trigger which tests) | `packages/provider-monitors/classes/base/capability-test-mapping.ts` |
| Provider adapters (e.g. `FireworksAdapter`) | `packages/router/adapters/<provider>/` |
| Provider configs / slug mapping / key schemas | `packages/providers/` |
| LLM-interface adapters (anthropic-messages, openai-chat-completions, google-genai, …) | `packages/llm-interfaces/` |
| Pricing strategy schemas (SKU keys per provider) | `packages/pricing/strategies/` |
| Endpoint / model database queries | `packages/db/<table-name>/` |
| Provisioning / endpoint test cache logic | `packages/provisioning/`, `packages/provider-monitors/` |

The general principle: when behaviour disagrees with this doc, the **code** is right and this doc needs updating — open a PR to fix the doc.

## Architecture Overview

OpenRouter routes user requests to upstream AI providers through a layered configuration system:

```
User Request → Model (slug) → Endpoint(s) → Provider → Upstream API
```

- **Model**: A logical AI model identity (e.g., `anthropic/claude-sonnet-4-20250514`). Defines capabilities, modalities, and reasoning config.
- **Endpoint**: A specific deployment of a model at a provider. One model can have many endpoints across different providers. Endpoints define pricing, adapter, quantization, and feature flags.
- **Provider**: An upstream API host (e.g., Anthropic, Google, DeepInfra). Providers define base URLs, adapters, data policies, and supported parameters.
- **Model Author**: The organization that created the model (e.g., `anthropic`, `google`, `meta-llama`). Auto-created from the permaslug prefix.

### Key Relationships

```
ModelAuthor (1) ← (many) Model (1) ← (many) Endpoint (many) → (1) Provider
                                        ↓
                                  PricingVersion (many)
```

An endpoint belongs to exactly one model (via `model_permaslug`) and one provider (via `provider_name`). Each endpoint can have multiple pricing versions over time; the latest effective one applies.

---

## Quick Reference

Companion references, loaded on demand:

| File | Contents | When to load |
|---|---|---|
| [`buddy-api.md`](buddy-api.md) | Full request/response schema for every Buddy API route (models, endpoints, endpoint duplicate, providers, pricing-versions, automation/baseline-unhide, hide, automation/capability-test, test-endpoint, test-cache/clear, inbox, data-policies) | Whenever you need the exact payload shape or response contract for a specific Buddy API call |
| [`staging-reference.md`](staging-reference.md) | Lookups (reading current state), §1 Models, §2 Endpoints, §3 Providers, §4 Pricing, §5 Supported Parameters, §6 Model Authors, §9 Key File Reference, §10 Common Patterns and Gotchas | Whenever you need field-level detail: DB schema fields, enums, immutable-field lists, slug/permaslug rules, ZDR/data-policy mechanics, ⚠️ warnings and gotchas |

The two end-to-end workflows below (§7 and §8) are the most common tasks; they defer to the files above for field-level detail and API schemas.

---

## 7. End-to-End Workflow: Adding a New Endpoint (Cloning an Existing Config)

The most common agent task is adding a new endpoint that mirrors an existing one (e.g., a new model version, or a second provider account for the same model). Follow these steps:

> **Copying an existing row instead?** This workflow builds a fresh endpoint with `POST /endpoints`, using another endpoint only as a shape reference. When the goal is a true copy of one specific live row — same model, same provider, same pricing, differing only in `variant`, `is_private`, `service_tier`, or `provider_region` — use [`POST /endpoint/{endpointId}/duplicate`](buddy-api.md#post-apiv1internalbuddyendpointendpointidduplicate) instead. It clones the row, its effective pricing version, and its private-access grants in one transaction, and it is the only way to change a frozen identity field on an endpoint that has already been exposed.

### Step 1: Survey Provider Patterns and Choose Source Endpoints

Complete the [mandatory same-provider pattern survey](staging-reference.md#mandatory-same-provider-pattern-survey-before-staging) first. Find an analogous previous-generation model and a working source endpoint for **each provider/provider variant** you intend to stage. Do not use one provider variant as the template for another: a direct endpoint, Vertex global endpoint, regional endpoint, and batch endpoint can require different regions, overrides, parameters, and pricing strategies.

Use the Buddy API:

```bash
# By model permaslug
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints \
  | jq '[.data[] | select(.model_permaslug == "anthropic/claude-3.5-sonnet" and .deleted == false)]'

# By endpoint ID (if you already know it)
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints \
  | jq '.data[] | select(.id == "known-endpoint-uuid")'

# Fuzzy search by model slug fragment and provider
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints \
  | jq '[.data[] | select((.model_permaslug | test("model-name"; "i")) and .provider_name == "Anthropic" and .deleted == false)]'
```

If you need the provider's pricing strategy, check an existing endpoint's `provider_overrides.pricingStrategy` via the Buddy API, or look it up in Mission Control.

Build the endpoint matrix and provenance classification before constructing payloads. Provider-specific structural fields to compare include `provider_region`, `features`, `provider_overrides`, `additional_parameters`, `excluded_parameters`, `allowed_passthrough_parameters`, `max_completion_tokens`, `context_length_override`, `supports_reasoning`, and `variant`. Copy a value only after classifying and validating it; `provider_model_id` is model-version-specific and normally comes from the provider or deployed adapter/config rather than the sibling.

Do **not** copy `discount_to_user` from the source. For a new endpoint, omit the field so it defaults to `0`. A non-zero value requires an explicit human instruction naming that discount; do not infer authorization from the source endpoint, a launch handoff, or the instruction to clone pricing.

`pricing_json` holds the list rate and `discount_to_user` expresses a promotion. See `staging-reference.md` for the ordering and scheduling rules.

### Step 2: Show Preview and Get Approval (REQUIRED)

> ⚠️ **Hard stop — do NOT call any write APIs until the user confirms.** This step is mandatory every time, no exceptions.

**Step 2a — Post the resolved payloads.** Run every call with `apply` omitted first, then show the human the preview response plus the provenance of each nontrivial value:

- The `POST /endpoints` payload, in full.
- Provider-pattern verification: source sibling per provider variant (model + endpoint UUID), resolved `provider_region`, `provider_overrides`, parameters and limits, each labelled provider-confirmed / code-derived / sibling-derived-and-verified / pending validation.
- Deferred or pending variants, explicitly.
- Commercial fields, called out separately: `discount_to_user: 0` — not inherited from the source endpoint.
- The `POST /pricing-versions` payload with its SKU keys.
- `stripped_fields` from the preview response, empty or fully accounted for.

**Step 2b — Ask for a yes/no confirmation** in a separate message: create / cancel / edit first. Keep the payload out of the question itself so the diff stays readable.

**Wait for the response before proceeding.** On "edit first", incorporate the feedback, re-preview, and ask again.

### Step 3: Create the Endpoint via Buddy API

Only proceed here after receiving explicit approval in Step 2.

```bash
curl -X POST https://openrouter.ai/api/v1/internal/buddy/endpoints \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "apply": true,
    "model_permaslug": "anthropic/claude-4.6-sonnet-20260217",
    "provider_slug": "anthropic",
    "variant": "standard",
    "provider_model_id": "claude-sonnet-4-6",
    "quantization": "unknown",
    "context_length_override": 1000000,
    "max_completion_tokens": 128000,
    "supports_reasoning": true,
    "features": {"supports_native_web_search": true, "supports_tool_choice": {}},
    "provider_overrides": {"pricingStrategy": "anthropic", "displayName": "Anthropic 2", "slug": "anthropic/2"},
    "additional_parameters": ["tools", "tool_choice", "structured_outputs", "response_format", "verbosity"],
    "excluded_parameters": [],
    "allowed_passthrough_parameters": [],
    "internal_note": "staged by <agent> for @<requester>"
  }'
```

Omit `apply` to preview the validated row (and any `stripped_fields`) before committing — since Step 2 already gathered explicit approval, `apply: true` here is fine.

`internal_note` is required on every create: name the agent doing the write and the human who requested it (see [`guardrails.md`](guardrails.md#internal_note-carries-staging-attribution)). Send `X-Buddy-Actor-Email` with the approver's email on every `apply: true` call — the human who approved the preview, which is the requester only when they approved their own change. The write is refused with `403` unless that person is on the catalog-editor allowlist (see [`buddy-api.md`](buddy-api.md)), and it is also what the changelog editor resolves to; the requester stays named in `internal_note`.

### Step 4: Re-read and Verify the Persisted Endpoint

A successful create response is not verification. Use `GET /api/v1/internal/buddy/endpoint/{endpointId}` immediately after creation and compare the hydrated endpoint against the approved endpoint matrix and preview. Confirm `stripped_fields` was empty or fully accounted for, and re-check every provider-specific invariant, especially `provider_region`, `provider_overrides`, parameter arrays, limits, pricing strategy, effective data policy, and `discount_to_user`.

For Google Vertex, explicitly assert that a global endpoint persisted `provider_region: "global"` (or the approved concrete region for a regional endpoint). If any required structural field is missing or differs from the approved preview, stop: do not create pricing, run unhide, or describe the endpoint as ready. Preview the corrective patch and obtain fresh human approval.

Do not send a real completion through the endpoint yet. Until Step 5 lands, the endpoint has no pricing version, and any generation it serves is recorded against no price (see [`guardrails.md`](guardrails.md#2-byok-endpoints-must-carry-non-zero-reference-pricing)). Structural re-read only at this point.

### Step 5: Apply the Approved Pricing Version

The endpoint is unpriced until this step runs. Pricing takes effect at creation and is not retroactive, so it must land before any unhide (see [`guardrails.md`](guardrails.md#2-byok-endpoints-must-carry-non-zero-reference-pricing)). Take the `POST /pricing-versions` payload approved in Step 2, fill in the `endpoint_id` returned in Step 3, and send it with `apply: true`:

```bash
curl -X POST https://openrouter.ai/api/v1/internal/buddy/pricing-versions \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "apply": true,
    "endpoint_id": "{response.data.id}",
    "pricing_json": { ...the approved SKU keys and rates... }
  }'
```

If the human deferred pricing in Step 2, say so explicitly in the handoff instead of skipping silently: the endpoint must not be unhidden until a pricing version exists.

Verify with `GET /api/v1/internal/buddy/endpoint/{endpointId}/pricing-versions` that the new version is the latest and its `pricing_json` matches the approved payload.

### Step 6: Validate and Test Through the Priced Endpoint

With pricing verified, run the read-only endpoint validator and a meaningful real completion through that specific endpoint. HTTP success without completion tokens is not sufficient. Confirm the concrete provider route and expected behavior. Only then describe the endpoint as launch-ready.

If the human deferred pricing in Step 2, skip the real completion as well and say so in the handoff. Behavioral testing waits until a pricing version exists.

`POST /test-endpoint` only accepts chat `TestTemplate` values. Modality templates (`decisions-*`, embeddings, rerank, TTS, STT, image) are rejected with a Zod `invalid_value` error. For those endpoints the OpenRouter-side test is the endpoint-scoped modality test on the Mission Control endpoint page (`EndpointTestActions` renders `EndpointModalityTestPopover`, and `resolveEndpointForTest` includes hidden endpoints), so run it or ask the human to run it against the staged endpoint ID before unhide. A direct provider call with the endpoint's `provider_model_id` checks the upstream contract against the adapter schema but does not exercise OpenRouter routing, so report it as supplementary. If the Mission Control test fails, report its actual error. A hidden model also returns `Model <slug> does not exist` from the public API, so the public smoke test can only run after unhide.

### Step 7: Post the Mission Control Link

After verification, **always** post the link to the user:

```
https://internal.openrouter.ai/endpoint/edit/{response.data.id}
```

Remind the user that:
- The model is `hidden: true`. Unhide it with `POST /model/{author}/{modelSlug}/unhide` (preview, human approval, then `apply: true`) before running `baseline-unhide`, which is blocked with `model_hidden` while the parent model is hidden.
- The endpoint is `hidden: true` and goes live through `baseline-unhide` once the model is visible. Do not leave a long gap between the two: the hidden-endpoint auto-delete cron protects the model's hidden endpoints for 30 days after the model is unhidden, then an endpoint hidden for 30+ days becomes eligible
- Pricing was applied in Step 5 (or is still outstanding, if the human deferred it — in which case unhide and the Step 6 completion test are both blocked)

---

## 8. End-to-End Workflow: Adding a New Model + Endpoint

### Model fields checklist — extract from source material before creating

Before making any API calls, scan everything the user provided (announcement copy, spec sheet, docs) and extract these fields. Getting them right the first time avoids a follow-up patch round-trip.

| Field | Where to look | Notes |
|-------|--------------|-------|
| `slug` / `permaslug` author prefix | **Existing prod models for this vendor** — never the provider's API schema | Run the author-lookup query in [§1 Slug and Permaslug](staging-reference.md#slug-and-permaslug) **first**. If any model exists for the vendor, re-use that exact author slug. Provider-suggested slugs (e.g. `baidu-qianfan/`) that don't match prod convention (e.g. `baidu/`) are a trap — always override them. |
| `permaslug` date suffix | Launch / GA date named in the request, thread, or announcement | `YYYYMMDD` of the **launch date**, not the staging date. If no date is named anywhere, default to today (UTC). Immutable after create and not deletable via the API, so it is called out explicitly in Step 1b. See [`guardrails.md`](guardrails.md) → Permaslug date suffixes. |
| `name` | Announcement / spec | Display name, e.g. `"Llama 4 Scout"`. **Do not include the date suffix** in the display name — the date belongs in the slug/permaslug only. E.g. `"Mistral: Voxtral Mini TTS"` not `"Mistral: Voxtral Mini TTS 2603"`. |
| `description` | Inbox `upstreamModelDescription`, provider copy, or docs | Use the upstream value as factual source material, then rewrite it per [`model-descriptions.md`](model-descriptions.md). Never copy it blindly. |
| `total_parameters` | "XB-parameter model" | **RAW integer parameter count — NOT billions.** e.g. `1000000000000` for a 1T model, `109000000000` for a 109B model. Entering the billions shorthand (`100`) makes the UI render a near-zero value (`0.0000001B`). |
| `active_parameters` | MoE specs | Active params only, as a **RAW integer** — e.g. `32000000000` for 32B active. Set alongside `total_parameters` for MoE. |
| `context_length` | Spec | In tokens |
| `max_completion_tokens` | Spec ("Max Output") | Set on the **endpoint**, not the model |
| `input_modalities` | Spec | `["text"]`, `["text","image"]`, etc. |
| `output_modalities` | Spec | Almost always `["text"]` |
| `supports_reasoning` | Spec / feature list | Set on both model and endpoint if true |
| `group` | Model family | **Required** — pick from ModelGroup enum |
| `knowledge_cutoff` | Docs | ISO date string, or null |

**Writing the description**: If the provider gave you any copy or spec, always write a description — don't skip it and don't wait to be asked. When staging from a provider-monitor alert, fetch the matching `GET /inbox` entry first and inspect its optional `upstreamModelDescription`. Treat that value as factual guidance, not finished catalog copy, and rewrite it per [`model-descriptions.md`](model-descriptions.md). Follow the model-description style guide:
- Open with the model name and who made it
- One or two short paragraphs in markdown
- Include: modalities, key capabilities, use cases, parameter count, notable technical traits
- Avoid: "SOTA", "latest", "cutting-edge", vague superlatives, benchmark comparisons that go stale
- Include data-logging/privacy notices verbatim if the provider stated them (they're user-relevant)
- **Do not mention pricing** in descriptions — pricing is surfaced separately in the UI

---

### Step 1: Build All Payloads and Get Approval (REQUIRED)

> ⚠️ **Hard stop — do NOT call any write APIs until the user confirms.** This step is mandatory every time, no exceptions.

Using the checklist above, assemble the **complete** JSON payloads for every operation you're about to perform: model creation, endpoint creation, and pricing.

**Step 1 prerequisite — settle visibility before building payloads.** When the launch date is in the future, ask the requester whether they want the model callable for testing before launch (private, which means the endpoint is cloned public at launch, see [`guardrails.md`](guardrails.md) → Permaslug date suffixes) or hidden-only until launch. For internal prelaunch testing the grant defaults to the OpenRouter organization (see [`private-models.md`](private-models.md) → Step 2: Verify access entities); only ask for a Clerk ID when the tester is someone else. The answer sets `is_private` and `private_access_grants` on the model and endpoint payloads, so it has to land in the payloads the requester approves, never as an add-on after approval.

**Step 1a — Post all three payloads for review**, each with its provenance, in a message separate from the confirmation question:

- `POST /models` — slug, permaslug, name, group, context length, modalities, parameter counts, description.
- `POST /endpoints` — model permaslug, provider slug, variant, and every provider-specific field.
- `POST /pricing-versions` — the SKU keys discovered from the strategy schema or a live sibling, never from memory.

**Step 1b — Ask for confirmation**, noting that model, endpoint, and pricing are all created with `hidden: true`. The question must restate the launch date and the dated permaslug on their own line with the date's source (`launch date: 2026-09-30 (from Dimitri's message in the thread) → permaslug: voyageai/rerank-3-20260930`) so the requester is confirming the date, not only the payload shape. If the payloads are private, restate the exact grant on its own line too. Offer create / cancel / edit first.

**Wait for the response before proceeding.** On "edit first", incorporate the feedback, re-post the payloads, and ask again.

### Step 2: Create the Model

Only proceed here after receiving explicit approval in Step 1. Include description, parameter counts, and all other available fields directly in the `POST /models` body — there's no reason to do a separate PATCH afterward if you have the data now.

After creation, post the model editor URL using the **complete permaslug**, including the author prefix and date suffix:

```text
https://internal.openrouter.ai/model/edit/{full-permaslug}
```

For example, the permaslug `recraft/recraft-v4.1-20260514` maps to `https://internal.openrouter.ai/model/edit/recraft/recraft-v4.1-20260514`. Do not use the clean public slug when it differs from the permaslug.

```typescript
const model: DBModelInsert = {
  slug: "meta-llama/llama-4-scout",
  permaslug: "meta-llama/llama-4-scout",
  name: "Llama 4 Scout",
  description: "Llama 4 Scout is a sparse mixture-of-experts model from Meta...",
  group: "Llama4",
  context_length: 10000000,
  input_modalities: ["text", "image"],
  output_modalities: ["text"],
  supports_reasoning: false,
  total_parameters: 109000000000, // RAW integer, not billions — 109B
  active_parameters: 17000000000,  // RAW integer, not billions — 17B active
  features: {},
  default_parameters: {},
  hidden: false,
};
```

- `group` is **required** — model creation fails without it.
- `permaslug` defaults to `slug` if not provided.
- Author `meta-llama` will be auto-created if it doesn't exist.
- Only include fields you have data for — don't invent values.

### Step 3: Create Endpoint(s)

```typescript
const endpoint: DBEndpointInsert = {
  model_permaslug: "meta-llama/llama-4-scout",
  provider_slug: "together",              // URL-friendly slug; server resolves to provider_name
  variant: "standard",                    // See Variants section
  provider_model_id: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
  quantization: "bf16",
  supports_reasoning: false,
  features: {
    supports_tool_choice: {
      literal_none: true,
      literal_auto: true,
      literal_required: true,
      type_function: true,
    },
  },
  additional_parameters: ["tools", "tool_choice"],
  hidden: false,
};

const pricingJson = {
  "openai:prompt_tokens": "0.00000018",
  "openai:completion_tokens": "0.00000086",
};
```

### Step 4: Verify Configuration

After creation, the endpoint constructor (`packages/routing/endpoints/constructor.ts` → `initEndpointFromDb`) will:
1. Resolve the provider and apply any `provider_overrides`
2. Parse `features` JSON via `EndpointFeaturesSchema`
3. Determine the adapter (from provider or override)
4. Compute supported parameters from provider defaults + additional - excluded
5. Calculate pricing (from the latest pricing version)

---
