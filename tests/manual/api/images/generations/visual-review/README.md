# Image Generation Visual Review

Project-style manual artifact capture and browser viewer for image-generation requests.

Use this when a reviewer needs to compare the OpenRouter request JSON with the returned image
artifact. It is not limited to passthrough checks; the same viewer supports text-to-image,
image-to-image, error and boundary cases, streaming cases, determinism pairs, and provider-option
passthroughs from the shared manual matrix.

## Capture

Start the local image API, then run the capture script from the repo root. The default command
captures the `provider-options` subset because it is the most useful passthrough review path and
avoids accidentally running every paid/manual case:

```bash
RUN_LIVE_IMAGE_GENERATION_ADAPTERS=true \
OPENROUTER_API_BASE=http://localhost:8797 \
OPENROUTER_API_KEY=sk-or-v1-unlimitedkey \
IMAGE_GENERATION_CASE_TAGS=provider-options \
IMAGE_GENERATION_VERIFY_BILLING=false \
bunx tsx --tsconfig tests/manual/tsconfig.json \
  tests/manual/api/images/generations/visual-review/capture.ts
```

Narrow it with the same filters as the matrix:

```bash
IMAGE_GENERATION_CASES=openai-5-4-t2i-parameter-passthrough,sourceful-v2-t2i-resolution-aspect
IMAGE_GENERATION_ADAPTERS=openai
IMAGE_GENERATION_CASE_TAGS=provider-options
```

Capture every case type with an explicit all-cases tag filter:

```bash
RUN_LIVE_IMAGE_GENERATION_ADAPTERS=true \
OPENROUTER_API_BASE=http://localhost:8797 \
OPENROUTER_API_KEY=sk-or-v1-unlimitedkey \
IMAGE_GENERATION_CASE_TAGS=all \
IMAGE_GENERATION_VERIFY_BILLING=false \
bunx tsx --tsconfig tests/manual/tsconfig.json \
  tests/manual/api/images/generations/visual-review/capture.ts
```

`IMAGE_GENERATION_CASE_TAGS=all` and `IMAGE_GENERATION_CASE_TAGS=*` both disable tag filtering.
All-case captures can be slow and expensive; they also include expected error cases. Streaming cases
write partial and completed image events as separate artifacts.

Artifacts are written under `artifacts/<timestamp>/` and are gitignored. The request JSON preserves
top-level image params and `provider.options`; `input_references` are redacted to counts/kinds so
base64 reference images are not duplicated.

## View

```bash
bunx tsx --tsconfig tests/manual/tsconfig.json \
  tests/manual/api/images/generations/visual-review/server.ts
```

Open `http://localhost:4747`.

## Caveats

The request pane shows the request sent to OpenRouter, not the upstream provider HTTP body. Use the
adapter unit tests for strict upstream mapping guarantees.

Visual output is a provider-behavior check, not a schema guarantee. For example, the 2026-06-22
Sourceful V2/V2.5 captures included `provider.options.sourceful.font_inputs` in the OpenRouter
request, but the rendered images did not visibly reflect the requested font text. Track that as a
provider/adapter follow-up separately from the passthrough regression.
