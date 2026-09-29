# Explicit Prompt Caching: OpenAI vs Anthropic Interop Notes

Notes on the interop between OpenAI explicit prompt caching
(`prompt_cache_breakpoint` / `prompt_cache_options`) and Anthropic explicit
caching (`cache_control`). The block-level markers are now interchangeable
(see "Marker interchange" below); the request-level options and deeper
semantics remain untranslated.

## Where each lives today

- **Anthropic** `cache_control` rides on internal chat-completions content
  parts (the `& StringRecord` escape hatch on `ContentPartText`) and is
  emitted by Anthropic-family adapters. Explicit-only by nature.
- **OpenAI** `prompt_cache_breakpoint` rides the same escape hatch on text
  parts — accepted by both the Chat Completions and Responses skins — and is
  re-attached in `adapters/openai-responses/get-input.ts`. Root-level
  `prompt_cache_key` and `prompt_cache_options` live at the root of the
  internal chat-completions body regardless of the originating skin (the
  Responses skin folds them there), and `prompt_cache_options` is gated to
  OpenAI/Azure by `isOpenAiModelHost()`.

Both skins accept `cache_control` and the OpenAI fields side by side; each
adapter reads only its own field, so a part carrying both never clashes.

## Marker interchange

`interchangePromptCacheMarkersInMessages` (normalize-request plugin) makes
the two block-level markers interchangeable on text parts:

- A valid `cache_control` gets `prompt_cache_breakpoint: { mode: "explicit" }`
  synthesized alongside it — but only when the endpoint is in the OpenAI
  Responses adapter family *and* the model supports breakpoints
  (`modelSupportsPromptCacheBreakpoints` — a denylist of pre-5.6 OpenAI models
  that 400 on the field, so GPT-5.6 and newer families default to supported).
- A valid `prompt_cache_breakpoint` gets `cache_control: { type: "ephemeral" }`
  synthesized alongside it (no `ttl`, i.e. Anthropic's default 5m — never the
  pricier 1h tier).
- Parts carrying both are left untouched; native fields always win.

Endpoint-aware stripping then removes whichever marker the target adapter
does not support (`normalizeCacheControlInMessages` /
`normalizePromptCacheBreakpointsInMessages`), so unknown fields never reach
strict upstreams. TTLs are not translated: `cache_control.ttl` is simply
dropped with the marker toward OpenAI. Request-level `prompt_cache_key` /
`prompt_cache_options` stay OpenAI-only and are never synthesized from or
translated to anything Anthropic-side.

## Why a 1:1 mapping doesn't exist

### Placement semantics (close, but not identical)

Both mean "everything through this block is the candidate cached prefix."
Differences:

- Anthropic: any block type (text, image, tool definitions, system), hard
  limit of 4 breakpoints.
- OpenAI: documented only on `input_text` blocks (our implementation is
  scoped accordingly, with a TODO to expand), no documented breakpoint limit.

### TTLs do not overlap

- Anthropic: 5m default, 1h opt-in (`ttl: "1h"`). No 30m.
- OpenAI: 30m minimum (`prompt_cache_options.ttl: "30m"`). No 5m or 1h
  documented.

A unified `ttl` cannot pass through: 5m must round up to 30m on OpenAI, and
30m must round to 1h (or be rejected) on Anthropic. Each rounding changes
billing.

### Billing differs (minor)

- Anthropic: writes 1.25x (5m TTL) or 2x (1h TTL); reads ~0.1x.
- OpenAI: writes 1.25x flat; reads 0.25–0.5x depending on model.

Users already expect pricing to change when switching models/providers, so
this alone is not a blocker for interop — noted for completeness.

### The mode model is inverted

- Anthropic is inherently explicit-only: nothing is cached without a
  breakpoint.
- OpenAI defaults to automatic caching; breakpoints are additive, and a
  separate root-level `prompt_cache_options: { mode: "explicit" }` disables
  the automatic breakpoints.

There is no Anthropic equivalent of "automatic + explicit both active," and
no OpenAI equivalent of "nothing cached by default" unless explicit-only
mode is always sent. Any `cache_control` → OpenAI translation needs a policy
decision: force explicit-only mode, or leave automatic caching on?

### Cache identity / keying differs

- OpenAI keys the cache partly on the request-level `prompt_cache_key`
  (plus prefix content).
- Anthropic has no key — caching is purely prefix-content + account.

Interchange would need to synthesize or ignore keys depending on direction.

## Takeaway

The block-level placement concept translates fine. TTL values, the
automatic-vs-explicit default, breakpoint limits, and keying do not. Any
interchange layer has to be a lossy, best-effort mapping with documented
rounding/policy rules — a canonical internal breakpoint representation plus
per-adapter emission — rather than a 1:1 field mapping.
