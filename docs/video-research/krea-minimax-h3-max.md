# Krea — MiniMax H3 Max (`minimax/h3-max`)

Krea hosts MiniMax's H3 Max as a second provider for the `minimax/hailuo-3-max` model that already runs on MiniMax's own endpoint. Krea's async lifecycle is the one `KreaVideoAdapter` already implements, so this note covers only what a second Krea provider model adds: its capability surface, its rate card, and the endpoint row a later staging session applies. Nothing here is staged, launched, or written to a database.

## Sources and authentication

- OpenAPI source of record: <https://api.krea.ai/openapi.json>, fetched 2026-09-01 UTC.
- Model documentation page: <https://www.krea.ai/docs/api-reference/video/minimax-h3-max> (Markdown form at the same path with a `.md` suffix), fetched 2026-09-01 UTC.
- API base URL: `https://api.krea.ai`.
- Authentication header: `Authorization: Bearer <KREA_API_KEY>`, with the key in Infisical under `/services/cfw-api`. No key value appears in this note or in the repository.
- `GET /usage` returns 403 for that key — Krea reports it needs a workspace service API key — so per-job billing cannot be read back from the API. The published rate card is the only billing source available.

## Models, regions, and endpoint map

| Purpose | Method and path |
| --- | --- |
| Submit | `POST /generate/video/minimax/h3-max` |
| Poll | `GET /jobs/{job_id}` |

`KreaVideoAdapter.getUrl()` builds the submit path as `provider_info.baseUrl + '/generate/video/' + provider_model_id`, so the endpoint row's `provider_model_id` of `minimax/h3-max` is what selects this model. Krea exposes a single global host; no region routing is offered.

## Request and capability matrix

| Field | Type and values | Notes |
| --- | --- | --- |
| `prompt` | string, required, max 7000 chars | |
| `start_image` | image URL or data URI | maps to `first_frame` |
| `end_image` | image URL or data URI | maps to `last_frame`; accepted together with `start_image` |
| `aspect_ratio` | `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16` | |
| `resolution` | `480p`, `768p` | no 1080p or 2K tier |
| `duration` | integer, 5–15 inclusive | |
| `seed` | integer | |
| `prompt_expansion_mode` | enum | not surfaced by OpenRouter's request schema |
| `reference_images` | up to 12 images | **priced separately — see billing** |
| `reference_videos` | up to 7 videos, with `reference_video_seconds` | **priced separately** |
| `reference_audios` | audio references | **priced separately** |

There is no audio-generation parameter: H3 Max on Krea returns silent video, so the endpoint sets no `generate_audio` capability and the `krea_video:cents_per_second_audio_output` SKU stays unset.

Krea accepts both keyframes in one request, and honors both. MiniMax's own H3 Max API rejects that pair with a 400 ("does not support multi-image reference"), so Krea is the more permissive of the two endpoints for the same model — verified live, see [Live capture matrix](#live-capture-matrix). Nothing in OpenRouter needs to know the difference: both endpoints declare `first_frame` and `last_frame`, and MiniMax's single-keyframe rule is enforced on its own side of the request builder.

