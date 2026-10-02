# HeyGen — Video 1 (`heygen/heygen-video-1`)

HeyGen Video 1 is HeyGen's general-purpose generative video model: text-to-video, image-to-video from one first frame, and reference-to-video from up to twelve image, video, and audio references. It is a different product from the two HeyGen adapters already in the repo (`HeyGenAvatarIVAdapter` animates a talking head, `HeyGenVideoAgentAdapter` scripts an avatar video), but it shares HeyGen's `x-api-key` authentication and the `GET /v3/videos/{video_id}` rendered-video lookup, so `HeyGenVideo1Adapter` reuses the `heygen-shared` headers, video-details, and artifact helpers. Nothing in this note is staged, launched, or written to a database.

## Sources and authentication

- Partner integration guide (source of record, NDA until launch): <https://developers.heygen.com/docs/heygen-video-partner-integration>, fetched 2026-09-25 UTC.
- API base URL: `https://api.heygen.com`.
- Authentication header: `x-api-key: <HEYGEN_API_KEY>` (`heygenHeaders` in `packages/video-generation/adapters/heygen-shared/headers.ts`). The platform key is the existing `HEYGEN_API_KEY` in Infisical under `/_providers`; no key value appears in this note or in the repository.
- Required key scopes: `videos:write`, `videos:read`, and `assets:write` when references are uploaded as assets. Trial keys are rejected on the Video 1 route.
- BYOK: HeyGen already maps to `HEYGEN_API_KEY` in `packages/providers/configs/api-key.ts`, so BYOK works the same way as for the two existing HeyGen endpoints. No provider-config change is needed.

## Models, regions, and endpoint map

| Purpose | Method and path |
| --- | --- |
| Submit | `POST /v3/models/videos` with `"model": "heygen-video-1"` |
| Poll | `GET /v3/videos/{video_id}` |
| Model-native details | `GET /v3/models/videos/{video_id}` (not used; the shared poll route carries `video_url` and `duration`) |

The guide lists one model identifier, `heygen-video-1`, and one global host. No region routing is offered, so the endpoint row has no `provider_region`.

## Request and capability matrix

| Field | Type and values | OpenRouter mapping |
| --- | --- | --- |
| `model` | literal `heygen-video-1` | set by the adapter |
| `mode` | `text_to_video`, `image_to_video`, `reference_to_video` | derived from the request shape, see below |
| `prompt` | string, required in every mode, 1–32000 chars | `prompt` (trimmed; empty is a 400) |
| `image` | one `{type:'url',url}` or `{type:'base64',media_type,data}` object | one `frame_images` entry with `frame_type: first_frame` |
| `reference_images` | 1–9 file objects | `input_references` of type `image_url` |
| `reference_videos` | 1–3 file objects | `input_references` of type `video_url` |
| `reference_audio` | 1–3 file objects | `input_references` of type `audio_url` |
| `duration` | integer, 5–15 inclusive, default 5 | `duration` |
| `resolution` | `480p`, `768p` | `resolution` |
| `aspect_ratio` | `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16` | `aspect_ratio`; also reached through `size`, which the base adapter resolves into resolution plus aspect ratio before `transformRequest` |
| `seed` | unsigned 32-bit integer | `seed` |
| `callback_url`, `callback_id` | HTTPS URL plus opaque ID | not exposed; OpenRouter polls |

Mode selection: a `first_frame` image selects `image_to_video`, any `input_references` select `reference_to_video`, otherwise `text_to_video`. A `first_frame` together with `input_references` is rejected with a 400 because HeyGen has no mode that accepts both; the caller can pass the image as a reference instead. Total references are capped at 12 across the three arrays, and `reference_to_video` needs at least one image or video, so an audio-only reference set is a 400.

References are accepted as HTTPS URLs, and images additionally as inline base64 data URLs whose MIME type matches the reference modality (`toHeyGenFile` in `packages/video-generation/adapters/heygen-shared/reference-file.ts`); a `data:` string that is not base64-encoded or carries the wrong MIME family is a 400. Video and audio data URLs are rejected by the shared lifecycle gate (`validateVideoReferenceUrls`) before the adapter runs, because inline video and audio have not been verified against HeyGen; the adapter would forward them as `base64` files if that gate is opened later. HeyGen additionally accepts asset IDs from `POST /v1/asset`; the adapter does not implement asset upload, so asset-ID references are out of scope for this launch. HeyGen fetches URL references server-side with its own SSRF checks and does not follow redirects.

