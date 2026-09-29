# Buddy API Reference

Full reference for every Buddy internal API route used to create and update providers, models, and endpoints. Load it when you need the exact request/response schema for a specific route. The route implementations in `services/cfw-internal/src/routes/buddy-api/` are authoritative when they disagree with this file.

## Buddy API (Create & Update Providers, Models, and Endpoints)

The internal Buddy API provides programmatic endpoints for creating and updating providers, models, and endpoints. These are the primary APIs an agent should use.

**Base URL**: `https://openrouter.ai/api/v1/internal/buddy`

**Authentication**: Bearer token via `Authorization` header using the `BUDDY_API_KEY` environment variable.

> ⚠️ **Security**: Never log or output the value of `BUDDY_API_KEY` or any other secret env var. Reference it only as `$BUDDY_API_KEY` or `${BUDDY_API_KEY}` in commands.

```bash
curl -X POST https://openrouter.ai/api/v1/internal/buddy/models \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "X-Buddy-Actor-Email: approver@openrouter.ai" \
  -H "X-Buddy-Batch-Id: llama-4-scout-2026-09-22-1430" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

**Actor**: `X-Buddy-Actor-Email` carries the OpenRouter email of the human whose approval authorizes the change: the person who approved the preview, who is the requester only when they approved their own request. Buddy derives it from the Slack user who gave the approval; Devin and other agents set it to that person's OpenRouter email directly, never the agent's own address. When someone else requested the change, name them in `internal_note` — the header identifies the approver, not the requester. Catalog mutations (models, model-author, endpoints, providers, pricing versions, version groups, hide, model unhide, duplicate, reset created_at, baseline-unhide and capability-test automation) use it two ways:

- **Authorization**: `apply: true` is only accepted when the email is on the catalog-editor allowlist in `packages/providers/configs/catalog-editors.ts`. A missing, malformed, or unlisted email gets `403` and nothing is written. Previews (`apply` omitted or `false`) and read-only routes do not require it. Adding someone to the list is a reviewed PR to that file.
- **Attribution**: the email is resolved to a user and stamped on `last_edited_clerk_user_id` / `created_by_clerk_user_id` and the provider-monitor Slack editor; an unknown email falls back to Buddy's own user.

Arena, example curation, test-cache clearing, and `/test-endpoint` are not gated and still attribute to Buddy.

**Batch id**: `X-Buddy-Batch-Id: <token>` is mandatory on every `apply: true` to a catalog mutation (models, model-author, endpoints, providers, pricing versions, version groups, hide, model unhide, duplicate, reset created_at), to the `baseline-unhide` and `capability-test` automations, and on every call to the Arena bulk routes (`/arena-eval-runs`, `/arena-eval-runs/publish`, `/arena-model-backfill`). It is optional on previews. A missing or malformed token is refused with `400` before anything is written. The worker enforces the shape `<job>-<YYYY-MM-DD>-<HHMM>` with the UTC start time (`hide-deepinfra-2026-09-17-1430`), an optional `-<N>` sequence of one or two digits, and at most 64 characters in total, where `<job>` is `[A-Za-z0-9._-]` starting alphanumeric. A date-only or ticket-only id is refused. One id names one job for one agent and one family. Nothing checks that an id is new or that its time is current: a reused id continues the earlier batch's chunk state for 24 hours after its last apply or check-in (7 days once stopped), so the `HHMM` suffix is what keeps two same-day jobs apart (a second job in the same minute appends a sequence number, `-1430-2`). Applies on a batch land in fixed chunks (`catalog_apply` 10, `endpoint_automation` 5, `arena_bulk` 1, `/arena-eval-runs/publish` exempt). A full chunk refuses further applies with `429` plus `Retry-After` while the family wait runs (5 minutes, 10 for Arena), `428` once the wait has passed without a check-in, `423` on a batch stopped by its last check-in, and `503` when the batch gate is unavailable. Separately, the per-agent per-minute budget (10 catalog applies, 5 automation applies, 2 Arena calls) returns `429` with `Retry-After: 60`. The check-in route is [below](#post-apiv1internalbuddybulk-batchesbatchidcheck-in). Budgets, chunk waits, check-in verdicts, break glass, and the Datadog queries are specified in [bulk-operations.md](bulk-operations.md); read it before any write loop, a single write included.

**Source code**: `services/cfw-internal/src/routes/buddy-api/` **Auth middleware**: `services/cfw-internal/src/middlewares/buddy-auth.ts` **Catalog-editor gate**: `services/cfw-internal/src/routes/buddy-api/catalog-editor-gate.ts`

### The universal `apply` contract (safe-by-default writes)

**Every mutation route in the Buddy API is preview-by-default.** All of them — `PATCH /endpoint/{id}`, `PATCH /provider/{slug}`, `PATCH /model/{author}/{slug}`, `PATCH /model-author/{slug}`, `POST /providers`, `POST /endpoints`, `POST /models`, `POST /pricing-versions`, `POST /model-version-groups`, `POST /model/{author}/{slug}/unhide`, `POST /endpoint/{id}/hide`, `POST /endpoint/{id}/test-cache/clear`, plus the `baseline-unhide` and `capability-test` automations — accept an optional boolean `apply` field in the request body:

- **`apply` omitted or `false`** → **preview**. Nothing is written. The response is:
  ```json
  {
    "applied": false,
    "preview": {
      "current": { ... },          // the existing row (update routes only)
      "proposed": { ... },         // the validated, filtered payload that WOULD be written
      "diff": { "field": { "from": ..., "to": ... } },  // update routes only
      "stripped_fields": ["hidden"]  // fields the server discarded (blocklist/allowlist/server-side overrides)
    }
  }
  ```
- **`apply: true`** → **commit**. The write happens and the response is `{ "applied": true, "data": { ... }, "stripped_fields": [...] }`.

`stripped_fields` is the load-bearing part: it surfaces fields the server silently drops (e.g. `hidden` on `PATCH /endpoint`, non-allowlisted provider fields) **before** you write, instead of after.

**Mandatory write loop for every mutation:**

1. Call the route with the payload and **no `apply`** (or `apply: false`) → get the preview.
2. Render the preview for the human as `field: from → to` lines, and call out anything in `stripped_fields`.
3. Get explicit human confirmation — always, and especially for destructive routes (`pricing-versions`, `hide`, provider PATCH).
4. Re-send the **same call with `apply: true`** and an `X-Buddy-Batch-Id` header (see **Batch id** above; a bare apply is refused with `400`).
5. Verify with the matching GET route (`GET /endpoint/{id}`, `GET /provider/{slug}`, `GET /model-author/{slug}`, `GET /models`, `GET /endpoint/{id}/pricing-versions`).

> ⚠️ A bare `PATCH`/`POST` **no longer writes** — it returns a preview. If a response comes back `"applied": false` when you meant to write, you forgot `apply: true`. There is no way to mutate prod by accident.

### Capability-field validation and enum escalation

Endpoint create and update routes validate `supported_video_parameters` and `supported_image_parameters`. Model create and update routes validate `supported_tts_parameters`. A schema mismatch returns `400` with a `capability_issues` array that identifies the invalid field and value.

If the provider supports a rejected value, the serving enum lacks that value. Report the exact `capability_issues` to the launch thread. Request a Devin adapter PR that extends the relevant serving enum. Wait for the change to deploy, and then re-stage the resource. **Never drop the supported value or omit the field to make validation pass.**

The validator lives at `services/cfw-internal/src/routes/buddy-api/validate-capability-fields.ts`. Video parameter schemas and enums live in `packages/db/endpoints/index.ts` and `packages/enums/video-parameters.ts`.

### POST /api/v1/internal/buddy/models

Creates a new model with `hidden: true`. The `author_id` is resolved automatically from the permaslug prefix. Follows the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes): omitting `apply` returns a preview of the row that would be inserted; `apply: true` commits.

**Request body**: optional `apply` boolean, plus all fields from `DBModelInsert` except `author_id` and `hidden` (both set server-side and reported in `stripped_fields` if supplied).

```json
{
  "slug": "meta-llama/llama-4-scout",
  "permaslug": "meta-llama/llama-4-scout",
  "name": "Llama 4 Scout",
  "description": "Meta's Llama 4 Scout model.",
  "group": "Llama4",
  "context_length": 10000000,
  "input_modalities": ["text", "image"],
  "output_modalities": ["text"],
  "supports_reasoning": false,
  "features": {},
  "default_parameters": { "temperature": 0.7 }
}
```

**Required fields**: `slug`, `group` (enforced by `insertModel` at `packages/db/models/queries.ts`). See [Model Database Fields](staging-reference.md#model-database-fields) for all available fields.

**Response** (with `apply: true`): `201 Created` with `{ "applied": true, "data": <created model object>, "stripped_fields": [...] }`

**Errors**:
- `400` — Invalid request body or missing required fields (e.g., `group`)
- `401` — Missing or invalid `Authorization` header

### PATCH /api/v1/internal/buddy/model/{author}/{modelSlug}

Updates an existing model's fields. Only send the fields you want to change — omitted fields are left as-is (true patch semantics). Follows the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes): omitting `apply` returns a preview; `apply: true` writes and returns `{ "applied": true, "data": <updated model>, "stripped_fields": [...] }`.

> **Note**: The route uses `/model/` (singular) and takes `{author}/{permaslug-suffix}` as the path — i.e., the full permaslug split at the first `/`. For models whose slug equals the permaslug (e.g. `anthropic/claude-3.5-sonnet`), either form works. For models with a date-suffixed permaslug, you **must** use the permaslug — the public slug will return 404.
>
> ```
> ✅ /model/anthropic/claude-3.5-sonnet         ← slug == permaslug, works
> ✅ /model/recraft/recraft-v4.1-20260514       ← permaslug, works
> ❌ /model/recraft/recraft-v4.1                ← slug only, returns 404
> ```

```bash
curl -X PATCH https://openrouter.ai/api/v1/internal/buddy/model/anthropic/claude-3.5-sonnet \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "context_length": 200000,
    "supports_reasoning": true,
    "features": {
      "reasoning_config": {
        "start_token": "<think>",
        "end_token": "</think>"
      }
    }
  }'
```

**Mutable fields**: Any model field except the blocked ones below. Common update targets:
- `name`, `description`, `group`, `context_length`
- `input_modalities`, `output_modalities`
- `supports_reasoning`, `features` (reasoning_config, chat_template_config)
- `default_parameters`, `default_order`
- `warning_message`, `promotion_message`, `routing_error_message`
- `knowledge_cutoff`, `hf_slug`, `instruct_type`

**Always-blocked fields** (stripped server-side and reported in `stripped_fields` — see `ALWAYS_EXCLUDED_FIELDS` in `services/cfw-internal/src/routes/buddy-api/update-model.ts`):
- `slug`, `deleted`, `author_id`, `last_edited_clerk_user_id`

**Conditional privacy, visibility, and grant fields**:
- `is_private` can change only while the model is **currently hidden**. A requested change on a currently visible model is stripped.
- `hidden` can change in either direction only when the **resulting model is private**. A public model cannot be hidden or unhidden through PATCH. To unhide any model, public or private, without touching its ACL, use [`POST /model/{author}/{modelSlug}/unhide`](#post-apiv1internalbuddymodelauthormodelslugunhide).
- `private_access_grants` is accepted only when the resulting model is private and uses **replacement semantics**: send the complete desired ACL as `[{ "entity_id": "user_…" }, { "entity_id": "org_…" }]`. Omitted entities lose access.
- A visible private model must retain at least one grant. Unhiding it with no effective grants, or replacing its ACL with an empty list while visible, returns `400`.
- Prefer one request when privatizing, granting access, and unhiding a hidden model so the preview shows the complete resulting state:

```json
{
  "is_private": true,
  "hidden": false,
  "private_access_grants": [
    { "entity_id": "user_…" },
    { "entity_id": "org_…" }
  ]
}
```

Disallowed `is_private`/`hidden` transitions appear in `stripped_fields`; invalid grant combinations return `400`. Grant/resource writes are ordered defensively, but are not one database transaction, so a `500` may occur after an earlier write has committed. Re-read the resource after any apply failure before retrying.

**Response**: `200 OK` — preview by default; `{ "applied": true, "data": <updated model object>, "stripped_fields": [...] }` with `apply: true`

**Errors**:
- `400` — Invalid field values
- `401` — Missing or invalid `Authorization` header
- `404` — Model not found

### POST /api/v1/internal/buddy/model/{author}/{modelSlug}/unhide

Unhide a model, public or private. Sets `hidden: false` on the model row only. Endpoints keep their own visibility, so a staged model's public endpoint still goes through [`baseline-unhide`](#post-apiv1internalbuddyendpointendpointidautomationbaseline-unhide) afterwards (that automation is blocked with `model_hidden` until the parent model is visible, which is what this route is for). No tests and no eligibility gates: unhiding a model exposes its page and slug, not a provider deployment. A private model surfaces only to the entities in its `private_access_grants`, which the preview lists so the approver sees exactly who gains access.

> ⚠️ The hidden-endpoint auto-delete cron skips a hidden endpoint while its parent model is hidden and for 30 days after the model is unhidden. Past that window, an endpoint hidden for 30+ days is eligible for deletion, so run `baseline-unhide` within 30 days of this route.

> **Authoritative source**: [`services/cfw-internal/src/routes/buddy-api/unhide-model.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/services/cfw-internal/src/routes/buddy-api/unhide-model.ts).

