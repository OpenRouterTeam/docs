# Smart Routing Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream visible answers and routing progress for all five Demo Hub smart routers while preserving final decisions, captures, and history.

**Architecture:** The existing Mission Control route serves a normalized SSE contract when the client requests it and retains its JSON path for other callers. The server validates and folds OpenRouter Chat Completions chunks into a final `DemoEnvelope`; a client run owner publishes incremental text and handles cancellation. The UI keeps one answer panel visible through completion and shows final metadata in the existing decision and inspection views.

**Tech Stack:** Next.js 16 route handlers, React, TanStack Query, Zod, OpenRouter Chat Completions SSE, `@openrouter-monorepo/network/sse`, Bun tests.

## Global Constraints

The branch is `codex/smart-routing-streaming`, based on PR #48763 at `b553dea89ec81134352a77c566f5b76bd0aa1c87`; create the PR against `codex/demohub-jev-router`.

The approved design is `docs/superpowers/specs/2026-10-01-smart-routing-streaming-design.md`. Read Mission Control, frontend, data-layer, and Next.js route-handler guidance before editing.

Cover Auto, Auto Beta, Jev, Pareto, and Switchyard. Show live answer text, provide Stop, retain partial text after stop/failure, and never invent missing model, provider, routing metadata, usage, or cost.

Preserve the internal-admin gate, Zod request validation, fixed-host internal egress, context shaping, prompt-logging policy, and 90-second upstream timeout. Keep credentials out of streamed events and captures. Cancel unread response bodies.

Use Result values for failures, explicit return types, narrow Zod schemas for external data, design-system UI primitives, and structured scalar logging. Run the HIPAA, access-security, and data-trust review skills before the PR.

Write meaningful tests for new behavior. Run scoped tests from `projects/mission-control`, `bun run format`, `bun run typecheck`, and `bun run verify` before pushing. Run tests again after each push. Add commits without amending pushed history.

## File Structure

`projects/mission-control/app/admin-utils/demo-hub/lib/openrouter.ts` gains a Chat Completions stream method using the existing authentication and egress path.

`projects/mission-control/app/admin-utils/demo-hub/lib/smart-routing-stream-events.ts` owns the Zod schema and types for the normalized browser-facing events. `lib/read-smart-routing-stream.ts` owns browser SSE parsing. `lib/smart-routing-stream-state.ts` owns the pure event reducer.

`projects/mission-control/app/api/demo-hub/demos/smart-routing/run/smart-routing-stream-accumulator.ts` parses and folds upstream chunks. `build-smart-routing-envelope.ts` owns the existing final envelope derivation for both JSON and stream paths. `run-smart-routing-stream.ts` runs one upstream stream and emits normalized events. `create-smart-routing-stream-response.ts` owns backpressure and disconnect behavior. `route.ts` selects SSE or JSON after the existing guard and request validation.

`projects/mission-control/app/admin-utils/demo-hub/demos/smart-routing-queries.ts` owns the query key, mutation, cancellation, and rAF publication. `demos/SmartRoutingLiveResult.tsx` owns the phase and answer panel. `demos/smart-routing.tsx` wires controls, live output, and final decision/history. `components/RequestResponseViewer.tsx` gets an optional prop to suppress its duplicate assistant text in this demo only.

The shared event shape is:

```typescript
type SmartRoutingStreamEvent =
  | { type: 'run.started'; router: RouterKind; requestedModel: string; scenarioLabel: string }
  | { type: 'route.resolved'; model: string; provider: string | null }
  | { type: 'text.delta'; text: string }
  | { type: 'run.completed'; envelope: DemoEnvelope; captureWarning?: string }
  | { type: 'run.failed'; message: string };
```

The server accumulator returns `AsyncResult<AssembledSmartRoutingResponse, SmartRoutingStreamFailure>` and calls an asynchronous progress callback for `route.resolved` and `text.delta`; its assembled response contains only validated upstream fields. A missing provider, usage, or metadata field remains missing or null. The client run state stores `status`, accumulated `text`, requested and resolved model identities, optional final envelope, and optional failure message.

## Task 1: Validate and Accumulate Upstream Chat Chunks

**Files:** Modify `projects/mission-control/app/admin-utils/demo-hub/lib/openrouter.ts`; create `projects/mission-control/app/api/demo-hub/demos/smart-routing/run/smart-routing-stream-accumulator.ts` and its `.test.ts`.

**Interfaces:** `openrouter.chatCompletionStream(body: ChatCompletionRequest, extraHeaders: Record<string, string>, opts: { apiKey?: string; signal: AbortSignal }): Promise<Response>`. `readSmartRoutingChunks(response: Response, onProgress: (event: { type: 'route.resolved'; model: string; provider: string | null } | { type: 'text.delta'; text: string }) => Promise<void>): AsyncResult<AssembledSmartRoutingResponse, SmartRoutingStreamFailure>`. The assembled response exposes `id`, `model`, `provider`, `choices[0].message.content`, `choices[0].finish_reason`, optional `usage`, and optional `openrouter_metadata`.

