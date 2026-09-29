# Staging Reference Guide

Field-level reference for models, endpoints, providers, pricing, supported parameters, model authors, key files, and common gotchas. Load it when [`staging-workflows.md`](staging-workflows.md) needs detail it doesn't carry.

## Lookups: Reading Models, Endpoints & Pricing

Before any create or update operation, always read the current live state so you know what fields are already set and what needs to change.

**Endpoints** — when someone names an endpoint by provider + model in natural language (e.g. `"sambanova's DeepSeek-V3.2"`), resolve it with the conventions in [`find-endpoint.md`](find-endpoint.md) rather than an ad-hoc `jq` filter: provider-name capitalisation, multi-account `provider_overrides`, date-suffixed permaslugs, and `deleted`/`deprecation_date` filtering all bite otherwise. Surface ambiguity instead of guessing when more than one endpoint matches.

For everything else (models, surveys across endpoints), use the Buddy API directly:

| Need | Use |
|------|-----|
| Resolve `<provider> <model>` → endpoint ID | [`find-endpoint.md`](find-endpoint.md) |
| Check if a model exists / read its fields | `GET /buddy/models` + jq filter |
| Survey patterns across many endpoints | `GET /buddy/endpoints` + jq filter |

### Mandatory same-provider pattern survey before staging

Before creating a model or endpoint, inspect at least one analogous previous-generation model **and** the relevant live sibling endpoints from the same provider/provider variant. If there are multiple variants (for example, AI Studio, Vertex global, Vertex regional, batch, or separate provider accounts), inspect a working sibling for each variant you intend to stage. Do this even when the handoff already contains a complete-looking payload.

Build an endpoint matrix before the preview. For every intended endpoint, explicitly record and verify:

- `provider_slug`, `provider_name`, and `provider_model_id`
- `provider_region`
- `provider_overrides`, including display/slug, `baseUrl`, and `pricingStrategy`
- `features`, `additional_parameters`, `excluded_parameters`, and `allowed_passthrough_parameters`
- `context_length_override` and `max_completion_tokens`
- adapter, variant, and quantization
- pricing strategy, exact SKU key set, and source rate card
- effective data policy after provider defaults and endpoint overrides resolve
- the analogous endpoint's `internal_note` and whether a short qualifier (`global`, `claude on aws`) would distinguish otherwise ambiguous same-provider endpoints

Set `internal_note` on create to `staged by <agent> for <requester>`, appending the qualifier when one helps ([`guardrails.md`](guardrails.md) → `internal_note`).

Classify every nontrivial value as **provider-confirmed**, **code-derived**, **sibling-derived and verified**, **pending validation**, or **removed**. A sibling is a structural template, not factual authority: do not inherit the new model's context, limits, capabilities, pricing values, discounts, or data policy without an independent source. Any field still pending validation must be called out in the preview and blocks apply unless the human explicitly narrows or defers that endpoint.

> ⚠️ **Google Vertex:** `provider_region` is a routing field, not a cosmetic label in `provider_overrides`. Compare every new Vertex endpoint with a working current sibling for the same Vertex variant. Global Vertex endpoints require `provider_region: "global"`; regional endpoints require their actual region. Show the resolved value in the preview and verify it again from the hydrated endpoint after creation. A missing region can make an otherwise valid endpoint unroutable.

### Get a model by permaslug

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/models \
  | jq '.data[] | select(.permaslug == "anthropic/claude-3.5-sonnet")'
```

### Get all endpoints for a model

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints \
  | jq '[.data[] | select(.model_permaslug == "anthropic/claude-3.5-sonnet" and .deleted == false)]'
```

### Get a single endpoint by ID

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  https://openrouter.ai/api/v1/internal/buddy/endpoints \
  | jq '.data[] | select(.id == "your-endpoint-uuid")'