The path takes the full permaslug split at the first `/`, the same as model PATCH.

```bash
# Preview (default) — current vs proposed hidden state, nothing written
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/model/${AUTHOR}/${MODEL_SLUG}/unhide" \
  -H "Authorization: Bearer $BUDDY_API_KEY"

# Commit
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/model/${AUTHOR}/${MODEL_SLUG}/unhide" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Buddy-Actor-Email: $APPROVER_EMAIL" \
  -H "X-Buddy-Batch-Id: unhide-kev-4b-2026-09-24-1500" \
  -d '{"apply": true}'
```

**Request**: optional body `{"apply": true}` to commit (the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes)). No body / `apply: false` returns `{ "applied": false, "preview": { "current": { "permaslug", "hidden", "is_private", "private_access_grants" }, "proposed": { "hidden": false }, ... } }`. `private_access_grants: [{ "entity_id" }, ...]` is the ACL that stays in force after the unhide, and is always `[]` for a public model.

**Response with `apply: true` (`200 OK`)**: `{ "applied": true, "data": { "permaslug": "<permaslug>", "hidden": false } }`. Idempotent: returns 200 without a DB write when the model is already visible.

**Behavior notes**:

- Approval gated like every other unhide: `apply: true` requires an approved catalog editor (`X-Buddy-Actor-Email` or Devin OIDC requester) and a batch id, and the preview must be shown to a human who approves it explicitly before the apply. Never self-apply.
- Private models keep their existing grants untouched. A private model with **no** grants is refused with `400` on preview and apply (the same invariant model PATCH enforces): grant access first with `PATCH /model/{author}/{modelSlug}` and `private_access_grants`, or unhide and grant in one PATCH.
- Attribution: `last_edited_clerk_user_id` is set to the resolved actor, the same as the hide route and the automations.
- Triggers a catalog refresh, so the public slug resolves once the refresh lands. For a private model it also republishes the private catalog for the granted entities.

**Errors**:
- `400` — Private model with no access grants, or malformed body
- `5xx` — Model, grant, or update DB failure (status forwarded from the failing query)
- `401` — Missing or invalid `Authorization` header
- `403` — `apply: true` from an actor who is not an approved catalog editor
- `404` — Model not found

### POST /api/v1/internal/buddy/model-version-groups

Creates a **model version group** (a model "family") and, by default, the hidden `~author/family-latest` Router alias that resolves to the newest concrete member of the group. **This is the route to use when asked to "create a new `~latest` model for X"** (e.g. "make a `~anthropic/claude-fable-latest`").

A version group's whole purpose is to back a `~latest` alias — and a `~latest` alias with no members is useless (it has nothing to resolve to, producing the live `No concrete target model found in version group` error). So this route **requires a `source_model_permaslug`**: the concrete model to associate with the group as its first member. It atomically (1) creates the group, (2) sets that model's `model_version_group_id` to the new group, and (3) creates the hidden `~latest` alias inheriting the source model's capability fields.

> **Mental model**: "create a `~latest` for the Claude Fable family" = create the **group** (`anthropic/claude-fable`) + point a concrete member (`anthropic/claude-5-fable-20260609`) at it + spawn the hidden alias (`~anthropic/claude-fable-latest`). All three happen in one call.

**Source code**: `services/cfw-internal/src/routes/buddy-api/create-model-version-group.ts`

**Required fields**: `source_model_permaslug`

**Default name and slug are derived from the source model, version-free.** Omit `name` and `slug` and the route derives them from the source model: `name` is the source model's display name with release tokens removed (`OpenAI: GPT-5.6 Terra` -> `OpenAI: GPT Terra`, `Google: Gemini 2.5 Pro` -> `Google: Gemini Pro`, `xAI: Grok 4.6 20260810` -> `xAI: Grok`), and `slug` is `<source permaslug author>/<slugified family>` (`openai/gpt-terra`). A release token is purely numeric (`5.6`, `6`, `20260810`) or a single capital letter or `v` plus a number (`K3`, `V4`, `R1`, `M2.5`, `v0.3`), so `MoonshotAI: Kimi K3` -> `MoonshotAI: Kimi`, `DeepSeek: DeepSeek V4 Flash 0731` -> `DeepSeek: DeepSeek Flash`, and `DeepSeek: R1 Distill Qwen 7B` -> `DeepSeek: Distill Qwen 7B`. When dropping every such token would leave the family empty, only the purely numeric ones are dropped (`Perplexity: R1 1776` -> `Perplexity: R1`). Tokens with more letters (`405B`, `A22B`, `4o`, `o3`, `Qwen3`) are family or size names and kept. Always preview first and read the derived `group.name` / `group.slug`, and pass an explicit `name` and/or `slug` only when the derivation is wrong for the family. Explicit values are used verbatim, versions included.

**Alias naming convention.** The alias model's `name` is `<name> Latest` and its default `description` is `This model always redirects to the latest model in the <Family> family.`, where `<Family>` is the part of `name` after `<Author>: `. A `~latest` alias names a family, never a release, so neither the group name nor the alias should carry a version number or date. When passing `name` explicitly, use `<Author>: <Family>` (e.g. `Anthropic: Claude Fable`, `OpenAI: GPT Sol`) so the alias is named `Anthropic: Claude Fable Latest`, matching every other model card. A `name` without the `<Author>: ` prefix is used verbatim in the description (`...in the Anthropic Claude Fable family.`). Pass `description` only when the default wording is wrong for the family.

The same convention applies when creating a `~latest` alias directly via `POST /models`: name it `<Author>: <Family> Latest` (no version) and describe it with the family only.

```bash
curl -X POST https://openrouter.ai/api/v1/internal/buddy/model-version-groups \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "apply": true,
    "source_model_permaslug": "anthropic/claude-5-fable-20260609"
  }'
```

With a source model named `Anthropic: Claude 5 Fable`, this creates the group `Anthropic: Claude Fable` / `anthropic/claude-fable` and the alias `~anthropic/claude-fable-latest`. Omit `apply` first to preview the group/alias that would be created (the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes)).

**Request fields**:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string (1–100) | no | Human-readable label shown in the version-group dropdown, and the stem of the alias model's name. Defaults to the source model's name with numeric version/date tokens removed. When set, use `<Author>: <Family>` with no version (e.g. `Anthropic: Claude Fable`). |
| `slug` | string (1–100) | no | Stable group identifier in `author/family` form (e.g. `anthropic/claude-fable`). Defaults to `<source permaslug author>/<slugified family of name>`. When `create_alias_model` is true, must be `author/family` shape so the generated `~author/family-latest` alias is a valid tilde-latest slug. `-latest` is appended automatically — **do not** include it yourself. |
| `source_model_permaslug` | string | yes | Permaslug of the concrete model to associate as the group's first member. Its `model_version_group_id` is set to the new group, and (when `create_alias_model` is true) the alias inherits its capability fields (modalities, features, context length, defaults, reasoning support). |
| `create_alias_model` | boolean | no (default `true`) | Also create the `~author/family-latest` Router alias model. |
| `hide_alias_model` | boolean | no (default `true`) | Whether the generated `~latest` alias is hidden. A hidden source + hidden alias is a valid "stage a family before launch" state — resolution filters `!hidden` at request time, so it starts resolving once a member is unhidden. |
| `description` | string (1–1000) | no | Description for the `~latest` alias model. Defaults to `This model always redirects to the latest model in the <Family> family.` when omitted, where `<Family>` is `name` without its `<Author>: ` prefix (see the naming convention above). |

**Response** (with `apply: true`): `201 Created`

```json
{
  "applied": true,
  "data": {
    "group": { "id": "<uuid>", "name": "Anthropic: Claude Fable", "slug": "anthropic/claude-fable" },
    "source_model": { "permaslug": "anthropic/claude-5-fable-20260609", "model_version_group_id": "<uuid>" },
    "alias_model": { "slug": "anthropic/claude-fable-latest", "permaslug": "anthropic/claude-fable-latest" }
  }
}
```

`alias_model` is `null` when `create_alias_model` is `false`.

**Preconditions / guardrails** (the route enforces these *before* creating the group, so a rejection leaves no orphaned group behind):

