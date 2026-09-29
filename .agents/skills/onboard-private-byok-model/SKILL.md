---
name: onboard-private-byok-model
description: Onboard a customer's dedicated/self-hosted model deployment as a private, BYOK-only endpoint on OpenRouter — visible only to their org, authenticated with their own provider key. Covers the two-layer model (private-access ACL vs BYOK upstream auth), the info to collect, the setup + grant + pricing steps, the ZDR / data-policy override rules (ops set the override with evidence, unverified deployments default to retaining), and a failure-mode decoder for the two look-alike 404s. Use when a customer wants a dedicated deployment (any provider) routed privately through OpenRouter, or asks for it to count as ZDR.
user-invocable: true
---

# Onboard a Private BYOK Model

Get a customer's dedicated model deployment (any provider — a
dedicated/self-hosted inference endpoint) available **privately**
through OpenRouter: visible only to their org, and authenticated
with **their own** provider key (BYOK).

This is a **data/ops config task**, not a code change. Almost every
delay on these comes from the same handful of gotchas — this skill
front-loads them.

For the Buddy API mechanics behind each step — payloads, the
preview/apply contract, private-access-grant replacement semantics,
BYOK reference pricing — see [`buddy`](../buddy/SKILL.md), in
particular
[`references/private-endpoints.md`](../buddy/references/private-endpoints.md)
and [`references/guardrails.md`](../buddy/references/guardrails.md).

## The one concept to internalize: two independent layers

Customers (and operators) constantly conflate these. Keep them
separate:

| Layer | What it controls | Mechanism |
|-------|------------------|-----------|
| **1. Access control** | Who can *see / select / route to* the endpoint | Private endpoint + `private_endpoint_access` grant to the customer's entity |
| **2. Upstream auth** | How OpenRouter *authenticates to the customer's deployment* | The customer's **BYOK** provider key |

A private slug still needs a BYOK key. The slug controls *visibility*;
the key controls *upstream authentication*. "Only my account can hit
this custom model" is layer 1 — it does **not** remove the need for a
key (layer 2).

**Identity must line up across three places for it to route:** the
entity the model is *granted* to = the entity the *request runs as* =
the entity that *owns the BYOK key*. Any mismatch → the endpoint is
filtered out at routing time.

- Request made with an **org** API key → grant on the org + BYOK key
  saved on the org.
- Request made with a **personal** API key → grant on the user + BYOK
  key saved on that user.
- Don't mix (org grant + personal key, or vice versa) — that mismatch
  is the single most common cause of "No endpoints found".

## Info to collect from the customer

Ask up front — don't discover these mid-setup:

1. **Deployment base URL** + which **provider** it's on.
2. **Exact model value** the deployment expects in the request `model`
   field (the *upstream* model ID — often different from the OpenRouter
   slug).
3. **Model details:** context length, input/output modalities,
   reasoning support, tool/function-calling support, quantization.
4. **Which OpenRouter entity** gets access — the **org ID** (`org_...`)
   or a specific user ID — and whether it's whole-org or specific API
   keys.
5. **Pricing intent** — public rate, custom, or pass-through.
6. **ZDR status and evidence.** Does the customer need this endpoint to qualify under a ZDR guardrail or `provider.zdr: true`? If yes, collect the three evidence items listed under "Evidence before classification" before creating the endpoint. Without them the endpoint stays classified as retaining.

Do **not** ask them to paste the provider API key in Slack/chat. It
goes into encrypted BYOK storage via the dashboard, entered by them.

## Setup steps

### 1. Validate the deployment directly, first

Before touching any OpenRouter config, curl the deployment itself and
confirm it returns a real completion on the OpenAI-compatible
chat-completions path (`<baseUrl>/chat/completions`). Don't trust the
customer's docs — test the actual URL + key.

- **Expect a cold start.** First request to an idle dedicated
  deployment can take **1–2 minutes** (sometimes more); subsequent
  requests are fast. A slow first call is *not* a failure — don't
  mistake it for a hang or a bad URL.
- Also hit `<baseUrl>/models` to confirm the exact model value the
  deployment serves — this is what goes in `provider_model_id`.
