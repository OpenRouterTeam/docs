---
name: cfw-fusion-isolate-memory
description: cfw-api outer-isolate memory / fusion `exceededMemory` OOM reference — the retainer taxonomy, how to profile a Worker isolate heap, the confirmed root causes, and the fixes (shipped + planned). Use when investigating fusion OOM/exceededMemory, cfw-api isolate memory pressure, or planning changes to the fusion streaming/server-tools path. Companion to `cfw-api-startup-optimization` and `cfw-api-cpu-memory-optimization`.
user-invocable: true
metadata:
  statuses-last-verified: 2026-08-23
---

# cfw-api Outer-Isolate Memory & Fusion OOM

Reference for the `exceededMemory` OOM that kills the **cfw-api gateway isolate** (the outer orchestrator), most visibly on `stream:false` `openrouter/fusion` runs. Establishes what actually retains memory, how to measure it, and the fixes. The [`cfw-api-startup-optimization`](../cfw-api-startup-optimization/SKILL.md) skill covers startup CPU. The [`cfw-api-cpu-memory-optimization`](../cfw-api-cpu-memory-optimization/SKILL.md) skill covers general request-path CPU, memory and latency measurement.

> Provenance: July 2026 investigation. Prod incident `gen-1783457673` (cf-ray `a179beb91c1a5949-IAD`), real workerd CDP heap profiling, and a V8/JSC synthetic harness. Numbers below are that snapshot in time — re-measure before trusting a specific MB figure; the *mechanisms* and *methodology* are the durable part.

## The incident shape (how it presents)

- Client sees HTTP **200** with `content-type: application/json` (NOT `text/event-stream`) and an **empty gzip body**, after a long wall time (observed 228s). Cloudflare commits the 200 headers, then the isolate dies mid-orchestration, so the body never arrives.
- Datadog: `@script_name:api "fusion-tool:execute-start" @outcome:exceededMemory`. The OOM is on **cfw-api** (the `api` script), NOT cfw-fusion — the fusion worker offloads panel text to a DO and stays small.

## Architecture (why the outer isolate is the victim)

- Fusion runs via the OpenRouter **agent SDK** (`@openrouter/agent`) tool loop inside `ServerToolsPlugin` on cfw-api. Dispatch to compute is a **service-binding fetch** to the deployed **cfw-fusion** worker (`SVC_FUSION`, `fusion-tool.ts` → `fetch('http://fusion/run')`), NOT an RPC or self-fetch.
- cfw-fusion streams NDJSON back; cfw-api consumes it in `consumeFusionStream` and folds the result into the SDK tool-loop transcript.
- Inner panel/judge calls are plain `fetch` to `${origin}/api/v1/responses` originating **from cfw-fusion**, re-entering cfw-api as *separate* isolates — they add host co-tenancy pressure but do NOT accumulate on the orchestrator.

## Retainer taxonomy (what actually holds memory on cfw-api)

Ranked from the real prod heap snapshot. Two buckets: fixed baseline vs per-run.

### Fixed per-isolate baseline (~60–80 MB, there before any request)

