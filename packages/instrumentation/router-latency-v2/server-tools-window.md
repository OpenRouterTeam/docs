# Router latency window for server-tool user requests

A user request with server tools enabled never builds an adapter. The server-tools plugin runs the agent loop and sends each model turn as a recursive agent-loop call (`POST /api/v1/responses` with `x-openrouter-server-tool-call: agent_loop`). That call is its own router request with its own recorder and window, so the provider time it spends is measured there, not here.

## Window

- Start: route start, the same `RouterLatencyV2Recorder` start as every other request.
- First dispatch: the moment the agent loop sends its first agent-loop call. `trackAgentLoopFetch` in `agent-loop-tracker.ts` marks it, so `routerLatencyV2Ms` covers auth, body read, credit authorization, model selection and server-tool matching.
- Completion: the last byte to the client (`router.lastByteToClientAtMs`), computed when `logTxAttempt` runs for the user request with no attempted endpoint. It is null when the client never read the last byte. `postDispatchMs` then covers our time after the first agent-loop call: orchestration between turns and stream processing.

## Excluded time

- `agent_loop`: each agent-loop call, from dispatch until its response body settles (read to the end, cancelled, or errored). This covers the HTTP hop and the whole recursive request.
- `tools`:
  - each tool execution, from the agent SDK's `PreToolUse` hook to `PostToolUse` or `PostToolUseFailure` (`buildToolLatencyHooks` in the router's server-tools plugin).
  - a subagent resume, which re-runs suspended subagents before the first agent-loop call (`orchestrateSubagentResume` in `subagent/resume-orchestrator.ts`).

Excluded intervals overlap freely; the computation merges them, so a tool that also records its own `tools` interval through `measureExcludedWith` is not counted twice.

## Tags

Metrics for these requests carry `server_tools_root:true`. The request has no attempted endpoint, so endpoint and adapter tags (`byok`, `has_free_model`, output modality, prompt cache, meta router, prompt media count) are `unknown`.
