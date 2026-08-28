# Router Streaming Architecture

## Pipeline Overview

There are three distinct layers, each with its own event format:

```text
┌────────────────────────────────────────────────────────────────┐
│  Layer 1 — Adapter                                             │
│  Provider SSE/JSON ──► BaseInternalStreamChunk                 │
│  (adapters/base/index.ts: #transformEventStream)               │
├────────────────────────────────────────────────────────────────┤
│  Layer 2 — Plugin Chain                                        │
│  InternalStreamChunk + RouterLifecycleEvent                    │
│    = PluginInternalStreamEvent                                 │
│  flows through the middleware stack as an async generator      │
│  (plugins/base/apply-plugins.ts: applyPlugins)                 │
├────────────────────────────────────────────────────────────────┤
│  Layer 3 — Skin Transform                                      │
│  PluginInternalStreamEvent ──► provider-specific SSE           │
│  (skins/anthropic-messages or skins/openai-responses)          │
└────────────────────────────────────────────────────────────────┘
```

## Event Categories

Events in the plugin chain (`PluginInternalStreamEvent`) fall into two
categories:

**Content events** (`InternalStreamChunk`) — what the AI produced:

- `Generation.*` — text, tool calls, reasoning, images, citations, refusals
- `Metric.*` — token counts, cache hits, web search requests
- `Error.*` — typed provider errors (rate limit, context length, etc.)
- `Tool.*` — web search, file search
- `Turn.*` — turn start/end metadata
- `Debug.*` — diagnostic events (`debug.info`, `debug.warning`)
- `Unmapped` — passthrough for unrecognized provider events
- `Lifecycle.*` — all seven lifecycle variants (each carries `source`
  via `withSource()`)

**Infrastructure events** (`RouterLifecycleEvent`) — what the router
is doing. These are a subset of lifecycle events that require
router-internal types not expressible in `llm-interfaces` due to
the circular dependency constraint (see below):

- `RouterAdapterInvokedEvent` — adapter identity resolved, body
  starting; overrides `adapter: unknown` with `adapter: BaseAdapter`
- `LifecycleUsageCompleteEvent` — usage data ready for accounting
- `LifecycleAdapterErrorEvent` — adapter failed before any content
- `LifecycleClientStreamErrorEvent` — client disconnected

`LifecycleStreamClosedEvent` is **not** in `RouterLifecycleEvent`.
It flows as an ordinary `InternalStreamChunk` (with `source`) through
the plugin chain and into the skin.

## The `generatorToResponse` Peek Loop

`generatorToResponse` (`apply-plugins.ts`) must return a
`PostPluginsResponse` containing three things before streaming starts:

- `body` — a `ReadableStream<PluginInternalStreamEvent>` for the skin
- `adapter` — a `Promise<BaseAdapter | null>` for post-stream
  accounting
- `usage` — a `Promise<TypedLifecycleUsageCompleteEvent>` for billing

To populate these it "peeks" into the generator before returning,
handling each early event type:

| First event received | Action |
| --- | --- |
| `LifecycleAdapterInvoked` | Normal path — adapter known, return `ok()` |
| `InternalStreamChunk` or `LifecycleUsageComplete` | Plugin-first path — adapter deferred via `Promise`, return `ok()` |
| `LifecycleAdapterError` | Adapter failed — `abort()`, drain in background via `waitUntil()`, return `Err` |
| `ErrorEvent` (source: `{type:'plugin', id:'router'}`) | Uncaught plugin exception — abort, drain in background, return `Err` |
| `LifecycleClientStreamError` | Client cancelled before adapter — `abort()`, keep looping |
| `LifecycleStreamClosed` | Stream ended with no content — keep looping |

The peek loop exists because plugins may emit content events *before*
the adapter is invoked (e.g. a cache-hit plugin). In that case we
don't know the adapter identity yet but must start streaming
immediately.

### End-of-stream ordering

`sendEndOfStreamEvents()` always emits events in this order:

1. `LifecycleUsageComplete` — triggers the accounting plugin to enrich
   with cost data before the stream closes
1. `LifecycleStreamClosed` — signals the skin to finalize and close
   the response body

The ordering is required: `LifecycleStreamClosed` closes the body
`ReadableStream`, so `LifecycleUsageComplete` must be enqueued first
or the skin will never see it.

### `drainGenerator`

When the peek loop or `makeOutputStream` needs to abandon the stream
(error paths), `drainGenerator` continues driving the generator in the
background via `waitUntil`. This ensures `usageResolve` and
`adapterResolve` are always settled — even if the events never arrive,
fallback values are provided at the end of the drain.

## Plugin Chain Assembly