- **~29 MB worker bundle source string** — the worker's own code. `minify = true` (PR #33794) shrinks this; V8 retains the bundle source as one two-byte string per isolate, so a smaller bundle directly lowers the baseline.
- **~34 MB of closures/contexts from the module-global `$ZodRegistry` / `zodToOpenAPIRegistry`** — the entire `@openrouter/sdk` (Speakeasy) schema surface, materialized on first server-tool request and pinned for the isolate's life. Path-to-root: `scope @127015` → `closure:scheduled` → global handle. **This is a PLATEAU, not a leak** (finite module-`const` schemas, first-touch materializes then caches) — verified: no per-request `.openapi()`/`.extend()` on the inference/server-tools/fusion path. Caveat: the vendored `@asteasolutions/zod-to-openapi` registry is a **strong `Map`**, so any *runtime* `.openapi()`/`.extend()` WOULD leak — audit for that before assuming plateau. The audit surface is wider than those two names: `extendZodWithOpenApi` (8.1.0, `dist/index.mjs` `preserveMetadataFromModifier`) wraps `.optional`, `.nullable`, `.default`, `.transform`, `.refine`, `.length`, `.min`, `.max`, `.catchall` and `.meta` on every schema that has had `.openapi()` called on it — including the shared `zInt()`/`zDouble()` instances — so a per-request `SomeSchema.optional()` or `zInt().min(1)` also does `_map.set(newSchema, meta)`. Grep for those modifiers on `*Schema`/`z*()` receivers inside function bodies, not just `.openapi(`. Sept 2026 sweep: the only two function-body sites (`response-cache.ts` `createChatCachedResponseSchema`, `internal-stream/index.ts` `withSource`) are called once at module scope, so still a plateau. zod v4's own `globalRegistry` (`.describe()`/`.meta()`) is a `WeakMap` and is not this hazard. The same schema weight affects startup CPU and general request-path memory, covered by the [`cfw-api-startup-optimization`](../cfw-api-startup-optimization/SKILL.md) and [`cfw-api-cpu-memory-optimization`](../cfw-api-cpu-memory-optimization/SKILL.md) skills.

### Per-fusion-run (the OOM amplifier under co-tenancy)

