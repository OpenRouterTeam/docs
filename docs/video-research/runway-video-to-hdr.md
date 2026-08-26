# Runway video-to-HDR (`ruby`)

SDR-to-HDR conversion of an existing video. Resolution, frame rate, duration, and audio are
preserved; the signal is converted to BT.2020 primaries with a PQ or HLG transfer and 10-bit
HEVC encoding. This is not upscaling and shares no parameters with
`POST /v1/video_upscale`.

Scope of this note and the first implementation: the two MP4 output profiles (`hdr10`, `hlg`).
The ProRes MOV and OpenEXR ZIP profiles are deliberately excluded, see
[Open questions](#open-questions).

## Sources and authentication

- API reference: [https://docs.dev.runwayml.com/api/](https://docs.dev.runwayml.com/api/)
- OpenAPI document: [https://docs.dev.runwayml.com/openapi.json](https://docs.dev.runwayml.com/openapi.json)
- Pricing guide: [https://docs.dev.runwayml.com/guides/pricing/](https://docs.dev.runwayml.com/guides/pricing/)
- Base URL: `https://api.dev.runwayml.com`
- Auth: `Authorization: Bearer <RUNWAY_API_KEY>`, plus `X-Runway-Version: 2024-11-06`
- `X-Runway-On-Behalf-Of` is **mandatory for task creation** on our account. Submitting without
  it fails with HTTP 400 (`X-Runway-On-Behalf-Of request header was not specified for task
  creation`). The existing Runway adapter already sends it as a sha256 of the entity ID.
- The credential in Infisical at `/services/cfw-video-api` → `RUNWAY_API_KEY` has `ruby`
  enabled. All captures in this note were taken with it.

## Models, regions, and endpoint map

| Purpose | Method and path | Model ID |
| --- | --- | --- |
| Submit conversion | `POST /v1/video_upscale` is unrelated; use `POST /v1/video_to_hdr` | `ruby` |
| Poll task | `GET /v1/tasks/{id}` | shared with all Runway tasks |
| Cancel/delete task | `DELETE /v1/tasks/{id}` | shared with all Runway tasks |

Single global region. No callback or webhook support on this endpoint.

## Request and capability matrix

| Field | Support | Values | Default | Notes |
| --- | --- | --- | --- | --- |
| `model` | required | `ruby` | none | endpoint `provider_model_id` |
| `videoUri` | required | HTTPS URL, Runway upload URI, or base64 data URI | none | maps from a single `video_url` input reference. Base64 limit 16 MB (documented); the data URI form was exercised and accepted |
| `outputFormat` | optional | `hdr10`, `hlg`, `hdr_prores`, `hdr_exr_sequence` | `hdr10` | only `hdr10` and `hlg` are in scope |
| `proresProfile` | optional | `422`, `4444`, `422 HQ` | none | `hdr_prores` only, out of scope |
| `prompt`, `duration`, `resolution`, `aspect_ratio`, `size`, `seed`, `generate_audio`, `frame_images` | not supported | — | — | output geometry and duration are inherited from the input |

Standard request surface mapping:

- `input_references` with exactly one `video_url` → `videoUri`. Zero or multiple references is a
  400 from the adapter, matching the BFL upscale adapter's `extractSoleVideoReference`.
- `outputFormat` has no public parameter. It is read from `provider.options.runway.outputFormat`,
  validated against `hdr10` and `hlg`, and treated as adapter-owned so passthrough cannot inject
  the non-MP4 profiles. No public schema, OpenAPI, or MCP change is required.
- `supported_video_parameters` for the endpoint declares the supported `input_reference` modality
  and, for the hold, `supported_durations`. There is no `max_duration` capability field and this
  implementation does not add one; the adapter takes the maximum declared
  `supported_durations` value and falls back to 30 when it is absent or empty. No new capability
  field is needed.

Provider limits: maximum input duration 30 seconds (a 30-second input was accepted). Inputs
above the limit are rejected at submit as a body-validation 400.

## Submit/poll/status lifecycle

Identical to the Runway task lifecycle the existing adapter already implements. Submit returns
`{ id, estimatedCost }`; poll `GET /v1/tasks/{id}` until terminal; download `output[0]`.

Statuses observed and mapped: `RUNNING` → in progress, `SUCCEEDED` → completed. `PENDING`,
`THROTTLED`, `FAILED`, and `CANCELLED` are unchanged from the existing shared mapping in
`packages/providers/runway/task-lifecycle.ts`.

Two fields matter that the current schema does not model:

- `estimatedCost.credits`, present on the submit response and on every non-terminal poll.
- `cost.credits`, present on the terminal `SUCCEEDED` response.

Progress is reported as `progress` between 0 and 1.

## Artifact and callback behavior

`output[0]` is a signed CloudFront HTTPS URL with a JWT query parameter, expiring in 24-48 hours,
which the existing `validateRunwayVideoContentUrl` HTTPS and SSRF checks accept unchanged.

Verified output characteristics for both in-scope profiles (`ffprobe`, see
[Live capture matrix](#live-capture-matrix)):

- `hdr10` → HEVC Main 10, `yuv420p10le`, primaries `bt2020`, matrix `bt2020nc`, transfer
  `smpte2084` (PQ), MP4 container.
- `hlg` → same, transfer `arib-std-b67` (HLG).
- Both preserve input width, height, frame rate, duration, and the AAC audio track.

No callbacks or webhooks. Delivery flows through the existing video artifact path with no
changes.

## Errors, retries, timeout, and cancellation

- Unfetchable or invalid `videoUri` → HTTP 400 with a structured `issues` array. The existing
  `translateRunwayUpstreamError` already surfaces Runway's `error` field.
- Missing OBO header → HTTP 400 at task creation.
- `DELETE /v1/tasks/{id}` returns 204 and **deletes** the task: a subsequent `GET` returns HTTP
  404 `Could not find Task`, not a `CANCELLED` status. This is shared Runway behavior, not
  specific to HDR, and means a cancelled task yields no terminal cost and therefore bills
  nothing.
- No `FAILED` task was produced during research, so the failure payload for this endpoint is
  unverified. Failure mapping is shared code already covered by
  `packages/providers/runway/task-lifecycle.test.ts`.

## Billing and SKU reconciliation

Documented rate: 20 credits per second of output, 40 credits per second when the source exceeds
roughly 4 megapixels, identical across output profiles. 1 credit = $0.01.

Measured and reconciled exactly:

| Source | Megapixels | Output duration | Credits charged | Implied rate |
| --- | --- | --- | --- | --- |
| 1920x1080 | 2.07 | 5.70 s | 114 | 20.0 credits/s |
| 3840x2160 | 8.29 | 2.00 s | 80 | 40.0 credits/s |

Three conclusions follow, each of which shapes the pricing design.

1. **Credits are linear in fractional output seconds.** 5.7 seconds bills 114 credits, so there
   is no rounding up to whole seconds and no minimum charge above the per-second rate.
2. **The tier depends on source megapixels, which we do not know at submit time.** The request
   carries a URL, not dimensions. The 4-megapixel threshold sits between the two measured
   sources, consistent with the documented figure, but its exact boundary is unverified.
3. **The terminal `cost.credits` is the only billable quantity available at completion.** The
   task response carries no duration, resolution, or frame count, so a per-second SKU cannot be
   populated from the terminal payload. In all three completed captures the terminal cost equaled
   the submit-time estimate exactly.

### Pricing design

A new `runway_video_to_hdr` strategy, following the xAI video precedent of a provider-authoritative
cost SKU that overrides a configured per-second calculation:

- `runway_video_to_hdr:cents_per_second_output` = 20
- `runway_video_to_hdr:cents_per_second_output_large_source` = 40
- `runway_video_to_hdr:credits`, authoritative, 1 cent per credit

`getFinalUsageResponse` bills `credits` when it is present and positive, and otherwise falls back
to the per-second calculation. The per-second rates remain the public rate card and are what
`getPublicPricing` displays as two tiers.

The existing `runway_video` strategy cannot be reused: its SKUs key off *output* resolution and
audio, while this rate keys off *source* megapixels, and it has no authoritative-cost SKU.

### Billing lifecycle

- **Hold:** `getEstimatedSKUItems` returns the large-source per-second rate times the endpoint's
  maximum declared supported duration (30 when undeclared). The high tier is deliberate: source size is unknown at submit, and
  under-holding by 2x is the worse failure.
- **Submit:** push the `credits` SKU with count 0, so the item exists for the strategy to reduce,
  matching the BFL upscale adapter.
- **Terminal:** on `SUCCEEDED` with a positive `cost.credits`, push that value. A completed task
  with a missing or non-positive cost logs an error and feeds a Datadog monitor, mirroring
  `configs/terraform-monitors/monitoring/bfl_video_upscale_missing_cost.tf`.
- **Failed or cancelled:** nothing is pushed, so nothing is billed.

`estimatedCost.credits` from the submit response is not billed. It is recorded for the
discrepancy signal only, because a failed task must not be charged and the terminal value is the
one Runway settles on.

## Adapter/base-class choice

A new `RunwayVideoToHdrAdapter` on `BaseVideoGenerationAdapter`, not a new task path on the
existing `RunwayVideoAdapter`.

The existing adapter selects its task path from the request's input modality, where any
`video_url` reference means `video_to_video`. HDR cannot be distinguished from ordinary
video-to-video generation by inputs alone, so the selection has to come from the endpoint. A
separate adapter makes the endpoint row the selector, keeps `getUrl` a constant
`/v1/video_to_hdr`, and keeps HDR's billing out of the generation adapter's resolution-based SKU
logic. It reuses the shared Runway lifecycle constants, status enum, response schemas, failure
formatting, and moderation detection, and the shared artifact fetch and SSRF validation.

## Endpoint fields and pricing JSON

- `provider_model_id`: `ruby`
- Adapter: `RunwayVideoToHdrAdapter`
- Pricing strategy: `runway_video_to_hdr`
- `supported_video_parameters`: `supported_durations` topping out at 30, video input reference
  supported, no prompt
- `pricing_json`: the two per-second rates above
- `allowed_passthrough_parameters`: unchanged; `outputFormat` is adapter-owned

## Live capture matrix

All captures taken 2026-08-25 against `https://api.dev.runwayml.com` with the
`/services/cfw-video-api` key. Signed URLs and JWTs are redacted.

**1. Submit, `hdr10`, 1920x1080 5.7 s source**

```http
POST /v1/video_to_hdr
{"model":"ruby","videoUri":"https://samplelib.com/preview/mp4/sample-5s.mp4","outputFormat":"hdr10"}
```

```json
HTTP 200
{"id":"9a6fc5d5-...","estimatedCost":{"credits":114}}
```

**2. Poll, running**

```json
{"id":"9a6fc5d5-...","createdAt":"2026-08-25T23:17:00.540Z","status":"RUNNING","progress":0.9,"estimatedCost":{"credits":114}}
```

**3. Poll, succeeded**

```json
{"id":"9a6fc5d5-...","createdAt":"2026-08-25T23:17:00.540Z","status":"SUCCEEDED","output":["https://dnznrvs05pmza.cloudfront.net/<redacted>.mp4?_jwt=<redacted>"],"cost":{"credits":114}}
```

**4. Artifact, `hdr10`** — 15,335,970 bytes

```json
{"codec_name":"hevc","profile":"Main 10","width":1920,"height":1080,"pix_fmt":"yuv420p10le","color_space":"bt2020nc","color_transfer":"smpte2084","color_primaries":"bt2020","r_frame_rate":"30/1","duration":"5.700000"}
```

**5. Artifact, `hlg`** — same source, `cost.credits` 114

```json
{"codec_name":"hevc","profile":"Main 10","width":1920,"height":1080,"pix_fmt":"yuv420p10le","color_space":"bt2020nc","color_transfer":"arib-std-b67","color_primaries":"bt2020","duration":"5.700000"}
```

**6. Large-source tier, 3840x2160 2 s source sent as a base64 data URI**

```json
submit   {"id":"baa4c161-...","estimatedCost":{"credits":80}}
terminal {"status":"SUCCEEDED","cost":{"credits":80}}
```

**7. Body validation failure, unfetchable asset**

```json
HTTP 400
{"error":"Validation of body failed","issues":[{"code":"custom","message":"Failed to fetch asset. Received HTTP response code \"404\".","path":["videoUri"]}],"docUrl":"https://docs.dev.runwayml.com/api"}
```

**8. Missing OBO header**

```json
HTTP 400
{"error":"X-Runway-On-Behalf-Of request header was not specified for task creation"}
```

**9. Cancellation**

```text
DELETE /v1/tasks/{id}  → HTTP 204
GET    /v1/tasks/{id}  → HTTP 404 {"error":"Could not find Task"}
```

**10. 30-second input** — accepted, `estimatedCost.credits` 600, cancelled before completion.

## Open questions

- **Non-MP4 profiles.** `hdr_prores` returns a ProRes MOV and `hdr_exr_sequence` returns a ZIP of
  OpenEXR frames with `colorimetry.json`, `provenance.json`, and an optional audio track. Whether
  the video route, storage, and response schema tolerate a non-video artifact is unverified.
  Excluded from this implementation.
- **Exact megapixel threshold.** Documented as roughly 4 megapixels and consistent with the two
  measured points, but the boundary itself was not probed. The authoritative-cost design makes
  this a display-accuracy question, not a billing-correctness one.
- **`FAILED` payload for this endpoint.** Not produced during research.
- **Hold size.** The worst-case hold for a 30-second input at the high tier is 1200 credits. This
  is correct but large for a caller submitting a short clip.