- The **source model must already exist** — create it first via `POST /models` if needed (it'll be `hidden: true`, which is fine; see the hidden-source note above). A missing source model returns `404`.
- The source model **must not already belong to a version group** — reassigning it would orphan the previous group's `~latest`. Returns `409`. To move it deliberately, clear its `model_version_group_id` first (or pick a different source).
- The source model **must not be a Router alias** (`group === Router`) — Router aliases are excluded from `~latest` resolution, so they can never be a resolution target. Returns `400`. Use a concrete provider model.

**Errors**:
- `400` — Invalid request body, `slug` not in `author/family` form (when creating an alias), a derived slug that is not URL-safe (the message asks for an explicit `slug`), or a Router-alias source.
- `401` — Missing or invalid `Authorization` header.
- `404` — Source model not found.
- `409` — Source model already belongs to a version group.
- `500` — **The group was created** but a later step (associating the source model, or creating the alias) failed. The response metadata carries `group_id` (and `group_slug`, `alias_slug`) so you **do not recreate the group** — retrying the POST would `400` on the unique-slug constraint. Instead, finish the failed step manually: complete the association via `PATCH /api/v1/internal/buddy/model/{author}/{modelSlug}` with `{ "model_version_group_id": "<group_id>" }`, and/or create the alias model via `POST /models`.

> **Typical flow when asked "create a `~latest` for `<model>`":**
> 1. Confirm the concrete source model exists (`GET /models`, filter by permaslug). If not, create it first via `POST /models`.
> 2. `POST /model-version-groups` with `name` (`<Author>: <Family>`), `slug` (`author/family`, no `-latest`), and `source_model_permaslug`. Omit `description` unless the default wording is wrong for the family.
> 3. Verify the response: `source_model.model_version_group_id` is set and `alias_model.slug` is the expected `~author/family-latest`.

### PATCH /api/v1/internal/buddy/endpoint/{endpointId}

Updates an existing endpoint's fields. Only send the fields you want to change — omitted fields are left as-is (true patch semantics). Follows the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes): omitting `apply` returns a preview with `current`/`proposed`/`diff`/`stripped_fields`; `apply: true` writes and returns `{ "applied": true, "data": <updated endpoint>, "stripped_fields": [...] }`.

> **Note**: The route uses `/endpoint/` (singular) and takes the endpoint UUID as the path parameter — e.g., `/endpoint/8661a1db-b0cf-4eb2-ba04-c2a79f698682`.

```bash
curl -X PATCH https://openrouter.ai/api/v1/internal/buddy/endpoint/8661a1db-b0cf-4eb2-ba04-c2a79f698682 \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "deprecation_date": "2026-04-20T13:00:00Z"
  }'
```

> ⚠️ **`deprecation_date` is a full ISO 8601 timestamp with hour-level granularity.** When the
> user gives only a calendar date (no time of day), **default the time to `13:00 UTC`** — early
> in the US East Coast working day, so someone is around to catch fallout. Only deviate when the
> user specifies a time/timezone explicitly. See [`guardrails.md`](guardrails.md) → Deprecation dates.

**Mutable fields**: Any endpoint field except the always-blocked ones below. Common update targets:
- `deprecation_date` — ISO 8601 timestamp after which the endpoint is auto-hidden. Supports hour-level granularity; default the time to `13:00 UTC` when the user gives only a date (see [`guardrails.md`](guardrails.md) → Deprecation dates)
- `is_disabled`, `is_deranked`, `is_byok_only`
- `context_length_override`, `max_prompt_tokens`, `max_completion_tokens`
- `limit_rpm`, `limit_rpd`, `capacity_tpm`
- `features`, `additional_parameters`, `excluded_parameters`
- `supports_reasoning`, `quantization`
- `internal_note`, `provider_region`
- `provider_overrides` — the whole JSON object (`displayName`, `slug`, `baseUrl`, `pricingStrategy`, `adapterName`, …). Patch semantics stop at the column: the object you send replaces the stored one, so to change or drop one key, `GET` the endpoint, edit that key in the returned object, and send the full object back. Confirm in the preview diff that every other key is unchanged. There is no optimistic-concurrency check, so an edit made between preview and apply is overwritten: re-read the endpoint immediately before `apply: true`, and if `provider_overrides` differs from the previewed `current`, preview again and get fresh approval. Dropping `displayName` makes the endpoint fall back to the provider's default display name.

**Always-blocked fields** (stripped server-side):
- `id`, `deleted`, `created_at`, `updated_at`, `provider_name`, `model_permaslug`, `last_edited_clerk_user_id`, `first_unhidden_at`

> ⚠️ **`internal_note` is writable, which makes it easy to destroy.** A PATCH replaces the existing note outright, so never include it in a request whose purpose is something else. Send it only when a human asked for the new text, and show them the old and new values in the preview. See [`guardrails.md`](guardrails.md) → `internal_note`.

**Conditional privacy, visibility, and grant fields**:
- `is_private` can change only while the endpoint is **currently hidden**. A requested change on a currently visible endpoint is stripped.
- `hidden` can change in either direction only when the **resulting endpoint is private**. For public endpoints, PATCH strips `hidden`: use `baseline-unhide` to test and expose one, and the dedicated hide route for an urgent takedown.
- `private_access_grants` is accepted only when the resulting endpoint is private and uses **replacement semantics**: send the complete desired ACL as `[{ "entity_id": "user_…" }, { "entity_id": "org_…" }]`. Omitted entities lose access.
- A visible private endpoint must retain at least one grant. Unhiding it with no effective grants, or replacing its ACL with an empty list while visible, returns `400`.
- `is_byok_only` remains independently configurable. Privatizing an existing endpoint does not implicitly change it; explicitly preview and set the intended value rather than assuming the private-create default.
- Prefer one request when privatizing, granting access, and unhiding a hidden endpoint:

```json
{
  "is_private": true,
  "hidden": false,
  "private_access_grants": [
    { "entity_id": "user_…" },
    { "entity_id": "org_…" }
  ],
  "is_byok_only": false
}
```

Disallowed `is_private`/`hidden` transitions appear in `stripped_fields`; invalid grant combinations return `400`. Grant/resource writes are ordered defensively, but are not one database transaction, so a `500` may occur after an earlier write has committed. Re-read the endpoint after any apply failure before retrying.

> ⚠️ **`additional_parameters` and `features` should not be patched manually for testable capabilities** (`tools`, `tool_choice`, `response_format`, `structured_outputs`, `top_logprobs`/`logprobs`). Use the dedicated **capability-test automation route** (`POST /api/v1/internal/buddy/endpoint/{endpointId}/automation/capability-test`) — it runs the actual capability tests against the live provider and only persists params/feature flags that pass. Hand-editing risks attaching params the provider doesn't actually support, which then surface as user-side request errors.

> ⚠️ **Preview + approval are mandatory before this PATCH (and every model/endpoint
> write).** No matter how direct the instruction ("just set X", "fix the hf_slug"),
> first post a preview of the exact change (`field: old → new`, the endpoint/model
> name + UUID, and the Mission Control link), then get explicit
> human approval before committing. The server enforces the first half: the same
> call without `apply: true` returns exactly this preview (`diff` + `stripped_fields`).
> This applies to model-field writes (e.g.
> `hf_slug`), endpoint PATCH, deprecation, hide/unhide, and pricing alike. A "fix
> it" instruction is not a substitute for the approval gate. Always surface the
> Mission Control link on the operation. See
> [`guardrails.md`](guardrails.md) → Preview gate.

**Response**: `200 OK` — preview by default; `{ "applied": true, "data": <updated endpoint object>, "stripped_fields": [...] }` with `apply: true`

**Errors**:
- `400` — Invalid field values
- `401` — Missing or invalid `Authorization` header
- `404` — Endpoint not found

#### Frozen identity fields on an exposed endpoint

Once an endpoint has been unhidden even one time (`first_unhidden_at` is not null), three fields freeze for the rest of its life: `variant`, `is_private`, and `service_tier`. The database enforces this with the `endpoint_identity_immutability` trigger, so no caller can get around it.

A PATCH that tries to change `variant` or `service_tier` on such an endpoint is not an error. The route strips the field and reports it in `stripped_fields`, so the call returns `200` and the value stays the same. Read `stripped_fields` on every preview instead of assuming the change applied. `is_private` is gated by the privacy rules above (it needs a currently hidden endpoint) and then by the same trigger. Writing a field its current value is always a no-op, and `fast` and `priority` count as the same tier.

The fields freeze so per-endpoint statistics stay separated by endpoint id. To change one, clone the endpoint with the [duplicate route](#post-apiv1internalbuddyendpointendpointidduplicate) below and give the clone the new identity.

### POST /api/v1/internal/buddy/endpoint/{endpointId}/duplicate

Creates a hidden copy of an existing endpoint under a fresh id. Use it when a frozen identity field must change on an already-exposed endpoint, or when you need a second row that differs only by uniqueness-key fields (for example a region-specific copy beside a global one).

The clone is written in one transaction and copies:

- every column of the source row, with the accepted overrides applied
- the source's **currently effective** pricing version
- the source's private-access grants, **only when the clone is private**
- the source's `internal_note` (see the note below on the exact text)

The clone always starts `hidden: true` with `first_unhidden_at` unset, so it is inert until you activate it. The source row is never modified.

Follows the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes): omit `apply` to preview the insert the route would perform; send `apply: true` to commit.

```bash
# Preview (default) — nothing written
curl -X POST https://openrouter.ai/api/v1/internal/buddy/endpoint/8661a1db-b0cf-4eb2-ba04-c2a79f698682/duplicate \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "service_tier": "priority" }'

# Commit — only after posting the preview and getting explicit human approval
curl -X POST https://openrouter.ai/api/v1/internal/buddy/endpoint/8661a1db-b0cf-4eb2-ba04-c2a79f698682/duplicate \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "service_tier": "priority", "apply": true }'
```

**Accepted body fields** — `apply` plus these four overrides, and nothing else:

| Field | Notes |
|---|---|
| `variant` | Frozen identity field. Same enum as endpoint creation. |
| `is_private` | Frozen identity field. When the clone is private it inherits the source's access grants. |
| `service_tier` | Frozen identity field. Nullable. `fast` and `priority` are respellings of one tier and count as unchanged. |
| `provider_region` | Not frozen — it stays editable through PATCH — but it participates in `endpoints_public_unique_key`, so a region-only clone is valid. |

Any other field in the body is ignored and returned in `stripped_fields`. To change anything else on the clone, compose duplicate + `PATCH /endpoint/{id}` on the new id, which stays fully editable while it is hidden.

**At least one accepted override must change the resulting identity.** An exact copy returns `400` because it would either collide with `endpoints_public_unique_key` or silently create a real duplicate row. `provider_region` compares with `COALESCE(provider_region, '')` semantics, so `null` and `""` are the same value — sending `""` against a null-region source does not count as a change.

> ⚠️ **Confirm the live contract with one preview call before planning a region clone.** Deployed builds have differed on whether `provider_region` is an accepted override; a build that does not accept it silently drops the field, so a region-only request fails the exact-copy guard with `400` and `"Duplicate must change at least one of variant, is_private, or service_tier"`. A build that accepts it returns `200` with `provider_region` set in `preview.proposed`. Never work around a stale build by flipping a frozen field and patching it back: `variant`, `is_private`, and `service_tier` cannot be patched on an exposed row, so the clone would keep the wrong identity permanently.

> ⚠️ **Check the `internal_note` text in `preview.proposed`.** The current route copies the source note verbatim; older builds appended `" (copy)"`. A clone inherits the source's attribution, which is now wrong — PATCH the clone's note to your own `staged by <agent> for <requester>` once it exists, and tell the human the wording before applying.

> ⚠️ **Preview + approval are mandatory**, exactly as for endpoint PATCH: post the preview (the clone's proposed identity, the source endpoint UUID, and the Mission Control link), then get explicit human approval before sending `apply: true`. See [`guardrails.md`](guardrails.md) → Preview gate. Report the new endpoint id and its Mission Control URL after every successful apply.

**Mission Control equivalent**: the **Duplicate Endpoint** dialog on `https://internal.openrouter.ai/endpoint/edit/{endpointId}`. It offers the same overrides — including a Provider Region text input, where an empty value means "no region" (`null`). The dialog clones the **saved** row, so unsaved form edits are not carried into the copy.

**Response**: `200 OK` with `{ "applied": false, "preview": { ... } }` by default; `201 Created` with `{ "applied": true, "stripped_fields": [...], "data": { "endpoint": <new endpoint> } }` with `apply: true`

**Errors**:
- `400` — Overrides leave the identity unchanged (exact copy), or invalid field values
- `401` — Missing or invalid `Authorization` header
- `404` — Source endpoint not found
- `409` — The clone's identity collides with an existing endpoint

### Typical Public Endpoint Activation Flow: baseline-unhide → capability-test

This flow applies to **public endpoints**. Private endpoints have a separate direct-unhide path documented below and in [`private-endpoints.md`](private-endpoints.md).

When activating a freshly-staged public endpoint (or recovering one that was hidden), the canonical sequence is:

1. **Run `baseline-unhide`** (dry run, then apply) to get the endpoint visible. It runs baseline tests, evaluates eligibility gates, and only flips `hidden: false` when every gate passes. The unhide update payload now only sets `hidden: false` — it does **not** strip testable sampling params from `additional_parameters` or clear `endpoint_test_cache` rows.
2. **Run `capability-test`** for any params the user wants verified to actually test the provider, then re-apply the params and feature flags that pass. This is the same logic the capability-automation cron uses, just on demand for one endpoint.

For a public endpoint, step 1 is mandatory before routing traffic. Step 2 is what the capability cron normally does in the background; running it on demand is appropriate when the user wants a specific endpoint's params verified now rather than waiting for the next cron pass.

### Final launch gate for image and video models

Follow [`launch-examples.md`](launch-examples.md) for the final image or video launch gate. It owns these routes:

- `POST /api/v1/internal/buddy/image-example/request`
- `POST /api/v1/internal/buddy/image-example/finalize`
- `POST /api/v1/internal/buddy/video-example/request`
- `POST /api/v1/internal/buddy/video-example/finalize`
- `POST /api/v1/internal/buddy/model-example/{exampleId}/approve`
- `POST /api/v1/internal/buddy/model-example/{exampleId}/reject`

It also owns paid-call approval, public API submission, video polling, media review, and the human curation decision.

Do not use provider-direct generation or internal Model Examples batch routes as launch-gate evidence.

### Private endpoint direct unhide — no baseline tests required

When an endpoint is **already private** and has at least one effective access grant, unhide it with the ordinary endpoint PATCH instead of `baseline-unhide`:

```bash
curl -X PATCH "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"hidden": false}'
```

Follow the universal preview/apply contract: first omit `apply` and render the exact diff, confirm that `is_private` remains `true`, grants remain effective, and `stripped_fields` is empty; surface the endpoint Mission Control link and get explicit human approval in a separate message; then repeat with `"apply": true` and verify via `GET /endpoint/{endpointId}`. Do **not** run baseline tests merely to unhide an already-private endpoint. The privacy guardrail limits direct visibility changes to resources whose resulting state is private, so the endpoint remains inaccessible to entities outside its grants.

If the endpoint is public, or the request is to make a public endpoint routable, use `baseline-unhide`; do not use direct PATCH as a way around public activation gates.

You do **not** need to clear the test cache before either step. Both the Buddy `baseline-unhide` and `capability-test` routes always run their tests **fresh** against the live provider — they write cache entries but never read them to short-circuit (see `runEndpointBaselineAutomation` in `packages/provider-monitors/steps/baseline-automation.ts`, which calls the test runner unconditionally). A stale cached `failed`/`errored` result only short-circuits the **cron's** filter, not these on-demand routes. Clear the cache (`POST /endpoint/{id}/test-cache/clear`, documented below) only when you want to unblock the **cron's** next pass — not as a prerequisite for a manual retry.

If you want a specific set of capabilities verified after unhiding, run capability-test explicitly:

```bash
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}/automation/capability-test" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"apply": true, "capabilities": ["tools", "tool_choice"]}'
```

(Always `apply: false` first if you're not certain the user wants the endpoint mutated. See each route's section for full semantics.)

### POST /api/v1/internal/buddy/endpoint/{endpointId}/automation/baseline-unhide

Run the baseline-unhide automation for a **public endpoint**. This is the canonical way for an agent to expose a public endpoint programmatically — it runs baseline tests, evaluates eligibility gates, and only flips `hidden: false` when every gate passes. For an already-private endpoint with effective grants, use the direct PATCH flow above instead.

> **Authoritative source**: [`services/cfw-internal/src/routes/buddy-api/automation-baseline.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/services/cfw-internal/src/routes/buddy-api/automation-baseline.ts) and [`packages/provider-monitors/steps/baseline-automation-contract.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/provider-monitors/steps/baseline-automation-contract.ts). When in doubt, RTFC — read the actual source rather than trusting this doc.

```bash
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}/automation/baseline-unhide" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "apply": false }'
```

**Request body**:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `apply` | boolean | `false` | `false` = dry run: run baseline tests + eligibility gates, no DB mutation. `true` = if every gate passes, unhide the endpoint (sets `hidden: false` only). It no longer strips testable sampling params from `additional_parameters` or clears `endpoint_test_cache` rows — those side effects were removed once hidden endpoints stopped auto-running capability tests. |

> **Always start with `{"apply": false}`** unless the user has explicitly asked to unhide. Use the dry run to surface failures and blocked reasons before committing.

**Response (`200 OK`)** — `{ "data": <BaselineAutomationResponse> }`:

| Field | Type | Meaning |
|---|---|---|
| `endpointId` | string | Endpoint that automation ran against |
| `templates` | object[] | Baseline test templates selected for this endpoint |
| `status` | `"dry_run_passed"` \| `"succeeded"` \| `"blocked"` | Overall result (`BaselineAutomationStatus`). `dry_run_passed` = tests and all unhide gates passed but `apply` was `false`, so nothing changed. `succeeded` = the endpoint was actually unhidden (`didUnhide: true`, only possible with `apply: true`). `blocked` = not eligible; inspect `blockedReasons`, `blockedDetails`, and `nextActions`. |
| `didRunTests` | boolean | Whether baseline tests were executed |
| `baselineTestsPassed` | boolean? | Whether all executed tests passed (absent when no tests ran) |
| `didPassUnhideGates` | boolean | Whether tests **and** all eligibility gates passed |
| `didUnhide` | boolean | `true` only when the endpoint was actually flipped to `hidden: false`. The unhide only sets `hidden: false` — no param stripping, no test-cache clearing. |
| `autoUnhideDisabled` | boolean | Whether automated unhide is disabled for this endpoint |
| `blockedReasons` | string[] | Machine-readable reasons (see enum below). Use these to choose follow-up actions — don't scrape free text. |
| `blockedDetails` | object[] | `{ reason, category, nextAction }` per blocked reason. `category` is `real_defect` \| `data_integrity` \| `policy_exclusion` \| `automation_gap`; group by it when reporting. |
| `identityCollisionSiblingEndpointIds` | string[] | Hidden sibling endpoints that derive the same effective provider identity. Warning only; does not block unhide. |
| `testResults` | object[] | Every baseline test row (passed, failed, and errored): `{ template, status, error?, upstream_request_body? }`. See **`upstream_request_body`** below. |
| `failures` | object[] | Convenience view — `{ template, status, error? }` for each baseline test that failed or errored. **Does not** carry `upstream_request_body`; read it from `testResults[]` instead. |
| `nextActions` | string[] | Suggested follow-up steps for humans/agents |
| `didRequestTimeout` | boolean? | `true` when the tests exceeded the synchronous request budget. Tests may still finish in the background, but this request did not unhide anything. |
| `runId` | string? | Background run ID, present with `didRequestTimeout: true`, for polling the automation-run status route. |

**`upstream_request_body` (debugging aid)** — each row in the primary `testResults[]` array carries an optional `upstream_request_body`: the **redacted payload OpenRouter actually sent upstream** to the provider for that baseline test. Same body the public API exposes via `debug.echo_upstream_body`, run through the same redaction (allowed keys like `model`/`messages` preserved; foreign top-level keys replaced with `<included to upstream but not in debug info>`). Use it to debug a failing baseline test — confirm exactly what shape was forwarded upstream. It is:
> - **Present** on freshly executed tests — both passing results and provider-rejection failures (captured from `adapter.transformRequest()` before the provider responds).
> - **Absent** for cached results and for infrastructure errors that occur *before* the request is transformed (no payload was built).
> - **Not** present on the convenience `failures[]` rows — only on the primary `testResults[]` array.

**`blockedReasons` enum** (from `BaselineUnhideBlockedReason` in `packages/provider-monitors/steps/baseline-unhide-blocked-reason.ts`; per-reason `nextAction` copy lives in `baseline-unhide-blocked-copy.ts`):

| Value | Meaning |
|---|---|
| `model_hidden` | The parent model itself is `hidden: true` — unhide the model first |
| `unsupported_modality_or_no_baseline_tests` | No baseline tests apply for this endpoint's modality |
| `endpoint_already_visible` | Endpoint is already `hidden: false` — nothing to do |
| `baseline_unhide_excluded_model` | Model is excluded from automated unhide; an internal admin must run baseline-unhide manually (e.g. from Mission Control) |
| `missing_pricing` | Endpoint has no current pricing version |
| `zero_pricing` | Pricing version exists but every SKU is zero or invalid |
| `endpoint_deprecated` | Endpoint has a `deprecation_date` set |
| `baseline_tests_failed` | One or more baseline tests failed — see `failures[]` |
| `reasoning_effort_not_honored` | Reasoning-effort levels produced no detectable differentiation; check the upstream payload carries the effort parameter |
| `reasoning_effort_inconclusive` | Reasoning-effort comparison was inconclusive (output truncated at the token ceiling); a human reviews before unhiding |
| `provider_has_no_visible_endpoint` | Provider has no public endpoint yet; a human must unhide the first one manually |
| `provider_has_no_visible_paid_endpoint` | Provider has no public paid endpoint yet; a human must unhide the first paid one manually |
| `duplicate_variant_under_same_model` | Provider already has a visible endpoint for this model + variant; give this one a distinct quantization, region, or `provider_overrides.slug` |
| `endpoint_in_ignored_provider_models` | The provider model ID is in the provider's ignored-models list |
| `upstream_not_ready` | Provider's `/v1/models` reports `is_ready: false`; wait, then rerun |
| `automated_actor_not_allowed` | Manual baseline-unhide is reserved for human actors; automated actors use their own automation paths |
| `modality_auto_unhide_not_allowed` | The cron's modality allowlist (`isCronAutoUnhideAllowed` in `packages/provider-monitors/steps/cron-baseline-templates.ts`) denies auto-unhide for this modality even when tests pass. The Buddy route does not apply that allowlist, because every Buddy apply is catalog-editor gated, so Buddy can unhide any modality whose baseline tests pass. The gate is evaluated on dry runs too, so a dry run and an apply report the same outcome |

**Decision flow**:

1. **Default to dry run** — `{"apply": false}` first. A dry run can never return `succeeded`.
2. **If `status == "dry_run_passed"`**: report the dry-run result. If the user explicitly asked to unhide, re-call with `{"apply": true}`.
3. **If `status == "blocked"`**: do **not** manually flip `hidden` in Mission Control. Report `blockedReasons`, `blockedDetails`, and `nextActions` to the user/provider so the underlying issue gets fixed.
4. **If `status == "succeeded"`** (only after `apply: true`), the endpoint is live (`hidden: false`). The unhide no longer clears `endpoint_test_cache` or strips testable params — if you want specific capabilities verified now, run `capability-test` explicitly (which always tests fresh). To force baseline/capability crons to retest from scratch, clear the cache via `POST /endpoint/{id}/test-cache/clear`.

**Errors**:
- `400` — Invalid `endpointId` parameter or malformed body
- `401` — Missing or invalid `Authorization` header
- `404` — Endpoint not found
- `500` — Automation failed unexpectedly (transient — retry, or escalate)

### POST /api/v1/internal/buddy/endpoint/{endpointId}/hide

Hide a live endpoint — the inverse of `baseline-unhide`. Sets `hidden: true` on the endpoint so the router stops sending traffic to it. No tests, no eligibility gates — this is a simple, immediate flip for when an endpoint needs to come down (regression, provider outage, deprecation, accidental unhide, etc.).

> **Authoritative source**: [`services/cfw-internal/src/routes/buddy-api/hide-endpoint.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/services/cfw-internal/src/routes/buddy-api/hide-endpoint.ts). When in doubt, RTFC — read the actual source rather than trusting this doc.

```bash
# Preview (default) — shows current vs proposed hidden state, nothing written
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}/hide" \
  -H "Authorization: Bearer $BUDDY_API_KEY"

# Commit
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}/hide" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"apply": true}'
```

**Request**: optional body `{"apply": true}` to commit (the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes)). No body / `apply: false` returns a preview: `{ "applied": false, "preview": { "current": { "id", "hidden" }, "proposed": { "hidden": true }, ... } }`.

**Response with `apply: true` (`200 OK`)** — `{ "applied": true, "data": { "id": "<endpointId>", "hidden": true } }`. Idempotent: returns 200 immediately when the endpoint is already `hidden: true` (no DB write performed).

**Behavior notes**:

- The route resolves the endpoint via `EndpointVisibility.All`, so it works on already-hidden endpoints (idempotent fast path) as well as visible ones.
- Attribution: `last_edited_clerk_user_id` is set to the resolved actor (see [Actor](#buddy-api-create--update-providers-models-and-endpoints) above), the same as the `baseline-unhide` and `capability-test` automations, which run as Buddy but stamp the approving human as editor. The endpoint's `internal_note` is **not** modified by this route.
- No cache clearing is performed. `endpoint_test_cache` rows are left intact. This does not affect a follow-up on-demand `baseline-unhide`, which always runs fresh tests. Clear the cache only to unblock the cron's next pass.
- No tests are run. This is intentional — hiding is a safety / takedown action and shouldn't be gated on the provider being healthy.

**Decision flow**:

1. Call the route with no body → post the returned preview and confirm the user's intent (hiding takes the endpoint out of routing immediately).
2. State what will happen: "I'll hide endpoint `<id>` (`<provider> / <model_permaslug>`). This sets `hidden: true` immediately; the router will stop sending traffic. To bring it back, call `baseline-unhide` (which will retest)."
3. Re-call with `{"apply": true}`. Report the response.
4. If the user wants the endpoint to come back later, the canonical path is `baseline-unhide` (dry run, then apply) — not `PATCH /endpoint/{id}` with `hidden: false`, which is silently stripped.

**When to use this**:

- *User says "take this endpoint down" / "hide endpoint X" / "deprecate this endpoint"* — direct mapping.
- *User reports a live regression* — hide first, investigate after, unhide via `baseline-unhide` once fixed.
- *Cleaning up after a mistake* — e.g. an endpoint that was unhidden prematurely and now needs to come back down.

**When NOT to use this**:

- *To deactivate a freshly-staged endpoint* — endpoints created via the Buddy API are already `hidden: true`. No action needed.
- *As a substitute for setting `deprecation_date`* — for scheduled, dated take-downs, set `deprecation_date` via `PATCH /endpoint/{id}`. The auto-deprecation cron handles the eventual hide.

**Errors**:
- `400` — Missing `endpointId` parameter, or `updateEndpoint` failed (rare — DB write error)
- `401` — Missing or invalid `Authorization` header
- `404` — Endpoint not found
- `500` — Failed to fetch endpoint (transient — retry, or escalate)

### POST /api/v1/internal/buddy/endpoint/{endpointId}/automation/capability-test

Run the capability-test automation for one endpoint. This is the canonical way for an agent to test (and optionally apply) supported sampling parameters and feature flags — `tools`, `tool_choice`, `response_format`, `structured_outputs`, and `top_logprobs`/`logprobs` — against the live provider. It runs the same logic the capability-automation cron uses, just on demand for a single endpoint.

> **Authoritative source**: [`services/cfw-internal/src/routes/buddy-api/automation-capability.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/services/cfw-internal/src/routes/buddy-api/automation-capability.ts) and [`packages/provider-monitors/steps/capability-automation-contract.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/provider-monitors/steps/capability-automation-contract.ts). When in doubt, RTFC — read the actual source rather than trusting this doc.

**Typical flow**: this route most often runs *after* `baseline-unhide` has already unhidden the endpoint. See [Typical Public Endpoint Activation Flow](#typical-public-endpoint-activation-flow-baseline-unhide--capability-test) above for the canonical baseline-unhide → capability-test sequence and an example.

```bash
# Dry run — test specific capabilities, do not mutate the endpoint
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}/automation/capability-test" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"apply": false, "capabilities": ["tools", "tool_choice"]}'

