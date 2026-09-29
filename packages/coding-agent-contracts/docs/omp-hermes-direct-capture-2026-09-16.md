# Direct capture publication — 2026-09-16

Two real harnesses completed `file-edit-v1` through the loopback Arbiter
capture gateway forwarding to https://openrouter.ai. Both runs are
provider-parity cases with `arbiter-exact-capture` provenance, executed with
the direct executor (no Ori mediation), and passed offline replay against the
production pipeline drift-free.

## Published cases

| Harness | Recorded version | Turns | Corpus case |
| --- | --- | --- | --- |
| omp | 18.2.1 | 4 | `omp-openai-file-edit-v1-20260916` |
| hermes | 0.21.3 | 5 | `hermes-openai-file-edit-v1-20260916` |

Both used `openai/gpt-6-astra-20260903` on the OpenAI Responses wire
(endpoint `c2928094-b04c-4f41-84b2-2bf508091421`, provider OpenAI), the same
target as the Codex 2026-09-09 parity case.

## Recording boundaries

The real topology was harness → authenticated Arbiter ingress →
https://openrouter.ai. The gateway held the OpenRouter credential and
stripped the incoming gateway token before credential injection; the harness
saw only the opaque token. Unattended preflights were observed for both
harnesses before the recorded runs (one-shot print-mode completions with
empty isolated HOMEs and only the gateway credential present).

Routing surfaces:

- **omp 18.2.1**: a capture-written `models.yml` (agent dir pinned via
  `PI_CODING_AGENT_DIR`) declares provider `capture-gw` with
  `api: openai-responses` and the gateway base URL. The catalog value
  `apiKey: OMP_CAPTURE_TOKEN` resolves env-first, so the gateway token never
  reaches a file. The `--smol` role is pinned to the same provider so the
  title agent routes through the gateway and is recorded.
- **hermes 0.21.3**: a capture-written `~/.hermes/config.yaml` declares the
  custom provider with `api_mode: codex_responses` (Responses wire) and
  `key_env: HERMES_CAPTURE_API_KEY`. Hermes resolves its tool subprocess
  working directory from `TERMINAL_CWD` (not the process cwd), so the
  capture pins it to the scenario workspace.

Hermes additionally probes `/api/api/show` twice outside the versioned API
root; the converter rejects those exchanges and records them as skipped.

## Reviewed policies

- The strict-schema tool-parameter rewrite (`additionalProperties` collapsed
  at arbitrary depth by the routed endpoint's request normalization) is
  covered by the reviewed drop `/tools/*/parameters`; tool identity, count,
  and descriptions stay asserted, and the conversation invariants still pin
  the golden's own toolset stability across turns.
- **Known limitation (review follow-up):** the rewrite is position-unstable
  across turns — the replay-derived drift landed on `tools/1`, `tools/6`,
  and `tools/7` across successive replays of the same golden — so
  per-pointer normalization cannot enumerate it, and the rewritten parameter
  schemas are not structurally compared. A corpus compare knob that
  normalizes both sides over the strict-schema transform (rather than
  dropping the subtree) would restore schema-shape parity; tracked as a
  follow-up.
- OpenRouter-injected request fields are asserted, not dropped:
  `/include`, `/input/0/type`, the resolved `/model`, the injected
  `/reasoning` and `/text` blocks (omp; hermes's per-turn variance is
  dropped instead), hermes's `/max_output_tokens`, and omp's `/truncation`.
- The synthesized input-item ids (`fc_*`) are covered by the reviewed drop
  `/input/*/id`.
- Hermes's turns carry reviewed `conversation_group` labels: turn 1 (the
  tool-less probe call) is `title`, turns 2–5 are `task`. Cross-turn
  invariants run within each group; every call still receives
  contract/cache/replay validation.
- Response-side volatility mirrors the Codex 2026-09-09 policy verbatim
  (ids, timestamps, usage, cache metadata, obfuscation hints).

## Evidence index

Private root: `/tmp/cc-capture/` (bundle + run records, retained until this
PR merges). The corpus contains only the sanitized replay cases.

| Harness | Ingress/provider bundle digest (SHA-256) |
| --- | --- |
| omp | `13188c66ee04395b5e7c86f53f91353fc73e2ba9922c40d2a2ad1a777fef0387` |
| hermes | `9d5927f14e52c44844cd67cb2f3eb9edf69ee32bbb263c1ed41a794b6ec52c06` |

Both conversions ran against repository commit `ea60fba87eb` (current
`main`).

## Offline verification

Run the package's standard `bun run test` and `bun run verify`, and root
`bun run verify`. The replay gate discovers the two cases and replays them
through the shared offline runtime; no native harness process, provider
credential, or external network call is required for corpus replay.
