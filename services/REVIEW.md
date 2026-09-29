# Service Review Guidelines

Flag live-config schema keys without `.default()` and schemas passed to
`createGetLiveConfig` without a colocated `validateLiveConfigSchema` test. A
cold isolate read throws for a missing default.

## Live-config reads must stay non-blocking

`LiveConfigReader.get` / `getMany` must return the cached value or the schema
default and refresh KV through `waitUntil`. Reject any change that makes a read
wait on network I/O, including:

- reintroducing an `awaitFirstSync`-style option on `get`, in any worker
- awaiting an in-flight revalidation, the KV read, or the background refresh
  task inside `get` / `getMany` / `#startRevalidation`
- any new option, wrapper, or helper whose effect is that a request waits for
  KV before proceeding

The schema default is the correct value on a cold isolate, including for
auth-critical gates. When a gate cannot tolerate its default, change the
default or the gate's failure mode instead of blocking the read.

*Source: reverting [PR #36993](https://github.com/OpenRouterTeam/openrouter-web/pull/36993).*

One scoped exception is documented in `services/batch-api/AGENTS.md`: the batch billing-mode provider (`createBatchBillingModeProvider`, a long-lived Cloud Run process, not a worker isolate) awaits its first KV read once per process through `createColdLiveConfigRead`, bounded by `COLD_READ_TIMEOUT_MS` (2 s), because its default persists a billing mode onto the job rather than standing in until the value arrives. `index.ts` starts that read at process start through `warm`, so the read normally lands before the first accept. Every later read on that process is non-blocking, and a timed-out, failed, or thrown cold read falls through to the default without throwing. Flag any second call site of `createColdLiveConfigRead`, any raise of that bound, or any per-request re-wait as a new violation.

## HIPAA unsupported-surface workers carry both guards

A worker that refuses a `HipaaUnsupportedSurface` must wire `createHipaaPreRelayGuard({ unsupportedSurface })` on every `createProxyMiddleware` mount it has, and must authenticate through the `getUser` of `createHipaaSurfaceAuth({ surface })` (`services/cfw-api/src/middlewares/hipaa-surface-auth.ts`), which applies the post-auth guard to every resolved caller; its invalid-request and pre-offload hooks come from the same seam. The registry of workers per surface is `HIPAA_ENFORCEMENT_SITES` in `services/cfw-api/src/middlewares/hipaa-enforcement-sites.ts`. Flag a change that adds, removes, or re-tags a HIPAA guard or proxy mount in a modality worker without the matching registry update, or that adds one side of the enforcement without the other.

The raw `getUser` from `auth/get-user` is lint-forbidden — imported or re-exported — in every `cfw-*` worker except the ones listed in `RAW_GET_USER_ALLOWED_SOURCE_PATTERNS` (`scripts/oxlint/rules-security.ts`): cfw-api, the two non-inference workers, and the files worker's `resolve-context.ts`, whose HIPAA decision is workspace-scoped. A new `cfw-*` worker that serves no AI surface is added to that list; flag an addition for a worker that does serve one, and flag a modality worker that reaches `getUser` some other way (a wrapper module in another worker, a dynamic `import()`) — that is the guard being bypassed, not a lint gap to baseline.
