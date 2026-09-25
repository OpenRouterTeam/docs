# Black Forest Labs — FLUX Video Upscale

Research for a dedicated video-upscaling adapter on the `/video` API. Every payload below is a live
capture taken against `api.bfl.ai` with the `BLACK_FOREST_LABS_API_KEY` from Infisical
(`/services/cfw-video-api`), with signatures and keys redacted.

## Sources and authentication

- <https://docs.bfl.ai/flux_tools/flux_video_upscale> — endpoint, parameters, limits.
- <https://docs.bfl.ai/quick_start/pricing> — credit pricing (1 credit = $0.01 USD) and the
  megapixel-second definition (1 megapixel = 1,048,576 px, i.e. 1024 × 1024).
- Auth: `x-key: <BLACK_FOREST_LABS_API_KEY>` plus `Content-Type: application/json`, identical to the
  existing FLUX 3 video and FLUX image endpoints. A malformed key returns HTTP 422
  `{"detail":"Invalid API key format"}`.

## Models, regions, and endpoint map

| Purpose | Method and path |
| --- | --- |
| Submit | `POST https://api.bfl.ai/v1/flux-tools/video-upscale-v1` |
| Poll | `GET <polling_url>` from the submit response, e.g. `https://api.ice.bfl.ai/v1/get_result?id=<id>` |

The submit host is global; the poll host is regional and varies per submission (`api.ice.bfl.ai`,
`api.us6.bfl.ai` were both observed). Both satisfy the existing
`validateBFLPollUrl` rules (HTTPS, leftmost label `api`, `.bfl.ai` suffix, `/get_result` path), so
the polling URL must be persisted as the upstream job ID exactly as FLUX 3 does.

Artifacts are served from regional delivery hosts (`https://delivery.ice.bfl.ai/ephemeral/...`),
which satisfy the existing `delivery`/`delivery-*` + `.bfl.ai` content-host rule.

`provider_model_id` for the endpoint is `flux-tools/video-upscale-v1`, so
`${baseUrl}/${provider_model_id}` yields the submit URL with the existing `baseUrl`
(`https://api.bfl.ai/v1`) — the same `getUrl` shape as the FLUX 3 video adapter.

## Request and capability matrix

| Upstream field | Type / range | Default | Notes |
| --- | --- | --- | --- |
| `input_video` | HTTPS URL or base64 MP4 | required | Exactly one source clip. Max 50 MB, max 20 s. |
| `upscale_factor` | number 1.5–3 | 2 | HTTP 422 outside the range (capture below). |
| `creativity` | integer 0 or 1 | 1 | 0 = Precise, 1 = Creative. Selects the price tier. |
| `prompt` | string | none | Optional descriptive prompt; not billed separately. |
| `safety_tolerance` | integer 0–4 | 2 | Same field the FLUX 3 endpoint exposes as passthrough. |
| `webhook_url` / `webhook_secret` | string | none | Not used; the job Durable Object polls. |

The endpoint takes no `duration`, `resolution`, `aspect_ratio`, `size`, `seed`, or `generate_audio`:
output geometry is the source geometry times `upscale_factor`, output duration equals source
duration, and the source clip's audio track is carried through. Consequently the OpenRouter-side
`supported_video_parameters` for this endpoint advertise no durations, resolutions, aspect ratios,
frame images or audio flag — only a video input reference. No serving enum needs extending.

Input references: exactly one `video_url` entry. Zero references, two or more video references, and
image/audio references or `frame_images` are all client errors (HTTP 400) — this endpoint has no
text-to-video or image-to-video fallback.

## Submit/poll/status lifecycle

Submit (`upscale_factor: 1.5`, `creativity: 0`, base64 5 s 1280 × 704 source):

```json
{
  "id": "7b32ef80-…",
  "polling_url": "https://api.ice.bfl.ai/v1/get_result?id=7b32ef80-…",
  "cost": null,
  "input_mp": null,
  "output_mp": null
}
```

`cost`, `input_mp`, and `output_mp` were `null` on submit for both a base64 source and an HTTPS URL
source, so they carry no pre-flight billing signal.

Poll while running (progress is a 0–1 fraction):

```json
{
  "id": "7b32ef80-…",
  "status": "Pending",
  "result": null,
  "progress": 0.4,
  "details": null,
  "preview": null
}
```

Poll on success:

```json
{
  "id": "7b32ef80-…",
  "status": "Ready",
  "result": {
    "sample": "https://delivery.ice.bfl.ai/ephemeral/…/result.mp4?se=2026-08-19T00%3A01%3A21Z&sig=…",
    "duration": 45.17,
    "prompt": "Upscale and enhance: ",
    "seed": 3744260447
  },
  "progress": null,
  "details": null,
  "preview": null,
  "cost": 74.0
}
```

`result.duration` is the **processing** time in seconds (45.17 s of processing for a 5 s clip;
28.51 s for the second capture), not the output clip length. It must not be used as the video
duration.

Statuses are the shared `BFLStatus` set already modelled in
`packages/providers/black-forest-labs/job-lifecycle.ts`: `Pending` (transient), `Ready` (terminal
success), `Error` / `Request Moderated` / `Content Moderated` (terminal failure), `Task not found`
(non-terminal — regional task stores can answer for a task they do not own). A poll for an unknown
ID returns HTTP 404 with `{"status":"Task not found", …}`, so the existing retry-then-stay-retryable
handling applies unchanged.

