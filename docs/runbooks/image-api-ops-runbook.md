# Image API — Operations Runbook

The continuous improvement loop for the dedicated image generation API (`cfw-image-api`).
Covers how to observe production traffic, classify errors, patch them, and verify the fix.

---

## Architecture Overview

```
                ┌───────────────────────────┐
                │      /api/v1/images       │  ← dedicated endpoint (GA target)
                │       cfw-image-api       │
                │  (script_name: image-api) │
                └─────────┬─────────────────┘
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
   ┌────────────┐  ┌────────────┐  ┌─────────────┐
   │ Sync       │  │ Async Poll │  │ Sync+Stream │
   │ Adapters   │  │ Adapters   │  │ Adapter     │
   ├────────────┤  ├────────────┤  ├─────────────┤
   │ Seedream   │  │ BFL (Flux) │  │ OpenAI      │
   │ xAI        │  │ Sourceful  │  └─────────────┘
   │ Recraft    │  │  v1/v2/2.5 │
   │ Gemini (2) │  └────────────┘
   │ Azure MAI  │
   └────────────┘

```

### Adapter Inventory (11 total)

| Adapter | Provider | Type | Streaming | Base Class |
|---|---|---|---|---|
| `SeedreamImageGenerationAdapter` | ByteDance Seed | Sync | No | `BaseSyncImageGenerationAdapter` |
| `XaiImageGenerationAdapter` | xAI (Grok) | Sync | No | `BaseSyncImageGenerationAdapter` |
| `RecraftImageGenerationAdapter` | Recraft | Sync | No | `BaseSyncImageGenerationAdapter` |
| `BlackForestLabsImageGenerationAdapter` | BFL (Flux) | Async poll | No | `BaseAsyncImageJobAdapter` |
| `SourcefulImageGenerationAdapter` | Sourceful v1 | Async poll | No | `BaseAsyncImageJobAdapter` |
| `SourcefulV2ImageGenerationAdapter` | Sourceful v2 | Async poll | No | `BaseAsyncImageJobAdapter` |
| `SourcefulV25ImageGenerationAdapter` | Sourceful v2.5 | Async poll | No | `BaseAsyncImageJobAdapter` |
| `OpenAIImageGenerationAdapter` | OpenAI | Sync + Stream | Yes | `BaseSyncImageGenerationAdapter` |
| `GoogleAIStudioGeminiImageGenerationAdapter` | Google AI Studio | Sync | No | `BaseSyncImageGenerationAdapter` |
| `GoogleVertexGeminiImageGenerationAdapter` | Google Vertex | Sync | No | `BaseSyncImageGenerationAdapter` |
| `AzureMAIImageGenerationAdapter` | Azure MAI | Sync | No | `BaseSyncImageGenerationAdapter` |

### Observability Stack

| Layer | What | Where |
|---|---|---|
| **Datadog logs** | Structured `Transaction attempt` per generation | `service:api @script_name:image-api` |
| **FS-logs** | Per-generation debug artifacts (local dev only) | `services/dev-fs-logs/.logs/<gen-id>/` |
| **ClickHouse** | Billing / usage records | `analytics.fact_generations` where `generation_id LIKE 'gen-img-%'` |
| **Spanner** | Durable generation records | Image generation transactions |
| **DD Dashboards** | Image Generation (HCL), Image Generation API (JSON) | `dashboard.tf`, `image_generation_api.tf` |
| **DD Monitors** | Error surge, billing, p95 latency, OOM | `configs/terraform-monitors/monitoring/image_generation/main.tf` |

---

## The Loop: Observe → Identify → Patch → Test

```
  ┌──────────────┐
  │  1. OBSERVE   │  Query DD + Enterpret for failures and feedback
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │  2. IDENTIFY  │  Classify each error into a bucket (A–F)
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │  3. PATCH     │  Fix per the bucket's protocol
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │  4. TEST      │  Run e2e matrix + verify DD improvement
  └──────┬───────┘
         │
         └──────────► back to 1
```

### Step 1: OBSERVE

Pull data from three sources. DD is real-time; Enterpret and ClickHouse are weekly cadence.

#### Datadog Queries

All queries use the base prefix: `service:api @script_name:image-api "Transaction attempt"`

