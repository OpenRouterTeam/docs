# Lakera E2E k6 baselines and thresholds

This doc records how Lakera e2e and baseline comparison tests are calibrated, and how to avoid latency/quality drift when changing guardrails or the Lakera pipeline.

## Internal admin requirement

Lakera injection protection is gated behind `is_internal_admin === true` in the `LakeraPreflightPlugin`. All API keys used for testing **must** belong to internal admin users, otherwise the guardrail is silently skipped and all requests will return 200 regardless of payload content.

## Scripts and keys

- **lakera-e2e-comparison.ts** — Same payloads, two keys: Lakera guardrail (block) vs no guardrail. Measures Lakera overhead when both paths go through the router + LLM.
- **lakera-e2e-guardrail.ts** — Guardrail-only load test (single key with Lakera guardrail).

Use two API keys for full coverage:

| Key role   | Env var (comparison script)     | Purpose                                        |
|-----------|----------------------------------|------------------------------------------------|
| None      | `OPENROUTER_BASELINE_API_KEY`    | No guardrail; baseline latency                 |
| Block     | `OPENROUTER_API_KEY`             | Lakera injection protection = block; 403 path  |

Both keys must belong to internal admin users.

## Calibrated thresholds

**Thresholds are currently set to match the Model Armor tests as a starting point.** Run the baseline comparison test against production and update these values with observed numbers.

| Metric                                       | Threshold in script  | Notes                              |
|----------------------------------------------|----------------------|------------------------------------|
| Baseline duration (no guardrail)             | p95 < 18s            | Match Model Armor baseline         |
| Lakera duration (with guardrail)             | p95 < 22s            | Lakera API adds ~1 network hop     |
| Lakera injection duration                    | p95 < 5s             | Blocked requests skip LLM          |
| Lakera large context duration                | p95 < 45s            | 32k+ token payloads                |
| Lakera fabricated history long duration      | p95 < 30s            | 15-20 turn conversations           |
| Lakera embedded injection duration           | p95 < 30s            | Injections in long documents       |
| HTTP success rate                            | rate > 0.85          | 200 or 403 (blocked)               |

## How to run

From `tests/performance`:

```bash
# Guardrail-only load test (default 5 VUs, ~4 min)
k6 run scenario/guardrails/lakera/lakera-e2e-guardrail.ts \
  -e OPENROUTER_API_KEY=<lakera-guardrail-key> \
  -e OPENROUTER_API_URL=https://openrouter.ai/api/v1

# Baseline comparison (default 5 VUs, ~4 min)
k6 run scenario/guardrails/lakera/lakera-e2e-comparison.ts \
  -e OPENROUTER_API_KEY=<lakera-guardrail-key> \
  -e OPENROUTER_BASELINE_API_KEY=<no-guardrail-key> \
  -e OPENROUTER_API_URL=https://openrouter.ai/api/v1

# High VU count (override default)
k6 run scenario/guardrails/lakera/lakera-e2e-guardrail.ts \
  -e OPENROUTER_API_KEY=<lakera-guardrail-key> \
  -e OPENROUTER_API_URL=https://openrouter.ai/api/v1 \
  -e LAKERA_MAX_VUS=50
```

## Avoiding drift

When you **add or change Lakera guardrails or the Lakera pipeline**:

1. Re-run the baseline comparison (full 4-min run).
2. Check the reported p95 and injection blocked rate. If they've moved up (latency) or down (detection), decide whether the change is acceptable.
3. If acceptable but numbers are consistently higher/lower, **update the thresholds** in:
   - `lakera-e2e-comparison.ts` (e2e_lakera_baseline_duration, e2e_lakera_duration)
   - `lakera-e2e-guardrail.ts` (e2e_lakera_duration, e2e_lakera_*_duration)
4. Update this doc with the new observed values and threshold rationale.

Do **not** loosen thresholds without re-running baselines and documenting the reason.
