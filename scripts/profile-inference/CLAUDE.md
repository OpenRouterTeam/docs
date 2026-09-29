# Agent Workflow for Inference Profiling

This harness profiles runtime CPU and isolate memory in the cfw-api inference
path: request validation, routing, adapter transformation, streaming, and
isolate heap pressure. Operate it through the noninteractive
`bun run profile:inference` entrypoint. Do not require a human to open mission
control, DevTools, or a database shell.

This harness does not measure Cloudflare's 1-second script-startup limit. For
startup changes, use the upload-timing workflow in the
[cfw-api startup optimization skill](../../.agents/skills/cfw-api-startup-optimization/SKILL.md).
For running-request CPU and memory measurement, use the
[cfw-api CPU and memory optimization skill](../../.agents/skills/cfw-api-cpu-memory-optimization/SKILL.md).

## Required workflow

1. Run `bun run profile:inference --action doctor` and parse the final
   `PROFILE_INFERENCE_RESULT=<json>` line or `.profiles/doctor-result.json`.
2. If setup is incomplete, execute each `next_steps` entry. Prefer
   `bun run profile:inference --action prepare`, which enables and waits for
   the local fake-provider, configures routing through the supported Kysely
   script and localhost-only Postgres URL, restarts cfw-api, and verifies a
   real inference response.
3. Give every measured run a unique deterministic `--artifact-base`. Never
   delete or overwrite an earlier run to make a retry pass.
