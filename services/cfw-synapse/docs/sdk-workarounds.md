# Live `@openrouter/agent` SDK workarounds

Two workarounds live in `src/harness/agent-run.ts` and
`src/harness/single-shot.ts`. Each was re-verified on 2026-08-25 against the
pinned `@openrouter/agent` **0.10.0** (package.json; confirmed in the
installed `node_modules/@openrouter/agent`) by reading the SDK source. The
numbering (#1/#2) is load-bearing — harness comments reference it.

## 1. String `input` breaks on resumed ConversationState

**Where:** `agent-run.ts` and `single-shot.ts` — the `input:` argument to
`callModel`.

**Original bug:** the SDK treated a bare string input inconsistently across
tool-loop continuations; a message array was the only stable shape.

**Workaround:** always pass a message array, never a bare string:

```ts
input: [{ role: 'user' as const, content: buildReviewUserMessage(...) }],
```

**Verified against 0.10.0: OBSOLETE as a defense.** The SDK now normalizes
bare-string input to a single user message on BOTH paths — fresh runs and
resumed ConversationState (`esm/lib/model-result.js` runs caller input
through `normalizeInputToArray` before appending to loaded history, with an
in-source comment that raw strings "must become EasyInputMessage items,
exactly as the no-history branch does"). The message-array shape stays in
the harness for now — it is harmless and self-documenting — but it is no
longer load-bearing. Removing the shaping is a deliberate harness change,
not a doc edit.

## 2. Empty final response after a tool-terminal run

**Where:** `agent-run.ts` (the `emptyFinal` matcher around
`result.getText()` / `result.getUsage()`) and `single-shot.ts`
(`throwOnEmptyFinal` policy).

**Bug:** a run can end with an empty final `output` array (the tool call —
ours end with `submit_findings` — or the single-shot text WAS the model's
last act), and `getText()` throws
`Invalid final response: empty or invalid output` even though the run
succeeded.

**Workaround:** catch exactly that message prefix, log
`run.empty_final_tolerated` WARN, and treat the text as `''`. Any OTHER
error still rethrows. `single-shot.ts` makes tolerance a per-caller policy
(`throwOnEmptyFinal`) because there the text IS the output.

**Verified against 0.10.0: STILL REQUIRED, with narrowed scope.**

- The error string survives and its prefix is documented load-bearing in
  the SDK ("never reword the prefixes"; detail is appended after an em
  dash) — so the harness's prefix-regex match remains valid.
- What changed: with the default `strictFinalResponse: false`, a run with
  at least one completed tool round that ends on an empty final turn is
  retried once and then ACCEPTED by the SDK, so the original tool-terminal
  scenario in `agent-run.ts` no longer throws in the common case. The
  catch there is now defense-in-depth (and `strictFinalResponse: true`
  would re-arm the old behavior).
- The hard throw REMAINS for runs that complete with NO tool rounds — the
  SDK keeps `validateFinalResponse` strict on the no-tool-work path. That
  is exactly the `single-shot.ts` shape (no tools), so the tolerance there
  is still load-bearing.
