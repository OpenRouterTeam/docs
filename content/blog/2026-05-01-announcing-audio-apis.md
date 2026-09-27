---
title: "New Audio APIs for Speech and Transcription"
date: "2026-05-01T18:00:00.000Z"
author: "Jacky Liang"
teaser: "Text-to-speech and transcription are now live on OpenRouter. Two new endpoints give you access to speech synthesis and audio transcription across multiple providers, under one API."
headerImage:
  url: "/images/audio-apis.png"
  width: 1456
  height: 819
category: "announcements"
---

OpenRouter now has two dedicated audio endpoints: `/api/v1/audio/speech` for text-to-speech and `/api/v1/audio/transcriptions` for speech-to-text.

These new endpoints deliver specialized models that are generally faster and more cost-efficient than the [general audio models](https://openrouter.ai/models?output_modalities=audio) we already support, but are more narrowly useful for specific audio tasks.

You can now generate speech from text with OpenAI, Google, or Mistral voices and transcribe audio files with OpenAI Whisper. All with the same routing, billing, and key management you already use for text, video and image generation.

[Speech models](https://openrouter.ai/models?output_modalities=speech) · [Transcription models](https://openrouter.ai/models?output_modalities=transcription) · [Speech docs](https://openrouter.ai/docs/features/multimodal/tts) · [Transcription docs](https://openrouter.ai/docs/guides/overview/multimodal/stt)

## Choosing a model: Audio vs. Speech vs. Transcription

The choice of models is a balance of specialization, cost, and speed. We've enabled access to the breadth of options so you can choose the right path for each use case:

| | **Audio models** | **Speech models** | **Transcription models** |
|---|---|---|---|
| **What it does** | Understands audio input and reasons over it, like a voice-native LLM | Converts text into lifelike spoken audio | Converts audio into text |
| **Input → Output** | Text/audio → text/audio | Text → audio | Audio → text |
| **Best for** | Voice agents, mixed-modality conversations, audio Q&A | Reading text aloud with built-in voices and streaming | Meeting notes, subtitles, feeding voice input into text pipelines |
| **Endpoint** | `/chat/completions` | `/audio/speech` | `/audio/transcriptions` |
| **Trade-offs** | More powerful but heavier and more expensive | Simpler, faster, cheaper (no reasoning needed) | Purpose-built for accuracy across languages and accents |
| **Browse models** | [Audio models](https://openrouter.ai/models?output_modalities=audio) | [Speech models](https://openrouter.ai/models?output_modalities=speech) | [Transcription models](https://openrouter.ai/models?output_modalities=transcription) |
| **Docs** | [Audio output guide](https://openrouter.ai/docs/guides/overview/multimodal/audio#audio-output) | [Speech docs](https://openrouter.ai/docs/features/multimodal/tts) | [Transcription docs](https://openrouter.ai/docs/guides/overview/multimodal/stt) |

## Try it in the Playground

Both Speech and Transcription have dedicated Playground tabs on model pages (here's [GPT-4o Mini TTS's Playground](https://openrouter.ai/openai/gpt-4o-mini-tts-2025-12-15/playground) and [GPT-4o Transcribe's Playground](https://openrouter.ai/openai/gpt-4o-transcribe/playground) as examples). For speech models, pick a voice from the dropdown, type your text, and hear the result. For transcription models, drag and drop an audio file and see the transcription.

Each model page also shows quickstart code in Python, TypeScript, curl, and the OpenRouter SDK, so you can copy a working example and have audio running in your app in minutes.

## Getting started with Speech models

Send text, get audio back. The response is a raw byte stream you can pipe straight to a file or audio player.

```bash
curl https://openrouter.ai/api/v1/audio/speech \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  --output output.mp3 \
  -d '{
    "model": "openai/gpt-4o-mini-tts-2025-12-15",
    "input": "Hello from OpenRouter.",
    "voice": "alloy",
    "response_format": "mp3"
  }'
```

Speech providers currently include **OpenAI** ([GPT-4o Mini TTS](https://openrouter.ai/openai/gpt-4o-mini-tts-2025-12-15)), **Google** ([Gemini Flash TTS](https://openrouter.ai/google/gemini-3.1-flash-tts-preview)), and **Mistral** ([Voxtral Mini TTS](https://openrouter.ai/mistralai/voxtral-mini-tts-2603)). Each model brings its own voice set, and you can browse available voices on each model's page. Output comes in MP3 or PCM format.

Provider-specific options pass through cleanly. For example, OpenAI's speech models accept an `instructions` field for tone control (e.g., "speak in a warm, friendly tone").

## Getting started with Transcription models

The transcription endpoint accepts audio in two formats: base64-encoded audio as JSON via the `input_audio` field, or as an OpenAI-style `multipart/form-data` file upload. It supports WAV, MP3, FLAC, and other common formats.

```bash
AUDIO_BASE64=$(base64 < recording.wav | tr -d '\n')

curl https://openrouter.ai/api/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/whisper-large-v3",
    "input_audio": {
      "data": "'"$AUDIO_BASE64"'",
      "format": "wav"
    }
  }'
```

Transcription providers currently include **OpenAI** ([Whisper](https://openrouter.ai/openai/whisper-large-v3), [GPT-4o Transcribe](https://openrouter.ai/openai/gpt-4o-transcribe), [GPT-4o Mini Transcribe](https://openrouter.ai/openai/gpt-4o-mini-transcribe)), **Google** ([Chirp 3](https://openrouter.ai/google/chirp-3)), and **Groq** (with their fast [Whisper](https://openrouter.ai/openai/whisper-large-v3) inference). You can optionally pass a `language` hint to improve accuracy for non-English audio.

## What's next

We're actively adding more providers and voices. If there's a speech or transcription model you want to see on OpenRouter, tell us on [Discord](https://discord.gg/openrouter).
