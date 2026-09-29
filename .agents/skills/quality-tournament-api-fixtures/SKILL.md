---
name: quality-tournament-api-fixtures
description: Verified real API request fixtures (TTS, image generation, chat + tool calls, streaming/reasoning/vision/structured-output matrix, Codex replay transcript) for sanity-checking each modality before quality-tournament testing. Sub-skill of verify-quality-tournament-wizard-ui.
allowed-tools: Bash,Edit,Read,Write
user-invocable: true
---

# Quality Tournament API Fixtures

Verified real API requests for sanity-checking each modality before
tournament testing. Part of
[`verify-quality-tournament-wizard-ui`](../verify-quality-tournament-wizard-ui/SKILL.md).

When testing a modality, sanity-check the underlying API path first with a
known-good request. The fixtures live in `examples/` next to this skill;
each is self-describing: `{ scenario, verified, endpoint, request,
response }` (error fixtures carry `expected_error` instead of `response`;
streaming fixtures store the raw SSE text as `response`). All were run
against production on the dates noted and returned the documented results,
so any deviation points at the environment (key, model staging, worker)
rather than the request shape. Use `OPENROUTER_API_KEY` from Infisical at
`/tests/e2e`, or a key provided by the user.

```bash
# See what a fixture tests:
jq -r .scenario .agents/skills/quality-tournament-api-fixtures/examples/gpt-5.5-chat-tool-call-turn-1.json

# Replay a fixture (swap .model to test a cheaper model):
f=.agents/skills/quality-tournament-api-fixtures/examples/gpt-5.5-chat-tool-call-turn-1.json
curl -s "https://openrouter.ai$(jq -r .endpoint $f)" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq .request $f)"
```

## TTS — `microsoft/mai-voice-2` (verified 2026-06-10)

Returned `HTTP 200`, `content-type: audio/mpeg`, a 26,400-byte mp3, and an
`x-generation-id: gen-tts-...` header:

```bash
curl -s -D headers.txt -o hello.mp3 \
  -X POST https://openrouter.ai/api/v1/audio/speech \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "microsoft/mai-voice-2",
    "input": "hello world",
    "voice": "en-US-Harper:MAI-Voice-2",
    "response_format": "mp3"
  }'
grep -i "HTTP/\|content-type\|x-generation-id" headers.txt
ls -la hello.mp3   # non-zero size; mp3 frame sync fff3/fffb (or ID3) at byte 0
```

TTS gotchas:
- `voice` is required — omitting it returns a 400 ZodError
  (`expected string, received undefined` at path `voice`).
- Voice names are provider-specific. Azure MAI-Voice-2 voices follow
  `{locale}-{Name}:MAI-Voice-2` (e.g. `en-US-Harper:MAI-Voice-2`); see
  `fixtures/azure-tts/2026-06-02-mai-voice-2-voices.json` for the full list.
  The tournament's `defaultVoiceForModelSlug()` (in
  `tts-preference-defaults.ts`) has no `microsoft` case and falls back to
  `alloy`, which Azure rejects — prefer models covered by that switch
  (google, mistralai, inworld-ai, qwen, canopylabs, openai) for tournament
  TTS replays, or extend the switch locally.
- Tournament TTS replays go through cfw-tts-api (port `8791` locally); the
  e2e suite lives at `tests/e2e/api/tts/`.

## Image generation — `google/gemini-2.5-flash-image` (verified 2026-06-10)

Returned `HTTP 200` with one `data:image/png;base64,...` image (~1.5 MB
decoded) and `usage.completion_tokens_details.image_tokens: 1290`
(cost ~$0.039):

```bash
curl -s -o img.json -w "%{http_code}\n" \
  -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemini-2.5-flash-image",
    "messages": [
      {
        "role": "user",
        "content": "Generate a photorealistic image of a bright orange sunset over snow-capped mountains with a clear sky. You MUST include an image in your response."
      }
    ],
    "modalities": ["image", "text"]
  }'
```

Image gotchas:
- Images come back in `message.images`, separate from `message.content`.
- Models occasionally answer text-only; the e2e suite retries up to 3 times
  (`fetchImageGeneration` in
  `tests/e2e/api/chat-completions/multimodal/image-generation.test.ts`).
  The "You MUST include an image" phrasing comes from
  `RequestBuilder.imageGeneration` and keeps that rate low.