- [ ] **Step 1: Write failing tests.** Use a controlled `ReadableStream` with split UTF-8 and SSE frame boundaries. Assert `route.resolved` after the first valid model/provider chunk, `text.delta` before `[DONE]`, and final content, ID, finish reason, usage, and metadata after `[DONE]`. Parameterize missing metadata, error chunk, malformed chunk, premature EOF, and abort; a failed stream must not return a completed response.
- [ ] **Step 2: Run the focused test to see the missing implementation fail.** Run `bun test ./app/api/demo-hub/demos/smart-routing/run/smart-routing-stream-accumulator.test.ts` from `projects/mission-control`; expect missing exports or failing assertions.
- [ ] **Step 3: Implement the upstream method and accumulator.** POST the existing request with `stream: true`, `Accept: text/event-stream`, `X-OpenRouter-Metadata: enabled`, and the existing fixed-host credentials. Parse each `data:` event with `SSEDeserializer` and a local Zod chunk/error union; ignore comment heartbeats, require `[DONE]`, append only validated assistant text, and keep the last reported model/provider, usage, and metadata. Do not emit `route.resolved` for OpenRouter's placeholder model value `unknown`. Cancel and release the reader in `finally`.
- [ ] **Step 4: Run the focused test.** Expect all valid and failure cases to pass; add a test of the new OpenRouter method's URL, headers, and `stream: true` body in `lib/openrouter.test.ts` using its existing fetch seam.
- [ ] **Step 5: Commit.** Stage only this task's files and use `feat: parse smart routing completion streams`.

## Task 2: Serve a Backpressured Demo SSE Run

**Files:** Create `projects/mission-control/app/admin-utils/demo-hub/lib/smart-routing-stream-events.ts`; create `projects/mission-control/app/api/demo-hub/demos/smart-routing/run/build-smart-routing-envelope.ts`, `run-smart-routing-stream.ts`, `create-smart-routing-stream-response.ts`, and colocated tests; modify `route.ts`.

**Interfaces:** The event schema is a discriminated union with `run.started` (`router`, `requestedModel`, `scenarioLabel`), `route.resolved` (`model`, `provider`), `text.delta` (`text`), `run.completed` (`envelope`, optional `captureWarning`), and `run.failed` (`message`). `buildSmartRoutingEnvelope` takes the validated request, shaped outbound request, response, status, duration, and requested model and returns `DemoEnvelope` using the existing router metadata extractors. `createSmartRoutingStreamResponse` accepts request and deadline signals plus injected upstream/capture functions and returns a `Response`.

- [ ] **Step 1: Add event and envelope tests.** Validate every event variant with Zod. For each router, feed its final metadata into `buildSmartRoutingEnvelope` and assert the existing decision fields, notes, usage, and error verdict; preserve unknowns where metadata is absent. Compare a JSON-path fixture to the stream-path assembled equivalent.
- [ ] **Step 2: Run the focused tests and confirm they fail.** Run `bun test ./app/admin-utils/demo-hub/lib/smart-routing-stream-events.test.ts ./app/api/demo-hub/demos/smart-routing/run/build-smart-routing-envelope.test.ts` from `projects/mission-control`.
- [ ] **Step 3: Extract the shared envelope builder and define event schemas.** Move existing route derivation into the helper without changing the JSON output. Define the five event variants with minimal Zod fields and one exported `SmartRoutingStreamEvent` type.
- [ ] **Step 4: Add transport tests.** Assert `run.started` is readable before upstream inference completes, downstream reads govern writes, a final metadata chunk yields `run.completed` after one capture, capture failure yields `captureWarning` without losing the answer, and disconnect/timeout abort upstream. Assert an upstream HTTP error becomes `run.failed` and its unread body is cancelled.
- [ ] **Step 5: Implement the stream runner and response wrapper.** Reuse the server tools demo's `TransformStream` pattern for backpressure. Combine request, cancellation, and 90-second deadline signals; emit one terminal event; cancel upstream on disconnect; mark network, malformed-stream, and incomplete-stream failures without a success capture.
- [ ] **Step 6: Add route content negotiation.** Keep authorization and Zod parsing before either branch. Return the SSE response only when `Accept` contains `text/event-stream`; otherwise use the existing JSON call and shared envelope builder. Set SSE `Content-Type: text/event-stream; charset=utf-8` and `Cache-Control: no-store`.
- [ ] **Step 7: Run the focused route and transport tests and commit.** Run `bun test ./app/api/demo-hub/demos/smart-routing/run` from `projects/mission-control`; expect all cases to pass. Commit as `feat: stream smart routing demo runs`.

## Task 3: Read and Own Client Stream State

**Files:** Create `projects/mission-control/app/admin-utils/demo-hub/lib/read-smart-routing-stream.ts`, `smart-routing-stream-state.ts`, their `.test.ts` files, and `projects/mission-control/app/admin-utils/demo-hub/demos/smart-routing-queries.ts` with a focused DOM/hook test.

