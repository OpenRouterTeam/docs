# Black Forest Labs — FLUX Video Edit [fast]

Research for a dedicated video-editing adapter on the `/video` API. Payloads below come from the
public BFL docs and OpenAPI spec (the endpoint is GA on 2026-09-10 18:00 CET). No live captures
were taken before launch; see "Open before launch" at the bottom.

## Sources and authentication

- <https://docs.bfl.ai/flux_tools/flux_video_edit> — endpoint, parameters, limits.
- <https://docs.bfl.ai/quick_start/pricing> — `FLUX Video Edit [fast]: $0.03 per second` of output
  video, 1 credit = $0.01 USD. "The output keeps the source clip's length, so a ten second clip
  costs the same whatever the edit."
- Auth: `x-key: <BLACK_FOREST_LABS_API_KEY>` plus `Content-Type: application/json`, identical to
  FLUX 3 video and FLUX Video Upscale.

## Endpoint map

| Purpose | Method and path |
| --- | --- |
| Submit | `POST https://api.bfl.ai/v1/flux-tools/video-edit-v1` |
| Poll | `GET <polling_url>` from the submit response, regional `api.<region>.bfl.ai/v1/get_result?id=<id>` |

Same submit/poll/delivery topology as FLUX Video Upscale, so the adapter reuses
`validateBFLPollUrl`, `fetchBFLStatusResponse`, `mapBFLVideoResultResponse`,
`fetchBFLContentStatus` and `validateBFLVideoContentUrl` unchanged.

## Request

```json
{
  "video": "https://example.com/source.mp4",
  "prompt": "Remove the orange bucket.",
  "safety_tolerance": 2
}
```

- `video` (required): HTTP(S) URL or base64 MP4. Max 15 s, 50 MiB, at least 160 px per side, at
  least 17 frames after normalisation to 24 fps.
- `prompt` (required): 1–4096 characters after whitespace normalisation.
- `safety_tolerance` (optional): integer 0–4, default 2. Exposed via endpoint
  `allowed_passthrough_parameters`, not a first-class `/video` field.
- Nothing else is accepted. `duration`, `resolution`, `aspect_ratio`, `size`, `seed`,
  `generate_audio` are derived from the source, so the adapter rejects them with 400 via the shared
  `extractSoleVideoReference` helper. Sources above 720p are downscaled to 720p, output is 24 fps.

## Response and polling

Submit returns `{ "id": "...", "polling_url": "https://api.<region>.bfl.ai/v1/get_result?id=..." }`.
Polling returns the standard BFL lifecycle (`Pending`, `Generating`, `Ready`, `Error`,
`Request Moderated`, `Content Moderated`, `Task not found`) with `result.sample` as the delivery
URL and `cost` in credits on `Ready`.

## Billing

- Estimate at submit: 15 output seconds (the source ceiling) at the endpoint rate, then a zero
  `bfl_video_edit:cents_per_second_output` item so the SKU is present.
- Final at `Ready`: `cost / 3` credits → output seconds, appended as the same SKU. Last write wins.
  `setVideoDuration` receives the same value.
- Zero or missing `cost` on `Ready` is logged as an error and returned as a 502 upstream fault, so
  the poll is retried and the job never settles at the zero submit entry.

## Open before launch

- Live capture of a submit + `Ready` poll to confirm `cost` is populated and `cost / 3` matches the
  probed artifact duration. `tests/manual/api/video/bfl-flux-video-edit.test.ts` asserts this.
- Confirm the endpoint is enabled on the production BFL key.
