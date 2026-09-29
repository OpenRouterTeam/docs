# Evals

Dataset evaluation utilities for OpenRouter. Defines test templates, validators, and baseline requirements used by `packages/provider-monitors` to gate endpoint visibility and by `services/gcp-bench-worker` to run benchmarks.

## Architecture

```mermaid
graph TD
    PM["packages/provider-monitors"] --> Templates["Templates\nbaseline + capability test definitions"]
    Bench["services/gcp-bench-worker"] --> Templates
    Templates --> Configs["configs.ts\n30+ test templates with request\nbuilders and response validators"]
    Templates --> Requirements["requirements.ts\nmodel capability to template mapping\nreasoning-effort baseline gating"]
    Templates --> Grouping["grouping.ts\ntemplate to group classification"]
    Validators["validators.ts\nnone, answer_extract, llm_judge"] --> Configs
    LLMJudge["llm-judge.ts\nLLM-as-judge scoring via\nOpenRouter API"] --> Validators
    Templates --> EmbeddingsConfigs["embeddings-configs.ts\nembedding test templates"]
    Templates --> RerankConfigs["rerank-configs.ts\nrerank test templates"]
    Templates --> ImageConfigs["image-generation-configs.ts\nimage generation baseline templates"]
    Templates --> VideoConfigs["video-generation-configs.ts\nvideo + image-to-video templates"]
```

## Key Modules

| Path                        | Purpose                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `templates/configs.ts`      | 30+ test template definitions — each pairs a request builder with a response validator (vision, tool calls, reasoning, audio, video, etc.)                                                                                                                                |
| `templates/requirements.ts` | Maps model capabilities (modalities, reasoning-effort support) to required baseline templates; generates per-effort reasoning-effort templates that gate auto-unhide. Image generation baseline templates are capability-gated per endpoint (e.g. streaming, image input) |
| `templates/grouping.ts`     | Classifies templates into groups (Basic, InputImage, ReasoningEnabled, OutputAudio, etc.) for organized test reporting                                                                                                                                                    |
| `validators.ts`             | Validator registry — `None` (always pass), `AnswerExtract` (regex match), `LlmJudge` (LLM-scored)                                                                                                                                                                         |
| `llm-judge.ts`              | Sends a judge prompt to the OpenRouter API and parses a 0-1 score with retry and backoff                                                                                                                                                                                  |
| `templates/video-generation-configs.ts` | Video generation test templates, including image-to-video variants that seed a first frame from either an image URL or an inline base64 image                                                                                                                            |
| `types.ts`                  | Shared types — `DatasetRow`, `TestResult`, `TestStatus`, multimodal request unions                                                                                                                                                                                        |

## Commands

| Command             | Description          |
| ------------------- | -------------------- |
| `bun test`          | Run unit tests       |
| `bun run typecheck` | Type-check with tsgo |