- **Env limitation:** the shared provider key may be a **prod-only**
  secret (e.g. not readable from a dev-scoped agent box). If you can't
  read it, the human runs the curl locally. Never paste the key into
  chat/Slack — share only the HTTP status/output.

### 2. Create the endpoint (start hidden)

Create a private endpoint on the model (mirror an existing private
endpoint of the same provider as a template — check
`postgres/seeds/endpoints_rows.csv` for a current prod example):

- `is_private: true`
- `is_byok_only: true`
- `hidden: true` (until validated)
- `provider_overrides.baseUrl` = the deployment base URL (stop at the
  OpenAI-compatible root, e.g. `.../sync/v1` — the Baseten/OpenAI
  adapter appends `/chat/completions`; see
  `packages/providers/configs/provider-url.ts`)
- correct `provider_model_id` (the upstream model value from step 1)
- context length override, quantization, and **excluded params**
  (e.g. drop `tools`/`tool_choice` if the model doesn't support tool
  calling)
- verify the endpoint's effective
  `context_length_override ?? model.context_length` is positive before
  testing or unhiding it (image-generation endpoints use the runtime default).
- **Data Policy Override** (Mission Control endpoint editor select,
  `override_datapolicy_id`): select **Trains, retains, and publishes**
  unless you hold the ZDR evidence, in which case select `ZDR`. Never
  leave it at **None (use provider default)** and never copy a public
  endpoint's override. Rules and reasons: "Data policy and ZDR
  classification" below.

Do **not** create a new model when an existing one already represents
it — add the private endpoint to the existing model.

### 3. Grant access

Add the customer's entity to `private_endpoint_access`.

- ⚠️ **Copy-paste the entity ID and eyeball ambiguous characters** —
  `0` vs `O`, `1` vs `l`. A one-character typo produces a grant that
  points at a non-existent entity: the endpoint looks configured but
  the customer gets no access. (This has bitten real onboardings more
  than once.)
- `private_endpoint_access.entity_id` has a **foreign key to
  `users(clerk_user_id)`**. Orgs live in that `users` table too, as
  billing entities (at request time the lookup keys off
  `entityId = orgId ?? userId`). A `..._entity_id_fkey` violation means
  the value isn't a registered entity — fix the ID, don't force it.

### 4. Customer saves their own BYOK key

The customer adds their provider key in **Settings → Integrations**
**while their org is selected** in the switcher (for an org-scoped
setup).

- "Provider **enabled/allowed**" ≠ "key **saved**." Enabling the
  provider in the allowlist does not store a key — the actual key
  value must be saved on the same entity as the grant.
- If the key has **allowed-models** or **allowed-API-keys**
  restrictions, they must include this model and the API key being
  used (or be unset), or routing drops the endpoint.

We never handle or store the customer's key, and we generally **can't
run the end-to-end test ourselves** (it's their key on their org) —
that's expected and correct.

### 5. Pricing

Set the endpoint's per-token price (commonly the public rate for the
model).

- Under BYOK the per-token price is **logging-only** — it feeds
  `upstream_inference_cost`, **not** what the customer is charged.
- What the customer is actually charged in OpenRouter credits is the
  **BYOK fee** (a fraction of upstream). "Pass-through" = BYOK fee
  waived to 0. The provider bills the customer directly (e.g. by
  GPU-hour) for the dedicated deployment.
- Source of truth: `packages/pricing/get-byok-cost.ts` and
  `packages/payments/fee.ts` — check current values, don't hard-code.

### 6. Unhide and hand off

- Unhide the model + endpoint (confirm `hidden: false` on both).
- Share the private model URL (`https://openrouter.ai/private/<slug>`).
- Tell the customer to test with an API key **from the entity that has
  the grant + the saved key**, and warn about the ~1–2 min cold start
  on the first call.

## Data policy and ZDR classification

A private endpoint is judged by its **own** effective data policy: the endpoint's `override_datapolicy_id` row if set, else the provider's default policy (`packages/routing/endpoints/constructor.ts`, `getRetainsPromptsForEndpoint`). `retains_prompts = false` is what makes it ZDR for both the account/guardrail ZDR flags and a request's `provider.zdr: true` (`packages/db/endpoints/zdr.ts`). Being private changes none of that.

