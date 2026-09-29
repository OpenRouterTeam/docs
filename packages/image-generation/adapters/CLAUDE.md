# Image Generation Adapters — Agent Guidelines

See the root [AGENTS.md](../../../AGENTS.md) for repo-wide rules.

## Adding a new adapter

Pick the base class that matches the provider's upstream shape, then
implement only the abstract hooks — the base owns the shared HTTP, error
tree, logging, and SKU plumbing. Do **not** hand-write a full `generate()`.

1. Create `adapters/<provider>/index.ts` exporting a class that extends
   one of:

   - [`BaseSyncImageGenerationAdapter`](./base/sync-image-adapter.ts) —
     one HTTP round-trip returns the image inline (Seedream, xAI, OpenAI,
     Recraft, Azure MAI, Gemini).
   - [`BaseAsyncImageJobAdapter`](./base/async-image-job-adapter.ts) —
     submit returns a job handle, poll on a bounded loop, then fetch the
     artifact (Black Forest Labs, Sourceful v1/v2/v2.5).

2. Register it in [`adapter-factory.ts`](./adapter-factory.ts) and add the
   member to `ImageGenerationAdapterName`
   (`packages/enums/adapters.ts`).

3. Add a co-located `index.test.ts` covering `buildUpstreamRequest` and the
   `generate` lifecycle (mock `globalThis.fetch`).

### Building the upstream body

Adapters **implement** `buildUpstreamRequestBody`; everything **calls**
`buildUpstreamRequest` on the base, which records the pixels the built body
asks for (`upstreamDimensions`) so the transaction log can attribute a
dimension regression. Never call your own `buildUpstreamRequestBody` — a
structural test in
[`base/upstream-dimension-capture.test.ts`](./base/upstream-dimension-capture.test.ts)
fails if you do.

### Sync adapter hooks (`BaseSyncImageGenerationAdapter`)

Implement: `location`, `providerLogName`, `buildUpstreamRequestBody`, `getUrl`,
`redactRequestForLog`, `parseUpstreamBody` (provider error-envelope +
success-schema parse + image/SKU extraction).

`getUrl(upstream)` receives the built upstream request. Adapters with an
image-to-image path use it to route between endpoints (e.g. generations vs
edits); adapters with a single endpoint ignore the parameter.

Override only when the provider needs it:

- `fetchUpstream(...)` — send multipart (image-to-image) instead of JSON.
- `handleNonOkResponse(...)` — surface a structured provider error body on
  4xx/5xx.

### Async adapter hooks (`BaseAsyncImageJobAdapter`)

Implement: `location`, `providerLogName`, `buildUpstreamRequestBody`, `getUrl`,
`redactSubmitRequestForLog`, `parseSubmitResponse` (extract the job handle),
`getPollUrl`, `classifyPollResponse` (provider status schema →
`pending` / `done(artifactUrl)` / terminal `errT`), `buildSuccessResult`.

`getUrl(upstream)` receives the built upstream request. Adapters with
separate t2i / i2i submit endpoints use it to dispatch; adapters with a
single submit URL ignore the parameter.

Override only when the provider needs it:

- `pollIntervalMs` / `maxPollDurationMs` — non-default timing (e.g.
  Sourceful V2.5 polls for 21 minutes).
- The `TPollMeta` generic — carry data read from the poll body (e.g. an
  upstream cost reported only on completion) through to
  `buildSuccessResult`.

## Use shared utilities

Before writing new helper logic, check whether it already exists:

- **[`base/sync-image-adapter.ts`](./base/sync-image-adapter.ts)** /
  **[`base/async-image-job-adapter.ts`](./base/async-image-job-adapter.ts)**
  — the template-method bases above. They own the upstream fetch, the
  network / non-2xx / invalid-JSON / parse error branches, latency timing,
  the success/error FS-logs, and `pushUsageSKUItems`.

- **[`resolve-artifact.ts`](./resolve-artifact.ts)** —
  `resolveArtifactToBase64` handles both data-URL (inline decode) and
  HTTP-URL (fetch + base64 encode) artifact resolution. The async base
  calls this for you after a job completes.

- **[`sourceful-common.ts`](./sourceful-common.ts)** — shared Sourceful
  utilities: size parsing, resolution validation, size-config conflict
  checks, SKU mapping, input image limits, and log redaction. Used by
  v1, v2, and v2.5.

- **`this.logContext`** (from `BaseImageGenerationAdapter`) — standard
  context object (`generation_id`, `endpoint_id`, `provider`,
  `provider_model_id`, `model_slug`, `data_region`) for structured logging.

- **[`input-references.ts`](./input-references.ts)** —
  `getInputReferenceUrls` validates and extracts image URLs from
  `input_references` with a configurable max count;
  `resolveImageReferenceData` / `createImageBlob` support multipart edits.

- **[`capabilities/validate-request.ts`](../capabilities/validate-request.ts)**
  — `validateImageRequestCapabilities({ request, location,
  supportedImageParameters })` validates a request against the endpoint's
  DB-driven capability schema (the `supported_image_parameters` JSONB
  column). When the column is NULL (not yet seeded), validation is skipped
  and the adapter's own checks apply. Maps a failure to a field-scoped
  400. Call it first in `buildUpstreamRequestBody`.

- **[`provider-options.ts`](./provider-options.ts)** —
  `applyProviderPassthroughOptions` on the base copies provider-specific
  passthrough fields onto the upstream body.

## Capability limits are DB-owned, not adapter-owned