| Signal | Additional Filter | What It Catches |
|---|---|---|
| All failures | `@extra.success:false` | Every failed generation |
| Failures by provider | `@extra.success:false` + group by `@extra.provider_name` | Provider-specific outages |
| Failures by model | `@extra.success:false` + group by `@extra.model` | Model-specific issues |
| Failures by HTTP status | `@extra.success:false` + group by `@extra.endpoint_status` | Error classification bugs |
| Failures by error message | `@extra.success:false` + group by `@extra.endpoint_error.message` | Unique error signatures |
| OOM events | `@outcome:exceededMemory` (no "Transaction attempt") | Worker memory limit exceeded |
| Billing warnings | `"Failed to get pricing strategy" OR "SKU-based usage calculation failed"` | Billing pipeline breaks |
| High latency (successful) | `@extra.success:true @extra.upstream_latency:>30000` | Degraded UX |
| Streaming cancellations | `@extra.is_streaming:true @extra.cancelled:true` | Client disconnects mid-stream |
| Poll-loop outliers | `@extra.poll_count:>20` | Async adapters stuck polling |

#### Enterpret (customer feedback)

```cypher
MATCH (nli:NaturalLanguageInteraction)-[:SUMMARIZED_BY]->(fi:FeedbackInsight)
WHERE fi.content CONTAINS 'image generation'
   OR fi.content CONTAINS 'image api'
   OR fi.content CONTAINS '/api/v1/images'
RETURN nli.source, fi.content, nli.record_timestamp
ORDER BY nli.record_timestamp DESC LIMIT 20
```

#### ClickHouse (billing verification)

Verify successful generations are billed correctly:

```sql
SELECT
  model,
  provider_name,
  count() AS total,
  countIf(cost > 0) AS billed,
  countIf(cost = 0) AS unbilled
FROM analytics.fact_generations
WHERE generation_id LIKE 'gen-img-%'
  AND toDate(created_at) >= today() - 7
GROUP BY model, provider_name
ORDER BY total DESC
```

### Step 2: IDENTIFY — Error Classification Buckets

Every error from Step 1 gets classified into one of these buckets.
The bucket determines the fix strategy.

| Bucket | Description | Example |
|---|---|---|
| **A. Upstream Provider Error** | Provider returned a legitimate error (content filter, rate limit, overloaded) | Recraft content filter → should be 400, not 502 |
| **B. Adapter Bug** | Our adapter mishandles a valid provider response | Parse failure, wrong SKU, missing field |
| **C. Capability Gap** | User requests a parameter combination we don't support yet | GPT-image quality/size params |
| **D. Infrastructure** | OOM, timeout, KV cache miss | Large base64 payloads exceeding worker memory |
| **E. Documentation** | User confusion from missing/wrong docs | "Image gen not supported" for openwebUI users |
| **F. Billing** | Charged for failed gen, pricing mismatch | "Charged but no image produced" |

### Step 2b: FILE — Create Linear Issues

Every new error pattern identified in Step 2 gets a Linear issue before any fix work starts.
This keeps Linear as the single source of truth for what needs doing.

**Filing checklist:**

1. **Project:** Image Generation API
2. **Milestone:** Phase 8: Follow-up / Advanced Features (post-launch)
3. **Team:** Ecosystem
4. **Label:** `loop` (distinguishes issues found by this cycle from other project work)
5. **Priority:** Map from bucket severity:
   - Bucket A (provider error misclassified) or F (billing) → Urgent
   - Bucket B (adapter bug) or C (capability gap) → High
   - Bucket D (infrastructure) or E (docs) → Medium
6. **Description must include:**
   - The bucket classification (A–F) and why
   - DD query or Enterpret citation that surfaced the issue
   - Affected adapter(s) / model(s)
   - Relevant file paths
   - Acceptance criteria

**Before creating:** search existing `loop`-labeled issues in the project to avoid duplicates. If a recurring pattern already has a ticket, add a comment with the new occurrence data instead of filing a new issue.

### Step 3: PATCH — Fix Protocols per Bucket

#### Bucket A: Upstream Provider Error

1. Map the provider's error to the correct HTTP status in `handleNonOkResponse` (4xx for content policy, rate limits; 502 only for genuine upstream failures)
2. Parse the provider's error body and surface the message in `errT`
3. Verify `logImageGenerationTxAttempt` classifies `outcome_bucket` correctly
4. Verify the DD dashboard "Failed by HTTP Status" widget reflects the change

#### Bucket B: Adapter Bug

1. Reproduce with a unit test mocking `globalThis.fetch` (per adapter AGENTS.md)
2. Fix the adapter hook (`parseUpstreamBody`, `classifyPollResponse`, etc.)
3. Add the unit test as a regression guard
4. If user-visible: add an e2e test in `tests/e2e/api/images/`

#### Bucket C: Capability Gap

1. Check `supported_image_parameters` in the endpoint's DB row
2. If the parameter should be supported: update `buildUpstreamRequest`
3. If unsupported: ensure `validateImageRequestCapabilities` returns a clear 400
4. Update docs if newly supported

