---
name: cfw-isolate-leak-probing
description: Measurement methodology for request-correlated memory leaks in cfw Worker isolates — the floor-vs-request-count probe, control-arm subtraction, class-count structural check, incoming-edge retainer histograms, and cut simulation with a positive control. Use when a worker's post-GC heap floor grows with request count, when diagnosing a named retainer from a workerd heap snapshot, or before shipping any "this closure leaks" fix. Companion to `cfw-fusion-isolate-memory` (that one is the retainer taxonomy; this one is how to measure).
user-invocable: true
metadata:
  provenance-last-verified: 2026-08-14
---

# cfw Isolate Leak Probing

How to prove a cfw Worker isolate leaks, attribute the leak to a named retainer, and verify a fix would actually free the graph — before writing the fix.

> Provenance: the Aug 2026 perf-loop leak-probe rotation. Probes P-001..P-005 and leads L-007..L-010 produced two merged production fixes ([#33901](https://github.com/OpenRouterTeam/openrouter-web/pull/33901), ~15.7 KB/req; [#34035](https://github.com/OpenRouterTeam/openrouter-web/pull/34035), ~40 KB/req) and one refutation that killed a statically-correct wrong fix before it shipped (L-009). The *numbers* below are that snapshot in time; the *method* and the *traps* are the durable part.

## When to use this

- The post-forced-GC heap floor of a local worker rises with cumulative request count (a leak), and you need to prove it and size it.
- A heap snapshot shows O(requests) instances of a per-request class and you need to name the retainer that pins them.
- You have a hypothesis like "this listener is never removed" / "this closure captures `this`" and you are about to write the fix. Simulate the cut first — a statically correct reading of missing cleanup is *not* evidence that cutting it frees anything.
- You need to prove a shape does *not* leak (a plateau verdict is a real result: it retires a suspect shape).

Not this skill: fusion `exceededMemory` OOM mechanisms, the fixed per-isolate baseline, and the retainer taxonomy — that is `cfw-fusion-isolate-memory`. Request-path CPU/memory measurement is `cfw-api-cpu-memory-optimization`; startup CPU is `cfw-api-startup-optimization`.

## Probe method: floor vs request count

The measurement is one number over a series: the **minimum `Runtime.getHeapUsage().usedSize` across several forced-GC cycles**, sampled every N requests. That is the floor. A flat floor is a plateau; a floor rising linearly with request count is retention.

> **A single forced GC is NOT a floor.** `collectGarbage` can return before pending `waitUntil` work (fs-logs, usage-record, pubsub) has drained and become collectable, so one reading carries that noise. P-005's control series read 114 → 115 → 136 → 121 MB on single-GC checkpoints — ±20 MB against a ~1 MB per-200-request signal. Protocol: **4 GC+read cycles with a ~2.5 s drain between them, keep the MINIMUM.** `floor-probe.mjs` does this (`--gc-cycles`, `--drain-ms`).

1. **One shape per arm.** Pick a single request shape (aborted stream, drained stream, non-stream, one skin) and hold it byte-identical for the whole series. Verify the shape first — record response bytes and chunk count on a 24-request smoke run, and assert they are identical every request.
2. **Sequential, paced, FakeProvider.** `provider: { order: ['fake-provider'], allow_fallbacks: false }` keeps the upstream deterministic and free. Sequential (not concurrent) so retention, not mid-flight peak, is what is measured.
3. **Checkpoint every 200 requests**: settle (keeping the CDP socket warm), then 4 GC+read cycles keeping the minimum, then append a JSONL line. 1,800 requests × 200 is the standard arm; the first interval is warmup and is excluded from the fit.
4. **A control arm is mandatory.** Run the same probe against a non-inference authenticated route (`/api/v1/auth/key`) on a **fresh isolate**. Pace it — that route rate-limits around 4 req/s, so `--pace-ms 300`. Generic workerd per-request churn is ~8-9 KB/req; a raw arm slope below that is not a leak no matter how clean the R².
5. **Account failures honestly, and read the counts before the slope.** An arm that reports `failures=0` because failures were miscounted as successes will still produce a confident-looking slope out of requests that never reached the worker. Check `failures`, the status map, and the per-request byte/chunk averages at every checkpoint — a shape whose bytes drift is no longer one shape. On an abort arm specifically, note that the intended `abort()` does *not* surface as an exception (nothing is awaited past it), so any exception on that path is a real failure.
6. **Judge on the control-subtracted MEDIAN of block deltas**, with OLS, R² and monotonicity as shape diagnostics only:

   | control-subtracted | verdict | seen in |
   |---|---|---|
   | 1-4 KB/req, low R², non-monotonic | plateau | P-002 streaming, P-004 Messages (1.0 KB/req), P-005 cache (all three arms) |
   | 34-48 KB/req, R² > 0.95, monotonic | leak | P-001 non-stream (~61 KB/req attributable), P-003 abort (~40 KB/req) |
   | high slope, R² < 0.3 | inconclusive — re-run, suspect a confound | — |

   **Never headline OLS.** Control arms carry non-request-proportional background spikes: P-005 saw a reproducible +21 MB block once per ~600 requests from a periodic job, against ~+1 MB neighbours. OLS gives that one block enormous leverage — it reported **~40 KB/req on a genuine ~9 KB/req control**, i.e. it manufactured a leak. The median of per-block deltas discards it. `floor-slope.mjs` prints both and warns when OLS exceeds the median by ≥2×, which means one interval owns the fit.

   **The median has a mirror-image blind spot: it also discards a large DOWNWARD interval.** L-010's post-fix arm reads median 11.8 KB/req while its endpoints are provably flat (121.93 → 121.90 MB over 800 requests), because one GC-recovery dip of −39 KB/req is exactly what makes it flat. So read three numbers, not one — median (robust to spikes), **endpoint slope** (total rise / total requests, immune to a single outlier in either direction), and OLS/R² for shape. A flat endpoint pair with a high median is a plateau. `floor-slope.mjs` prints all three and flags a median/endpoint divergence.

### The structural check is the decisive evidence, not the slope

Take a snapshot at 900 and 1,800 requests and count per-request class instances (`class-count.mjs`). A request-correlated retainer is **O(requests)** and roughly *doubles* across that span, with every class in the per-request graph moving in lockstep (P-003: `EdgeStream` 523 → 995, `Router` 523 → 995, `FakeAdapter` 523 → 995, ~0.47 retained graphs/request). Infrastructure is **O(1)** and does not move at all.

Two guards on that check:

- **O(1) counts prove nothing without a no-inference control snapshot.** A control isolate that served zero inference requests reports the same `EdgeStream 2 / Router 17` — those are class and prototype nodes, not retained instances. Without the control you report a phantom 2-per-isolate leak.
- **Node type is part of the identity.** A JS instance is `type=object`, but the class *constructor* is a `closure` carrying the same name, and workerd built-ins (`workerd / AbortSignal`, `workerd / DOMException`, `CppgcShim`) are `native`/`synthetic`. Two consequences: include the closure and your denominator is one too high (a passing cut reads 522-of-523 instead of 522-of-522, and the lone "survivor" is the constructor — correct, not a residual leak); filter to `object` and every workerd native silently reports **0**, which reads as "the natives are not involved" when they were simply never counted. `class-count.mjs` prints a per-type breakdown for exactly this reason.
- **Never diff scope names across snapshots** — see trap 5 below. `class-count.mjs` suppresses `scope @N` rows in a two-snapshot diff by default, because unsuppressed they swamp the real signal as artifact "all new" rows.
- **A sparse diff is not a verdict.** Read the watch-list table (printed across every node type) before concluding nothing accumulated: an `object`-filtered, `--min-delta`-thresholded diff can be near-empty while the natives tell the whole story. On P-004 the watch list is what makes the plateau legible — `workerd / AbortSignal`, `Request`, `Response` and `CppgcShim` at ratio ~1.83 across a 900→1,800 doubling (generic workerd per-request churn) while every JS class sits at 1.00.

## Diagnosis method: from a leaked class to a retainer you can cut

1. **Incoming-edge histogram, never BFS shortest-path.** A shortest-path "retained by" view reports one path per node and **misattributed the retainer twice** (R-14): it fingered `upsertAppWithCache` in P-003 and a preflight listener in L-009, both *victims* pinned by the same graph. Enumerate every incoming edge of the leaked class instead (`incoming-edges.mjs`). Each holder class whose count is **exactly 1:1** with the leak count is a candidate strand; anything less is incidental. One blind spot: a plain-**array** retainer fragments into per-index edge labels (`.[0]`, `.[1]`, …) that each count 1, so it never shows up 1:1 in the hop-1 histogram — it only becomes legible as a single strand at hop 2+ of `trace-up.mjs`, where the array itself aggregates.
2. **Name each strand.** Walk up (`trace-up.mjs`) until the root is named. A `workerd / HeapTracer` / `CppgcShim` root is native and no JS edit cuts it; a `Global handles` root usually means workerd is still holding an unsettled promise. For a `system / Context / scope @N` holder, the edge that holds *its closure* names the strand — `.getDebugData` identified which constructor arrow captured `this` in L-010.
3. **Rule out self-cycles** (`identity-check.mjs`). A GC collects unreachable cycles, so a retainer that is the target's *own field* is not a root at all. This is exactly what killed L-009: the un-removed abort listener was held by the leaked object's own `preflightAbortController`. The static reading was correct and the fix was worthless.
4. **CUT SIMULATION BEFORE ANY FIX** (`cut-sim.mjs`). Remove the candidate's edges from the snapshot graph, re-run reachability from the GC root, count freed instances. Non-negotiable rules:
   - **The `none` arm is the control and must free 0.** A passing arm must free ~all instances. Without both rows a result means nothing.
   - **Cut every strand alone AND in combination.** Co-equal strands each free **0** alone and everything together. L-010's two strands were 0 / 0 / 522-of-523 — an all-or-nothing model, confirmed on three independent snapshots *before* a line of code changed, and only visible because the pairwise arms were run.
   - **Node cut vs edge cut.** A node cut removes all incoming edges and frees strictly more than a real fix, so a null result is a robust refutation and a positive result is only an upper bound. An edge cut (`scope-edge:<tag>:this`) leaves the holder reachable and models "this closure stops capturing the receiver" much more faithfully — prefer it for confirmation.
   - **Take the ceiling seriously.** L-009's dispatched fix had a **31 B/req** ceiling against a ~40,000 B/req leak — 0.07%, three orders of magnitude below the ship bar. That verdict was reached from preserved snapshots with no Tilt run at all.
   - **A union that frees 0 may be a simulation artifact.** Cutting one node can leave a sibling wrapper (cppgc shim, properties array) reachable that still reaches the target. L-010's first sim said "freed 0" for that reason; the faithful model cut the DOMException *and* its stack-trace frame array together (`frame-owners:`).
5. **Scope tags are snapshot-local and positional.** `scope @165457` in one snapshot is unrelated to the same string in another. Re-derive tags per snapshot and **verify each by its holder edge** before passing it to a cut sim — passing two tags swapped produces "freed 0" everywhere and looks identical to a refuted model (it cost L-010 a false failure). For cross-snapshot comparison, aggregate scope totals (`scope-total.mjs`); never diff scope names. Also: `scope @N` context naming is workerd-specific — a plain node/V8 snapshot contains no scope tags, so `identity-check.mjs` and `scope-*` selectors match nothing there; use `name:` / `frames:` selectors as the fallback.
6. **Verify the fix twice**: structurally on a short candidate run (per-request classes collapse to single digits, the strand's signature node count goes to 0), then by measurement on a matched window against the baseline arm. L-010: 43,170 → 2,671 B/req, R² 0.981 → 0.062, and `EdgeStream` 215 → 10 at 900 requests. Also run the *other* shape (drained) to prove no regression.

## Environment traps

Each of these cost a measured arm or a false verdict.

- **One persistent CDP client per series.** Reconnecting per checkpoint starves the inspector's debugger slot.
- **Give forced GC ≥ 10 s.** workerd GC has been observed up to 8.8 s; a short timeout reads a partial floor.
- **`HeapProfiler.collectGarbage` NEVER RETURNS on an *idle* workerd isolate, and a probe that does not check will report un-collected heap as a floor.** Measured hanging past a 180 s budget with `HeapProfiler.enable` on; `Runtime.collectGarbage` does not exist in this build (`-32601`). It returns in ~370 ms and genuinely collects (117.4 → 103.7 MB) the moment *any* request enters the isolate, deterministically. So the settle that makes a checkpoint quiet is the same thing that stops GC from completing. **Fix: drive cheap `/health` traffic concurrently with the `collectGarbage` call** — after patching, every checkpoint read `gc_forced=true` at ~790 ms. This affects `floor-probe.mjs` and `take-snapshot.mjs`. The failure is silent in the worst way: a first control arm read `gc_forced=false` on all five checkpoints (`gc_ms=48008`, i.e. 4× a 12 s budget) and the tool emitted the series anyway. The `gc_forced` field already existed and nothing read it — the guard in the wrong place, per the closing section of this file. **Discard any row with `gc_forced=false`; it is not a floor.**
- **A stale local Postgres presents as an auth/secrets problem.** 63 unapplied migrations made every authenticated route 500 on `column "created_by_client_id" does not exist`, and `profile:inference --action doctor` blamed Infisical for the down `api`. Neither the migration runner nor cfw-api's dev entry actually needs secrets — `scripts/db-migrate-local.ts` hardcodes the local URL, and `services/cfw-api`'s `bun run dev` only wraps `scripts/dev.ts` in `infisical run`. Call the inner scripts directly (`bunx tsx --tsconfig ./scripts/tsconfig.json scripts/db-migrate-local.ts`, then `bunx tsx scripts/dev.ts` with `PG_US_CENTRAL1_POOL_DB_URL` and `FAKE_PROVIDER_API_KEY` passed explicitly) when Infisical is unavailable. Check the applied-migration high-water mark before trusting a 500.
- **A shared checkout's `.git/index.lock` is contended when several agents work in linked worktrees.** Wait and retry; never delete the lock, and never `git stash` (see below).
- **Never call `Runtime.enable`.** workerd then pins every console argument — the instrument creates the retention it measures.
- **Keep the CDP socket warm through the settle.** The inspector reaps an *idle* socket, so the "not connected" first checkpoint comes from the silent pre-GC wait. Settling before connecting (P-004's fix) does **not** solve it — ANY silent settle triggers the reap. Sleep in ~500 ms slices with a cheap `Runtime.getHeapUsage` between them, and add a one-shot reconnect so a reap costs one checkpoint instead of voiding the series.
- **No edits to watched files mid-series.** A wrangler/Tilt reload silently recycles the isolate. Keep probe scripts outside the repo watch path.
- **workerd silently recycles isolates (~1,200 requests observed).** Tilt still says `ok` and logs no reload. The only reliable signals are the inspector's listening pid changing and the floor resetting downward. Run `recycle-watch.sh` for every series and treat a single unreadable checkpoint as suspect-recycle, not noise.
- **One results file per attempt.** A restarted arm appending to the same `--out` file leaves two rows per checkpoint, and joining the dead attempt's early floors to the live one's later floors fabricates a slope from nothing. `floor-slope.mjs` prefers the newest row and warns when a file holds superseded readings, but the safe habit is a fresh filename per attempt — and always sanity-check the printed `t` column for a backwards jump or a gap far larger than the pacing.
- **`X-Per-Chunk-Delay-Ms: 0` must be EXPLICIT.** An absent header means the fake provider's default delay: 8.4 s per drained stream instead of 0.28 s. At 30x, an 1,800-request series takes ~4.2 h and cannot finish inside the recycle window. The stream is byte-identical either way.
- **Two inspectors can expose `core:user:api`** when another worktree is running, and the stale one answers CDP calls happily. Disambiguate by the listening pid's cwd — never by heap size or responsiveness.
- **Never let a tool fall back to another CDP target.** A workerd inspector exposes ~19 targets, and most inspectors in a Tilt stack do not expose `core:user:api` at all (6 of them on the machine this was written on, each offering an anonymous uuid first). A `?? targets[0]` fallback therefore almost always "succeeds", and the series measures an unrelated isolate with nothing in the output saying so. Confirm the attached target — `floor-probe.mjs` records `inspector` and `target` on every JSONL checkpoint so a finished arm can be audited.
- **PubSub emulator OOM has two independent causes.** (a) Message retention: the emulator keeps published messages for `messageRetentionDuration` (7-day default) regardless of acks, so consuming or seeking frees nothing durable. PATCH every subscription to the 600 s floor, sending the **full body wrapper** `{"subscription":{...},"updateMask":"message_retention_duration"}` — the `?updateMask=` query form 400s. Measured: 99.96% → 83.64% of a 256 MiB cap. (b) The emulator's own heap: the PATCH bounds messages but **not** the JVM/process heap, so a 256 MiB lean-overlay cap can still OOM mid-series and take the inspector port down with it. Raise the container caps at runtime (`docker update --memory ...` on pubsub/minio/spanner) before a long arm. Apply both regardless of whether this stack shows the cap, for arm parity.
- **Never run `bun run format` / `lint` / any formatter mid-series.** They rewrite watched files, which restarts the worker and recycles the isolate. P-005 lost a 600-request series this way. Do all formatting *before* the first request, and treat the series window as read-only for the repo.
- **Enable minio-s3 / fake-gcs (and their init jobs).** A lean Tilt profile leaves them off, and the resulting prompt-upload retry strings inflate the floor — 568 upload failures invalidated P-003's first run.
- **`tilt logs` is a truncated ring buffer.** Grep counts on it plateau on a perfectly healthy run; it is not a liveness signal. Use the probe's own per-checkpoint progress lines.
- **`tilt down` leaves wrangler `serve_cmds` listening.** Kill only your own worktree's workerd pids on teardown; verify others' are skipped.
- **workerd has no `WeakRef`.** Any "hold it weakly" fix design is dead on arrival.
- **Artifacts die with the stack.** Echo every number into the live transcript as it is measured; do not plan to read a file back after teardown. Corollary: a captured snapshot is irreplaceable once the isolate is gone, so never point a floor-read or a re-run at an existing capture's path.
- **A snapshot must observe the same quiet state as a floor read.** Settle and force GC twice before `takeHeapSnapshot`, exactly as for `getHeapUsage`. Snapshot counts rarely align with checkpoint counts (900 against every-200 does not), so this cannot be left to a checkpoint that happened to run — otherwise still-unwinding teardown is counted as retention and inflates the class counts the verdict rests on.
- **A guard process that dies silently is worse than no guard.** Anything watching a long series (retention shrinker, recycle watcher) runs unattended for hours, so one transient rejection must not end it. Wrap each pass, and remember the emulator is least responsive exactly when the pressure it is guarding against is worst.
- **A fresh git worktree has no `node_modules`, and the failure looks like a broken test rather than a broken environment.** This repo resolves dependencies through **per-package** `node_modules` (bun workspaces), so a worktree created for an isolated arm or a parallel agent starts with none and `bun test` dies at preload with `Cannot find module '@traversable/zod'` before any test body runs. Fix with `bun install --frozen-lockfile` in the worktree (~20 s, ~4,940 packages); use the flag so `bun.lock` is not rewritten. Verify with one known-good scoped suite before trusting any result from that tree — an unfixed worktree silently converts "tests pass" into "tests never ran". Related: `bunx ls-lint` recurses into worktrees placed *inside* the repo (`.claude/worktrees/...`) and reports the parent checkout's pre-existing camelCase filenames as failures; filter with `grep -v "^\.claude/worktrees/"` before reading the result as a regression.
- **A sampling profiler's `self ms` is wall time, not CPU — never size a candidate from it.** V8 charges each sample the entire gap since the previous one, so a frame that was merely *on the stack while awaiting I/O* is billed for the wait. On a streaming inference profile the mean sample gap measured **994 µs against a requested 100 µs interval** — every `self ms` and every "% of mapped JS" figure inflated ~10x overall, and up to 81x for individual awaiting frames (`pull` 81x, `postSpans` 31x, `read` 29x, `fetch` 17x). This manufactured a candidate that looked like 15 ms/req and was really under 0.01 ms/req. Rank by **sample count x requested interval**, not by wall-delta, and treat the ~10-sample noise floor (about 0.08 ms/req) as the resolution limit: a sub-millisecond candidate cannot be sized from a profile at all and needs a direct microbenchmark. Two corollaries specific to local runs: dev-only work is a large share of local CPU (fs-logs are the single biggest source of *spans*, so per-span overhead is overstated in volume as well as in export cost), and the ~0.5 ms/req keep bar prior campaigns used was itself computed against these inflated profiles — so candidates rejected under it may deserve re-screening in real `cpu ms`.
- **`git stash` is repo-global, so never use it to A/B a shared checkout while parallel worktrees are live.** Stash entries are stored per-repository, not per-worktree, and every linked worktree pushes onto and pops off the same stack. A `git stash` / measure / `git stash pop` cycle in the main checkout can therefore pop *another* worktree's entry — landing its edits in your tree while yours stays buried under a label naming someone else's branch. Recovering means reading `git diff --name-only 'stash@{N}^' 'stash@{N}'` across the whole stack to work out which entry is whose. To compare a candidate against a baseline, use a separate worktree or `git worktree add` a detached checkout; to park work, commit it on a scratch branch. If a crossed pop already happened, re-stash the foreign files under an explicit `RECOVERED-...` label rather than reverting them.
- **`node` on a machine with a lazy fnm shim is not usable for these scripts.** Every probe dies with hundreds of `command not found: _load_fnm` followed by `maximum nested function level reached; increase FUNCNEST?`, which looks like a script bug and is not. Invoke the real binary (`/opt/homebrew/bin/node`, v26+) directly.
- **`scripts/db-migrate-local.ts` exits 0 having done nothing under `tsx`** — its `runIfCalledAsScript` guard does not fire, so a stale database looks migrated. Import and call `dbMigrate()` from a throwaway wrapper outside the repo instead, and verify the applied count against the migrations on disk.
- **Do not background a probe through `| tail -N`.** stdout buffers until exit, so a series that is running fine looks hung for hours. Tail the JSONL the probe writes, not its log.
- **Two concurrent workers both expose `core:user:api`, and `--cwd` matches both.** Disambiguate by process start time or ppid; a `--cwd` match is not sufficient once a second stack is up in the same tree.
- **Compile prerequisites before `tilt up`.** `packages/chat-templates` needs `bun run compile` or wrangler cannot resolve its `./dist/index.js`. A `migrations-status` failure on the Spanner probe alone does not block `api` — ignore it.

## Findings registry

### Shipped fixes (proof the method works)

| PR | mechanism | effect |
|---|---|---|
| [#33901](https://github.com/OpenRouterTeam/openrouter-web/pull/33901) (L-007, from P-001) | `DbContextStore.pending` strand pinned the per-request DB graph; plus a reviewer-found late-`dbRead` re-cache gap (`isCacheReleased`) | per-request DB graph O(requests) → O(1); ~15.7 KB/req; 2,401 → 0 retained graphs at 2.4k requests |
| [#34035](https://github.com/OpenRouterTeam/openrouter-web/pull/34035) (L-010, from P-003) | Two co-equal strands on the aborted-stream `EdgeStream` graph: constructor arrows capturing `this`, and a stack-capturing `DOMException` from a no-argument `abort()`. Cut both — either alone frees nothing. **The reason must be a plain string, not merely "explicit"** — see the abort-reason entry below | abort-shape slope 43.2 → 2.7 KB/req (−94%), leak → plateau; `EdgeStream` 215 → 10; drained shape unchanged |

`#34035` also reaches cfw-embeddings-api, cfw-rerank-api, cfw-video-api and cfw-stt-api via `packages/network`; only the cfw-api chat-completions abort path was measured.

### Probed shapes

| shape | verdict | attributable slope |
|---|---|---|
| non-streaming chat-completions (P-001) | **leak** → #33901 | ~61.5 KB/req |
| streaming chat-completions (P-002) | plateau | 1.0-3.8 KB/req |
| client-aborted streaming (P-003) | **leak** → #34035 | ~40 KB/req |
| Anthropic Messages streaming, drained (P-004) | plateau | 1.0 KB/req (raw 8.9, control 7.9) |
| cache-wired: miss/store, hit replay, response-size scaling (P-005) | plateau (all three arms) | ~1 KB/req |

**All five rotation shapes are now probed: 2 leaks (both fixed and merged), 3 plateaus.**

**Aug 2026 re-probe of non-streaming chat-completions on post-fix main: PLATEAU, and structurally so.** 1,800 requests, 10/10 checkpoints with `gc_forced=true`, 4/4 GC cycles and 4/4 floor samples every row, zero failures, byte-identical shape, no isolate recycle. Median **215 B/req** raw, endpoint 901, OLS 765 at R²=0.657 (the tool flagged OLS at 3.6x median, so the median is the read), and per-block deltas decay monotonically to ~80 B/req. Control arm on `/api/v1/auth/key` (800 req, `--pace-ms 300`): median 131 B/req. **Control-subtracted ≈ 84 B/req** — note both arms sit far below the ~8-9 KB/req generic churn documented above, so with a *working* forced GC this stack is much quieter than the P-001..P-005 snapshot; re-derive the churn baseline rather than inheriting that figure.

The structural check is what makes it a verdict rather than a small number: across the 900 → 1,800 doubling **every** per-request class sits at ratio **1.00** (`EdgeStream`, `Router`, `FakeAdapter`, `DBRequestContext`, `CloudflareClientCancelationDetector`, `SpanImpl`, `BaseContext`, and every plugin — each count=1, i.e. constructor closure plus name string, no instances), node delta 446 of 1,694,338, moved-class byte delta **0.00 MB**, scope population 183,330 → 183,337. The top-40 object classes are entirely Zod schema infrastructure, and the largest scope resolves to `AccessorPair` getters on `ZodString`/`ZodObject` — module-level and request-independent.

Scope this claim carefully when citing it: it covers **one shape on post-fix main** and says nothing about streaming, aborted streams, fusion, large bodies, or the modality workers. Caveats on the arm itself: the control ran on the same isolate as the arm rather than a fresh one, usage-record was down (~9 `Worker not found` per request, arm-symmetric and bounded by the flat control), and one manual 400 KB request contaminated the block reading 440 B/req (the median is over 9 blocks and the last four read 267/163/121/79, so it does not carry the verdict).

**Aug 2026: drained streaming and client-aborted streaming are ALSO plateaus on post-fix main.** With non-streaming already measured, **all three highest-traffic chat-completions shapes are plateaus**, and both historically-confirmed leaks are structurally verified fixed.

| shape | median | endpoint | OLS / R² | control-subtracted | verdict |
|---|---|---|---|---|---|
| drained streaming (1,800 req, 0 failures) | 233 B/req | −39 B/req | 316 / 0.229 | **181 B/req** | plateau |
| client-aborted streaming (1,800 req, 0 failures) | 42 B/req | 48 B/req | 33 / 0.526 | **~0 B/req** | plateau |

The structural check is the verdict, not the slope. Drained 900→1,800: node delta 503, every watched class at ratio **1.00**, `EdgeStream`/`Router`/`FakeAdapter`/plugins present only as `string`+`closure` at count 1 (**zero retained object instances**), `AbortSignal`/`AbortController`/`DOMException`/`Request`/`Response` **absent**, `CppgcShim` 101→101, moved-class byte delta **0.00 MB**. The abort arm is the sharper result: **zero retained `EdgeStream` and zero stack-capturing `DOMException`** against the **523 `EdgeStream` at 900 requests** that defined the P-003 leak — so #34035's cut is confirmed in the object graph, not merely in a slope.

Two methodology corrections from these arms. **Re-derive generic churn from your own control**: it measured **~52 B/req** here, not the ~8-9 KB/req inherited from the P-001..P-005 rotation, and both real arms came in at or below that inherited figure — anyone using it as a noise floor would have dismissed two genuine signals as noise. And the control's own OLS read **−1,049 B/req at R²=0.601** from a single −1.48 MB GC-recovery dip, with the tool correctly warning OLS was −20x the median: a live example of why the median headlines and OLS is a shape diagnostic only.

Caveats on the abort arm, since they bound the claim: its 1,800 checkpoint, snapshot and final floor read `cdp: unreachable` because the worker was killed at request 1,800 (all 1,800 requests completed first), so the verdict rests on 8 of 9 valid blocks plus a same-isolate `drained-1800 → abort-900` structural diff; and that arm continued on the drained arm's isolate rather than a fresh one.

**Error-path abort shapes cannot be probed with healthy traffic.** The three sites fixed in [#36312](https://github.com/OpenRouterTeam/openrouter-web/pull/36312) are reached only on a timeout, a client abort, or a flagged moderation result — `fetchProviderWithDeadline`'s abort lives inside its `setTimeout` callback, and the moderation fanout aborts only on abort-or-flag. A `--shape drained` arm plateaus there for a reason that says nothing about the mechanism. Falsifying an error-path retainer needs a **forced-failure shape**; check reachability before spending an arm.

**A local large-body arm cannot resolve `BaseAdapter.fetch` body retention.** `sendToFSLog('adapters/base-fetch-request', { request: upstreamRequest })` re-stringifies the whole body under `waitUntil`, and `isFSLoggingEnabled()` is `!isProduction() && !isTest()` — so local dev carries a second full copy on exactly the path being measured. Confirm whether disabling fs-logging moves the baseline before reading such an arm at all.

P-004's static reading explains the plateau and generalizes: a fully drained stream always reaches `flush()`, which clears the staller intervals — an **aborted** stream can skip `flush()` entirely.

P-005 closes P-004's one flagged suspicion: `createInternalStreamCacheTap`'s `chunks[]` array is **not** a leak. It is closure-local to an anonymous `TransformStream` and dies with the stream graph — collectable precisely because the L-010 fix removed the strands that used to pin that graph. Its size-scaling arm also carries a methodology lesson: an apparent ×14 rise turned out to be a **response-size confound**, not O(response-bytes) retention. Always add a size-matched control before reading a size-scaling result.

### "Bounded" is not a verdict — size the entry, not the entry count

A module-scope cache that is bounded, FIFO-evicting, keyed on request-independent content, and carrying a comment citing the AGENTS.md per-isolate-cache exception can still be worth deleting. [#36125](https://github.com/OpenRouterTeam/openrouter-web/pull/36125) removed a 32-entry compiled-tool-schema validator cache in `packages/router/statistics/lazy-tool-schema-validators.ts` that satisfied every one of those conditions, because each entry retained a compiled JSON-Schema validator DAG: measured plateau **+4,461,116 B** with the cache against **+212,224 B** request-scoped, a **4,249,332 B** difference against a 49,820 B no-call control, with a checkpoint-40/32 ratio of 1.000113 confirming the bound really held.

The bound was doing its job. The bound was the wrong question. Two consequences:

- **Judge an isolate cache on `entries x retained bytes per entry`, not on whether it is bounded.** 32 entries of a compiled validator, a Zod schema, a parsed config, or anything holding an object graph is megabytes; 32 short strings is nothing. Ask what one entry *transitively* retains before accepting an exception.
- **The tradeoff is real and must be measured both ways.** Deleting that cache cost **+0.429 ms** median on a 63.6 KiB structural-schema workload while common agent-shaped requests were unaffected. Cache removals buy memory with CPU, so bring both numbers or the reviewer cannot weigh it.

Corollary for static sweeps: a grep for module-scope `new Map`/`new Set` over the Worker-reached packages returns ~158 declarations of which only ~5 are ever mutated after declaration — the rest are immutable lookup tables and are genuinely fine. The mutated handful is the whole surface, so this audit is cheap to run exhaustively. Do not treat declaration count as the finding.

### Abort reason: a string collects, an `Error` does not — and the pinned bytes are the whole scope

#34035's "no-argument `abort()`" framing is too weak, and reading it as "pass an explicit reason" leads to `abort(new Error(...))`, which retains exactly as much. Isolated in fresh-process V8 with `WeakRef` liveness on a sibling-allocated variable the aborting closure never mentions:

| shape | collected? |
|---|---|
| nested closure aborts, no reason | no |
| nested closure aborts, `new Error(...)` | no |
| nested closure aborts, plain string | yes |
| inline abort, any reason | yes |
| nested closure, `Error.stackTraceLimit = 0` | yes, every reason |

The `stackTraceLimit = 0` arm is the causal proof: the retainer is the **stack trace** captured when an abort constructs a `DOMException`/`Error` **from inside a nested closure**. The trace pins that closure's frame, and the frame pins every context-allocated variable in the enclosing scope — including variables the aborting closure never reads, because a *sibling* closure forced them into the shared context. So the retained bytes are the whole enclosing function scope, not the closure's free variables, which is why a three-line timeout callback can pin a serialized request body.

Four necessary conditions, all required: the abort is in a **nested closure**; the reason constructs a stack (absent, or an `Error`); the **signal is held externally** (a self-cycle collects — that is the L-009 refutation); and a sibling closure context-allocated the expensive variable. An inline abort is fine, so this is not a blanket sweep of every `abort()`.

Fixed on three timeout paths in [#36312](https://github.com/OpenRouterTeam/openrouter-web/pull/36312), matching `PREFLIGHT_STOPPED_ABORT_REASON` in `packages/network/edge-stream.ts`. Check `signal.reason` is unobservable before switching to a string; grep `abort(` with an `Error`/`DOMException` reason (or no reason) inside a nested closure whose signal is held externally to find any remaining retaining sites. Also note plain `this`-capture in a constructor arrow collects in plain V8 and needed workerd's native root to matter in #34035, so it is not an independent leak shape to grep for on its own.

### The productive CPU class: an unbounded, client-controllable multiplier

Five fixes in the Aug 2026 sweep were one shape, and it is worth naming because it predicts where the next one is. **A request field with no `.max()` in its Zod schema, used as a dimension in nested work.** A Worker isolate is single-threaded, so one request spending hundreds of milliseconds synchronously delays settlement of every already-started upstream `fetch()` the isolate is serving — the damage is to co-tenant requests, not the slow one.

| PR | mechanism | tail |
|---|---|---|
| [#36320](https://github.com/OpenRouterTeam/openrouter-web/pull/36320) | tail-scan of the message list per server-tool detail | 817 ms → 3.3 ms |
| [#36329](https://github.com/OpenRouterTeam/openrouter-web/pull/36329) | re-cloned a message's array once per redacted segment | 26.5 ms → 0.22 ms |
| [#36319](https://github.com/OpenRouterTeam/openrouter-web/pull/36319) | `replays.calls.some()` per `function_call_output` | 100 ms → 1.4 ms |
| [#36315](https://github.com/OpenRouterTeam/openrouter-web/pull/36315) | `[...acc, ...next]` rebuilt per message; `includes` in a loop | 42 ms → 3.7 ms |
| [#36307](https://github.com/OpenRouterTeam/openrouter-web/pull/36307) | re-serialized the conversation per `cache_control` marker | 23.7 ms → 0.34 ms |

**Screen on the schema, not the syntax.** The decisive step is reading the Zod schema for every dimension and recording whether it has a `.max()`. Known-unbounded as of Aug 2026: `messages` (`.array(MessageSchema).min(1)`, no max), `OpenResponsesInputSchema`, and `content`/`tool_calls` on `ChatMessageUnionSchema` — which is `.passthrough()`, so `tool_calls` is not validated at all. The only array cap in the chat-completions request schema is `stop` (`.max(4)`). `anthropicMaxMessagesCount = 1000` is **not** a cap; it is a middle-out threshold gated on `shouldCompress`. A dimension genuinely capped by schema, enum, or an enforced provider limit does not qualify no matter how quadratic the code looks — that reasoning retired roughly 25 candidates across the sweep, including every router-selection path (their outer dimension is the model catalog, not a request field).

**Screen on the tail, not the mean.** These fixes are worth 0.2 ms or less on a realistic conversation. The common shape is not the case that matters and a mean-based bar rejects all of them. Report tail, common shape, and a control arm that never enters the path.

**Constant-factor work is exhausted.** A source-mapped profile puts all of `packages/router` at ~18 ms/req, whose largest single frame is a one-line string comparison — pure call volume. Repeated campaigns have rejected sub-millisecond candidates (shared `TextEncoder`, byte-size fast paths, negative prefilters, `Buffer.from` vs native base64). Hunt unbounded tails or do not hunt.

**A wrong fixture discriminant is indistinguishable from a refutation.** Benchmarking with `type: 'server_tool_call'` instead of the real `'reasoning.server_tool_call'` routed past the hot path entirely and reported 0.034 ms for work that actually costs 847 ms. Before believing a "not a quadratic" result, assert the fixture reaches the code — count invocations, or check that the cheap and expensive arms differ at all.

**When the optimization is invisible in the output, a scaling assertion is the only real test.** On #36329 every output-comparing test passed with the load-bearing guard removed, because re-cloning per segment yields a byte-identical result. The fix was a calibrated scaling test: per-part cost measured 1.01x with the guard and 3.77x without across a 400 → 1,600 part range, bounded at 2.2x. **The calibration is the work** — a 400 → 600 pair only reached 1.81x on the broken arm and would have shipped a test that catches nothing. Measure the sabotaged arm to pick the sizes, then verify the test fails under sabotage and is stable under `--concurrent`.

### Multimodal payload retention is deliberate, and gated on first content write

Production OOM pressure is attributed to multimodal payloads staying resident, not to a per-request leak: `configs/terraform-monitors/monitoring/api_multimodal_payload_release.tf` exists because "the isolate keeps the payloads resident and memory pressure (`exceededMemory` kills) returns" when the release path throws. So the operational model matches the plateau result — this is a **peak/duration** problem.

`Router.#releaseMultiModalRequestInputs()` (`packages/router/index.ts:657-700`) is the mechanism, and by enumerating what it clears it documents that a multimodal payload has **five simultaneous holders**: `_rawRequest`, `_normalizedRequest`, `_currentAdapterRequest`, `#cachedEstimator.allImages`, and `_currentAdapter.estRequestTokens.{images,input}` — plus adapter-internal fields via `releaseRetainedRequestInputPayloads()`. Its own comments warn that some of these **share the same part objects** while the estimator ones are genuine Zod-parsed copies, so a bytes model must distinguish aliases from copies or it will overstate by several multiples. That comment is the authority on which is which.

**The retention is intentional and the trigger is the interesting part.** There is exactly one call site (`index.ts:4339`), passed as `onFirstContentWrite` to `flushAdapterResponse`, and it fires from `StreamBreaker` only on `#isContentChunk(chunk) && !didWriteTokens` (`packages/network/stream-breaker.ts:170-177`). The rationale is in the code: "Once a content chunk is written downstream the pipe is committed: no caller can retry with another provider. Notify so callers can release resources that were only retained to support fallback."

So the payloads are held **to support provider fallback**, and the exposure is every request that never commits a content chunk — upstream errors across all candidate endpoints, empty or refusal responses, client disconnect before first content, preflight/moderation/guardrail failures. Note the perverse shape: a request that fails over across three providers is both the longest-lived *and* holding payloads throughout, which is exactly what stacks worst under concurrency. `flushAdapterResponse` is the single shared path, so streaming and non-streaming both route through it.

**Both open questions here are now settled, and the answer is that no safe cut exists.** Every candidate was worked through:

- *Release when the endpoint list is exhausted* — structurally sound, fails on **duration**. Exhaustion is only discovered after the last attempt's stream ends (`index.ts:2680` fall-through, or the `!canRetryInvisibly` return at `:2524`), and everything downstream is `logTxAttempt` (audited: structure, counts and hashes only, no network I/O, sub-ms to low-ms) plus `#finalizeFailedSubmission`. It frees the payload for **~1 ms of a multi-second hold**.
- *Release on a terminal failure classification* — no such classification exists early enough. `canRetryInvisibly` derives from `pipeResult.downstreamCanContinue`, i.e. from the stream that just ended, so terminality is knowable only in that same ~1 ms window.
- *Release at 2xx instead of first content* — a **correctness bug**. Three producers land in the 2xx-to-first-content window and each re-serializes the payload to a *different* provider: pre-output refusal fallback (`index.ts:4376`), empty-response fallback (`adapters/base/index.ts:2158`), and any pre-first-token error becoming an invisible retry (`index.ts:2582-2591`). It would send `[OR_REDACTED]` images to the fallback provider.
- *Release on client disconnect* — the one case with no retry to protect, and it saves nothing: disconnect already exits the loop inside that same window.

So `index.ts:4401` is the earliest sound placement and **the residual exposure is inherent to supporting fallback**. Two sub-hypotheses died here too, both worth not re-chasing: adapters do **not** accumulate across a fallback chain (only one live adapter at a time — `_currentAdapter`, `_currentAdapterRequest` and `#cachedEstimator` are the sole slots and are nulled between attempts, so N-attempt retention is O(1) in payload bytes), and the opt-outs do **not** make the mechanism moot (classification samples at `DEFAULT_CLASSIFICATION_SAMPLE_RATE = 0.0025`, and `retainMultiModalRequestInputs()` has exactly two call sites — `shadow_models` requests and Mission Control/eval — so >99.7% of multimodal inference traffic is eligible).

**One live bug came out of this, on a different axis.** Because the release **mutates parts in place** and `find-matching-server-tools.ts:287` stashes `_callerMessages = rawRequest.messages` by *reference*, the fusion and advisor tools can read `[OR_REDACTED]` where they intend to recover the user's attachments (`fusion-tool.ts:210`, `advisor-tool.ts:261,311`) — defeating the stated purpose in the docblock at `fusion-tool.ts:205-209`. It is order-dependent on whether a content chunk preceded the tool call, so it presents as intermittently missing attachments rather than a hard failure. **In-place release plus an aliased stash is the general hazard**: any consumer that captured a reference before the release sees redacted data afterwards.

### The modality workers are swept and clean; the residue is unguarded schema edges

Two independent sweeps of `packages/embeddings`, `rerank`, `image-generation`, `video-generation`, `stt` and `packages/batch` / `services/batch-api` found **no unbounded same-dimension nested scan** — every multiplier is schema-bounded or genuinely linear. Notable: `services/batch-api/src/submit/` was written against this hazard class already (`BATCH_MODERATION_CHUNK_SIZE = 32` bounds the flush window, `run-batch-preflights.ts:221` deliberately builds a `Map` rather than calling `.find()`, custom_id uniqueness is a `Set`). Two shapes that *read* as rebuilds and are not: `mergeAdapterSKUItems` (`services/cfw-video-api/.../video-generation-job.ts:1565`) is passed `adapter.skuItems.slice(countBeforePoll)` — only that poll's delta, so total work is O(items) not O(polls × items), and that slice is load-bearing; and `resolveFrameUrl`'s `.find()` runs exactly twice per request across all six adapter sites, never inside a frame loop.

What the sweep did surface is not performance but **caps that are missing at the edge**:

- **An "uncapped" field may be uncapped by design — check for an offload path before proposing a cap, then check that path's *conditions*.** `STTInputAudioSchema.data` is a bare `z.string()` with no `.max()` (`packages/stt-interfaces/schemas/request/index.ts:6`), which reads as a missing bound. It is not: large base64 audio is meant to be offloaded into a Durable Object rather than buffered (`packages/stt/app.ts:28-36`), so a `.max()` would reject requests the architecture exists to handle. The real gap is one branch of the offload *condition*. `setupStreamingRequest` (`packages/supersize-streaming/setup-streaming-request-if-needed.ts:109-114`) offloads on an `x-offload-large-fields` header, on `content-length` over threshold, or on a **missing** `content-length` — that last only when `missingContentLengthBehavior !== 'buffer'`. The type defaults to `'stream'` (`:37`, `:54`) and STT is the repo's only opt-out to `'buffer'` (`services/cfw-stt-api/src/utils/setup-streaming-request-if-needed.ts:59`), so a chunked JSON upload with no `content-length` buffers an unbounded payload there while every other service streams it. **And then check the provenance before calling it a gap, because this one is deliberate.** `'buffer'` traces to [#20451](https://github.com/OpenRouterTeam/openrouter-web/pull/20451) — commit subject `fix(stt): require explicit offload gate without content length` — where a reviewer caught that streaming on a missing header would 400 any client omitting it. The reason it still holds: **STT offload is not transparent**, unlike chat or embeddings. Exactly one of 11 STT adapters sets `supportsOffloadedAudio = true` (`packages/stt/adapters/openai/index.ts:131`, Groq inheriting), and once the parser substitutes a placeholder, `packages/stt/routes/transcribe.ts:370-380` hard-400s every adapter that has not opted in. So switching to `'stream'` converts a chunked upload from "buffers unbounded but succeeds" into an **unconditional 400 for nine providers**. The DO path itself handles a chunked body fine (`process-stream-json.ts:826-830` forwards a `ReadableStream`), so the blocker is the adapter gate one layer up; the real fix is hoisting offload dispatch into `BaseSTTAdapter`.

Two durable lessons, and the second is the one that cost a wrong published finding. **A schema with no `.max()` is a *question*, not a finding** — find where the payload is actually supposed to live, and audit the conditions that route it there, because a conditional bound fails exactly on the branch nobody configured. But **an outlier configuration is a question too**: "this service is the only one that opts out" reads as an oversight and is just as often a recorded decision. `git log -S` on the option and the PR that introduced it settles in minutes what a static reading cannot, and the answer here inverted the fix — the one-word change would have been an availability regression, not a memory win. (Measured ~7x peak for an 8 MiB payload through the buffered pipeline: bytes → base64 → stringify → parse → decode → `File`; the 3.3x in an earlier note was low.)
- **TTS `speed` is an uncapped `zDouble()`** accepting negatives, with only the Azure adapter clamping it.

Both belong to the STT/TTS owners rather than to a perf sweep, but they are the kind of edge this method finds and should not be dropped on the floor. The general lesson: when one ingress path is capped, check whether a sibling path accepts the same payload uncapped — a cap that can be walked around is documentation, not a bound.

### Two retention shapes worth grepping for, with the discriminator that makes the grep honest

**A named local pinned across an await, versus an inline temporary.** `const body = JSON.stringify(x); await fetch({ body })` retains a second full copy of the payload for the whole await; `await fetch({ body: JSON.stringify(x) })` retains nothing extra. V8 does not clear a dead named local at a suspend point, but it never pins an inline temporary. Measured on fresh-process V8, 8 concurrent frames over 8.3 MB of serialized output, forced-GC heap read while suspended: named local **2.00x**, named local with `.length` read early **2.00x** (reading early does not help), inline temporary **1.00x**, holder-plus-take in a synchronous starter **1.00x**.

The discriminator matters more than the finding. Grepping `body: JSON.stringify` finds the *inline* form, which is the one that costs nothing — all 47 such sites in the Worker-reached packages were false positives. Grepping for a named local assigned from `JSON.stringify` and used after an await found the single real site ([#36310](https://github.com/OpenRouterTeam/openrouter-web/pull/36310), `BaseAdapter.fetch`). Two corollaries: the releasing starter must be non-`async` (an `async` wrapper names the body in a frame of its own and reintroduces the retention; an `async` *callee* is fine, also measured), and a fix like this is untestable inline — tests driven through the public method passed with the fix reverted, so extract the holder and assert on it directly.

**A size cap applied after the buffering it was meant to prevent.** `await request.formData()` materializes the entire body in Worker memory before any per-part check can run, so a `file.size > MAX` check afterwards rejects the request having already spent the memory. Cap the *read* instead — count bytes through a `TransformStream` and error the stream past the limit ([#36311](https://github.com/OpenRouterTeam/openrouter-web/pull/36311)). Two details: erroring the stream makes `formData()` **reject rather than truncate**, which is what stops a partial payload parsing as valid; and the over-cap status has to come from the byte counter, because a stream error surfaces through `formData()` identically to a genuine parse failure. A `content-length` precheck is not a substitute — that header is client-supplied and absent on chunked uploads. The general shape: any `await <fullyBuffer>()` followed by a size check is a bound that does not bind.

### Refuted — do not re-chase

- **R-14 — `upsertAppWithCache` / an unsettled cancellation promise as the abort-leak root.** Victims, not roots: one incoming edge each, and the promise provably settles. This is the finding that mandates incoming-edge histograms over BFS shortest-path.
- **R-15 (L-009) — `raceWithPreflight` loser cleanup as the abort fix.** The leaked listener is a self-cycle (the retaining `AbortController` is the same `EdgeStream`'s own field), and the ceiling was 31 B/req = 0.07% of the leak. Statically correct, functionally worthless.
- **Span attribute processing ahead of the sampling decision (Aug 2026).** The static reading is correct — `processAttributes` runs in the `SpanImpl` constructor (`packages/cloudflare/instrumentation/tracer.ts:258-261`) before `headSample()` at `:273`, unconditionally, and prod publishes at `HEAD_SAMPLING_RATE = 0.005`, so ~99.5% of spans sanitize attributes that are never exported. It is still **not worth fixing**: a direct microbenchmark puts it at 0.050 µs for a 5-key span and 0.29 µs for a 22-key span, so even at 120 spans/request the total is under 0.01 ms/req — roughly 50x below the keep bar. The hypothesis only looked large because it was sized from a sampling profiler's wall-deltas (see the wall-time-is-not-CPU trap in Environment traps above). Also worth recording: `forceSample()` (`context.ts:152-158`) retroactively flips every span in `activeSpans` to sampled, so any "discard attributes when unsampled" or "return a `NonRecordingSpan`" design is *unsafe* regardless of the payoff; lazy sanitization in `#serialize()` is the only correct shape, and it optimizes ~0.01 ms/req.
- **R-09 — adapter `#rawRequestBody` retention.** Read at completion; a fix needs a cross-adapter refactor.
- **R-12 — Messages-skin streaming payload accumulation.** ~0.45 MB at 4×4 against 19-34 MB of noise; would need ≥16 concurrency plus thinking blocks to be measurable.
- **P-005 — `createInternalStreamCacheTap` `chunks[]` accumulation** (P-004's flagged suspicion). Closure-local to an anonymous `TransformStream`; dies with the stream graph. All three cache arms plateau.

Also inherited from `cfw-fusion-isolate-memory`: `stream:false` vs `stream:true` is a red herring for memory; the core router pipeline plateaus rather than leaks; `performance.memory` lies and forced-GC snapshots do not.

## Scripts

In `scripts/`. Plain `node` (≥ 22), no repo imports, no build step — they are operator tools, deliberately runnable against a stack whose repo checkout must not be touched. Large snapshots need heap headroom: `node --max-old-space-size=8192 <script>.mjs`.

**On snapshot size.** `--max-old-space-size` raises the *heap* limit, not Node's 512 MiB maximum **string** length — a distinct ceiling that `JSON.parse(readFileSync(path, 'utf8'))` hits first and that no flag can lift. Captures reach 466 MiB in practice, so this is inside the working range, and the failure lands *after* teardown when the snapshot can no longer be retaken. `heap-graph.mjs` therefore parses the numeric sections straight out of a Buffer above that size (slower, and it says so). If you write your own one-off analysis script, import `loadSnapshot` from `heap-graph.mjs` rather than reaching for `JSON.parse` yourself.

| script | what it does | needs |
|---|---|---|
| `heap-graph.mjs` | Shared library, not a command: snapshot loader (handles captures past the 512 MiB string wall), forward + reverse adjacency, cut-aware reachability, scope-tag helpers, an argv parser, and median/OLS fitters. Import it when writing a lead-specific one-off | — |
| `floor-probe.mjs` | Drives the request series and writes the floor JSONL. `--shape abort\|drained\|messages\|nonstream\|control`; optional snapshots at chosen counts. Persistent CDP client, warm-socket settle, `--gc-cycles` GC+read cycles keeping the minimum, one-shot reconnect, refuses a wrong CDP target | worker URL, API key, inspector `host:port` |
| `floor-slope.mjs` | Median-of-block-deltas headline plus endpoint and OLS/R² diagnostics, per-checkpoint deltas with timestamps, monotonicity. Drops rows whose GC failed or whose floor was sampled fewer times than expected (`--include-short-samples` keeps them — this changes `n`), and warns when one block dominates the fit or the fitted window mixes `shape`/`target`/`inspector`. `--min/--max` to exclude warmup and post-recycle tails; `--since` when a killed attempt shares the file | series JSONL |
| `class-count.mjs` | Per-class instance counts with a per-type breakdown; two snapshots add a `ratioB/A` diff (~2.00 = request-correlated) plus the watch list across all node types, and report how many rows `--min-delta` filtered | 1-2 snapshots, request counts |
| `scope-total.mjs` | Aggregate scope population + workerd-native vs JS byte split; lists this snapshot's most populous scope tags | snapshot, request count |
| `incoming-edges.mjs` | Every incoming edge into a class or scope population, as a histogram; `--hops` for ancestors by distance. The retainer-finding entry point | snapshot, `--class` or `--scope-tag` |
| `trace-up.mjs` | Hop-by-hop ancestor aggregation, to name a strand's root and tell native pins from JS ones | snapshot, `--class` or `--scope-tag` |
| `identity-check.mjs` | Self-cycle vs external root for a candidate retainer — the L-009 refutation in one command | snapshot, `--scope-tag`, `--target` |
| `cut-sim.mjs` | The cut simulator. `--strand 'NAME=selector'` (node cuts, edge cuts, stack-frame and frame-owner cuts), all combinations, a `none` control row, freed instances/bytes/ceiling, survivor paths | snapshot, `--target`, strand selectors |
| `take-snapshot.mjs` | Forced-GC snapshot (or floor read) on demand, for the cheap structural check on a candidate build | inspector, out path |
| `find-inspector.mjs` | Lists workerd inspectors and their targets; `--cwd` disambiguates when two expose `core:user:api` | a running stack |
| `recycle-watch.sh` | Polls the inspector's listening pid and shouts when the isolate is replaced or the pid belongs to another worktree | inspector port |
| `pubsub-shrink-retention.mjs` | PATCHes every emulator subscription to the 600 s retention floor and seeks it; `--watch` re-applies as new subs appear | emulator host, project |

**Heap snapshots and series JSONLs are deliberately not committed** — snapshots run 200-500 MB each and a single investigation produces several. They are regenerated per investigation by `floor-probe.mjs --snapshot-at ...` or `take-snapshot.mjs`, and the analysis scripts take a path argument precisely so a fresh capture drops straight in. Write them to `/tmp`, and treat them as dead the moment the stack is torn down.

### Typical session

```bash
S=.agents/skills/cfw-isolate-leak-probing/scripts

# 0. locate YOUR inspector, and guard the series
node $S/find-inspector.mjs --target core:user:api --cwd "$PWD"
bash $S/recycle-watch.sh 65292 --cwd "$PWD" &
node $S/pubsub-shrink-retention.mjs --watch 90 &

# 1. baseline arm + a snapshot mid-series
node $S/floor-probe.mjs --api http://localhost:21762 --inspector 127.0.0.1:65292 \
  --shape abort --total 1800 --checkpoint-every 200 --pace-ms 500 \
  --out /tmp/probe/series-abort.jsonl --snapshot-at 900 \
  --snapshot-dir /tmp/probe --snapshot-tag abort

# 2. control arm on a FRESH isolate, paced
node $S/floor-probe.mjs --api http://localhost:21762 --inspector 127.0.0.1:65292 \
  --shape control --total 400 --checkpoint-every 100 --pace-ms 300 \
  --out /tmp/probe/series-control.jsonl

# 3. slopes; subtract control from arm
node $S/floor-slope.mjs /tmp/probe/series-abort.jsonl --min 200 --max 1000
node $S/floor-slope.mjs /tmp/probe/series-control.jsonl --min 100

# 4. structural check, then find and name the retainer
node --max-old-space-size=8192 $S/class-count.mjs /tmp/probe/snapshot-abort-900.heapsnapshot --requests 900
node --max-old-space-size=8192 $S/scope-total.mjs /tmp/probe/snapshot-abort-900.heapsnapshot --requests 900
node --max-old-space-size=8192 $S/incoming-edges.mjs /tmp/probe/snapshot-abort-900.heapsnapshot --class EdgeStream
node --max-old-space-size=8192 $S/trace-up.mjs /tmp/probe/snapshot-abort-900.heapsnapshot --class EdgeStream --hops 5

# 5. simulate the cut BEFORE writing any fix (tags from step 4, verified by holder edge)
node --max-old-space-size=8192 $S/cut-sim.mjs /tmp/probe/snapshot-abort-900.heapsnapshot \
  --target EdgeStream --requests 900 \
  --strand 'A=scope-edge:2061037:this' \
  --strand 'B=frame-owners:stopPreflight:DOMException'
```

## The defect class to watch for in these tools

Review of this toolkit surfaced the same bug shape repeatedly: **a tool that returns a confident answer while having verified nothing.** Three instances, all of which would have produced a published number from thin air:

- `floor-probe` fell back to `targets[0]` when the requested CDP target was absent, so a whole series could measure an unrelated isolate;
- `find-inspector` marked every listening port `<== MATCH` when no selector was passed — including ports serving a different worker;
- `trace-up` loaded a snapshot, traced nothing, printed its closing advice and exited 0 when given no selector.

When adding or editing a tool here, the test is not "does it work when used correctly" but **"what does it print when it has nothing to say?"** Silence, a default, or an unqualified success marker are all wrong. Fail loudly, name what was missing, and prefer failing *before* an expensive load. The same standard applies to statistics: a fit computed over rows whose GC failed, or a diff whose rows were all filtered out, must say so rather than reporting a number.

### And a second shape: the guard in the wrong place

A related run of findings was not missing safety mechanisms but **misplaced** ones — the instinct to add the guard was right, the placement was wrong:

- a length-validation check sat inside the `>512 MiB` parse branch, so the plain path almost every capture takes stayed unchecked and still accepted a truncated file;
- an identity audit ran over every row *before* the `--min/--max` window, so it warned on runs the operator had already narrowed correctly — and advised flags that could not silence it;
- `shape`/`target`/`inspector` were recorded per row "so a series can be audited", then never read by the tool that fits the series;
- `find-inspector`'s ambiguity advice keyed on `--target` alone, so a run that had already passed `--cwd` was told to pass `--cwd` — a dead end precisely when two stacks expose the same worker.

So after writing a guard, ask four questions: **does it run on the path that is actually taken; does it run over the data actually used; does anything read what it records; and is it keyed on the condition that makes it correct, rather than the one that was salient while writing it?** A guard behind an unreached branch, applied before the filter that matters, writing a field no consumer reads, or firing with advice the operator has already followed, is indistinguishable from no guard at all — and worse, it reads as covered.

## Improve this skill

Every run hits something the skill did not predict. Record a new environment trap as one line, a new refutation in the registry with its lead id, and a genuinely reusable script in `scripts/` — but keep one-off selectors out; they belong in the lead's own notes. If a slope family or a class-count number drifts, update it and bump `provenance-last-verified`.

## packages/routing + packages/network sweep (2026-08-23) — ground now swept

One genuine unbounded client-controllable multiplier found and shipped (#36382): `add-service-tier-endpoints.ts` rebuilt a filtered copy of the whole requested-slug set per endpoint, when only 4 constructed keys are ever probed. 2107x at the tail, 1.7x on the common shape.

**The distinction that retired ~20 candidates: request-dimensioned vs catalog-dimensioned.** A nested loop over the *endpoint catalog* is not this defect class — the catalog is ours, bounded, and not client-controllable. Retired on that basis: `apply-manual-order`, `apply-load-balance` (already memoizes), `by-parameters`, `disambiguate-display-names`, `add-superseded-provider-endpoints` (hard-coded 2 entries), `models/constructor.ts:145` (DB column).

**The correct pattern, for comparison:** `by-allowed-providers.ts:103` and `by-ignored-providers.ts:37` convert `only`/`ignore` to a `Set` **once, before** the endpoint loop. Same author intent as the tier step; the tier step was the one place it was missed. When auditing a new filter, check which side of the loop the `Set` is built on.

**Schema-bounded, so out of class:** `stop` (`.max(4)`), `shadow_models` (`.max(10)`), `fusion.analysis_models` (`.max(8)`), `auto_router.allowed_models` (`.max(1024)`), `quantizations` (uncapped length but 12 distinct values and a pre-built `Set`), `transforms` and `plugins` (uncapped but single-pass, ~1 and ~10 meaningful values).

**A cap that is not in Zod:** `models` / fallbacks are capped at 3 by `MAX_MODELS_IN_REQUEST` (`packages/models/helpers/get-raw-model-slugs.ts:6,44`), *not* by the schema — `openai-chat-completions/schemas/request.ts:331` is uncapped and marked `// TODO convert to zod schema`. It is bounded only on paths that call `getRawModelSlugsFromRequest`. All three skins do today; a fourth consumer would not inherit the cap. Do not read this one as schema-safe.

**`packages/network` is clean, and deliberately so.** SSE framing does not rescan from position 0 — `eventsource-parser/src/parse.ts:59-66` defers joining a chunk with no newline, and `:266-319` scan from a saved `searchIndex`. Comments at `:45`/`:62` record an earlier O(n^2) fix. Also verified clean: `accumulate-streamed-text.ts` (per-chunk scans on the delta; the leaked-token log reports an integer counter, not `accumulated.length`), `create-billing-stream.ts`, `stream-breaker.ts`, `edge-stream.ts`.

**Open, deferred on collision grounds:** `packages/network/sse.ts:412,486` fully `JSON.parse`es `#jsonErrorBuffer` twice per malformed line, with no size cap, truncating slice, or line-count cap — 30.2 ms -> 1.44 ms (21x) at 4000 x 200 B. Blocked only on #36183 and #36186 landing (both edit `sse.ts`, neither touches this region). Dimension is provider-controllable, not client-controllable, so it is weaker than the shipped findings on the axis that has mattered.

## Differential-verify against the real old file, never a reimplementation (2026-08-23)

Wave 14 reported "60,000 differential fuzz cases, zero divergence" on the PI allowlist masker (#36386). Re-running the differential against the pre-fix file taken **verbatim from `origin/main`** found divergence immediately — and the *new* code was the correct side. The perf fix silently also fixed a correctness bug: sequential `replaceAll` passes could match a placeholder an earlier pass had just produced, so caller text holding a literal `WL<n>` beside a masked span came back corrupted. Exhaustively over 14,406 small inputs: `masked` identical in every case, old restore failed the round trip **480** times, new zero.

**The procedure that works:** `git show origin/main:<path> > <dir>/zz-old-impl.ts`, import both, compare. Do not hand-write an "equivalent" old implementation — my first attempt at one had a subtly different span-merge and produced a false divergence that cost real time to chase. The file is right there; copy it.

**Corollary for reviewing an agent's work:** "zero divergence" is a claim about a harness, not about the code. Cheap to re-run, and it has now been wrong in both directions (a false negative here, a 15 ms/req false positive from profiler `selfTime` earlier). Re-run it.

**When a divergence appears, ask which side is correct before assuming the fix is broken.** The instinct is to treat divergence as "my change altered behavior." Half the time the old behavior was the bug, and that is the more valuable finding — it would have shipped undocumented.

## Structural tests: verify the metric actually separates the two shapes

Replacing a flaky timing ratio with a "deterministic structural" assertion sounds strictly better and is easy to get wrong. Three attempts on #36386 each **passed under sabotage** — i.e. were worthless — before one worked:

| metric | why it failed |
| --- | --- |
| output length | identical in both shapes by construction |
| `slice` call count | both shapes slice twice per span |
| sliced-*source* bytes | charges the length sliced *from*, which grows with span count even when linear — failed against the **fixed** code |
| sliced-*produced* bytes | worked, but needs `String.prototype` patching, which `no-extend-native` rejects |

What shipped instead: an **absolute ceiling** at a span count where the shapes are orders of magnitude apart (20,000 spans — ~11 ms linear, 3,571 ms measured under sabotage, bound at 2,000 ms). A ratio's denominator is the *small* arm, so scheduling noise there inflates it and flakes even when the code is linear; a ceiling only trips if the runner is ~100x slow.

**Every scaling assertion must be sabotage-tested, structural ones included.** A structural metric that cannot distinguish the two implementations is worse than a flaky timing test, because it looks rigorous and never fails.

## Short numeric literals in `not.toContain` are a flake source (2026-08-23)

#36340 went red on `credits-page-data.test.ts` asserting `not.toContain('999')` against a whole serialized body. No foreign credit was present — the body carried `org_credits_page_transfer_1787497019993`, a `Date.now()` nonce containing those digits. Across 200,000 plausible millisecond nonces, **1.70%** contain `999`: roughly a 1-in-59 red build, landing on **unrelated** PRs, which is the expensive kind.

Fixed in #36387 by asserting on parsed field values. A repo-wide sweep found **5** such assertions and only that one exposed — the distinguishing property is narrow: *a substring search against a whole serialized body, in a file whose fixtures embed a nonce*. Long unique literals (payment intents) are fine; that is the right check for "this string must appear nowhere".

## The no-instance-payload rule is honored — audited field by field (2026-08-23)

CLAUDE.md bans instance-level references to request bodies, because an instance field retains its referent for the object's whole lifetime — long after the last read, and straight through the upstream call where peak lands. Audited every long-lived object on the inference path against that rule. **No unreleased payload retainer exists.** Recorded so the class does not get re-suspected.

**Router** — five payload-reaching fields, all released by `#releaseMultiModalRequestInputs()`: `_rawRequest` (`:728`), `_normalizedRequest` (`:729`), `_currentAdapterRequest` (`:730`), `#cachedEstimator.allImages` (`:734`), and `_currentAdapter.estRequestTokens.{images,input}` (`:736-738`). The two `retain_reason` escape hatches are narrow: `retain_requested` has exactly two call sites (shadow dispatch, Mission Control), `classification` samples at 0.0025.

**Why `allImages` gets its own release line and the estimator's other arrays do not** — worth keeping, because it looks like a gap and is not. `getImages` → `getImage` *reconstructs* the part, producing a copy unreachable from the message graph, so it needs an explicit release. `getFiles` and `getInputAudioParts` return the *original* part references, so the in-place release reaches them through the shared objects. `getInputVideoParts` does rebuild (`get-input-video.ts:31-35`) and copies the payload string, but the estimator field is nulled at `index.ts:4276` **before** the upstream fetch and never re-read after, so it is dead before peak. A latent hazard if that ordering changes; not a live defect.

**BaseAdapter** — `#rawRequestBody` aliases the router's `_rawRequest` and is released in place. The three `#imageMap` holders (google-gemini, google-interactions, bedrock-converse) each override `releaseRetainedRequestInputPayloads()` to `.clear()`. `_debugData` is `Record<string, string>` and every writer stores a scalar id.

**Plugins** — all fields are scalars, enums, counters, or metadata records. The two holding a `BaseRequestUnion` (`FileParserPlugin.#cachedResult`, `WebSearchPlugin.#cachedResult`) are spread copies sharing the underlying part objects, so the in-place release frees them. **That is precisely why the release mutates in place rather than replacing the request** — replacing it would leave these copies holding the payload.

**Measurement** (upstream-401 path, 4 forced-GC cycles per floor):

| payload | retained after forced GC |
| --- | --- |
| 0 MB (control) | 0.22 MB |
| 0 MB (warm) | 0.36 MB |
| 1 MB | 0.31 MB |
| 4 MB | 0.31 MB |
| 4 MB (repeat) | 0.29 MB |

Flat at 0.22-0.36 MB across a 0 → 4 MB sweep, with the **zero-payload control inside the same band** — nothing payload-proportional to cut. Peak *excess* still scales, which is the structural per-copy cost rather than retention. The mechanism was confirmed to fire: 24 `released_multimodal_request_payloads` lines with `released_payload_chars: 4194326`, and zero `retained_multimodal_request_payloads`.

### Standalone `wrangler dev` gotchas

- **KV is unwarmed**, so `openrouter/fake` as a *model slug* 400s with "not a valid model ID". That is not FakeProvider being unreachable: a real model slug plus `provider: { order: ['fake-provider'], allow_fallbacks: false }` routes through the full parse/transform/serialize path and returns an upstream 401, which is what a peak probe wants. Use the provider override, not the model slug.
- A fresh worktree needs `bun install --frozen-lockfile` **and** `cd packages/chat-templates && bun run compile`, or `packages/token-utils/estimator/base-input.ts` cannot resolve `@openrouter-monorepo/chat-templates` and five router tests die at import.

## Peak memory under concurrency — the blind spot the floor probe cannot see (2026-08-23)

`floor-probe.mjs` drives requests **sequentially** and reads the post-GC floor, so it measures RETENTION. `exceededMemory` is a **peak** signal. An isolate that plateaus perfectly at concurrency 1 can still die at concurrency 8, because peak stacks and retention does not. `peak-probe.mjs` measures peak instead: fire C requests simultaneously, sample `Runtime.getHeapUsage().usedSize` as fast as CDP allows, keep the maximum, no forced GC (a forced GC would flatten the spike being measured).

**The verdict is not "peak grows with concurrency" — it must.** It is whether peak-above-baseline **per in-flight request** stays flat as C rises. Flat means peak stacks linearly and capacity is a provisioning question; rising means concurrency itself amplifies per-request cost, which is a defect.

### The measured amplification factor

| request payload | peak per in-flight request | ratio |
| --- | --- | --- |
| 256 KB | 2.72 MB | 10.9x |
| 1 MB | 7.30 MB | 7.3x |
| 2 MB | 14.40 MB | 7.2x |

**A multimodal request costs roughly 7x its payload in peak memory.** Against a 128 MB workerd isolate and a ~93 MB idle baseline, that leaves ~35 MB of headroom — about **two concurrent 2 MB requests** before OOM. That explains `exceededMemory` with no leak required, and it is consistent with this campaign's plateau verdicts: there is nothing left to find on the retention axis because retention was never the mechanism.

Per-in-flight cost measured **flat** (14.40 -> 12.30 MB, 0.85x) from C=1 to C=2 at 2 MB payloads, so the amplification is per-request, not concurrency-driven.

### OBSERVER STARVATION — the trap that makes this probe lie

The sampler shares the isolate's single thread with request handling, so **workerd samples the CDP channel less often exactly when load is highest.** Measured collapsing from **658 samples/sec at C=4 to 11/sec at C=8**. Fewer samples means a missed spike, which under-reports peak *precisely on the arms that matter*.

This does not merely add noise — **it inverts the metric.** A positive control built to be superlinear by construction (payload scaled with C, so C requests x C*64KB) was reported as `0.42x FLAT`. Its C=8 arm read *lower* than its C=4 arm despite carrying twice the payload, which is impossible unless samples were missed. The first real run had the same defect hiding in it: samples fell 64 -> 25 as C went 1 -> 16, so its confident "flat" verdict was partly an artifact.

`peak-probe.mjs` now records samples/sec per arm and **refuses to render a verdict** when density varies more than 3x across arms. A flat reading under starvation is an artifact, not a result. Practical consequence: a trustworthy run needs a NARROW concurrency range with LARGE payloads (C=1,2 at 2 MB gave 839 vs 939 samples/sec) rather than a wide sweep — a wide sweep is what starves the observer.

### Connection shape differs from the Tilt-hosted inspector

A standalone `wrangler dev` inspector exposes exactly **one anonymous UUID target** on `/ws`, not `core:user:api` on a per-target path. Two further differences, both of which silently fail the connection:

- **It rejects the upgrade when an `Origin` header is present** — the exact opposite of the Tilt inspector, which requires `devtools://devtools`.
- **Run the probe under `bun`, not `node`.** Node's undici WebSocket client fails the upgrade against this inspector with or without the header.

The named-target rule still holds (never fall back — a wrong-worker series looks valid), with one narrow exception: when the inspector exposes exactly one target it is unambiguous, and the probe prints which target it attached to.

### A 401 from the upstream still exercises the request path

The peak signal is dominated by request-side bytes — parse, transform, serialize — all of which happen *before* the upstream call. A FakeProvider `401` (wrong `FAKE_PROVIDER_API_KEY`) therefore still measures the path of interest, confirmed by peak scaling cleanly with payload size across 256 KB / 1 MB / 2 MB. Useful when another session already holds the fake-provider port with a different key: do not kill their process, and do not mutate shared endpoint rows — just measure on the 401 path.

## Trace EVERY consumer before claiming a value is unused (2026-08-23)

Two hypotheses collapsed in one afternoon, both from the same mistake: **stopping at the first function that confirmed the expected answer.** One was caught before any code shipped; the other had already been published and had to be retracted.

**Case 1 — a near-miss that would have shipped a silent regression.** The claim was "the prompt classifier discards all image parts, so the enqueue can strip them." Evidence: `getTextFromMessage` (`packages/classifier/build-classifier-text.ts:60`) filters to `part.type === 'text'` and drops the rest. True, and irrelevant — `buildClassifierInputFromMessages` returns `{ text, imageParts }`, and a *separate* extractor `getImagePartsFromMessage` (`:83`) deliberately pulls base64 data URLs out. Those feed a dedicated vision sub-classifier (`Gpt5NanoTaskTypeClassifier`, selected at `classifiers/task-type-classifier.ts:267`) and get hashed into the tag cache key. A blanket text-only strip would have degraded every multimodal classification to text-only, invisibly to any test that only checks text.

Caught before any code shipped. The narrower true statement — images are selectable only from system/developer, first-user and last-user messages, capped at `MAX_CLASSIFIER_IMAGE_PARTS` — required reading *all* the consumers, and **that** is what #36421 ships. Nothing about that PR is invalidated by this entry; it exists because the first version of the idea was wrong and the audit produced a correct, narrower one.

**Case 2 — a published claim that had to be retracted (#36411).** "Post-response peak scales with payload and stacks across sequential requests," from a 1 MB and a 4 MB measurement both showing ~2.2 MB of excess. The excess is a **fixed** ~1-2 MB across a 32x payload range; it looked proportional only because both arms' absolute peaks scale. A zero-payload control would have shown 2.2 MB there too and killed it in one run.

**The rule:** before claiming any part of a payload is unused, `grep` for **every** reader of the field and read each one. The first reader that projects the data down is evidence about that reader, not about the field. And before claiming a quantity scales, include a **zero point** — a control where the dimension is absent — because a constant plus a scaling baseline is indistinguishable from a scaling quantity when you only sample the middle.

**Corollary worth noting:** the codebase's own tests would have caught case 1 (`build-classifier-text.test.ts` asserts `imageParts` equals specific URLs in six places). The gap was in the reasoning, not the coverage — which is the argument for running the existing suite against a hypothesis *before* building on it, not only after.

### Post-response peak exists, but holds nothing — and does not stack

A single request's peak profile shows two humps, the second landing after the response has shipped:

| decile of window | peak above baseline |
| --- | --- |
| 50-70% | 15.6 MB — the upstream call |
| 80-100% | 25.1 MB — after the response returned |

**That second hump is real but it is not retention, and chasing it is a dead end.** Three checks refute the retention reading, all of which were run after the finding was first written down:

**1. It does not survive a forced GC.** Resident heap after forcing GC post-response, measured across a 32x payload range:

| payload | uncollected level after response | resident after forced GC |
| --- | --- | --- |
| 0.25 MB | 3.52 MB | 0.46 MB |
| 1 MB | 9.95 MB | 0.73 MB |
| 4 MB | 23.18 MB | 0.15 MB |
| 8 MB | 43.73 MB | 0.64 MB |

Sub-megabyte residency independent of payload. The bytes are **free-but-uncollected**, not held. A flat post-response level proves nothing on its own, because workerd does not GC an idle isolate — that is the same trap as the `collectGarbage`-hangs-when-idle entry above, in a new costume.

**2. The excess is a constant, not payload-scaled.** Median of 3 with comparable sampling density:

| payload | peak-after minus peak-serving |
| --- | --- |
| 0.25 MB | 1.14 MB |
| 1 MB | 1.27 MB |
| 4 MB | 2.21 MB |
| 8 MB | 2.19 MB |

Roughly 1-2 MB across a 32x payload range (an independent run with a zero-payload control read 2.20 MB there too). It is a fixed post-response allocation — log/metric/ClickHouse-row assembly — not the payload. **The original 1 MB/4 MB pair looked like scaling only because both arms' absolute peaks scale; the excess between them does not.** Two points and no control is what made it look real.

**3. Sequential requests do not stack.** If post-response work held the payload into the next request, N back-to-back requests would peak ~N x:

| N (sequential) | actual | linear retention predicts |
| --- | --- | --- |
| 2 | 1.71x | 2.00x |
| 4 | 2.40x | 4.00x |
| 8 | 2.56x | 8.00x |

Sublinear and saturating. A `concurrent` positive control stacked as it must (1.68x at N=2, 2.88x at N=4), so the instrument can see stacking — it simply is not there sequentially. Back-to-back looks like stacking at N=2 only because V8 has not collected yet.

**The classification retain hatch also holds nothing.** Forcing `shouldClassify` true and confirming via `retain_reason: 'classification'` that the release was skipped entirely: residency 0.11 MB at 1 MB payload, 0.06 MB at 4 MB, stacking curve unchanged. The latch defers release, but the payload becomes unreachable anyway when `submit()`'s frame dies.

**What the two checks worth stealing are:** (a) force a GC before believing any residency number, and (b) run a stacking arm with a concurrent positive control before claiming work from request N reaches request N+1. Either one would have caught this before it was written down.

**One residual that cannot be measured locally.** `classifyPrompt()` returns early on `!isProduction()`, so the classification consumer never runs on a local worker. In production it does, and it makes ~3 full payload copies — `JSON.stringify(opts)` over intact `messages` (`packages/queues/tasks/classify.ts:30`), then base64 (+1.33x) at `packages/queues/client.ts:117`, then an outer stringify — for an estimated ~3.5-4x payload post-response at roughly 0.25% of requests (`DEFAULT_CLASSIFICATION_SAMPLE_RATE = 0.0025`). That is a **fat tail rather than a shifted mean**, and it is the only surviving payload-scaling post-response candidate. Note `getText` already flattens image parts to `<image>`, so the `messages` field may be redundant with `prompt`.

### The ~7x serving cost is structural, not waste

Worth recording so nobody re-hunts it. A plain-text payload costs the same as a base64 image payload (7.2x vs 7.2-7.8x across repeats), so there is no image-specific decode waste. The arithmetic closes on generic string cost:

| component | 2 MB payload |
| --- | --- |
| wire body (UTF-8) | 2.0 MB |
| V8 string for it (UTF-16, 2 bytes/char) | 4.0 MB |
| parsed JSON's own materialization | 4.0 MB |
| outbound serialized body (UTF-16) | 4.0 MB |
| **total** | **14.0 MB** vs 14.4 MB measured |

Two corollaries verified separately: object spreads **share** the big string rather than copying it (so `{...part}` in a transform is free), and `base64ToBlob` already uses `Uint8Array.fromBase64` with a documented fallback. The outbound copy was already cut by #36310. An earlier release point is the only remaining lever on the serving hump, and #36359 documents why no safe cut exists there (provider fallback needs the original inputs).

**Also: `heapUsed` in node cannot measure this.** Blob and ArrayBuffer bytes are external to the JS heap, so a node-side `process.memoryUsage().heapUsed` harness reports ~0 MB for an 8 MB Blob and would refute a real finding. Measure peak against the workerd isolate over CDP.
