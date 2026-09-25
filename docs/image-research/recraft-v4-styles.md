# Recraft V4 Styles Image Research

Evidence labels used throughout: **[doc]** = stated by Recraft's V4 Styles
documentation, **[code]** = verified in this repository, **[live]** = observed in
a real request against `https://external.api.recraft.ai` on 2026-08-25 with the
`RECRAFT_API_KEY` from Infisical `dev` `/_providers`, **[unverified]** = neither
observed nor code-verified.

## Scope and sources

Recraft's V4 Styles family conditions generation on a *style* — either a
previously created `style_id` or one to ten style-reference images supplied with
the request. Provider launch date is 2026-08-26.

- Model page: <https://recraft-nk-v4-styles-v2.mintlify.site/api-reference/models/recraft-v4-styles>
- Endpoint reference: <https://recraft-nk-v4-styles-v2.mintlify.site/api-reference/endpoints>
- Pricing: <https://recraft-nk-v4-styles-v2.mintlify.site/api-reference/pricing>
- Sizes and rate limits: <https://recraft-nk-v4-styles-v2.mintlify.site/api-reference/appendix>
- Product scope (Robin Kim, Slack `C0BB2TQ657D` thread `1787594013.425219`):
  support the first four models; do not support style creation; `style_id`
  allowed as passthrough; all four are image-to-image only, text-to-image
  requests rejected, playground examples must be i2i.

Recraft's style-creation endpoint (`POST /v1/styles`) is deliberately **out of
scope**; OpenRouter never creates a named style on the user's behalf.

## Model and endpoint map

All four route to `POST {baseUrl}/images/generations` **[live]** with the existing
`Recraft` provider name, `RecraftImageGenerationAdapter`, and
`BaseSyncImageGenerationAdapter` **[code]**.

| `provider_model_id` | Proposed slug | Output | Resolution | Price/image **[doc]** |
| --- | --- | --- | --- | --- |
| `recraftv4_styles` | `recraft/recraft-v4-styles` | raster | ~1K | $0.035 |
| `recraftv4_styles_vector` | `recraft/recraft-v4-styles-vector` | SVG | vector | $0.05 |
| `recraftv4_styles_pro` | `recraft/recraft-v4-styles-pro` | raster | ~2K | $0.10 |
| `recraftv4_styles_pro_vector` | `recraft/recraft-v4-styles-pro-vector` | SVG | vector | $0.12 |

`output_modalities: ['image']`; input modalities `text` + `image`. The two
`_vector` IDs are already matched by the adapter's `_vector` suffix check, so
their images carry `media_type: image/svg+xml` without a code change **[code]**,
and both returned SVG payloads live **[live]**.

Observed raster output at `16:9`: `1344x768` for `recraftv4_styles`, `2688x1536`
for `recraftv4_styles_pro` **[live]** — standard and Pro do not share a pixel
size list.

## Request/capability matrix

| Normalized field | V4 Styles | Notes |
| --- | --- | --- |
| `prompt` | yes | multipart `prompt` **[live]** |
| `n` | 1–6 | `n=6` succeeded, `n=7` rejected with `Parameter 'n' must be between 1 and 6` **[live]** |
| `aspect_ratio` | yes | passed through as Recraft's `w:h` `size` form by `resolveRecraftSize` **[code]**; `16:9` accepted **[live]** |
| `size` | not advertised | V4 Styles accepts only its own per-model pixel list, and it differs between standard and Pro; `1820x1024` (valid on V3) is rejected with `Recraft V4 Styles doesn't support 1820x1024 image size` **[live]**. `supported_image_parameters.size` cannot enumerate sizes, so the endpoints expose `aspect_ratio` only. |
| `resolution` | no | not part of Recraft's vocabulary |
| `input_references` | **required**, 1–10 | mapped to style references, not to an i2i source image; 11 references rejected upstream with `Number of images must be between 0 and 10` **[live]** |
| `output_format` | `svg` for the vector models only | derived from the model, not user-selectable **[code]** |
| `quality`, `background`, `output_compression`, `seed`, `stream` | no | Recraft's `random_seed` is passthrough, not the normalized `seed` |
| passthrough | `style_id`, `style_match`, `controls`, `random_seed` | endpoint `allowed_passthrough_parameters` |