# Dry run — let the route derive default capabilities from the endpoint's existing testable additional_parameters
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}/automation/capability-test" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'

# Apply — only after dry run looks good
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}/automation/capability-test" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"apply": true, "capabilities": ["tools", "tool_choice"]}'
```

**Request body** (all fields optional — empty body `{}` is valid):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `apply` | boolean | `false` | `false` = preview/run capability tests without updating the endpoint. `true` = run tests and, if any capabilities pass, update `additional_parameters` and/or feature flags accordingly. |
| `capabilities` | string[] | derived | Capability names to test. Valid values: `tools`, `tool_choice`, `response_format`, `structured_outputs`, `top_logprobs`. When omitted, the route verifies capabilities implied by the endpoint's existing testable `additional_parameters`. Pass explicitly when the user asks about specific parameters or when the endpoint has no existing testable params. |

> **Always start with `{"apply": false}`** unless the user has explicitly asked to update the endpoint. Use the dry run to surface failures and blocked reasons before committing.

> **On-demand runs always test fresh.** Unlike the cron, this route ignores `endpoint_test_cache` and runs every requested capability test against the provider live. Every result returns `fromCache: false`. If you need cached results, that's the cron's job — don't expect them here.

**Response (`200 OK`)** — `{ "data": <CapabilityAutomationResponse> }`:

| Field | Type | Meaning |
|---|---|---|
| `endpointId` | string | Endpoint that automation ran against |
| `status` | `"succeeded"` \| `"no_changes_needed"` \| `"blocked"` | Overall result. `succeeded` = capability updates were approved (dry-run can return this with `didUpdateEndpoint: false`). `no_changes_needed` = tests approved capabilities but the endpoint already reflected them. `blocked` = no approved updates were produced; inspect `blockedReasons` and `nextActions`. |
| `didRunTests` | boolean | Whether capability tests were actually executed |
| `didUpdateEndpoint` | boolean | Whether `additional_parameters` or `features` were mutated. `true` only when `apply: true` AND tests approved at least one update. |
| `approvedParams` | string[] | Sampling parameters approved by the tests (subset of `Parameter` enum) |
| `featureUpdates` | object | Endpoint feature updates approved by the tests. Notably contains `supports_tool_choice: { literal_auto, literal_none, literal_required, type_function }` flags when `tool_choice` is tested. May be non-empty even when `approvedParams` is empty (feature flags can be derived from capabilities already present). |
| `capabilitiesTested` | string[] | Capability names actually selected for testing after exclusions |
| `blockedReasons` | string[] | Machine-readable reasons (see enum below). Use these to choose follow-up actions — don't scrape free text. |
| `results` | object[] | Per-capability test results: `{ capability, allPassed, tests: [{ template, status, error?, fromCache?, error_count?, upstream_request_body? }] }`. See **`upstream_request_body`** below. |
| `failures` | object[] | Flattened convenience view: one row per non-passing test with `capability` plus the test details. **Does not** carry `upstream_request_body` — read it from the primary `results[].tests[]` rows instead. |
| `nextActions` | string[] | Suggested follow-up steps for humans/agents |

**`upstream_request_body` (debugging aid)** — each row in the primary `results[].tests[]` array carries an optional `upstream_request_body`: the **redacted payload OpenRouter actually sent upstream** to the provider for that test. It's the same body the public API surfaces via `debug.echo_upstream_body`, run through the same redaction (allowed keys like `model`/`messages` preserved; foreign top-level keys replaced with `<included to upstream but not in debug info>`). Use it to debug *why* a capability test failed — e.g. confirm whether `tools`/`tool_choice`/`response_format` were actually forwarded and in what shape. It is:
> - **Present** on freshly executed tests — both passing results and provider-rejection failures (the body is captured from `adapter.transformRequest()` before the provider responds).
> - **Absent** for cached results (on-demand runs always test fresh, so this is rare here) and for infrastructure errors that occur *before* the request is transformed (no payload was ever built).
> - **Not** present on the convenience `failures[]` rows — only on the primary `results[].tests[]` array.

**`blockedReasons` enum** (from `CapabilityAutomationBlockedReason`):

| Value | Meaning |
|---|---|
| `all_capabilities_excluded` | Every requested capability has at least one trigger param in `excluded_parameters`. Remove the exclusion before rerunning. |
| `no_testable_capabilities` | Either `capabilities: []` was passed, or no capabilities were derivable from the endpoint's `additional_parameters` (when `capabilities` was omitted). Pass capabilities explicitly. |
| `tests_failed` | One or more capability tests definitively failed — the provider does not appear to support the requested capability. Don't manually add the failed parameters; the underlying provider issue needs to be fixed first. See `failures[]` for specifics. |
| `no_approved_updates` | Tests ran but didn't produce any approvable updates (e.g. all errored without a definitive failure, or partial passes that don't satisfy required-test gates like `tool-choice-auto`). Review `failures[]` and `results[]` before rerunning. |

**Decision flow**:

1. **Default to dry run** — `{"apply": false}` first.
2. **If `status == "succeeded"`**: report the dry-run result. If the user explicitly asked to apply, re-call with `{"apply": true}` (same `capabilities` list).
3. **If `status == "no_changes_needed"`**: tests passed but the endpoint already reflects the approved capabilities. Tell the user nothing was needed — don't re-call with `apply: true`.
4. **If `status == "blocked"`**:
   - `tests_failed` → report the failures verbatim. Do **not** manually add the failed parameters via `PATCH /endpoint/{id}` as a workaround.
   - `no_approved_updates` → report the partial results so the user can decide whether to retry or escalate.
   - `all_capabilities_excluded` / `no_testable_capabilities` → report what's missing and ask the user how to proceed (typically: pass an explicit `capabilities` list, or remove an exclusion).
5. After an `apply: true` succeeds, the endpoint reflects the new `additional_parameters` and/or `features`. The capability cron will continue to monitor and adjust on its own schedule.

**Errors**:
- `400` — Invalid `endpointId` parameter or malformed body
- `401` — Missing or invalid `Authorization` header
- `404` — Endpoint not found (the route resolves visible/`Public` endpoints — call `baseline-unhide` first if the endpoint is still hidden)
- `500` — Automation failed unexpectedly (transient — retry, or escalate)

> **Performance / timeout note**: Each capability runs its required test templates 3 times for stability, with up to 2 capabilities tested concurrently. The route has a 120 s timeout. For `tool_choice` (4 base templates × 3 attempts = 12 runs) plus other capabilities, a "test everything" call against a slow provider can approach the limit. Prefer scoping `capabilities` to what the user actually asked about rather than testing all five.

### POST /api/v1/internal/buddy/test-endpoint

Run a **single** template test against one endpoint, with optional overrides for the request parameters and the endpoint config. Use this when a user asks something like *"run the yes-no test on endpoint X"* or *"run yes-no on endpoint X but set temperature to 2"*. Unlike `baseline-unhide` / `capability-test` (which run a fixed suite and can mutate the endpoint), this runs exactly one template and **never mutates anything** — it's a pure, read-only test.

> **Authoritative source**: [`services/cfw-internal/src/routes/buddy-api/test-endpoint.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/services/cfw-internal/src/routes/buddy-api/test-endpoint.ts), the core executor [`services/cfw-internal/src/utils/test-endpoint-core.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/services/cfw-internal/src/utils/test-endpoint-core.ts), and the request schema in [`packages/evals/templates/schemas.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/evals/templates/schemas.ts). When in doubt, RTFC.