## Chat + tool calls — GPT-5.5 & Opus 4.8 (verified 2026-06-10)

Seed scenarios for text-modality runs and eval debugging. Three scenarios
per model: single prompt, multi-turn, and a full tool-call loop (model emits
a tool call → tool result sent back → model answers from it). When running
evals on cheaper models, replay the same bodies with a different `.model`.

| Fixture | Endpoint | Scenario |
|---------|----------|----------|
| `gpt-5.5-chat-single.json` | chat completions | Single prompt → `finish_reason: stop` |
| `gpt-5.5-chat-multi-turn.json` | chat completions | Multi-turn ("Lisbon" → "Portugal") |
| `gpt-5.5-chat-tool-call-turn-1.json` | chat completions | Emits `get_weather` call (`finish_reason: tool_calls`, `call_...` id) |
| `gpt-5.5-chat-tool-call-turn-2.json` | chat completions | Tool result sent back → answer (`finish_reason: stop`) |
| `opus-4.8-chat-single.json` | chat completions | Single prompt → `finish_reason: stop` |
| `opus-4.8-chat-multi-turn.json` | chat completions | Multi-turn with prior assistant message |
| `opus-4.8-chat-tool-call-turn-1.json` | chat completions | Tool call with Anthropic-native `toolu_...` id and assistant text alongside `tool_calls` |
| `opus-4.8-chat-tool-call-turn-2.json` | chat completions | Tool result sent back → `finish_reason: stop` |
| `opus-4.8-messages-single.json` | /messages | Single prompt → `stop_reason: end_turn` (`max_tokens` required) |
| `opus-4.8-messages-multi-turn.json` | /messages | Multi-turn with prior assistant message |
| `opus-4.8-messages-tool-call-turn-1.json` | /messages | `tool_use` content block (`stop_reason: tool_use`, `input_schema` tools) |
| `opus-4.8-messages-tool-call-turn-2.json` | /messages | `tool_result` user block sent back → `stop_reason: end_turn` |

Shared tool definition (chat completions format):

```json
{"type": "function", "function": {"name": "get_weather", "description": "Get current weather for a city", "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}
```

Differences observed Opus 4.8 vs GPT-5.5 on chat completions:
- Tool-call ids are `toolu_...` (Anthropic-native) instead of `call_...`.
- The tool-call turn includes assistant text alongside `tool_calls`
  (e.g. "I'll check the current weather in Tokyo for you.") — don't assume
  `content` is empty when `finish_reason` is `tool_calls`. Echo that text
  back as `content` (not `null`) in turn 2.

`/api/v1/messages` (Anthropic format): native Anthropic requires
`max_tokens`; OpenRouter accepts requests without it and applies a default
(see `opus-4.8-messages-no-max-tokens.json`) — still send it explicitly. The
tool result goes back as a `tool_result` content block in a **user**
message; tools use Anthropic's `input_schema` shape.

The tool-call `turn-2` fixtures embed the `call_...`/`toolu_...` ids from
the recorded turn 1 — when replaying live, substitute the ids from your own
turn-1 response.

Chat + tool-call gotchas:
- Chat-completions skin normalizes both models to `message.tool_calls` +
  `finish_reason: tool_calls`; the /messages skin keeps Anthropic-native
  `content` blocks + `stop_reason: tool_use`. Bugs often live in this skin
  translation — compare both for the same model when triaging.
- `tool_call_id` / `tool_use_id` must exactly match the id from the previous
  assistant turn or providers reject the request.
- Inspect locally via dev-fs-logs:
  `skins/anthropic-messages/tool-calls.log` and
  `skins/openai-chat-completions/response-json.log` under the generation's
  log folder.

## Scenario matrix — six frontier models (verified 2026-06-10)

A wider seed set covering high-value bug surfaces across
`google/gemini-3.1-pro-preview`, `anthropic/claude-opus-4.8`,
`openai/gpt-5.5`, `google/gemini-3.5-flash`, `anthropic/claude-sonnet-4.6`,
and `minimax/minimax-m3`.