Per-request limits — `input_references` count, resolution sets, `n` — are
**per-model** and enforced by `validateImageRequestCapabilities` reading the
endpoint's `supported_image_parameters` column. One adapter serves several
models with different caps (xAI's models differ; Seedream allows ≤14), so a
hardcoded `MAX_INPUT_IMAGES` in the adapter would reintroduce the exact
over-advertising bug this gate removes. An adapter's `normalizeInputImages`
therefore does **only** what the schema can't express (URL-scheme checks).
The NULL-column window before the backfill is intentional, not a regression:
`/api/v1/images` is not public until every endpoint is seeded.

## Honored vs conflict-checked vs ignored fields

A `supported_image_parameters` field relates to an adapter's
`buildUpstreamRequestBody` in exactly one of three ways. This is
imperative control flow, invisible in the schema, so a reviewer
(or Devin's stateless re-review) re-derives it from scratch on
every push and gets it wrong most of the time. State the bucket
explicitly — in the PR description or a comment at the read
site — instead of leaving it to be traced by hand:

- **Honored** — the field shapes the upstream request. Example:
  Seedream's `aspect_ratio` resolves to concrete pixels via the
  `seed` tier→pixel edge map in
  [`schemas/dimensions.ts`](../schemas/dimensions.ts) and is sent
  as `size` — see `buildUpstreamRequestBody` in
  [`seedream/index.ts`](./seedream/index.ts). A bare
  `aspect_ratio` (no `resolution`/`size`) is shaped against the
  provider's `PROVIDER_DIMENSIONS` default tier rather than
  falling back to a fixed square (ECO-1908); Black Forest Labs
  follows the same pattern with a 16px-snapped, 4MP-clamped
  profile (ECO-2325), and OpenAI maps the ratio to its nearest
  supported size in-adapter.
- **Conflict-checked only** — the field is read solely to reject
  contradictory input; it never changes the outgoing request.
  Example: Sourceful V1 passes `aspect_ratio` into
  `resolveImageOutputDimensions`, but the provider has no
  `PROVIDER_DIMENSIONS` profile, so it
  always resolves to `null` and the adapter falls through to
  its own size handling — see
  [`sourceful/index.ts`](./sourceful/index.ts). **Do not**
  advertise this field: the client would ask for `16:9` and
  silently get a square.
- **Ignored** — the field is never read by the adapter at all.
  If the DB row advertises it, that is a bug: either wire it into
  `buildUpstreamRequestBody` (making it honored) or drop it from
  `supported_image_parameters`.

Only **honored** fields belong in an endpoint's
`supported_image_parameters` row. When adding or reviewing an
adapter, classify every field it reads into one of the three
buckets before deciding whether the DB row should advertise it.

## Image-to-image must honor what text-to-image honors

An adapter with an edit path builds **two** bodies from the same public
request, and the second one is where advertised fields go missing. The
failure shape to check for: the generations body carries concrete
pixels, the edits body carries none, and a `16:9` edit comes back in
the input image's shape while the client is billed for a size it never
asked for. Per-adapter tests cannot see this, because each asserts only
the body it already builds.

- **Every honored field is honored on both paths, or the field is not
  honored at all.** If the edit route genuinely cannot express it,
  the field is a *provider limitation* — say so at the read site and
  keep it out of `supported_image_parameters`, rather than accepting
  it and dropping it.
- **The sizing knob differs per route**, so read the provider's edit
  docs instead of reusing the generations shape. Azure MAI takes
  `width`/`height` on generations but rejects them on edits with
  `unsupported_request_argument`; it accepts only `size` there.
  Recraft's `imageToImage` has no sizing parameter at all.
- **Send sizing on an edit only when the caller asked for a shape.**
  Providers default an edit to the input image's shape, not to a
  square, so resolving unconditionally reshapes edits that asked for
  nothing. "Asked for a shape" means explicit `WIDTHxHEIGHT` pixels or
  a ratio — a quality tier (`2K`, whether spelled as `resolution` or
  as `size`) is not a shape, and `auto` is the caller declining to
  choose.
- **Verify against the live provider before changing the request.**
  Whether an edit route honors a field is a fact about the provider,
  not about our code, so call the upstream edit endpoint directly. The
  answer may be "the provider ignores it", which is a documented
  provider limitation rather than a code change.

[`base/i2i-sizing-parity.test.ts`](./base/i2i-sizing-parity.test.ts)
enforces the first rule for every registered adapter. Each fixture
declares the sizing its generation sends and the sizing its edit
sends, both are asserted against the built bodies, and an edit that
declares no sizing while its generation declares some fails unless it
carries a documented provider limitation. A new adapter adds its
endpoint fixture there.

## What stays in the adapter

The bases own the shared transport/error/logging shell. Everything that is
genuinely provider-specific stays in the adapter's hooks:

- **Request shapes** (`buildUpstreamRequestBody`) — upstream field names,
  nesting, and types vary per provider.
- **Response/error schemas** — the Zod schemas and how the success body and
  error envelope are parsed (`parseUpstreamBody` / `parseSubmitResponse` /
  `classifyPollResponse`).
- **Billing / SKU logic** — cost models differ (per-image, per-token,
  upstream cost passthrough).
- **Poll-loop status handling** (`classifyPollResponse`) — status enums and
  terminal conditions are tightly coupled to each provider's API; only the
  loop mechanics (timeout, fetch, retry) are shared.

When two or more adapters share near-identical *provider-specific* code
(as the three Sourceful variants do), factor it into a `*-common.ts`
module rather than the base.

## Testing

Mock `globalThis.fetch` in tests. Use `try/finally` to restore the original
fetch after each test (this is the established pattern; `wrap()` doesn't
apply here since we need `finally` for cleanup, not error handling). For
async adapters, override the `pollIntervalMs` getter to `0` in a test
subclass so the poll loop doesn't wall-clock wait.
