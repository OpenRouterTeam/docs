# Switchyard

[NVIDIA NeMo Switchyard](https://github.com/NVIDIA-NeMo/Switchyard) is an
OpenAI-compatible routing proxy. It sits in front of an upstream provider and
selects the model for each request based on the route named by the caller in
the `model` field. This service pins a specific upstream revision; the
authoritative pin and archive checksum are in
[`upstream-lock.txt`](upstream-lock.txt) and [`Dockerfile`](Dockerfile).

## Why this service exists

The benchmark comparison measures what signal-based routing buys by running
the same task set through three routes and comparing quality with cost:

| Route | Behavior |
| --- | --- |
| `switchyard/benchmark-stage-router` | Stage router between Opus (capable) and GLM (efficient) |
| `switchyard/benchmark-always-opus` | Passthrough pinned to `anthropic/claude-opus-4.8` |
| `switchyard/benchmark-always-glm` | Passthrough pinned to `z-ai/glm-5.2` |

The stage-router arm is compared with both always-capable and always-efficient
baselines.

## Selecting a benchmark arm

Mission Control lists the three Switchyard routes as a separate group in the
existing model selector. Select the real model for the current-routing arm and
the three Switchyard routes together, then start one benchmark workflow. The
parent workflow creates one child per selected arm, so the benchmark, question
limit, epochs, and benchmark-specific options are shared across the comparison
by construction. Catalog-only selections retain provider and endpoint pinning,
including when several catalog models are selected. If any Switchyard route is
selected, providers and endpoint pinning are disabled for the whole comparison,
and every arm runs once under default routing.

## Stage-router behavior

The stage router uses tool-result and agent-progress signals to choose between
the capable and efficient targets. This configuration uses the
`efficient_first` picker and a `confidence_threshold` of `0.5`. Lowering the
threshold escalates to the capable model more often, which generally reduces
measured savings.

Stage routing needs meaningful tool traffic. On single-shot chat benchmarks,
every turn falls open to the picker's default tier, so this arm degenerates
into a second always-efficient run rather than demonstrating signal-based
routing.

## Service constraints

- The Cloud Run service is IAM-restricted. Callers must present a Cloud Run ID
  token in `X-Serverless-Authorization`.
- The upstream OpenRouter client uses the `openai_responses` format. The
  agentic benchmarks call Switchyard on `/v1/responses` and replay the previous
  turn's output items, reasoning items included. A Chat Completions upstream
  client translates that request and drops every reasoning block, which makes a
  routed arm incomparable with a direct OpenRouter run of the same model.
- The benchmark worker keeps the harness on the ordinary OpenRouter base URL
  and diverts only requests whose `model` is one of the configured Switchyard
  route IDs. Diverted `/api/v1/*` requests are rewritten to Switchyard's
  `/v1/*` paths before forwarding; helper-model requests remain on OpenRouter.
- Terminal-Bench cannot use a Switchyard arm because its measured model call
  originates inside a Modal sandbox rather than the benchmark worker, so it
  cannot reach this worker-installed diversion or invoke the IAM-protected
  Switchyard service. SWE-Atlas, DeepSWE, and WANDR remain supported because
  their sandbox calls are for judging or verification; their measured model
  calls originate in the worker.

The activity worker pool's Terraform configuration sets `SWITCHYARD_ENABLED` to
`true`. Runs without a selected Switchyard arm return before reading the flag,
so ordinary benchmark runs are unaffected. A routed run requires the
Switchyard service to be healthy; before that, it fails non-retryably rather
than falling back to direct OpenRouter traffic.