The generic reference fields are real in the live schema — an earlier documentation snapshot did not list them. OpenRouter still declares no generic `input_references` support for this provider model (see [Billing and SKU reconciliation](#billing-and-sku-reconciliation)); that is a billing decision, not an upstream limitation. Keyframe images (`start_image` / `end_image`) carry no surcharge and remain supported.

## Submit/poll/status lifecycle

Unchanged from the rest of Krea's video catalog and already implemented:

1. `POST /generate/video/minimax/h3-max` returns `{ job_id, status }`.
2. `GET /jobs/{job_id}` is polled until the job reaches a terminal status.
3. The artifact URL is `result.urls[0]`.

No lifecycle, response-parsing, or fixture change is required for this provider model, which is why this work adds no upstream response fixture.

## Artifact and callback behavior

The completed job carries the video URL in `result.urls[0]`; `KreaVideoAdapter.fetchVideoContent` downloads it. Krea's H3 Max request schema exposes no callback or webhook field, so OpenRouter polls.

## Errors, retries, timeout, and cancellation

Shared Krea behavior, unchanged by this model: HTTP errors surface from the submit call, terminal failure statuses surface from the poll, and no cancellation endpoint is documented for jobs.

## Billing and SKU reconciliation

Krea charges **$0.05 per output second at 480p and $0.08 per output second at 768p** — price parity with MiniMax's own list price for this model.

Both published sources agree. `x-krea-pricing` `price_points` for zero-reference requests are perfectly linear in duration across 5–15 seconds: 480p runs $0.25 → $0.75 and 768p runs $0.40 → $1.20, giving $0.05 and $0.08 per second with no rounding slack. The same operation's `x-mint` extension embeds the rendered documentation pricing table verbatim, listing those same amounts, so the docs page and the machine-readable spec do not diverge for this model.

`GET /usage` is 403 for our key ("needs a workspace service API key"), so per-job charges cannot be read back from Krea; the published rate card is the only billing source.

### Why generic references are declared unsupported

`x-krea-pricing` prices references as extra dimensions on top of the per-second rate: a 480p/5s request costs $0.25 with no references, $0.40 with one reference image, and $0.40 with one second of reference video, rising further with additional reference seconds and images. The `krea_video:*` SKUs bill output seconds only and have no dimension that can express a per-reference or per-reference-second surcharge. Forwarding a reference we cannot charge for is a guaranteed underbill of up to 60% on a short clip, so `KreaVideoAdapter.supportedReferenceInputs` declares no generic reference modalities for `minimax/h3-max`; the shared pre-dispatch validator then rejects such requests with a 400 instead of silently dropping them. Supporting references later means adding reference-dimension SKUs to the Krea video pricing strategy first.

## Adapter/base-class choice

No new adapter. `KreaVideoAdapter` (`packages/video-generation/adapters/krea/index.ts`) already implements this exact submit/poll/artifact lifecycle and derives the upstream path from `provider_model_id`. The only adapter-level change is making its declared reference support provider-model-aware, matching the shape `MinimaxHailuoV2Adapter` uses for the same model on MiniMax's endpoint.

## Endpoint fields and pricing JSON

A **hidden** endpoint on the existing `minimax/hailuo-3-max` model row — Krea is a second provider for that model, not a new model.

- `provider_model_id`: `minimax/h3-max`
- `supported_video_parameters`:

```json
{
  "supported_resolutions": ["480p", "768p"],
  "supported_aspect_ratios": ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  "supported_durations": [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  "supported_frame_images": ["first_frame", "last_frame"],
  "seed": true
}
```

- `pricing_json`, denominated in cents per output second (`KreaVideoPricingStrategy` multiplies the rate by output seconds and divides by 100 for dollars):

```json
{
  "krea_video:cents_per_second_output": 8,
  "krea_video:cents_per_second_output_480p": 5,
  "krea_video:cents_per_second_output_720p": 8
}
```

`768p` maps to the `_720p` SKU in `getKreaVideoSKU`. The base `krea_video:cents_per_second_output` is required by the schema and is set to the 768p rate so an absent resolution bills at the higher tier rather than the lower one.

No pricing-strategy code changes are needed; the existing SKUs express this rate card directly.

## Live capture matrix

| Resolution | Duration | Keyframes | Output geometry | Job |
| --- | --- | --- | --- | --- |
| 480p | 6s | none | 832x480 | `b3bb9698-a4b0-41ac-8448-13e4a8e82028` |
| 768p | 5s | none | 1344x768 | `9f0ca10f-89d4-4398-acd9-28fe36b27774` |
| 480p | 5s | `start_image` + `end_image` | 832x480, 5.18s | `268908a7-fbf1-45f8-ab8b-ab6a2a6f5091` |

All captures were taken against Krea's API directly and match the output geometry MiniMax's own endpoint produces for the same model.

The keyframe-pair capture used two solid-color 832x480 JPEGs uploaded through `POST /assets` (external image hosts are hit-or-miss: Krea's fetcher got a 400 from Wikimedia and a 522 from picsum, both surfacing as a 422 `Input file rejected`). Krea returned `200 scheduled` and the finished video's first frame is the `start_image` color and its last frame the `end_image` color, so both keyframes are applied rather than one being ignored. Reference-input requests were not captured, since OpenRouter rejects them for this endpoint.

## Customer signal (Enterpret)

No feedback record mentions Krea, and none asks for provider choice on a video model — video feedback is dominated by job-lifecycle and correctness complaints, not provider selection. Two records are still relevant to the routing decision:

- `00a4d7c9-837f-54ba-97c3-7fa25e0ab28b` (Zendesk): 51 image-to-video generations on another model silently ignored the supplied start image and billed ~$24, producing a refund request. A provider that diverges quietly on keyframe handling is a billing incident, not a quality nit — which is the argument for validating Krea's keyframe behavior before it can take traffic (done here, see the capture matrix) and for keeping the endpoint hidden until then.
- `0baea547-b0c9-550d-9d28-f1584c96c7a3` (Gong): cheapest-provider-by-default is pitched to customers as how OpenRouter routing works. Moot at parity here, but it means any endpoint-level preference that overrides price ordering needs a stated reason.

## Routing once both endpoints are live

`videoRoutingSteps` (`packages/video-generation/routing/steps.ts`) filters and gates candidates; the only reordering step is `prioritizePrivateEndpoints`. Selection is then `endpoints[0]!` under `// TODO(ECO-250): if multi-provider is a thing for video gen, implement it`, and the candidate order comes from `listDBEndpointsHydrated`, which has no `ORDER BY` on `endpoints`. So the video path does not price-sort: with two public endpoints on one model the winner is whatever Postgres returns first, and it can change when the 5-minute endpoint cache refreshes.

Options, in order of increasing scope:

1. Leave routing untouched. Zero code, but the traffic split and therefore the effective price and failure modes are non-deterministic. Acceptable only while the Krea endpoint stays hidden.
2. Add a deterministic ordering step to the video pipeline (explicit endpoint rank, or a price sort if that is the intended semantic). The real fix; changes behavior for every existing multi-endpoint video model.
3. MiniMax primary with Krea as fallback. Needs (2)'s ordering plus retry-next-endpoint semantics the video path does not have.
4. Require explicit provider selection so Krea is reachable but never implicit. Smallest surface, no organic traffic.

Recommendation: keep Krea hidden until (2) exists, then unhide with MiniMax ranked first — (2) as the mechanism, (3) as the initial configuration. Krea is at price parity, so there is no price argument for shifting traffic to it, and the customer-visible risk on video is quiet per-provider divergence rather than lack of provider choice (see [Customer signal](#customer-signal-enterpret)).

## Verification scope

The manual e2e for this provider model is `tests/manual/api/video/krea-minimax-h3-max.test.ts`. It is skipped until `KREA_H3_MAX_ENDPOINT_ID` names a staged Krea endpoint, because the video path has no provider selection and the Krea endpoint row does not exist yet, so nothing can route to Krea end to end today. Executing it, including the reference-rejection case, belongs to the session that stages the endpoint row. Until then the standing coverage is the unit matrix in `packages/video-generation/adapters/krea/index.test.ts` and `packages/video-generation/adapters/capabilities.test.ts` plus the direct Krea captures above.

## Open questions

- Whether Krea's rates move after launch; the endpoint rate needs re-checking against `x-krea-pricing` if they do.
- Whether reference inputs are worth supporting later, which requires reference-dimension SKUs in the Krea video pricing strategy.
- Per-job billing readback needs a Krea workspace service API key; the current key is 403 on `GET /usage`.

## Fixture inventory

None. This provider model reuses Krea's existing response handling unchanged, and the only OpenRouter-side behavior change is a request-time capability declaration.
