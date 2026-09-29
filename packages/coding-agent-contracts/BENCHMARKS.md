# Benchmarks — coding-agent-contracts cross-format matrix

Measured 2026-08-14 on the `agent/coding-contracts` worktree (macOS arm64, Bun 1.3.14),
after the cross-format implementation (11 corpus cases: 5 parity `arbiter-exact-capture` +
6 xformat `derived-blessed`, 277 tests).

Harness: `scripts/bench-replay.ts` (per-case `replayCase`, `verifyCorpus`, normalized
determinism digests, memory). 5 iterations per measurement unless noted.

## Headline

| Metric | Before (188 tests, 5 parity cases) | After (248 tests, 11 cases) |
|---|---|---|
| Full test suite wall time | 23.4s | **3.0s** (8× faster despite 1.6× more cases/tests) |
| `verifyCorpus({replay:true})` | 12.7s | **0.46s** (27×) |
| Responses-wire case replay | ~4,120ms | **~35–55ms** (~100×) |
| CI budget usage (15 min) | 2.6% | **0.34%** |

The speedup came from benchmarking itself: the mock user context was `created_at: now`,
which fired the production new-account slow Redis rate limiter for `gpt-5.6-sol` on every
responses-wire turn, burning the 1s offline Redis timeout per turn (12 turns ≈ 12s).
Replay now uses an established-account context (rate limiting is not wire behavior under
test). Digests before/after are identical — wire behavior unchanged.

## Test suite (5 runs)

| Run | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Wall (s) | 3.25 | 3.18 | 2.98 | 2.99 | 3.01 |

277 pass / 0 fail, 16 files. Peak RSS: 856 MB (`/usr/bin/time -l`).
In-process after full corpus replay: heapUsed ~160–190 MB.

## Per-case replay (ms, 5 iterations, sequential — process-global mock seams)

| Case | Turns | Min | Mean | Max |
|---|---|---|---|---|
| claude-code-anthropic-file-edit-v1 | 4 | 23.2 | 113.5* | 464.5* |
| codex-openai-file-edit-v1 | 4 | 43.2 | 54.5 | 77.8 |
| deepseek-harness-deepseek-file-edit-v1 | 4 | 45.8 | 53.2 | 65.6 |
| kimi-code-moonshot-file-edit-v1 | 4 | 27.8 | 33.2 | 39.1 |
| qwen-code-alibaba-file-edit-v1 | 4 | 24.8 | 27.9 | 30.8 |
| xformat-cc-messages-file-edit-v1 | 4 | 18.5 | 21.8 | 27.0 |
| xformat-cc-responses-file-edit-v1 | 4 | 38.5 | 42.0 | 49.0 |
| xformat-messages-cc-file-edit-v1 | 4 | 40.4 | 43.2 | 48.1 |
| xformat-messages-responses-file-edit-v1 | 4 | 30.8 | 34.6 | 38.9 |
| xformat-responses-cc-file-edit-v1 | 4 | 51.6 | 56.1 | 59.7 |
| xformat-responses-messages-file-edit-v1 | 4 | 23.4 | 29.0 | 43.5 |

*First-case cold-start (module/mock-seam init) inflates mean/max; steady-state min ~23ms.

## verifyCorpus wall time (ms, 5 iterations)

| Mode | Min | Mean | Max |
|---|---|---|---|
| replay=true (authoritative) | 450.5 | 464.6 | 483.0 |
| replay=false (static: schema/secrets/contracts/invariants) | 60.3 | 63.8 | 68.0 |
| `bun src/cli.ts verify` (replay-less CLI) | — | 295 | — |

## Determinism

- **Normalized digests**: sha256 over per-turn normalized derived upstream requests +
  rendered responses (manifest-declared drops applied). All 11 cases byte-stable across
  repeated runs in one process, including after full-corpus contamination (process-global
  mock seam reuse). **PASS.**
- **Derive determinism**: `bun src/cli.ts derive --case <id> --force` for all 6 xformat
  cases regenerated goldens byte-identical to committed files (git-clean). Runtime for
  all 6: 4.2s. The 6-cell determinism suite in `src/derive.test.ts` enforces this in CI:
  upstream goldens are byte-stable in 5 of 6 cells (`xformat-messages-responses`
  normalizes a per-run minted `prompt_cache_key`, declared as a `$pattern` expected
  value); response goldens are byte-stable where no manifest-declared volatility exists,
  and normalized-identical otherwise (normalization = manifest drop pointers plus
  expected-value exclusions, same machinery as replay comparison). **Now enforced in CI** by `src/derive.test.ts` ("derive determinism
  across every committed cross-format case"): all 6 cases re-derive in a tmp corpus,
  byte-comparing both `turn-NNN.upstream.json` and `turn-NNN.response.sse` where
  byte-stable and asserting normalized identity (same compare machinery as replay)
  where raw bytes vary only at manifest-declared volatile pointers. Per cell:
  `xformat-messages-cc` byte/byte; `xformat-cc-messages`, `xformat-cc-responses`
  upstream byte, response normalized (`/created` wall-clock); `xformat-messages-responses`
  upstream normalized (`/prompt_cache_key` minted per run, declared `$pattern` expected
  value), response byte; `xformat-responses-cc`, `xformat-responses-messages` upstream
  byte, response normalized (wall-clock `created_at`/`completed_at` + Math.random item ids).
- Known raw-byte volatility (declared in manifests, excluded from comparison):
  responses-skin item ids minted via `Math.random()`
  (`packages/router/skins/openai-responses/utils/id-generator.ts`,
  `from-internal-stream/state.ts`), wall-clock timestamps/created epochs.

## Corpus footprint

| Case | Size | Files | SSE events |
|---|---|---|---|
| xformat-responses-cc | 868 KB | 17 | 559 |
| xformat-cc-responses | 832 KB | 17 | 488 |
| xformat-messages-responses | 624 KB | 17 | 497 |
| codex-openai (parity) | 548 KB | 9 | 251 |
| xformat-messages-cc | 488 KB | 17 | 547 |
| kimi-code-moonshot (parity) | 440 KB | 9 | 111 |
| qwen-code-alibaba (parity) | 372 KB | 9 | 90 |
| deepseek-harness (parity) | 272 KB | 9 | 267 |
| xformat-responses-messages | 184 KB | 17 | 234 |
| xformat-cc-messages | 152 KB | 17 | 203 |
| claude-code-anthropic (parity) | 72 KB | 9 | 117 |

Total: ~4.8 MB, 148 files, 3,364 SSE events, 44 conversation turns across 11 cases.

## Notes

- Replay is sequential by design (`BUN_TEST_NO_CONCURRENT=1`, process-global router
  mock seams). At ~3s for the whole package there is no pressure to parallelize;
  CI runs the identical `bun run test` path.
- The bench harness is committed at `scripts/bench-replay.ts`
  (`bun scripts/bench-replay.ts --iterations N`).
