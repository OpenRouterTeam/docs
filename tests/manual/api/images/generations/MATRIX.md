# Image Generation API — Test Matrix

The durable, versioned matrix of every image adapter: the models it serves, the
parameters those models accept, and the live cases that exercise them. This is
the source of truth for the GA exhaustive sweep; it lives in the repo so it
survives ticket closure.

## How this file stays current

- **Generated tables** (labelled _generated_) come from the live discovery API
  (`GET /api/v1/images/models` + `/{slug}/endpoints`), which is authoritative for
  model capabilities. Do not edit them by hand — run
  `bun scripts/ci/generate-image-matrix.ts` (add `--check` to detect
  drift). The `sync-image-matrix` workflow runs this on demand and opens a PR when
  live capabilities have drifted.
- **Everything else is hand-authored judgment** — inventory notes, the parameter
  surface, sweep cases, the validation contract, and run history.
- **A new adapter or advertised passthrough key cannot silently skip coverage.**
  The gate `adapter-coverage.test.ts` fails until every
  `ImageGenerationAdapterName` member has a live case (in `cases.ts`) or a
  documented exemption (in `coverage.ts`), and every generated
  `allowed_passthrough_parameters` entry has a matching live/manual case field.
  The `check-image-adapter-coverage` workflow runs it on PRs that touch the
  adapter enum or this directory.

### Information flow

```text
                       LIVE DISCOVERY API  (what model capabilities exist)
                       GET /api/v1/images/models + /{slug}/endpoints
                                    │ read by
                                    ▼
   generate-image-matrix.ts ──run by──▶ sync-image-matrix.yaml (manual; opens drift PR)
        │ rewrites only BEGIN/END:GENERATED blocks
        ▼
   MATRIX.md   generated tables  ← auto; never hand-edit
               prose + sweep plan + run history  ← hand-edit when design changes

   adapters.ts ─add adapter─┐
   cases.ts ───add case─────────────┤ paths-filter →  adapter-coverage.test.ts  (free, per-PR)
   coverage.ts ─map/exempt + opts───┘                 fails unless every enum member
                                                       has a case OR exemption, and every
                                                       advertised passthrough key has a case field

   e2e-matrix.test.ts ─reads CASES─▶ live paid run (manual; never in CI)
        ├─ submits each case, asserts image + (managed) cost parity
        ├─ polls GET /api/v1/generation to confirm billing settled
        └─ writes runs/<date>-<env>.json when RECORD_RUN=true
```

| File | Generated / hand | Edit it when… |
| --- | --- | --- |
| `MATRIX.md` generated blocks | generated | never by hand — the sync workflow PRs them |
| `MATRIX.md` prose / sweep plan | hand | the testing strategy or a standing finding changes |
| `cases.ts` | hand | adding or changing a live test case |
| `coverage.ts` | hand | a new adapter needs mapping/exemption, or generated passthrough allowlists drift |
| `runs/<date>-<env>.json` | generated | never by hand — the harness writes it on `RECORD_RUN=true` |
| `generate-image-matrix.ts` | hand | the discovery API shape or a table's format changes |

Design rationale for the unified config surface — the graduation rule,
OpenAI-compat tensions, sizing divergence — lives in the Notion doc "Image Gen —
Unified Config API Design".

Generated tables last synced from live prod: 2026-07-26.

---

## Adapter inventory

`ImageGenerationAdapterName` → default prod model → execution mode → BYOK.