Plugins are assembled **in reverse order** (`toReversed`) to create a
middleware stack where the first plugin in the array is outermost
(executes first and last):

```text
plugins = [A, B, C]
chain:  A wraps → B wraps → C wraps → adapterResultToGenerator
calls:  A.complete → B.complete → C.complete → adapter fetch
```

Each plugin receives a `PluginNext` interface giving it a `complete()`
method to call the rest of the chain. Plugins are async generators —
they can `yield` events before calling `next.complete()`, after, or
both.

`BasePlugin.complete()` is the default pass-through for plugins whose work is
wholly outside the completion path, such as endpoint resolvers. `applyPlugins`
uses `hasCompletionHook` to omit that inherited default from the middleware
stack, avoiding a channel and async-generator wrapper with no behavior. These
plugins remain in the original plugin array so endpoint resolution, logging,
and pipeline metadata are unaffected. Any plugin that inspects or modifies the
request or response stream must override `complete()`. A contiguous run of
request-only preflight plugins returns the downstream generator directly after
request transformation instead of wrapping it in another generator.

A **separate `generatorChannel`** (`downstreamClientErrors`) is
created for each plugin in the loop. This channel carries
`LifecycleClientStreamError` events from downstream back into that
plugin's generator stream, allowing abort signals to flow inward while
content events flow outward. The channel is closed when the upstream
generator finishes so `upstreamMergedWithEndChannel` can return.

## Abort Signal Propagation

Abort direction is **opposite** to event direction: events flow
outward (adapter → client), aborts flow inward (client → adapter).

### Path 1 — Client disconnect

```text
Cloudflare TCP RST/FIN
  → incoming request AbortSignal fires `abort`        [Router.submit, index.ts]
  → EdgeStream.recordClientDisconnect(reason)          [edge-stream.ts]
  → CloudflareClientCancelationDetector.recordClientDisconnect()
      settles clientStreamClosed without waiting on the response readable
      (the runtime stops pulling from it on disconnect)
  → StreamBreaker: clientDisconnectSignal listener    [stream-breaker.ts]
      #handleDownstreamCancellation()
      if canAbort: filteringOutputController.error()
  → pipeTo() aborts → body ReadableStream cancelled
  → makeOutputStream.cancel()                           [apply-plugins.ts]
  → abortFinalHandler() → handler.abort()
  → [Plugin chain abort — see below]
```

The request-signal relay is the **reliable** path and fires first. The
fallback below only fires when the relay is unavailable (no
`enable_request_signal` compat flag) or loses the race:

```text
CloudflareClientCancelationDetector.cancel()          [cloudflare.ts]
    sets clientStreamDidCancel, rejects clientStreamClosed promise
  → StreamBreaker: #downstreamWriter.closed.catch()   [stream-breaker.ts]
      #handleDownstreamCancellation()
      if canAbort: filteringOutputController.error()
```

> **`canAbort = false`:** When `endpoint.can_abort` is false,
> `StreamBreaker` does not propagate the downstream abort upstream.
> The adapter continues streaming into the void. This is intentional
> — some providers bill for the full generation regardless of
> cancellation, so aborting mid-stream accomplishes nothing. The
> request eventually ends via timeout.

### Path 2 — Upstream timeout

```text
requestAbortCtrl.start(requestTimeout)            [#invoke, index.ts]
adapter.receivedUpstreamSignal.then(() =>
  requestAbortCtrl.cancel())  ← races with timeout

if timeout wins:
  requestAbortCtrl.signal fires
  → responseStream.pipeThrough(meterBox, {signal}) detects abort
  → StreamBreaker.tryPipeThrough resolves
  → flushAdapterResponse returns
  → #invoke checks requestAbortCtrl.signal.aborted === true
  → calls body.cancel() as cleanup          ← not the trigger, just cleanup
  → makeOutputStream.cancel()
  → abortFinalHandler() → handler.abort()
  → [Plugin chain abort — see below]
```

Note: `requestAbortCtrl` is **timeout-only**. Client disconnects do
not trigger it. The two paths converge at `handler.abort()`.

`receivedUpstreamSignal` resolves on the first successfully parsed
upstream event, even one that emits nothing downstream (e.g.
reasoning deltas suppressed by `reasoning.exclude`, empty deltas,
keepalives), so a healthy stream that reasons silently past the
timeout is not aborted. Adapters that opt in via
`shouldSignalOnAnyUpstreamEvent` (the Responses API adapter
family) resolve it even earlier, on the first raw upstream SSE
event before schema parsing — `response.created` arrives
immediately. Trade-off: an upstream that sends one event and then
stalls forever is no longer caught by this timer — the upstream
idle monitor is the backstop.

