# Data Layer Review Guidelines

Flags for code using the shared data layer. This file is only the checklist
— the rationale for each convention lives in `AGENTS.md`.

## Structure

- `createQueryKeys`, `queryOptions`/`infiniteQueryOptions` factories, or
  `useAPIMutation` defined outside a canonical owner: `queries.ts`/
  `*-queries.ts`, `query-keys.ts` for split keys, or
  `mutations.ts`/`*-mutations.ts` for client-only mutation owners.
- A `createQueryKeys` namespace reused across two domains — namespaces are
  the cache partition and must be workspace-unique.
- A hand-written key array literal (`['guardrails', ...]`) passed as a
  `queryKey` or to `invalidateQueries` — keys come from `createQueryKeys`
  only.
- A `use`-prefixed export that is a pure one-liner around `useQuery` — call
  sites consume the `<thing>Options` factory directly. A custom hook is only
  warranted for a `select` transform, an error-monitor side effect, or
  multi-query composition.
- A prefetch or RSC loader that rebuilds a key or query policy instead of
  reusing the canonical exported options factory. A server-only transport may
  override only `queryFn` after spreading those options.
- An `exhaustive-deps` suppression or global allowlist addition for an entity
  id, filter, pagination input, request body, or any other value that can
  affect the response. Allowlist only a named injected seam with
  cache-neutral identity, or a deterministic alias already represented by
  primitive key inputs, after case-by-case review.

## Cache safety

- A `queryFn` that reads a variable (workspace id, filter, entity scope)
  that is not a segment of its query key.
- A cookie-authed read whose key lacks the current workspace/org id, or that
  can execute before the id resolves. Entity scope must both partition the key
  and gate the read through a non-null boundary or `skipToken`.
- An `invalidates` that doesn't match the reads the mutation actually
  affects. `invalidates: []` is only correct when the mutation touches no
  cached read; use `backgroundInvalidates` when a read should refresh without
  extending mutation pending state. Keys must come from the same domain
  `queries.ts`.
- Post-processing of `data` (`.map`/`.filter`/reshape) at a call site or in
  a wrapper hook — transforms belong in `select`.
- In-place mutation of `data` — cached results are shared across consumers.
- A correctness-sensitive read (billing, quotas) relying on default
  `staleTime` without an explicit refetch or a tighter `staleTime`.
- A query key containing a coerced sentinel (`?? ''`, `?? 0`, a dummy
  object) paired with `enabled:` — hoist the null check to a component
  boundary, or use `skipToken` with the real `null` in the key. See
  "Nullable query inputs" in `AGENTS.md`.
- A nullable input whose "missing" state is surfaced through
  `isPending`/`isLoading` instead of being derived from the input
  (e.g. `id === null`).

## Call sites

- TanStack's callback style `mutate(vars, { onSuccess, onError })` — the
  layer exposes only the awaited, Result-returning `mutate` (callbacks drop
  on mid-flight unmount).
- Holding a hook result as an object and reaching into `.mutate` /
  `.isPending` — destructure and rename to domain-meaningful names.
- Spreading a query result or using rest destructuring (`{ data, ...meta }`).
  TanStack tracks accessed result properties; spread/rest subscribes the
  component to every property and causes unnecessary rerenders.
- Direct `useMutation` for ordinary mutations. The only exception is
  documented advanced optimistic concurrency requiring cancellation,
  snapshot rollback, and last-writer reconciliation; it still belongs in the
  domain query owner and uses canonical keys.
