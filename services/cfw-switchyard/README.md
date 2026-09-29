# cfw-switchyard

A proof-of-concept Cloudflare Worker, written in Rust and compiled to `wasm32`, that runs the routing algorithms from NVIDIA Switchyard as a decision-only virtual router. No Switchyard source is vendored here: Cargo fetches `switchyard-protocol`, `switchyard-translation`, and `switchyard-libsy` at build time from a pinned revision of the patched fork. For the pins, see `Cargo.toml` and `upstream-lock.txt`.

This worker is not related to `services/switchyard`, the container-based benchmarking service that runs upstream `switchyard-server` unmodified.

## Endpoints

- `GET /health`: returns build and crate information.
- `POST /translate/request`: translates a request body between wire formats with `switchyard-translation`. The supported formats are `openai_chat`, `anthropic_messages`, and `openai_responses`.
- `POST /route`: returns a libsy routing decision over `FallThrough`, run through the libsy `drive()` orchestrator. The body is `{ "targets": [...], "tiers": { "efficient", "capable" }, "judge": {...}, "request": {...}, "algorithm"?, "held_tier"?, "source_format"? }`. Both tier values must name distinct entries of `targets`. `algorithm` selects the libsy router and defaults to `capability`; an unknown value returns 400. For the values, see [Algorithms](#algorithms).

## Routing

### Algorithms

cfw-api sets `algorithm` from the request's `switchyard-router` plugin entry, falling back to its `SWITCHYARD_ALGORITHM` variable. The decision's `strategy` field repeats the algorithm that ran.

- `capability` (default): `LlmTaskClassifier`. One judge call per request rates the task. For details, see [The judge](#the-judge).
- `stage`: `StageRouter` with `efficient_first` and a confidence threshold of 0.5. It reads the tool-result history in `request.messages` (errors, repeated failures, reading without producing, edits landing) and moves to the capable tier when those signals are strong. Turns that the signals cannot decide go to the judge.
- `auto`: `stage` without the judge. Undecided turns take the efficient tier, so the worker makes no judge call and bills the caller nothing for routing.
- `random`: a uniform choice among `targets`; the other targets follow in caller order. A baseline for A/B comparisons.
- `composite`: `StageRouter` started from `held_tier` when cfw-api sends one (the tier of the model its session pin chose on the last human turn); tool-turn signals can move the request off that tier. Without `held_tier`, it behaves like `stage`.

cfw-api handles the `passthrough` algorithm without calling this worker: it serves its own candidate order and records `strategy: passthrough`.

### The judge

The classifier spends one judge call per request: it asks the judge model, with a fixed JSON schema, whether the efficient tier can solve the task and with what probability (`p_solve`). The efficient tier is chosen when `p_solve` clears the threshold for the judge's `capability_boundary` (0.6 when `supported`, 0.75 when `uncertain`, 0.9 when `unsupported`); otherwise the capable tier is chosen. The other tier becomes the first fallback. cfw-api appends the remaining `targets` in caller order and owns the actual model call and any fallback to the next model.

The judge's system prompt is `src/capability-classifier-prompt.md`, a capability card that describes the efficient tier as a small chat model. libsy's packaged card describes an agentic coding harness and rates the efficient tier as able to solve nearly any chat request, so it is not used. The card's rules put short replies, lookups, and small snippets in `supported`, ambiguous or long-input work in `uncertain`, and multi-step reasoning, proofs, and substantial code changes in `unsupported`.

The judge call is billed to the requesting user, never to a Worker-owned key. cfw-api sends its own `/api/v1` base URL in the `judge` field of the `/route` body together with the caller's credentials, the same passthrough `openrouter/fusion` uses: the exact API key or OAuth JWT cfw-api authenticated the request with (recorded in `resolveUser`, so a foreign JWT that fell through to a valid `x-api-key` forwards that `x-api-key`), or a signed internal-auth token (`x-openrouter-internal-auth`) with the signed request ID (`x-openrouter-request-id`, `x-openrouter-request-id-sig`) plus the session cookie for cookie sessions. The Worker drops an internal-auth token that arrives without both signed request-ID headers, because cfw-api's trust gate rejects that combination with `401` instead of falling back to the cookie. The Worker POSTs `<base_url>/chat/completions` over Cloudflare `fetch` with those headers, refuses any base URL that is not `https` (plain `http` only for `localhost`, `127.0.0.1`, or `[::1]` in local development) before a request is built, and never follows redirects, so the credentials and the prompt projection only reach the TLS origin cfw-api named. The Worker has no route of its own and is reachable only over the service binding, so an unauthenticated caller cannot make it spend anyone's credits: a `/route` body with no credential fails open with `judge_failure: no_credential` and no judge call is made. The credential only restores the caller's saved account and workspace policy, so cfw-api also sends the request-level restrictions it cannot recover — `zdr`, `data_collection`, `only`, and `ignore` — in `judge.provider`, and the Worker repeats them as the judge request's own `provider` block. Configure the judge with:

- `SWITCHYARD_JUDGE_MODEL` (var, optional): defaults to `google/gemini-2.5-flash-lite`.

The classifier fails open to the capable tier when the caller sent no credential, an unusable base URL, or a `judge.provider` block that is not a JSON object (the restrictions could not be repeated, so no judge call is made), the judge does not deliver a complete body within 2.5 s, returns a non-2xx status or a body that is not a chat completion, or returns a verdict that does not match the schema. The decision reports the reason in `judge_failure` (`no_credential`, `invalid_base_url`, `invalid_provider`, `timeout`, `transport`, `http_401`, `http_402`, `http_403`, `http_429`, `http_3xx`, `http_4xx`, `http_5xx`, `invalid_json`, `decode`, `malformed_verdict`, `encode`) and `null` when the verdict was used. `http_401`, `http_402`, and `http_403` mean cfw-api rejected the caller's own credential (revoked key, no credits, policy such as an IP allowlist), so a rise in them is a caller problem, not a judge outage; `http_4xx` is any other client error, `http_3xx` a redirect the Worker refused to follow, and `http_5xx` a server error. `malformed_verdict` covers assistant text that is not a JSON verdict passing libsy's field checks: `p_solve` in `[0, 1]`, a non-blank `crux`, a `primary_rule` that matches its `capability_boundary`, and no unknown fields. Prompts, completions, upstream bodies, and the caller's credentials are never logged.

## Build and deploy

Requires Rust 1.96.1 with the `wasm32-unknown-unknown` target and `worker-build`. Install the toolchain and deploy the worker:

```bash
rustup toolchain install 1.96.1 --profile minimal -t wasm32-unknown-unknown
cargo install worker-build
bunx wrangler deploy   # runs worker-build --release via [build] in wrangler.toml
```

To run the worker locally, use `bunx wrangler dev`.

## Build against a local Switchyard checkout

To iterate on the patch, point Cargo at a local checkout instead of the git dependency. Clone upstream at the pinned revision and apply the patch:

```bash
git clone https://github.com/NVIDIA-NeMo/Switchyard
cd Switchyard
git checkout 27fc1ce9ff3846760337fe42ab09c28f5b01c807  # rev in upstream-lock.txt
git am OPENROUTER_WEB_CHECKOUT/services/cfw-switchyard/switchyard-wasm-port.patch
```

Replace `OPENROUTER_WEB_CHECKOUT` with the path to your `openrouter-web` checkout.

Then replace the three git dependencies in `Cargo.toml` with path dependencies. Don't commit this change:

```toml
switchyard-protocol = { path = "SWITCHYARD_CHECKOUT/crates/protocol" }
switchyard-translation = { path = "SWITCHYARD_CHECKOUT/crates/switchyard-translation" }
switchyard-libsy = { path = "SWITCHYARD_CHECKOUT/crates/libsy" }
```

Replace `SWITCHYARD_CHECKOUT` with the path to the Switchyard checkout from the preceding step.

`switchyard-wasm-port.patch` is the full `wasm32` port: about 46 changed lines plus a small runtime shim, `crates/libsy/src/rt.rs`. All 269 native libsy tests pass with the patch applied, and no algorithm logic changes.

## cfw-api service binding

The intended integration is an internal Worker-to-Worker service binding, so cfw-api gets no new public route. Cloudflare rejects a version upload that references a nonexistent worker (error 10143), so the `switchyard-router` worker must exist in the account first. Then add the binding to `services/cfw-api/wrangler.toml` next to `SVC_FUSION` and regenerate the types with `bunx turbo run cf-typegen`:

```toml
[[services]]
binding = "SVC_SWITCHYARD"
service = "switchyard-router"
```

Call the worker from cfw-api code through the binding:

```ts
const res = await c.env.SVC_SWITCHYARD.fetch('https://switchyard/route', {
  method: 'POST',
  body: JSON.stringify({ targets, tiers, request, source_format: 'openai_chat' }),
});
const decision = await res.json(); // { selected_model, fallback_models, strategy, judge_failure, judge_ms, route_ms, ... }
```

cfw-api keeps ownership of billing, adapters, BYOK, usage recording, and the upstream model call. This worker only returns the routing decision.

## Known limitations

- Only the judge call is served at routing time. Algorithms that call the selected model itself at routing time (for example escalation or advisor-gate) would need the same transport wired for arbitrary targets.
- Tiers are derived from price alone. Context length and tool support are not part of the contract, so a request that only one candidate can fit (a very long input, or tools on a candidate without tool calling) is not steered to that candidate by the router; cfw-api's ordinary fallback handles the failure instead.
- On `wasm32`, the native Tokio-timer session cleanup in libsy is replaced by an inline TTL sweep on each session-state lookup, so long-lived isolates stay bounded.
