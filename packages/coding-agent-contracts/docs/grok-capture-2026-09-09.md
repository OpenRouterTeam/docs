# Grok paired capture — 2026-09-09

The Grok follow-up adds `ori-grok-file-edit-v1-20260909`: Grok **1.0.13**, actual Ori source **0.13.0**, and `anthropic/claude-haiku-4.5`. The filesystem task, paired gate and offline replay all pass across **six genuine client/provider pairs**, including the auxiliary title request. With the [earlier eight cases](paired-ori-capture-2026-09-09.md), the published Ori corpus covers **nine harnesses and 38 paired turns**.

## Fix and evidence

- Grok probes `GET /api/v1/api-key` before inference. The controller forwards the real request and retains OpenRouter's real HTTP 404 as non-model diagnostic evidence. It does not fabricate authorization success. Unknown subpaths, wrong methods, model-shaped requests and streaming responses remain rejected; diagnostic bodies still undergo secret checks.
- Native `--model` does not set Grok's separate title model. A fresh private HOME now contains only `[models].session_summary` pinned to the resolved capture model. Native title generation stays enabled. No existing user configuration, primary-model setting, auth or routing override is introduced.
- Request 1 explicitly generates a title; requests 2–6 execute the task. These reviewed `title`/`task` groups scope cross-turn invariants, not replay selection. All calls, tool definitions, content, costs and reasoning data remain checked.
- The only response expectations added are the generated `/id` pattern and numeric `/created`. Original request/response files, bundles, receipt and task outcome are unchanged. The recorded canonical model identity and production replay context match the receipt exactly.

Private evidence: `grok-2026-09-09T21-10-37.115Z` under the existing September 9 paired root, including the retained `grok-config.toml` profile. Session: `a2f959ed-ea8d-4125-a9fb-e55c7fa18284`.

| Leg | Bundle SHA-256 |
| --- | --- |
| Ingress | `473b22aad42cbcd7f182b98cf3f157da6b73b487b7ff960fc23dfca9c9ea2401` |
| Provider | `f54238a72f51be1ea18b654dc533496dc21e08ce29a0822f6da5d5cb70c36926` |

The earlier failed Grok attempts and the dated September 8 ingress-only ledger remain intact. The report's historical local-wire column therefore still describes that older run; the new CI-golden result is separate evidence of this fix. No native-provider or upstream-request semantic parity claim is added: this is platform compatibility replay through the production transforms.