## Artifact and callback behavior

- `result.sample` is a signed Azure blob URL whose `se=` expiry is ~1 hour after readiness (readiness
  23:01:21Z, expiry 00:01:21Z), shorter than FLUX 3's window. Re-querying the task returns a freshly
  signed URL, so the artifact fetch must re-poll before downloading — the same approach the FLUX 3
  adapter takes.
- Artifact response: `HTTP 200`, `content-type: video/mp4`, `content-length: 11796739`.
- Verified output geometry: a 1280 × 704 / 5.04 s source at `upscale_factor: 1.5` delivered
  1920 × 1056 / 5.04 s.
- Webhooks are supported upstream but unused here.

## Errors, retries, timeout, and cancellation

| Case | Status | Body |
| --- | --- | --- |
| `upscale_factor: 5` | 422 | `{"detail":[{"type":"less_than_equal","loc":["body","upscale_factor"],"msg":"Input should be less than or equal to 3","input":5,"ctx":{"le":3.0}}]}` |
| missing `input_video` | 422 | `{"detail":[{"type":"missing","loc":["body","input_video"],"msg":"Field required","input":{"upscale_factor":2}}]}` |
| invalid key | 422 | `{"detail":"Invalid API key format"}` |
| unknown task poll | 404 | `{"id":"…","status":"Task not found","result":null,…}` |

There is no cancellation endpoint. Moderation and generation failures arrive as terminal statuses on
a 200 poll, not as HTTP errors.

## Billing and SKU reconciliation

BFL bills the delivered output only: `credits = rate × output_megapixels × output_seconds`, where a
megapixel is 1,048,576 px and rates are $0.075/MP·s (Precise, `creativity: 0`) and $0.105/MP·s
(Creative, `creativity: 1`). Reconciliation against the two live jobs:

| Capture | Output | Duration | MP·s | Expected (Precise) | Upstream `cost` |
| --- | --- | --- | --- | --- | --- |
| 1280 × 704 → 1.5× | 1920 × 1056 | 5.04 s | 9.75 | 73.1 credits | 74.0 |
| 960 × 540 → 1.5× | 1440 × 810 | 5.01 s | 5.57 | 41.8 credits | 43.0 |

Upstream rounds to whole credits, so the reported `cost` is authoritative and within ~1 credit of
the documented formula.

Billing consequence: the billable quantity depends on the *delivered* output, and neither the source
geometry nor the source duration is known before the job completes. The adapter therefore bills from
the `cost` credits on the terminal poll, converting them back into megapixel-seconds at BFL's list
rate for the resolved mode, and records them under a per-mode SKU so the endpoint's `pricing_json`
carries OpenRouter's own per-MP·s rate:

- `bfl_video_upscale:cents_per_megapixel_second_precise`
- `bfl_video_upscale:cents_per_megapixel_second_creative`

This is the same shape as `xai_video:cost_in_usd_ticks` (SKU items pushed from the terminal poll)
except the quantity stays in the unit the rate card is written in, so markup and public pricing
display both work. The pre-flight estimate is necessarily an assumption — it only sizes the pending
charge hold, which is released and replaced by the final usage — and uses the maximum accepted source
duration with a 1080p-equivalent output frame.

Failed and moderated jobs push no SKU items and are not billed. A `Ready` poll with zero or missing
`cost` is logged as an error and returned as a 502 upstream fault so the poll is retried and the job
never settles at the zero submit entry (same rule as FLUX Video Edit).

## Adapter/base-class choice

`BaseBlackForestLabsVideoToolAdapter` (the shared submit/poll/artifact lifecycle for BFL
video-in/video-out tools, also used by FLUX Video Edit), in
`packages/video-generation/adapters/black-forest-labs-video-upscale/` with its own
`VideoGenerationAdapterName`. It shares BFL's poll-URL validation, poll-response schema, status
mapping, delivery-host validation, and task-not-found retry with the FLUX 3 adapter, but its request
shape, price card, and input rules have nothing in common with FLUX 3 generation.

## Endpoint fields and pricing JSON

```json
{
  "provider_overrides": {
    "baseUrl": "https://api.bfl.ai/v1",
    "adapterName": "BlackForestLabsVideoUpscaleAdapter",
    "pricingStrategy": "bfl_video_upscale"
  },
  "allowed_passthrough_parameters": ["safety_tolerance"],
  "supported_video_parameters": {
    "upscale_factor": { "min": 1.5, "max": 3 },
    "creativity": [0, 1],
    "seed": false,
    "generate_audio": false
  }
}
```

`pricing_json` carries the two per-megapixel-second rates in cents.

## Live capture matrix

| Case | Captured |
| --- | --- |
| Submit (base64 source) | yes |
| Submit (HTTPS URL source) | yes |
| Poll pending (with progress) | yes |
| Poll ready (+ cost) | yes |
| Artifact download headers and geometry | yes |
| Validation errors (422 × 3), unknown task (404) | yes |
| Moderation / generation failure | no — not reproducible without a violating clip; shape is the shared BFL terminal-status shape |
| Expired signed URL | not captured; re-query returns a fresh URL |

- Whether the endpoint should advertise a maximum input duration/size so oversized clips fail before
  reaching upstream.
