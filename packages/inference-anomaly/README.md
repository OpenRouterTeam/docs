# Inference Anomaly Detection Platform

Composable platform for detecting inference-provider anomalies: cases where an
endpoint serving a model behaves differently from a trusted reference — wrong
or stale weights, aggressive quantization, injected system prompts, or
chat-template drift.

## Key concepts

- **Probe** — one measurement of one pinned endpoint: generate greedy
  completions through OpenRouter with `provider.only` (fallbacks disabled),
  then score every generated token against a reference implementation.
- **Detector** — a strategy that turns a probe spec into an evidence-bearing
  `ProbeRun`. Detectors register in `src/registry.ts`; consumers (Mission
  Control, sweeps, agents) are detector-agnostic.
- **Assessment** — a peer-relative classification (`ok` / `warn` / `anomalous`
  / `inconclusive`) with a human/agent-readable explanation. A low score is a
  triage signal, never proof of misconduct: template and tokenization
  differences alone cost 1–5% match rate.

## v0 detector: logprob divergence-from-reference

Based on Adam Karvonen's Token-DiFR (arXiv:2511.20621,
[token-difr](https://github.com/adamkarvonen/token-difr)). At temperature 0,
inference is nearly deterministic, so each generated token can be checked
against the reference model's argmax using prompt logprobs (`echo: true` on an
OpenAI-compatible completions API — Nebius exposes this). Each token is a
data point: ~10k tokens gives a match-rate stable to ±0.1% between runs for
under $0.02, making per-endpoint sweeps economically feasible at high
frequency.

Flow (`src/run-probe.ts`):

1. `openrouter-client.ts` generates pinned greedy completions.
2. The conversation is rendered with the model's chat template
   (`@openrouter-monorepo/chat-templates`) and concatenated with the completion
   (reasoning traces re-wrapped in `<think>` tags, mirroring token-difr).
3. `reference-client.ts` fetches echoed prompt logprobs from the reference.
4. `score.ts` scores the completion span: exact-match rate, avg claimed-token
   probability, avg margin, and mismatch-position clustering
   (prefix-concentrated mismatches ⇒ likely template/system-prompt difference,
   not different weights).
5. `classify.ts` classifies relative to peer endpoints of the same model
   (preferred) or an absolute floor (fallback).

Runs persist as JSON artifacts in GCS (`src/store.ts`) under `anomaly/…` in
the benchmark-results bucket, so on-demand probes and automated sweeps share
one feed.

## Sweep detector: snapshot prefix match