4. Require `status: "succeeded"` and `incomplete: false` before interpreting a
   profile. A request succeeds only when its fully drained body parses as a
   complete, error-free response for the scenario's skin (see
   [Workload identity and response validation](#workload-identity-and-response-validation)).
5. Collect alternating baseline/candidate blocks with identical arguments.
   Use `--action compare` for compatibility checks and normalized directional
   deltas; it refuses pairs whose scenario, workload identity, sampling arm,
   or model output differ. Never claim a performance win from one local pair.
6. Record potential code fixes and evidence in the repository-root
   `CPU_MEMORY_FIXES.md`; implementation belongs in a separate change unless
   explicitly requested.

## How the harness works

1. The orchestrator provides `list`, `doctor`, `prepare`, `run`, and `compare`
   actions. Every action exits nonzero on failure and ends with a stable
   `PROFILE_INFERENCE_RESULT=<json>` record.
2. Tilt or `wrangler dev` exposes workerd V8 inspectors. The harness discovers
   the process family related to the cfw-api port and prefers the direct
   `core:user:api` inspector over Wrangler's heap-limited proxy. Use
   `--inspector host:port` only to override discovery.
3. The harness sends deterministic requests through local cfw-api to
   `fake-provider`, fully drains every response, and only then validates the
   body: a scenario-specific minimum size, then a skin-specific parse that
   requires a complete, error-free stream or JSON document.
4. CPU mode captures a V8 `.cpuprofile`, source-maps bundled `index.js` frames,
   and reports self and inclusive call-tree time.
5. Heap mode attempts a bounded forced GC, records whether workerd supports it,
   polls `Runtime.getHeapUsage` during requests, and measures after the run.
6. Every run writes a JSON sidecar containing the workload identity, git
   state, options, request status/latency/bytes/transport reads/model
   events/completion tokens, and mode-specific measurements.

## Workload identity and response validation

CPU, memory, latency, and transport numbers are only interpretable once two
runs are known to have done the same work and produced the same output. The
harness records both facts in the sidecar and `--action compare` gates on them.

**Workload identity** (`scenario.workload`) is the complete request
configuration the runner sends: the API base URL (`--api-url`), the endpoint
path, the SHA-256 of the serialized request body, the canonicalized request
headers (lower-cased names, trimmed values, sorted), the SHA-256 of the bearer
key (`--api-key`; the raw key is never written), the head-sampling arm
(`--sampling on|off|inherit`), and a digest over those six fields. Two
sidecars with the same `scenario.name` but different identities are rejected
with the differing field named, so a run against another worker or under
another account cannot masquerade as the same workload. `scenario.request_body_sha256` is kept for
sidecars written before identity was recorded; those still parse (schema
version stays `1`) but cannot be compared against a modern sidecar — re-run
them with the current profiler.

**Response validation** runs after EOF, never on partial reads. The body is
accumulated as bytes, decoded once, and parsed per skin:

- Chat Completions SSE: every `data:` frame is valid JSON, no error frame, no
  choice carries an `error` object or ends with `finish_reason: "error"` (the
  skin's mid-generation upstream failure signal, sent under HTTP 200), at
  least one choice was returned and every returned choice index ends with a
  `finish_reason` (a stream where only some of `n` choices finish is
  incomplete), `usage.completion_tokens` is reported, and the stream ends with
  exactly one `data: [DONE]`.
- Anthropic Messages SSE: `message_start` as the first model event,
  `message_stop` as the last, then the skin's trailing `event: data` / `data: [DONE]` sentinel (not
  part of Anthropic's own protocol, but what `/api/v1/messages` emits; a
  sentinel under any other event name, or none, fails the stream). Every
  event frame parses against the wire contract in `anthropic-wire-events.ts`:
  only the known event types are accepted (so an `error` or unknown event
  fails), `message_start` carries a `message`, `message_delta` reports both
  `usage.output_tokens` and a `delta.stop_reason`, and each `event:` name
  matches its `data.type`. Content blocks must be balanced: each index is
  opened once by a `content_block_start` carrying a `content_block`, receives
  `content_block_delta` (carrying a `delta`) only while open, is closed once by
  `content_block_stop`, and is never reopened; any block still open at
  `message_stop` fails the stream.
  `ping` frames and the `[DONE]` sentinel are validated as wire events but
  excluded from `modelEvents` and from the boundary check, so the skin's
  keep-alive ping emitted before the first upstream event or after the last
  one does not fail the stream.
- Non-stream JSON (either skin): a JSON object, not an error object, with a
  finish reason on every returned choice and no choice-level `error` or
  `finish_reason: "error"` (Chat Completions) or a stop reason (Anthropic
  Messages), and completion or output tokens.

A request that fails validation is a failed request even with HTTP 200 and
enough bytes; the sidecar keeps a bounded body snippet for diagnosis.

**Semantic totals** (`outcome_summary.modelEvents`,
`outcome_summary.completionTokens`) count parsed model events and reported
completion tokens. `responseChunks` is the number of transport reads and
depends on socket timing, not on model output, so it is a warning-level
signal only; `modelEvents` and `completionTokens` are compatibility gates.

**Model output digest** (`outcome_summary.outputDigest`,
`outcome_summary.distinctOutputs`) is the gate that catches two runs that
emitted the same number of events and tokens but said different things. Each
validated response is folded into a normalized output that keeps only what the
model produced, and the SHA-256 of that structure is the request's digest:

- Chat Completions (SSE and JSON): per choice index, the concatenated
  `content`, the concatenated `reasoning`, each tool call's `name` and
  concatenated `arguments` by tool-call index, and the final `finish_reason`.
- Anthropic Messages (SSE and JSON): per content-block index, the block
  `type`, concatenated `text`, concatenated `thinking`, tool-use `name`, and
  concatenated `partial_json` (or the serialized `input` for JSON), plus the
  final `stop_reason`.

Everything else is transport and is deliberately excluded: SSE frame
boundaries, comments, `ping` frames, the `[DONE]` sentinel, event counts,
chunk splits, ids, `created`/`model` fields, timestamps, and usage. Two streams
that deliver `Hel`+`lo` and `Hello` digest identically; `Hello` and `Hallo`
with equal event and token totals do not. Fields the folder does not model
(annotations, citations, images, audio, refusals) do not affect the digest, so
a scenario whose output differs only there is not caught by this gate.

The run-level `outputDigest` is the per-request digest when every successful
request produced the same output. When they did not, it is a digest of the
sorted distinct set and `distinctOutputs` is greater than one, and `compare`
refuses both arms of such a run as nondeterministic. Aggregating over the
distinct set rather than the ordered sequence is deliberate: measured
requests run concurrently, so completion order is scheduling noise, and
multiplicity is already gated by `run.requests` and `succeeded`. Sidecars
written before these fields existed still parse but cannot be compared.

## Local stack and preparation

Start a seeded local stack using [local-dev-env](../../.agents/skills/local-dev-env/SKILL.md) and wait for `uiresource/api`. If startup reports occupied ports, follow its instructions to stop the previous Tilt process and clear remaining service listeners.

Run these before collecting evidence:

```shell
bun run profile:inference --action doctor
bun run profile:inference --action prepare
```

`prepare` invokes `scripts/use-local-fake-provider.ts` with the canonical
localhost-only Postgres URL. It performs supported Kysely updates, warms KV,
restarts cfw-api, and waits for readiness. It does not launch or tear down the
shared Tilt stack. The package command needs no secrets and never prompts for
Infisical.

If doctor reports `machine_identity` failed, service startup is externally
blocked. Confirm the standard `INFISICAL_CLIENT` and `INFISICAL_SECRET`
environment is provisioned. Never ask a human to paste or print those values.

When alternating arms across two commits, `git checkout <sha>` makes Tilt
rebuild cfw-api, which takes the API port down for a while. A run started in
that window fails with "No process is listening on port 8787" and leaves a
`.result.json` stub that burns that artifact base (retries must use a new one).
After each flip, wait for `curl http://localhost:8787/health` to answer 200 and
let the rebuild settle before the next `--action run --prepare`.

For cleaner development-observability profiles, also make usage-record,
dev-fs-logs, and the Worker-facing OTLP receiver reachable. Missing sinks add
retry and serialization work that can dominate a local profile.

## Commands

```shell
# Machine-readable scenarios and defaults
bun run profile:inference --action list

# Diagnose all prerequisites and a real inference request
bun run profile:inference --action doctor

# Repair fake-provider routing, restart cfw-api, and diagnose again
bun run profile:inference --action prepare

# Prepare and collect a deterministic CPU profile
bun run profile:inference --action run --prepare \
  --mode cpu --scenario streaming-small \
  --artifact-base .profiles/baseline-1

# Profile one complete approximately 64-second, 2,048-token stream
bun run profile:inference --action run --mode cpu \
  --scenario streaming-many-tokens \
  --artifact-base .profiles/long-stream-1

# Same shape at 1 ms per upstream chunk (8,192 tokens in ~6 s), streaming and
# client-non-streaming; the slow scenario above is closer to production pacing
bun run profile:inference --action run --mode cpu \
  --scenario streaming-many-tokens-fast \
  --artifact-base .profiles/fast-stream-1
bun run profile:inference --action run --mode cpu \
  --scenario non-streaming-many-tokens-fast \
  --artifact-base .profiles/fast-json-1

# Measure heap peak and post-run floor
bun run profile:inference --action run --mode heap-peak \
  --scenario streaming-small --requests 4 --concurrency 4 \
  --artifact-base .profiles/heap-1

# Capture an in-flight heap snapshot; snapshots commonly exceed 200 MB
bun run profile:inference --action run --mode heap-snapshot \
  --scenario streaming-small --requests 1 --concurrency 1 \
  --artifact-base .profiles/snapshot-1

# Validate compatibility and report normalized directional deltas
bun run profile:inference --action compare \
  --baseline .profiles/baseline-1.json \
  --candidate .profiles/candidate-1.json
```

`run --prepare` combines fake-provider setup with a run. Direct core-script
invocation is reserved for harness development:

```shell
bun scripts/profile-inference/profile-inference.ts --mode cpu
```

## Options

| Flag | Default | Description |
|---|---|---|
| `--action <action>` | `run` | `list`, `doctor`, `prepare`, `run`, or `compare` |
| `--prepare` | false | Repair fake-provider routing before a run or doctor action |
| `--artifact-base <path>` | timestamped | Exact extension-free artifact base; existing artifacts are never overwritten |
| `--result-json <path>` | action-specific | Stable agent result contract path |
| `--baseline <path>` | — | Baseline metadata for `compare` |
| `--candidate <path>` | — | Candidate metadata for `compare` |
| `--skip-preflight` | false | Core-development escape hatch; agents must not use it |
| `--sampling <arm>` | `inherit` | Pin head sampling `on`/`off` for a sampled-vs-unsampled A/B; `on`/`off` require `--prepare`, and every run is refused unless cfw-api booted with the requested arm |
| `--mode <mode>` | `cpu` | `cpu`, `heap-peak`, or `heap-snapshot` |
| `--scenario <name>` | `streaming-small` | Scenario to run; use `list` to enumerate |
| `--requests <n>` | scenario-specific | Measured requests; the long stream defaults to 1 |
| `--concurrency <n>` | `4` | Maximum in-flight measured requests |
| `--warmup <n>` | scenario-specific | Unprofiled warmup requests; the long stream defaults to 0 |
| `--request-timeout-ms <n>` | scenario-specific | The long stream defaults to 90 seconds |
| `--sampling-interval-us <n>` | `100` | V8 CPU sampling interval |
| `--top <n>` | `30` | Rows in the CPU self/inclusive report |
| `--heap-poll-ms <n>` | `100` | Heap peak polling interval |
| `--snapshot-at-ms <n>` | `2000` | Delay from request start to heap snapshot |
| `--source-map <path>` | `auto` | Explicit map, newest active Wrangler map, or `none` |
| `--api-url <url>` | `http://localhost:8787` | Local cfw-api base URL |
| `--api-key <key>` | seeded development key | Bearer key for local requests |
| `--inspector <host:port>` | `auto` | Inspector address or process-based discovery |
| `--out-dir <dir>` | `.profiles` | Artifact directory |
| `--label <text>` | — | Sanitized artifact filename suffix |
| `--allow-failures` | false | Core compatibility flag; the orchestrator still rejects incomplete runs |

All numeric options are validated. The agent orchestrator remains strict even
when the core `--allow-failures` compatibility flag is used: incomplete
metadata produces a failed agent result and cannot be compared.

## Results and artifacts

Every action prints one final compact JSON record prefixed with
`PROFILE_INFERENCE_RESULT=`. Doctor and prepare write stable result files under
`.profiles/`. Runs write `<base>.result.json` even when the core profiler fails.

CPU runs write:

- `<base>.cpuprofile` — raw V8 profile;
- `<base>.index.js.map` — exact source map used by the report, when found;
- `<base>.json` — machine-readable run metadata and summary;
- `<base>.result.json` — agent status, paths, summaries, and next steps.

Heap peak runs write `<base>.json` and `<base>.result.json`. Heap snapshot runs
also write `<base>.heapsnapshot`, streamed directly to disk rather than held in
the harness process.

The source-map sidecar includes a SHA-256 hash. Automatic discovery selects the
newest `services/cfw-api/.wrangler/tmp/dev-*/index.js.map` in this checkout. If
cfw-api runs from another checkout, pass that Worker's map with `--source-map`.

## CPU interpretation and comparison

The report separates profile-window duration, attributed sample deltas,
source-mapped JavaScript, bundled/unmapped JavaScript, runtime/native frames,
and idle frames. It deliberately does not call elapsed profile time “CPU.”

### Read `cpu ms`, not `self ms`

**`self ms` is not CPU, and on this workload it overstates CPU by ~10x
overall and up to ~80x for individual frames.** V8 charges each sample the
entire gap since the previous sample, so a frame that is on the stack while
the isolate awaits I/O accrues that whole wait. A streaming inference request
spends most of its life awaiting upstream bytes, so the frames that *wait*
(`fetch`, `read`, `postSpans`, the streaming `pull`) dominate a `self ms`
ranking while doing almost no work.

The summary therefore reports both, per frame and in aggregate:

| Field | Meaning |
|---|---|
| `cpuEstimateMs` / `cpu ms` | `hitCount x sampleIntervalUs` — CPU-shaped. **Rank candidates by this.** |
| `selfTimeMs` / `self ms` | Sum of sample gaps. Elapsed-with-frame-on-stack. |
| `wallInflationRatio` / `infl` | `self / cpu`. Above ~2x the frame is mostly waiting. |
| `busySamples`, `cpuEstimateMs` | Non-idle samples and the whole-profile CPU estimate. |
| `meanSampleGapUs` | Mean gap between samples. Far above the requested interval means V8 could not sample at the requested rate, and every wall-delta figure is inflated by roughly that ratio. |

The printed summary emits an explicit `WARNING` when `meanSampleGapUs` is 2x
or more the requested interval. Treat any `self ms` reading in that regime as
elapsed time, not cost.

Note the sampling *interval* (`--sampling-interval-us`, a V8 profiler setting)
is unrelated to head *sampling* (`--sampling`, a tracing decision). Both
affect what a profile shows, in different ways.

### Development-only cost is called out explicitly

Two subsystems run locally and **not** in production, and together they were
42% of busy CPU in the reference `streaming-small` profile:

- the **dev span exporter** (`installDevSpanExporterIfDev`) protobuf-serializes
  every span and POSTs it to a local OTLP collector;
- **fs-logs** (`isFSLoggingEnabled`, on outside production and test — see
  `shouldEnableFsLogging` in `packages/clients/fs-logs/fs-logging-gate.ts`) POST
  every structured log, and each POST creates its own outgoing-fetch CLIENT span.

`devOnlyCpuEstimateMs` attributes these by **ancestry**, so the native and
vendor work a dev-only caller drives (protobuf writing, `Blob`, the egress
`fetch`) is charged to it rather than appearing as generic runtime cost.
Subtract it before reasoning about production, and never quote a local
percentage as a production CPU share.

The fs-log finding matters beyond its own cost: fs-logs are the **largest
single source of spans** in a local profile, so local span-related work is
inflated in *volume* as well as in export cost. A local profile is the wrong
instrument for sizing per-span overhead.

### Screening a candidate against a per-request bar

One sample is the quantum of resolution. At a 100µs interval over 12 requests,
one sample is 0.008 ms/request, so **a candidate resting on fewer than ~10
samples is noise** — roughly 0.08 ms/request. A ~0.5 ms/request keep bar needs
on the order of 60 samples in the relevant subtree before the profile can
speak to it at all. Below that, measure the candidate directly with a
microbenchmark on production-shaped input instead of dividing a profile.

For A/B comparisons:

1. Use identical mode, scenario, requests, concurrency, and sampling arm.
2. Require both JSON sidecars to have `incomplete: false`, matching workload
   identity, and matching `modelEvents` / `completionTokens` totals;
   `--action compare` enforces all three. Byte and transport-read counts
   should be close but are not gates.
3. Run multiple alternating baseline/candidate blocks with unique artifact
   bases.
4. Run `--action compare` for compatibility gates and normalized per-request
   directional deltas.
5. Compare `cpuEstimateMs`, not `self ms` and not wall latency.
6. Confirm a runtime win in production with normalized
   `cpuTime / upstream_chunk_count`.

The comparison action reports `directional_only`; it never calls a single
local pair a performance win. CPU comparisons require source maps and matching
scenario/run settings.

## Pinning the head-sampling decision

Local development force-samples every trace, while production samples a small
fraction. Any profile of trace-dependent work therefore overstates its
production share, and comparing a sampled local profile against production is
invalid.

**The zero-flag default is the unrepresentative arm.** `--sampling` defaults to
`inherit`, which removes the pin and restores the local always-sample default,
so a run with no flags samples and exports *every* trace. The
production-shaped arm costs two flags (`--prepare --sampling off`, since the
pin only reaches the worker through a restart) while the misleading one costs
none. The default is not flipped because `off` would force a cfw-api restart on
every plain `--action run`; instead, always state which arm produced a number,
and pass `--sampling off` for any claim about production.

`--sampling` pins the decision so sampling becomes an explicit variable rather
than a hidden constant:

```shell
# Sampled arm
bun run profile:inference --action run --prepare --sampling on \
  --mode cpu --scenario streaming-many-tokens \
  --artifact-base .profiles/sampled-1

# Unsampled arm, same scenario
bun run profile:inference --action run --prepare --sampling off \
  --mode cpu --scenario streaming-many-tokens \
  --artifact-base .profiles/unsampled-1
```

Mechanics and constraints:

- The pin travels as `OR_HEAD_SAMPLING_PIN` in `.env.development.local`, which `wranglerDevEnv()` layers into cfw-api's in-memory environment. The worker reads it at startup, so `--sampling on|off` **requires** `--prepare`; the harness rejects the combination without it rather than profiling whichever arm the worker happened to boot with.
- Before every measured run the harness reads the `.env.development.local` that `wranglerDevEnv()` resolves for this checkout and refuses to profile when the pin in that file differs from the requested arm — including a plain run (implicit `inherit`) while the worker is still pinned `on` or `off` from an earlier series. A missing file is a worker that booted with no override, which is `inherit`. Because the launcher reads the file once at boot and does not watch it, the harness also finds the process listening on the API port, reads its start time from `ps -o etime`, and refuses to profile when the file was modified after that boot: a file newer than the worker cannot describe the environment the worker loaded. The failure names both arms and the `--prepare --sampling <arm>` command that restarts cfw-api. Editing the env file by hand therefore never satisfies this check; only a restart does. `list`, `doctor`, `prepare`, and `compare` are not gated.
- This is a consistency check, not a readout of the running worker. The harness cannot inspect the environment inside workerd, so it establishes that the file predates the boot and matches the request. A file rewritten and then restored to its earlier contents before the worker restarted, a pin file deleted by hand after boot, or a worker started from a different checkout's `.env.development.local`, passes the check while the effective arm is unknown. `ps -o etime` has one-second resolution, so a same-second rewrite is treated as predating the boot. When the arm must be certain, use `--prepare`, which restarts cfw-api from the file it just wrote.
- `off` also suppresses request-scoped force-sampling, so neither
  `DATADOG_TRACE_SAMPLE_RATE` nor clean-baseline candidate force-sampling can
  sample part of an unsampled arm and confound the comparison.
- The pin is read **only** when `OR_ENV === 'development'`. It cannot change
  sampling in staging or production. This is deliberately not
  `OR_ENV=production`, which would alter unrelated behavior.
- `inherit` (the default) removes the pin and restores the always-sample local
  default, but only through `--prepare --sampling inherit`: the running worker
  keeps its boot-time pin until it restarts. Interleave arms (`on`, `off`,
  `on`, …) so drift does not align with one arm, and give every run a unique
  `--artifact-base`.
- **The pin persists until you clear it.** It lives in
  `.env.development.local`, which `wranglerDevEnv()` passes to *every* worker
  it starts, so an `off` arm leaves local tracing disabled across the whole
  local stack — not just cfw-api — for any worker running with
  `OR_ENV=development`. Always finish a series by restoring the default:

  ```shell
  bun run profile:inference --action prepare --sampling inherit
  ```

  In a linked worktree the pin is written to that worktree's own file, carrying
  the main checkout's overrides forward so they are not shadowed; `inherit`
  removes the pin while leaving those overrides in place.

Pinning sampling `on` does not make a local profile production-representative in
absolute terms — it makes the sampled and unsampled arms comparable to each
other. Report local shares as a comparison between arms, never as a production
CPU share.

## Profiling cold-isolate work

Router configuration (`KV_ALL`) is fetched once per isolate and then cached.
Default warmup excludes most first-request initialization. Capture it by
restarting cfw-api and setting warmup to zero:

```shell
tilt trigger api
bun run profile:inference --action run \
  --mode cpu --scenario non-streaming-small --warmup 0 \
  --artifact-base .profiles/cold-isolate-1
```

Compare this with the same scenario's warm profile.

## Heap interpretation

`heap-peak` performs this sequence:

1. a bounded `HeapProfiler.collectGarbage` attempt;
2. a `Runtime.getHeapUsage` baseline;
3. scheduler-friendly heap polling while requests are in flight;
4. a second GC attempt and post-run reading.

Current workerd builds may leave `HeapProfiler.collectGarbage` unanswered. The
harness falls back to unforced readings after a short timeout and records both
attempts in `heap.garbage_collection`. Treat `after_run` as a retained-memory
floor only when `after_run_succeeded` is true. Use repeated sequential requests
for plateau tests and concurrent requests for peak tests.

Heap snapshots are retainer diagnostics. Snapshotting forces GC, pauses
execution, perturbs the peak, and can produce hundreds of megabytes. Never
compare snapshot peaks quantitatively; use `heap-peak` for A/B measurements.

The heap implementation intentionally does not call `Runtime.enable`: workerd
would retain inspector console arguments and the profiler could manufacture
the memory growth it claims to measure.

## Failure handling

Every action exits nonzero on failure and writes a structured result when a
result path is available. Follow `next_steps` exactly, then retry with a new
artifact base. Do not bypass preflight merely to obtain an artifact.

Use the startup recovery instructions when another stack holds the required ports. Only one inspector client can attach at a time; close an existing DevTools client before retrying.

## Interpretation constraints

- The sampler under-reports slow streams. Per-frame CPU is dominated by
  per-wakeup cost, and the profiler cannot hold its interval across idle gaps:
  the `streaming-many-tokens` run that costs ~377 µs/token of workerd process
  CPU reports ~108 µs/token here, and the 1 ms-paced scenarios report ~29
  µs/token against ~121 µs/token of process CPU. Rank frames with the profile;
  quote costs from process CPU (`ps -p <workerd pid> -o time=` around one
  request) or production `cpuTime`. See the cfw-api CPU and memory skill,
  "Per-frame CPU is mostly per-wakeup CPU".
- Local workerd is not byte-identical to production Cloudflare.
- Development cfw-api enables fs-log POSTs and force-sampled tracing, while
  production disables fs-logs and samples only some traces. Local percentages
  locate hotspots; they are not production CPU shares.
- The profiler observes the whole isolate, including background and
  `waitUntil` work.
- Fake-provider scenarios exercise the core inference path but do not
  reproduce fusion's `ToolEventBroadcaster` replay-buffer retainer. Add a
  fusion-shaped scenario before using this harness as a fusion memory gate.
