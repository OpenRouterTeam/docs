# Live Image Generation Adapter Harness

Manual live coverage for `/api/v1/images`. This suite sends **real, paid**
provider requests, so it is intentionally not a CI test.

What it covers, why, and the full model × parameter plan live in
[`MATRIX.md`](./MATRIX.md) — the source of truth. This README is just how to run
it.

This directory holds two test files:

- **`e2e-matrix.test.ts`** — the live, paid sweep (run with the env below).
- **`adapter-coverage.test.ts`** — a free, static gate asserting every
  `ImageGenerationAdapterName` is mapped or exempted in `coverage.ts`, and every
  generated `allowed_passthrough_parameters` key has a matching live/manual case
  field. It issues no provider calls and is the only file here that runs in CI
  (via the `check-image-adapter-coverage` workflow).

## Run

```bash
cd tests/manual
RUN_LIVE_IMAGE_GENERATION_ADAPTERS=true \
OPENROUTER_API_BASE=http://localhost:8797 \
OPENROUTER_API_KEY=sk-or-v1-... \
bunx vitest run api/images/generations/e2e-matrix.test.ts
```

For production, set `TEST_ENV=prod` and point `OPENROUTER_API_BASE` at the
production base URL. For local runs, ensure the image API worker has the staged
models and endpoint config for the slugs you exercise.

## Filters

```bash
# One adapter (AdapterId from cases.ts)
IMAGE_GENERATION_ADAPTERS=openai

# By tag: t2i | i2i | error | provider-options | stream | determinism | boundary | variant
IMAGE_GENERATION_CASE_TAGS=stream

# One explicit case id
IMAGE_GENERATION_CASES=openai-t2i-all-fields

# Override the default inline PNG reference image with an HTTPS URL
IMAGE_GENERATION_REFERENCE_IMAGE_URL=https://example.com/reference.png

# Override the public font URL used by Sourceful font-input cases
IMAGE_GENERATION_FONT_URL=https://example.com/font.ttf

# Override a case's model
IMAGE_GENERATION_MODEL_BLACK_FOREST_LABS=black-forest-labs/flux.2-flex
```

## Billing verification

After each successful generation the suite polls `GET /api/v1/generation?id=` —
the Spanner-backed billing source of truth — until the record settles (billing
runs in a post-response `waitUntil`, so the endpoint 404s until it lands). A
record that never settles is a hard failure. Managed runs assert the settled
`total_cost` matches the response `usage.cost` within a rounding epsilon.

```bash
# Disable the billing poll (e.g. an env without settled billing)
IMAGE_GENERATION_VERIFY_BILLING=false

# Expect the BYOK path: every record must report is_byok=true (run against a
# BYOK-provisioned account). BYOK zeroes the response cost, so this asserts the
# record's presence + is_byok rather than cost parity.
IMAGE_GENERATION_EXPECT_BYOK=true

# Tune the poll (defaults: 120000ms timeout, 2000ms interval). Prod settlement
# latency is variable under load (observed past 60s), so the default is generous.
IMAGE_GENERATION_BILLING_POLL_TIMEOUT_MS=120000
IMAGE_GENERATION_BILLING_POLL_INTERVAL_MS=2000
```

## Artifacts

Every run writes a redacted, **gitignored** summary to
`.logs/summary-<ts>.ignore.json` (image byte lengths, file-signature hex, and the
`usage` block — never image or input base64).

To additionally write a **committable** record that the MATRIX run-history index
links, set:

```bash
IMAGE_GENERATION_RECORD_RUN=true   # writes runs/<date>-<env>.json (tracked)
IMAGE_GENERATION_RUN_HEAD=<sha>    # optional — attribute to a commit
IMAGE_GENERATION_RUN_DRIVER=<who>  # optional — "agent (Claude)" / a human
```

The `runs/<date>-<env>.json` record is a compact rollup (counts, per-adapter
cost, determinism pairs, per-case id/status/elapsed/cost/billing-settled) — never
base64. Omit `RECORD_RUN` for casual runs so they stay in `.logs`.
