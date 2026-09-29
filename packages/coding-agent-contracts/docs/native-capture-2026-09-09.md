# Native harness capture refresh — 2026-09-09

Five real native harnesses completed `file-edit-v1` locally through Arbiter 1.1.0. The saved result files were independently rechecked. All 19 model exchanges returned HTTP 200 SSE, passed bundle integrity checks and secret scans, and were retained. Children received only opaque gateway credentials and isolated HOME/workspace directories.

## CI publication

| Harness | Recorded version | Native model | Turns | New corpus case |
| --- | --- | --- | --- | --- |
| Claude Code | 2.1.259 | `claude-haiku-4-5-20251001` | 4 | Blocked on response replay drift; retained locally |
| Codex CLI | 0.153.4 | `gpt-6-astra` | 3 | `codex-openai-file-edit-v1-20260909` |
| DeepSeek Harness | 0.1.0-rc.6 | `deepseek-v4-flash` | 4 | `deepseek-harness-deepseek-file-edit-v1-20260909` |
| Kimi Code | 0.35.0 | `kimi-k2.5` | 4 | `kimi-code-moonshot-file-edit-v1-20260909` |
| Qwen Code | 0.21.10 | `qwen3-coder-plus` | 4 | `qwen-code-alibaba-file-edit-v1-20260909` |

The four published cases pass every offline replay verdict. Their 15 request/response pairs were compared against the original verified bundles: request JSON is pretty-printed by the existing converter, and SSE is unchanged except for its trailing newline. No model calls were skipped and no response bodies were reconstructed. Recorded `capture.launch` values come from `captureCase`, not registry inference.

The historical five native cases and six derived conversions are unchanged. Fresh cases use new IDs so the older conversions still refer to the captures that actually supplied their bytes. CI discovers and replays all cases; the required five-harness roster and all-case acceptance gate remain enforced. At this native publication step, the report contained nine native captures, six conversions, and no committed Ori compatibility captures. Paired Ori cases were subsequently added in the [paired capture publication](paired-ori-capture-2026-09-09.md).

## Claude failure retained

All four fresh Claude turns fail response equality at `/message/context_management`: the provider sends explicit `null` in `message_start`, while the production response skin omits the field. The upstream request, contracts, invariants, cache checks, and filesystem task pass. This capture is not in the accepted corpus, and no new ignore pointer or expected-value exception was added to conceal the mismatch. The older accepted Claude baseline remains intact.

## Replay metadata and normalization

The harness/capture implementation was the pushed revision `a6754f06c0bb69b553d6c2ccfbc0861053d20b05`; the later stack rebase does not change which code executed. Versions and timestamps are the newly observed values, including unchanged installed versions for DeepSeek, Kimi, and Qwen.

Replay endpoint identities come from `postgres/seeds/endpoints_rows.csv`, not invented UUIDs. These native calls went directly to providers: the endpoint UUID identifies the corresponding OpenRouter endpoint reconstructed for offline replay, not a measured OpenRouter routing decision. DeepSeek, Kimi, and Qwen reuse the existing model/endpoint mapping. Codex now emits `gpt-6-astra`, so its replay target is the standard-service-tier OpenAI endpoint `c2928094-b04c-4f41-84b2-2bf508091421` for `openai/gpt-6-astra-20260903`.

The three unchanged-model cases retain their source baseline's reviewed normalization. Codex retains the existing Responses normalization, with `/response/model` asserted as its new OpenRouter model ID. No new drop pointers were added. The Infisical entropy scanner required one exact-value exception for Codex’s non-secret UUID prompt-cache session ID; no SSE path or credential pattern was broadly exempted. Acceptance still requires the real, current production transforms to match those assertions.

## Reproduction

Use the existing local-only [capture execution runbook](capture-execution.md), `src/capture.ts`, and Arbiter's `gateway` command. Do not route these native baselines through Ori or production OpenRouter.