```

### Key fields to inspect when cloning an endpoint config

| Field | What to look for |
|-------|-----------------|
| `provider_overrides` | JSON — check for `displayName`/`slug` (multi-account providers) and `pricingStrategy` (SKU-based pricing) |
| `features` | JSON — copy `supports_tool_choice`, `supports_native_web_search`, etc. |
| `provider_model_id` | The model ID sent upstream (often different from the OR slug) |
| `additional_parameters` | Array of extra supported params |
| `max_completion_tokens` | Max output tokens override |
| `discount_to_user` | **Do not copy.** Omit it for a new endpoint so it defaults to `0`; set a non-zero discount only when the human explicitly instructs you to apply that exact value. |

When previewing a cloned endpoint, call out `discount_to_user: 0 (not inherited from source)` separately from `pricing_json`. After creation, re-read the endpoint and verify the persisted value is `0` unless the approved preview explicitly specified otherwise.

Store the provider's list rate in `pricing_json`. Express a promotion with endpoint-level `discount_to_user`. Never put a promotional rate in `pricing_json`.

For a live model with a baked-in promotional rate, apply `discount_to_user` first, then correct `pricing_json` to the list rate. That order avoids a window where requests bill at the full list rate.

The pricing write route takes `endpoint_id` and `pricing_json` only, so a version is effective on write and cannot be scheduled. When a promotion needs reversion later, hand the date to a human or file it as an issue. Do not schedule it with `CronCreate`, a remote scheduler, or a local timer that dies with the box.

**Multi-account providers** (e.g., "Anthropic 2") are identified by `provider_overrides.displayName` and `provider_overrides.slug` — the `provider_name` in the DB is still `"Anthropic"`. When creating a new endpoint for a multi-account provider, copy the full `provider_overrides` from the source endpoint and update any model-version-specific fields.

---

## 1. Models

### Slug and Permaslug

Every model has two identifiers:

| Field | Description | Mutable? |
|-------|-------------|----------|
| `slug` | The current public-facing identifier, e.g., `anthropic/claude-sonnet-4-20250514`. Used in API requests. Can be updated (e.g., when a model is promoted from a dated slug to a shorter alias). | Yes |
| `permaslug` | Immutable identifier, set once at creation. Format: `author/model-name`. Defaults to the initial `slug` value if not explicitly set. Used as the primary key across the system. | No |

Slug format: `{author}/{model-name}` — e.g., `google/gemini-2.5-pro-preview-06-05`.

The author portion (before `/`) must match an existing `model_authors.slug` — a new author is auto-created from the permaslug prefix if needed.

> ⚠️ **MANDATORY: Derive the author slug from existing prod models — never from the provider's API schema.**
>
> Provider API payloads (inbox entries, spec sheets, announcement copy) often suggest an author slug that **does not** match the convention already established in our catalog. For example, a Baidu Qianfan inbox entry may suggest `baidu-qianfan/<model>`, but every existing Baidu model in prod lives under `baidu/` (e.g. `baidu/qianfan-ocr-fast`, `baidu/ernie-4.5-300b-a47b`). Staging under a new author silently forks the catalog and creates duplicates that have to be cleaned up.
>
> **Before creating any model**, always run this check and follow its result:
>
> ```bash
> # Replace AUTHOR_HINT with whatever prefix the provider API suggested (e.g. "baidu-qianfan")
> # and PROVIDER_HINT with a likely existing author slug (e.g. "baidu").
> curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
>   https://openrouter.ai/api/v1/internal/buddy/models \
>   | jq '[.data[] | select((.permaslug | startswith("AUTHOR_HINT/")) or (.permaslug | startswith("PROVIDER_HINT/"))) | {permaslug, slug, name}]'
> ```
>
> - If **any model already exists under that vendor** (check both hints, plus any obvious variations of the vendor name), **re-use that exact author slug** — do not invent a new one.
> - If the provider's suggested slug differs from the prod convention, **use the prod convention** and note the divergence in your stage-preview message so the user can confirm.
> - Only if there are truly **zero existing models for that vendor** may you create a new author slug — and even then, prefer the shortest canonical vendor name (e.g. `baidu`, not `baidu-qianfan`).
>
> This rule applies to **every** model you stage, including duplicates and re-stages.

### Model Database Fields

Source: `packages/db/kysely-types.gen.d.ts` → `Models` interface

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `permaslug` | `string` | Yes | Immutable unique identifier. Primary key. |
| `slug` | `string` | Yes | Current public slug used in API requests. |
| `author_id` | `string` | Auto | Foreign key to `model_authors`. Auto-set from permaslug prefix. |
| `name` | `string \| null` | No | Display name, e.g., "Claude Sonnet 4". Falls back to slug if null. |
| `description` | `string \| null` | No | Model description shown on the model page. |
| `group` | `string \| null` | **Yes** (enforced) | Model family. Must be a valid `ModelGroup` enum value. See enum values below. |
| `context_length` | `number \| null` | No | Maximum context window in tokens. |
| `input_modalities` | `string[]` | Yes | Array of `InputModality` values the model accepts. |
| `output_modalities` | `string[]` | Yes | Array of `OutputModality` values the model produces. |
| `supports_reasoning` | `boolean` | No (default: false) | Whether the model supports reasoning/thinking. |
| `features` | `JSON` | No (default: {}) | Model-level features. Parsed via `ModelFeaturesSchema`. Contains `reasoning_config` and `chat_template_config`. |
| `default_parameters` | `JSON` | No (default: {}) | Default parameter values. Parsed via `DefaultParametersSchema`. |
| `hf_slug` | `string \| null` | No | HuggingFace model identifier for metadata sync. |
| `instruct_type` | `string \| null` | No | Chat template type (e.g., `alpaca`, `chatml`, `llama2`). |
| `default_system_prompt` | `string \| null` | No | System prompt injected by default. |
| `default_stops` | `string[] \| null` | No | Default stop sequences. Falls back to instruct_type stops. |
| `default_order` | `string[] \| null` | No | Default provider ordering for routing. Array of provider slugs. |
| `hidden` | `boolean` | No (default: false) | If true, model is not shown in public listings but still routable. |
| `deleted` | `boolean` | No (default: false) | Soft delete flag. |
| `license` | `string \| null` | No | Model license (e.g., "apache-2.0", "proprietary"). |
| `knowledge_cutoff` | `timestamp \| null` | No | Training data cutoff date. Set to null (not empty string) when clearing. |
| `warning_message` | `string \| null` | No | Warning displayed on the model page. |
| `promotion_message` | `string \| null` | No | Promotional text displayed on the model page. |
| `routing_error_message` | `string \| null` | No | Custom error message when no endpoints are available. |
| `quick_start_example_type` | `string \| null` | No | Auto-inferred from modalities if not set. Controls the API example shown on the model page. |
| `total_parameters` | `number \| null` | No | Total parameter count as a **RAW integer**, not billions — e.g. `70000000000` for a 70B model, `1000000000000` for a 1T model. |
| `active_parameters` | `number \| null` | No | Active parameters for MoE models, as a **RAW integer** — e.g. `17000000000` for 17B active. |
| `model_version_group_id` | `string \| null` | No | Groups model versions together (e.g., all Claude 3.5 Sonnet versions). |
| `aa_slugs` | `string[] \| null` | No | Artificial Analysis benchmark slugs mapped to this model. |
| `tokenizer_config` | `JSON \| null` | No | Tokenizer configuration from HuggingFace. |

### Model Features (JSON `features` field)

Parsed by `ModelFeaturesSchema` at `packages/models/model-info/index.ts`:

```typescript
{
  reasoning_config: {
    start_token: string | null,        // e.g., "<think>" — must match pattern /^<.*>$/
    end_token: string | null,          // e.g., "</think>" — must match pattern /^<\/.*>$/
    system_prompt: string | null,      // System prompt for reasoning extraction
    is_mandatory_reasoning: boolean,   // Model always reasons (can't be toggled off)
    supports_reasoning_effort: boolean,
    supports_reasoning_max_tokens: boolean,
    supported_reasoning_efforts: ReasoningEffortValue[],  // e.g., ["high", "medium", "low"]
    default_reasoning_effort: ReasoningEffortValue,
    default_reasoning_enabled: boolean,
    reasoning_return_mechanism: ReasoningReturnMechanism,  // How reasoning is returned
  },
  chat_template_config: {
    should_hoist_and_merge_system_messages: boolean,
  }
}
```

### Default Parameters (JSON `default_parameters` field)

Parsed by `DefaultParametersSchema`:

```typescript
{
  temperature: number,       // 0–2
  top_p: number,             // 0–1
  top_k: number,             // integer >= 0
  frequency_penalty: number, // -2 to 2
  presence_penalty: number,  // -2 to 2
  repetition_penalty: number // 0–2
}
```

### Key Enums for Models

**ModelGroup** (`packages/enums/model/groups.ts`): `Router`, `Media`, `Other`, `GPT`, `Claude`, `Gemini`, `Gemma`, `Grok`, `Cohere`, `Nova`, `Qwen`, `Yi`, `DeepSeek`, `Mistral`, `Llama2`, `Llama3`, `Llama4`, `PaLM`, `RWKV`, `Qwen3`

**InputModality** (`packages/enums/model/modality.ts`): `text`, `image`, `file`, `audio`, `video`

**OutputModality** (`packages/enums/model/modality.ts`): `text`, `image`, `embeddings`, `audio`, `video`, `rerank`, `speech`, `transcription`

> ⚠️ **Use enum values, not TypeScript member names or display labels.** Read the current
> `InputModality` and `OutputModality` definitions in `packages/enums/model/modality.ts`
> immediately before staging or patching **any** model. Persist the right-hand-side string
> value exactly. For example, `OutputModality.TTS = 'speech'` means the database payload is
> `output_modalities: ["speech"]` — neither `["TTS"]` (member name) nor `["tts"]`
> (legacy shorthand) is valid. Do not infer casing or values from UI labels such as
> `Speech`, copied documentation text, or an older SDK; then confirm the Buddy API preview accepts
> the complete modality arrays with no stripped fields.

**QuickStartExampleType** (`packages/enums/model/quick-start-example-type.ts`): `text`, `computer_use_tool`, `audio_tool`, `audio_output`, `fast_apply`, `embeddings`, `image_input_embeddings`, `reasoning`, `image_generation`, `image_generation_without_text`, `video_generation`, `rerank`, `tts`

Auto-inferred from modalities if not explicitly set:
- Embeddings output → `embeddings`
- Video output → `video_generation`
- Image output → `image_generation`
- Reasoning support → `reasoning`
- Otherwise → `null` (defaults to `text` example)

> **TTS models**: `output_modalities` must be `["speech"]` (not `["audio"]`, `["tts"]`, or `["TTS"]`). `TTS` is the enum member name; its persisted `OutputModality` value is `speech`. Set `quick_start_example_type: "tts"` explicitly — that is a separate enum whose value remains `tts`, and it is **not** auto-inferred from the `speech` output modality.

**ReasoningReturnMechanism** (`packages/enums/reasoning.ts`):
- `content-string` — reasoning in the response content as a string
- `reasoning-content` — reasoning in a dedicated `reasoning_content` field
- `reasoning` — reasoning in a `reasoning` field

**ReasoningEffortValue** (`packages/enums/reasoning.ts`): `max`, `xhigh`, `high`, `medium`, `low`, `minimal`, `none`

> ⚠️ **Enums drift — RTFC immediately before staging.** Do not treat the copied enum
> lists in this file as authoritative when configuring a live model. Read
> `packages/enums/reasoning.ts` in `OpenRouterTeam/openrouter-web` immediately before
> building the payload, then confirm the Buddy API preview accepts every value with no
> stripped fields. This matters for newly-added values such as `max`: stale guidance can
> make an otherwise valid upstream capability disappear from the model record.

### Reasoning configuration: inspect the Hugging Face chat template

`reasoning_return_mechanism` primarily controls how OpenRouter serializes reasoning when it sends assistant history back to the provider. It usually matches the provider's response shape too, but do not choose it from response behavior alone. When creating a model, inspect its Hugging Face `chat_template.jinja` first:

- If the template references `reasoning_content`, set `reasoning-content`. This is the common case. Mission Control's **Pull HuggingFace** button automates exactly this check: it fetches `chat_template.jinja`, searches for the literal substring `reasoning_content`, and sets the model mechanism to `reasoning-content` when found.
- `content-string` means OpenRouter serializes reasoning inline in `content` using `start_token` and `end_token`. Use it only when the template expects tagged reasoning inside the content string.
- `reasoning` means OpenRouter serializes reasoning in a dedicated `reasoning` field. This and `content-string` are much less common and must be configured deliberately.

The Pull HuggingFace flow does not infer `content-string` or `reasoning`, has no fallback when `reasoning_content` is absent, and does not derive `start_token` / `end_token`. Read the current implementation in `projects/mission-control/app/model/ModelEditor.tsx` before copying this behavior, because the automation may evolve.

Tokens used to serialize message sections are not automatically content-string delimiters. A template may render historical reasoning with `<|content_thinking|>` and terminate the whole message with `<|end_message|>`, but if its assistant-history branch reads `message.reasoning_content`, the correct mechanism is `reasoning-content` and `start_token` / `end_token` should remain null.

Mission Control parses the entire `features` object through `ModelFeaturesSchema`. One invalid nested value can make the editor fall back to `features: null`, causing every reasoning field to appear empty even though the raw DB row contains values. Before applying a model create or update:

1. Read `packages/models/model-info/index.ts` for current validation rules.
2. Send the exact payload through the Buddy API preview.
3. After applying, reopen the Mission Control model page and verify the reasoning fields render.
4. If they render null, read the raw model via `GET /buddy/models`; do not assume the values were never written.

### Model Creation Flow

Models can be created via the Buddy API (see section above) or via Mission Control server actions.

**Via Buddy API** (preferred for programmatic use):
1. `POST /api/v1/internal/buddy/models` — see Buddy API section for details
2. `hidden` is always set to `true` server-side
3. `author_id` is resolved automatically from the permaslug prefix

**Notes** (implemented by `insertModel` at `packages/db/models/queries.ts`):
- `permaslug` defaults to `slug` if not provided
- `group` is **required** — fails with 400 if missing
- `insertModel` extracts the author slug from permaslug and calls `getOrCreateModelAuthor` to auto-create the author if needed
- `quick_start_example_type` is auto-inferred from modalities if not provided


### Model Update Flow

Use `PATCH /api/v1/internal/buddy/model/{author}/{modelSlug}` to update an existing model.

**Workflow:**
1. Read current state via Buddy API: `curl -s -H "Authorization: Bearer $BUDDY_API_KEY" https://openrouter.ai/api/v1/internal/buddy/models | jq '.data[] | select(.permaslug == "author/model-slug")'`
2. Diff against desired state — only send changed fields
3. `PATCH /api/v1/internal/buddy/model/{author}/{modelSlug}` with the delta