`supported_image_parameters` staged for all four endpoints (the vector pair
additionally sets `"output_formats": ["svg"]`, matching the existing
`recraftv4_pro_vector` row **[code]**):

```json
{
  "n": { "max": 6, "min": 1 },
  "seed": null,
  "size": null,
  "qualities": null,
  "backgrounds": null,
  "resolutions": null,
  "aspect_ratios": [
    "1:1", "2:1", "1:2", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "auto"
  ],
  "output_formats": null,
  "input_references": { "max": 10, "min": 1 },
  "output_compression": null
}
```

The aspect-ratio list is Recraft's published V4 Styles list intersected with our
`ImageAspectRatio` enum; Recraft's `6:10`, `14:10` and `10:14` have no enum
member and are therefore not advertised **[doc]**.

`allowed_passthrough_parameters`: `{style_id,style_match,controls,random_seed}`.
`style` is excluded because V4 Styles rejects style names
(`Recraft V4 Styles doesn't support style 'digital_illustration'` **[live]**),
and `negative_prompt` / `text_layout` are V2/V3-only **[doc]**. An unrecognized
multipart field is silently ignored by the provider rather than rejected
**[live]**, which is why the allowlist matters — a typo would otherwise be
invisible.

**The capability gate cannot express "image required" on its own.**
`imageParametersToRequestSchema` marks `input_references` `.optional()`, so
`min: 1` only constrains a request that *has* the field — an omitted
`input_references` passes the gate **[code]**. The adapter therefore enforces the
requirement itself and returns a 400 explaining that text-to-image is not
supported for these models. The maximum is left entirely to the endpoint
capability range.

## Image-to-image and input references

OpenRouter's `input_references` map to Recraft **style references**, sent as
repeated multipart file parts named `style_references` against
`/images/generations` **[code]**, accepted live with one and with two references
**[live]**. Constraints: 1–10 images, PNG/JPG/WEBP, under 10 MB each, 64 MB total
**[doc]**.

An undocumented constraint found live: **the shortest edge of a reference must be
at least 256 pixels**. A 64x64 PNG is rejected with
`invalid_image_format / min image dimension should be no less than 256` **[live]**.
We do not pre-check this in the adapter — that would mean decoding every uploaded
image on the inference path to enforce a rule the provider already enforces with a
clear message — so it belongs in the model-page copy and the playground sample
instead.

Recraft also accepts a JSON `style_reference_urls: string[]` of public or data
URLs, confirmed working with a data URL **[live]**. We deliberately use multipart
instead: a Durable-Object placeholder URL for an offloaded reference cannot be
embedded in a JSON array, and multipart keeps offloaded reference bytes out of the
worker (ECO-1814) **[code]**.

Recraft's ordinary `/images/imageToImage` route plays no part here — a V4 Styles
request is style-conditioned generation, not an edit of a source image, and the
generations route is also the only one of the two that honors `size` **[code]**.

## Response, streaming, and async lifecycle

Synchronous, no streaming, no polling **[live]**. Response envelope is the
existing Recraft one, `{ created?, credits?, data: [{ b64_json }] }`, already
parsed by `RecraftResponseSchema` **[code]**. Reference-based generations
additionally return the resolved `style_id` of the private style Recraft created
from the references **[live]**; we neither store nor surface it. `credits` is the
provider's own billing signal and is logged, not billed on **[code]**.

## Error envelopes and retry behavior

Same `{ code, message }` envelope as the rest of Recraft, including the
200-with-error-body case, handled by the existing paths **[code]**. Live
rejections, all HTTP 400 unless noted:

| Scenario | Provider response **[live]** |
| --- | --- |
| No `style_id` and no references | `style references are required for model recraftv4_styles` |
| 11 references | `Number of images must be between 0 and 10` |
| `n=7` | `Parameter 'n' must be between 1 and 6` |
| Non-image bytes as a reference | `invalid_image_format: invalid image format: image: unknown format` |
| Reference smaller than 256 px | `invalid_image_format: min image dimension should be no less than 256` |
| Unsupported explicit pixel size | `Recraft V4 Styles doesn't support 1820x1024 image size` |
| Unknown `style_id` | `Style not found or not accessible` |
| V3-created `style_id` on a V4 Styles model | `The requested model 'recraftv4_styles' isn't compatible with the style's model 'recraftv3'` |
| `style_id` + references together | `'style_id' can't be used together with style references` |
| Bad API key | HTTP 401, plain-text body `request unauthorized` (not the JSON envelope) |