Audio: Video 1 always renders a generated AAC track. `generate_audio: false` is a 400 (there is no way to honor it), `generate_audio: true` is accepted and omitted from the native body, and the endpoint advertises `generate_audio: false` in `supported_video_parameters` so the parameter is not offered as a toggle.

Aspect ratio in `image_to_video`: the guide says the first frame determines output geometry and `aspect_ratio` is ignored. The adapter accepts `aspect_ratio` (or `size`) in that mode and drops the ratio from the native body while keeping the resolution half of `size`, because the playground always sends a `size` and a 400 here would make every playground image-to-video request fail. The value is still validated against the supported list before it is dropped.

Unknown request fields are rejected by HeyGen with `Extra inputs are not permitted`, which is why the adapter validates the native body against `HeyGenVideo1RequestSchema` before dispatch and never forwards passthrough parameters.

## Submit/poll/status lifecycle

1. `POST /v3/models/videos` returns `{ data: { status: "pending", video_id } }` (HTTP 202). `video_id` is the upstream job ID.
2. `GET /v3/videos/{video_id}` returns `data.status` in `waiting`, `pending`, `processing`, `completed`, or `failed`. `waiting` and `pending` map to `AsyncJobStatus.Pending`, `processing` to `InProgress`, `failed` to `Failed` with `failure_message`, and anything outside the enum is a 502 upstream fault.
3. On `completed`, `data.video_url` and `data.duration` are both required; a completed response missing either is a 502 upstream fault rather than a zero-second bill.

Observed timing on 2026-09-25 (`completed_at - created_at` in the poll fixtures): text-to-video 4 s, image-to-video 9 s, single-reference 12 s, three-reference multimodal 24 s, all for 5-second 480p clips. The guide gives no SLA. Cancellation is not supported after submission and no expiry status is documented, so the adapter models neither.

## Artifact and callback behavior

`data.video_url` is an MP4 (H.264, 24 fps, AAC 32 kHz stereo) on `resource2.heygen.ai`; `thumbnail_url` is a CloudFront-signed URL with an `Expires` parameter a few days out. `fetchHeyGenVideoContent` downloads the video URL and, on a 403 or 404, re-resolves it once through `GET /v3/videos/{video_id}` before returning 410, the same path the Avatar IV adapter uses. Callbacks (`callback_url`, `callback_id`) are documented as fire-once with no retry, so the adapter does not rely on them and OpenRouter polls.

## Errors, retries, timeout, and cancellation

Validation errors are HTTP 400 with `{ error: { code, message, param, doc_url } }`; the captured `duration: 3` rejection is `invalid_parameter` / `Input should be greater than or equal to 5`. Trial keys are rejected on this route. Nothing in the guide documents a retry budget or a job timeout, and there is no cancel endpoint, so a job that never leaves `processing` is bounded only by OpenRouter's own polling deadline.

## Billing and SKU reconciliation

HeyGen's rate card prices Video 1 per rendered second by mode and resolution: text-to-video and image-to-video at $0.02 (480p) / $0.03 (768p), reference-to-video output at $0.04 (480p) / $0.06 (768p). Image and audio references are free; HeyGen also lists a per-second charge on the *input* reference video at the reference-to-video rate. HeyGen labels the model 50% off through the end of October 2026, after which list rates apply.

The adapter bills through `HeyGenPricingStrategy` with four tiered SKUs (`heygen:duration_seconds_480p`, `heygen:duration_seconds_768p`, `heygen:reference_duration_seconds_480p`, `heygen:reference_duration_seconds_768p`); the flat `heygen:duration_seconds` SKU stays in the same strategy for Avatar IV and Video Agent. `getHeyGenVideo1SKU` picks the tier at submit time from the request (any `input_references` selects the reference tier; `first_frame` alone is image-to-video and bills like text-to-video; an omitted `resolution` bills 768p because that is what HeyGen renders). `transformRequest` records the tier with the `duration ?? 5` estimate; on `completed` the adapter appends the provider-reported `duration` under the same SKU and `reduceSkuItems` keeps the last value. Because settlement (`computeUsage` in `packages/video-generation/helpers/init-tx.ts`) turns a pricing-strategy error into a $0 bill with a warning log, `transformRequest` refuses with a 503 any request whose tier has no rate in the endpoint's `pricing_json` (`hasHeyGenRate`), so an unpriced render never starts. A completed poll with no recorded tier (a job submitted by the pre-tier adapter, whose request-time SKU was either absent or the flat one) bills under the flat `heygen:duration_seconds` SKU. `getPublicPricing` renders every configured rate as its own rate-card row, so carry either the flat rate or the tiers on a public endpoint, never both; let jobs submitted before the tiered deploy settle (renders take under a minute) before swapping `pricing_json`.

