# Inference Anomaly Detection: Prior-Art Survey

Survey backing the v0 detector choice. Separated into observed evidence,
inferred implications, and unresolved limitations.

## Motivation

"Not Pinning Your OpenRouter Provider Might Invalidate Your Research"
(LessWrong, 2026) showed the same model slug can behave very differently
across providers — differing quantization, backends, parameter handling,
hidden system prompts, chat templates, and possibly weights — and that
unpinned routing makes results non-reproducible. The author's asks: verified
("gold star") providers backed by continuous logprob checks, provider
transparency about setups/changes, and quality data surfaced in model tables.

## Methods surveyed

### 1. Token divergence-from-reference (Token-DiFR) — chosen for v0

Karvonen et al., "DiFR: Inference Verification Despite Nondeterminism"
(arXiv:2511.20621); demo repo `adamkarvonen/token-difr`.

Observed evidence (from the paper/blog and repo README):

- Greedy (temperature-0) inference is nearly deterministic; fixed-seed
  regeneration produced >98% exact token agreement in studied settings.
- Token-level checks are sample-efficient: ~10,000 output tokens detect
  KV-cache quantization; ~1,000 detect 4-bit quantization; ~100 detect a
  wrong sampling seed.
- Match rates are stable to ~±0.1% between runs at ~10–20k tokens; a full
  audit costs cents.
- The API-only variant needs only a reference exposing prompt logprobs
  (`echo: true`) — Fireworks and Tinker do.
- Known false-positive sources: different system prompt (5–20% drop),
  chat-template/tokenization format (1–5%), FP8-vs-BF16 (1–3%),
  re-encoding drift (1–3%). Genuinely different models typically drop 20%+.
- An outdated chat template at a well-known provider produced high divergence
  despite honest inference — diagnosis matters.

Why chosen: cheapest per bit of evidence, statistically tight, runs against
any prompt (not just benchmarks), and needs no provider cooperation beyond an
OpenAI-compatible API. Fits OpenRouter structurally: we already pin endpoints
and have uniform generation access to every provider.

### 2. Model Equality Testing (MMD two-sample tests)

Gao et al. (arXiv:2410.20247). Formalizes "which model is this API serving?"
as a two-sample test: compare output-string distributions from the API vs a
reference using Maximum Mean Discrepancy.

- Works at temperature > 0 and without logprobs — complements Token-DiFR.
- Needs many samples per prompt; less sample-efficient than token-level
  logprob evidence but harder for a provider to game.
- Candidate second detector (TODO in `src/types.ts`).

### 3. Cross-entropy scoring

DiFR paper baseline: mean cross-entropy of provider outputs under the
reference. Cheap and works without argmax comparison, but a provider could
tamper outputs while keeping cross-entropy plausible; weaker evidence.

### 4. Activation fingerprints (Activation-DiFR, TOPLOC)

TOPLOC (arXiv:2501.16007) commits to locality-sensitive hashes of
intermediate activations; Activation-DiFR compares activation fingerprints.
Highest fidelity — detects modified models, prompts, and precision — but
requires provider cooperation to emit commitments. Long-term candidate for a
"gold star" program; not v0.

### 5. Benchmark-based monitoring

Our existing Auto Exacto harness (GPQA Diamond, Tau2-Bench Airline).
Measures task quality directly but is expensive, high-variance (±5–10%/run),
and only covers benchmark distributions. Anomaly probes are complementary:
cheap continuous integrity checks between benchmark runs.

### 6. Repeat determinism and triangulation (root-causing playbook)

token-difr's `docs/root_causing_model_differences.md` documents the cheapest
discriminating experiments once a low score is observed, validated on two real
findings from DeepSeek V3.1 sweeps:

- **Repeat test**: ~4 identical temperature-0 requests, compared to each
  other (no reference needed). Three regimes: (a) identical or
  long-prefix-identical with occasional late flips ⇒ near-deterministic,
  normal numerics noise; (b) distinct outputs with early/scattered
  divergences ⇒ nondeterministic decoding, an operational provider defect
  even when the external mechanism (sampler defect vs nondeterministic
  logits) can't be distinguished; (c) identical repeats that differ from the
  reference ⇒ deterministic but different context/weights.
- **Case: SiliconFlow DeepSeek V3.1** — ~85% snapshot match vs ~95% peers;
  four temp-0 repeats returned distinct outputs. Same behavior on its
  GPT-OSS-20B endpoint but not GLM-5.2 ⇒ a deployment/serving-stack property,
  not a single model. Exact mechanism unresolved externally.
- **Case: Novita DeepSeek V3.1** — deterministic repeats but low reference
  match; debug echo showed identical raw prompt bytes to other providers;
  triangulation against sibling slugs showed its behavior matched DeepSeek
  V3.2 ⇒ mislabeled checkpoint.
- **Triangulation**: a cross-provider / cross-slug prefix-match similarity
  matrix (N×N runs of the existing scorer) surfaces same-checkpoint clusters
  and mislabeled endpoints mechanically.
- **Calibration**: per-provider offsets (94% vs 97%) are normal and stable —
  template, quantization, and backend differences. Baselines should include
  each provider's own history, not only peer medians.

Both are queued as TODOs (`repeat_determinism` detector; triangulation sweep)
in `README.md` and `src/types.ts`.

## Design conclusions for v0

1. Temperature-0 logprob divergence-from-reference is the single method with
   the best merit/simplicity ratio (chosen).
2. Classification must be peer-relative (same model, sibling endpoints), not
   absolute — absolute match rates vary by model/tokenizer.
3. Mismatch-position clustering must be retained as evidence: prefix-heavy
   mismatch patterns indicate template/system-prompt issues, uniform patterns
   indicate quantization/weight differences.
4. A low score must be surfaced as "anomalous — investigate", never as a
   quality verdict.

## Unresolved limitations

- Reference trust: verifies similarity to the reference, not canonical
  correctness; the reference itself can be wrong or change. Mitigation
  (future): cross-validate against first-party APIs.
- Open-weight only: needs a reference serving the same weights; closed models
  can't be audited this way.
- Greedy-only in v0: sampling verification needs seed synchronization, which
  providers don't standardize.
- Prompt-set gaming: a provider could special-case known audit prompts;
  rotation/randomization is future work.
- Text-based scoring (no token IDs from providers) re-introduces mild
  re-tokenization noise; standardizing a `token_ids` response field would
  remove it.