Rate limits are documented as 100 images per minute and 5 requests per second per
user **[doc]**; not reproduced live, deliberately — the only key we have is the
shared provider key and tripping its limits would affect the existing Recraft
endpoints **[unverified]**.

## Billing model and reconciliation

We publish Recraft's headline per-output-image rates, represented by
`RecraftPricingStrategy`'s `CentsPerImageOutput` SKU **[code]**:

| `provider_model_id` | Output-image rate |
| --- | --- |
| `recraftv4_styles` | 3.5 cents |
| `recraftv4_styles_vector` | 5 cents |
| `recraftv4_styles_pro` | 10 cents |
| `recraftv4_styles_pro_vector` | 12 cents |

Recraft bills style creation separately at 5 API units ($0.005) **per request**,
charged on top of generation whenever style references are attached instead of a
`style_id` **[doc]**. OpenRouter represents that charge with the optional
`CentsPerStyleCreation` SKU at 0.5 cents per request **[code]**. Because these
models require references, each successful V4 Styles request emits exactly one
style-creation unit, regardless of the number of references or output images.
Ordinary Recraft text-to-image and image-to-image requests do not emit this SKU.
The live `credits` values confirm the model exactly ($1 = 1000 units) **[live]**:

| Request | `credits` | Decomposition |
| --- | --- | --- |
| `recraftv4_styles`, n=1 | 40 | 35 + 5 style creation |
| `recraftv4_styles`, n=2 | 75 | 2x35 + 5 |
| `recraftv4_styles`, n=6 | 215 | 6x35 + 5 |
| `recraftv4_styles_vector`, n=1 | 55 | 50 + 5 |
| `recraftv4_styles_pro`, n=1 | 105 | 100 + 5 |
| `recraftv4_styles_pro_vector`, n=1 | 125 | 120 + 5 |
| `POST /v1/styles` (out of scope) | 5 | style creation only |

Every existing Recraft endpoint is priced at Recraft's cost with no markup
**[code]**. The settled OpenRouter pricing keeps the style-creation charge as a
separate request-level SKU rather than folding it into the output-image rate:

| `provider_model_id` | `cents_per_image_output` | Cost at n=1 |
| --- | --- | --- |
| `recraftv4_styles` | 3.5 | $0.040 |
| `recraftv4_styles_vector` | 5 | $0.055 |
| `recraftv4_styles_pro` | 10 | $0.105 |
| `recraftv4_styles_pro_vector` | 12 | $0.125 |

The total at n=1 includes the 0.5-cent request charge. At n=6, for example,
standard raster costs 21.5 cents: `6 × 3.5 + 0.5`. The style-creation count
does not scale with references or outputs. Invoice-level reconciliation remains
an operational concern **[unverified]**; the `credits` figures above are the
provider's own per-request accounting.

## OpenRouter adapter/base-class choice

Extend the existing `RecraftImageGenerationAdapter` rather than add an adapter:
same auth, base URL, response envelope, error envelope, and SKU; only request
construction differs. The V4 Styles branch keys off an explicit set of the four
`provider_model_id`s, so no other Recraft model changes behavior **[code]**.

## Live capture matrix

Captured 2026-08-25 against the real provider API. Raw bodies and headers were
kept out of the repository: they contain multi-megabyte base64 image payloads and
signed URLs, and the durable regression coverage lives in the colocated adapter
tests instead.

