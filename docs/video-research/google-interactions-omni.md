# Google AI Studio — Gemini Omni 1.1 Flash via Interactions (`google/gemini-omni-1.1-flash`)

Gemini Omni is served through the Google Interactions API rather than the Veo `predictLongRunning` API, so it runs on `GoogleAIStudioInteractionsVideoAdapter`. The adapter shipped with continuation support (`previous_interaction_id`, see [#43251](https://github.com/OpenRouterTeam/openrouter-web/pull/43251)) but dropped `duration` and `resolution` and declared no `frame_images` support. This note records the live probe that established what the deployed model honours, and the adapter changes made from it. Nothing here is staged, launched, or written to a database.

## Sources and authentication

- Gemini Omni video documentation as provided by Google on 2026-09-17 (resolution table, `video_config.task`, first/last frame source tags, "You can extend videos by 10s, up to a total length of 40s"). No public URL was captured with the document.
- `@google/genai` SDK 2.19.0 `VideoResponseFormat` type: `duration` ("The duration for the video output") and `resolution` ("Defaults to 720p"), and `generation_config.video_config.task` with `text_to_video`, `image_to_video`, `reference_to_video`, `edit`, `extend`.
- Live probe: `fixtures/scripts/collect-google-interactions-video.ts` run 2026-09-18 UTC against `https://generativelanguage.googleapis.com/v1beta/interactions` with the dev `GOOGLE_AI_STUDIO_API_KEY` from Infisical `/_providers`. Media was downloaded outside the repo and measured with `ffprobe`.
- Authentication header: `x-goog-api-key: <key>`. No key value appears in this note, in fixtures, or in the repository.

## Models, regions, and endpoint map

| Purpose  | Method and path                                                          |
| -------- | ------------------------------------------------------------------------ |
| Submit   | `POST /v1beta/interactions` with `background: true`                      |
| Poll     | `GET /v1beta/interactions/{id}`                                          |
| Artifact | `GET /v1beta/files/{name}:download?alt=media` (needs the API key header) |

Direct AI Studio model ID: `gemini-omni-1.1-flash`. Staged OpenRouter permaslug: `google/gemini-omni-1.1-flash-20260911`. AI Studio exposes a single global host. Google documents regional restrictions for uploaded-video editing and extension only, not for generation from text or images.

## Request and capability matrix

| OpenRouter field                                                                              | Provider field                                                                                                                        | Live status  | Notes                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`                                                                                      | `input[].content[{type:'text'}]`                                                                                                      | confirmed    | required                                                                                                                                                                                                               |
| `duration` (number)                                                                           | `response_format.duration` (string, `"5s"`)                                                                                           | confirmed    | `5` → 5.000s output. The Gemini document shows no duration field; the SDK type and the live API accept it.                                                                                                             |
| `resolution`                                                                                  | `response_format.resolution`                                                                                                          | confirmed    | `360p` → `360p`, `720p` → `720p`, `1080p` → `1080p`, `4K` → `4k` (lowercase). Default 720p. `480p`, `768p`, `1K`, `2K` are rejected with a 400 before dispatch.                                                        |
| `aspect_ratio`                                                                                | `response_format.aspect_ratio`                                                                                                        | pre-existing | `16:9`, `9:16`                                                                                                                                                                                                         |
| `input_references` (image)                                                                    | image content, prompt prefixed with `[# References <IMAGE_REF_N>@ImageM]`                                                             | confirmed    | audio references are rejected with a 400                                                                                                                                                                               |
| `input_references` (one video, no other media)                                                | inline `video` content, prompt prefixed with `[# Sources <VIDEO_0>@Video1]`                                                           | confirmed    | the clip is the source to edit or extend. Google rejects external `https` URIs and Files API URIs for video, so the adapter downloads the `video_url` and inlines it as base64, capped at 30 MB of video per request   |
| `input_references` (one to three videos as references)                                        | inline `video` content, prompt prefixed with `[# References <VIDEO_REF_N>@VideoM]`                                                    | confirmed    | a lone clip becomes a reference when the request continues a prior interaction, carries images, or asks for `task: reference_to_video`. A fourth clip is rejected with a 400                                           |
| `frame_images` `first_frame`                                                                  | image content first, prompt prefixed with `[# Sources <FIRST_FRAME>@Image1]`                                                          | confirmed    | first output frame matched the input image                                                                                                                                                                             |
| `frame_images` `first_frame` + `last_frame`                                                   | two images, prompt prefixed with `[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2]`                                               | confirmed    | first and last output frames matched the inputs                                                                                                                                                                        |
| `frame_images` `last_frame` alone                                                             | —                                                                                                                                     | not probed   | rejected with a 400                                                                                                                                                                                                    |
| `frame_images` + image `input_references`                                                     | frame image first, then reference images, prompt prefixed with `[# Sources <FIRST_FRAME>@Image1] [# References <IMAGE_REF_0>@Image2]` | confirmed    |                                                                                                                                                                                                                        |
| `previous_job_id`                                                                             | top-level `previous_interaction_id`                                                                                                   | confirmed    | extension appended 5s to a 5s clip when `duration: "5s"` was requested. Image and video references may accompany the extension. Total delivered length is capped at 40s before dispatch when the prior length is known |
| `task` provider passthrough (`provider.options[<slug>].task`)                                  | `generation_config.video_config.task`                                                                                                 | confirmed    | only `text_to_video`, `image_to_video`, `reference_to_video`, `edit`, `extend` are forwarded, any other value is a 400. The option is flat because the Interactions body has no `parameters` object, unlike Veo's `predictLongRunning` body                                                                                                    |
| `system_instruction`, `temperature`, `top_p`, `stop_sequences`, `negative_prompt` passthrough | —                                                                                                                                     | unsupported  | Omni's video pipeline ignores them, so they are never forwarded                                                                                                                                                        |
| `seed` (public field or passthrough) | — | unsupported | the Omni doc has no seed control, so it is stripped like the other unsupported controls rather than forwarded |
| `generate_audio` | — | unsupported | Omni always renders an audio track, so `false` is a 400 before dispatch (Sora precedent) and `true` is a no-op |

The `@ImageM` and `@VideoM` bindings index media by position in the content list, counted per media type, so every media part precedes the single text part and the declarations are prefixed to the prompt in the order source images, source video, reference images, reference videos.

## Submit/poll/status lifecycle

1. `POST /interactions` with `background: true` returns `{ id, status: 'in_progress', model, ... }` immediately.
2. `GET /interactions/{id}` is polled until `status` is `completed` or `failed`.
3. The completed body carries `steps[].content[]` with a `video` item whose `uri` is a Files API download URL, plus `usage.output_tokens_by_modality`.

Unchanged by this work. The poll body's `created` and `updated` timestamps were equal on every completed capture, so they do not measure render time.

## Artifact and callback behavior

`delivery: 'uri'` is always requested because Google documents inline delivery failing above 4 MB. The completed interaction echoes the requested `response_format` (including `duration` and `resolution` when they were sent), but does not report the delivered duration or resolution as separate fields. No callback or webhook is offered, so OpenRouter polls.

## Errors, retries, timeout, and cancellation

Unchanged. New pre-dispatch errors: 400 for a `resolution` the provider does not document, more than three video clips, more than one entry per frame type, an unknown `task` value, a `video_url` that cannot be fetched, or a continuation whose known prior length plus requested extension exceeds 40s. 413 for video input above 30 MB per request. 415 for video bytes that are not MP4, QuickTime, or WebM. An earlier local continuation attempt returned "Video extension is currently not supported" from Google, while both the production run and this probe extended successfully with the same request shape; the condition behind the earlier rejection was not isolated. The `video-edit-task` probe (source video plus `task: edit`) failed at the terminal poll with Google's "Input blocked: The prompt could not be processed" safety rejection, while the same source video without the task succeeded. The rejection names the prompt, so it is not attributed to the `task` field. A later local API run with `task: edit`, an uploaded source, and `response_format.duration: "5s"` was rejected at submit with "Duration cannot be set in response format for edit task", so the adapter omits `duration` from `response_format` whenever the task is `edit` and uses the public `duration` only for billing.

## Billing and SKU reconciliation

Before this work the adapter billed the requested duration on the base with-audio Veo SKU while sending Google no duration, so Google rendered its 10s default and a 7s request under-billed by 3s. With `duration` forwarded, the measured output length equals the requested length for 5s and 10s at every probed resolution, and the default estimate is 10s (measured when no duration is sent). Extension in the probe added the requested 5s to a 5s clip and Google's `usage.output_tokens_by_modality` reported 28 960 tokens, the same as a fresh 5s 720p clip, so billing the requested duration for a continuation matches what Google itself charged for the new footage.

`getEstimatedSKUItems` now selects the SKU through `getVeoSKU(resolution ?? 720p, withAudio = true)`: 360p bills `veo:duration_seconds_with_audio_360p`, 720p bills `veo:duration_seconds_with_audio_720p`, 4K bills `veo:duration_seconds_with_audio_4k`, and 1080p bills the base `veo:duration_seconds_with_audio`, which the Veo display pricing already labels as the 1080p tier. `getVeoPrice` falls back to the base with-audio rate for a tier whose SKU is absent from `pricing_json`, so an endpoint that sets only the base rate bills every resolution at that rate until the tier SKUs are priced. The production Omni endpoint's `pricing_json` sets only the base rate today (`0.10136`, the 720p rate), so tier-specific billing is not verified in production.

Google prices Omni video output at $17.50 per 1M output tokens and documents 5 792 tokens per second at 720p. Multiplying the measured per-second token rates by that price gives the per-second prices the endpoint should carry: 360p `0.0337925`, 720p `0.10136`, 1080p `0.15204`, 4K `0.30408`. Because the base SKU is the 1080p tier, the base rate must move from `0.10136` to `0.15204` in the same pricing version that adds the explicit 720p SKU, and that version must not take effect before the adapter that selects the 720p SKU is deployed, otherwise 720p output bills at the 1080p rate.

Continuation billing is incremental: a continuation bills the requested extension duration only, while the recorded `video_output_duration` is the prior clip's known length plus the extension. When the prior job predates the stored duration column the total is recorded as unknown rather than as the extension alone.

Output tokens scaled linearly with duration at a fixed resolution in the probe (5 792 tokens per second at 720p, 8 688 at 1080p, 17 376 at 4K). Deriving the delivered duration from tokens is therefore possible but was not implemented: the completed interaction does not report resolution when it was not requested, so the per-second rate cannot be chosen from the response alone.

360p at 5s reported 9 655 output tokens (1 931 per second). Editing and extending the uploaded 480x270 source video also reported 9 655 tokens for 5s with no `resolution` requested, which suggests the output followed the source resolution rather than the 720p default. The delivered dimensions were not measured for those two captures, so this is an inference.

## Adapter/base-class choice

No new adapter. `GoogleInteractionsVideoAdapter` gains three request-side helpers: `response-format.ts` (duration string and resolution mapping with the 400 for unsupported tiers), `input-content.ts` (media ordering and the `[# Sources ...]` / `[# References ...]` declarations), and `video-content.ts` (download or data-URL decode of `video_url` inputs into inline base64 under the 30 MB cap). Response parsing is untouched; the fixture-backed `checkStatus` tests only prove the existing parser accepts the live Omni bodies.

## Endpoint fields and pricing JSON

No endpoint change is made in this PR. The adapter declares `inputReferenceModalities: [image, video]` and `frameImageTypes: [first_frame, last_frame]` because every video adapter on `main` declares capabilities on the adapter today. [#43506](https://github.com/OpenRouterTeam/openrouter-web/pull/43506) moves those declarations into endpoint metadata (`supported_input_references`, `supported_frame_images`). Whichever lands second must carry the Omni declarations into the endpoint record.

The endpoint record follows the sibling Veo convention: canonical `supported_sizes` rather than `supported_resolutions` (the public `/api/v1/videos/models` route derives resolutions and aspect ratios from the size table), `supported_frame_images: ["first_frame", "last_frame"]`, `supported_durations` kept at 3 to 10, and `allowed_passthrough_parameters: ["task"]`. The 360p sizes (`640x360`, `360x640`) are rejected by the Buddy capability validator until this PR's enum change is deployed, so the endpoint update must follow the deploy. The live endpoint's `features.supports_video_urls: false` is not read by the video routing pipeline (only the chat routing filter, the playground, and benchmark derank read it), so it does not block HTTPS `video_url` inputs to `/api/v1/videos` and is left alone. The model row already lists text, image, and video in `input_modalities`.

## Live capture matrix

| Scenario                                      | Request                                                                                                       | Delivered                                                 | Output tokens |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------- |
| `duration-5s`                                 | `duration: "5s"`                                                                                              | 1280x720, 5.000s, 120 frames, 24 fps, audio               | 28 960        |
| `resolution-1080p`                            | `resolution: "1080p"`                                                                                         | 1920x1080, 10.000s, 240 frames, audio                     | 86 880        |
| `resolution-4k-duration-5s`                   | `resolution: "4k"`, `duration: "5s"`                                                                          | 3840x2160, 5.000s, 120 frames, audio                      | 86 880        |
| `first-frame`                                 | one image + `<FIRST_FRAME>@Image1`                                                                            | 1280x720, 10s, first frame matches input                  | 57 920        |
| `first-last-frame`                            | two images + `<FIRST_FRAME>@Image1 <LAST_FRAME>@Image2`, `duration: "5s"`                                     | 1280x720, 5s, first and last frames match inputs          | 28 960        |
| `extend`                                      | `previous_interaction_id` of `duration-5s`, `duration: "5s"`                                                  | 1280x720, 10.000s, 240 frames, audio                      | 28 960        |
| `resolution-360p-duration-5s`                 | `resolution: "360p"`, `duration: "5s"`                                                                        | completed                                                 | 9 655         |
| `image-ref`                                   | one image + `[# References <IMAGE_REF_0>@Image1]`, `duration: "5s"`                                           | completed                                                 | 28 960        |
| `first-frame-image-ref`                       | two images + `[# Sources <FIRST_FRAME>@Image1] [# References <IMAGE_REF_0>@Image2]`, `duration: "5s"`         | completed                                                 | 28 960        |
| `first-frame-image-video-ref`                 | two images + one clip + `[# Sources <FIRST_FRAME>@Image1] [# References <IMAGE_REF_0>@Image2 <VIDEO_REF_0>@Video1]`, `duration: "5s"` | accepted at submit, terminal poll `not_found`, "Requested entity was not found." | — |
| `video-edit`                                  | inline 5s 480x270 source + `[# Sources <VIDEO_0>@Video1]`, edit prompt                                        | completed, 5s output at the source's dimensions          | 9 655         |
| `video-extend-upload`                         | same source + `[# Sources <VIDEO_0>@Video1]`, extension prompt, `duration: "5s"`                              | completed                                                 | 9 655         |
| `video-edit-task`                             | same source + `generation_config.video_config.task: "edit"`                                                   | failed, "Input blocked"                                   | —             |
| `video-ref-1` / `video-ref-2` / `video-ref-3` | one to three inline 3s clips + `[# References <VIDEO_REF_N>@VideoM]`, `duration: "5s"`                        | completed                                                 | 28 960 each   |
| `video-ref-task`                              | one clip + `task: "reference_to_video"`, `duration: "5s"`                                                     | completed, `generation_config` echoed                     | 28 960        |
| `video-ref-too-long`                          | the 5s source clip declared as `<VIDEO_REF_0>`, `duration: "5s"`                                              | completed, no rejection of a clip above the documented 3s | 28 960        |
| `image-video-ref`                             | one image + one clip + `[# References <IMAGE_REF_0>@Image1 <VIDEO_REF_0>@Video1]`, `duration: "5s"`           | completed                                                 | 28 960        |
| `extend-with-refs`                            | `previous_interaction_id` of `duration-5s` + one image + one clip with `[# References ...]`, `duration: "5s"` | completed                                                 | 28 960        |

All captures ran against AI Studio directly with `fixtures/scripts/collect-google-interactions-video.ts`. Every scenario renders a real video and is billed by Google. Video transport was probed before the matrix: an external `https` video `uri` fails at the terminal poll with "HTTP video input is not supported by the model" and a Files API `uri` fails with "Unsupported file uri: blobstore:///...", so every video probe inlines base64 bytes.

## Open questions

- Accepted `duration` range and the behaviour of non-integer or out-of-range values. Only 5s and the 10s default were probed.
- Whether `task: edit` on a source video is rejected in general or only for the probed prompt. The one capture failed with a prompt safety message, and the local API run with the same task reached Google's request validation (the duration rejection above), so the task value itself is accepted.
- Whether `last_frame` alone is accepted by Google. It is rejected before dispatch until probed.
- Whether Google accepts a first frame combined with both a subject image and a video reference clip. The direct probe was accepted at submit and then disappeared (`not_found` on poll), and the same combination through the local API failed at the terminal poll with a generic `invalid_request` 400. Each pair (frame + image, image + clip) succeeds on its own, so the adapter still forwards the triple and surfaces Google's rejection.
- Delivered dimensions for edit and extension of an uploaded source, which the poll body does not report. Both local edit probes (480x270 and 1280x720 sources) returned 5s clips at the source's dimensions, so the adapter requires an explicit `duration` for an uploaded source and bills that value instead of the 10s text-to-video default. Google rejects `response_format.duration` when `task: edit` is explicit, and whether an inferred edit (no `task`) honours or rejects it is unprobed.
- Reconciling billed duration against Google's `usage.output_tokens_by_modality` once the resolution is known from the request.

## Fixture inventory

Raw captures under `fixtures/google-interactions/`, one `.submit.json` (raw `POST` body) and one `.poll.json` (raw terminal `GET` body) per scenario:

- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-duration-5s`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-resolution-1080p`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-resolution-4k-duration-5s`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-first-frame`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-first-last-frame`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-extend`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-resolution-360p-duration-5s`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-image-ref`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-first-frame-image-ref`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-first-frame-image-video-ref`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-video-edit`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-video-extend-upload`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-video-edit-task`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-video-ref-1`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-video-ref-2`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-video-ref-3`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-video-ref-task`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-video-ref-too-long`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-image-video-ref`
- `2026-09-18-gemini-omni-1-1-flash-aistudio-video-extend-with-refs`

`first-frame-input.jpg` and `last-frame-input.jpg` are the probe's input images. `source-video-input.mp4` (5s, 480x270, 24 fps, the `duration-5s` render downscaled) is the uploaded source for the edit and extension probes, and `reference-video-input-1.mp4` through `reference-video-input-3.mp4` (3s each, 480x270, 24 fps) are the reference clips. The small dimensions keep the inline request bodies well under the 30 MB cap. The `.submit.json` files hold the raw submit response. The request bodies are reproducible from the collector's scenario table. The poll bodies contain Google interaction IDs and Files API URIs; both are opaque resource names that require the API key to dereference and carry no credential.
