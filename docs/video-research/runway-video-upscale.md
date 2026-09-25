# Runway video upscale (`magnific_video_upscaler_creative`)

Runway's `magnific_video_upscaler_creative` upscales an existing video to a requested target
resolution. It accepts a video input, returns an asynchronous task, and charges by output frame.
This note is phase-1 research only; it does not add an adapter, pricing strategy, model, endpoint,
or capability rows.

## Sources and authentication

- OpenAPI source of record: <https://docs.dev.runwayml.com/openapi.json>, fetched
  2026-08-26 UTC and saved locally as `/home/ubuntu/runway-upscale-e2e/openapi.json`.
- Pricing source of record: <https://docs.dev.runwayml.com/guides/pricing/>.
- API base URL: `https://api.dev.runwayml.com`.
- Submit endpoint: `POST /v1/video_upscale`.
- Poll endpoint: `GET /v1/tasks/{id}`.
- Cancellation/deletion endpoint: `DELETE /v1/tasks/{id}`.
- API version header: `X-Runway-Version: 2024-11-06`.
- Authentication header: `Authorization: Bearer <RUNWAY_API_KEY>`.
- `X-Runway-On-Behalf-Of` was sent as a SHA-256 identifier. This header is required for task
  creation on the provisioned account; the key was read from Infisical
  project `771b7bc0-6578-41b0-886e-9fcdb66e9173`, environment `dev`, path
  `/services/cfw-video-api`, secret `RUNWAY_API_KEY`. The key was never written to a capture or
  included in this note.
- The provider endpoint and model owner are Runway. The API host was global in these captures;
  region-specific routing was not exposed or tested.
- These captures used the provider API directly, not OpenRouter staging, so OpenRouter BYOK
  behavior is not established here.

## Models, regions, and endpoint map

| Purpose | Method and path | Model |
| --- | --- | --- |
| Submit upscale | `POST /v1/video_upscale` | `magnific_video_upscaler_creative` |
| Poll task | `GET /v1/tasks/{id}` | shared task endpoint |
| Cancel/delete | `DELETE /v1/tasks/{id}` | shared task endpoint |

The OpenAPI endpoint uses a `model` discriminator with one currently documented request variant,
`magnific_video_upscaler_creative`. No callback or webhook field appears in that request schema.
Callback behavior is therefore **Unverified**, rather than assumed unsupported.

## Official request and response contract

### Request

The JSON body has `additionalProperties: false` and requires `model` and `videoUri`; the optional
fields below may also be supplied:

```json
{
  "model": "magnific_video_upscaler_creative",
  "videoUri": "https://example.com/video.mp4",
  "resolution": "2k"
}
```

`videoUri` is required and accepts:

- an HTTPS URL (OpenAPI string length 13–2048);
- a Runway upload URI beginning `runway://` (length 13–5000); or
- a `data:video/*` URI (length 13–16,777,216).

The provider documentation describes the data-URI size limit as up to 16 MB. The live captures
used MP4 data URIs. The base64 value is omitted from this note because it is large; the exact
unredacted request bodies are retained at `/home/ubuntu/runway-upscale-e2e/request-1k.json`,
`request-2k.json`, and `request-cancel.json`.

Optional fields in the official schema are:

| Field | Type and values | Documented meaning |
| --- | --- | --- |
| `resolution` | `"720p"`, `"1k"`, `"2k"`, `"4k"`; default `"2k"` | Target output resolution from 720p to 4k |
| `creativity` | integer 0–100 | Amount of AI-generated detail |
| `sharpen` | integer 0–100 | Sharpness intensity |
| `smartGrain` | integer 0–100 | Grain and texture enhancement |
| `flavor` | `"vivid"` or `"natural"` | Processing style |
| `fpsBoost` | boolean | Whether to increase output frame rate |

`model` is required and is a constant with value
`magnific_video_upscaler_creative`. `upscale_factor`, `duration`, `aspect_ratio`, `size`, `seed`,
`generate_audio`, `prompt`, frame-image fields, and callback fields are not present in this
endpoint's documented request schema.

### Submit response

Successful submission is HTTP 200 and returns an object with required `id` and `estimatedCost`:

```json
{
  "id": "uuid",
  "estimatedCost": {
    "credits": 63
  }
}
```

