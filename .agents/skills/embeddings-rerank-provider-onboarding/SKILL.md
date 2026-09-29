---
name: embeddings-rerank-provider-onboarding
description: Recipe for onboarding a provider serving embeddings and/or rerank models, from provider foundation through adapter, pricing, staging, and launch verification.
user-invocable: true
---

# Embeddings/Rerank Provider Onboarding

Use this skill for a provider serving the dedicated rerank API, or for the
shared provider foundation when onboarding both modalities. For the
embeddings-specific phases (research, adapter, staging, and e2e testing),
use the `embeddings-provider-onboarding` family
(`.agents/skills/embeddings-provider-onboarding/SKILL.md`); this skill
remains authoritative for the provider foundation, the rerank adapter path,
pricing, monitors, and launch sequencing.

## Scope gate

This is **not** the chat/router path. Do not start with
`add-provider-adapter`: that skill targets sync inference adapters in
`packages/router/adapters/`. The dedicated workers are
`services/cfw-embeddings-api` and `services/cfw-rerank-api`, and the request
types are `ApiType.Embeddings` and `ApiType.Rerank` in
`packages/enums/api-type.ts`. Seed each model's output modality as
`embeddings` or `rerank`; those values are `OutputModality.Embeddings` and
`OutputModality.Rerank` in `packages/enums/model/modality.ts`.

This skill owns the modality adapters, provider foundation, pricing, monitor,
staging, and verification. The sync-inference monitor/adapter recipes are
useful only as generic repository background; they are not the implementation
path for these workers.

## Before coding

1. Capture real request/response fixtures from the live upstream API; the
   Response-shape gotchas below cover Zod validation and normalization.
2. Decide the naming triple before adding identity: enum identifier, database
   `display_name`, and provider slug. The enum and generated SDK casing are
   not interchangeable; changing names later creates database, generated-code,
   and endpoint churn. Provider display name and `base_url` are hydrated from
   the database row by `getProviderInfoFromDB` in `packages/providers/index.ts`.

## Provider foundation

For a new provider, add the following in one foundation layer:

- `ProviderName.<Provider>` in `packages/enums/providers.ts`, plus the slug in
  the provider slug map (for example, the existing `ProviderName.VoyageAI`
  entries in `packages/enums/providers.ts`).
- The API key in `packages/providers/env.ts`, the provider lookup in
  `packages/providers/configs/api-key.ts`, and every required Infisical
  manifest scope in `env.manifest.json`. The current pattern is the
  `VOYAGEAI_API_KEY` entries in `packages/providers/env.ts`,
  `packages/providers/configs/api-key.ts`, and `env.manifest.json`. Follow
  `scripts/infisical/INFISICAL.md` for path semantics; do not
  put secret values in tracked files.
- An icon case (or explicit `undefined`) in
  `packages/providers/configs/icons.ts`.
- A model-author icon for each new author slug: an `authorIconMap` entry in `packages/frontend/components/ui/Icons/icon-infos.ts` or `icon_uri` on the `model_authors` row. The provider icon above does not cover the model card, which otherwise renders the Hugging Face favicon.
- The database provider row, including `display_name`, `permaslug`, and
  `base_url`; generic URL builders use the DB base URL and append
  `/embeddings` or `/rerank` in `getEmbeddingsURL` and `getRerankURL`
  (`packages/providers/configs/provider-url.ts`).

Keep `internalProviderNames` and `managedOnlyProviders` distinct:

- `internalProviderNames` hides providers from dropdowns, presets, and BYOK
  while retaining backend routing/API-key/endpoint support
  (`packages/enums/providers.ts`).
- `managedOnlyProviders` is the BYOK eligibility gate; it feeds
  `byokProviders` in the same file. Ungating is a
  separate product decision and code change to coordinate with seeding.

## Adapter layer

Implement each in its modality-specific directory:

