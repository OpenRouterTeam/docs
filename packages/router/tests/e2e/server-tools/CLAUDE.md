# Deterministic server-tool tests

Full-stack tests for **every** OpenRouter server tool, on **every skin**, that
are **hermetic** (no network, no containers, no service bindings) and
**model-free** (no LLM decides anything). A live-model suite can only assert
`content.length > 0` and therefore cannot fail on a real regression; these
tests exist to fail on one.

Coverage is complete and enforced: `coverage.test.ts` fails CI if a newly
registered tool has neither a test file nor an explicitly-reasoned exclusion, and
the exclusion list is currently **empty**.

## How it works

```text
request → [skin] → [plugin stack] → [agent loop] → [tool execute]
             ^           ^                ^               ^
           REAL        REAL         SCRIPTED         REAL, with the
                                   (sdk-script)      HTTP hop recorded
```

Only the outermost edges are substituted:

- **The agent loop.** `ServerToolsPlugin` consumes
  `callModel(...).getFullResponsesStream()`. Tests replace that with a scripted
  event sequence, so which tool is called — and with what arguments — is fixed.
- **The network.** `installHermeticFetch()` serves recorded fixtures and
  **throws on any unrecorded URL**, so a new outbound call fails the suite
  instead of silently reaching the internet from CI. `globalThis.fetch` is the
  only egress primitive under `plugins/server-tools/**` — no `WebSocket`, no
  `http(s).request`, no `net.connect`, no gRPC transport (the `undici`/`axios`
  strings there are user-agent labels in `server-tool-metrics.ts`, not clients).
  A tool that adds a non-`fetch` egress path would slip past this guard, so keep
  outbound calls on `fetch`.
- **Host-injected providers.** Several tools never touch `fetch`; they call a
  closure the host worker puts on shared context. Those are stubbed in
  `harness/providers.ts`:

  | Tool | Seam | Stub |
  | --- | --- | --- |
  | `bash`, `shell` | `_sandbox` | `stubSandbox()` |
  | `files` | `_filesProvider` | `stubFiles()` |
  | `image_generation` | `_imageApiFetcher` | `stubImageApi()` |
  | `fusion` | `_fusionService` | `stubFusionService()` |
  | `search_models` | `local._models` | `stubModels()` |
  | `advisor`/`subagent` | inner `/responses` | `recordedInnerResponses()` |

Everything else is production code: the skin, the plugin stack, the event mapper,
and each tool's real `execute` (including its engine client and result parsing).

## Three tool execution shapes

The harness reproduces what the SDK does for each, so all three are testable
through one path:

| Shape | Tools | How the result is produced |
| --- | --- | --- |
| Plain execute | most | `execute()` returns the result |
| Human-in-the-loop | `apply_patch` | `onToolCalled()`: failure or `null` |
| Async generator | `fusion` | yields progress; **last yield** is result |

The generator case is a trap worth remembering: fusion delivers its result as a
final `yield`, not as the generator's `return`, so draining and reading the
completion value gives `undefined`.

## Running them

```bash
cd packages/router
bun run test tests/e2e/server-tools/
```

On a fresh checkout/worktree every file fails with
`Cannot find module '@openrouter-monorepo/chat-templates'` — that package
needs its dist built once: `cd packages/chat-templates && bun run build`.

**Always run via `bun run test`.** These tests use `mock.module` to replace
`@openrouter/agent/call-model`, and bun's module mocks are *process-global*.
`bun run test` is `scripts/bun-test-sharded.ts`, which runs every file that
installs a module mock in its own process (`--parallel`) and shares a process
only between files that do not, so the mocks stay isolated. Running a bare
`bun test` across many files in one process makes mocks leak between files and
produces confusing cross-file failures — this is the exact hazard the
`openrouter/no-module-mocks` lint rule warns about.

CI gets the same isolation: `scripts/ci/run-unit-tests.ts` runs `packages/router`
with `bun run test`.

The `mock.module` use is justified per-file: the plugin reaches the agent loop
through a *dynamic* `import()`, so there is no parameter or `setX` seam to inject
through. If a DI seam is ever added to `ServerToolsPlugin`, switch to it and drop
the disables.

## Adding a tool