| Harness | Arbiter target origin | Allowed model path | Controller credential | Capture gateway URL |
| --- | --- | --- | --- | --- |
| Claude Code | `https://api.anthropic.com` | `/v1/messages` | `ANTHROPIC_API_KEY`, `x-api-key` header | Loopback origin |
| Codex | `https://api.openai.com` | `/v1/responses` | `OPENAI_API_KEY`, Bearer header | Loopback origin plus `/v1` |
| DeepSeek | `https://api.deepseek.com` | `/v1/chat/completions` | `DEEPSEEK_API_KEY`, Bearer header | Loopback origin |
| Kimi | `https://api.moonshot.ai` | `/v1/chat/completions` | `MOONSHOTAI_API_KEY`, Bearer header | Loopback origin |
| Qwen | `https://dashscope-intl.aliyuncs.com` | `/compatible-mode/v1/chat/completions` | `ALIBABA_API_KEY`, Bearer header | Loopback origin |

1. Authenticate Infisical locally and obtain controller credentials only from the `dev` environment's `/_providers` path. Regionalized values use `getEnvRegional(value, DataRegion.Global)`; DeepSeek's comma-separated pool supplies one key. Never give these credentials to a harness.
1. Start a loopback Arbiter gateway in exact mode with a fresh opaque token. This run allowed GET/POST, capped at 20 requests, 2 MiB/request, 32 MiB/response and five minutes; Codex also allowed `/v1/models`. Bind only to `127.0.0.1`. Arbiter's `--capture-output` exports the bundle on shutdown; `--credential-command`, `--credential-header`, and `--credential-prefix` keep provider credentials in the controller.
1. Invoke the real executable through `captureCase({executor: 'direct', ...})` or the CLI below. Use `--harness-executable` to select the actual binary whose version is probed, especially where a stale npm Codex shim precedes the standalone executable. Do not use a simulated launcher.

   ```sh
   CODING_AGENT_CONTRACTS_ALLOW_LOCAL_CAPTURE=1 CAPTURE_TOKEN="$GATEWAY_TOKEN" \
     bun run capture --harness "$HARNESS_ID" --executor direct \
       --harness-executable "$HARNESS_EXECUTABLE" --gateway "$CAPTURE_GATEWAY_URL"
   ```

1. Retain the returned launch/version/outcome plus the workspace's input/result files, stdout/stderr with exact credentials redacted, every gateway decision, and the exported bundle. A successful exit alone is not sufficient. Failed attempts stay separate from retries.
1. Run `sanitizeCapture` and decoded-body secret scans with the exact gateway/provider credentials as reject values, then `loadArbiterBundle`. Use `convertBundleToCase` for `provider-parity` without `providerFixtures`; pass the observed capture result and verified target identity. Write to a candidate directory first.
1. Run `verifyCorpus({replay: true})` under Bun's test runtime for every candidate. Publish only all-verdict-passing cases, compare the published bodies back to their bundles, and run the package's full replay/tamper suite. Preserve any failing candidate outside the accepted corpus.

## Local evidence and remaining scope

Raw bundles, redacted process output, saved task files, candidate reports, the operational scripts, and `verification.json` are retained under `~/.local/share/coding-contract-captures/2026-09-09/`. These local artifacts are not downloaded or accessed by CI; the four new corpus directories contain everything required for offline replay.

The September 8 Ori recordings remain ingress-only. No Ori run was recaptured here, no paired provider response was inferred from those recordings, and no Ori coverage was promoted. The subsequent [paired Ori publication](paired-ori-capture-2026-09-09.md) uses separate genuine paired runs. This native Claude response drift remains unresolved.

## Source bundle digests

| Harness | Local run directory | Arbiter bundle SHA-256 |
| --- | --- | --- |
| claude-code | `claude-code-2026-09-09T16-07-21.888Z` | `8a45a15d5edf44558ab2c5233399bc340695ff3389cb3a382a0ba51373401bca` |
| deepseek-harness | `deepseek-harness-2026-09-09T16-07-45.616Z` | `3ba9f128ea98580d98c2b1643a613fdc4d4e0ea9fb16a3febc35c96b3a6f017a` |
| qwen-code | `qwen-code-2026-09-09T16-07-45.619Z` | `4b9be6f6677494fcb6485845ffc1fb02cf945a9efde5485fd36798bbe1f73eed` |
| codex | `codex-2026-09-09T16-07-45.618Z` | `b4e6cf714bc4f9a058210ae5fea55ee0744170dceaae19a68487a33e74f02f9c` |
| kimi-code | `kimi-code-2026-09-09T16-07-45.640Z` | `b90041830f941f71155fdb5ef5d39ba8fa23a2a085a2760bd23098f26bfd32a1` |
