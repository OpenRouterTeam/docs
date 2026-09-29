---
name: seed-byteplus-model-launch
description: Launch a Seed / BytePlus (ModelArk) model — Seed LLMs, Seedream image, Seedance video. Covers BytePlus console activation and resource packages, ep- endpoint IDs, the seedModelIdMapping hard-code, the gopomelo metadata API gate, pricing semantics (long-context tiers, per-image, pixel tiers), Buddy staging, and the max_tokens/thinking gotcha.
user-invocable: true
---

# Seed / BytePlus Model Launch

Use this skill when launching any model served by BytePlus through the Seed
provider: Seed LLMs (`seed-2.0-*`, `seed-2.1-*`), Seedream image models,
or Seedance video models. Seed onboarding is not a standard provider flow —
it has a manual console-activation step, a hard-coded endpoint mapping, and a
vendor-controlled metadata API that gates everything downstream.

## Classify the product before doing anything

BytePlus product names do not map one-to-one onto models. For each requested
name, establish what it actually is before staging work:

- **A resolution or request option, not a model.** "Seedance 2.0 4K" is the
  existing Seedance 2.0 model with `resolution: 4K` in the request
  ([docs](https://docs.byteplus.com/en/docs/ModelArk/1520757)). Extending an
  existing endpoint's capabilities is a different task from launching a model.
- **A different BytePlus service entirely.** Seed Audio lives in Seed Speech,
  not ModelArk. It has its own
  [activation page](https://console.byteplus.com/voice/new/setting/activate?projectName=default),
  its own API keys, and none of this skill's ModelArk flow applies — treat it
  as new audio-provider onboarding (`audio-provider-onboarding`).
- **Not released, or doesn't exist.** BytePlus has announced models that were
  not yet activatable ("Seed 2.1 Pro") and named models that turned out not to
  exist ("Seed 2.0 Turbo"). Confirm with the BytePlus contact that the model
  is released and activatable before planning around it.

Also decide slugs up front. BytePlus metadata IDs are not OpenRouter slugs
(`bytedance-seed/seedream4.5` vs slug `bytedance-seed/seedream-4.5`). When a
family ships tiers, every tier is its own model row and carries its tier in
the slug (`seed-2.0-mini` / `-lite` / `-pro`; `seedream-5-0-pro` / `-lite`) —
don't leave one sibling unsuffixed. Permaslug is the slug plus the UTC date
suffix assigned at staging.

Seedance reference-input support is derived from the provider model ID's
generation, not hard-coded to one model ID. Generation 2 and newer IDs support
reference inputs; unrecognized IDs fail closed.

### Seedance 2.5 prep before staging

Collect from the BytePlus contact:

- Released model name; whether it needs its own console activation; whether it needs a fresh resource package.
- The exact vendor provider model ID for the endpoint row's `provider_model_id` (not just the `ep-...` deployment ID).
- The `ep-...` deployment ID.
- Audio and no-audio rate-card prices.
- Supported durations, resolutions, and aspect ratios.
- Supported reference input types (image, audio, and/or video).

## Activate the model in the BytePlus console

1. Get the console login from 1Password and sign in at the
   [ModelArk open-management page](https://console.byteplus.com/ark/region:ark+ap-southeast-1/openManagement?COMPUTER_VISION=%7B%7D&tab=ComputerVision).
2. Under **model activation**, locate and activate the model. If activation
   fails with `No available resource packs`, a Resource Package must be
   purchased first (the minimal one is enough) — BytePlus cannot always do
   this from their side, and each new model generation (e.g. Seedance 2.5)
   may require a fresh effective package at activation time.
3. Under **online inference**, create an endpoint for the model and record
   the `ep-...` ID (e.g. `ep-20260730233431-2ph9m`). BytePlus also exposes a
   default per-model endpoint (e.g. `seed-2-0-code-preview-260328`), but
   existing Seed rows use custom `ep-` IDs — stay consistent. **Seedance is
   the exception:** its endpoint row must carry the vendor model ID form in
   `provider_model_id`, not a bare `ep-` deployment ID, because reference-input
   capability is parsed from that string.

The `ep-` ID is the provider-side deployment identifier, not an API key and
not a model ID. For Seedance, keep it as the mapping's endpoint value; the
endpoint row's `provider_model_id` remains the vendor model ID.

## Wire the endpoint mapping

Add the mapping to `seedModelIdMapping` in
`packages/provider-monitors/configs/seed/index.ts`. The key is **BytePlus's
metadata API model ID** (ask the contact what ID the model will be listed
under — it isn't derivable from our slug in general), and the value is the
`ep-` endpoint ID. Check whether a mapping already exists before adding one.

The mapping can (and often should) land before the metadata is live — it's
inert until the model appears in the API. Seedream vs Seedance vs LLM pricing
branches in `seedSkuPricingMapper` key off whether the mapped `ep-` ID is in
the `/seedream` or `/seedance` slug sets, so a wrong metadata-ID key silently
misprices the model.

## Wait for (or bypass) the metadata API

The Seed monitor polls `https://byteplus.gopomelo.com/byteplus/metadata/v1/models`.
This is the discovery gate, and it is vendor-controlled:

- **Console activation does not put a model in the metadata API.** A model
  can be fully activated with a working `ep-` endpoint and still be invisible
  to OpenRouter. BytePlus must add it; only they can.
- **Only LLM and image-generation models enter the metadata API** per
  BytePlus's stated policy (2026-07). Video models (Seedance) don't —
  BytePlus shares pricing/capabilities directly, and the model must be staged
  manually (Buddy or `stage-endpoint`) from that information. Don't block a
  video launch waiting for metadata, but still check the live API: the
  `seedance-2.0` mapping entry and the Seedance branch in
  `seedSkuPricingMapper` exist so discovery works if the policy changes.
- Fetch the live API and check before concluding anything. A model the
  contact says is "coming to metadata" may take days; models can also appear
  that weren't on the launch list (Seed 2.0 Code did).

Once metadata is live and the mapping exists, the monitor surfaces the model
in the review queue for staging. If it doesn't appear:

- Check `ignored_provider_models` on the Seed provider row — deliberate
  manual staging is sometimes protected by an ignore entry, and an ignored
  model never auto-stages.
- Check for existing hidden or soft-deleted model/endpoint rows. The
  known-endpoint and auto-stage dedup queries filter `deleted = false`, so a
  live-but-hidden row means the fix is unhide, not restage.
- Auto-staging needs a canonical identity; metadata entries without a
  Hugging Face ID (`hugging_face_id: ""`) fall back to manual staging.

**Precedent — seed-2.0-pro (2026-07, double-check current state before
acting on it):** the model was in the metadata with a correct
`openrouter.slug`, yet invisible on the provider page. The model row was
hidden (not deleted), and there were _two_ endpoint rows, both hidden and
soft-deleted — one keyed on the `ep-` ID and one on the raw metadata ID,
the signature of being staged once before and once after the mapping
existed, then backed out. Since the monitor's known-endpoint and dedup
queries ignore deleted rows, the metadata entry still surfaced as `New`
in the review queue (after Run Monitors), and it was restaged via Buddy.
Takeaways: hidden and deleted are different states with different fixes
(unhide vs restage), a backed-out staging usually had a reason — find it
before re-pushing — and the review queue is populated by monitor runs,
not a live view of existing rows.

The provider dashboard at
[openrouter.ai/provider/seed/dashboard](https://openrouter.ai/provider/seed/dashboard)
shows the full metadata-derived list including pre-launch models.

## Get the pricing semantics right

Read `seedSkuPricingMapper` before telling BytePlus what metadata format to
send. The mapper only consumes fields it is coded for:

- **LLM (token) models**: metadata `pricing` may be an array of tiers; the
  second entry with `min_context` maps to the BytePlus long-context SKUs.
  Strategy semantics (`packages/pricing/strategies/byteplus/`): the threshold
  is on prompt tokens, strictly greater-than, and cliff-priced (the whole
  request bills at the long-context rate once crossed). Zero-cost cache reads
  must be explicit `"0"` values — an omitted cached SKU falls back to the full
  prompt price. There is no cache-write SKU; representing a nonzero
  cache-write price would need a code change.
- **Seedream (image) models**: the mapper reads base-tier `completion` as the
  flat per-image price. Vendor-invented pricing keys
  (`output_image_lte_2_36m_pixels`, `input_image_from_second`) are ignored.
  In BytePlus's 4.5-style payloads, `image` and `request` are the same
  per-image charge stated twice, not additive.
- **Seedance (video) models**: base-tier `completion` maps to video tokens.
- **Pixel-tiered image pricing** (Seedream 5.0 Pro): flat per-image doesn't
  fit. PR [#31469](https://github.com/OpenRouterTeam/openrouter-web/pull/31469)
  merged as `147f98878f8`; tiered billing is opt-in per model slug and uses
  returned `data[].size`, not the requested size. Nail down the exact boundary
  and inclusivity with the vendor (5.0 Pro: 2,360,000 px, inclusive on the
  cheap side) before wiring SKUs. Prefer
  structured tier values in metadata over thresholds encoded in key names,
  so vendor price changes don't require code changes.

Always verify our public price against the provider's rate card before
launch, and hold pricing staging while the vendor's rate card is unsettled —
pricing versions apply immediately and can't be deleted via Buddy.

## Model-specific constraints and gotchas

- **Output-size and request policy is per model slug**
  (`seedreamOutputSizePolicyByModelSlug` in
  `packages/image-generation/adapters/seedream/seedream-common.ts`). Seedream
  4.5 rejects outputs below 3,686,400 px. Seedream 5.0 Pro accepts
  921,600–4,624,220 px and omits `sequential_image_generation` entirely.
  Seedream 5.0 Lite accepts 3,686,400–16,777,216 px and uses
  `sequential_image_generation:"disabled"` for one image, or `"auto"` with
  nested `sequential_image_generation_options.max_images` for multiple images.
  A model absent from the policy map defaults to `"disabled"` and receives no
  pixel validation. Add every new Seedream sibling to the policy map before
  staging its endpoint row. Capabilities like `4K` belong on the endpoint row,
  not hardcoded in the adapter.
- **`max_tokens` vs thinking tokens.** BytePlus thinking models treat
  `max_tokens` as a visible-content cap; reasoning tokens are unbudgeted but
  still billed in `completion_tokens`, so a `max_tokens: 500` request can
  bill ~4,000 tokens and fail the baseline max-tokens test. The fix is the
  `requiresMaxCompletionTokens` remap in
  `packages/router/adapters/openai/serialize-chat-request.ts`, which sends
  `max_completion_tokens` upstream instead. The BytePlus adapter is opted in
  adapter-wide via `MAX_COMPLETION_TOKENS_ADAPTERS`, so Seed models get the
  remap automatically — no per-permaslug entry needed. Tradeoff: thinking
  then shares the budget, so tiny caps can return empty content with
  `finish_reason: length`.
- **Chat-completions vs images path.** The internal-stream Seedream path bills
  through `buildSeedreamSkuItems` using returned `responseSizes` (PR #31469,
  merged as `147f98878f8`), so pixel-tiered models retain returned size
  information on that path.

## Verify before unhide

- Metadata entry, mapping key, and `ep-` ID agree end to end.
- A real request routes to Seed with the correct `ep-` upstream ID and
  returns real output (image/video/completion — HTTP 200 alone is not enough).
- Baseline tests pass, including max-tokens for thinking models.
- Billed cost matches the provider rate card for a known request shape.

## Precedents

- [Seed new-models status tracker thread](https://openrouter.slack.com/archives/C0BB2TQ657D/p1785429666094829)
  — running per-model status for the 2026-07 Seed batch (metadata pending,
  staging, waiting-for-release), kept updated by the launch owner.
- [Seedream 5.0 Pro / Seedance 2.0 activation and metadata thread](https://openrouter.slack.com/archives/C09JB1T0E69/p1783509183970669)
  — resource packs, product classification, metadata negotiation, tier pricing.
- [Seedream 5.0 Pro tiered-pricing build thread](https://openrouter.slack.com/archives/C07UF9XLTFF/p1785424581421089)
  — slug suffix decision, tier boundary confirmation, PR #31469 review loop.
- [Seed 2.0 Code staging thread](https://openrouter.slack.com/archives/C0AQRAP6N69/p1785437204182319)
  — Buddy staging from metadata, long-context pricing feasibility; adapter-wide `max_completion_tokens` opt-in landed in commits `1548faf223`, `a9268a8288`.
- PR [#31438](https://github.com/OpenRouterTeam/openrouter-web/pull/31438):
  Seed 2.0 Code `seedModelIdMapping` entry.

## Related skills

- `add-provider-monitor`: how monitors and SKU pricing mappers work generally.
- `stage-endpoint`: local model/endpoint staging.
- `buddy`: staging the confirmed fields in prod through the Buddy API.
- `audio-provider-onboarding`: for Seed Audio / Seed Speech.

## Improve this skill

Apply the universal checklist in `.agents/skills/AGENTS.md`. BytePlus's
metadata behavior and pricing formats are actively evolving (structured tier
values were agreed but not yet shipped as of 2026-07); update this file as
they land.