#### Bucket D: Infrastructure

1. Check `response_payload_bytes` on the DD dashboard for OOM correlation
2. For OOM: evaluate response size limits or GCP offloading
3. For timeouts: check `upstream_latency` trends, tune poll timeouts for async adapters

#### Bucket E: Documentation

1. Fix docs at `projects/docs` (`projects/docs/openapi/openapi.yaml` is generated — don't edit directly)
2. Add quickstart examples for the failing scenario
3. Cross-reference with OpenAPI generation (`bun run generate:openapi`)

#### Bucket F: Billing

1. Check `image-generation/billing-result` FS-logs for the generation
2. Verify SKU pipeline: adapter `pushUsageSKUItems` → `computeImageGenerationUsage` → `initImageGenerationTx`
3. If the adapter didn't push SKU items: fix the adapter's `parseUpstreamBody` / `buildSuccessResult`
4. Add billing assertion to e2e golden-path test

### Step 4: TEST — Verification

#### E2E test suites

| Suite | Command | What It Validates |
|---|---|---|
| Image API golden path | `cd tests/e2e && bun run test:e2e api/images/index.test.ts` | Happy path: shape, billing, gen-id |
| Image API errors | `cd tests/e2e && bun run test:e2e api/images/errors.test.ts` | Auth, validation, model resolution |
| Responses image gen | `cd tests/e2e && bun run test:e2e api/responses/image-generation/` | Responses API skin (basic + streaming) |
| Adapter unit tests | `bun test packages/image-generation/adapters/` | All adapter unit tests |
| Billing unit tests | `bun test services/cfw-image-api/src/utils/` | Billing, finalize, tx-attempt |

#### DD verification post-deploy

- Success rate widget should trend upward
- "Failed by HTTP Status" — 502s decrease if error classification was fixed
- "Billing / Pricing Warnings" — should be zero if billing pipeline was fixed
- "Response Payload Bytes" — should stay below 50MB warning threshold

---

## Automation Roadmap

The loop starts manual. The goal is a daily scheduled Devin session:

```
Trigger: every 24h at 06:00 UTC

1. OBSERVE — query DD for failures in the last 24h, aggregate by bucket
2. IDENTIFY — produce a triage report (new patterns vs recurring)
3. REPORT — post summary to Slack; create Linear issues for new bugs
4. PATCH — auto-PR error classification fixes (Bucket A); flag others for review
5. TEST — run e2e matrix, post results alongside the triage report
```

### Success Metrics

| Metric | Target | How Measured |
|---|---|---|
| Image API success rate | >99% | DD dashboard "Success Rate" widget |
| Mean time to detect (MTTD) | <1h | DD monitor → Slack alert latency |
| Mean time to fix (MTTF) | <24h for Bucket A/E | Alert → merged PR |
| E2E model coverage | 4+ models (1 per adapter type) | `describe.each` count in `tests/e2e/api/images/` |
| Customer complaints (image) | <1/week | Enterpret weekly query |

---

## File Reference Map

| Purpose | Path |
|---|---|
| Image API worker entry | `services/cfw-image-api/src/index.ts` |
| Generations route handler | `services/cfw-image-api/src/routes/images/generations.ts` |
| Models route | `services/cfw-image-api/src/routes/models/` |
| Adapter factory | `packages/image-generation/adapters/adapter-factory.ts` |
| Base adapter (abstract) | `packages/image-generation/adapters/base/index.ts` |
| Sync adapter base | `packages/image-generation/adapters/base/sync-image-adapter.ts` |
| Async poll adapter base | `packages/image-generation/adapters/base/async-image-job-adapter.ts` |
| Capability validation | `packages/image-generation/capabilities/validate-request.ts` |
| Request schema | `packages/image-generation/schemas/request.ts` |
| Response schema | `packages/image-generation/schemas/response.ts` |
| Routing steps | `packages/image-generation/routing/steps.ts` |
| Billing | `services/cfw-image-api/src/utils/image-generation-billing.ts` |
| Finalize billing | `services/cfw-image-api/src/utils/image-generation-finalize.ts` |
| TX attempt log | `services/cfw-image-api/src/utils/image-generation-log-tx-attempt.ts` |
| E2E tests (dedicated) | `tests/e2e/api/images/` |
| E2E tests (Responses) | `tests/e2e/api/responses/image-generation/` |
| DD dashboards TF | `configs/terraform-monitors/monitoring/image_generation/` (dashboard.tf, image_generation_api.tf) |
| DD monitors TF | `configs/terraform-monitors/monitoring/image_generation/main.tf` |
| Adapter guidelines | `packages/image-generation/adapters/AGENTS.md` |
