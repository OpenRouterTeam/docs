# Mistral TTS fixtures

- `wav-stream-live.sse` — raw SSE body captured 2026-09-12 from
  `POST https://api.mistral.ai/v1/audio/speech` with
  `{"model":"voxtral-mini-tts-2603","input":"Hi.","voice_id":"en_paul_neutral","response_format":"wav","stream":true}`
  (200, `text/event-stream`). One `speech.audio.delta` and one
  `speech.audio.done` event. Decoded audio is 19,244 bytes: a 44-byte
  RIFF/WAVE header (PCM, mono, 24 kHz, 16-bit, `0xffffffff` streaming size
  placeholders) followed by 19,200 sample bytes.