| Adapter (enum) | Default model slug | Exec | BYOK | Notes |
| --- | --- | --- | --- | --- |
| `SeedreamImageAdapter` | `bytedance-seed/seedream-4.5` | sync | managed-only | watermark via `provider.options.seed`; seedream-4.5 fail-fast rejects outputs < 3,686,400 px (ECO-2189) |
| `XaiImageAdapter` | `x-ai/grok-imagine-image-quality` | sync | BYOK + managed | rejects `512` |
| `RecraftImageAdapter` | `recraft/recraft-v4` | sync | managed-only | controls via `provider.options.recraft` |
| `BlackForestLabsImageAdapter` | `black-forest-labs/flux.2-pro` | async (poll) | managed-only | rejects webp and `n>1`; returns fractional token counts |
| `BlackForestLabsFlux3ImageAdapter` | `black-forest-labs/flux-3-image` | async (poll) | managed-only | resolution tiers 768/1K/1.5K/2K/4K (`512` → 400); up to 10 references; rejects `n>1`; no `seed` |
| `SourcefulImageAdapter` (V1) | _none live_ | async (poll) | managed-only | no live prod model (`riverflow-v2-*-preview` deprecated); skipped, exempt in `coverage.ts` |
| `SourcefulV2ImageAdapter` | `sourceful/riverflow-v2-pro` | async (poll) | managed-only | rejects `512` |
| `SourcefulV25ImageAdapter` | `sourceful/riverflow-v2.5-pro` | async (poll) | managed-only | resolution gate pro=[1K,2K,4K] / fast=[1K,2K] |
| `OpenAIImageAdapter` | `openai/gpt-5-image` | sync (+ stream) | BYOK + managed | streams (`supports_streaming`), as does Quiver for text-to-SVG; multi-image (`n` up to 10); does not advertise `output_format`. Also serves the direct `openai/gpt-image-{1,1-mini,1.5,2}` slugs (ECO-1503), which call the Images API without the Responses/LLM wrapper; `gpt-image-2` supports `transparent` background once its endpoint row advertises it |
| `GoogleAIStudioGeminiImageAdapter` | `google/gemini-2.5-flash-image` | sync | BYOK + managed | Gemini via AI Studio |
| `GoogleVertexGeminiImageAdapter` | `google/gemini-2.5-flash-image` | sync | BYOK + managed | same models via Vertex; reached by a provider flip, exempt in `coverage.ts` |
| `AzureMAIImageAdapter` | `microsoft/mai-image-2.5` | sync | BYOK | Azure BYOK suspected broken (ECO-1139) |
| `KreaImageAdapter` | `krea/krea-2-medium-turbo` | async (poll) | managed-only | resolution 1K only; ZDR requires data-URI assets for i2i / style refs; moodboard/style preset ids are account-scoped |
| `QuiverImageAdapter` | `quiver/arrow-1.1` | sync + stream (text-to-SVG only) | managed verified; BYOK not tested | SVG text generation (sync + SSE streaming) + raster vectorization (sync only; streaming rejected with 400); all paths verified on a local seeded stack before prod discovery sync (streaming + billing re-verified 2026-07-08) |

Override a case's model with `IMAGE_GENERATION_MODEL_<ADAPTER_UPPER_SNAKE>` (e.g.
`IMAGE_GENERATION_MODEL_BLACK_FOREST_LABS`).

---

## Models _(generated)_

One row per live model slug — the full surface the sweep must cover, not just the
inventory defaults above. Gemini families carry two endpoint rows (Vertex + AI
Studio) with identical capabilities. `aspect_ratios` is a count; the exact value
sets are below under per-model capabilities.

<!-- BEGIN:GENERATED:matrix-models -->
| Model slug | Live endpoints | n max | input_refs max | resolutions | aspect_ratios | output_formats | streaming |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `black-forest-labs/flux.2-flex` | black-forest-labs/us-3 | 1 | 8 | — | 9-value set | png/jpeg | — |
| `black-forest-labs/flux.2-klein-4b` | black-forest-labs | 1 | 4 | — | 9-value set | png/jpeg | — |
| `black-forest-labs/flux.2-max` | black-forest-labs/us-3 | 1 | 8 | — | 9-value set | png/jpeg | — |
| `black-forest-labs/flux.2-pro` | black-forest-labs | 1 | 8 | — | 9-value set | png/jpeg | — |
| `bytedance-seed/seedream-4.5` | seed | 10 | 14 | 1K,2K,4K | 18-value set | — | — |
| `google/gemini-2.5-flash-image` | google-ai-studio, google-vertex/global | 1 | 3 | — | 10-value set | — | — |
| `google/gemini-3-pro-image` | google-ai-studio/global, google-vertex/global | 1 | 14 | 1K,2K,4K | 10-value set | — | — |
| `google/gemini-3-pro-image-preview` | google-ai-studio/global, google-vertex/global | 1 | 14 | 1K,2K,4K | 10-value set | — | — |
| `google/gemini-3.1-flash-image` | google-ai-studio, google-vertex/global | 1 | 14 | 512,1K,2K,4K | 14-value set | — | — |
| `google/gemini-3.1-flash-image-preview` | google-ai-studio, google-vertex/global | 1 | 14 | 512,1K,2K,4K | 14-value set | — | — |
| `google/gemini-3.1-flash-lite-image` | google-ai-studio, google-vertex/global | 1 | 14 | 1K | 14-value set | — | — |
| `krea/krea-2-large` | krea | — | 1 | 1K | 7-value set | — | — |
| `krea/krea-2-medium` | krea | — | 1 | 1K | 7-value set | — | — |
| `krea/krea-2-medium-turbo` | krea | — | 1 | 1K | 7-value set | — | — |
| `microsoft/mai-image-2.5` | azure | 1 | 1 | — | 8-value set | — | — |
| `microsoft/mai-image-2.5-pro` | azure | 1 | 1 | — | 8-value set | — | — |
| `openai/gpt-5-image` | openai | 10 | 16 | — | — | — | ✅ |
| `openai/gpt-5-image-mini` | openai | 10 | 16 | — | — | — | ✅ |
| `openai/gpt-5.4-image-2` | openai | 10 | 16 | — | — | — | ✅ |
| `openai/gpt-image-1` | openai | 10 | 16 | — | 4-value set | — | ✅ |
| `openai/gpt-image-1-mini` | openai | 10 | 16 | — | 4-value set | — | ✅ |
| `openai/gpt-image-2` | openai | 10 | 16 | — | 9-value set | — | ✅ |
| `recraft/recraft-v3` | recraft | 6 | 1 | — | 6-value set | — | — |
| `recraft/recraft-v4` | recraft | 6 | 1 | — | 6-value set | — | — |
| `recraft/recraft-v4-pro` | recraft | 6 | 1 | — | 6-value set | — | — |
| `recraft/recraft-v4-pro-vector` | recraft | 6 | 1 | — | 6-value set | — | — |
| `recraft/recraft-v4-vector` | recraft | 6 | 1 | — | 6-value set | — | — |
| `recraft/recraft-v4.1` | recraft | 6 | 1 | — | 6-value set | — | — |
| `recraft/recraft-v4.1-pro` | recraft | 6 | 1 | — | 6-value set | — | — |
| `recraft/recraft-v4.1-pro-vector` | recraft | 6 | 1 | — | 6-value set | — | — |
| `recraft/recraft-v4.1-utility` | recraft | 6 | 1 | — | 6-value set | — | — |
| `recraft/recraft-v4.1-utility-pro` | recraft | 6 | 1 | — | 6-value set | — | — |
| `recraft/recraft-v4.1-vector` | recraft | 6 | 1 | — | 6-value set | — | — |
| `sourceful/riverflow-v2-fast` | sourceful | 1 | 4 | 1K,2K,4K | 9-value set | — | — |
| `sourceful/riverflow-v2-pro` | sourceful | 1 | 10 | 1K,2K,4K | 9-value set | — | — |
| `sourceful/riverflow-v2.5-fast` | sourceful | 1 | 4 | 1K,2K | 9-value set | jpeg | — |
| `sourceful/riverflow-v2.5-pro` | sourceful | 1 | 10 | 1K,2K,4K | 9-value set | png/jpeg/webp | — |
| `x-ai/grok-imagine-image-quality` | xai | 1 | 3 | 1K,2K | 14-value set | — | — |
<!-- END:GENERATED:matrix-models -->