| Fixture | Models | Scenario |
|---------|--------|----------|
| `gpt-5.5-chat-stream-tool-call.json`, `sonnet-4.6-chat-stream-tool-call.json` | gpt-5.5, sonnet-4.6 | Streaming tool call (`stream: true`) — deltas assembled across SSE chunks, final `finish_reason: tool_calls` |
| `gemini-3.1-pro-chat-reasoning.json`, `minimax-m3-chat-reasoning.json` | gemini-3.1-pro, minimax-m3 | Reasoning (`reasoning.effort: high`) — populated `message.reasoning` + reasoning token accounting |
| `opus-4.8-chat-parallel-tool-calls.json`, `gemini-3.5-flash-chat-parallel-tool-calls.json` | opus-4.8, gemini-3.5-flash | Parallel tool calls — 4 tool_calls (weather + time × Tokyo + Paris) in one turn |
| `sonnet-4.6-chat-system-plus-tools.json` | sonnet-4.6 | System prompt + tools together — system constrains style while model still emits a tool call |
| `gpt-5.5-chat-structured-output.json`, `gemini-3.1-pro-chat-structured-output.json` | gpt-5.5, gemini-3.1-pro | Structured output (`response_format: json_schema`, strict) — schema-exact JSON |
| `gemini-3.5-flash-chat-vision.json`, `opus-4.8-chat-vision.json` | gemini-3.5-flash, opus-4.8 | Multimodal input — text + base64 data-URI image (remote URLs can 400 at provider fetch; data URIs replay reliably) |
| `gemini-3.1-pro-chat-tool-choice-required.json`, `sonnet-4.6-chat-tool-choice-forced.json` | gemini-3.1-pro, sonnet-4.6 | Forced `tool_choice` naming `get_weather` — must emit that call, never text |
| `gemini-3.5-flash-chat-long-multi-turn.json`, `sonnet-4.6-chat-long-multi-turn.json` | gemini-3.5-flash, sonnet-4.6 | Long multi-turn (11 messages, 5 facts) → one-sentence summary checks context retention |
| `opus-4.8-messages-no-max-tokens.json` | opus-4.8 | Gotcha: /messages without `max_tokens` succeeds on OpenRouter (default applied) though native Anthropic rejects it |
| `error-chat-unknown-model.json` | — | Expect 400 `is not a valid model ID` |
| `error-chat-mismatched-tool-call-id.json` | gpt-5.5 | Tool result references wrong `tool_call_id` → 400 with provider raw error in metadata |

Replay targets for cheap-model evals — swap `.model` to one of these and
diff the behavior (errors, leaked think tags, id formats, schema adherence,
streaming assembly): `deepseek/deepseek-v4-flash`, `minimax/minimax-m3`,
`tencent/hy3-preview`, `xiaomi/mimo-v2.5`, `deepseek/deepseek-v3.2`,
`stepfun/step-3.7-flash`.

```bash
f=.agents/skills/quality-tournament-api-fixtures/examples/gpt-5.5-chat-structured-output.json
curl -s "https://openrouter.ai$(jq -r .endpoint $f)" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq '.request | .model = "deepseek/deepseek-v4-flash"' "$f")"
```

Scenario-specific expectations when replaying: streaming fixtures need
`stream: true` kept in the body (verify chunk assembly, not just the final
answer); error fixtures should reproduce the same HTTP status.

## Codex agent replay conversation

A real Codex (`openai/gpt-5.5`) agent transcript captured from production
prompt logs, stored as a replay fixture (`{ scenario, verified, endpoint,
request }` — no recorded response; it's an input for the tournament replay
path). Absolute local workdir paths are normalized to `/workspace`:

| Fixture | Messages | Scenario |
|---------|----------|----------|
| `codex-replay-313-messages.json` | 313 | Developer role, deep tool call/result chains, and `image_url` content parts with `[OR_REDACTED]` URLs. Reproduces the replay sanitizer bug: wire-format `image_url` fails the SDK's camelCase `imageUrl` outbound validation (`invalid_union` on role), and redacted URLs 400 at the provider |

Always pipe `request.messages` through `sanitizeReplayMessages` before
`chatSend` — raw prompt-log messages fail SDK outbound validation. The
sanitizer remaps `image_url` → `imageUrl` and drops image parts whose URL
was redacted to `[OR_REDACTED]`.

