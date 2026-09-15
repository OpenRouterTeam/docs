# AGENTS — coding-agent-contracts

Read `README.md` before changing anything here.

## Gated corpus outcomes (current state)

Corpus outcomes are **hard-gated** in required CI. Concretely:

- Blocking CI asserts every committed corpus case replays drift-free
  against production: the `verifyCorpus({replay:true})` all-cases-pass
  gate in `src/replay.test.ts` (all verdicts `pass`, acceptance ACCEPTED),
  green synthetic-case verdicts in `src/verify.test.ts`, and byte-equality
  with committed goldens in `src/derive.test.ts`.
- Tamper negatives assert a corruption introduces a NEW diff relative to
  the uncorrupted replay (`collectJsonDiffs` pointer-set comparison); with
  the gate active the uncorrupted replay is expected to be clean.
- The replay-backed corpus report (`src/report-run.test.ts` →
  `CODING_AGENT_CONTRACTS_REPLAY_REPORT` → `cli.ts report --markdown`)
  NEVER fails on outcomes; it feeds the CI report job's summary and sticky
  PR comment. It is a reporting surface, not the gate.

## Invariants to preserve

- **No proxy here.** Arbiter owns capture/replay transport. If a change needs
  traffic recording, it belongs in Arbiter; this package only consumes
  bundles through `src/arbiter.ts`.
- **Required CI stays offline and secret-free.** No provider calls, no
  databases, no harness processes, no Infisical. If a test needs any of
  those, it does not belong in this package's required path.
- **Every ignored field is a reviewed JSON pointer** in a case manifest's
  `normalization` block. Never add global drops in `src/compare.ts`.
- **Contract authority honesty.** All validators are curated runtime schemas.
  Do not label anything `official-openapi` without a vendored, hash-pinned
  first-party artifact (a test in `src/corpus.test.ts` enforces this).
- **Harness registry is closed.** Five provider-owned ids: Claude Code,
  Codex, DeepSeek Harness, Kimi Code, and Qwen Code. Capture runs the locally
  installed latest CLI and records the real version into the manifest via
  `versionArgv`.
- **Acceptance is hard-gated.** `verifyCorpus` reports `acceptance` separately
  from `passed`. Acceptance requires replay-clean `arbiter-exact-capture`
  parity cases for all five provider-owned harnesses, every committed
  cross-format case passing all verdicts, and all 9 ingress-dialect ×
  provider-wire matrix cells populated with authoritative provenance:
  diagonal cells must be provider-parity `arbiter-exact-capture`,
  off-diagonal cells must be cross-format with `derived-blessed` or
  `arbiter-exact-capture` provenance, and every `derived_from_case_id`
  must chain to a committed parity `arbiter-exact-capture` case.
- **Three case kinds.** `provider-parity` (X = Y; ingress bytes are the
  upstream golden), `platform-compatibility` (OpenRouter ingress; upstream
  verdict skipped by design), and `cross-format` (X ≠ Y; per-turn
  `provider_request_body` is the upstream golden in the adapter's wire
  format Y, asserted — never skipped). Cross-format requires all four
  per-turn artifacts; the other kinds forbid `provider_request_body`.
- **Three provenance tiers.** `synthetic-fixture` (self-test only, task
  outcome skipped), `derived-blessed` (transformed from a committed parity
  case and human-blessed; must record `derived_from_case_id`; treated as
  real for task outcome but reported as a weaker tier), and
  `arbiter-exact-capture` (strongest).
- **Prefer expected values over drops.** Contract fields OpenRouter
  injects/transforms belong in `*_expected_values` (asserted), not
  `*_drop_json_pointers` (blind tolerance). Drops are for generated ids and
  timestamps only.
- **Corruption must fail.** Any change to replay or comparison must keep the
  negative tests in `src/replay.test.ts` red-on-tamper: corrupted request
  bytes, response events, tool definitions, cache keys, prior turns, and
  markers all produce a NEW focused diff relative to the uncorrupted
  replay.
- **Invariants hold on BOTH wire sides for cross-format cases.**
  `conversation_invariants` checks the committed ingress requests (X) and,
  for cross-format cases under replay, append-only-prior-turns and
  stable-tool-definitions on the replay-DERIVED upstream requests (Y) — a
  golden blessed with a prior-turn mutation must still fail. Cache-scoped
  invariants on Y stay with `cache_wire_behavior`. Cross-family leak
  detection imports its disallowed field sets from the production gate
  module (`packages/router/adapters/adapter-wire-shape.ts`), never a local
  copy.
- **Derive is fail-closed.** `derive` only regenerates goldens for
  `cross-format` + `derived-blessed` cases; write targets are
  containment-resolved (no traversal, no symlinks), candidates are
  secret-scanned before any write, and writes are stage-then-rename.
  Manifest text is secret-scanned before schema parsing, and schema errors
  are reported as paths + codes only (no received-value echo).

## Adding a corpus case

1. Capture through Arbiter's gateway (local `bun run capture`), sanitize,
   convert to `corpus/<case-id>/`.
2. Manifest: exact model + recorded endpoint id (non-null; synthetic cases
   use an explicit synthetic UUID), the capture-probed harness version,
   contract provenance, expected values for OpenRouter-transformed fields,
   and the minimal set of genuinely volatile JSON pointers.
3. Run the package's offline corpus validation and tests described in `README.md`; both must pass with zero undeclared drift before submitting changes.

## Style

Monorepo standards apply: Result monads (no throwing across module
boundaries), no `any`, explicit return types, `satisfies never` completeness
checks, immutable structures. Tests colocated as `.test.ts`.