```bash
# Run the yes-no template on an endpoint, overriding temperature to 2
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/test-endpoint" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "endpointId": "'"$ENDPOINT_ID"'",
    "template": "yes-no",
    "requestOverrides": { "temperature": 2 }
  }'
```

**Request body** (validated by `TestEndpointRequestSchema`):

| Field | Type | Required | Meaning |
|---|---|---|---|
| `endpointId` | string | yes | The endpoint to test against. |
| `template` | string | yes | Which template test to run, e.g. `yes-no`, `max-tokens`, `tool-call-step-1`. Valid values are the `TestTemplate` enum in [`packages/enums/test-template.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/enums/test-template.ts) (e.g. `yes-no`, `multi-turn`, `max-tokens`, `reasoning`, `tool-call-step-1`, `structured-output`, …). |
| `requestOverrides` | object | no | Per-parameter overrides merged into the test request, e.g. `{ "temperature": 2 }`, `{ "max_tokens": 100 }`, `{ "top_p": 0.1 }`. Any sampling parameter works. |
| `endpointOverrides` | object | no | Overrides applied to the endpoint config before the test runs (same shape as a `PATCH /endpoint` body). Use this to test against a tweaked endpoint without persisting the change. |

**Overrides reach the provider.** `requestOverrides` is threaded into every template config and merged via `mergeRequestOverrides` (`{ ...defaultInput, ...requestOverrides }`), so the override keys survive into the payload OpenRouter actually sends upstream. `{ "temperature": 2 }` really goes out as `temperature: 2`, even on endpoints that don't normally advertise that parameter.

**Response (`200 OK`)** — `{ "data": <TestOutputData> }`. The fields you'll care about most:

| Field | Meaning |
|---|---|
| `request` | The request that was actually run, with your overrides merged in. Check this to confirm an override landed (e.g. `request.temperature == 2`). |
| `upstreamRequestResult` | The exact payload forwarded to the provider (a `Result` — the same thing the public API exposes via `debug.echo_upstream_body`). The definitive confirmation that your override reached upstream. |
| `completion` | The model's text output. |
| `usage` | Token usage for the call. |
| `provider`, `url` | Which provider / URL served the request. |

(The full shape is `TestOutputData` in [`packages/evals/types.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/packages/evals/types.ts) — it also carries `permaslug`, `variant`, `finishReason`, `validatorResult`, `toolCalls`, etc. RTFC if you need a field that isn't listed here.)