**Why "None" is unsafe.** None inherits the provider's default, and many providers (Azure, Amazon Bedrock, Google Vertex, Together, Groq, and others) default to the shared `ZDR` row, so an unset override classifies an unverified deployment as ZDR. A public endpoint's override says nothing about the customer's deployment either.

**Why "Trains, retains, and publishes" is the unverified default.** It is the only row that fails closed on every dimension the routing and guardrail filters read (`retains_prompts`, `training`, `can_publish`). A "no training" or "no publishing" row would admit an unverified deployment under `data_collection: 'deny'`, the no-training guardrails, or the publication guardrail.

**Who sets what.** Today only ops can set the override. Self-service private deployments created through the dashboard are stamped with "Trains, retains, and publishes" at creation (`packages/private-endpoints/management-handler.ts`, `UNVERIFIED_DEPLOYMENT_DATA_POLICY_ID`) and do not copy the blueprint's override. That stamp is the system's unverified default, not an ops classification: the only ops decision is whether evidence supports selecting the `ZDR` row (or a customer-specific row). A customer-facing ZDR declaration for private endpoints is planned (ECO-3935) with precedence explicit Mission Control override, then customer declaration, then the unverified default. The stamped row and an ops-selected "Trains, retains, and publishes" are the same `override_datapolicy_id`; `endpoints_changelog.editor` (the customer's Clerk user for a self-service stamp, the operator's for a Mission Control edit) tells them apart.

**BYOK key declaration.** The customer's `provider_api_keys.declared_zdr` covers shared endpoints on any provider. On a private endpoint the row's own effective policy is authoritative, so a key declaration never makes an unverified private deployment ZDR.

### Evidence before classification

Set the `ZDR` override only when you hold, and have linked in the ticket, all of: the deployment-level retention setting (screenshot or config export), the contract / DPA clause guaranteeing zero retention for this deployment, and a named customer attestation with a date. A provider being "ZDR in general" is not evidence for a customer-hosted deployment on that provider. If you cannot get all three, set the override to "Trains, retains, and publishes" (never None) and tell the customer the endpoint will not pass ZDR gates. Evidence is tied to a specific deployment configuration: if the customer later changes the deployment's base URL or upstream model id, the classification must be re-verified (today nothing resets it automatically).

### Never edit the shared ZDR row

`override_datapolicy_id` points at a row in `data_policies`. The `ZDR` row (`postgres/seeds/data_policies_rows.csv`) is shared by dozens of public endpoints. Editing its `retains_prompts`, name, or retention days reclassifies every endpoint referencing it at once. If a customer's terms differ from plain "no retention" (for example a bounded retention window), create a new `data_policies` row for that customer in the Mission Control data-policy page and select that row instead.

### Which guardrail flag gates it: model author, not provider

Per-provider ZDR flags (`enforce_zdr_anthropic`, `enforce_zdr_openai`, `enforce_zdr_google`, `enforce_zdr_xai`, `enforce_zdr_other`) bucket an endpoint by the **model's author slug**, not by the serving provider (`packages/guardrails/helpers/get-zdr-provider-bucket.ts`). A private `openai/gpt-4o` served from the customer's Azure or Ollama deployment is gated by `enforce_zdr_openai`; a private `acme/custom-finetune` served by OpenAI is gated by `enforce_zdr_other`. When a customer says "ZDR is on but my private model still routes / still 404s", check which bucket their model author lands in before checking the override.

### Where the override is inert

- **Video output models** are always treated as retaining, even with the ZDR override (async video jobs require the provider to keep the output). Do not promise ZDR on a private video endpoint.
- **`:batch` endpoints** are refused outright under any enforced ZDR bucket regardless of data policy (`services/batch-api/src/submit/accept/batch-privacy.ts`). A ZDR override on a private batch row does nothing.

### Propagation delay

