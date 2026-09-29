---
name: dataflow-cpu-optimization
description: Find and validate CPU reductions in the usage-record Dataflow workers. Use when the generations lane sits above 80% CPU or before changing the pipeline for performance.
user-invocable: true
---

# Dataflow CPU Optimization

Use this when the `usage-record` generations Dataflow job (`services/usage-record/dataflow`) runs its workers near saturation and the goal is less CPU per generation. [`dataflow-staging-experiment`](../dataflow-staging-experiment/SKILL.md) owns how to launch, isolate and drain staging arms. This skill owns the CPU question, meaning what has been tried, where the CPU goes, and what counts as proof.

Removing a function from the profile is not the same as lowering worker CPU. A candidate ships only after a matched staging A/B shows lower CPU at the same input rate.

## 1. Read the prior art first

Every CPU thread here has been opened before. Search closed PRs by `talos` and Devin before forming a hypothesis, and read the ones for the surface you are about to touch.

| Surface | PRs | Outcome |
|---|---|---|
| Spanner client per process | [#42307](https://github.com/OpenRouterTeam/openrouter-web/pull/42307) | Shipped |
| Local DirectRunner idle CPU | [#44172](https://github.com/OpenRouterTeam/openrouter-web/pull/44172) | Shipped, dev only |
| Raw bytes through batching, hoisted insert dump | [#27045](https://github.com/OpenRouterTeam/openrouter-web/pull/27045), [#27046](https://github.com/OpenRouterTeam/openrouter-web/pull/27046) | Open drafts, never merged. Ruled out, see section 4 |
| State-cache sizing | [#27065](https://github.com/OpenRouterTeam/openrouter-web/pull/27065) | Open draft, never merged. Ruled out, see section 4 |
| Batcher topology | [#27043](https://github.com/OpenRouterTeam/openrouter-web/pull/27043), [#27068](https://github.com/OpenRouterTeam/openrouter-web/pull/27068), [#27076](https://github.com/OpenRouterTeam/openrouter-web/pull/27076), [#27031](https://github.com/OpenRouterTeam/openrouter-web/pull/27031), [#27512](https://github.com/OpenRouterTeam/openrouter-web/pull/27512) (still live, its revert [#27682](https://github.com/OpenRouterTeam/openrouter-web/pull/27682) was closed unmerged) | Set the current encode-boundary structure |
| Batch size and buffering | [#27030](https://github.com/OpenRouterTeam/openrouter-web/pull/27030), [#26828](https://github.com/OpenRouterTeam/openrouter-web/pull/26828), [#26673](https://github.com/OpenRouterTeam/openrouter-web/pull/26673) | Shipped tuning and batcher metrics |
| Gen-commit lane worker shape | [#41182](https://github.com/OpenRouterTeam/openrouter-web/pull/41182), [#41347](https://github.com/OpenRouterTeam/openrouter-web/pull/41347), [#41239](https://github.com/OpenRouterTeam/openrouter-web/pull/41239), [#41025](https://github.com/OpenRouterTeam/openrouter-web/pull/41025) | Bundle-scoped batching, SDK-process keys, machine type |
| Observability | [#27062](https://github.com/OpenRouterTeam/openrouter-web/pull/27062), [#27064](https://github.com/OpenRouterTeam/openrouter-web/pull/27064), [#26615](https://github.com/OpenRouterTeam/openrouter-web/pull/26615) (closed unmerged), [#26923](https://github.com/OpenRouterTeam/openrouter-web/pull/26923), [#27042](https://github.com/OpenRouterTeam/openrouter-web/pull/27042) | Cloud Profiler, A/B dashboard panels, staging deploy workflow |

An unmerged draft is a hypothesis somebody stopped measuring, not a proven loser. A shipped PR is a surface already harvested. Both are a reason to measure before re-implementing.

## 2. Establish the baseline before touching code

Confirm which lane is hot. Async-jobs and gen-commits are separate jobs with their own worker pools. Datadog (site `us5`, keys `DD_API_KEY` and `DD_APP_KEY`) has what you need.

```text
avg:gcp.gce.instance.cpu.utilization{dataflow_job_name:<job>}            worker CPU
sum:gcp.dataflow.job.current_num_vcpus{job_name:<job>}                   fleet size
sum:gcp.dataflow.job.elements_produced_count{job_name:<job>,pcollection:read_generations_json*}.as_rate()   input rate
avg:gcp.dataflow.job.system_lag{job_name:<job>}                           keeping up
max:gcp.dataflow.job.per_stage_data_watermark_age{job_name:<job>}         keeping up
avg:gcp.dataflow.job.backlog_elements{job_name:<job>}
```

Compute production CPU per generation once, as `vCPU x utilization / input rate`. Judge every candidate's expected saving against that number before building anything. A saving below about 2% of it will not be visible in staging.

## 3. Profile with Cloud Profiler

Cloud Profiler runs in the worker image. The deployment target and the `version` label are both the job name. Pull profiles through the v2 REST API as `devin-readonly`, which holds `roles/cloudprofiler.user` on openrouter-core. Sessions use it by default once the blueprint's `setup-gcp-oidc` step impersonates it. Base64-decode `profileBytes` into pprof files and aggregate with `pprof -top` and `pprof -peek`.

```bash
TOK=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOK" \
  "https://cloudprofiler.googleapis.com/v2/projects/openrouter-core/profiles?pageSize=200" \
  | jq '.profiles[] | select(.deployment.target=="<job>" and .profileType=="CPU") | {startTime, profileBytes}'
```

Profiles are 10 s samples that appear a few minutes after the job starts. Filter on `startTime`, check how many exist per arm, and aggregate at least six per arm before comparing.

Coders and `operations` run in Cython and never appear as their own frames. Their whole contribution is bounded by the flat time of the Python frames that call into them, `process_encoded` and `process_bundle`.

## 4. Findings

Measured on the generations lane in September 2026 with matched staging arms. Replace, do not append, when a newer measurement supersedes one.

**The profile is dominated by Beam's built-in metrics reporting, not by pipeline work and not by our custom metrics.** `monitoring_infos` and its children (`create_monitoring_info`, `to_key`, `get_short_id`) are 27 to 45% of samples. The pipeline's own DoFns under `process_encoded` are about 20%, with the Spanner write around 4% and `model_validate_json` under 3%. The cost is Beam rebuilding, once per completed bundle and once per progress poll, four execution-time counters per fused operation plus an element count and a sampled-byte-size distribution per output, none of it cached across bundles. Custom `Metrics` counters route through `int64_user_counter`, which does not appear in the profile, and a counter increment costs under 0.1 µs, so deleting or batching custom metrics saves under half a percent. No Beam option or Dataflow experiment lowers reporting or progress-poll frequency or disables size sampling. The only levers with the right shape are fewer fused operations per bundle, fewer bundles per second (a Dataflow service behaviour, not an SDK option), or an upstream Beam patch that keys the short-ID cache per operation instead of per built protobuf. Moving the dead-letter writers behind a reshuffle cut the hot stage from 21 to 17 operations and did not move CPU at matched input, so small graph edits are below noise.

**Per-worker CPU does not fall when workers are added at the same input rate, because the runner scales bundle size and not bundle count.** Arms on identical traffic at 4 and at 8 `c3-highcpu-4` workers both settled at 92 to 94% CPU and both kept up. A staging-only elements-per-bundle probe showed why: parse bundles went from 3.4 to 12 elements when the fleet halved, while each worker kept producing 190 to 330 bundles per second. The fixed cost is per bundle, which matches the metrics-dominated profile. Autoscaling up is therefore not a CPU fix, and a per-element saving shows less aggregate improvement than its microbenchmark suggests.

**Fewer harness threads is the lever that lowers bundle count.** Runner v2 hands one bundle to each SDK harness thread, and the runner default thread count leaves bundles at 1 to 12 elements (always 1 at the Spanner insert, one bundle per batch). `--number_of_worker_harness_threads=4` on `c3-highcpu-4` made parse bundles 4x larger and cut CPU from 94% to 76% at 8 workers with equal data lag, and from 92% to 45% at 4 workers, at matched parse and insert rates. The saving landed in the metrics snapshot, in proportion to the fall in bundle count. The cost is concurrency, since threads block on Spanner commits and state fetches. At 4 workers the 4-thread arm ran with idle CPU but growing data lag, which is the signature of the thread floor. Pick the production value from a matched arm whose data lag equals control. `worker_utilization_hint` is an autoscaling target and does not change bundle sizing in a fixed-worker arm. `sdk_worker_parallelism` and larger machine shapes act on the same fixed cost and are untested.

**Bundle-scoped or worker-local pre-batching is not viable on the generations lane.** The per-entity invariants in `services/usage-record/dataflow/AGENTS.md` (deterministic entity grouping, sequential shard rotation, mutation caps) mean batching inside a runner-chosen bundle either breaks entity affinity ([#27076](https://github.com/OpenRouterTeam/openrouter-web/pull/27076) regressed retries and insert latency) or degenerates to the keyed batcher once affinity is enforced, and at-least-once replay makes any state outside Beam keyed state unsafe. [#41347](https://github.com/OpenRouterTeam/openrouter-web/pull/41347) works on the commits lane only because that lane has no keyed state or shard rotation. With 1 to 12 elements per bundle there is nothing to coalesce anyway.

**Removing the state-cache module-globals walk did not lower aggregate CPU.** Default `objsize.get_deep_size` walks every module's globals per call and was 10 to 20% of the control profile (`_iter_modules_globals`, `_update_exclude_set`). A persistent `ObjSizeSettings(exclude_modules_globals=False)` removed those frames and matched Beam's weights. At matched input on 8 workers CPU was 0.933 control against 0.943 candidate. The freed time moved into `monitoring_infos` and `to_key`. Not shipped.

**Serialization across the batching boundary is 0.6 to 1.6% of CPU.** Beam pickles every `Generation` (`FastPrimitivesCoder` falling back to `PickleCoder`) across 3 encode/decode pairs on the homogeneous path and 6 on the small-batch path, and the whole stack (parse, pickle round trips, insert dump) is 0.14 to 0.35 ms against about 22 ms of CPU per generation. The best raw-bytes candidate recovers about 1.1%, caching insert columns for retries under 0.1%. Neither justifies its interface change. A production payload median above about 15 KB, or `process_encoded` flat plus `process_bundle` flat above 20% after metrics reporting is reduced, would reopen this.

## 5. Designing a CPU A/B that can resolve the effect

Follow `dataflow-staging-experiment` for isolation (same `--partition-count` and `--partition-index`, disjoint shard bands above 15, distinct `--staging-tag` and `--spanner-tag`). Then apply the CPU-specific rules.

- **Pin worker count and machine type on both arms** (`num_workers` plus `--min-workers=N --max-workers=N`). Autoscaling turns CPU into a controlled variable. `n4-highcpu-4` stocks out in us-central1, use `c3-highcpu-4`.
- **Match input rate, not just partition.** Compare `elements_produced_count` on the read PCollection over the same window. Staggered launches produce different rates for a long time. Do not conclude until the rates agree within a few percent.
- **Keep both arms below saturation.** Two arms pinned near 100% cannot separate, the busier one only queues. If both saturate at N workers, relaunch both at 2N. Report system lag and watermark age alongside CPU to prove neither arm is queueing.
- **Discard the first 10 to 15 minutes.** Cold start, index fill and profiler warm-up all distort CPU.
- **Report work done, not just work read.** Inserted element counts and the `rows.batched.*` counters differ between arms even at matched read rate. Say so when they do.
- **Account for partition dilution.** Every arm parses the whole topic and drops `(N-1)/N` of entities in `PartitionFilter`, and entity skew makes the pass-through smaller still. A candidate that acts after the filter shows a small fraction of its production effect. Put the candidate before the filter, run `partition_count=1` on a large arm, or estimate the production share from a microbenchmark and skip the A/B when the expected separation is below the arm-to-arm noise.
- **Measure arm-to-arm noise once** with two identical arms before reading any candidate delta.
- **Harness knobs are deploy flags, not code.** `--harness-threads`, `--num-workers`, `--machine-type` on `services/usage-record/scripts/dataflow-deploy.ts` change one arm without a new image. Lower CPU with rising data lag means the knob traded throughput for CPU, not that it saved CPU.
- **Profile both arms with the same number of profiles over the same window.**

Minimum report per arm is CPU average, per-worker CPU spread, read rate, inserted elements, system lag, max watermark age, backlog, and the flat and cumulative share of the frames the candidate targets.

## 6. Decision rule

Open one focused PR only when all of these hold.

1. The candidate's target frames drop in the candidate profile.
2. Aggregate worker CPU drops by more than the measured arm-to-arm noise at matched input rate with neither arm saturated.
3. Lag, watermark age and inserted work are equal or better.
4. Unit tests cover the changed behaviour and the full `services/usage-record/dataflow` suite, `ruff check` and `ruff format --check` pass under `uv run --frozen`. No typecheck command is configured for the Dataflow package, do not claim one ran.

If only the first holds, record the finding in section 4 and stop. A hot frame that was filling idle time is a real observation and not an optimization.

## 7. Cleanup

Drain staging arms as soon as their measurement is captured, and keep arms other threads are still measuring. Stopping is a human action in the Cloud Console, see "Stopping an arm" in `dataflow-staging-experiment`. List finished arms by full job name for the operator.

## Improve this skill

Add a row to section 1 when a CPU PR ships or is closed, and a paragraph to section 4 whenever an A/B rules a thread in or out.
