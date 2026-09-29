# Workflow ABI

This package contains the versioned workflow graph schemas, author-time
validator, and transport-agnostic interpreter. It deliberately has no Worker,
Cloudflare, or HTTP dependency; model calls are injected as task executors.

V1 is synchronous and stateless. A `max_total_cost_usd` limit is a stop-loss:
completed child costs are accumulated and an estimated node cost can prevent a
new node from starting, but the node already in flight can overshoot because a
provider's final usage is unavailable before execution.

Workflow media is passed inline to the v1 service adapter as a URL, data URI, or
an explicitly typed base64 object. The adapter stores neither workflows nor run
payloads. TTS output is capped and never truncated.
Bindings use `$input.<name>` and `$nodes.<id>.<port>` references. Node-input
objects are resolved recursively: arrays that are values of input fields are
literal arrays resolved element-wise, bare references to arrays are splatted,
and absent references are omitted. Workflow output array bindings remain
fallback lists and resolve to their first present candidate. Interpolation
with `{{ ... }}` always produces a string.

Product nodes provide typed composition over the chat executor:
`vision` turns an image into an `image_url` message part, `parse_file` turns a
file into a `file` message part for downstream router parsing, `classify`
returns a taxonomy-guaranteed category using strict structured outputs plus a
runtime label re-check, and `router` selects a taxonomy case. Classifiers may
also provide an optional system prompt, which is prepended to their text or
authored messages.
The builders exported from `@openrouter-monorepo/workflow/builders` take typed
`$input.*` or node-output bindings, preserve taxonomy literals for author-time
exhaustiveness, and return typed router case references for downstream nodes.