- **Recraft** is 11 endpoints sharing one capability set — sweep a representative
  subset (one base, one pro, one vector, one utility) unless a divergence appears.
- **Gemini** spans `google-vertex/global` + `google-ai-studio` per family,
  selected via account-level ignored-providers flips or a per-provider BYOK key.

---

## Request parameter surface

From `packages/image-generation/schemas/request.ts`. "Advertised" = appears in a
model's `supported_parameters` on the discovery API; adapters return 400 on
out-of-range values when a capability schema is staged.

| Param | Type | Range / values | Sweep dimension |
| --- | --- | --- | --- |
| `prompt` | string | min 1 (trimmed) | fixed control prompt |
| `n` | int | 1–10; single-image adapters cap at 1 | `1`, then max-supported, then `cap+1` (expect 400) |
| `quality` | enum | `auto`\|`low`\|`medium`\|`high` | each value (OpenAI/Azure honor; others ignore) |
| `background` | enum | `auto`\|`transparent`\|`opaque` | all three; `transparent` requires an alpha format |
| `output_format` | enum | `png`\|`jpeg`\|`webp` | each; expect 400 where unadvertised (BFL rejects webp; OpenAI advertises none; Sourceful V2.5 fast only jpeg, pro png/jpeg/webp) |
| `output_compression` | int | 0–100 | `0`, `50`, `100` (jpeg/webp only) |
| `aspect_ratio` | enum | per-adapter subset (see below) | every advertised value + one that isn't (expect 400) |
| `resolution` | enum | `512`\|`768`\|`1K`\|`1.5K`\|`2K`\|`4K` | each advertised tier + one gated (expect 400) |
| `size` | string | free-form: `1024x1024`, `2K`, casing | pixels, tier, mixed casing |
| `seed` | int | any | fixed seed twice → determinism check (BFL/Seedream) |
| `stream` | boolean | OpenAI + Quiver (text-to-SVG) | `true` (SSE) + `false`; Quiver vectorization rejects `true` with 400; other adapters ignore |
| `input_references` | array | per-adapter max (the `input_refs max` column above) | 1 ref, max refs, max+1 (expect 400), multi-ref |
| `provider.options.<slug>` | object | passthrough allowlist (below) | every advertised key (statically gated) + one unknown |

The capability gate (`from-db.ts`) is a **non-strict** Zod object: it strips
unknown keys rather than rejecting, so `provider.options` never 400s and the
passthrough allowlist is advisory. Whether an unknown key is honored is an
adapter/upstream concern — flag silent-accepts (ECO-948).