**Errors**:
- `400` — Malformed body (bad/unknown `template`, missing `endpointId`, etc.)
- `401` — Missing or invalid `Authorization` header
- `500` — Test execution failed (transient — retry, or escalate)

**When to use this vs the automation routes**:
- *"run the `<template>` test on endpoint X"*, or any one-off test with custom params → **this route**.
- *"unhide endpoint X"* / *"test whether endpoint X supports tools"* → `baseline-unhide` / `capability-test` (they run the full suite and can apply changes).

### POST /api/v1/internal/buddy/endpoint/{endpointId}/test-cache/clear

Clear `endpoint_test_cache` rows for a single endpoint so baseline and capability automation can rerun tests against the live provider instead of reusing cached terminal results. Useful when a provider has fixed an upstream issue and the cron needs to retest from scratch — without this, cached `failed` or "exceeded max infra retries" entries continue to short-circuit the cron's filter.

> **Authoritative source**: [`services/cfw-internal/src/routes/buddy-api/clear-test-cache.ts`](https://github.com/OpenRouterTeam/openrouter-web/blob/main/services/cfw-internal/src/routes/buddy-api/clear-test-cache.ts). When in doubt, RTFC.

```bash
# Preview (default) — nothing cleared
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}/test-cache/clear" \
  -H "Authorization: Bearer $BUDDY_API_KEY"

# Commit
curl -X POST "https://openrouter.ai/api/v1/internal/buddy/endpoint/${ENDPOINT_ID}/test-cache/clear" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"apply": true}'
```

**Request**: endpoint is identified by the path parameter; optional body `{"apply": true}` to commit (the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes)). No body / `apply: false` returns a preview without clearing anything.

**Response with `apply: true` (`200 OK`)** — `{ "applied": true, "data": { "endpointId": "...", "didClearTestCache": true } }`. The `didClearTestCache` value is the literal `true` — there is no false response from this route (failures return non-200 errors instead).

**What gets cleared**: all rows in `endpoint_test_cache` for this endpoint. Historical `endpoint_test_runs` records are **preserved** — only the cache layer that automation reads from is reset.

> **Visibility difference vs the automation routes**: this route and `baseline-unhide` use `EndpointVisibility.All`, so both work on hidden endpoints. `capability-test` resolves endpoints with `EndpointVisibility.Public`, so run `baseline-unhide` first for a hidden public endpoint. On-demand automation runs fresh tests. Clear this cache only to unblock the cron's next pass.

**When to use this**:

- *After a provider rolls out a fix* — e.g. user reports "tool_choice now works on Together's Llama 4 Scout", but the capability cron keeps skipping it because the cache says `failed`. Clear the cache; the next cron pass (or an explicit `capability-test` call) will retest.
- *Recovering from a transient infra storm* — e.g. several tests cached as `errored` with `error_count` at the max-infra-error ceiling. Clearing the cache resets the retry budget.
- *Before a manual capability-test rerun where the cron's last result was `failed`* — though note that on-demand `capability-test` already runs fresh and ignores the cache, so this is mainly for cron-side retest behavior.

**When NOT to use this**:

- *Right after a `capability-test` finishes* — it writes fresh outcomes, so clearing again is redundant. (Note: `baseline-unhide` no longer clears the cache itself, so if you specifically want a fresh retest path after unhiding, clearing here is valid.)
- *To force-retest a passing capability* — passing entries are not "stuck"; they're correct. Clearing them just makes the cron redo work.

**Decision flow**:

1. Confirm the user's intent — clearing cache is rarely a first-line action; it's a recovery tool.
2. State what will happen: "I'll clear `endpoint_test_cache` for `<endpoint_id>`. The next baseline / capability cron run will retest from scratch. Historical `endpoint_test_runs` records are preserved."
3. Call the route with `{"apply": true}`. Report `didClearTestCache: true`.
4. If the user wants results *now* rather than waiting for the cron, follow up with an explicit `capability-test` call (and/or a `baseline-unhide` dry run if the endpoint is still hidden).

**Errors**:
- `400` — Invalid `endpointId` parameter
- `401` — Missing or invalid `Authorization` header
- `404` — Endpoint not found
- `500` — Cache delete failed (transient — retry, or escalate)

### POST /api/v1/internal/buddy/pricing-versions

Creates a new pricing version for an existing endpoint. The new version takes effect **immediately** upon creation.

> ⚠️ **IRREVERSIBLE via API**: There is no DELETE route for pricing versions. A mistake requires manual cleanup directly in the database. **Never probe this route with test payloads.** Only call it when you have a confirmed `endpoint_id` and a confirmed correct `pricing_json` with valid SKU keys.

