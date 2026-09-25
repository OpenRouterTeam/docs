# Gemini Omni endpoint configuration (one slug, two APIs)

Gemini Omni serves chat completions and video generation from a single
model + endpoint. Chat runs through the Interactions chat adapter; the
video-generation route derives its adapter from the same endpoint at
request time via
`packages/video-generation/configs/get-adapter-name.ts`.

## Database setup

**Model** (one row, slug TBD):

- `input_modalities`: `text`, `image`, `video`. Audio input was probed
  against Google's API and is rejected upstream, so it is not staged.
- `output_modalities`: `text`, `video` (live probes disproved image and
  audio output). The `video` entry is what lists the model on the
  video-generation API; chat completions never expose video as a
  requestable response modality.

**Endpoints** (one per provider variant):

| Provider | `provider_info.adapterName` | Mapped video adapter |
| --- | --- | --- |
| Google AI Studio | `InternalStreamGoogleAIStudioInteractionsAdapter` | `GoogleAIStudioInteractionsVideoAdapter` |
| Google Vertex | `InternalStreamGoogleVertexInteractionsAdapter` | `GoogleVertexInteractionsVideoAdapter` |

Do not stage a second endpoint with the video adapter name — the
mapping handles it.

## Pricing

Set `pricingStrategy` to `gemini_omni` (via provider override or the
provider default). Its pricing JSON composes both SKU families
(`packages/pricing/strategies/gemini-omni/`):

- Gemini token keys (`gemini:prompt_tokens`,
  `gemini:completion_tokens`, cache/audio/image keys, ...) price the
  chat route.
- Veo per-second keys (`veo:duration_seconds_with_audio`,
  `veo:duration_seconds_without_audio`, and the 720p/4k variants)
  price the video route.

Mission Control's endpoint pricing editor is schema-driven, so the
`gemini_omni` strategy shows a single form containing both field sets.