---

## Per-model capabilities

Limits that vary by `provider_model_id`; the sweep must use the right model id to
hit each branch. Input-reference caps and resolution tiers are in the generated
Models table above; the value sets that the table only counts are spelled out
here.

**Aspect-ratio sets** (the table shows only a count):

- **BFL FLUX.2** (Pro / Flex / Max / Klein) — 1:1, 4:3, 3:4, 3:2, 2:3, 16:9,
  9:16, 21:9, auto. Bare ratio shapes to 1K-class pixels (e.g. 16:9 → 1824×1024,
  21:9 → 2400×1024); `auto` → 1024×1024.
- **BFL FLUX.3** (`flux-3-image`) — 16-value set: 21:9, 2:1, 16:9, 3:2, 7:5, 4:3,
  5:4, 1:1, 4:5, 3:4, 5:7, 2:3, 9:16, 1:2, 9:21, auto. Output shape comes from
  the resolution tier (768 / 1K / 1.5K / 2K / 4K) plus the ratio, never a pixel
  `size`; 4K takes ~7 minutes upstream.
- **OpenAI GPT Image 2** (`openai/gpt-image-2`) — 1:1, 3:2, 2:3, 4:3, 3:4, 16:9,
  9:16, 21:9, auto. Exact shaped pixels on a 1536 long edge (e.g. 16:9 →
  1536×864, 21:9 → 1536×656); `auto` is provider-chosen.
- **OpenAI GPT Image 1 / Mini** — 1:1, 3:2, 2:3, auto. Maps to the fixed triple
  1024×1024 / 1536×1024 / 1024×1536; `auto` lands on 1536×1024 in live runs.
- **OpenAI Responses wrappers** (`gpt-5-image*`, `gpt-5.4-image-2`) — no
  dedicated-API `aspect_ratio` advertisement; ratio goes via `image_config` on
  the Responses/chat path when applicable.
- **Seedream** — 18-value superset (the common set plus 9:19.5, 19.5:9, 9:20,
  20:9, 9:21, 21:9, auto).
- **xAI** — 1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 9:19.5, 19.5:9, 9:20, 20:9, 1:2,
  2:1, auto.
- **Azure MAI** — 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, auto.
- **Gemini** — 10-value base set; `gemini-3.1-flash` adds 1:4, 4:1, 1:8, 8:1.
- **Recraft** — 1:1, 4:3, 3:4, 16:9, 9:16, auto.
- **Sourceful V2 / V2.5** — 1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16, 21:9, auto
  (same 9-value set as BFL).
- **Krea 2** — 1:1, 4:3, 3:2, 16:9, 4:5, 2:3, 9:16 (no `auto`).

Values outside an adapter's set should clamp or 400 per its capability schema;
sweep one out-of-set ratio per adapter to confirm the gate.

**Gemini is per-model, not one shared set:**

- `gemini-2.5-flash-image` — no resolution control; refs ≤3.
- `gemini-3-pro-image` — resolutions 1K,2K,4K; refs ≤14.
- `gemini-3.1-flash-image` — adds `512` resolution and 4 aspect ratios; refs ≤14.

**Sourceful V2.5 resolution gate** — pro allows 4K, fast does not; the gate also
fires for the size-derived `size: "4K"` path.

### `allowed_passthrough_parameters` per provider _(generated)_

What each endpoint advertises as its `provider.options.<slug>` allowlist.
Advisory only (the gate strips unknown keys rather than rejecting):

<!-- BEGIN:GENERATED:matrix-passthrough -->
- **azure**: _none_
- **black-forest-labs**: `guidance`, `safety_tolerance`, `steps`
- **black-forest-labs/us-3**: `guidance`, `safety_tolerance`, `steps`
- **google-ai-studio**: `cachedContent`
- **google-ai-studio/global**: `cachedContent`
- **google-vertex/global**: `cachedContent`
- **krea**: `complexity`, `creativity`, `image_style_references`, `intensity`, `moodboards`, `movement`, `strength`, `styles`
- **openai**: `moderation`
- **recraft**: `controls`, `style`, `text_layout`
- **seed**: _none_
- **sourceful**: `font_inputs`
- **xai**: _none_
<!-- END:GENERATED:matrix-passthrough -->

The runner deliberately sends some `provider.options` keys that are NOT in these
allowlists (Seedream `seed.watermark`, Recraft `strength`, Sourceful
`thinkingLevel`) — because the gate is non-strict, these pass through to the
adapter, and the live run shows whether the adapter honors them.

`coverage.ts` mirrors this generated block in `ADVERTISED_PASSTHROUGH_COVERAGE`,
and `adapter-coverage.test.ts` asserts every
`provider.options.<slug>.<parameter>` entry appears in at least one `cases.ts`
field. When discovery adds or removes an allowlist key, the drift PR must update
the static coverage list and add, remove, or intentionally reshape the matching
live/manual case.

