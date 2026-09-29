# Alibaba Qwen-Audio-TTS fixtures

Captured live 2026-07-22 against
`POST https://dashscope-intl.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`
(Singapore / international region) with the shared DashScope API key. Binary
audio bodies are not committed; each fixture records its status, output
format, and billed character count below. Signed OSS result URLs in
the responses expire 24 hours after capture; their `OSSAccessKeyId` and
`Signature` query params are redacted to `REDACTED` (the URL shape is
preserved for adapter development).

- `baseline.request.json` / `baseline.response.json` — wav, `longanlingxin`, 59 ASCII chars billed 59 (200)
- `mp3.request.json` / `mp3.response.json` — mp3 output (200, `.mp3` OSS URL)
- `pcm.request.json` / `pcm.response.json` — raw pcm output, 24 kHz (200, `.pcm` OSS URL; s16le mono)
- `alt-voice.request.json` / `alt-voice.response.json` — second system voice `longanlufeng` (200)
- `cjk-emoji.request.json` / `cjk-emoji.response.json` — `你好世界 😀 hello` billed 16 chars (CJK ×2, emoji ×1)
- `instruction.request.json` / `instruction.response.json` — `input.instruction` (singular) verified effective (whisper-slowly doubled duration); instruction text not billed
- `base-voice.request.json` / `base-voice.response.json` — base voice `qwen-audio-3.0-tts-plus-longyinghaikai` (200)
- `flash-baseline.request.json` / `flash-baseline.response.json` — `qwen-audio-3.0-tts-flash` with system voice `longanhuan_v3.6` (200)
- `voices-base-sample.json` — 20-voice sample of the 1,026-voice base catalog, converted 1:1 from the official Excel downloads on the [Qwen-Audio-TTS voice list](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list) (2026-07-20 revision); the suffix set and attributes are identical for both models (verified by diff), differing only in the `qwen-audio-3.0-tts-{plus|flash}-` prefix — the full catalog is regenerated from the Excel for the metadata/pricing PR
- `error-invalid-voice.response.json` — 400 `InvalidParameter`, `[cosyvoice:]Engine error [411]`
- `error-invalid-format.response.json` — 400 `InvalidParameter`, `Request format is invalid!`
- `error-bad-auth.response.json` — 401 `InvalidApiKey` (header `x-request-id` present)
- `stream-live.sse` — full `X-DashScope-SSE: enable` capture: `sentence-begin`, base64 pcm deltas in `output.audio.data`, `sentence-end` with `usage.characters`, final event with OSS URL