> ⚠️ **NEVER hardcode SKU keys from memory or this doc.** SKU keys (`anthropic:prompt_tokens`, `openai:cached_prompt_tokens`, etc.) vary per provider, per model family, per modality, and change over time as new pricing dimensions are added or deprecated (e.g. `anthropic:cache_write_1h_tokens`, `anthropic:web_search_calls`). Always look them up via one of the two methods in "Discovering SKU keys" below — read the strategy schema in [`OpenRouterTeam/openrouter-web`](https://github.com/OpenRouterTeam/openrouter-web) (authoritative), or clone `pricing_json` from a live sibling endpoint. Any example SKU keys elsewhere in this doc are illustrative only and may already be stale.

**Required fields**: `endpoint_id`, `pricing_json`

```bash
curl -X POST https://openrouter.ai/api/v1/internal/buddy/pricing-versions \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "apply": true,
    "endpoint_id": "9ea0cd22-4494-4a94-9199-c83c992bdbe1",
    "pricing_json": { /* SKU keys discovered via Method A (strategy schema) or Method B (live clone) — see below */ }
  }'
```

Because this route is irreversible, **always preview first**: send the same body without `apply` — the response includes the validated `pricing_json` and the current pricing version it would supersede. Post that preview in the thread and confirm before re-sending with `apply: true`.

**Response** (with `apply: true`): `201 Created` with `{ "applied": true, "data": { "id": "<uuid>", "effective_at": "<timestamp>" } }`

> ⚠️ **ALL endpoints use SKU-based pricing** — there are no exceptions. Every endpoint, regardless of provider, must have pricing set via `POST /pricing-versions`. Never set pricing columns directly on an endpoint.

#### Discovering SKU keys (mandatory before every POST)

There are **two equally valid sources of truth** for the canonical SKU key set. Use either one (or both — they should agree); never hardcode keys from memory or this doc.

##### Method A — Read the strategy schema in `OpenRouterTeam/openrouter-web` (authoritative)

Each pricing strategy declares its full SKU key set as a Zod schema in `packages/pricing/strategies/<strategy>/skus.ts` in the [`OpenRouterTeam/openrouter-web` repo](https://github.com/OpenRouterTeam/openrouter-web). This is the **definitive** key set — it lists every SKU the strategy accepts, including optional ones (long-context tiers, cache tiers, multipliers, etc.) that may not appear in any single live endpoint's `pricing_json`.

Example for Anthropic (`packages/pricing/strategies/anthropic/skus.ts`):

```ts
export const AnthropicSKU = {
  PromptTokens: 'anthropic:prompt_tokens',
  PromptTokensLongContext: 'anthropic:prompt_tokens_long_context',
  CompletionTokens: 'anthropic:completion_tokens',
  CompletionTokensLongContext: 'anthropic:completion_tokens_long_context',
  CacheReadTokens: 'anthropic:cache_read_tokens',
  CacheReadTokensLongContext: 'anthropic:cache_read_tokens_long_context',
  CacheWrite5mTokens: 'anthropic:cache_write_5m_tokens',
  CacheWrite5mTokensLongContext: 'anthropic:cache_write_5m_tokens_long_context',
  CacheWrite1hTokens: 'anthropic:cache_write_1h_tokens',
  CacheWrite1hTokensLongContext: 'anthropic:cache_write_1h_tokens_long_context',
  WebSearchCalls: 'anthropic:web_search_calls',
  LongContextThreshold: 'anthropic:long_context_threshold',
} as const;

export const AnthropicPricingJsonSchema = z.object({
  [AnthropicSKU.PromptTokens]: BigNumberUnionNonNegativeSchema,
  [AnthropicSKU.CompletionTokens]: BigNumberUnionNonNegativeSchema,
  // ...optional fields elided
});
```

Look up the strategy directory matching the endpoint's `pricingStrategy` (e.g. `anthropic/`, `openai_chat_completions/`, `openai_responses/`, `mistral/`, `tts/`, `openai_stt/`, etc.) and read its `skus.ts` to get the full key set and which keys are required vs optional.

##### Method B — Clone `pricing_json` from a live sibling endpoint

The authenticated buddy route returns the **raw `pricing_json`** for any endpoint — hidden or visible — including its exact SKU keys with values. Useful when you want a working pattern to copy.

Resolve the source/sibling endpoint's UUID (via `find-endpoint` or `GET /endpoints`), then:

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  "https://openrouter.ai/api/v1/internal/buddy/endpoint/<endpoint-uuid>" \
  | jq '.data.current_pricing_version.pricing_json'
```

See [`GET /endpoint/{endpointId}`](#get-apiv1internalbuddyendpointendpointid) below for the full response shape.

Example output (Anthropic Opus Fast):

```json
{
  "anthropic:prompt_tokens": "30e-6",
  "anthropic:completion_tokens": "150e-6",
  "anthropic:cache_read_tokens": "3e-6",
  "anthropic:cache_write_5m_tokens": "37.5e-6",
  "anthropic:cache_write_1h_tokens": "60e-6",
  "anthropic:web_search_calls": ".01"
}
```

Copy the **exact `pricing_json` key set** from the sibling, then substitute the new model's values. This copies the SKU structure only; it does **not** authorize inheriting endpoint-level commercial fields.

> ⚠️ **`discount_to_user` is non-inheritable.** It is an endpoint field, not part of `pricing_json`. When an older endpoint is used as a pricing or configuration reference for a new endpoint, omit `discount_to_user` so the new endpoint keeps its default of `0`. Include a non-zero value only when the human explicitly instructs you to apply that specific discount. In the stage preview, show `discount_to_user: 0 (not inherited from source)` as a separate endpoint line rather than burying it in the pricing JSON. After creation, re-read the hydrated endpoint and verify that no user discount was inherited.

Caveat: the live sibling only contains keys that endpoint actually uses — optional SKUs (e.g. `*_long_context` tiers) may be absent. If the new model needs an optional dimension that no sibling sets, fall back to Method A to find the right key.

> ⚠️ **The public `/api/v1/models/{slug}/endpoints` route returns *normalized* pricing** (`prompt`, `completion`, `input_cache_read`, etc.) and **drops the raw SKU keys**. It also only sees visible endpoints. Always use the buddy `GET /endpoint/{endpointId}` route for Method B — never the public model API, and not the public `/api/frontend/stats/endpoint` route (its cache excludes hidden endpoints).

##### Common rules for both methods

- Do not invent, abbreviate, rename, or omit required keys. Mission Control's pricing form populates from these specific SKU names; mismatched keys store fine in `pricing_versions` but render as blank fields in the UI and break the public-API pricing surface.
- The `pricing_strategy` can be overridden per-endpoint in `provider_overrides.pricingStrategy` (e.g., for multi-account providers) — the SKU key set follows whatever strategy is active on the endpoint.

**Errors**:
- `400` — Missing `endpoint_id` or `pricing_json`, or constraint violation
- `401` — Missing or invalid `Authorization` header

### POST /api/v1/internal/buddy/bulk-batches/{batchId}/check-in

Records a Datadog check-in for one bulk batch and opens its next chunk. Once a chunk on `{batchId}` is full, applies on that batch are refused (`429`, then `428`) until the family wait has passed since the last apply and this route has accepted a `continue`. Same credential as the writes; the check-in is tied to the calling agent and the batch's family. Full protocol, wait lengths, and what to compare in Datadog: [bulk-operations.md](bulk-operations.md#chunks-and-check-ins-server-enforced).

```bash
curl -X POST https://openrouter.ai/api/v1/internal/buddy/bulk-batches/llama-4-scout-2026-09-22-1430/check-in \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "family": "catalog_apply",
    "verdict": "continue",
    "signals": [
      { "name": "transaction_attempt.success_rate:deepinfra", "before": 0.994, "after": 0.993 },
      { "name": "endpoint_returned_error.count:deepinfra", "before": 12, "after": 14 }
    ]
  }'
```

**Request body**: `family` (`catalog_apply`, `endpoint_automation`, `arena_bulk`, must match the batch), `verdict` (`continue` or `stop`), `signals` (1 to 10 entries on `continue`, 0 to 10 on `stop`; each `name` is 1 to 80 characters from `[A-Za-z0-9._:/-]` naming the Datadog query compared, `before` and `after` are numbers or `null`).

**Response**: `200` with `{ "batch_id", "family", "chunk", "applies", "verdict", "next_chunk" }`. `next_chunk` is the chunk now open after a `continue` and `null` after a `stop`. A stopped batch id stays refused for seven days.

**Errors**:
- `400` — Malformed batch id or body
- `401` — Missing or invalid `Authorization` header
- `409` — `continue` on an empty chunk (nothing to check in on)
- `423` — The batch was already stopped
- `429` with `Retry-After` — `continue` before the family wait has elapsed since the last apply
- `503` — The batch gate is unavailable (fails closed, retry later)

### GET /api/v1/internal/buddy/inbox

Returns provider-monitor changes waiting in the Mission Control inbox. Use this route when a staging request refers to an inbox entry, or when the provider and `provider_model_id` identify a pending new or updated endpoint.

```bash
curl -s https://openrouter.ai/api/v1/internal/buddy/inbox \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  | jq '.data[] | select(.providerName == "StreamLake")'
```

For `new` and `updated` entries, the response may include an optional top-level `upstreamModelDescription` string alongside `id`, `providerName`, `type`, `changes`, and the other summary fields. It is the description reported by the provider's upstream `/models` listing.

**Treat `upstreamModelDescription` as source material, never as catalog-ready copy:**

- Read it before composing a new model description whenever the relevant inbox entry is available.
- Use it for factual guidance about positioning, strengths, and intended use cases.
- Rewrite it according to [`model-descriptions.md`](model-descriptions.md). Do not copy marketing claims, temporal language, stale benchmarks, or redundant structured specs verbatim.
- Do not apply it as an endpoint diff. It is read-only inspiration and is intentionally outside the inbox `changes` map.
- If the field is absent, continue with provider docs, the official announcement, or the model's Hugging Face page. Do not invent missing details.

This field is additive and optional. Until the corresponding `openrouter-web` change is deployed, inbox entries will simply omit it.

### GET /api/v1/internal/buddy/models

Returns all models in the catalog as `{ "data": [...] }`. No query-parameter filtering is supported — filter client-side with `jq`.

```bash
# Find a specific model by permaslug
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/models \
  | jq '.data[] | select(.permaslug == "anthropic/claude-3.5-sonnet")'

# Find all models by a given author
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/models \
  | jq '[.data[] | select(.permaslug | startswith("meta-llama/"))]'
```

**Key fields returned**: `permaslug`, `slug`, `name`, `description`, `group`, `context_length`, `input_modalities`, `output_modalities`, `supports_reasoning`, `features`, `hidden`, `deleted`.

> **Use this API** when you need to check if a model already exists or read its current fields before a PATCH.

---

### GET /api/v1/internal/buddy/endpoints

Returns all endpoints in the system as `{ "data": [...] }`. No query-parameter filtering is supported — filter client-side.

```bash
# Get all endpoints for a specific model
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints \
  | jq '[.data[] | select(.model_permaslug == "anthropic/claude-3.5-sonnet" and .deleted == false)]'

# Get a single endpoint by ID
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints \
  | jq '.data[] | select(.id == "your-endpoint-uuid")'

# Get all endpoints for a provider
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints \
  | jq '[.data[] | select(.provider_name == "Together" and .deleted == false)]'

# Find endpoints matching a provider_model_id pattern
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints \
  | jq '[.data[] | select(.provider_model_id // "" | test("llama-4"; "i"))]'
```

**Key fields returned**: all endpoint fields including `id`, `provider_name`, `model_permaslug`, `provider_model_id`, `variant`, `quantization`, `features`, `additional_parameters`, `supports_reasoning`, `context_length_override`, `max_completion_tokens`, `hidden`, `deleted`, `provider_overrides`.

> **Use this API** for endpoint lookups: read an existing config to clone, check what's already staged, or survey patterns across a provider.

---

### GET /api/v1/internal/buddy/endpoint/{endpointId}

Returns a single **hydrated** endpoint by UUID as `{ "data": {...} }` — the raw endpoint fields plus joined `models`, `providers`, `data_policies`, and `current_pricing_version`. Resolves with `EndpointVisibility.All` and no hidden filter, so it **works on hidden endpoints** (unlike `/api/frontend/stats/endpoint`).

```bash
# Get the current raw pricing_json + pricing version id for any endpoint (hidden or visible)
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoint/<endpoint-uuid> \
  | jq '.data.current_pricing_version | {id, effective_at, pricing_json}'
```

**Key fields returned**: all endpoint fields, plus `current_pricing_version` (`id`, `pricing_json`, `effective_at`, `created_at`, `created_by_clerk_user_id`; `null` if the endpoint has no effective pricing version yet), `models`, `providers`, `data_policies`.

> **Use this API** to read `pricing_json`/version info for a **hidden** endpoint (Method B source, or verifying pricing on a freshly staged endpoint), or whenever you already have the UUID and want the full hydrated view in one call. The `current_pricing_version` here is computed with an exact `now`, so a pricing version you just created via `POST /pricing-versions` shows up immediately.

**Errors**:
- `401` — Missing or invalid `Authorization` header
- `404` — No endpoint with that UUID (or it's deleted)

### GET /api/v1/internal/buddy/endpoint/{endpointId}/pricing-versions

Returns the **full pricing-version history** for an endpoint as `{ "data": [...] }`, newest first. No hidden filter — works on hidden endpoints.

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoint/<endpoint-uuid>/pricing-versions \
  | jq '.data[] | {id, effective_at, pricing_json}'
```

**Key fields returned** (per version): `id`, `endpoint_id`, `pricing_json`, `effective_at`, `created_at`, `created_by_clerk_user_id`.

> **Use this API** to audit pricing history, confirm a `POST /pricing-versions` landed, or find a version id for `GET /pricing-versions/{id}`.

**Errors**:
- `401` — Missing or invalid `Authorization` header
- `404` — No endpoint with that UUID (or it's deleted)

---

### GET /api/v1/internal/buddy/provider/{providerSlug}

Returns a single provider by slug as `{ "data": {...} }`. Uses the admin view: **hidden providers are included**, deleted ones are not.

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/provider/<provider-slug> \
  | jq '.data | {provider_name, permaslug, adapter_name, hidden, byok_enabled, supported_parameters}'
```

**Key fields returned**: all provider fields — `provider_name`, `display_name`, `permaslug`, `adapter_name`, `hidden`, capability flags (`has_chat_completions`, `supports_tool_calling`, `is_multipart_supported`, `supported_parameters`), compliance flags (`hipaa_compliant`, `iso27001_compliant`, `soc2_compliant`), metadata (`description`, `icon_uri`, `headquarters`, `datacenters`, policy URLs), `default_datapolicy_id`, `owners`, `editors`, `byok_enabled`.

> **Use this API** as the read half of provider read-modify-write: read the current row before a `PATCH /provider/{providerSlug}` (so you patch from real state, never blind), and read it again after to verify the write landed.

**Errors**:
- `401` — Missing or invalid `Authorization` header
- `404` — No provider with that slug (or it's deleted)

### POST /api/v1/internal/buddy/providers

Creates a provider database row, but **only after the provider integration code is merged and deployed in `openrouter-web`**. This route never substitutes for the code PR. Before constructing a payload, read the current `ProviderName` and `providerSlugMap`, adapter registries for the provider's modality, and `PricingStrategyName` in `openrouter-web`. If any value is not recognized, stop and answer: **ship and deploy the `openrouter-web` provider integration first**. Never guess a nearby enum value or work around the guard.

Required core fields are `provider_name`, `permaslug`, `display_name`, `adapter_name`, and a non-empty `base_url`; use a real `pricing_strategy` when applicable. The current database schema also requires non-null values for `byok_enabled` and `icon_uri`, so include them explicitly in every create payload (`byok_enabled: false` when BYOK is not enabled, and an approved icon URL rather than `null`). The request accepts the remaining `DBProviderInsert` fields except server-controlled `hidden`, `deleted`, `last_edited_clerk_user_id`, and `region_overrides`. `owners` is accepted. Resolve `default_datapolicy_id` from `GET /data-policies`. `pylon_account_id` is optional and may be backfilled by PATCH later; when supplied it must be a UUID not assigned to another non-deleted provider.

```bash
# Preview only (default)
curl -s -X POST -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  https://openrouter.ai/api/v1/internal/buddy/providers \
  -d '{
    "provider_name": "Runway",
    "permaslug": "runway",
    "display_name": "Runway",
    "adapter_name": "RunwayVideoAdapter",
    "pricing_strategy": "runway_video",
    "base_url": "https://api.dev.runwayml.com",
    "owners": []
  }'

# Apply only after posting the preview and receiving explicit approval via ask
# Send the same approved body with "apply": true.
```

Follows the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes):

- `apply` omitted or `false` → `200` with `{ "applied": false, "preview": { "proposed": ..., "stripped_fields": [...] } }`; no row is written.
- `apply: true` → `201` with `{ "applied": true, "data": ..., "stripped_fields": [...] }`.
- The server always writes `hidden: false`, `deleted: false`, and its own `last_edited_clerk_user_id`. Caller values for those fields, plus `region_overrides`, are discarded and named in `stripped_fields`. Unhidden is intentional and harmless while the provider has zero endpoints; endpoints remain hidden until launched separately.

**Code-first and uniqueness guardrails**:

1. `provider_name` must be a current `ProviderName` enum member.
2. `permaslug` must exactly equal `providerSlugMap[provider_name]`.
3. `adapter_name` must be registered in an adapter enum for its modality.
4. `pricing_strategy`, when set, must be a current `PricingStrategyName`.
5. `base_url` must be a non-empty string.
6. Existing `provider_name` or `permaslug` rows cause `409`, including hidden and soft-deleted rows. The route cannot overwrite or revive them. Concurrent duplicate-insert races also become `409`.
7. `default_datapolicy_id` must identify an existing policy; use `GET /data-policies` rather than guessing.
8. `pylon_account_id`, when set, must be a UUID and cannot be wired to another active provider.

**Choose create-only values carefully**: `base_url`, `adapter_name`, and `pricing_strategy` cannot be changed later through the provider PATCH route. Humans can correct them in Mission Control. For LLM/chat-completions providers, default to `OpenAIAdapter` for an OpenAI-compatible API, or `VLLMOpenAIAdapter` when `chat_template_kwargs` toggles reasoning, with `pricing_strategy: "openai_extended"`. If the integration adds a provider-specific adapter or pricing strategy—common for media providers—use the code-defined provider-specific values instead.

There is **no Buddy provider delete or revival route**; those remain human Mission Control operations. Creating the row also does **not** provision the production provider API key: credential provisioning on `cfw-api` is a separate secret-handling step. Never attempt to inject that secret yourself.

Before apply, post the exact proposed row and `stripped_fields`, include `https://internal.openrouter.ai/provider/{provider-permaslug}/edit`, and obtain explicit human approval. After a `201`, re-read with `GET /provider/{providerSlug}`, compare it with the approved preview, and surface the Mission Control link again.

**Errors**:
- `400` — Invalid enum/mapping/adapter/pricing/base URL, missing data policy, malformed Pylon UUID, or another validation/insert failure
- `401` — Missing or invalid `Authorization` header
- `409` — Existing provider name/permaslug, cross-wired Pylon account, or duplicate insert race

**Authoritative implementation**: `services/cfw-internal/src/routes/buddy-api/create-provider.ts`, `provider-field-guards.ts`, `create-provider.test.ts`, and `docs/runbooks/model-launch.md` in `openrouter-web`.

### PATCH /api/v1/internal/buddy/provider/{providerSlug}

Updates a provider. Only allowlisted fields are accepted — metadata (`description`, `icon_uri`, `headquarters`, `datacenters`, `status_page_url`, `privacy_policy_url`, `terms_of_service_url`, `data_policy_notes`), data wiring (`default_datapolicy_id`, `pylon_account_id`), capability flags (`has_chat_completions`, `has_completions`, `supports_tool_calling`, `is_abortable`, `is_multipart_supported`, `supported_parameters`), compliance flags (`hipaa_compliant`, `iso27001_compliant`, `soc2_compliant`), `ignored_provider_models`, `owners`, `editors`, `byok_enabled`. Fields outside the allowlist are stripped and reported — there is no way to change a provider's permaslug, base URL, adapter, pricing strategy, or credentials through this route.

```bash
# Preview (default) — returns current/proposed/diff/stripped_fields, nothing written
curl -s -X PATCH -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  https://openrouter.ai/api/v1/internal/buddy/provider/<provider-slug> \
  -d '{"supports_tool_calling": true}'

# Commit
curl -s -X PATCH -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  https://openrouter.ai/api/v1/internal/buddy/provider/<provider-slug> \
  -d '{"supports_tool_calling": true, "apply": true}'
```

Follows the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes). Non-allowlisted fields are reported in `stripped_fields`; a request with **no** allowlisted fields is rejected with `400` on both preview and apply. `default_datapolicy_id` must reference a current policy from `GET /data-policies`. `pylon_account_id` must be a UUID not assigned to a different non-deleted provider; keeping the provider's existing Pylon ID is valid.

