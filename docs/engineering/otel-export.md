# Intern OTel export: scoping and sampling

What an intern VM exports to Datadog, and why the export is smaller than the
set of spans ori produces. This describes the pipeline as it works on `main`;
decision history lives in Git and Linear, not here.

- **Source:** `services/cfw-intern-provisioner/src/clients/gcp-startup-script-otel.ts`
  (`buildOtelCollectorSection`) — pure, so the config a VM receives can be
  rendered and run locally
- **Tests:** `gcp-startup-script-otel.test.ts`, which parses the generated YAML
  rather than substring-matching it
- **Collector:** `otel/opentelemetry-collector-contrib`, pinned by
  `INTERN_OTEL_COLLECTOR_IMAGE`
- **Gated on:** `INTERN_DD_API_KEY`. Unset leaves the VM byte-identical to one
  provisioned before telemetry existed

## The traces pipeline

```
otlp -> memory_limiter -> filter/scope -> tail_sampling -> resource -> batch -> datadog
```

`filter/scope` sits ahead of the sampler deliberately. A span dropped upstream
costs the sampler nothing — no buffering, no decision, no cache entry — while
the same span downstream is paid for on all three. Logs and metrics do not
carry it.

## The scoping rule

Span-name prefixes in `EXPORTED_SPAN_EXCLUDED_PREFIXES` never leave the VM.
Currently `Otel` and `RuntimeHttp`.

**Exclusions are whole-prefix.** `RuntimeHttp.invoke`, `.goalRoute` and the rest
dispatch inside `RuntimeHttp.handleRequest`, so dropping a root while keeping a
child does not yield a smaller trace — it yields a broken one that still
consumes a sampler slot. Add a prefix only when every span beneath it is
uninteresting.

`Otel.*` is the tracer's own instrumentation. Filtering it is treating a
symptom: `runRunTraceMonitor` wraps a fiber that lives as long as the daemon, so
its span never ends and it keeps feeding its trace forever. ORI-1548 covers
whether a daemon-lifetime fiber should be wrapped in `Effect.fn` at all; this
hides it from the export and does not fix it.

ori installs its tracer over roughly 1,200 `Effect.fn` sites, but most
`framework/cli` prefixes are command paths that never run inside the daemon, so
they never export regardless. There is no need to exclude them.

## Tail sampling: what keeps a trace

Sibling policies are OR'd — a trace survives if any one keeps it.

| Policy | Type | Keeps |
|---|---|---|
| `errors` | `status_code` | any trace containing an `ERROR` span |
| `slow` | `latency` | any trace over `TAIL_SAMPLING_LATENCY_THRESHOLD_MS` (10s) |
| `runs` | `ottl_condition` | any trace carrying an `ori.run` span |
| `baseline` | `probabilistic` | `TAIL_SAMPLING_BASELINE_PERCENTAGE` (10%) of the remainder |

`runs` matches on the span **name**, because that is the only thing the root
span carries: `Effect.fn` names it and ori sets no marker attribute. Renaming
the root span silently stops this policy keeping anything, so a test pins the
name — if ORI-1512 changes it, change both.

### What the baseline percentage now covers

Much less than it reads. Runs are kept unconditionally by `runs`, and
`filter/scope` deletes the daemon's HTTP surface and self-instrumentation before
the sampler sees them. `baseline` is no longer what decides whether a run is
observable; it is the remainder policy for whatever ori grows next that is
neither a run, an error, nor slow.

### The reading that justified it

Before this change, a clean successful agent run of about two seconds produced
no `ori.run` trace at the collector, while a failing run in the same session was
kept whole by `errors`. The sampler's counters read:

```
otelcol_processor_tail_sampling_count_traces_sampled
  policy: baseline, sampled: false  -> 9
  policy: baseline, sampled: true   -> 1
```

That reading is over the whole scatter population — roughly eight `RuntimeHttp.*`
traces, one long-lived `Otel.*` trace, and `ori.run` — not nine dropped runs.
ori propagates no trace context, so every `Effect.fn` root is its own trace. The
conclusion stands on the policy definition rather than on nine observations: a
short successful run is neither an error nor slow, so it fell to 10%.

Measured on the local loop below, sending 20 short successful runs plus the
observed scatter through the generated config:

| | traces exported | `ori.run` kept | `Otel.*` | `RuntimeHttp.*` |
|---|---|---|---|---|
| before | 5 | 1 / 20 | 13 spans | 21 spans |
| after | 20 | 20 / 20 | 0 | 0 |

## Changing this config safely

The collector unit is `Restart=always`, and new config reaches a VM only on
instance **creation** — the startup script strips its own metadata key after
first boot. A config that fails to load is therefore a crashloop across traces,
metrics *and* logs on every intern, recoverable only by reprovisioning. Two
gates, and the first does not subsume the second:

```bash
# 1. schema — catches unknown keys and bad shapes
docker run --rm -e DD_API_KEY=<32 hex chars> -v "$HOME/.cache/x:/cfg:ro" -v /:/hostfs:ro \
  otel/opentelemetry-collector-contrib:<pinned> validate --config=/cfg/config.yaml

# 2. a real start — catches everything else
docker run -d --name c ... <image> --config=/cfg/config.yaml
docker logs c 2>&1 | grep -E "unable to parse|failed to build|Everything is ready"
```

**`validate` does not parse OTTL.** Verified on 0.118.0: a `tail_sampling`
policy whose condition reads literally `this is not (valid ottl` passes
`validate` with exit 0, and the same config dies on start with
`failed to build pipelines: ... unable to parse OTTL condition`. Anything
carrying an expression — `tail_sampling` policies, `filter/*`, `transform` — is
invisible to `validate`. Boot it.

Three things that look like config errors and are not: the repo's fixture key
`ddfakekey0123456789` is rejected by the Datadog exporter at load (it wants 32
hex characters), `hostmetrics` fails without a `/hostfs` bind, and Colima does
not share `/tmp`, so a config mounted from there resolves empty.

`error_mode` belongs **inside** `ottl_condition`, not beside `type`. As a
sibling the collector rejects the whole policy with
`'policies[N]' has invalid keys: error_mode`.

A filter carrying only a `traces:` block is *accepted* in a logs or metrics
pipeline and silently does nothing there. It is not a startup error; it becomes
a live drop the moment someone adds a `logs:` block to it, which is why the
pipeline lists are tested.

## Local loop

`docker/compose.yaml` in the ori repo carries a collector profile on the same
pinned image (ORI-1546). Render the real config from `buildStartupScript` —
never hand-write it — then swap the `datadog` exporter for `debug`
(`verbosity: detailed`), bind the receiver `0.0.0.0` (the VM runs
`--network host`, so its loopback bind is correct there and unreachable under
port mapping), and drop `hostmetrics` unless that is what is under test. See
the `or-testing` skill's OTLP loop for the traps.
