# DeepInfra rerank research

Captured live against DeepInfra on 2026-08-25 with the shared `DEEPINFRA_API_KEY`
(`/_providers` in Infisical) for `Qwen/Qwen3-Reranker-8B`, `Qwen/Qwen3-Reranker-4B`, and
`Qwen/Qwen3-Reranker-0.6B`.

## Endpoint and auth

- URL: `POST https://api.deepinfra.com/v1/inference/<provider_model_id>`, e.g.
  `https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-8B`.
  This is not the provider's `baseUrl` in `providers_rows` (`https://api.deepinfra.com/v1/openai`,
  the OpenAI-compatible surface); the inference surface is the same origin without the `/openai`
  suffix.
- Auth: `Authorization: bearer <token>` (`Bearer` also accepted). No org/region headers; DeepInfra
  is a single US region for these models, matching the existing provider row.
- BYOK works through the standard provider key path — nothing model-specific.

## Request surface

```json
{ "queries": ["<query>"], "documents": ["doc a", "doc b", "doc c"] }
```

- `queries` and `documents` are parallel arrays and the API rejects a length mismatch
  (`422`, `"The number of queries (3) and documents (2) must be the same."`), **except** that a
  single-element `queries` is broadcast across all documents. Broadcasting is cheaper: the same
  1-query/3-document payload billed 248 input tokens broadcast vs 257 tokens with the query
  repeated three times.
- Max 1024 documents (a 1-query/1025-document request fails with
  `"List should have at most 1024 items after validation, not 1025"` on the broadcast `queries`).
- Documents must be **plain strings**. The generic DeepInfra schema also accepts
  `{"content": [...]}` parts, but Qwen3 rerankers reject them:
  - `{"content":[{"type":"text",...}]}` → `400 "MultiModalParam is not supported for
    Qwen3ForSequenceClassification"`.
  - `{"content":[{"type":"image_url",...}]}` → `405 "Model Qwen/Qwen3-Reranker-0.6B does not accept
    image input"`.
  So these endpoints are text-only: image-only documents must be rejected before the upstream call
  (`getTextOnlyDocuments`).
- `top_n` is **not supported**: the field is silently accepted and ignored (all scores are still
  returned), so OpenRouter must sort and slice locally.
- `instruction` is accepted and ignored-or-applied silently (no error, no visible response change on
  the probe). Our public rerank schema has no `instruction` field, so nothing is forwarded.
- Other advertised fields (`service_tier`, `fail_fast`, `webhook`) have no representation in the
  OpenRouter rerank request schema and are not forwarded.
- No streaming.

## Response surface

```json
{
  "request_id": "RY8V7dEbDksNVpHX4vmoh7ea",
  "inference_status": { "runtime_ms": 81, "cost": 1.285e-05, "tokens_input": 257 },
  "scores": [0.9772435426712036, 0.00010315640247426927, 0.012000242248177528],
  "input_tokens": 257
}
```

- `scores` is parallel to the input `documents`, **in input order** — the provider does not rank.
  The adapter builds `{index, relevance_score, document}` from the array position, sorts by score
  descending, then slices to `top_n`.
- Scores are sigmoid probabilities in `[0, 1]`; no normalization needed.
- `input_tokens` is the billable token count → OpenRouter `usage.total_tokens`.
- `request_id` is in the body only (no `request-id` response header), so the base class's header
  sniffing finds nothing; we do not surface it.

## Errors

| Case | Status | Body |
| --- | --- | --- |
| image/structured document | 400 / 405 | `{"detail":"MultiModalParam is not supported ..."}` |
| empty documents / length mismatch / missing `queries` | 422 | `{"detail":[{"type":"value_error",...}]}` |
| unknown model | 404 | `{"detail":{"error":"Model is not available"}}` |
| bad key | 401 | `{"detail":"User is not authorized to access this resource"}` |

DeepInfra's error body uses `detail` (string, object, or Pydantic array), never the
`{error:{message}}` shape the base class recognizes, so non-2xx is handled by the base class's
`!response.ok` branch and never reaches `transformResponse`.

## Pricing and usage reconciliation

Per-input-token pricing, confirmed against `inference_status.cost` on the live captures
(257 tokens):

| Model | Provider model ID | List price | Observed cost | Per-token |
| --- | --- | --- | --- | --- |
| Qwen3 Reranker 8B | `Qwen/Qwen3-Reranker-8B` | $0.05 / 1M | 1.285e-05 | 0.00000005 |
| Qwen3 Reranker 4B | `Qwen/Qwen3-Reranker-4B` | $0.025 / 1M | 6.425e-06 | 0.000000025 |
| Qwen3 Reranker 0.6B | `Qwen/Qwen3-Reranker-0.6B` | $0.01 / 1M | 2.57e-06 | 0.00000001 |

Endpoint config: `provider_overrides = {"adapterName":"DeepInfraRerankAdapter","pricingStrategy":"rerank"}`,
`pricing_json = {"rerank:input-tokens":"<per-token above>"}`, `quantization` unknown,
context length 32768 (40960 for 8B per the existing model row), `input_modalities {text}`,
`output_modalities {rerank}`.

## Adapter choice

`BaseRerankAdapter` with an overridden `getEndpointUrl()` (provider-specific inference path) and a
local sort/slice. Not the Fireworks/Cohere `/rerank` shape: DeepInfra takes parallel
`queries`/`documents` arrays and returns bare scores.

## Open questions

- `instruction` could be exposed once the public rerank schema grows an instruction field (Voyage
  supports it too); out of scope here.
- Whether `service_tier: "flex"` pricing differs is undocumented; not used.