> Always `GET /provider/{providerSlug}` first to read current state, show the exact diff and provider Mission Control link, get explicit human approval in a separate message, and GET again after apply to verify.

**Errors**:
- `400` — No allowlisted field, invalid value, unknown data policy, or malformed Pylon UUID
- `401` — Missing or invalid `Authorization` header
- `404` — No provider with that slug (or it's deleted)
- `409` — `pylon_account_id` belongs to a different provider

### GET /api/v1/internal/buddy/model-author/{authorSlug}

Returns a single `model_authors` row by slug (the part before `/` in a model permaslug) as `{ "data": {...} }`. Fields: `slug`, `name`, `description`, `icon_uri`, `is_trainable_text`, `is_trainable_image`, `last_edited_clerk_user_id`. The full row is returned (same as `GET /provider/{slug}`) so previews can diff against it. `is_trainable_*`, `slug`, and `last_edited_clerk_user_id` are read-only here and only change in Mission Control.

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/model-author/<author-slug> \
  | jq '.data | {slug, name, description, icon_uri}'
```

**Errors**:
- `401` — Missing or invalid `Authorization` header
- `404` — No author with that slug (authors are auto-created on the first model insert, so a 404 means no model with that prefix exists yet)

### PATCH /api/v1/internal/buddy/model-author/{authorSlug}

Updates author display metadata. Allowlisted fields: `name`, `description`, `icon_uri` (each `string | null`). Everything else (`slug`, training flags) is stripped and reported. Use this when a new author's models render with the Hugging Face fallback icon: a valid `icon_uri` takes precedence over the static author icon map in `packages/frontend/components/ui/Icons/icon-infos.ts`. An http(s) site URL (e.g. `https://fireworks.ai`) resolves through the favicon service like provider icons; a direct image URL is used as-is; `null` falls back to the static map.

```bash
# Preview (default) — returns current/proposed/diff/stripped_fields, nothing written
curl -s -X PATCH -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  https://openrouter.ai/api/v1/internal/buddy/model-author/<author-slug> \
  -d '{"icon_uri": "https://fireworks.ai", "name": "Fireworks"}'

# Commit
curl -s -X PATCH -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" -H "X-Buddy-Actor-Email: <approver>" \
  https://openrouter.ai/api/v1/internal/buddy/model-author/<author-slug> \
  -d '{"icon_uri": "https://fireworks.ai", "name": "Fireworks", "apply": true}'
```

Follows the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes) and the catalog-editor gate. A request with **no** allowlisted fields is rejected with `400`. Applied writes set `last_edited_clerk_user_id` to the actor.

> `GET /model-author/{authorSlug}` first, show the diff and `https://internal.openrouter.ai/author/{slug}/edit`, get explicit approval, then GET again after apply to verify.

**Errors**:
- `400` — No allowlisted field, or a field with the wrong type
- `401` — Missing or invalid `Authorization` header
- `403` — `apply: true` from an actor who is not a catalog editor
- `404` — No author with that slug

### GET /api/v1/internal/buddy/data-policies

Returns **every** non-deleted data policy as `{ "data": [...] }`, newest first — including policies no endpoint currently references.

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/data-policies \
  | jq '.data[] | {id, name, retains_prompts, prompt_retention_days, training, training_openrouter, can_publish}'
```

**Key fields returned** (per policy): `id`, `name`, `training`, `training_openrouter`, `retains_prompts`, `can_publish`, `prompt_retention_days`.

> **Use this API** to resolve a `data_policies` UUID (e.g. an endpoint's `override_datapolicy_id`) or to pick a policy ID for a ZDR override — see [`data-policies.md`](data-policies.md).

**Errors**:
- `401` — Missing or invalid `Authorization` header

---

### POST /api/v1/internal/buddy/endpoints

Creates a new endpoint with `hidden: true`. Uses `provider_slug` (URL-friendly, e.g., `"together"`) instead of `provider_name` (display format, e.g., `"Together"`) — the handler resolves the slug to the DB `provider_name`.

The following fields are **set server-side automatically** and should not be included in the request:
- `hidden` → always `true`
- `provider_name` → resolved from `provider_slug`
- `last_edited_clerk_user_id` → auto-set to the buddy service account

**Request body**: All fields from `DBEndpointInsert` except the server-side fields above, plus a required `provider_slug` field.

```json
{
  "model_permaslug": "meta-llama/llama-4-scout",
  "provider_slug": "together",
  "variant": "standard",
  "provider_model_id": "meta-llama/Llama-4-Scout-17B-16E-Instruct",
  "quantization": "bf16",
  "supports_reasoning": false,
  "features": {
    "supports_tool_choice": {
      "literal_none": true,
      "literal_auto": true,
      "literal_required": true,
      "type_function": true
    }
  },
  "additional_parameters": ["tools", "tool_choice"]
}
```

Before previewing any new endpoint, complete the [mandatory same-provider pattern survey](staging-reference.md#mandatory-same-provider-pattern-survey-before-staging). This applies to direct API use as well as the end-to-end workflow: inspect an analogous previous-generation model and a working sibling for every provider/provider variant, build the endpoint matrix, and classify each nontrivial value by provenance.

> ⚠️ **Stamp `internal_note` with staging attribution on every create.** Name the agent and the requester — `"staged by devin for @mindi"`, `"staged by mindi's claude for @john"` — and append a distinguishing qualifier when several endpoints from one provider would otherwise be indistinguishable (`"staged by devin — claude on aws"`). The route validates it (trimmed, ≤200 chars, no control characters) and writes it as sent. See [`guardrails.md`](guardrails.md) → `internal_note`.

> **Required batch data policy.** Whenever `variant` is `"batch"`, include
> `"override_datapolicy_id": "666ab392-f4f0-4bf5-8610-5468027d9a68"` in the endpoint
> creation payload. Resolve the UUID against `GET /data-policies` immediately before the
> preview and confirm it still names **No training; 30 day retention** with
> `training: false`, `training_openrouter: false`, `retains_prompts: true`,
> `prompt_retention_days: 30`, and `can_publish: false`. Show these resolved fields in the
> preview and verify the hydrated endpoint retains this override after creation. This policy
> is **not ZDR** because prompts are retained for 30 days. If the UUID is absent or resolves
> differently, stop rather than staging the batch endpoint with an inferred substitute.

**Required fields**: `model_permaslug`, `provider_slug`, `variant`. Follows the [universal `apply` contract](#the-universal-apply-contract-safe-by-default-writes) — add `"apply": true` to commit; omitting it previews the validated row (server-side fields you supplied show up in `stripped_fields`). See [Endpoint Database Fields](staging-reference.md#endpoint-database-fields) for all available fields.

**Response** (with `apply: true`): `201 Created` with `{ "applied": true, "data": <created endpoint object>, "stripped_fields": [...] }`

**Errors**:
- `400` — Invalid request body or validation failure
- `401` — Missing or invalid `Authorization` header
- `404` — `provider_slug` does not match any known provider

### After Creating a Model

After a successful `201` response from `POST /models`:

1. **Always post the Mission Control link** to the user:
   ```
   https://internal.openrouter.ai/model/edit/{full-permaslug}
   ```
   Use the full permaslug exactly as returned, including its author prefix and any date suffix. For example, permaslug `google/gemini-embedding-2-preview` → `https://internal.openrouter.ai/model/edit/google/gemini-embedding-2-preview`.

2. **Remind the user** that the model is `hidden: true` and must be manually unhidden in Mission Control when ready to go live.

3. **Verify the persisted record and Mission Control rendering** — re-read the model from `GET /buddy/models`, compare every staged capability field to the approved preview, and open the Mission Control page. For reasoning models, confirm the editor renders the full `features.reasoning_config` rather than null fields. A successful API response proves the row was written; it does not prove Mission Control can parse every nested feature value.

### After Creating an Endpoint

After a successful `201` response:

1. **Always post the Mission Control link** to the user:
   ```
   https://internal.openrouter.ai/endpoint/edit/{endpoint_id}
   ```
   The `endpoint_id` is the UUID in `response.data.id`. For example: `https://internal.openrouter.ai/endpoint/edit/{endpoint_id}`. Mission Control is behind Cloudflare Access — users must be authenticated to view it.

2. **Remind the user** that the endpoint is `hidden: true` and must be manually unhidden in Mission Control when ready to go live.

3. **Set `internal_note` on create** to `staged by <agent> for <requester>`, plus a qualifier when the endpoint matrix needs one to keep same-provider rows apart.

4. **Pricing is not set** by this API. If the endpoint needs pricing, use `POST /api/v1/internal/buddy/pricing-versions` (see Buddy API section above).

5. **Re-read all mutable state after creation** — verify the hydrated endpoint via `GET /buddy/endpoint/{endpointId}` and fetch its pricing-version history. Other humans or automations may act concurrently between preview, apply, and verification. Report any pricing version, visibility change, note change, or capability edit that appeared after your write, including attribution when available; never claim you created a concurrent change.

6. **Treat zero-price inbox entries as unverified unless explicitly approved as free** — a provider inbox may report `0` for prompt/completion while marking those changes non-auto-approvable. Do not silently turn that placeholder into a free endpoint. Preview pricing separately, explain the evidence, and get explicit approval before creating the irreversible pricing version.

7. **Verify behavior, not merely persistence** — after the canonical re-read matches the approved endpoint matrix and the pricing version is applied and verified (a completion served before pricing exists is recorded against no price), run the read-only endpoint validator and a meaningful real completion against that specific staged endpoint. Confirm the intended provider route and non-empty usable output; a successful create response or HTTP 200 alone does not prove routing works. For Google Vertex, re-check that the persisted `provider_region` exactly matches the approved global or regional value before testing.

### Key Differences from Mission Control Server Actions

| Aspect | Buddy API | Mission Control |
|--------|-----------|-----------------|
| Models/endpoints created as `hidden: true` | Yes | No (caller sets `hidden`) |
| Provider reference | `provider_slug` (URL-friendly) | `provider_name` (display format) |
| Auth mechanism | Bearer token (`BUDDY_API_KEY`) | Clerk session (requires admin role) |
| Pricing creation | `POST /pricing-versions` (all providers use SKU pricing) | Mission Control UI |
| Launch notifications | No | Yes |
| `internal_note` | Set by caller on create and PATCH; PATCH replaces the existing note | Set by caller |
| Model updates | `PATCH /model/{author}/{slug}` | Mission Control UI |

---