Based on token-difr's snapshot verification
([docs](https://github.com/adamkarvonen/token-difr/blob/main/docs/snapshot_verification.md)).
A one-time snapshot (`src/build-snapshot.ts`) freezes greedy completions from
a trusted provider for a fixed prompt set; recurring checks
(`src/run-snapshot-probe.ts`) replay the same prompts against any provider at
temperature 0 and prefix-match the fresh outputs against the stored reference
(`src/prefix-match.ts`), counting matches only up to the first divergence.
No reference API, GPU, or logprob support is needed at check time, which
makes this the detector for cheap scheduled sweeps.

The headline metric is the survival rate
`P(unit matches | previous units matched) = matched / (matched + divergences)`.
Units are characters (the check side is tokenizer-free), so scores are only
comparable against baselines from the same snapshot — never against
logprob-detector token match rates. Coarser evidence than the logprob
detector (no probabilities, margins, or ranks; everything after the first
divergence is discarded): use it to detect change, then escalate anomalies to
the logprob-reference detector for diagnosis.

Snapshots persist in GCS (`src/snapshot-store.ts`) under `anomaly-snapshots/…`,
one current snapshot per model; rebuilding replaces it and resets baselines.

## Triage ladder (root-causing a low score)

Operational takeaways from token-difr's
[root-causing doc](https://github.com/adamkarvonen/token-difr/blob/main/docs/root_causing_model_differences.md):

1. **Repeat test first** (cheapest, no reference needed): send the same
   request ~4 times at temperature 0 and compare the outputs to each other.
   - Identical (or long-prefix-identical with occasional late flips) ⇒
     near-deterministic serving; normal floating-point/batching noise.
   - Distinct outputs diverging early/scattered ⇒ the provider is not
     decoding deterministically — an operational serving defect regardless of
     the exact mechanism (observed on SiliconFlow's DeepSeek V3.1 and
     GPT-OSS-20B endpoints: ~85% snapshot match vs ~95% peers, four distinct
     temp-0 outputs; deployment-specific, not model-specific).
   - Identical repeats that still differ from the reference ⇒ deterministic
     but different context or weights — escalate to debug echo and
     triangulation.
2. **Triangulate across providers and sibling model slugs**: a cross-provider
   / cross-slug prefix-match similarity matrix surfaces same-checkpoint
   clusters and mislabeled endpoints mechanically (observed: Novita's
   "DeepSeek V3.1" matched V3.2 serving behavior — a mislabeled checkpoint —
   while its raw prompt bytes were identical to other providers).
3. **Logprob-reference diagnosis**: per-token probabilities, margins, ranks,
   and mismatch positions to distinguish template drift from quantization
   from different weights.

Calibration: absolute offsets between providers (94% vs 97%) are normal —
chat templates, quantization, and backend setup create stable per-provider
offsets. What matters is drift against a provider's *own* history and peers;
per-provider scores are stable (±0.1%) at ~10k output tokens.

## When to use

- Operator investigation of a suspicious endpoint (Mission Control →
  Inference Anomaly).
- Scheduled sweeps across all endpoints of a model, alerting on
  peer-relative regressions.
- Feeding provider-quality surfaces (e.g. a future "verified inference"
  badge per Matthew's LessWrong report).

## Interpreting results

| Signature | Likely cause |
| --- | --- |
| Prefix-concentrated mismatches, consistent across prompts | Chat-template or system-prompt difference |
| Uniform 1–3% drop vs peers | Quantization difference (e.g. FP8 vs BF16) or re-encoding drift |
| Uniform 5–20% drop | Injected/modified system prompt |
| 20%+ drop | Possibly a different model — investigate immediately |

The reference is a trust anchor, not ground truth: a probe verifies "matches
the reference's serving of these weights", not canonical correctness.

## Future work

- TODO(anomaly-platform): `repeat_determinism` detector — N identical temp-0
  requests compared to each other (no reference or snapshot needed); the
  natural first escalation when snapshot scores drop, splitting "late-flip
  numerics noise" from "nondeterministic decoding" from
  "deterministic-but-wrong".
- TODO(anomaly-platform): cross-provider / cross-model-slug triangulation —
  an N×N prefix-match similarity matrix over providers and sibling slugs to
  surface same-checkpoint clusters and mislabeled endpoints (reuses the
  existing prefix-match scorer).
- TODO(anomaly-platform): additional detectors — MMD two-sample test (Model
  Equality Testing, arXiv:2410.20247; works at temperature > 0), mean
  cross-entropy under the reference, seed-synchronized Token-DiFR, activation
  fingerprints (Activation-DiFR / TOPLOC, arXiv:2501.16007).
- TODO(anomaly-platform): per-provider historical baselines alongside peer
  medians — provider-specific offsets are stable, so drift against a
  provider's own history is a better signal than absolute comparisons.
- TODO(anomaly-platform): cross-validate references against first-party APIs;
  per-model reference redundancy.
- TODO(anomaly-platform): Temporal workflow for scheduled sweeps writing to
  the shared store; per-endpoint time-series baselines and alerting.
- TODO(anomaly-platform): rotate/randomize probe prompts to resist providers
  special-casing known audit prompts.
- TODO(anomaly-platform): standardize a `token_ids` response field with
  providers to eliminate re-tokenization noise entirely.
- TODO(anomaly-platform): import offline-generated snapshots from a locally
  controlled vLLM reference (gold standard) instead of trusting a serving
  provider; expand the probe suite toward ~300 prompts x ~35 tokens for
  snapshot sweeps.
- TODO(anomaly-platform): Postgres-backed store once run volume justifies
  indexed queries.
- TODO(anomaly-platform): broaden the snapshot detector's model list beyond
  the logprob reference registry (catalog-driven or free-text with
  guardrails) — snapshots need no reference config, only vetted serving
  conventions for the model.

See `RESEARCH.md` for the prior-art survey backing these choices.
