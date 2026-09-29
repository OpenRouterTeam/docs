# Video Endpoint Configuration

How to read and write `supported_video_parameters` on video generation endpoints through the Buddy API.

> **Read the code when this file and your assumptions disagree.** Video adapters
> live under `packages/video-generation/adapters/<provider>/`.
> `SupportedVideoParametersSchema` lives in `packages/db/endpoints/index.ts`, and
> its enums live in `packages/enums/video-parameters.ts`. The Buddy API capability
> validator is
> `services/cfw-internal/src/routes/buddy-api/validate-capability-fields.ts`.

---

## The `supported_video_parameters` Schema

All fields are optional (may be absent) or nullable. Canonical schema drawn from live endpoints (Kling, Seedance, Wan, Hailuo, Veo):

```json
{
  "seed": true,
  "generate_audio": true,
  "supported_sizes": ["1280x720", "720x1280", "1920x1080", "1080x1920"],
  "supported_durations": [4, 6, 8],
  "supported_resolutions": null,
  "supported_aspect_ratios": null,
  "supported_frame_images": ["first_frame", "last_frame"]
}
```

### Field-by-field reference

| Field | Type | Notes |
|-------|------|-------|
| `seed` | `boolean \| null` | `true` = supported, `false` = not supported, `null` = unknown |
| `generate_audio` | `boolean \| null` | Whether the model can generate audio alongside the video |
| `supported_sizes` | `VideoSize[] \| null` | Values must be members of the `VideoSize` enum, such as `"1280x720"`. Never use `{width, height}` objects |
| `supported_durations` | `number[] \| null` | Supported video lengths in seconds |
| `supported_resolutions` | `string[] \| null` | Usually `null`; use `supported_sizes` instead |
| `supported_aspect_ratios` | `string[] \| null` | Usually `null`; use `supported_sizes` instead |
| `supported_frame_images` | `VideoFrameType[] \| null` | Frame conditioning values must be members of the `VideoFrameType` enum |

The schema uses `z.nativeEnum(VideoSize)` for `supported_sizes` and `z.nativeEnum(VideoFrameType)` for `supported_frame_images`. These are closed serving enums, not free-form strings.

### When a supported value fails capability validation

Endpoint create and update routes validate capability fields. A `400` response with `capability_issues` can identify a missing serving enum value.

If the provider supports the rejected value, report the exact issues to the launch thread. Request a Devin adapter PR that extends the relevant serving enum. Wait for the change to deploy, and then re-stage the endpoint. **Never drop the supported value or omit the field to make validation pass.**

---

## Frame Image Support (`first_frame` / `last_frame`)

Adding image-to-video conditioning means adding strings to the **`supported_frame_images` array**. This is the canonical pattern across all live video endpoints (Kling, Seedance, Wan, Hailuo):

```json
// CORRECT — both frames
"supported_frame_images": ["first_frame", "last_frame"]

// CORRECT — first frame only
"supported_frame_images": ["first_frame"]
```

**Common mistakes to avoid:**

```json
// WRONG — boolean flags inside supported_video_parameters
"first_frame": true,
"last_frame": true

// WRONG — in allowed_passthrough_parameters
"allowed_passthrough_parameters": [..., "first_frame", "last_frame"]
```

---

## `supported_sizes` Format

Always use `"WxH"` strings. Never use `{width, height}` objects — they are inconsistent with every other video endpoint in the system:

```json
// CORRECT
"supported_sizes": ["1280x720", "720x1280", "1920x1080", "1080x1920"]

// WRONG
"supported_sizes": [{"width": 1280, "height": 720}, {"width": 720, "height": 1280}]
```

---

## Workflow: Modifying a Video Endpoint

### Step 1 — Survey existing video endpoints first

Before touching anything, look at live video endpoints to understand the established patterns for the model family and provider:

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  "https://openrouter.ai/api/v1/internal/buddy/endpoints" \
  | jq '[.data[] | select(
      (.supported_video_parameters != null) and
      (.supported_video_parameters | keys | length > 0) and
      .deleted == false
    ) | {id, model_permaslug, supported_video_parameters}]'
```

Find endpoints with the same provider or model family and use them as the reference for format and field conventions.

### Step 2 — Get the current state of the target endpoint

Always use the Buddy API as the source of truth:

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  "https://openrouter.ai/api/v1/internal/buddy/endpoints" \
  | jq '[.data[] | select(.model_permaslug | test("MODEL-NAME"; "i"))
    | {id, model_permaslug, provider_model_id, deleted, supported_video_parameters}]'
```

Read the full `supported_video_parameters` object carefully — the PATCH replaces the entire object, so you must preserve every field you're not explicitly changing.

### Step 3 — PATCH with the complete updated object

Buddy API mutation routes are preview-by-default: the PATCH below without `apply` returns `{ "applied": false, "preview": { "current", "proposed", "diff", ... } }` and writes nothing. Post the diff, confirm, then re-send with `"apply": true` to commit.

```bash
curl -s -X PATCH \
  "https://openrouter.ai/api/v1/internal/buddy/endpoint/ENDPOINT-ID" \
  -H "Authorization: Bearer $BUDDY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "apply": true,
    "supported_video_parameters": {
      "seed": true,
      "generate_audio": true,
      "supported_sizes": ["1280x720", "720x1280", "1920x1080", "1080x1920"],
      "supported_durations": [4, 6, 8],
      "supported_resolutions": null,
      "supported_aspect_ratios": null,
      "supported_frame_images": ["first_frame", "last_frame"]
    }
  }' | jq '{id: .data.id, supported_video_parameters: .data.supported_video_parameters}'
```

### Step 4 — Verify and post the Mission Control link

```bash
curl -s -H "Authorization: Bearer $BUDDY_API_KEY" \
  "https://openrouter.ai/api/v1/internal/buddy/endpoints" \
  | jq '.data[] | select(.id == "ENDPOINT-ID") | .supported_video_parameters'
```

Then post: `https://internal.openrouter.ai/endpoint/edit/{endpoint_id}`

### Step 5 — Pass the featured-example launch gate

Follow [`launch-examples.md`](launch-examples.md) for this step: it owns paid-request approval, public submit, polling, finalize, media review, and the curation decision.

Do not use provider-direct generation or internal Model Examples batch routes as launch-gate evidence.