**Interfaces:** `readSmartRoutingStream({ request, headers, signal, onEvent, fetcher? }): AsyncResult<void, { status: number; message: string }>` accepts the existing smart routing request body and validates every normalized event. `reduceSmartRoutingStreamEvent(state, event): SmartRoutingStreamState` is pure. `useRunSmartRoutingDemo({ instanceId, headers })` exposes `mutate`, `stop`, and pending state while publishing one `SmartRoutingStreamState` through a canonical query key.

- [ ] **Step 1: Add failing reader tests.** Feed split CRLF frames, comments, and each event through a controlled response. Assert immediate callback delivery, HTTP JSON errors, wrong content type, invalid event, duplicate or missing terminal, premature EOF, and abort. Validate and cancel every unread body path.
- [ ] **Step 2: Run `bun test ./app/admin-utils/demo-hub/lib/read-smart-routing-stream.test.ts` from `projects/mission-control`; expect failure.**
- [ ] **Step 3: Implement the reader and pure reducer.** The reader emits parsed events before EOF and requires exactly one `run.started` and one terminal event. The reducer moves through routing, responding, completed, stopped, and failed; concatenates text; keeps partial text on failure; and only accepts final `DemoEnvelope` on completion.
- [ ] **Step 4: Add reducer and run-owner tests.** Assert model/provider updates before completion, incomplete text retained, a new run or Stop aborts the old controller, stale events cannot overwrite the new state, and text publication is coalesced by `requestAnimationFrame` while terminal events publish synchronously.
- [ ] **Step 5: Implement the TanStack owner and run all focused tests.** Follow `packages/frontend/data-layer/AGENTS.md`: canonical query key and options factory, `useAPIMutation`, Result-returning mutation, hook-owned cache writes, and no copied server state in component state. Commit as `feat: own live smart routing run state`.

## Task 4: Render the Live Smart Routing Result

**Files:** Create `projects/mission-control/app/admin-utils/demo-hub/demos/SmartRoutingLiveResult.tsx`; modify `demos/smart-routing.tsx`, `demos/smart-routing.dom.test.tsx`, and `components/RequestResponseViewer.tsx`.

**Interfaces:** `SmartRoutingLiveResult` receives a `SmartRoutingStreamState | null` and renders one answer panel plus phase/model/provider labels. `RequestResponseViewer` receives optional `showAssistantText?: boolean`, defaulting to `true`; this demo passes `false` when its own answer panel is visible.

- [ ] **Step 1: Write a DOM test with a controlled SSE response.** Click each router's run action, assert an immediate routing state, emit `route.resolved` and `text.delta`, assert the answer is visible while the stream remains open, then emit `run.completed` and assert routing metadata, one answer, and final payload tabs. Complete a second run to expose the existing multi-run history card; assert its new row appears only after that run completes.
- [ ] **Step 2: Add Stop and failure DOM tests.** Stop must abort the browser request, retain text with an incomplete label, and add no success history. A late event from a previous run must not relabel or replace the current run. Test an HTTP failure and a stream failure within behavior-driven cases rather than copy-only loading tests.
- [ ] **Step 3: Run `RTL_SKIP_AUTO_CLEANUP=true bun test --preload ./bun-test.dom-setup.ts ./app/admin-utils/demo-hub/demos/smart-routing.dom.test.tsx` from `projects/mission-control`; expect the new assertions to fail.**
- [ ] **Step 4: Implement the UI.** Replace the inline fetch and busy state with the run owner, preserve the submitted router/scenario snapshot, render Stop via the design-system `Button`, place the answer panel above the final viewer, and keep the existing routing decision card/history keyed from the completed envelope. Suppress only the viewer's duplicate assistant-text block for this demo.
- [ ] **Step 5: Run focused DOM and component tests, inspect light and dark themes, and commit.** Use `feat: show live smart routing answers`.

## Task 5: Verify and Open the Stacked PR

**Files:** Update only files needed to fix verified failures; the PR description records HIPAA/ePHI and security/privacy results.

- [ ] **Step 1: Run the required HIPAA/ePHI, security access, and data-trust review skills.** Document actual data flow, credential handling, prompt/output exposure, and capture behavior in the PR description.
- [ ] **Step 2: Run `bun run format`, focused Mission Control unit and DOM tests, `bun run typecheck`, and `bun run verify` from the repository root.** Fix failures and rerun the affected checks. Run the affected-package query after the PR is out of draft and follow visual-regression instructions if it names Web or the shape of Web page data changes.
- [ ] **Step 3: Exercise the demo in a browser with an authenticated local stack if available.** Confirm first visible text precedes completion for each router, Stop keeps partial text, final metadata is shown accurately, and light/dark states use design tokens. If local credentials are unavailable, report the exact limitation and retain the synthetic transport and DOM evidence.
- [ ] **Step 4: Push the branch only after `bun run verify` passes, open a PR with base `codex/demohub-jev-router`, and attach the PR to this task.** Include the parent PR link, test evidence, HIPAA/ePHI answer, security review classes, and any live-validation limitation.
- [ ] **Step 5: Follow CI and review to a truthful ready state.** After every push, rerun tests and resolve any failures before reporting completion; preserve pushed commits without amend or force-push.
