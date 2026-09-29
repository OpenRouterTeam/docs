# Fusion Judge Starvation: isPromiseLike RpcPromise Bug — 2026-06-23 Post-Mortem

## TL;DR

- **Duration:** ~19 hours customer-visible quality degradation (04:12–22:53 UTC)
- **Root cause:** `isPromiseLike()` only recognized `typeof 'object'` thenables, but Cloudflare's `RpcPromise` (returned by custom DO class methods) has `typeof 'function'`. So `wrap()` never awaited the DO RPC call — panel content resolved to empty bytes.
- **Impact:** Fusion judge prompt tokens dropped from 5–20k to ~1k. Analysis collapsed to blind-spots-only output (no agreements, key differences, unique insights, or partial coverage categories). Affected all fusion requests using DO offloading.
- **Fix:** Hotfix PR #25846 replaced `wrap()` with direct `await` + try/catch. Root fix (PR #25838) pending 0% deploy testing.

---

## Timeline — all times UTC, 2026-06-23

| Time | Event |
|------|-------|
| 04:12 | PR #25022 merged and deployed — introduces `DurableObjectPanelStore` with `wrap(() => stub.resolveOffloadedField(...))` pattern |
| 04:12–22:53 | All fusion requests with DO offloading silently produce empty panel content for judge. No alerts fire. |
| ~20:00 | James notices "Judge input size" cliff on the Fusion Datadog dashboard (5–20k tokens → ~1k) |
| ~20:30 | Devin session started to investigate. Initial hypotheses: traffic change, DO returning truncated content, or panels producing less text |
| ~21:00 | Datadog query rules out data loss: `resolve_lost_count: 0`, zero `resolve-failed` logs, panel bytes are 52KB+. But judge only sees 2.9KB. |
| ~21:15 | Local reproduction confirms bug. Diagnostic logging shows `wrapped bytes typeof: function`, `constructor: RpcPromise`, `safeBytes.length: 0` |
| ~21:30 | Root cause identified: `isPromiseLike` rejects function-thenables → `wrap()` returns unresolved RpcPromise as `ok(rpcPromise)` → `new Uint8Array(rpcPromise)` → empty |
| 22:33 | Hotfix committed: direct `await` bypassing `wrap()` (PR #25846) |
| 22:53 | Hotfix merged to main |
| ~23:10 | Deployed. Fusion dashboard confirms judge prompt tokens recovered to 5–20k range. Full analysis categories restored. |

---

## Root Cause

`packages/type-utils/promise.ts` contains `isPromiseLike()`, used by the `wrap()` Result monad to decide whether to await a value:

```typescript
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&  // <-- BUG: excludes functions
    typeof (value as Record<string, unknown>).then === 'function'
  );
}
```

Cloudflare Workers have two DO communication protocols:

1. **`stub.fetch(request)`** — legacy HTTP API, returns standard `Promise<Response>` (typeof `'object'`). Used by supersize-streaming. Works fine.
2. **`stub.customMethod()`** — newer JS RPC API. Returns `RpcPromise` — a callable function (typeof `'function'`) that implements the thenable protocol. Used by `resolveOffloadedField`.

The [Promises/A+ specification](https://promisesaplus.com/#point-7) defines a thenable as "an object **or function** that defines a `then` method." JavaScript's native `await` handles both correctly — which is why the integration test (`do-panel-roundtrip.integration.test.ts`) always passed, since it used `await` directly.

The failure chain:

```
stub.resolveOffloadedField(placeholder)
  → RpcPromise (typeof 'function', has .then())

wrap(() => stub.resolveOffloadedField(placeholder))
  → isPromiseLike(rpcPromise) → false (not typeof 'object')
  → returns ok(rpcPromise) WITHOUT AWAITING

resolved.data = RpcPromise object (not Uint8Array)
  → !bytes → false (truthy function)
  → bytes.byteLength === 0 → false (RpcProperty is truthy)
  → new Uint8Array(rpcPromise) → Uint8Array(0)
  → decoder.decode(empty) → ""
  → judge gets empty <response> blocks
```

---

## Impact

- **Duration:** ~19 hours (04:12–22:53 UTC)
- **Affected system:** Fusion (multi-model analysis pipeline)
- **Severity:** Medium — no data loss, no customer-facing errors, no billing impact. But fusion output quality was degraded for all users.
- **Quantified degradation:**
  - Judge prompt tokens: 5–20k → ~1k (80–95% reduction)
  - Analysis output: multi-category (agreements, differences, insights, blind spots) → blind-spots-only
  - Terminal bench quality regression correlated with this window
- **Blast radius beyond fusion:** The same `isPromiseLike` bug affects 5 other DO RPC call sites (PDF parsing, video job start, usage-record billing, workspace quota). Only fusion surfaced the symptom visibly.
- **Why no alert fired:** No Datadog monitor existed for judge prompt token floor. The dashboard showed the cliff, but required human observation.

---

## Mitigation

1. **Immediate hotfix** (PR #25846): Replaced `wrap(() => stub.resolveOffloadedField(...))` with direct `await` + try/catch. Same error isolation, bypasses the broken `isPromiseLike` path entirely.
2. **Proper root fix** (PR #25838, pending): 1-line change to `isPromiseLike` adding `|| typeof value === 'function'`. Also adds defense-in-depth guard (decoded-empty → resolve failure), regression test via real DO stub, and Datadog monitor for judge token floor.

---

## Follow-ups (priority order)

1. **Merge PR #25838 after 0% deploy testing** — kills the entire bug class across all 6 affected DO RPC sites
2. **Add Datadog monitor** — alert when `judge_prompt_tokens < 1500` with `panels_succeeded >= 1` (included in PR #25838)
3. **Apply `promisifyRpcBinding()` at stub-acquisition sites** — belt-and-suspenders per OPE-4847. Helper already exists in `packages/cloudflare/promisify-rpc-binding.ts` but was never rolled out.
4. **Add function-thenable mocks to test suite** — current DO mocks return real Promises, which masked this bug entirely

---

## What went well

- Local reproduction was fast (confirmed in one fusion request via `pnpm dev cfw-api`)
- Diagnostic logging (`typeof`, `constructor`, `safeBytes.length`) pinpointed the exact mechanism immediately
- Hotfix was minimal (6 lines), low-risk, and passed all 19 existing unit tests unchanged
- The proper fix (PR #25838) was already drafted before the hotfix was requested, so the comprehensive solution is ready

## What could be improved

- **No alert existed** for judge quality degradation. The dashboard showed it, but nobody looks at dashboards every hour. A token-floor monitor would have caught this in minutes.
- **Integration test coverage gap:** `do-panel-roundtrip.integration.test.ts` used direct `await` instead of the production `wrap()` path. It proved the DO worked, but never exercised the code path production actually uses.
- **`isPromiseLike` had zero direct tests.** A single test with a function-thenable would have caught this before the PR shipped.
- **The bug class was already known.** `promisify-rpc-binding.ts` exists with a TODO(OPE-4847) from May 7 to apply it to `SVC_USAGE_RECORD`. The helper was written, the problem was documented, but it was never applied to the call sites that needed it.

---

## Participants

- James Sterling — detected via dashboard, directed investigation strategy and hotfix approach
- Devin — investigation, root cause identification, hotfix and proper fix implementation

## References

- [PR #25846 (hotfix)](https://github.com/OpenRouterTeam/openrouter-web/pull/25846)
- [PR #25838 (proper fix)](https://github.com/OpenRouterTeam/openrouter-web/pull/25838)
- [PR #25022 (introduced bug)](https://github.com/OpenRouterTeam/openrouter-web/pull/25022)
- [Promises/A+ Specification §1.2](https://promisesaplus.com/#point-7)
- [OPE-4847 (promisifyRpcBinding TODO)](https://linear.app/openrouter/issue/OPE-4847/apply-promisifyrpcbinding-to-cfw-api-service-binding)
- [Devin session](https://openrouter.devinenterprise.com/sessions/4b0c69718ef948ffb5e6009717abb946)
