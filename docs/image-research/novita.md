# Novita Ming Image research

Research for onboarding Novita's Ming Image models to the OpenRouter Images API. All live captures were taken 2026-09-22 against the production Novita key already used by the chat endpoints. Prompts, image payloads, trace IDs, and artifact URLs are redacted from the excerpts below.

## Models and endpoints

| OpenRouter slug | `provider_model_id` | Route | Protocol |
| --- | --- | --- | --- |
| `novita/ming-image-0.1-design` | `ming-image-0.1-design` | `POST https://api.novita.ai/openai/v1/images/generations` | OpenAI images, JSON |
| `novita/ming-image-0.1-design-layer` | `ming-image-0.1-design-layer` | `POST https://api.novita.ai/openai/v1/images/edits` | OpenAI images, `multipart/form-data` |

The two routes are mutually exclusive per model. Posting the layer model to `/images/generations` returns `400 unsupported request endpoint: /v1/images/generations`, and posting the design model to `/images/edits` returns the mirrored `400`. Both use the same host, the same `Authorization: Bearer <NOVITA_API_KEY>` scheme, and the same response envelope, which is why one adapter serves both. ([txt2img docs](https://docs.novita.ai/api-reference/model-apis-ming-image-txt2img), [layer docs](https://docs.novita.ai/api-reference/model-apis-ming-image-layer))

## Capability matrix

| Normalized field | Design (generations) | Layer (edits) | Adapter behavior |
| --- | --- | --- | --- |
| `prompt` | Required, `400` when empty | Required | Sent on both routes |
| `input_references` | Rejected by route | Required, repeated `image[]` parts | Routes the request to `/images/edits` |
| `output_format` | `png`, `jpeg`, `webp` honored | `png`, `jpeg`, `webp` honored | Advertised |
| `size` (pixels) | Honored as a resolution bucket | Honored as a resolution bucket | Sent on both routes, see Sizing |
| `aspect_ratio` | Rejected with 400 | Rejected with 400 | Not advertised, Novita has no such parameter |
| `resolution`, `size` (tier), `aspect_ratio: auto` | Dropped | Dropped | Not a shape, Novita serves one quality |
| `n` | Accepted, still returns one image | Not applicable | Capped at 1 in endpoint metadata |
| `seed` | Accepted, no observable effect proven | Not tested | Not advertised |
| `response_format: url` | Returns Alipay CDN URLs | Returns Alipay CDN URLs | Not used, the adapter always takes base64 and rejects a hosted entry |
| `quality`, `background`, `output_compression` | Undocumented | Undocumented | Not advertised |

## Sizing

`size` picks a resolution bucket rather than an exact pixel pair, and both routes honor it.

On the design model, `1024x1024` returned a 1024x1024 PNG and `2048x2048` returned a 2048x2048 PNG, while `1536x1024` returned 1248x832, holding the requested 3:2 ratio at a smaller bucket, and `512x512` returned 1024x1024, the floor. On the layer model, the same request returns 1024x1024 layers with no `size` and with `size: 1024x1024`, and 2048x2048 layers for both `size: 1536x1024` and `size: 2048x2048`, against a square reference. So the bucket comes from `size` and the ratio comes from the reference image. An earlier reading of those two 2048 results as "size ignored" was wrong: it compared them to each other rather than to the unsized default.

The adapter therefore sends `size` upstream on both routes and lets Novita snap it. `aspect_ratio` is a different matter: Novita's API has no parameter that carries a ratio, so a concrete ratio is rejected with a 400 rather than silently dropped. A quality tier (`2K`, spelled as `resolution` or as `size`) and `aspect_ratio: auto` are not shapes and are dropped, two tier spellings that contradict each other are a 400, and a `size` that is neither pixels, a tier, nor `auto` is a 400 because it cannot be sent.

## Request shapes

Text to image, JSON:

```json
{ "model": "ming-image-0.1-design", "prompt": "<redacted>", "size": "1024x1024", "output_format": "png" }
```

Layer decoupling, multipart form with one repeated file field per reference:

```text
model=ming-image-0.1-design-layer
prompt=<redacted>
image[]=<binary>
image[]=<binary>
```

The documented field name is `image[]`. A singular `image` field also succeeded in one capture, but the adapter uses the documented repeated form. The multipart request must not carry an explicit `Content-Type`, so the runtime supplies the boundary.

## Response shapes

Success, both routes:

```json
{
  "created": 1790080719,
  "data": [{ "b64_json": "<redacted>", "revised_prompt": "{\"canvas\": [1024, 1024], \"regions\": [{\"category\": \"Image\", \"bbox\": [240.1, 257.6, 789.7, 834.0]}]}" }],
  "output_format": "png",
  "size": null,
  "model": "Ming-Image-0.1-Design-Layer-StressTest",
  "usage": {
    "input_tokens": 4096,
    "input_tokens_details": { "image_tokens": 4096, "text_tokens": 0 },
    "output_tokens": 8192,
    "total_tokens": 12288
  }
}
```

Three quirks matter. `size` is always `null`, even when the request pinned one, so output dimensions can only be read from the image bytes. `model` echoes an internal serving identifier (`Ming-Image-0.1-Design-StressTest`), so it must never be used as OpenRouter model identity. On the layer route, `data[0].revised_prompt` carries a JSON layer map rather than a prompt; the adapter ignores it and returns one image per layer.

Novita has two distinct error envelopes. The OpenAI-shaped one comes from the model API:

```json
{ "error": { "message": "prompt parameter not empty trace_id: <redacted>", "type": "InvalidParameter", "param": null, "code": "InvalidParameter" } }
```

The gateway envelope comes from auth and routing failures ahead of the model:

```json
{ "code": 401, "reason": "FAILED_TO_AUTH", "message": "failed to authenticate API key", "metadata": {} }
```

The adapter parses both, and also treats an error envelope returned with a `200` as an upstream fault. A `200` whose `data` entries are not all inline base64, or that carries no image token counts, is also an upstream fault: dropping a hosted layer would silently lose output, and billing an unreported generation as zero tokens would silently lose revenue.

## Billing

Novita bills these models per token in both directions, not per image, and reports the counts in `usage`. Text tokens were zero in every capture.

| Capture | Input image tokens | Output image tokens |
| --- | --- | --- |
| Generation, no size | 0 | 16384 |
| Generation, `1024x1024` | 0 | 4096 |
| Generation, `2048x2048` | 0 | 16384 |
| Generation, `1536x1024` | 0 | 4056 |
| Layer edit, one 1024x1024 reference, two layers returned | 4096 | 8192 |
| Layer edit, larger reference | 16384 | 32768 |

Output cost therefore scales with both resolution and layer count, neither of which is a fixed per-request quantity, so a per-image strategy cannot express it. The SKUs are `novita_image:image_input_tokens` and `novita_image:image_output_tokens`, mirroring the Azure MAI image strategy, which is the existing token-based image precedent.

Both models launch at a rate of zero on their normal slugs, not `:free` variants, because Novita's promotion is temporary and a slug is a permanent address. Post-promotion rates are not yet known and must come from Novita before the pricing rows change.

## Adapter choice

`BaseSyncImageGenerationAdapter`. Both routes answer synchronously with inline base64 in a single round trip, with no job handle to poll. The base owns key resolution, the HTTP lifecycle, non-2xx and malformed-JSON handling, base64 decodability validation, and SKU pushing; the adapter supplies the request mapping, the route choice, redaction, and response parsing. Media type is left to the shared `resolveImageMediaType` path, which sniffs magic bytes, since Novita returns PNG, JPEG, or WebP depending on `output_format` and does not tag the payload.

## Endpoint fields

```json
{
  "output_formats": ["png", "jpeg", "webp"],
  "n": { "min": 1, "max": 1 },
  "input_references": { "min": 0, "max": 1 }
}
```

The layer endpoint sets `input_references` to a minimum of 1. The design endpoint keeps the minimum at 0 and, because its route rejects uploads, a maximum of 0.

## Open questions

- Post-promotion per-token rates. Owner: Sino, from the Novita partner contact. Blocks only the pricing row update, not launch.
- The full bucket list behind `size`, measured here only at 512, 1024, 1536x1024, and 2048. Owner: Novita support. Blocks advertising a concrete size enum on the endpoints.
- Rate limits and concurrency ceilings under sustained load. Not measured.

## Fixture inventory

The captured payloads are large (multi-megabyte base64), so the committed fixtures are the redacted structural equivalents embedded in the adapter tests at `packages/image-generation/adapters/novita/index.test.ts`: success envelopes for both routes, a two-layer edit response, both error envelopes, a non-2xx body, and an undecodable payload. Each mirrors a live capture's shape with a one-pixel PNG in place of the real image data.