**Example — updating context length and reasoning config:**
```bash
curl -X PATCH https://openrouter.ai/api/v1/internal/buddy/model/google/gemini-2.5-pro \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "context_length": 1048576,
    "supports_reasoning": true,
    "features": {
      "reasoning_config": {
        "start_token": "<think>",
        "end_token": "</think>",
        "supports_reasoning_effort": true,
        "supported_reasoning_efforts": ["high", "medium", "low"]
      }
    }
  }'
```

### Immutable Model Fields (cannot be updated)

These fields are stripped server-side by `pickDBModelUpdate`:
- `created_at`
- `updated_at`
- `permaslug`
- `author_id`

---

## 2. Endpoints

An endpoint connects a model to a specific provider deployment. It defines how to reach the upstream API, what pricing applies, what features are supported, and what parameters are available.

### Endpoint Database Fields

Source: `packages/db/kysely-types.gen.d.ts` → `Endpoints` interface

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` (UUID) | Auto-generated | Primary key. |
| `model_permaslug` | `string` | Yes | Foreign key to `models.permaslug`. |
| `provider_name` | `string` | Yes | Foreign key to `providers.provider_name`. Must be a valid `ProviderName`. |
| `variant` | `string` | Yes | Static variant. See Variants section. |
| `provider_model_id` | `string \| null` | No | The model ID sent to the upstream provider. If null, defaults to the model permaslug. Different providers use different IDs for the same model. |
| `quantization` | `string` | No (default: "") | Quantization level. See `Quantization` enum. |
| `context_length_override` | `number \| null` | No | Overrides the model's context_length for this specific endpoint. |
| `features` | `JSON` | No (default: {}) | Endpoint-specific features. Parsed via `EndpointFeaturesSchema`. |
| `provider_overrides` | `JSON` | No (default: {}) | Override provider-level settings per endpoint. See Provider Overrides. |
| `supported_video_parameters` | `JSON \| null` | No | Video generation parameters for video model endpoints. Validated against the serving schema on create and update. |
| `supported_image_parameters` | `JSON \| null` | No | Image generation parameters. Validated against the serving schema on create and update. |
| `supported_tts_parameters` | `JSON \| null` | No | Text-to-speech parameters. Validated against the serving schema on create and update. |
| `supports_reasoning` | `boolean` | No (default: false) | Whether this endpoint supports reasoning tokens. |
| `hidden` | `boolean` | No (default: false) | Hidden endpoints are not routed to but remain in the DB. |
| `deleted` | `boolean` | No (default: false) | Soft delete flag. |
| `is_disabled` | `boolean` | No (default: false) | Temporarily disable routing to this endpoint. |
| `is_deranked` | `boolean` | No (default: false) | Deprioritized in routing (e.g., low benchmark scores). |
| `has_chat_completions` | `boolean \| null` | No | Whether the endpoint supports chat completions API. |
| `has_completions` | `boolean \| null` | No | Whether the endpoint supports legacy completions API. |
| `max_prompt_tokens` | `number \| null` | No | Maximum input tokens. |
| `max_completion_tokens` | `number \| null` | No | Maximum output tokens. |
| `max_tokens_per_image` | `number \| null` | No | Maximum tokens per image input. |
| `limit_rpm` | `number \| null` | No | Rate limit: requests per minute. |
| `limit_rpd` | `number \| null` | No | Rate limit: requests per day. |
| `capacity_tpm` | `number \| null` | No | Throughput capacity in tokens per minute. |
| `deprecation_date` | `string \| null` | No | ISO date after which the endpoint is auto-hidden. |
| `internal_note` | `string \| null` | Yes | Staging attribution: `staged by <agent> for <requester>`. Writable on create and PATCH; a PATCH replaces the existing note. |
| `provider_region` | `string \| null` | No | Provider datacenter region (ISO 3166 alpha-2). |
| `discount_from_provider` | `number` | No (default: 0) | Discount received from provider (0–1 fraction). |
| `discount_to_user` | `number` | No (default: 0) | Discount passed to user (0–1 fraction). **Non-inheritable:** omit it when cloning a new endpoint unless the human explicitly approves a specific value. |
| `override_datapolicy_id` | `string \| null` | No | FK → `data_policies.id`. Overrides the provider's default data policy for this endpoint (e.g. to make it ZDR). See [Data policies & ZDR](#data-policies--zdr-override_datapolicy_id) below. |
| `additional_parameters` | `string[]` | No (default: []) | Extra parameters this endpoint supports beyond the provider defaults. |
| `excluded_parameters` | `string[]` | No (default: []) | Parameters to exclude from this endpoint's supported set. |
| `allowed_passthrough_parameters` | `string[]` | No (default: []) | Parameters passed through to the provider without transformation. |

Endpoint create and update calls return `400` with `capability_issues` when any supported-capability field does not match its serving schema. Fix the payload and keep the field. Do not remove `supported_video_parameters`, `supported_image_parameters`, or `supported_tts_parameters` to bypass validation. See `services/cfw-internal/src/routes/buddy-api/validate-capability-fields.ts` for the authoritative validation behavior.

### Endpoint Features (JSON `features` field)

Parsed by `EndpointFeaturesSchema` at `packages/db/endpoints/index.ts`:

```typescript
{
  // Capability flags
  supports_multipart: boolean,           // Supports multipart file uploads
  supports_implicit_caching: boolean,    // Provider does automatic prompt caching
  supports_file_urls: boolean,           // Can process file URLs directly
  supports_native_web_search: boolean,   // Has built-in web search
  supports_base64_video_input: boolean,  // Accepts base64-encoded video
  supports_video_urls: boolean,          // Can process video URLs
  disable_free_endpoint_limits: boolean, // Exempt from free-tier rate limits

  // Reasoning
  reasoning_return_mechanism: "content-string" | "reasoning-content" | "reasoning",

  // Tool calling granularity
  supports_tool_choice: {
    literal_none: boolean,     // Supports tool_choice: "none"
    literal_auto: boolean,     // Supports tool_choice: "auto"
    literal_required: boolean, // Supports tool_choice: "required"
    type_function: boolean,    // Supports tool_choice: {type: "function", ...}
  },

  // Parameter support flags
  supported_parameters: {
    response_format: boolean,     // Supports response_format parameter
    structured_outputs: boolean,  // Supports structured outputs (JSON schema)
  },
}
```

### Data policies & ZDR (`override_datapolicy_id`)

`override_datapolicy_id` is a **UUID foreign key** into the `data_policies` table. Each policy row (see `postgres/migrations/*_create_datapolicies_table.sql` + `*_add_training_openrouter_to_data_policies.sql` in `openrouter-web`) looks like:

```
data_policies: {
  id,
  name,
  training,               // provider may train on prompts
  training_openrouter,    // OpenRouter may use prompts for training
  retains_prompts,        // provider stores prompts after serving
  can_publish,            // prompts may be published
  prompt_retention_days,  // how long prompts are retained (null = unspecified)
}
```

**How the effective policy is resolved.** An endpoint does not store a full policy — it points at one. The *effective* policy is computed in `packages/routing/endpoints/constructor.ts` by overlaying the endpoint's override on top of the **provider default** (`providers.default_datapolicy_id`), **field by field**:

```ts
retainsPrompts:  endpoint_override?.retains_prompts      ?? providerDefault.retainsPrompts
training:        endpoint_override?.training             ?? providerDefault.training
canPublish:      endpoint_override?.can_publish          ?? providerDefault.canPublish
// …same ?? pattern for every field
```

So setting `override_datapolicy_id` does **not** wholesale-replace the provider policy conceptually — each field of the referenced override policy takes precedence where present, and missing fields fall through to the provider default.

**ZDR (Zero Data Retention) ⟺ effective `retains_prompts: false`.** The public ZDR endpoint list (`services/cfw-public-api/.../list-zdr-endpoints.ts`) filters endpoints on `!data_policy.retainsPrompts`. So to make an endpoint ZDR-eligible even when its provider's default would retain, point `override_datapolicy_id` at a policy whose `retains_prompts` is `false`.

**Finding the right policy ID.** There is no Buddy API route to list policies directly, but the data is reachable two ways:

- For a **specific endpoint's** current policy: read the endpoint's `override_datapolicy_id` and its provider's default, then overlay them field-by-field to get the effective policy and ZDR state.
- To **resolve a bare UUID** (like the value you'd set here) or list policies: see [`data-policies.md`](data-policies.md).

**Required policy for new batch endpoints.** For every newly staged endpoint with `variant: "batch"`, set `override_datapolicy_id: "666ab392-f4f0-4bf5-8610-5468027d9a68"`. Before each use, resolve that live UUID and confirm it is still **No training; 30 day retention**: `training: false`, `training_openrouter: false`, `retains_prompts: true`, `prompt_retention_days: 30`, and `can_publish: false`. Include the policy in the creation preview and verify it after creation. Do not silently omit the override, copy another batch sibling's policy, or substitute a different policy if live resolution fails or differs. This required batch policy is not ZDR.

**⚠️ Writing `override_datapolicy_id` is gated.** It is an endpoint mutation, so per [`guardrails.md`](guardrails.md) → Preview gate you must preview the exact change (`override_datapolicy_id: old → new`, plus the resulting effective `retains_prompts` / ZDR state), get explicit human approval, and surface the Mission Control link — **before** calling PATCH.

### Variants

Variants control how an endpoint is routed. They are set on the endpoint's `variant` field.

**Static Variants** (persisted in DB, affect routing):

| Variant | Slug suffix | Description |
|---------|-------------|-------------|
| `standard` | (none) | Default variant. No suffix appended to slug. |
| `free` | `:free` | Free-tier endpoint. All pricing fields **must** be zero. |
| `extended` | `:extended` | Extended context window. |
| `thinking` | `:thinking` | Thinking/reasoning variant. |
| `batch` | `:batch` | Batch-processing endpoint. Must set `override_datapolicy_id` to `666ab392-f4f0-4bf5-8610-5468027d9a68` after resolving it as **No training; 30 day retention**. |

**Virtual Variants** (not persisted, used for filtering/sorting at runtime): `all`, `online`, `nitro`, `floor`, `exacto`

> ⚠️ **`variant` is frozen once the endpoint has ever been unhidden**, along with `is_private` and
> `service_tier`. Get it right before the endpoint is first exposed. Afterwards, changing it means
> [duplicating the endpoint](buddy-api.md#post-apiv1internalbuddyendpointendpointidduplicate) under
> a new id, because per-endpoint stats must never mix identity regimes.

### Quantization

`packages/enums/quantizations.ts`:

| Value | Display Name |
|-------|-------------|
| `int4` | Integer (4 bit) |
| `int8` | Integer (8 bit) |
| `fp4` | Floating point (4 bit) |
| `fp6` | Floating point (6 bit) |
| `fp8` | Floating point (8 bit) |
| `fp16` | Floating point (16 bit) |
| `bf16` | Brain floating point (16 bit) |
| `fp32` | Floating point (32 bit) |
| `unknown` | Unknown |

### Provider Overrides (JSON `provider_overrides` field)

Endpoint-level overrides for provider settings. Parsed by `ProviderInfoOverridesSchema`:

```typescript
{
  displayName: string,    // Override provider display name
  baseUrl: string,        // Override base URL for this endpoint
  slug: string,           // Override provider slug
  adapterName: AdapterName, // Override the adapter used
  pricingStrategy: string,  // Override the pricing strategy
}
```

This is how one provider can have endpoints using different adapters or base URLs. For example:
- Azure endpoints may use `AzureOpenAIAdapter` for GPT models but `AzureAnthropicAdapter` for Claude models.
- "Anthropic 2" is a second Anthropic account identified by `{"displayName":"Anthropic 2","slug":"anthropic/2"}` in `provider_overrides` — the DB `provider_name` remains `"Anthropic"`.

### Endpoint Creation Flow

Endpoints can be created via the Buddy API (see section above) or via Mission Control server actions.

**Via Buddy API** (preferred for programmatic use):
1. `POST /api/v1/internal/buddy/endpoints` — see Buddy API section for details
2. `hidden` is always set to `true` server-side
3. Uses `provider_slug` (e.g., `"anthropic"`) — resolved to `provider_name` server-side
4. **Always post the Mission Control link after creation**: `https://internal.openrouter.ai/endpoint/edit/{id}`

**Validation notes** (enforced by `insertEndpoint` at `packages/db/endpoints/queries.ts`):
- Free variant endpoints cannot have non-zero pricing
- `tool_choice` in `additional_parameters` requires `tools` also be present
- Endpoint is inserted into the `endpoints` table

### Immutable Endpoint Fields (cannot be updated)

These fields are stripped by `pickDBEndpointUpdate` and cannot be changed after creation:
- `created_at`
- `updated_at`
- `provider_name`
- `model_permaslug`

---

## 3. Providers

Providers are upstream API hosts. Reuse an existing provider whenever one already exists. When a genuinely new provider integration is needed, Buddy can create its database row with `POST /api/v1/internal/buddy/providers` **only after** the corresponding `openrouter-web` enums, slug map, adapter, and pricing integration are merged and deployed. Provider creation is code-first; the API route cannot bootstrap integration code or revive an old row. When creating an endpoint, reference the resulting provider by its provider slug.

### Provider Fields

Source: `packages/db/providers/index.ts` → `ProviderInfo` type

| API/DB field | Description |
|-------|-------------|
| `provider_name` | `ProviderName` enum value, e.g., `"Anthropic"`, `"Google"`, `"DeepInfra"` |
| `display_name` | Human-readable name |
| `permaslug` | Code-defined URL identifier from `providerSlugMap`, e.g., `"anthropic"`, `"google-vertex"` |
| `adapter_name` | Default registered adapter class for this provider |
| `base_url` | Default upstream API base URL |
| `pricing_strategy` | Registered pricing strategy, commonly `"openai_extended"` for LLM providers |
| `default_datapolicy_id` | Existing data-policy UUID; resolve with `GET /data-policies` |
| `pylon_account_id` | Optional unique Pylon account UUID; may be added later with PATCH |
| `owners` / `editors` | Provider ownership and edit access metadata |
| `has_chat_completions` | Whether the provider supports chat completions |
| `has_completions` | Whether the provider supports legacy completions |
| `is_abortable` | Whether requests can be aborted |
| `byok_enabled` | Whether bring-your-own-key is supported |

### Adapter System

Each provider (or endpoint override) maps to an adapter class that handles request/response transformation. The adapter translates OpenRouter's unified API format to/from the provider's native format.

**AdapterName enum** (`packages/enums/adapters.ts`) — key adapters include:

| Adapter | Used By |
|---------|---------|
| `OpenAIAdapter` | OpenAI, Reka, and many OpenAI-compatible providers |
| `AnthropicMessageAdapter` | Anthropic native |
| `GoogleVertexGeminiAdapter` | Google Vertex AI (Gemini) |
| `GoogleAIStudioGeminiAdapter` | Google AI Studio (Gemini) |
| `AzureOpenAIAdapter` | Azure (GPT models) |
| `AzureAnthropicAdapter` | Azure (Claude models) |
| `CohereV2Adapter` | Cohere |
| `DeepSeekAdapter` | DeepSeek |
| `MistralAdapter` | Mistral |
| `FireworksAdapter` | Fireworks |
| `TogetherAdapter` | Together AI |
| `AmazonBedrockConverseAdapter` | AWS Bedrock |
| `OpenAIReasoningAdapter` | OpenAI reasoning models (o1, o3, etc.) |
| `OpenAIResponsesAdapter` | OpenAI Responses API models |
| `BlackForestLabsAdapter` | Black Forest Labs (image gen) |

The full registry is in `packages/router/adapters/adapter-factory.ts`. When creating an endpoint for a provider, the adapter is resolved from:
1. `provider_overrides.adapterName` (endpoint-level override), or
2. The provider's default `adapter_name`

### Provider Name to Slug Mapping

Provider names in the database use display format (e.g., `"Anthropic"`, `"Google"`, `"DeepInfra"`). Slugs are URL-friendly (e.g., `"anthropic"`, `"google-vertex"`, `"deepinfra"`).

The mapping is defined in `packages/enums/providers.ts` → `providerSlugMap`.

---

## 4. Pricing

### SKU-Based Pricing (pricing_versions table)

> **All endpoints use SKU-based pricing.** There are no flat-pricing endpoints. Always use `POST /pricing-versions` to set or update pricing — never set pricing columns directly on the endpoint.

The modern pricing system uses a separate `pricing_versions` table. Each version has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (UUID) | Primary key |
| `endpoint_id` | `string` | Foreign key to endpoint |
| `effective_at` | `timestamp` | When this pricing takes effect |
| `pricing_json` | `JSON` | SKU-based pricing data |
| `created_by_clerk_user_id` | `string \| null` | Who created this version |

The `pricing_json` field uses SKU keys keyed by the provider's `pricingStrategy`. **Never hardcode the keys** — the canonical set varies per provider and evolves over time as new SKUs are added (e.g. `cache_write_1h_tokens`, `web_search_calls`) and old ones are deprecated. Always discover them by fetching the raw `pricing_json` of a sibling endpoint (hidden or visible) via the buddy route:

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  "https://openrouter.ai/api/v1/internal/buddy/endpoint/<sibling-endpoint-uuid>" \
  | jq '.data.current_pricing_version.pricing_json'
```

See the **Discovering SKU keys** subsection under `POST /api/v1/internal/buddy/pricing-versions` above for the full workflow.

### Creating Pricing

To add pricing via the Buddy API, use `POST /api/v1/internal/buddy/pricing-versions` (see Buddy API section). All providers use SKU-based pricing — see the `POST /pricing-versions` section for how to discover the correct SKU keys before calling this route.

### Variable Pricing

Some providers have tiered pricing based on usage. Three types exist:

1. **PromptThreshold** — price changes above a token count (e.g., Gemini long-context pricing)
2. **SearchThreshold** — price varies by search quality tier (e.g., Perplexity)
3. **TotalTokensThreshold** — price changes based on total tokens (e.g., xAI Grok-4)

---

## 5. Supported Parameters

Parameters that an endpoint supports are computed dynamically based on:

1. Provider-specific defaults (hardcoded in `packages/providers/configs/supported-parameters.ts`)
2. Endpoint `additional_parameters` (adds to provider defaults)
3. Endpoint `excluded_parameters` (removes from supported set)
4. Endpoint `features.supported_parameters` (structured_outputs, response_format flags)
5. Model group and reasoning support
6. Adapter-based exclusions (e.g., `structured_outputs` is dropped on `AzureAnthropicAdapter` and off-allowlist `AmazonBedrockInvokeAnthropicAdapter`)

**Parameter enum** (`packages/enums/parameters.ts`): `temperature`, `top_p`, `top_k`, `min_p`, `top_a`, `frequency_penalty`, `presence_penalty`, `repetition_penalty`, `max_tokens`, `max_completion_tokens`, `logit_bias`, `logprobs`, `top_logprobs`, `seed`, `response_format`, `structured_outputs`, `stop`, `tools`, `tool_choice`, `parallel_tool_calls`, `include_reasoning`, `reasoning`, `reasoning_effort`, `web_search_options`, `verbosity`

### Validation Rules

- If `tool_choice` is in `additional_parameters`, `tools` must also be present
- Free variant endpoints must have all pricing fields at zero
- `start_token` must match `/^<.*>$/` and `end_token` must match `/^<\/.*>$/`

---

## 6. Model Authors

Authors are auto-created when inserting a model. The author slug is extracted from the model permaslug (the part before `/`).

### Model Author Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (UUID) | Primary key |
| `slug` | `string` | URL-friendly author identifier, e.g., `"anthropic"` |
| `name` | `string \| null` | Display name, e.g., `"Anthropic"` |
| `description` | `string \| null` | Author description |
| `icon_uri` | `string \| null` | Author icon URL |
| `is_trainable_text` | `boolean \| null` | Whether models from this author support text fine-tuning |
| `is_trainable_image` | `boolean \| null` | Whether models from this author support image fine-tuning |


---

## 9. Key File Reference

| Purpose | File Path |
|---------|-----------|
| DB schema types (generated) | `packages/db/kysely-types.gen.d.ts` |
| Model DB types | `packages/db/models/index.ts` |
| Model DB queries (insert, update, delete) | `packages/db/models/queries.ts` |
| Endpoint DB types + EndpointFeaturesSchema | `packages/db/endpoints/index.ts` |
| Endpoint DB queries (insert, update, delete) | `packages/db/endpoints/queries.ts` |
| Provider DB types + ProviderInfo | `packages/db/providers/index.ts` |
| Pricing versions DB types | `packages/db/pricing-versions/index.ts` |
| ModelInfo type + reasoning/features schemas | `packages/models/model-info/index.ts` |
| Model constructor (DB → ModelInfo) | `packages/routing/models/constructor.ts` |
| Endpoint constructor (DB → Endpoint) | `packages/routing/endpoints/constructor.ts` |
| Adapter factory + registry | `packages/router/adapters/adapter-factory.ts` |
| Adapter name enum | `packages/enums/adapters.ts` |
| Provider name enum + slug map | `packages/enums/providers.ts` |
| Model group enum | `packages/enums/model/groups.ts` |
| Modality enums | `packages/enums/model/modality.ts` |
| Parameter enum | `packages/enums/parameters.ts` |
| Quantization enum | `packages/enums/quantizations.ts` |
| Reasoning enums | `packages/enums/reasoning.ts` |
| Variant definitions | `packages/models/variants/shared.ts` |
| Supported parameters logic | `packages/providers/configs/supported-parameters.ts` |
| Provider URL generation | `packages/providers/configs/provider-url.ts` |
| Pricing strategy resolver | `packages/pricing/strategies/get-pricing-strategy.ts` |
| Buddy API routes (create/update model, create endpoint + pricing) | `services/cfw-internal/src/routes/buddy-api/` |
| Buddy API auth middleware | `services/cfw-internal/src/middlewares/buddy-auth.ts` |
| Mission Control server actions | `projects/mission-control/app/actions.ts` |
| Staging workflows | [`staging-workflows.md`](staging-workflows.md) |
| Seed data | `postgres/seeds/` |

---

## 10. Common Patterns and Gotchas

### Provider Model ID

The `provider_model_id` on an endpoint is the model identifier sent to the upstream provider. This often differs from the OpenRouter slug:
- OpenRouter slug: `anthropic/claude-sonnet-4-20250514`
- Anthropic provider_model_id: `claude-sonnet-4-20250514`
- Together provider_model_id: `meta-llama/Llama-4-Scout-17B-16E-Instruct`

If `provider_model_id` is null, the system falls back to the model permaslug.

### Multi-Account Providers ("Anthropic 2", "SambaNova 2", etc.)

Some providers have multiple accounts/deployments. These are identified by `provider_overrides` on the endpoint — the `provider_name` in the DB is the same (e.g., `"Anthropic"`), but `provider_overrides.displayName` and `provider_overrides.slug` distinguish the account:

```json
{ "displayName": "Anthropic 2", "slug": "anthropic/2", "pricingStrategy": "anthropic" }
```

When creating a new endpoint for a multi-account provider, look up the source endpoint's `provider_overrides` via the Buddy API and copy it to the new endpoint.

### Provider-Specific URL Logic

Different providers construct their API URLs differently. The logic is in `packages/providers/configs/provider-url.ts`:
- **Google**: Appends model ID to the URL path
- **Anthropic**: Uses `/messages` endpoint
- **Cohere**: Uses `/chat` endpoint
- **Azure**: Has deployment-specific URLs
- **Most others**: Use standard `/chat/completions`

### Free Variant Rules

Free endpoints (`variant: "free"`) have special rules:
- All pricing fields must be zero — validation will reject non-zero pricing
- They get the slug suffix `:free` (e.g., `meta-llama/llama-4-scout:free`)

### Reasoning Configuration

For models that support reasoning (thinking), you need to configure BOTH:
1. **Model level**: Set `supports_reasoning: true` and populate `features.reasoning_config`
2. **Endpoint level**: Set `supports_reasoning: true` and optionally set `features.reasoning_return_mechanism`

The endpoint's `reasoning_return_mechanism` overrides the model-level default when set.

### Pricing Strategy

The `pricingStrategy` field on providers (or via endpoint `provider_overrides`) determines how `pricing_json` in the pricing_versions table is interpreted. The default is `"openai_chat_completions"`. The strategy is resolved at `packages/pricing/strategies/get-pricing-strategy.ts`.

The strategy must match the SKU items the endpoint's **adapter** emits (`pushUsageSKUItems` in `packages/router/adapters/<provider>/`), not whatever the provider's other endpoints use. An endpoint on a Responses-family adapter emits `openai_responses:*` items, so a converse-style strategy inherited from a sibling never matches them and cached tokens bill at the full input rate. Derive the strategy from the adapter, then discover the SKU keys for that strategy.

### TTS Models

Text-to-speech models have several conventions that differ from standard chat/completion models:

| Field | Value | Notes |
|-------|-------|-------|
| `output_modalities` | `["speech"]` | Persisted value of `OutputModality.TTS`; **not** `["audio"]`, `["tts"]`, or `["TTS"]` |
| `quick_start_example_type` | `"tts"` | Separate enum value; must be set explicitly — not auto-inferred |
| `has_chat_completions` | `false` | TTS uses a different API endpoint |
| `has_completions` | `false` | |
| `provider_overrides.pricingStrategy` | `"tts"` | **Required** — provider default strategy won't work |
| Pricing SKU | `"tts:characters"` | Price per character, not per token |
| Description | Do not mention pricing | Pricing is surfaced in the UI |
| `name` | Do not include date suffix | E.g. `"Mistral: Voxtral Mini TTS"` not `"...2603"` |

**Pricing conversion**: `$X per 1k characters` → `X / 1000` per character as the SKU value string. E.g. `$0.016/1k chars` → `"tts:characters": "0.000016"`.

**Discovering TTS SKU keys**: Use either method from **Discovering SKU keys** above —
- **Method A (authoritative)**: read `packages/pricing/strategies/tts/skus.ts` in [`OpenRouterTeam/openrouter-web`](https://github.com/OpenRouterTeam/openrouter-web) for the full schema.
- **Method B (live clone)**: fetch the raw `pricing_json` from a working TTS sibling via the buddy route, e.g. `curl -s -H "Authorization: Bearer $BUDDY_API_KEY" "https://openrouter.ai/api/v1/internal/buddy/endpoint/<sibling-endpoint-uuid>" | jq '.data.current_pricing_version.pricing_json'`.

### STT Models

Speech-to-text models have several conventions that differ from standard chat/completion models:

| Field | Value | Notes |
|-------|-------|-------|
| `input_modalities` | `["audio"]` | Audio file input |
| `output_modalities` | `["transcription"]` | **Not** `["text"]` or `["audio"]` |
| `has_chat_completions` | `false` | STT uses a different API endpoint |
| `has_completions` | `false` | |

**OpenAI-specific**: OpenAI STT endpoints require additional `provider_overrides`:
- `pricingStrategy: "openai_stt"` — the only STT pricing strategy that currently exists; it is OpenAI-specific
- `baseUrl: "https://api.openai.com/v1/"` — required so the adapter routes to `/audio/transcriptions` instead of `/chat/completions`

For both token-based STT models (e.g. `gpt-4o-transcribe`) and duration-based ones (e.g. `whisper-1`), use either method from **Discovering SKU keys** above — read `packages/pricing/strategies/openai_stt/skus.ts` in [`OpenRouterTeam/openrouter-web`](https://github.com/OpenRouterTeam/openrouter-web) for the authoritative schema, or clone `pricing_json` from a sibling endpoint (hidden or visible) via the buddy `GET /endpoint/{endpointId}` route.

### Parameter Counts Are RAW Integers (NOT Billions)

> ⚠️ **`total_parameters` and `active_parameters` are stored as RAW integer parameter counts — never the billions shorthand.** The DB and UI expect the full integer: a 1T model is `total_parameters: 1000000000000`, a 109B model is `109000000000`, and 32B active is `active_parameters: 32000000000`. Entering the billions shorthand (e.g. `100` for a 100B model, or `1000` meaning 1T) makes the UI interpret the value as that many *individual* parameters and render a near-zero figure like `0.0000001B`. This actually happened — Kimi K2.7 Code was staged with `total_parameters: 1000` (intended 1T) and displayed as `0.000001`. Verified against live prod models: `inclusionai/ring-2.6-1t` stores `1000000000000` / `63000000000`, `nvidia/nemotron-3-ultra` stores `550000000000` / `55000000000`.

### Endpoints Are Created Hidden

All endpoints created via the Buddy API are `hidden: true`. They will not be routed to until a human unhides them in Mission Control. This is intentional — always remind the user after creation.



