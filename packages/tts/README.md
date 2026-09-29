# TTS

Text-to-speech adapter layer. Routes speech synthesis requests to provider-specific adapters (OpenAI, ElevenLabs, Google, xAI/Grok, etc.), normalizes request/response formats, and handles audio format negotiation.

## Architecture

```mermaid
graph LR
    Request["Speech Request"] --> Submit["lifecycle/submit.ts\nSubmit + request flow"]
    Submit --> Factory["adapter-factory.ts\nSelect adapter"]
    Factory --> Adapters["Provider Adapters\nOpenAI · ElevenLabs · Google · MiniMax\nxAI · Azure SSML · Deepgram · ..."]
    Adapters --> Audio["Audio Response\nmp3 · opus · wav · flac · pcm"]
    Adapters --> Together["Together TTS\nKokoro · Orpheus · Cartesia\nheader-first code-point billing"]
    Schemas["schemas\nrequest · response"] --> Submit
    Routing["routing/steps.ts\nendpoint selection"] --> Submit
    Context["lifecycle/context.ts\nrequest context"] --> Submit
    Capabilities["lifecycle/capabilities.ts\nper-request capabilities"] --> Submit
```

## Key Modules

| Path | Purpose |
|------|---------|
| `app.ts` | Hono application setup |
| `lifecycle/submit.ts` | Request handling flow (`submitTTS`) |
| `lifecycle/context.ts` | Per-request context and shared lifecycle types |
| `lifecycle/capabilities.ts` | Per-request capabilities (billing, rate limiting, recording) |
| `lifecycle/guards.ts` | Content-filter, moderation, and estimated-cost authorization implementations |
| `lifecycle/definition.ts` | Executable catalog: fourteen feature decisions and ordered request/model/endpoint guards |
| `lifecycle/resolve.ts` | Model and endpoint resolution |
| `lifecycle/invoke.ts` | Provider invocation and adapter construction |
| `lifecycle/finalize.ts` | Stream finalization and billing handoff |
| `adapters/` | Per-provider TTS adapters; the Deepgram adapter maps voices to per-voice models and supports `mip_opt_out` |
| `schemas/request/` | Request validation schemas |
| `schemas/response/` | Response format schemas |
| `routing/steps.ts` | Endpoint selection and routing |

## Commands

| Command | Description |
|---------|-------------|
| `bun test` | Run unit tests |
