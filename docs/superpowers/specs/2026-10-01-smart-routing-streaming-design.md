# Smart routing streaming in Demo Hub

## Goal and scope

Make the Smart Routing demo visibly responsive for Auto, Auto Beta, Jev, Pareto, and Switchyard. Each run shows that routing has started, identifies the resolved model and provider when the stream provides them, and renders the model's answer as text arrives. Existing router controls, final routing details, request/response inspection, captures, and routing history remain available. A Stop action cancels an active run and leaves its partial answer marked incomplete.

## Transport and data flow

Keep `POST /api/demo-hub/demos/smart-routing/run`. A client request with `Accept: text/event-stream` uses streaming; requests without that header retain the current JSON response. The route performs its internal-admin check and Zod request validation before opening a stream. It builds the same router request and context as today, then calls OpenRouter Chat Completions with `stream: true` and `X-OpenRouter-Metadata: enabled`.

The server parses OpenRouter's SSE with the existing network deserializer, validates chunk data with Zod, and sends a small, validated Demo Hub event contract: `run.started`, `route.resolved`, `text.delta`, `run.completed`, and `run.failed`. It forwards neither API credentials nor raw upstream chunks. `run.started` gives the UI an immediate state while routing and model prefill are underway. The model and provider can be reported from early chunks. Task classification, candidate order, Switchyard decision, usage, and cost come from the final metadata and usage chunks when present; missing values stay unknown.

The server requires a valid stream terminator and reports an upstream error chunk, malformed frame, timeout, or premature close as a failed run. It composes the completed chunks into a completion-shaped response containing the answer, generation ID, resolved model, provider, finish reason, usage, and routing metadata that were actually supplied. This assembled response populates the existing `DemoEnvelope` and request/response viewer. The viewer displays the final assembled response, rather than claiming it is a single raw upstream JSON body.

## Client state and presentation

A dedicated smart routing run owner follows the server tools demo's mutation and query-cache pattern. It parses and validates each Demo Hub event, publishes text updates at most once per animation frame, and uses a run identity plus `AbortController` to prevent an old stream from overwriting a newer run. The submitted router, scenario, and prompt are snapshotted for the visible run; changing controls does not relabel that run. Starting another run, pressing Stop, or unmounting cancels the active stream.

The Results panel has explicit routing, responding, completed, stopped, and failed states. It shows progress immediately and the answer incrementally without resetting the request/response viewer on every token. One answer panel stays in place through completion; the final request/response viewer shows its request, assembled response, and extra-data tabs without duplicating that answer. The routing decision fills in as fields become available, with classification and candidate order normally arriving at completion. Stop replaces the run action while active. A stopped or failed run keeps any text already shown, labels it incomplete, and does not create a success history row. The completed envelope drives the existing decision card, response viewer, capture notification, and history row.

## Capture and errors

The server records a completed run once using the same capture policy and context as the JSON path. Capture failure is reported as a warning without discarding an otherwise complete answer. Pre-stream authorization and validation errors remain normal HTTP responses; after streaming starts, failure is a terminal `run.failed` event. Both ends cancel unread response bodies and propagate disconnects to the upstream request. The route keeps the existing request timeout.

## Verification

Focused server tests use synthetic Chat Completions streams to verify incremental text, early model/provider identity, final metadata for all five routers, assembled response and capture, HTTP and mid-stream errors, malformed data, premature close, Stop, and cancellation. Client parser and DOM tests prove that partial text appears before completion, final details and history appear only after completion, and partial text survives failure without a stale update. Run the affected Mission Control tests and `bun run verify` before pushing, then review the rendered demo in both themes. The PR will target `codex/demohub-jev-router` and include the required HIPAA and security review results for this inference route.