- Embeddings: `packages/embeddings/adapters/<provider>/`.
- Rerank: `packages/rerank/adapters/<provider>/`.

Register every adapter in both places:

1. `packages/{embeddings,rerank}/adapters/adapter-factory.ts`.
2. `packages/{embeddings,rerank}/configs/get-adapter-name.ts`.

Keep the adapter-name enums in `packages/enums/adapters.ts`, not beside the
factory (`EmbeddingsAdapterName` and `RerankAdapterName`).
The live registrations are `embeddingsAdapterFactory` in
`packages/embeddings/adapters/adapter-factory.ts` and `rerankAdapterFactory`
in `packages/rerank/adapters/adapter-factory.ts`.

A provider may need more than one adapter. The provider default can serve the
common path while a specific endpoint selects another adapter through the
database `adapterName` override; for example, one provider's text adapter can
be the default while its multimodal adapter is selected explicitly: see
`getEmbeddingsAdapterName` in `packages/embeddings/configs/get-adapter-name.ts`
and its `honors an explicit embeddings adapter override` test in
`packages/embeddings/configs/get-adapter-name.test.ts`.

Use these templates:

- Cohere for a Cohere-shaped, text-only `/rerank`: request and `results`/`meta`
  response handling are `CohereRerankResponseSchema` and `CohereRerankAdapter`
  in `packages/rerank/adapters/cohere/index.ts`.
- NVIDIA when one provider serves both modalities:
  `packages/embeddings/adapters/nvidia/` and
  `packages/rerank/adapters/nvidia/`.
- A recent end-to-end provider example:
  `packages/embeddings/adapters/voyage/`,
  `packages/embeddings/adapters/voyage-multimodal/`, and
  `packages/rerank/adapters/voyage/`.

### Response-shape gotchas

- Do not assume a provider's response shape from another integration. Some
  rerank providers return `data[].relevance_score` and `usage.total_tokens`
  (for example, `VoyageRerankResponseSchema` in
  `packages/rerank/adapters/voyage/index.ts`) rather than
  Cohere's `results`/`meta`.
- Some embeddings providers return `usage.total_tokens`; normalize it to both
  `prompt_tokens` and `total_tokens` (for example,
  `packages/embeddings/adapters/voyage/index.ts`). If an
  upstream omits `prompt_tokens`, make this normalization explicit rather than
  billing zero; the shared embeddings finalizer expects the canonical pair
  (`rawUsage` in `packages/embeddings/adapters/base.ts`).
- Translate provider parameter names at the adapter boundary. Common launch
  drifts include `top_n` → `top_k` for rerank and `dimensions` →
  `output_dimension` for embeddings; for example, the request mappings in
  `VoyageRerankAdapter` (`packages/rerank/adapters/voyage/index.ts`) and
  `VoyageEmbeddingsAdapter` (`packages/embeddings/adapters/voyage/index.ts`).
- If the response is nested or list-of-lists (for example contextualized chunk
  embeddings), it does not fit the flat OpenAI-compatible surface. Present
  the shape options to the owner and default to deferring rather than silently
  flattening; the canonical flat response contract is enforced by
  `transformResponse` in `packages/embeddings/adapters/base.ts`.

## Static monitor

If the provider has no usable upstream `/models` endpoint, use
`StandardMonitor` with `modelsUrl = undefined` and a hand-maintained
`staticResponse`. Copy the canonical `amazonBedrockMonitor` pattern in
`packages/provider-monitors/configs/amazon-bedrock/index.ts`; the
current Voyage example is `voyageAIMonitor` in
`packages/provider-monitors/configs/voyageai/index.ts`.
Register it in `packages/provider-monitors/configs/all/index.ts`.

Monitor visibility is independent of provider visibility gates. A registered
monitor still needs a provider DB row: `StandardMonitor` returns an error from
`getProviderInfo` or `getProvider` when lookup fails
(`packages/provider-monitors/classes/standard.ts`), so it
will error-log every cycle until the row is seeded.