The OpenAPI description says `estimatedCost` is the maximum credits the task may charge and that
the final amount may be lower after completion. It is not terminal billing.

Documented submit errors include:

- HTTP 400 with required `error` and optional field-level `issues` containing `code`, `path`, and
  `message`;
- HTTP 429 with required `error`.

### Task responses

`GET /v1/tasks/{id}` is HTTP 200 and uses `status` as a discriminator:

- `PENDING`, `THROTTLED`: `id`, `createdAt`, `status`, and `estimatedCost`;
- `RUNNING`: the same fields plus `progress` from 0 to 1;
- `SUCCEEDED`: `id`, `createdAt`, `status`, `output` (an array of URLs), and `cost.credits`;
- `FAILED`: `id`, `createdAt`, `status`, `failure`, and `cost.credits`;
- `CANCELLED`: `id`, `createdAt`, `status`, and `cost.credits`.

The OpenAPI schema marks `cost` as required for every terminal status and describes it as the
final cost in credits; a refunded task reports zero. The terminal success responses captured here
contained one MP4 URL in `output`.

Output URLs are documented to expire within 24–48 hours. They are signed CloudFront HTTPS URLs.
The expiration window was not independently timed in this research.

## Request and capability matrix

This endpoint is an input-video-to-upscaled-video operation, not text-to-video, image-to-video,
audio-to-video, or frame-image generation.

| Capability | Provider behavior established by OpenAPI/live capture | Phase-2 representation |
| --- | --- | --- |
| Video input | Required; HTTPS, Runway upload, or base64 video URI | One `video_url` input reference |
| Text prompt | Not in this endpoint schema | Unsupported |
| Image input / image-to-video | Not in this endpoint schema | Unsupported |
| Audio reference | Not in this endpoint schema | Unsupported |
| Frame images | Not in this endpoint schema | Unsupported |
| Native audio generation | Not in this endpoint schema | Do not expose `generate_audio` |
| Duration | Input asset must be at most 30 seconds; output duration followed source in both captures | Do not expose a duration selector |
| Resolution | `720p`, `1k`, `2k`, `4k`; default `2k` | Use existing `resolution` values |
| Upscale factor | Not in schema; provider selects target resolution | Declare `upscale_factor` unsupported |
| Aspect ratio / size | Not in schema; output geometry is provider-selected for target tier | Unsupported |
| Seed | Not in schema | Unsupported |
| Creativity | Optional integer 0–100 | Hidden in v1 |
| Sharpen | Optional integer 0–100 | Hidden in v1 |
| Smart grain | Optional integer 0–100 | Hidden in v1 |
| Flavor | Optional `vivid` / `natural` | Hidden in v1 |
| FPS boost | Optional boolean | Hidden and explicitly disabled in v1 |
| Callback/webhook | No field in the captured schema | Unverified |

The output geometry is not a simple fixed multiplier. The 1k capture produced 1920×1072 from a
640×360 source, while the 2k capture produced 2560×1440 from a 1280×720 source. Those are
measured provider outputs, not a general geometry rule.

## Submit/poll/status lifecycle

The provider lifecycle is:

1. Submit a JSON request and receive HTTP 200 with an upstream UUID and estimated credits.
2. Poll `GET /v1/tasks/{id}`. The captured jobs returned `PENDING`, then `RUNNING` with a
   fractional `progress` and the same `estimatedCost`.
3. On `SUCCEEDED`, read `output[0]` and terminal `cost.credits`.
4. Download the signed artifact promptly.

The 1k task took 101 captured polls to reach success, and the 2k task took 134 captured polls.
Polling was performed approximately every three seconds in this research, while Runway's task
documentation says consumers should not expect updates more frequently than every five seconds.
The observed processing time is provider-dependent and should not be used as an application
timeout.

The submit response and all selected non-terminal task responses contained `estimatedCost`. The
terminal responses contained `cost.credits` and did not contain `estimatedCost`.

### Payload availability of FPS and duration

Measured across both submit responses and all captured polls:

- FPS was absent from submit, pending, running, and terminal payloads.
- Duration was absent from submit, pending, running, and terminal payloads.
- The provider task payloads contained no source geometry, output geometry, frame count, or audio
  metadata.