1. Create `<tool-name>.test.ts` (hyphenated, e.g. `web-fetch.test.ts`).
2. Install the determinism contract:

   ```ts
   beforeAll(() => { setSystemTime(FIXED_NOW); });
   afterAll(() => { setSystemTime(); });
   const resetIds = installDeterministicIds();
   beforeEach(() => { resetIds(); installHermeticFetch(backends); });
   ```

3. Script the loop with `buildExecutingSdkScript`, which runs the tool's **real**
   `execute` and feeds the true result back — that is what makes the test cover
   the tool rather than just the event mapper. Use `buildSdkScript` +
   `toolResult(...)` only when deliberately pinning a fixed payload.
4. Sweep the skins with `runServerToolRequest({ skin, stream, tools })`. Assert
   exact text with `extractAssistantText` **and** execution with
   `expectToolExecuted` (plus `expectToolInvoked` on Responses).
5. Hold the script state in `createScriptState()` and call `state.reset()` in
   `beforeEach`, or a test can observe a prior test's script. Do **not** re-declare
   `activeScript` / `lastCallModelArgs` by hand — the reset invariant lives in
   `scaffold.ts` so that no per-file copy can drift from it and leak state.
6. Remove the tool's entry from `COVERAGE_EXCLUSIONS` in `coverage.test.ts`.

Use provider-safe tool names in scripts (`openrouter_web_search`), not the
canonical colon form — that is what the SDK sees.

### What the harness does not do

Three deliberate gaps, so you don't assume coverage you don't have:

- **Scripted `args` are not validated against the tool's `inputSchema`.**
  `executeScriptedTool` calls `execute` / `onToolCalled` directly, skipping the
  SDK's validation step, so args production would reject still run here. Scripted
  args can drift from the schema silently — assert on the tool's *output*, or unit
  test the schema beside the tool.
- **`setContext` / `setSharedContext` are inert no-ops.** A tool that writes
  context and later reads it back — or whose next call in a multi-turn script
  depends on that write — behaves differently here than in production. Pre-seed
  what the tool needs via `sharedContextOverrides` instead.
- **Only the Responses skin's REQUEST transformer runs.** The harness runs
  `transformResponsesRequestToChatCompletions` exactly as the worker route
  does (`prepareSkinRequest`), so Responses request-side normalization — the
  native `shell` shim, namespace flattening, `local_shell` rejection, the
  `_skin` tag — is under test. The messages skin's request transformer is NOT
  run; its `_skin` tag is fabricated (`SKIN_REQUEST_TAG`), so a messages-skin
  regression in request-side tool normalization is invisible here. The
  chat-completions and completions bodies need no transformer. Response-side
  serializers are real on all four skins.

## Assertion standards

Three rules, all learned from mutation-testing this suite:

- **Assert exact values, not shapes.** `expect(text).toBe(...)`, not
  `expect(text.length).toBeGreaterThan(0)`. The clock and ids are pinned, so exact
  assertions are available — and a length check cannot distinguish a correct
  answer from a wrong one.
- **Never assert scripted text alone.** The final message comes from the script,
  so it comes back whether or not the tool ran. Every case must *also* assert a
  tool side-effect via `expectToolExecuted` — otherwise a mutation that drops
  every matched tool still leaves the test green.
- **Assert the tool actually ran, structurally.** `expectToolInvoked` (Responses)
  requires a *completed* output item; `expectToolExecuted` (all skins) reads
  usage accounting and falls back to per-skin evidence. Neither works for
  failure-path tests (a failed subagent/advisor task terminates its item with
  `status: 'failed'`, never `completed`) — there, assert the failed item itself
  as the structural evidence, paired with the exact scripted text. Both are deliberately
  structural rather than substring scans of the serialized response: a substring
  also matches the echoed request `tools[]` array, so it stays green even when the
  tool never executes. That false negative was found by mutation testing and is
  the single most important thing not to regress here.

### Per-skin execution evidence

`expectToolExecuted` exists because no single signal is present on all four
skins:

| Skin | Evidence used |
| --- | --- |
| chat-completions (both) | `usage.server_tool_use_details` |
| completions, streaming | `usage.server_tool_use_details` |
| completions, non-streaming | `usage.server_tool_use` (see gap below) |
| messages (both) | `usage.server_tool_use` `tool_calls_*` counts + `server_tool_use` content block |
| responses | completed `openrouter:*` output item |

