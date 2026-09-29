# Change Log

## 2026-09-28

- `send-batch` now suggests `openai/gpt-6-astra` as its example model. The previous example, `openai/gpt-5-mini`, has no batch endpoint, so copying it returned `Model 'openai/gpt-5-mini' does not have a :batch endpoint.`

## 2026-09-17

- New `send-batch`, `get-batch`, and `list-batches` tools over the Batch API. `send-batch` submits many requests for one model and endpoint (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`, or `/v1/embeddings`) as one asynchronous batch at batch pricing and returns the batch id. `get-batch` returns the batch's status, per-request completed/failed counts, the failure reason when it failed, and, once terminal, the inline results keyed by `custom_id`. `list-batches` lists the batches in your key's workspace newest first, optionally filtered by `status` (e.g. `validating` and `in_progress` for in-flight work) and paged with `limit` and `after`; list items carry status and counts but never inline results. `send-batch` accepts up to 1,000 requests and an 8 MB payload per call; larger batches go to `POST /api/v1/batches` directly. Completed requests are billed to your account.

## 2026-09-15

- `get-endpoint-uptime-history` now tells same-provider endpoints apart in its table. Routing no longer folds the service tier into a provider's display name (the model page shows a Fast / Priority / Flex badge instead), so a model served by both `openai` and `openai/fast` would have produced two identical `OpenAI` columns. Column headers and the failed-provider note now add the shortest qualifier that separates the rows — tier first (`OpenAI (Fast)`), then region (`Azure (US)`), then `ZDR`, then the provider slug tail — and a provider with a single endpoint keeps its plain name. Inputs are unchanged.

## 2026-09-12

- `send-message` now says when a response came back incomplete instead of returning an empty string with a usage line. When the model spends the whole `max_tokens` budget on reasoning, the result opens with `[incomplete: max_output_tokens. No message text was produced. Raise max_tokens or lower reasoning_effort and retry.]`, and the usage line gains a `reasoning tokens` count when the API reports one.

## 2026-07-31

- `spawn-ori-eval` and `install-ori-harness` are now also exposed as MCP
  prompts. Clients that turn prompts into slash commands (like Claude Code)
  now show them in the `/` menu — for example
  `/mcp__openrouter__spawn-ori-eval` — so you can invoke them explicitly
  instead of describing the task and hoping the assistant picks the tool.
  The existing tools are unchanged.

## 2026-07-30

- New `install-ori-harness` tool over MCP: give your agent the recipe to install Ori, sign in with OAuth, run an existing coding agent CLI through Ori, choose any OpenRouter model, upgrade with `ori update`, and verify the setup.

- **Breaking: `view-skills` is gone, replaced by a dedicated `spawn-ori-eval` tool.** Running an eval with Ori used to mean finding it as a skill nested inside `view-skills`, which assistants regularly missed. It is now a top-level tool in its own right: ask your assistant to compare models, measure whether your agent does the right thing, or find the best model for a task, and it can reach for `spawn-ori-eval` directly. The tool takes no arguments and returns the same recipe published at <https://openrouter.ai/skills/spawn-ori-eval>. If you hardcoded `view-skills` (e.g. in a Claude Code allowlist), switch it to `spawn-ori-eval`; assistants that discover tools dynamically need no changes.

## 2026-07-27

- `view-skills` now serves its first skill, `spawn-ori-eval`: how to run a model eval by handing it to Ori (`ori code -p`) so the eval is authored and graded on a pinned harness and model, instead of writing one yourself. List it with `view-skills` and read it with `view-skills` + `name: spawn-ori-eval`. It is the same document published at <https://openrouter.ai/skills/spawn-ori-eval>.

## 2026-07-26

- Pricing returned by `list-models`, `get-model`, and `list-model-endpoints` now clearly shows per-token costs as dollars per million tokens (for example, `$5/M tokens`), while request, image, and web-search costs identify their per-unit billing basis.

## 2026-07-23

- New `get-endpoint-uptime-history` tool: fetch the hourly uptime history (last 72 hours) of every provider endpoint serving a model — the same per-provider uptime timeline shown on each model page — optionally narrowed to a `from`/`to` window. Given "model X degraded during window Y", an assistant can now identify which provider's uptime dipped without leaving MCP.

## 2026-07-20

- `list-models` sorted by `design-arena-elo-high-to-low` now ranks on a model's Design Arena Code → "Web Dev" → "Overall" ELO (the site's default coding view) instead of its highest ELO across every Design Arena category. Image/video-only models (e.g. Riverflow, which only ranks in Graphic Design / Image) no longer surface at the top of the coding sort — they have no Code Overall ELO and are placed last, alongside models with no Design Arena score. No change to the tool's inputs.

## 2026-07-15

- New `transcribe-audio` tool: transcribe speech from an audio file to text. Point it at an audio URL (fetched server-side, up to 25 MB) or pass small clips as base64, optionally with a language hint; you get back the transcript with the cost and generation id. Find speech-to-text models via `list-models` with `output_modalities=transcription`. The transcription is billed to your account.
- New `generate-speech` tool: turn text into spoken audio, returned inline as an audio content block so clients that can play audio render it directly. Pass a model slug, the text, and a voice (each model's voices are listed under `supported_voices` in `get-model`), with optional format (mp3/pcm) and speed. The generation is billed to your account; look up its cost with `get-generation`.

## 2026-07-14

- The `send-feedback` tool now asks your assistant to include useful diagnostic context in its comment — which agent it is, the harness it runs in (CLI, desktop app, IDE extension, or server SDK), the model it meant to call, and what it expected versus what it got — so the OpenRouter team can act on reports without a back-and-forth. No change to the tool's inputs.

## 2026-07-10

- `send-message` can now bound a generation: set `reasoning_effort` (how hard a reasoning model thinks, from `minimal` up to `max`), cap `max_tokens`, or set a `timeout_ms` to abort locally — so a reasoning model that would otherwise think unbounded on a hard prompt can be reined in for cost, latency, or comparison runs. A timeout returns a clear `client_timeout` error with the elapsed time.
- New `list-presets` and `get-preset` tools: your saved presets (the named model + system prompt + settings bundles you create in the OpenRouter dashboard) are now visible to your assistant — list them to see what you have, or fetch one by slug to inspect the exact model, prompt, and settings it uses
- Internal: feedback submitted through the `send-feedback` tool is now tagged with a `[Via MCP]` prefix in the stored feedback body, so MCP-sourced feedback is distinguishable from web-submitted feedback in the Feedback Slack channel and the database. No change to the tool's inputs or behavior.

## 2026-07-09

- **Breaking: all tools renamed to a consistent `verb-noun` format.** Every tool now leads with the action it performs, so they read as commands and sort together by verb. If you hardcoded a tool name (e.g. in a Claude Code allowlist or a script), update it: `models-list`→`list-models`, `model-get`→`get-model`, `model-endpoints`→`list-model-endpoints`, `providers-list`→`list-providers`, `credits-get`→`get-credits`, `generation-get`→`get-generation`, `app-rankings`→`list-app-rankings`, `rankings-daily`→`list-daily-model-rankings`, `benchmarks`→`list-benchmarks`, `task-classifications`→`list-task-classifications`, `chat-send`→`send-message`, `docs-search`→`search-docs`, `view-skill`→`view-skills`. Assistants that discover tools dynamically (the normal case) need no changes.
- New `generate-image` tool: generate an image from a text prompt and get it back inline as an image content block, so clients that render images (like Claude Desktop) display it directly and the model can see the result. Pass a model slug and prompt (and an optional size like `2K`, `4K`, or `1024x1024`); the generation is billed to your account.
- New `send-feedback` tool: report a problem with a specific generation your key made — pick a category (latency, incoherence, incorrect response, formatting, billing, API error, or other) and add an optional comment, and it goes straight to the OpenRouter team. Pass the generation id that `get-generation` or `send-message` returns; you can only leave feedback on your own generations.
- Internal: `ping` keepalives (which MCP clients send on a timer) and `notifications/*` protocol messages are no longer counted in the MCP Datadog analytics — they were massively inflating request/method counts and per-key log widgets without carrying signal. The dashboard's top-line "Total Requests" is now based on ping-excluded JSON-RPC requests. Also dropped dead `resources/*` and `prompts/*` entries from the method allowlist (the server registers no resources or prompts). The `ping` health-check tool is still tracked. No change to the MCP tools themselves.

## 2026-07-07

- `docs-search` now runs on Mintlify's own documentation search — the same engine that powers search on the OpenRouter docs site — so results are ranked more relevantly than the previous keyword match, while the tool works exactly as before (ask a "how do I…" question, get back ranked doc sections)
- `rankings-daily` can now slice model rankings by time grain (`day`/`week`/`month`), modality (text, image, audio, image output, tool calling), context-length bucket, use-case category, or natural vs. programming language — so "which models are trending for programming" or "top models for long-context work" is a single filtered call instead of client-side guesswork (category and language slices are sampled weekly estimates)
- `models-list` now surfaces its newer filters and sorts to your assistant: filter by completion (output) price, model age, Artificial Analysis intelligence / coding / agentic index ranges, and tool-calling success rate, and sort by coding, agentic, or intelligence index or Design Arena ELO — so "find me a cheap model that's good at coding" narrows the catalog server-side instead of pulling everything and guessing
- The read-only tools (model and provider lookups, rankings, benchmarks, credit balance, and the rest) are now correctly labeled as read-only and repeatable, so MCP clients that auto-approve safe lookups no longer prompt for confirmation on every call
- The Quickstart and the openrouter.ai/agents setup guide now point developers to the MCP server, so it's easier to discover while building
- Internal: consolidated the two MCP authoring guides into one `add-mcp-tool` agent skill — Part A covers generated (Speakeasy) tools, Part B covers bundled skills served by `view-skill`. Replaces the old `regen-mcp-toolset` skill. No change to the MCP tools themselves.

## 2026-07-06

- New `task-classifications` tool: see what OpenRouter traffic is actually used for, broken down by task type (code generation, web search, summarization, and more) over the trailing week, with the top models for each task and higher-level Code / Data / Agent / General category totals — useful for grounding "which model is popular for this kind of work" in real usage instead of guesswork

## 2026-06-23

- Fixed the app authorization page so you can now switch the account before approving — picking one of your organizations actually takes effect, instead of the choice being silently ignored and the key always landing on your personal account
- `chat-send` can now pin which provider serves a request — useful for running evals or reproducing a result, where you need the same provider every time instead of letting the router pick
- You can now sort the model list by quality, not just price and speed — rank models by their Artificial Analysis intelligence score or by their best Design Arena standing to surface the top models for a task in a single call

## 2026-06-22

- `chat-send` no longer recommends outdated models from memory — when you ask which model is best for a task, it now points you to live data (benchmarks and rankings) instead of naming models that may have been retired
- The MCP server now answers at openrouter.ai/mcp directly, with its health check moved to openrouter.ai/mcp/health, matching how other MCP servers are addressed

## 2026-06-19

- Connecting an MCP client now works smoothly from the start — fixed a registration error that some clients hit when first connecting
- Keys created by connecting an MCP client are now labeled "OpenRouter MCP: <app name>" so they're easy to spot in your dashboard, and the approval screen now clearly frames the connection as an OpenRouter MCP integration

## 2026-06-18

- Fixed the benchmarks tools, which had stopped working after the underlying benchmarks data moved to a single combined endpoint — model quality comparisons (Artificial Analysis scores and Design Arena standings) work again through one `benchmarks` tool that takes a source

## 2026-06-12

- Model search now covers everything: search by name, set a price range, require a minimum context size, pick a model family (like Claude or Llama), a specific author or hosting provider, or restrict to zero-data-retention and EU-hosted options — all server-side in one call
- Model search got sharper: filter the catalog by use case (like programming or translation), by output type (text, image, audio), or by supported features — combined with sorting, agents can find the right model in one call
- Keys created by connecting an app now always expire after 7 days, so a leaked key can't be abused long-term — the consent page says this plainly instead of offering an expiration picker
- New tool: compare models on Artificial Analysis benchmark scores (intelligence, coding, and agentic indexes) with `benchmarks-artificial-analysis` — the toolset is now 14
- Model details and listings now include Artificial Analysis scores alongside Design Arena rankings, so you can weigh quality from two independent sources
- `model-get` now returns live data — single-model lookups work end to end

## 2026-06-11

- New key authorizations are pre-filled with safer defaults: a $10 monthly spending limit and a 7-day key lifetime, both editable before approving
- The authorization page now warns you when a request comes from an app running on your own computer, since OpenRouter can't verify which local app will receive access
- Three new tools: look up a single model's full details (`model-get`), see which apps drive the most OpenRouter traffic (`app-rankings`), and compare model quality on Design Arena benchmarks (`benchmarks-design-arena`)
- Model listings can now be sorted server-side (by price, popularity, context length, and more) and include Design Arena benchmark scores
- Every `chat-send` reply now includes its generation id, so you can immediately look up the cost, latency, and serving provider of that exact call
- `chat-send` now explains model variant shortcuts in its description — add `:online` to any model name for web search, `:nitro` for speed, `:floor` for lowest price
- `chat-send` now runs on the Responses API, OpenRouter's newest chat surface
- Discovery now also works for clients that probe the standard well-known URLs directly, not just those that follow the 401 challenge

## 2026-06-10

- The MCP server now lives at openrouter.ai/mcp instead of a separate subdomain, so it shares the main site's address