When stacked PRs touch the same static monitor file, resolve conflicts by
keeping the union of model entries. Do not discard another layer's models;
use the current static list as the reference for the expected shape (for
example, `staticModels` in `packages/provider-monitors/configs/voyageai/index.ts`).

## Pricing

Pricing is code, not only endpoint metadata. Add or reuse a strategy under
`packages/pricing/strategies/` and register its name in
`PricingStrategyName` (`packages/enums/pricing-strategy.ts`). The current modality names are
`OpenAIEmbeddings` and `Rerank`; a multimodal embeddings strategy is also
registered (for example, `VoyageMultimodalEmbeddings`). Dispatch imports the
implementations in
`packages/pricing/strategies/get-pricing-strategy.ts`.

Implement the required strategy surface: `schema`,
`getFinalUsageResponse`, `getPublicPricing`, and `getCacheUsage`
(`packages/pricing/strategies/base.ts`). A rate-card axis with
no corresponding strategy SKU—for example image pixels alongside text
tokens—requires a new strategy PR; do not hide it in a generic token strategy.
Buddy validates strategy names against deployed code.

Rerank can bill search units **or** input tokens. Confirm the provider's actual
rate card and configure the matching axis; the shared strategy supports both
(`RerankSKU.SearchUnits` handling in
`packages/pricing/strategies/rerank/strategy.ts`). If usage fields are
absent, the fallback estimates search units only
(`ceil(documents.length / 100)`) and applies only to search-unit rate cards;
cost enrichment is skipped when `responseData.usage` is absent. A token-billed
provider that omits usage therefore silently bills `$0`, so verify billed cost
on a real request rather than trusting the fallback
(`searchUnits`, `totalTokens`, and `transformResponse` in
`packages/rerank/adapters/base.ts`).

## Sequencing and launch gates

Use this PR order:

1. Provider foundation: identity, credentials, icon, monitor, DB/seed inputs,
   and required generated surfaces.
2. One adapter layer per modality, each with focused unit tests and fixtures.
3. Pricing strategy/SKUs, if the existing strategy cannot represent the rate
   card; otherwise wire the existing strategy.

Merge **and deploy** the foundation, adapter, and pricing code before Buddy
creates or unhides endpoints. Keep the dependency order explicit:
`provider foundation → per-modality adapter → pricing strategy`. The endpoint
row's pricing strategy must be present at creation time to avoid a $0-billing
window.

### Speakeasy regeneration

Use the Speakeasy version pinned in the relevant generated SDK's
`.speakeasy/workflow.yaml`; the repository rule requires matching that version
(`packages/sdk-generation/AGENTS.md`).
For the current surfaces, use:

- `bun run generate:openapi`.
- `bun run generate:management-sdk` (`packages/management-sdk/AGENTS.md`).
- `bun run regen` in `services/cfw-mcp` after the required OpenAPI input is
  present (`regen` in `services/cfw-mcp/scripts/regen.ts`).

An auto-upgraded CLI can rewrite hundreds of unrelated generated files. If
that happens, drop the bad regeneration commit and redo it with the pinned
version. Generated identifiers are auto-cased from the provider slug; a slug
like `voyageai` generates `Voyageai`. Never hand-edit generated code just to
change casing.

## Verification and follow-ons

1. Run `stage-endpoint` for local endpoint creation and staging
   (`.agents/skills/stage-endpoint/SKILL.md`; its seed CSVs are read-only and
   it owns that workflow).
2. Run `embeddings-e2e-testing` for embeddings and the equivalent focused
   rerank tests through the local worker
   (`.agents/skills/embeddings-e2e-testing/SKILL.md`).
3. Use `buddy` for production staging
   (`.agents/skills/buddy/SKILL.md`).
4. After launch, use `multimodal-daily-report`
   (`.agents/skills/multimodal-daily-report/SKILL.md`) for the embeddings and
   rerank adoption signals.