| # | Scenario | Result **[live]** |
| --- | --- | --- |
| 1 | `recraftv4_styles`, 1 reference | 200, 1 image, 40 credits |
| 2 | `recraftv4_styles`, 2 references | 200, 40 credits |
| 3 | No style, no references | 400, `style references are required...` |
| 4 | `recraftv4_styles_vector` | 200, SVG, 55 credits |
| 5 | `recraftv4_styles_pro` | 200, `2688x1536`, 105 credits |
| 6 | `recraftv4_styles_pro_vector` | 200, SVG, 125 credits |
| 7 | 11 references | 400, count limit |
| 8 | Unknown `style_id` alone, and with references | 400, `Style not found or not accessible` |
| 9 | `aspect_ratio` `16:9` | 200, `1344x768` |
| 10 | JSON `style_reference_urls` with a data URL | 200, 40 credits |
| 11 | Unrecognized extra multipart field | 200 — silently ignored |
| 12 | `style_match=flexible` | 200, 40 credits |
| 13 | `n=2` / `n=6` / `n=7` | 200 (75 credits) / 200 (215 credits) / 400 |
| 14 | Non-image bytes as reference | 400, `invalid image format` |
| 15 | 64x64 reference | 400, 256 px minimum |
| 16 | Invalid API key | 401, plain-text `request unauthorized` |
| 17 | Real V3-created `style_id` | 400, model/style incompatibility |
| 18 | Real `style_id` + references | 400, mutually exclusive |
| 19 | Explicit `1820x1024` | 400, unsupported size |
| — | Rate limit | not reproduced, shared key **[unverified]** |
| — | Successful V4-compatible `style_id` | not reproduced: creating a V4 Styles style requires the out-of-scope `/v1/styles` flow, and every named `style` value we tried is rejected for this family **[unverified]** |
| — | Moderation refusal, upstream 5xx | not reproduced **[unverified]** |

## Local end-to-end validation with provisional pricing

This historical run was against local `cfw-image-api` with the four models and
endpoints staged in local Postgres at the **provisional blended rates** below,
using the seeded development key. It predates the settled output-image plus
request-level style-creation pricing, so its dollar amounts must not be read as
validation of the final rates. Evidence is the per-generation `dev-fs-logs`
records (`upstream-request`, `billing-result`, `transaction-attempt`,
`capability-filter`) **[live]**.

| Request | Result |
| --- | --- |
| Standard raster, 1 reference | 200, 1 WebP, `$0.04` |
| Vector, 1 reference | 200, 1 SVG, `$0.055` |
| Pro raster, 1 reference | 200, 1 WebP, `$0.105` |
| Standard raster, no references | 400 from the adapter, no upstream request |
| Standard raster, 11 references | 400 from the capability filter, no endpoint capable |
| Standard raster + passthrough `style_id` | 400 carrying Recraft's conflict message, no charge |

Every successful upstream request went to `/v1/images/generations`, none to
`/images/imageToImage`, and each upstream record carries `input_image_count`
without reference URLs or image bytes. OpenRouter cost matched the staged rate
and the provider's credits exactly on all three paid requests.

## Quirks and open questions

- **Passthrough options must be nested under the provider slug.** `style_id` and
  the other allowlisted fields only reach Recraft as
  `provider.options.recraft.style_id`; a top-level key is dropped by
  `ProviderOptionsSchema` before routing, and the request then generates normally
  from the references alone **[live]**. This is standard OpenRouter behavior, not
  Recraft-specific, but it is the difference between a 400 and a billed image, so
  the model-page copy should show the nested form.
- **`style_id` + references is a dead combination in practice.** Our i2i-only
  rule means every request carries references, so a passthrough `style_id` always
  produces the upstream 400 quoted above **[live]**. Mindi Weik confirmed we still
  want `style_id` forwarded as a passthrough for users bringing an ID from Recraft
  directly, so the adapter forwards both unchanged and surfaces Recraft's error
  rather than silently dropping either input.
- **Style-creation charge** is published as a separate 0.5-cent request-level
  SKU, as described in the billing section above **[code]**.
- **`style_match`** (`precise` | `flexible`) is V4-only and passthrough-only; it
  is not mapped to any normalized field **[live]**.
- **256 px minimum reference edge** is undocumented; model-page copy and the
  playground sample should state it, along with the 1–10 count, the accepted
  formats, and the size caps.
- The i2i sizing-parity fixture cannot express a model family with a single
  request path; it was left unchanged deliberately **[code]**.

## Fixture inventory

Colocated adapter tests in
`packages/image-generation/adapters/recraft/index.test.ts` cover styles request
construction, the multipart `style_references` parts, the endpoint-owned
reference-count bound, the missing-image rejection, sizing, passthrough
`style_id`, and vector media type — all against hand-built payloads shaped like
the envelope confirmed live **[code]**.