Private endpoint rows are read through the Hyperdrive-cached connection (`packages/db/endpoints/hydrated-queries.ts`) and the customer's grants are cached with their API-key auth context. After changing the override or the grant, wait several minutes before asking the customer to retest; the first request after a change can still see the old classification.

### Audit attribution

Every change to `endpoints` is recorded in `endpoints_changelog`, but the `editor` column is taken from the row's `last_edited_clerk_user_id`. Make the change in the Mission Control editor, which sets it. If you must use SQL, set `last_edited_clerk_user_id` in the same `UPDATE`; otherwise the changelog attributes your change to whoever edited the row last:

```sql
UPDATE endpoints
SET override_datapolicy_id = '<data_policies.id>',
    last_edited_clerk_user_id = '<your clerk user id>'
WHERE id = '<endpoint id>';
```

### How the customer verifies

After the propagation delay above has passed, have the customer send a normal request from the granted entity's API key with `"provider": { "zdr": true }` in the body, then compare the endpoint that actually served it. A test sent immediately after changing the override can still hit the old classification and produce a false-negative 404 or a public serve. A classified private endpoint is **eligible and ordered first**, but that is not a guarantee: it still needs a matching BYOK key (private endpoints are BYOK-only), and other hard gates still apply. If the private row is not classified ZDR it is silently dropped by the ZDR gate and a public ZDR endpoint for the same model may serve instead, so a successful response alone proves nothing. Check the successful attempt's endpoint id in the generation view (or `provider_responses` on `GET /api/v1/generation`) and confirm it is the private endpoint's id. The request fails with `No endpoints found matching your data policy (Zero data retention)` only when no ZDR-eligible endpoint remains for that model. A ZDR guardrail on the account or key behaves the same way, with a `guardrail restrictions and data policy` 404 instead.

## Troubleshooting: two 404s that look identical

| Error | Origin | Meaning | Where to look |
|-------|--------|---------|---------------|
| `No endpoints found for <slug>` | OpenRouter routing | Endpoint filtered out of routing | Hidden? BYOK key missing/mismatched-identity? Key model/API-key restrictions? (`packages/routing/endpoints/add-byok-endpoints.ts`) |
| `No endpoints found matching your data policy (Zero data retention)` or `... guardrail restrictions and data policy` | OpenRouter routing | Endpoint is not classified ZDR but the request or account requires it | `override_datapolicy_id` pointing at a retaining policy (for example "Trains, retains, and publishes")? Wrong author bucket (`enforce_zdr_*`)? Video or `:batch` row? Propagation delay? See "Data policy and ZDR classification" |
| `not a valid model ID` | OpenRouter | Model doesn't resolve for the caller | Grant not on the request's identity, or wrong slug |
| `please check the model_id or environment` (or similar) | **Upstream provider** | Wrong deployment / model value / environment, or the key's account can't see that deployment | Curl the deployment directly to reproduce |

Rule of thumb: if the error text comes back with the *provider's*
wording, it's upstream (layer 2 / their side). If it's OpenRouter's
wording, it's routing/access (layer 1 / our side). **Curl the
deployment directly** to tell them apart — OpenRouter grants have zero
effect on a direct upstream call.

### Endpoint keeps re-hiding on its own

The provider-monitor auto-hide cron reconciles endpoints against each
provider's **public** model catalog and hides anything it thinks was
"removed." A private/dedicated deployment is never in the public
catalog, so it gets re-hidden every run. This was generalized-fixed by
skipping `is_private` endpoints in the monitor
(`packages/provider-monitors/classes/base/index.ts`, PR #29410). If an
endpoint won't stay visible, confirm that fix is deployed, then unhide
once.

## What OpenRouter cannot do for the customer

State these plainly so expectations are right:

- Operators make the Mission Control edits (behind SSO) — an agent
  can't.
- We can't run the authenticated end-to-end test — it's the customer's
  key on their org. Guide them to run it; decode the result.

## Improve this skill

If an onboarding hit a gotcha this skill didn't predict (a new routing
filter, a different upstream 404 shape, a provider whose base-URL
suffix differs, a pricing edge case), add one line here anchored to a
file path or PR number. Keep entries at the "what to check" level.
