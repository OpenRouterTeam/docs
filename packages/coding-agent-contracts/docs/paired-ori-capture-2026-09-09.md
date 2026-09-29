# Paired Ori capture publication — 2026-09-09

Eight real harnesses completed `file-edit-v1` through actual Ori and the local OpenRouter worker. All **32 client model calls and 32 provider calls** were retained, paired by recorded request identity with strict timing checks, and passed offline platform-compatibility replay. Auxiliary title calls are included.

## Published cases

| Harness | Recorded version | Turns | Corpus case |
| --- | --- | --- | --- |
| claude-code | 2.1.266 | 4 | `ori-claude-code-file-edit-v1-20260909` |
| prime-agent | 0.9.3 | 2 | `ori-prime-agent-file-edit-v1-20260909` |
| codex | 0.153.4 | 3 | `ori-codex-file-edit-v1-20260909` |
| pi | 0.85.1 | 4 | `ori-pi-file-edit-v1-20260909` |
| cline | 3.0.61 | 5 | `ori-cline-file-edit-v1-20260909` |
| muse | 1.0.3 | 4 | `ori-muse-file-edit-v1-20260909` |
| kilo | 7.5.16 | 5 | `ori-kilo-file-edit-v1-20260909` |
| opencode | 1.18.25 | 5 | `ori-opencode-file-edit-v1-20260909` |

Claude Code and OpenCode use `anthropic/claude-haiku-4.5`; the other six use `openai/gpt-6-astra`. OpenCode's native title request disables reasoning, which the Astra endpoint rejects. That failed Astra attempt is retained separately; it was not pruned or published. This eight-harness publication has no Grok golden. The subsequent [Grok follow-up](grok-capture-2026-09-09.md) adds a separately verified ninth harness.

## Recording and replay boundaries

The real topology was Ori → native harness → authenticated Arbiter ingress → local Next routing → local cfw-api → Arbiter provider recorder → native provider. The catalog used cfw-public-api. The database was task-owned and isolated; no production database writes were required.

The accepted recordings used Arbiter 1.1.0 with the pinned gateway patch from [Arbiter #43](https://github.com/LukasParke/arbiter/pull/43), including its compiled exports. Incoming credential headers are stripped before controller credential injection. Correlation is nonsecret metadata, not a credential. The Anthropic leg uses Arbiter's existing native-header capture session; native credentials are not given to the harness.

Ori ran from the existing modified source worktree, not an unmodified released binary. Each manifest records the observed Ori version, source revision plus worktree digest, actual launch, and serving-router commit. Original source snapshots, authenticated bundles, receipts, timing fingerprints, task files, and redacted process logs remain in private evidence. Later Git rebases do not change which revision was measured.

Replay context is copied from the authenticated session receipt: actual endpoint pricing/capabilities and the production user-context accounting flag, read before launch. Where required, the receipt also binds canonical model identity. Legacy defaults were not retroactively presented as captured settings.

These are **platform-compatibility** cases. CI replays every recorded provider response through the current production transforms and compares the complete client response after the explicit volatility policy. It validates contracts, scoped conversation/cache checks, task evidence, and secret safety. Upstream request semantic comparison is explicitly skipped for this corpus kind: this publication does **not** claim upstream request parity.

## Reviewed policies

- Four exact anchored secret-scanner exceptions cover reviewed non-secret prompt-cache metadata: router-derived SHA-256 routing keys and caller session UUIDs. No whole SSE path or credential pattern is exempted; captured bytes remain unchanged.
- Only generated IDs/timestamps are matched by explicit expectations or narrowly listed volatility pointers. Model identity, usage/cost, tool calls, reasoning format/data, and cache data remain compared.
- Kilo and OpenCode explicitly label their first request `title` and the remaining four `task`. These are reviewed test-policy groups, not claimed native session IDs. Cross-turn checks run within each group; every call still receives contract/cache/replay validation. Membership appears in collapsed report details.
- History comparison permits request-scoped instruction refreshes and an otherwise identical singleton plain-text block/string representation. It does not remove text, extra attributes, tool history, or cache accounting.
- Rejected attempts remain separate. No September 8 ingress-only recording was upgraded into paired evidence. The separate native Claude replay drift remains documented in [the native capture note](native-capture-2026-09-09.md).

## Evidence index

Private root: `~/.local/share/coding-contract-captures/2026-09-09-paired/`. The corpus contains only the sanitized replay cases, not credentials, raw capture directories, or process logs.

| Harness | Session | Ingress bundle SHA-256 | Provider bundle SHA-256 |
| --- | --- | --- | --- |
| claude-code | `54ecd924-92c1-4cf0-bebb-a90212c4f430` | `685fe54652405248aac0c049110b8aadd7d946bcf8c817dd624a6176007e6e20` | `9ef921ddfd0daf046810db027697dfc77312a233207731dd77d118a6d5f2ab3d` |
| prime-agent | `96187973-daf7-4e5b-a8a8-e0445f592065` | `a7a832477717743dc128432c320c6827a405be8a903e548e3344dfcb1fb6cd47` | `62a091fd361df3ad142795ed3b25de69ab7b7435a18a71d6f7896bc2dc0dd5c9` |
| codex | `4a60a94a-6c02-4bdd-a694-73058d11dc7b` | `50ed68290df3f025a6b905f7e02ce9fee2b3ab051843ed4080aaa40135dd97cc` | `6311b075952ecc353571594ea4926b142bba9f15635bdce39b6dc1ab03ce7d6b` |
| pi | `e5c745eb-9152-47a6-94f2-dd4f549870f3` | `9e862e4a5541500c1837030f0342ff34ae26f4d12a411251880ff7f5e37b37ce` | `3c2b32c2f4d5d7f2abc67d286d5cc82e970d0f159068c5b9eb4fd011e574f522` |
| cline | `befaf62a-61f7-4a2f-88d5-e5fbd1d96417` | `1f5bc2ad17c9c8f6a53b13a6243f05970a06d7746ac81d7e71589a5fa5ec7bc0` | `015121a6961012ae0de0efe4b7ca5d11e75787c7082672d6c87432bf3cb527dd` |
| muse | `394a5ece-943b-4456-a432-207a6edbee2d` | `5c72908e310289847721c9109161e6d568e6871efdbd84eded11635894a3079f` | `3490179cffebe796b3536922eaeb772a3be286cde8ef663c8981a5a5a69f1afa` |
| kilo | `e9b227d8-8f4d-4e2e-ad80-b4a05c1b7722` | `fa7a7dad1d4a557b3e2fc36c834ac62b2e1da03c4856ddc347cf4382bcf60562` | `c9d7829d0dd4ddbcefa4d13a9c141fa6c3c5f05371a7f928cf727718d7824827` |
| opencode | `3cf57267-35e8-4da8-a418-cf280576086d` | `1cafa5fbbb3bd13698740f6eebd3c568c4f37d1d3aeb770b4733d41d3ccd8196` | `6022e8c1cbaccfa71a20c250ed8a1a6507bcda5683dddf69de4e2dfeeb8cad92` |

## Offline verification

Run the package's standard `bun run test` and `bun run verify`, and root `bun run verify`, with Bun 1.3.14. The normal corpus test discovers these cases and executes replay under the shared offline runtime. No native harness process, provider credential, or external network call is required for corpus replay.
