# Noetic migration audit

**Audited:** 2026-08-13

**Status: blocked; the Noetic engine remains unavailable.** Synapse continues to
use its existing `@openrouter/agent` review loop. The proposed
`@noetic-tools/core@5.3.0` integration was removed after auditing the published
package, its installed type surface, and its runtime implementation.

## Grounded findings

The package's documented low-level API is real: `AgentHarness` accepts
`initialStep`, exposes `createContext()` and `run(step, input, context)`, and
`step.llm()` is a supported builder. The implementation was not blocked by
those API names.

It is blocked by behavioral and dependency incompatibilities:

- `@noetic-tools/core@5.3.0` depends on and peers with
  `@openrouter/agent ^0.6.0`; Synapse used `0.9.0` at audit time and pins
  `0.10.0` today — both outside the peer range, so the conflict stands. Bun
  therefore resolves a second `0.6.0` SDK copy into the Worker bundle.
  Noetic `5.4.0`, the latest published version at audit time, retains the
  same peer range.
- Noetic converts its own tool shape to the nested SDK's tool shape and executes
  tools itself. Reusing Synapse's installed-SDK (`0.9.0` at audit, `0.10.0`
  now) tool definitions therefore requires an untyped adapter across two SDK
  versions. Although the basic input-schema and execute contracts overlap,
  `0.9.0`+ adds cancellation, async/deferred tool lifecycle, concurrency,
  timeout, and loop-control semantics that the bridge would silently discard.
- A Noetic LLM step owns an internal tool loop capped at 32 rounds. The outer
  Noetic `loop()` sees one completed LLM step, not each model/tool round. Its
  `until.maxSteps()` and `until.maxCost()` predicates are evaluated only after
  that internal loop returns, so they are not equivalent to Synapse's current
  per-turn `stepCountIs()` and `maxCost()` limits.
- Noetic `5.3.0` has no `allowFinalResponse` equivalent. Its internal tool loop
  stops when a model returns no tool calls; adding another outer LLM iteration
  would repeat normal inference rather than provide the SDK's dedicated final
  directive after a stop condition.
- The package exposes aggregate usage and trace spans, but no supported
  per-round callback equivalent to `onTurnEnd`. Framework events identify a
  round but omit that round's usage and cost; trace exports contain usage and
  cost but do not expose the round number. Matching Synapse's turn metrics would
  require relying on internals or correlating incomplete signals.

## Reconsideration gate

Do not restore the runtime path until a published Noetic version provides all
of the following through supported APIs:

1. compatibility with Synapse's installed `@openrouter/agent` major/minor
   without a duplicate runtime copy;
2. explicit per-model-round step and cost limits;
3. a terminal/final-response directive equivalent to `allowFinalResponse`;
4. per-round usage, cost, and cached-token observability; and
5. a typed tool adapter that preserves the installed SDK's execution semantics.

A future implementation must first run a live tool-call fixture and the Synapse
eval corpus. Until those gates pass, accepting a `REVIEW_ENGINE=noetic` setting
would create a falsely armed experiment, so there is no Noetic engine selector
or dependency in the Worker.