Not billed: the per-second charge on the input reference video. The adapter does not know the source clip's length and HeyGen's poll response carries only the rendered `duration`; if HeyGen exposes the input duration or a cost field on the completed job, add a SKU for it then.

The 50% promotion is `discount_to_user: 0.5` on the endpoint row, not a promotional rate in `pricing_json`; remove it on 2026-11-01.

## Adapter/base-class choice

New adapter `HeyGenVideo1Adapter` (`packages/video-generation/adapters/heygen-video-1/`), registered as `VideoGenerationAdapterName.HeyGenVideo1Adapter` with its own `VideoResult` branch. The two existing HeyGen adapters are avatar products with different request shapes and passthrough parameters; sharing a class would have meant branching on `provider_model_id` inside every method. Shared pieces (`heygenHeaders`, `VideoDetailsResponseSchema`, `fetchHeyGenVideoDetails`, `fetchHeyGenVideoContent`, `toHeyGenFile`) live in `heygen-shared`.

## Endpoint fields and pricing JSON

A **hidden** endpoint on a new `heygen/heygen-video-1` model row owned by the HeyGen author, `output_modalities: ['video']`, `input_modalities: ['text', 'image', 'video', 'audio']`.

- `provider_name`: `HeyGen`
- `provider_model_id`: `heygen-video-1`
- `provider_overrides`: `{ "adapterName": "HeyGenVideo1Adapter" }`
- `allowed_passthrough_parameters`: none
- `supported_video_parameters`:

```json
{
  "seed": true,
  "generate_audio": false,
  "supported_sizes": null,
  "supported_durations": [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  "supported_resolutions": ["480p", "768p"],
  "supported_aspect_ratios": ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
  "supported_frame_images": ["first_frame"]
}
```

- `pricing_json`, list rates in dollars per rendered second (the promotion is `discount_to_user`, see Billing):

```json
{
  "heygen:duration_seconds_480p": "0.02",
  "heygen:duration_seconds_768p": "0.03",
  "heygen:reference_duration_seconds_480p": "0.04",
  "heygen:reference_duration_seconds_768p": "0.06"
}
```

## Live capture matrix

All captures were taken against `api.heygen.com` on 2026-09-25 with `fixtures/scripts/collect-heygen-video.ts` and live under `fixtures/heygen-video/`. Signed-URL `Signature` values are redacted; everything else is verbatim.

| Scenario | Request | Result |
| --- | --- | --- |
| `text-to-video-done` | 480p, 5 s, `16:9`, seed 42 | completed, 5.0 s |
| `image-to-video-done` | one `url` image, 480p, 5 s | completed, 5.0 s |
| `reference-to-video-done` | one `reference_images` URL, 480p, 5 s, `16:9` | completed, 5.0 s |
| `reference-to-video-multimodal-done` | one image, one video, one audio reference, 480p, 5 s | completed, 5.0 s |
| `rejected-duration` | `duration: 3` | HTTP 400 `invalid_parameter` |

Each completed scenario has a `.submit.json` and a `.poll.json` (final `completed` poll) with matching `.http.json` status companions. Snapshot tests in `packages/video-generation/adapters/heygen-video-1/index.test.ts` pipe every fixture through `transformResponse` and `checkStatus`.

## Ownership

- Private access before launch: the endpoint stays hidden until the tiered pricing is applied and the launch-calendar owner (Mindi Weik) unhides it on 2026-09-30.
- Production cleanup: the endpoint row and any test generations created while staging belong to the launch owner; the adapter has no other production footprint.