---

## Sweep cases

What the live runner covers today and what the exhaustive sweep still needs. The
cases themselves are in `cases.ts`; this is the planning view.

| Adapter | Covered | Gaps to add |
| --- | --- | --- |
| Seedream | resolution, aspect_ratio, seed, n, `opt.seed.watermark`, i2i, determinism, min-pixel fail-fast on seedream-4.5 (ECO-2189: `size:1024x1024`, `1K+1:1` →400 with size- vs resolution-aware remedy; default/`2048x2048`/bare `16:9` →200; 2026-07-26 prod ad-hoc; `2K+21:9` / `size:2K+21:9` were →400 then but are now raised to `2934×1258`; raised shapes accepted upstream, 2026-07-28 direct captures) | resolution sweep (1K/4K), full aspect set; promote min-pixel error cases into `cases.ts`; bare-tier-without-ratio bypass still deferred; re-verify raised 2K shapes through the OR path once deployed (upstream acceptance already captured directly, 2026-07-28) |
| xAI | resolution(1K), aspect_ratio(16:9), 512→400, i2i | full aspect set, 2K, BYOK, output_format |
| Recraft | aspect_ratio, n + boundary(7→400), `opt.recraft.controls/style/text_layout`, v3 variant, i2i | full aspect set, output_format, vector/utility variants |
| BFL | size, seed, output_format(png), `opt.steps/guidance/safety`, determinism, ref-cap(9→400), i2i, full aspect set (all 4 FLUX.2 slugs × 9 ratios, 2026-07-26 prod ad-hoc) | flex(8)/klein(4) ref boundaries, size tiers, unknown opt key; promote ad-hoc aspect cases into `cases.ts` |
| BFL FLUX.3 | resolution(1.5K)+aspect_ratio(9:21), 512→400, n=2→400 (asserts the capability gate's `must be exactly 1`, which needs the seeded `n` 1–1 range; the adapter-only path says `n must be 1`), i2i (2 refs) | ref-cap boundary (10 ok / 11→400), 4K (~7 min upstream), remaining 14 ratios, `provider.options` passthrough |
| Sourceful V1 | — (no live model) | none — preview slugs deprecated |
| Sourceful V2 | resolution, aspect_ratio, `opt.sourceful.font_inputs`, 512→400, fast ref-cap(5→400), i2i | pro ref-cap boundary; pro vs fast resolution |
| Sourceful V2.5 | resolution, aspect_ratio, background, `opt.thinkingLevel`, `opt.sourceful.font_inputs`, 512→400, fast 4K→400, i2i | pro 4K ok, ref-cap boundary |
| OpenAI | size, n + n=2 multi-image, quality(low), background(opaque/transparent), output_format(jpeg), output_compression, `opt.openai.moderation`, stream(SSE), gpt-5.4 quality(high)+size+opaque+jpeg+moderation passthrough, gpt-5.4 + `gpt-image-2` transparent, direct-slug t2i (`gpt-image-1`, ECO-1503), i2i(≤16), full aspect set on direct slugs (`gpt-image-2` × 9 + `gpt-image-1`/`-mini` × 4, 2026-07-26 prod ad-hoc) | quality all values, compression 0/100, direct-slug edit/stream, transparent alpha-channel assertion on decoded output, BYOK; promote ad-hoc aspect cases into `cases.ts` |
| Gemini (AI Studio) | resolution(1K), aspect_ratio(16:9), 3-pro 4K, cachedContent passthrough smoke + unit body assertion, i2i(refs ≤3 / ≤14) | full aspect set, 3.1-flash 512, BYOK |
| Gemini (Vertex) | cachedContent case fields for provider-flip / BYOK reruns | mirror AI Studio per-model via provider flip / BYOK key |
| Azure MAI | aspect_ratio(1:1), out-of-set aspect(5:4→400), i2i | full aspect set, quality, BYOK (ECO-1139) |
| Krea | resolution(1K)+aspect(16:9)+seed + all advertised passthrough keys (creativity/intensity/complexity/movement/strength/styles[]/moodboards[]), style-ref data-URI SKU path, i2i data-URI, out-of-set aspect(21:9→400), unsupported 2K→400 | full aspect set, account-scoped moodboard UUID success path, large/medium variants, BYOK |
| Quiver | local t2svg `n=1`, local t2svg max `n=4`, local t2svg streaming `n=1` (SSE `text_chunk` frames → one `completed`), local vectorization with HTTP URL, vectorization + `stream:true` 400 reject, upstream data-URL vectorization 400, `n=5` capability 400, ref-cap(2→400), unsupported URL scheme 400, missing prompt 400, invalid API key 401 | prod discovery sync + recorded managed run after endpoint staging, BYOK, decide whether Quiver vectorization should reject data URLs locally instead of forwarding to upstream |

Cross-cutting:

- **Streaming** — `stream:true` is supported by OpenAI (all slugs) and Quiver
  (text-to-SVG only); asserts an SSE `text/event-stream` ending in exactly one
  `image_generation.completed` event with non-empty bytes and no error event.
  Quiver additionally emits progressive `image_generation.text_chunk` frames and
  rejects `stream:true` on vectorization with a 400. Other adapters ignore the
  flag and return a buffered JSON body.
- **Determinism** — `{seedream,bfl}-determinism-seed-{a,b}` issue the same seed
  twice; `compareDeterminismPairs()` flags byte drift. Drift-flagging only, never
  a hard pass/fail (provider determinism is not guaranteed).
- **Unknown passthrough** (ECO-948) — inject a bogus `provider.options` key per
  adapter; flag if upstream accepts it without changing response shape or cost.
- **Advertised passthrough coverage** — every generated
  `allowed_passthrough_parameters` key must have a literal
  `provider.options.<slug>.<key>` field in `cases.ts`; the free CI gate fails on
  drift before the paid live matrix runs. Gemini cached-content cases are live
  smoke coverage because Google image generation does not reliably reject a
  synthetic missing cache handle; schema + adapter unit tests assert the exact
  region-tagged option survives parsing and reaches the upstream request body.
- **BYOK** — `is_byok` is endpoint-derived from **account state** (whether the
  sweep's key owner has a provider key staged), not a per-request field, so BYOK is
  a whole-run mode, not a per-case tag. Run with
  `IMAGE_GENERATION_EXPECT_BYOK=true` against a BYOK-provisioned account: every
  settled record must report `is_byok=true` (a managed fallback then fails loudly),
  and since BYOK zeroes the response cost (charge moves to `byok_usage_inference`)
  the billing check asserts the record's presence, not cost parity. Azure image
  BYOK is suspected broken (raw-key bug, ECO-1139) — expect it to fail this mode
  until fixed.

---

## Validation contract

Every successful case asserts (see `tests/e2e/api/images/helpers.ts`):

1. HTTP 200; `data.length === requested n`.
2. `b64_json.length > 0` and `detectImageFormat()` returns a defined format
   (magic-number check — catches corrupt/empty output).
3. Response billing: `usage.cost > 0`, `usage.total_tokens > 0`, and image-token
   details present (token-metered providers).
4. **Billing settlement** — poll `GET /api/v1/generation?id=` (the Spanner-backed
   source of truth; it 404s until billing settles in a post-response `waitUntil`)
   until the record appears or the deadline passes. A record that never settles is
   a **hard failure** — a 200 that was never charged is silent revenue loss.
   Managed runs assert the settled `total_cost` matches the response `usage.cost`
   within a rounding epsilon; BYOK runs assert `is_byok` instead (see the BYOK
   cross-cutting note). Toggle with `IMAGE_GENERATION_VERIFY_BILLING`.
5. `x-generation-id` header matches `/^gen-img/`.
6. Decoded dimensions match the requested `size`/`resolution`/`aspect_ratio`
   within provider tolerance.
7. Visual spot-check (human or vision model): not blank, recognizably the prompt.
   Subtle quality goes to human review, never auto-pass/fail.

Error cases assert HTTP status **and** the body message substring (the runner's
`expected.messageIncludes`).

---

## Run history

Recorded runs are committed under `runs/<date>-<env>.json`, written by the
harness when `IMAGE_GENERATION_RECORD_RUN=true`. Casual runs stay in the
gitignored `.logs/*.ignore.json` and are not indexed here. Newest first.

| Date | Env | Mode | Driver | Models | Cases | Pass | Fail | $ | Artifact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-26 | prod | managed | agent (ad-hoc ECO-2189 min-pixel) | 1 | 7 | 7 | 0 | ~0.12 | no `runs/*.json` — `bytedance-seed/seedream-4.5` rejects R1–R4 (local 400, OR remedy, not upstream `3686400` copy) + accepts A1 default / A2 `2048x2048` / A3 bare `16:9` (dims ≥ min) |
| 2026-07-26 | prod | managed | agent (ad-hoc aspect_ratio matrix) | 7 | 53 | 53 | 0 | ~2.36 | no `runs/*.json` — raw curl/Python against `/api/v1/images` covering BFL FLUX.2 ×4 + `gpt-image-{1,1-mini,2}` full advertised aspect sets (decoded dims + orientation) |
| 2026-06-21 | prod | byok | agent (Claude) | 3 | 3 | 3 | 0 | 0 (BYOK) | [`runs/2026-06-21-prod-byok.json`](./runs/2026-06-21-prod-byok.json) |
| 2026-06-20 | prod | managed | agent (Claude) | 14 | 39 | 39 | 0 | ~1.84 | [`runs/2026-06-20-prod.json`](./runs/2026-06-20-prod.json) |

Each record carries `env`, `mode` (`managed` | `byok`), `head`, `driver`, counts,
`distinct_models`, `cost_total`, `cost_by_adapter`, `determinism_pairs`, and a
compact per-case list
(`id`/`status`/`elapsed_ms`/`cost`/`billing_settled`/`settled_cost`) — never base64
image data. BYOK runs (`IMAGE_GENERATION_EXPECT_BYOK=true`) write a `-byok`-suffixed
file so they never overwrite the managed record for the same date.

### Standing findings

Durable facts surfaced by sweeps (not per-run):

- **`seed` is best-effort, not byte-reproducible.** Seedream + BFL accept `seed`
  and return 200, but the same seed twice yields different bytes (header matches,
  payload length differs). Provider non-determinism, not an OpenRouter bug.
- **The streaming SSE `completed` frame carries usage tokens but no `cost`.** The
  buffered JSON response includes `usage.cost`; the streamed frame omits it (cost
  is computed post-drain in `finalizeImageGenerationBilling`, after the frame is flushed).
  The settled-billing poll (contract step 4) confirms a streamed generation still
  *charges* correctly in the Spanner record; the billing assertion therefore skips
  the in-band cost-parity check when no response `cost` is present (streaming) and
  relies on the settled `total_cost` alone. The missing in-band SSE-frame `cost`
  is a separate response-shape gap, tracked under ECO-1250.
- **i2i is supported on OpenAI + Gemini** via `input_references`. OpenAI
  advertises no `output_format`, but live cases cover JPEG passthrough on the
  dedicated image route; `gpt-5.4-image-2` and `gpt-image-2` accept `auto`,
  `opaque` and `transparent` background once their endpoint rows advertise it.
- **Direct GPT image slugs route through `OpenAIImageAdapter`** (ECO-1503). The
  `openai/gpt-image-{1,1-mini,1.5,2}` slugs bypass the Responses/LLM wrapper and
  call the Images API directly; `getOpenAIImageModelIdForSlug` strips the
  `openai/` prefix to the upstream id (`openai/gpt-image-1` → `gpt-image-1`).
  Verified end-to-end on a local stack (2026-06-23): t2i for all four slugs, i2i
  and SSE streaming, `gpt-image-2` honoring `output_format: jpeg`, and a 404 for a
  non-existent `openai/gpt-image-99`. Per-model cost tracks the model tier
  (gpt-image-1 ≫ gpt-image-1-mini). Live in prod; the generated Models table now
  lists `gpt-image-{1,1-mini,2}` with dedicated `aspect_ratio` value sets.
- **Bare `aspect_ratio` is honored end-to-end on BFL + direct GPT image slugs**
  (2026-07-26 prod matrix, 53/53). Discovery `supported_parameters.aspect_ratio`
  matches live decoded dimensions for every advertised value (including `auto`).
  BFL shares one 9-value set across FLUX.2 Pro/Flex/Max/Klein; GPT Image 2 uses a
  9-value shaped set; GPT Image 1/Mini stay on the 4-value orientation triple.
- **Seedream 4.5 min-pixel fail-fast (ECO-2189).** Outputs below 3,686,400 total
  pixels are rejected **locally** with a field-scoped 400 before the ByteDance
  call — no silent clamp, remedy text matches the input surface (`size` → suggest
  `"2048x2048"`/`"4K"`/omit size; `resolution`/`aspect_ratio` → suggest `"4K"`/omit
  resolution). Prod ad-hoc 2026-07-26: sub-min rejects in <2s with `cost=null` and
  OR copy (`3,686,400`), not the old upstream `image size must be at least
  3686400`; defaults and bare `16:9` clear the floor (`2048×2048` / `3642×2048`).
  Bare `resolution` without a ratio remains a known resolver bypass (deferred).
- **Seedream 4.5 floor-compatible tiers are raised, not rejected.** The resolver
  now threads the model's pixel floor (`minOutputPixels`), so `2K` + a non-square
  ratio is scaled up to the floor instead of 400ing (`2K+16:9` → `2560×1440` —
  ByteDance's own 2K preset; `2K+21:9` → `2934×1258`). `1K` (square form below
  the floor) and explicit sub-min `"WxH"` sizes keep the ECO-2189 fail-fast 400;
  `1K` should also be dropped from the endpoint row's advertised `resolutions`
  (prod data change — the model cannot produce 1K-class output at all).
  Direct upstream captures (Ark `ep-...-6m7wz`, 2026-07-28 ad-hoc): the raised
  `2K` shape for **all 17 advertised concrete ratios** → 200 with exact size
  echo (2048×2048, 1358×2716, 2716×1358, 1570×2352, 2352×1570, 1664×2218,
  2218×1664, 1720×2146, 2146×1720, 1440×2560, 2560×1440, 1306×2826, 2826×1306,
  1290×2862, 2862×1290, 1258×2934, 2934×1258). The floor is inclusive —
  2560×1440 = exactly 3,686,400 accepted; `2048x1152` → InvalidParameter "at
  least 3686400 pixels"; tier string `"2K"` is accepted but returns
  provider-chosen 2048×2048 (it does not honor a separate ratio, so local WxH
  resolution stays required). A capture with the adapter's exact outgoing body
  (`seed`, `sequential_image_generation:"disabled"`, `stream:false`,
  `watermark:false`, `response_format:"b64_json"`) and the raised `2934x1258`
  also returned 200 with an exact size echo — acceptance is not sensitive to
  the sweep's simplified field set.
- **Seedream 5.0 direct upstream captures (2026-08-12).** Pro rejects
  `sequential_image_generation` entirely, accepts 921,600–4,624,220 output
  pixels, accepts `1K`/`2K` but rejects `4K`, and does not support multi-image
  generation. Lite accepts 3,686,400–16,777,216 output pixels, rejects the
  `1K` token, and supports multi-image generation only with
  `sequential_image_generation:"auto"` plus nested
  `sequential_image_generation_options.max_images`.
- **Seedream 5.0 Lite image counts are prompt-dependent (2026-08-12).**
  `max_images` is a ceiling, not a quantity, and `n` does not influence the
  count. With the correct nested body at `max_images: 2`, prompt `"A red
  panda"` returned 1 image in 10/10 requests while `"A red panda, generate 2
  distinct variations"` returned 2 in 10/10; omitting `n` changed nothing.
  Any eval asserting an exact image count must therefore ask for a set in the
  prompt.
- **BYOK image billing is healthy on xAI, OpenAI, and Gemini (AI Studio).**
  The 2026-06-21 BYOK run confirmed each settles with `is_byok=true`,
  `total_cost=0` (the OpenRouter charge is zeroed), and the real provider cost on
  `upstream_inference_cost` (xAI $0.05, OpenAI $0.011, Gemini $0.039). Azure BYOK
  remains the open suspect (raw-key bug, ECO-1139) — not exercisable with the
  test key, which covers only those three providers.
- **Prod billing settlement latency is variable** (~5s to past 60s under load),
  so the settlement poll defaults to a generous 120s timeout. A slow-but-healthy
  settle should not be mistaken for the silent-revenue-loss bug; tune down via
  `IMAGE_GENERATION_BILLING_POLL_TIMEOUT_MS` only against a fast env.
- **Quiver local staging is healthy for text-to-SVG (sync + streaming) and
  HTTP-URL vectorization, and billing settles the same on both paths.** A
  locally seeded `quiver/arrow-1.1` endpoint routes through `QuiverImageAdapter`
  to `/v1/svgs/generations` and `/v1/svgs/vectorizations`. Sync text generation
  returned valid SVG for `n=1` (20 credits, $0.20) and `n=4` (80 credits, $0.80);
  vectorization from an HTTP image URL returned valid SVG (15 credits, $0.15).
  On 2026-07-08 the streaming path was re-verified end-to-end: `stream:true`
  text-to-SVG produced an SSE `text/event-stream` of progressive
  `image_generation.text_chunk` frames followed by exactly one
  `image_generation.completed` frame carrying the full SVG, and the finalized
  usage matched the sync path exactly (`cost=$0.20`, credits billed via the
  `quiver:cents_per_credit` SKU through `getFinalState()` →
  `computeImageGenerationUsage`). Vectorization with `stream:true` is rejected
  with a 400 (`Streaming is not supported for image-to-SVG (vectorization)
  requests`) before any upstream call. Local capability/schema failures (`n=5`,
  two `input_references`, unsupported URL scheme, missing prompt, invalid API
  key) returned 4xx/401 without billing; upstream Quiver surfaces its top-level
  error body for data-URL vectorization (`Invalid value for 'image.url': URL must
  use http or https`). These were local manual matrices, not recorded prod runs,
  so no `runs/*.json` artifact is committed.
- **The dedicated Images API supports request-level provider routing.**
  `/api/v1/images` accepts `provider.only`, `provider.order`, `provider.ignore`,
  `provider.sort`, and `provider.allow_fallbacks` alongside `provider.options`.
  The route passes these preferences through the standard routing pipeline before
  capability filtering and adapter selection. CI coverage pins a capable Gemini
  endpoint and verifies that pinning an endpoint without a requested capability
  returns a field-scoped 400 instead of rerouting.

---

## How to run

See [`README.md`](./README.md) for env vars, filters, and how to record a run.