- **Per-token panel deltas, retained for the whole run (dominant per-run cost).** cfw-fusion writes one NDJSON line per token delta; cfw-api `JSON.parse`s + Zod-parses each line and retains the event object (progress wrapper + `ToolEventBroadcaster` entry) until the run ends. O(total panel tokens) — the "millions of small closures/arrays" in the snapshot. **Fixed by coalescing deltas at the producer (PR #27521).**
- **Retained panel-prompt strings** (~0.5 MB each) on adapter `#prompt` fields, never cleared, held by the plugin fragment + plugin captures for the request lifetime. **Fixed by deriving the prompt lazily (PR #27873).**
- **Agent full-replay event history (formerly the remaining dominant per-run cost).** The agent's `ToolEventBroadcaster.buffer` and initial-turn `ReusableReadableStream.buffer` used to retain events their consumers had already read. The cost was a mid-flight peak that stacked with concurrent runs even though the buffers freed at completion. **Fixed in PRs #32781 and #32950 by trimming to the slowest active consumer.**
- **Other agent-SDK stream buffers** — smaller than first believed. Follow-up-turn streams are GC-able locals. (An early synthetic model wrongly fingered every reusable stream as dominant — see Lessons.)

## Refuted hypotheses (don't re-chase)

- **"The non-streaming response buffer is the retainer / `stream:true` fixes it."** FALSE. Snapshots: `stream:false` 183 MB ≈ `stream:true` 209 MB (stream:true is *higher*); buffered JSON body is only ~247 KB. The SDK tool loop has no `if(request.stream)` branch and its inner requests are hardcoded `stream:true`; the outer flag governs only final skin serialization.
- **"`ReusableReadableStream.buffer` is the dominant retainer."** FALSE in the real snapshot (see above) — a synthetic-harness artifact.
- **"OOM is ~78 concurrent runs of a never-free buffer."** FALSE — that came from measuring a zero baseline and the wrong retainer.
- **"The SDK `import * as` barrels retain ~48 MB — codegen fix recovers it."** FALSE once bundled. A native-workerd A/B on the same entry measured barrel 15.83 MB ≡ barrel-free 15.84 MB; esbuild flattens barrels at deploy. The +75 MB figure came from an unbundled raw `import`, a build mode cfw-api does not use. Also, `useIndexModules: false` fails Speakeasy's own compile step on 1.763.2 and 1.772.0. Do not reopen this.
- **"The core router pipeline leaks."** FALSE (Aug 2026 break-and-trace, mock adapter, 14 sustained rounds): live objects return to baseline between waves, and stream peaks stay bounded by backpressure (+35–45 MB at 4×8k deltas). The core path plateaus; it does not leak. Caveat: the mock bypasses real adapter `transformRequest` serialization, so base64 copy-amplification through a real adapter is still unmeasured.
- **Do not confuse this with the local-dev OOM.** `wrangler dev` OOMs (~1.4 GB) come from workerd's inspector console store pinning every logged object (fixed in #27864 — log summaries, not object graphs). That mechanism does not exist in prod, which stringifies logs.

## How to profile a Worker isolate heap (methodology)

For the executable version of the plateau-vs-leak experiment below — the floor-vs-request-count probe, control-arm subtraction, class-count structural check, incoming-edge retainer histograms, and cut simulation with a positive control, plus the committed scripts that run them — use the companion skill [`cfw-isolate-leak-probing`](../cfw-isolate-leak-probing/SKILL.md). It came out of the Aug 2026 probe rotation (P-001..P-005, L-007..L-010) and shipped two request-correlated leak fixes, #33901 and #34035. This file stays the retainer taxonomy and the fusion-OOM mechanisms; that one is how to measure and how to prove a candidate fix would actually free the graph before writing it.

1. **workerd exposes NO runtime heap-read API** — no `measureUserAgentSpecificMemory` / `performance.memory` in prod isolates. You cannot sample heap on-request. Options: offline CDP profiling, or instrument the *drivers* of retention (see PR #27531's run-shape metrics).
2. **Local CDP heap profiling** (the authoritative method): `wrangler dev` opens a workerd inspector (`WRANGLER_INSPECTOR_PORT`; pin it, default is `0` = OS-assigned). Use `Runtime.getHeapUsage` (the floor number), `HeapProfiler.collectGarbage` (force GC), `HeapProfiler.takeHeapSnapshot` (retainer paths). Snapshot before/after a single request, diff retained size, and read **path-to-root** on the largest retainers — that's what distinguishes baseline from per-run and names the retaining field.
3. **plateau vs leak experiment:** N *identical* sequential requests, with a forced GC and `getHeapUsage` between each. Flat post-GC floor after run 1 = plateau; monotonic growth on identical inputs = leak. Also diff `zodToOpenAPIRegistry._map.size` between two post-GC snapshots for a direct registry-leak check.
4. **Synthetic V8/JSC harness** is good for *sweeping* a single retainer's size vs input, and for driving an exact total V8 heap limit to a crash. Always assert `v8.getHeapStatistics().heap_size_limit`: on Node 26, exact 128 and 256 MiB totals required `--max-old-space-size=125/253 --max-semi-space-size=1`; `--max-old-space-size=128` alone yielded about 224 MiB total. The harness is BLIND to the isolate baseline and easily models the wrong retainer — always cross-check against a real snapshot.

## Fixes

Merge status drifts — verify with `gh pr view <n> --json state` before you trust a status below, and update `statuses-last-verified` in the frontmatter when you do. The mechanism descriptions are the durable part. Statuses last verified 2026-08-23.

### Merged

- **PR #27521** — coalesce per-token panel deltas in cfw-fusion (`services/cfw-fusion/src/delta-coalescer.ts`) before the NDJSON write. ~250× fewer retained event objects; lossless; first delta per model still flushes immediately for prompt first paint.
- **PR #27531** — run-shape metrics (`openrouter.server_tools.fusion.run.*`: `delta_events`, `ndjson_lines`, `delta_bytes`, `duration_ms`, tagged `outcome` + `panel_count`) + fusion dashboard widgets. The `delta_events/ndjson_lines` ratio is the coalescing KPI; correlate against the existing `exceededMemory` widgets.
- **PR #27873** — derive the adapter prompt lazily (getter over `#request` + `model`) instead of retaining a `#prompt` copy for the request lifetime. Supersedes closed PR #27539, which kept the field and released it early; removing the field is the better shape. Frees the ~5–6 MB/run duplicate.
- **PR #27549** — thread an `AbortSignal` through `runFusion` (plumbing; cancellation is non-retryable). Behavior-neutral until the producer trigger lands.
- **contentSink** (fusion-core) — panels stream completion content off-heap to the DO store; peak holds ~one checkpoint instead of the full transcript.
- **PR #32781** — stop accumulating generator preliminary results on terminal `tool.result` events and trim `ToolEventBroadcaster` history to the slowest attached consumer.
- **PR #32950** — apply the same active-consumer trim to `ReusableReadableStream`, make the initial-turn broadcaster pipe its sole direct stream consumer, and preserve late full-response replay at the broadcaster layer.

- **Producer cancel trigger — landed, though not via the PR this file used to track.** `services/cfw-fusion/src/build-fusion-stream.ts` now has `abortRun(trigger: 'consumer' | 'request', reason)` at `:149`, which aborts the run controller, clears the request-abort listener and finalizes as `'cancelled'`. It fires on consumer disconnect at `:371` (`writer.closed.catch`) and on request abort at `:376`, with the `cfw-fusion:consumer-cancelled` probe log at `:159` carrying `abort_trigger` so the two paths are separable in Datadog. **PR #27591 is CLOSED unmerged** — do not go looking for it as the open item, and do not re-derive the mechanism. Note the separate `cfw-fusion:terminal-write-stalled` log at `:262` covers a different case (a stalled terminal write, not consumer cancellation); if that one still accumulates it is its own lead. Original honest scope still applies: this only saves spend for `can_abort` endpoints on the in-flight stage.

### Open

- Nothing tracked here is open. The three residuals named in PR #36186's description are partly stale: the producer-cancel item is the entry above, and "chat-skins detector-reader flag" has no matching symbol under `packages/router/skins`. The STT File-threading item is real but its multiplier is **~7x, not the ~3.3x** quoted there (measured RSS: an 8 MiB payload peaks near 57 MB through bytes → base64 → stringify → parse → decode → `File`), and a per-adapter audit found a *global* fix unreachable — Deepgram (raw bytes), Alibaba (JSON envelope) and Google Cloud (JSON + OAuth) can never accept the DO's multipart body, so the fix is a per-model cap. See #36363 and #36377.

### Replay trimming is merged; avoid front-splice CPU amplification

A local break-and-trace named the replay retainer before the fixes above: 14 concurrent fusion-shaped streams under a 128 MiB V8 cap crashed, and the crash-path snapshot showed about 85% of heap in already-consumed events (`event` ← `buffer` array ← `ToolEventBroadcaster`). PRs #32781 and #32950 now clear those events as the slowest attached consumer advances. Full replay is guaranteed only to consumers attached before consumption; late consumers start at the current trim watermark.

The first merged implementation used `buffer.splice(0, trimCount)` on every watermark advance. That releases memory, but a large queued or lagging-consumer drain repeatedly shifts the remaining array and becomes superlinear. The open, unmerged [typescript-sdk#798](https://github.com/OpenRouterTeam/typescript-sdk/pull/798) implements the Aug 2026 follow-up in `src/lib/tool-event-broadcaster.ts` and `src/lib/reusable-stream.ts`: it keeps an absolute head, clears consumed slots immediately, and slices only after at least 1,024 entries and half the backing array are dead. It is not yet included in the patched `@openrouter/agent` build tracked here, whose patch remains at the main-branch versions carrying the #32781/#32950 trimming.

Production-flag Workerd A1/B1/B2/A2 results (31 samples per block) show why the extra cursor state is worthwhile. At 50,000 events, burst drains improved by 9–33× and lagging-consumer drains by 129–134×. Ready `scheduler.wait(0)` and service-binding probes were delayed for the same duration as the synchronous drain, then fell with it. Lockstep streaming was effectively neutral.

Fresh-process Node 26 matrices at exact 128 and 256 MiB V8 heap limits compared frozen front-splice and amortized modules. Across both replay classes, the largest passing 1 KiB-event backlog changed by less than 0.23%, with the direction changing by cap/module. At 50,000 events, both arms retained about 58.5–59.0 MB at the full backlog, about half after a half drain, and under 0.6 MB after a full drain. The amortized form therefore preserves prompt payload release and the original OOM boundary while removing the CPU cliff.

Recompute the watermark when `return()`/`throw()` removes a lagging registered consumer; that is part of the active-consumer compaction contract, and late consumers start after the newly released prefix. Keep the remaining iterator lifecycle cleanup as separate work. Pending `next()` calls are not woken by `return()`/`throw()`, terminal waiter rejection can leave consumer registration behind, and `ReusableReadableStream.cancel()` does not clear its buffered backlog. Those lifecycle bugs predate amortized compaction and should not be mixed into its CPU follow-up.

### Considered and dropped

- **Self-call SDK bypass** (raw fetch + snake↔camel remap, skipping per-event `$inboundSchema.parse`) — still valid for the residual intrinsic schema cost, but the replay-buffer fix above removes the dominant per-token term, so measure again before you build this.
- **SDK codegen barrel fix** — refuted; see the list above.

## Methodology lessons (the durable part)

- **Real heap snapshot > synthetic model.** The synthetic harness got the mechanism questions right (aliasing, stream-flag, engine diff) but was blind to the ~60–80 MB isolate baseline and mis-ranked the dominant retainer. Every confident synthetic conclusion here was corrected by the prod snapshot.
- **Separate baseline from per-run.** "Total heap is 183 MB" tells you nothing; the fix targets are the *movable* per-run retainers, found via path-to-root, not the fixed tax.
- **`stream:false` vs `stream:true` is a red herring for memory** — measure, don't assume the flag matters.
- **Distinguish plateau from leak explicitly** before treating a baseline as an emergency; the fix differs (engineer-around vs stop-the-bleed).
- **Comment blocks:** `scripts/lint-comment-blocks.ts` checks 3+ consecutive `//` lines as part of the shared lint runner. It runs on whole changed files, not just added lines.
- **Metrics-emit ordering:** emit run-shape/finalize metrics from an idempotent finalize called on ALL terminal paths (result/error/abort). Emitting before an awaited terminal write is racy (a cancelled write neither resolves nor rejects promptly on a `TransformStream` — backpressure hang), which produced a non-deterministic double-emit that passed locally and failed CI.
- **Measure the build mode prod uses.** The +75 MB barrel claim came from a raw unbundled `import`; cfw-api bundles, and bundled A/B showed zero difference. A heap number is only evidence for the build mode it was measured in.
- **`performance.memory` lies; forced-GC snapshots do not.** It is not GC'd and gave backwards A/B results. Same-tab sequential snapshots accumulate cross-page retention — isolate each measurement (fresh context or fresh process).
- **Your instrument can cause the retention you measure.** CDP `Runtime.enable` makes workerd pin every console argument; a heap watcher that enables it contaminates its own reading. Mock call history retains every call's arguments — clear it each round or it masquerades as a leak.
- **A starved event loop inflates live-object counts.** A sampler that never yields keeps generators and promise chains alive; the same run with a yielding poller showed them collapse to baseline. Confirm a "leak" slope survives a scheduler-friendly sampler before you report it.
- **Peak ≠ retained.** The replay-buffer OOM retains nothing after completion; it kills through mid-flight peaks stacking with concurrency. Sequential-run leak tests are blind to it — break tests must run flights concurrently.
- **CI runs bun tests with `--concurrent`** (`bun-test.sh`); plain `bun test` does not. Reproduce CI-only failures with the flag, and never count process-global state (for example a spy logger) across concurrently-running tests — scope assertions with a per-test correlation id.