Consequently, an adapter cannot derive frame-based preauthorization or output duration from the
Runway task payload. FPS and duration must come from the source at request time or artifact
inspection, subject to what the serving lifecycle makes available. The phase-2 preauthorization
decision below uses the requested tier, assumed 30 FPS, and the maximum accepted 30-second
duration.

## Live capture matrix

All captures below were taken on 2026-08-26 UTC against the real Runway API. The request bodies
used base64 MP4 data URIs; the large `videoUri` values are omitted from this note but preserved
verbatim in the request files listed in [Fixture inventory and durable artifacts](#fixture-inventory-and-durable-artifacts).
JSON is reproduced from the raw response files, except that signed output URL JWT query values
are redacted.

### 1k job

Source: `source-640x360.mp4`, 640×360, 30 FPS, 3.000 seconds, requested `resolution: "1k"`.
Submit status is recorded in `submit-1k.status`.

```json
{
  "model": "magnific_video_upscaler_creative",
  "videoUri": "data:video/mp4;base64,<base64 omitted from note>",
  "resolution": "1k"
}
```

Submit response (`HTTP 200`, `submit-1k.json`):

```json
{
  "id": "acf9ba3d-a513-42c9-a646-96e8bc97c691",
  "estimatedCost": {
    "credits": 63
  }
}
```

Pending poll (`HTTP 200`, `poll-1k-1.json`):

```json
{
  "id": "acf9ba3d-a513-42c9-a646-96e8bc97c691",
  "createdAt": "2026-08-26T06:30:33.796Z",
  "status": "PENDING",
  "estimatedCost": {
    "credits": 63
  }
}
```

Running poll (`HTTP 200`, `poll-1k-3.json`):

```json
{
  "id": "acf9ba3d-a513-42c9-a646-96e8bc97c691",
  "createdAt": "2026-08-26T06:30:33.796Z",
  "status": "RUNNING",
  "progress": 0.02,
  "estimatedCost": {
    "credits": 63
  }
}
```

Terminal poll (`HTTP 200`, `poll-1k-101.json`):

```json
{
  "id": "acf9ba3d-a513-42c9-a646-96e8bc97c691",
  "createdAt": "2026-08-26T06:30:33.796Z",
  "status": "SUCCEEDED",
  "output": [
    "https://dnznrvs05pmza.cloudfront.net/magnific_video_upscaler/magnific_video_upscaler_creative/acf9ba3d-a513-42c9-a646-96e8bc97c691/video_upscale___https___runway_uploads_prod_s3_amazonaws_com_public_api_c5750bda_cf20_4aa2_b72c_5f02.mp4?_jwt=<redacted>"
  ],
  "cost": {
    "credits": 63
  }
}
```

### 2k job

Source: `source-1280x720.mp4`, 1280×720, 30 FPS, 3.000 seconds, requested `resolution: "2k"`.
Submit status is recorded in `submit-2k.status`.

```json
{
  "model": "magnific_video_upscaler_creative",
  "videoUri": "data:video/mp4;base64,<base64 omitted from note>",
  "resolution": "2k"
}
```

Submit response (`HTTP 200`, `submit-2k.json`):

```json
{
  "id": "4f4c92e6-1d4d-4d00-b2e8-5b7d0b6de6e3",
  "estimatedCost": {
    "credits": 81
  }
}
```

Pending poll (`HTTP 200`, `poll-2k-1.json`):

```json
{
  "id": "4f4c92e6-1d4d-4d00-b2e8-5b7d0b6de6e3",
  "createdAt": "2026-08-26T06:36:01.616Z",
  "status": "PENDING",
  "estimatedCost": {
    "credits": 81
  }
}
```

Running poll (`HTTP 200`, `poll-2k-3.json`):

```json
{
  "id": "4f4c92e6-1d4d-4d00-b2e8-5b7d0b6de6e3",
  "createdAt": "2026-08-26T06:36:01.616Z",
  "status": "RUNNING",
  "progress": 0.02,
  "estimatedCost": {
    "credits": 81
  }
}
```

Terminal poll (`HTTP 200`, `poll-2k-134.json`):

```json
{
  "id": "4f4c92e6-1d4d-4d00-b2e8-5b7d0b6de6e3",
  "createdAt": "2026-08-26T06:36:01.616Z",
  "status": "SUCCEEDED",
  "output": [
    "https://dnznrvs05pmza.cloudfront.net/magnific_video_upscaler/magnific_video_upscaler_creative/4f4c92e6-1d4d-4d00-b2e8-5b7d0b6de6e3/video_upscale___https___runway_uploads_prod_s3_amazonaws_com_public_api_f44f2ca9_c535_445a_bb1b_2745.mp4?_jwt=<redacted>"
  ],
  "cost": {
    "credits": 81
  }
}
```

## Artifact and media characteristics

All source clips were generated locally with FFmpeg using `testsrc2`, H.264 video, `yuv420p`,
AAC-LC mono audio at 48 kHz, 30 FPS, and 3 seconds. Source probe JSON is retained at:

- `/home/ubuntu/runway-upscale-e2e/source-640x360.ffprobe.json`
- `/home/ubuntu/runway-upscale-e2e/source-1280x720.ffprobe.json`

The delivered artifacts were downloaded with HTTP 200 and probed with `ffprobe`:

| Capture | Container | Video codec/profile | Pixel format | Video geometry | Video FPS | Video duration | Audio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1k | MP4 (`mov,mp4,m4a,3gp,3g2,mj2`) | H.264 High | `yuv420p` | 1920×1072 | 30/1 | 3.000 s | AAC-LC, 48 kHz, mono |
| 2k | MP4 (`mov,mp4,m4a,3gp,3g2,mj2`) | H.264 High | `yuv420p` | 2560×1440 | 30/1 | 3.000 s | AAC-LC, 48 kHz, mono |

The MP4 container durations were 3.030 s in both outputs because the audio streams were
approximately 3.029 s; the video streams remained exactly 3.000 s. Audio survived both
upscales. Complete probe JSON is retained at:

- `/home/ubuntu/runway-upscale-e2e/artifact-1k.ffprobe.json`
- `/home/ubuntu/runway-upscale-e2e/artifact-2k.ffprobe.json`

### Detail regeneration observation

The source and output frames at approximately 1.5 seconds were compared side by side after
downscaling the outputs to 640×360. The provider outputs showed added fine texture in the
checkerboard region and changed edge detail compared with bicubic resizing. The 2k output showed
more visible texture than the 1k output. The comparison image is
`/home/ubuntu/runway-upscale-e2e/frame-comparison-bicubic.jpg`.

This is evidence that the output is not merely a byte-for-byte or straightforward pixel-resize
result for this synthetic test pattern. It does not establish that every generated detail is
semantically faithful, nor does it separate the model's learned detail generation from all other
provider processing. That broader quality claim remains **Unverified**.

## Errors, retries, timeout, and cancellation

### 30-second duration limit

A 31-second, 640×360 H.264 source was submitted as a base64 MP4 data URI with this request shape:

```json
{
  "model": "magnific_video_upscaler_creative",
  "videoUri": "data:video/mp4;base64,<31-second MP4>",
  "resolution": "1k"
}
```

Runway rejected it before task creation:

```http
HTTP 400
```

```json
{
  "error": "Validation of body failed",
  "issues": [
    {
      "code": "too_big",
      "maximum": 30,
      "type": "number",
      "inclusive": true,
      "origin": "number",
      "message": "Asset duration must be at most 30 seconds",
      "path": ["videoUri"]
    }
  ],
  "docUrl": "https://docs.dev.runwayml.com/api"
}
```

No task ID or estimated cost was returned. This supports, and does not contradict, the documented
30-second maximum. Request, response, status, and source probe files are retained at:

- `/home/ubuntu/runway-upscale-e2e/request-over-30s.json`
- `/home/ubuntu/runway-upscale-e2e/submit-over-30s.json`
- `/home/ubuntu/runway-upscale-e2e/submit-over-30s.status`
- `/home/ubuntu/runway-upscale-e2e/source-over-30s.ffprobe.json`

### Cancellation

A separate 720p task was submitted and polled while `PENDING`, then deleted:

```text
POST /v1/video_upscale → HTTP 200
GET  /v1/tasks/{id}    → HTTP 200, PENDING, estimatedCost 63
DELETE /v1/tasks/{id}  → HTTP 204
GET  /v1/tasks/{id}    → HTTP 404, {"error":"Could not find Task"}
```

The exact response captures are `submit-cancel.json`, `poll-cancel.json`,
`delete-cancel.status`, and `get-after-delete.json` under
`/home/ubuntu/runway-upscale-e2e/`. The cancellation response had no body. No terminal cost was
observed for the deleted task.

No provider failure or moderation task was intentionally induced. Failure payload details beyond
the official schema are **Unverified**.

## Billing and SKU reconciliation

The official pricing guide states that `magnific_video_upscaler_creative` is billed per output
frame:

```text
USD = rate × output FPS × output duration in seconds
credits = ceil(USD / 0.01)
minimum charge = 1 credit per generation
```

The published rates are:

| Resolution | USD per output frame | Cents per frame |
| --- | ---: | ---: |
| 720p | $0.007 | 0.7¢ |
| 1k | $0.007 | 0.7¢ |
| 2k | $0.009 | 0.9¢ |
| 4k | $0.012 | 1.2¢ |

The guide also warns that `fpsBoost` may change output frame count and therefore cost.

### Live reconciliation

Both outputs retained the source 30 FPS and 3.000-second video duration. Expected credits use the
required formula `ceil(rate × fps × duration / 0.01)`:

| Tier | Public rate | FPS | Duration | Expected credits | Terminal `cost.credits` | Difference | Rounding | Supports phase-2 pricing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1k | 0.7¢/frame | 30 | 3.000 s | `ceil(0.7×30×3)` = 63 | 63 | 0 | Exact integer | Yes |
| 2k | 0.9¢/frame | 30 | 3.000 s | `ceil(0.9×30×3)` = 81 | 81 | 0 | Exact integer | Yes |

Both submit estimates matched terminal charges: 1k estimated 63 and charged 63; 2k estimated 81
and charged 81. This does not make an estimate authoritative: the OpenAPI explicitly says the
estimate is a maximum and the final amount may be lower.

The OpenAPI task schema requires `cost.credits` on `SUCCEEDED`, `FAILED`, and `CANCELLED`
responses, so terminal cost is contractually required for terminal task payloads. In live
behavior, both successful captures populated it consistently. No failed or cancelled terminal
payload was observed; the cancellation test deleted the task and returned 404 rather than a
`CANCELLED` payload. Therefore “always populated” is established by the official schema for
terminal variants, while live coverage is limited to successful tasks.

`cost.credits` is the correct settlement quantity for phase 2: it is the provider's final terminal
charge, matched the frame-rate formula in both live successful jobs, and is available even though
the task payload does not expose FPS, duration, or frame count. A missing terminal cost would
contradict the documented terminal schema and must not silently fall back to the estimate.

## Adapter/base-class choice

Phase 2 should add a separate `RunwayVideoUpscaleAdapter` directory and class extending
`BaseVideoGenerationAdapter`, reusing the shared Runway task lifecycle. This is a settled design
decision supported by the code:

- `packages/video-generation/adapters/runway/index.ts` resolves task paths from input modality.
  Its `resolveRunwayTaskPath` maps a video input to `video_to_video`; the request alone cannot
  distinguish ordinary video-to-video generation from this endpoint.
- `packages/db/providers/index.ts` includes `adapterName` and `pricingStrategy` in
  `PROVIDER_INFO_OVERRIDABLE_FIELDS`, so endpoint identity can select a dedicated adapter and
  pricing strategy.
- `packages/video-generation/adapters/runway-video-to-hdr/index.ts` is the existing precedent:
  `RunwayVideoToHdrAdapter` has a dedicated class and returns the constant
  `/v1/video_to_hdr` URL.
- `packages/providers/runway/task-lifecycle.ts` centralizes Runway's API version and OBO header
  constants, task statuses, submit response, and task response schemas.
- `packages/video-generation/adapters/runway/task-response.ts` maps shared Runway statuses and
  terminal outputs into the video-generation result shape.
- `packages/video-generation/adapters/black-forest-labs-video-upscale/index.ts` is the analogous
  dedicated upscale adapter rather than a branch added to the provider's ordinary generation
  adapter.

## Phase-2 endpoint and pricing decisions

These decisions are settled for implementation after this note:

1. **Public parameter:** use the existing `resolution` values and map
   `720p → 720p`, `1K → 1k`, `2K → 2k`, and `4K → 4k`. Runway accepts a target resolution, and
   does not accept `upscale_factor`; source dimensions are not known at submit time.
2. **Hidden advanced fields:** do not expose `creativity`, `sharpen`, `smartGrain`, `flavor`, or
   `fpsBoost` in v1. Runway defaults are the stable minimal surface. In particular, Runway's
   continuous 0–100 creativity field does not match the existing integer allowlist without
   widening shared schema, routing, and model-listing surfaces.
3. **FPS boost:** keep it disabled. The official pricing guide says it can change output frame
   count and therefore price; enabling it would make the planned source-FPS billing assumption
   unreliable.
4. **Pricing strategy:** add `runway_video_upscale`. Public rates use Runway list pricing with
   zero markup: 0.7¢/frame at 720p and 1k, 0.9¢/frame at 2k, and 1.2¢/frame at 4k.
5. **Settlement:** use terminal `cost.credits` as authoritative at one cent per credit. Do not
   settle from `estimatedCost`.
6. **Preauthorization:** hold against the requested resolution tier, assumed 30 FPS, and the
   maximum accepted 30-second duration. The request supplies the tier, while the provider task
   payload supplies neither FPS nor duration. The resulting maximum holds are 630 credits at
   720p/1k, 810 credits at 2k, and 1080 credits at 4k.
7. **Missing cost:** if a completed task has no terminal cost, emit an `eLog` and a Datadog
   monitor, following the missing-cost precedent in
   `configs/terraform-monitors/monitoring/bfl_video_upscale_missing_cost.tf`. Do not silently
   substitute estimated cost or a guessed per-frame calculation.
8. **Endpoint identity:** use `provider_overrides.adapterName` for the dedicated adapter and
   `pricingStrategy` for the dedicated strategy. This preserves separation from ordinary Runway
   video-to-video routing.

## Fixture inventory and durable artifacts

Raw captures and generated media are intentionally outside the repository for this phase:

- Official OpenAPI: `/home/ubuntu/runway-upscale-e2e/openapi.json`.
- Source media and probes: `source-*.mp4`, `source-*.ffprobe.json`, and
  `source-over-30s.*`.
- Submit requests/responses: `request-*.json`, `submit-*.json`, `submit-*.headers`,
  `submit-*.status`.
- Selected async polls: `poll-1k-1.json`, `poll-1k-3.json`, `poll-1k-101.json`,
  `poll-2k-1.json`, `poll-2k-3.json`, and `poll-2k-134.json`, with matching headers/status files.
- Downloaded artifacts and probes: `artifact-1k.mp4`, `artifact-1k.ffprobe.json`,
  `artifact-2k.mp4`, and `artifact-2k.ffprobe.json`.
- Error and cancellation captures: `submit-over-30s.*`, `submit-cancel.*`, `poll-cancel.*`,
  `delete-cancel.*`, and `get-after-delete.*`.
- Visual comparison: `frame-comparison.jpg` and `frame-comparison-bicubic.jpg`.

The repository contains no committed media, provider key, signed URL, or raw capture. Signed
artifact URLs in this note are redacted; the unredacted URLs remain only in local terminal JSON
files under the capture directory.

## Unverified

- Provider behavior for `FAILED` or moderation terminal payloads from this endpoint; the official
  schema documents their shape, but no such task was induced.
- A live `CANCELLED` terminal payload; deletion returned 204 followed by 404.
- The exact signed-artifact expiration time; the official documentation says 24–48 hours.
- Callback/webhook support, retry limits, provider rate-limit responses, and the exact behavior of
  `THROTTLED`.
- Output geometry rules for every source aspect ratio and every target tier.
- Whether all source codecs, containers, audio layouts, and frame rates are accepted and preserved.
- Whether non-default `creativity`, `sharpen`, `smartGrain`, and `flavor` settings change output
  quality or billing beyond the documented contract.
- Whether `fpsBoost` changes frame rate in every source condition; only its documented cost impact
  was established.
- Whether the observed added texture is semantically faithful model-generated detail for
  photographic or natural video rather than the synthetic test pattern used here.
- OpenRouter staging, production routing, BYOK, storage, artifact-fetch, accounting, and
  monitoring behavior; those belong to phase 2.
