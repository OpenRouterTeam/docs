# Presidio E2E k6 baselines and thresholds

This doc records how Presidio e2e and baseline comparison tests are calibrated, and how to avoid latency/quality drift when changing guardrails or the Presidio pipeline.

## Scripts and keys

- **presidio-e2e-baseline.ts** — Same payloads, two keys: guardrail (redact or block) vs no guardrail. Measures Presidio overhead when both paths go through the router + LLM (use redact key for apples-to-apples).
- **presidio-e2e-guardrail.ts** — Guardrail-only load test (single key with Presidio guardrail).
- **presidio-load.ts** / **presidio-smoke.ts** — Hit Presidio analyzer/anonymizer directly (`PRESIDIO_URL`); not the full router.

Use three API keys for full coverage:

| Key role   | Env var (baseline script)     | Purpose                                      |
|-----------|--------------------------------|----------------------------------------------|
| None      | `OPENROUTER_BASELINE_API_KEY`  | No guardrail; baseline latency               |
| Redact    | `OPENROUTER_API_KEY` (or redact key) | Person + address redact; measure overhead   |
| Block     | (separate key)                 | Person + address block; 403 path             |

## Calibrated thresholds

4‑min run, 6 VUs, redact key vs no-guardrail key, production OpenRouter. Both paths returned 200 and went through the LLM. Thresholds loosened for model/network variance (observed p95 up to ~14–16s on slower runs).

| Metric                         | Observed (p95 or rate) | Threshold in script | Notes                    |
|--------------------------------|-------------------------|----------------------|--------------------------|
| Baseline duration (no guardrail) | 4.7s–14s                | p95 &lt; 18s         | Variance-tolerant        |
| Presidio duration (redact)     | 7.9s–16s                | p95 &lt; 20s         | Variance-tolerant        |
| Presidio small                 | 1.2s–1.5s               | p95 &lt; 3s          | presidio-e2e-guardrail.ts only |
| Presidio medium                | 2.9s–3.7s               | p95 &lt; 5s          | presidio-e2e-guardrail.ts only |
| Presidio large                 | 11s–16.6s               | p95 &lt; 20s         | presidio-e2e-guardrail.ts only |
| Redaction verified rate        | 82–84%                  | rate &gt; 0.70       | Aim to improve over time |

Redaction verified = for 200 responses, known PII strings are absent from the model reply. Presidio only redacts **input** (request messages); if the model echoes or hallucinates PII in its reply, we don't strip it yet, so some failures are expected. We improve the rate by (1) catching more PII in the input via **score_threshold** (default 0.4; lower = more sensitive) and (2) future: optional output-side redaction or UI-tunable threshold.

## How to run

From `tests/performance`:

```bash
# Redact vs none (measure Presidio overhead; both 200)
k6 run scenario/guardrails/presidio/presidio-e2e-baseline.ts \
  -e OPENROUTER_API_KEY=<redact-key> \
  -e OPENROUTER_BASELINE_API_KEY=<no-guardrail-key> \
  -e OPENROUTER_API_URL=https://openrouter.ai/api/v1

# Guardrail-only load (redact or block key)
k6 run scenario/guardrails/presidio/presidio-e2e-guardrail.ts \
  -e OPENROUTER_API_KEY=<guardrail-key> \
  -e OPENROUTER_API_URL=https://openrouter.ai/api/v1

# High VU count (override default)
k6 run scenario/guardrails/presidio/presidio-e2e-baseline.ts \
  -e OPENROUTER_API_KEY=<redact-key> \
  -e OPENROUTER_BASELINE_API_KEY=<no-guardrail-key> \
  -e OPENROUTER_API_URL=https://openrouter.ai/api/v1 \
  -e PRESIDIO_MAX_VUS=50
```

## Avoiding drift

When you **add or change Presidio guardrails, content filters, or the Presidio pipeline**:

1. Re-run the baseline comparison with the **redact** key vs **no guardrail** (full 4‑min run).
2. Check the reported p95 and redaction-verified rate. If they've moved up (latency) or down (quality), decide whether the change is acceptable.
3. If acceptable but numbers are consistently higher/lower, **update the thresholds** in:
   - `presidio-e2e-baseline.ts` (e2e_baseline_duration, e2e_presidio_duration, e2e_redaction_verified_rate)
   - `presidio-e2e-guardrail.ts` (presidio_e2e_duration, presidio_e2e_*_duration, presidio_e2e_redaction_verified_rate)
4. Update this doc with the new observed values and threshold rationale.

Do **not** loosen thresholds without re-running baselines and documenting the reason (e.g. new entity types, different model mix). This keeps Presidio from silently adding latency or regressing redaction quality.

---

## PR description (copy into PR)

**Presidio E2E baseline comparison and threshold calibration**

- **presidio-e2e-baseline.ts**: Compares latency with vs without Presidio guardrails (redact or block) using two API keys on identical payloads through the full router. Treats 403 (PII blocked) as success so block and redact guardrails are both testable.
- **presidio-e2e-guardrail.ts**: Guardrail-only load test; accepts 200 (redacted) or 403 (blocked). Custom metrics by payload size and redaction verification.
- **Thresholds** are calibrated from a redact-vs-none baseline run (see `tests/performance/scenario/guardrails/presidio/presidio-e2e-baselines.md`):
  - Baseline (no guardrail) p95 &lt; 18s, Presidio (redact) p95 &lt; 20s; per-size thresholds in presidio-e2e-guardrail.ts.
  - Redaction verified rate &gt; 70%; observed ~82%; we aim to improve redaction quality over time.
- **Avoiding drift**: When adding or changing Presidio guardrails or the pipeline, re-run the baseline (redact vs none), then update thresholds and `presidio-e2e-baselines.md` if needed. Do not loosen thresholds without re-baselining and documenting.