The messages skin never emits `server_tool_use_details`; its
`usage.server_tool_use` extends the Anthropic shape (`web_search_requests` /
`web_fetch_requests`) with the generic `tool_calls_*` counters as OpenRouter
extensions, on both the streaming (`message_delta`) and non-streaming paths.
A bucket carrying no `tool_calls_*` counts (a pure web-search turn) is still
skipped by `readServerToolUsage` rather than treated as a zero count. Named
execution evidence on both messages paths remains the `server_tool_use`
content block, since the usage counts are anonymous.

## Multimodal tests need an opt-in endpoint

The default mock endpoint is text-only, non-multipart, and has a 3k context
window, so the request-only plugin chain destroys attached media **before** the
plugin stack under test ever sees it:

- `file-parser` strips every `image_url` part when the endpoint's model does not
  declare `InputModality.Image` (`plugins/file-parser/index.ts:409` →
  `capImagesInMessages(messages, 0)`).
- `context-compression` auto-enables at or below `MIDDLE_OUT_MAX_CONTEXT_LENGTH`
  (8192, `plugins/context-compression/index.ts:98`) and middle-out replaces each
  message's content with a truncated **string**
  (`adapters/base/middle-out.ts:170-191`), dropping every non-text part.

A test that supplies an attachment on the default endpoint and asserts a
multimodal behaviour therefore gets a green check for an assertion that never
ran. `runServerToolRequest` guards against this: it calls
`assertMediaSurvivesEndpoint` (`harness/assert-media-survives.ts`) after the
skin transform and after the endpoint resolves, and throws with both mechanisms
named if the resolved endpoint would destroy the media.

Opt in with the shared preset:

```ts
import { multimodalEndpoint } from './harness/assert-media-survives';

await runServerToolRequest({
  skin: ServerToolSkin.ChatCompletions,
  stream: true,
  tools: [...],
  extraRequestFields: { messages: messagesWithAnAttachment() },
  endpointOverrides: multimodalEndpoint(),
});
```

The guard inspects only `messages`. Media travelling an internal side channel is
not reachable by either plugin and is correctly not guarded — e.g.
`subagent.test.ts`'s DEV-839 replay image, which rides `_subagentReplays`
(harvested by the Responses fold,
`skins/openai-responses/request-transformers/index.ts:337`) rather than the
message array.

## Product gaps this suite documents

Two inconsistencies were found while writing these tests. Both are asserted as
current behaviour so the tests act as tripwires — when either is fixed, the
assertion fails and names the line to update.

1. **Non-streaming `completions` leaks the internal usage key.** It emits
   `usage.server_tool_use` instead of the public `server_tool_use_details`,
   because that path does not run `toChatWireUsage`
   (`skins/openai-chat-completions/from-internal-stream/to-chat-wire-usage.ts`).
2. **Engine failures surface as `completed` on the Responses skin.** The
   web-search stream format marks an item `failed` only when the internal event
   carries `resultStatus: 'failed'`, which today only the Anthropic *native* path
   sets (`adapters/anthropic-message/web-search-event.ts`). An OpenRouter-engine
   failure returns `{ status: 'error' }` from the tool and still reaches the
   client as `completed` with no error field.

## Verifying a new test can fail

A passing test proves nothing on its own. Break the behaviour under test and
confirm the failure, e.g.:

```bash
# make the tool ignore its timezone parameter, then expect failures
#   datetime-tool.ts:  if (!params.timezone) {  →  if (true) {
```

Mutations worth trying, one per tool plus cross-cutting; each must fail at
least one test:

- Drop the server-tool-call event (`map-sdk-events-handlers.ts`)
- `shell` joins commands instead of running each (`shell-tool.ts`)
- Drop every matched tool (`find-matching-server-tools.ts`)
- `files` ignores the requested operation (`files-tool.ts`)
- Ignore `parameters.timezone` (`datetime-tool.ts`)
- `search_models` skips filtering (`search-models-tool.ts`)
- `web_fetch` hard-codes its engine (`web-fetch-tool.ts`)
- `web_search` hard-codes its engine (`web-search-tool.ts`)
- `apply_patch` skips V4A validation (`apply-patch-tool.ts`)
- `bash` stops joining commands (`sandbox.ts`)
- `advisor` drops the prompt (`execute-advisor.ts`)
- `subagent` drops the task description (`execute-subagent.ts`)
- `image_generation` hard-codes the model (`execute-image-generation.ts`)
- BUG_0001 shorthand early-exit (`normalize-server-tool-shorthands.ts`)