### Plugin chain abort (shared)

Once `handler.abort(error)` is called on the outermost plugin handler:

```text
outermost plugin's abort():
  → sendDownstreamClientError(LifecycleClientStreamError)
      into that plugin's downstreamClientErrors channel
  → upstreamMergedWithEndChannel surfaces it alongside upstream events
  → if plugin forwards the event:
      outer wrapper: isLifecycleClientStreamErrorEvent
        → nextHandler.abort(error)   ← propagates inward
        → repeat for each plugin layer
  → if plugin absorbs the event:
      abort stops here
      plugin continues running (e.g. to collect usage before stopping)

adapterResultToGenerator.abort():                  [apply-plugins.ts]
  → sets clientStreamErrorForAdapter
  → cancels adapterReader or adapterStream (fire-and-forget)
  → resolves clientStreamErrorPromise with Err
  → safeRace in read loop wins → read loop breaks
  → emitEndEventList + sendEndOfStreamEvents() drain remaining state
  → generator returns
```

The ability for a plugin to **absorb** `LifecycleClientStreamError`
is intentional: accounting plugins can continue running after a client
disconnect to ensure usage is recorded before the stream fully closes.

### waitUntil and Cloudflare worker lifetime

`CloudflareClientCancelationDetector` registers a `waitUntil` promise
so the Cloudflare Worker does not terminate before the cancellation
is observed and usage is recorded. Without this, the worker task would
be aborted at the same time as the client disconnect, preventing the
cancel microtask from running.

## Circular Dependency: `RouterLifecycleEvent` as a Temporary Shim

> **See also:** `plugins/base/plugin-event-guards.ts` — the shim file
> itself has a TODO comment at the top explaining this.

`PluginInternalStreamEvent` is currently defined as:

```typescript
type PluginInternalStreamEvent = InternalStreamChunk | RouterLifecycleEvent;
```

`RouterLifecycleEvent` is a **four-member** union:

```typescript
type RouterLifecycleEvent =
  | RouterAdapterInvokedEvent      // overrides adapter: unknown → BaseAdapter
  | LifecycleAdapterErrorEvent
  | LifecycleClientStreamErrorEvent
  | LifecycleUsageCompleteEvent;
```

This split exists solely to work around a circular dependency:

- `@openrouter-monorepo/router` depends on
  `@openrouter-monorepo/llm-interfaces`
- `llm-interfaces` **cannot** depend on `router` — that would be
  circular
- `BaseAdapter` lives in `packages/router/adapters/base/index.ts`
- `LifecycleAdapterInvokedEvent` needs to carry a `BaseAdapter`
  reference so plugins can access the adapter identity
- Because `llm-interfaces` cannot import `BaseAdapter`, the field is
  typed as `z.unknown()` in
  `llm-interfaces/internal-stream/events/lifecycle/adapter-invoked.ts`
- `RouterAdapterInvokedEvent` in `plugin-event-guards.ts` overrides
  the type:

  ```typescript
  type RouterAdapterInvokedEvent =
    Omit<LifecycleAdapterInvokedEvent, 'adapter'> & {
      adapter: BaseAdapter;
    };
  ```

- `RouterLifecycleEvent` assembles the router-internal lifecycle union
  with properly typed variants
- `plugin-event-guards.ts` **exists entirely as a shim** for this
  limitation

All other lifecycle events (`LifecycleStreamClosedEvent`,
`LifecycleSystemFingerprintEvent`, `LifecycleRouterMetadataEvent`, and the four
above when their `z.unknown()` fields are acceptable) flow as ordinary
`InternalStreamChunk` events — each variant is in
`BaseInternalStreamChunkSchema` and gains `source` via `withSource()`.

### Roadmap: Resolving the circular dependency

The fix is to extract `BaseAdapter` into its own package
(`@openrouter-monorepo/router-adapters` or similar) that
`llm-interfaces` can import without creating a cycle:

```text
Before:
  router ──► llm-interfaces
  router ──► providers (BaseAdapter lives here)
  llm-interfaces cannot ──► router  (circular)

After:
  router-adapters  (BaseAdapter lives here)
  router       ──► llm-interfaces
  router       ──► router-adapters
  llm-interfaces ──► router-adapters   (no cycle)
  providers    ──► router-adapters
```

Once that split lands:

- `LifecycleAdapterInvokedEvent.adapter` gets properly typed
- `RouterAdapterInvokedEvent`, `RouterLifecycleEvent` are deleted
- `plugin-event-guards.ts` is deleted (type guards move to
  `llm-interfaces`)
- `PluginInternalStreamEvent` becomes a plain alias for
  `InternalStreamChunk`
- One type, one union, no shims
