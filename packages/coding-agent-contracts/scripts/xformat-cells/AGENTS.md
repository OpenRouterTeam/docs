# xformat-cells — one-off cell-generation tooling

This directory is **not part of the package's exported surface** and is
**not load-bearing for the contract suite**. It holds the one-off toolchain
that authored the committed `xformat-*` cross-format cells:

- `dialects.ts` — request-dialect converter (anthropic-messages ↔
  openai-chat-completions ↔ openai-responses) through a canonical IR.
- `dialects.test.ts` — its colocated tests (still run by `bun test` and
  typechecked; keep them green if you touch the converter).
- `generate-xformat-responses-cells.ts` / `generate-xformat-b2b-cells.ts` —
  the generators that used the converter to produce the committed cells'
  ingress requests and manifests.

The cells these scripts produced are already committed under `corpus/`.
Nothing in `src/` imports this directory: `derive` rebuilds goldens through
`replayTurn` on the production skin → router → adapter path, so the
converter cannot drift the suite and cannot affect production. The
production adapters remain the only authoritative dialect translation.

Reach for this tooling only to seed a NEW cross-format cell from a parity
capture (see "Deriving cross-format cases" in the package README). If the
converter's supported construct set is too narrow for a new seed, extend it
here — do not promote it back into `src/`.
