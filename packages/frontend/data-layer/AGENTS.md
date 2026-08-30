# Data Layer Conventions

Conventions for writing code against the shared TanStack Query data layer.
Reference documentation — module list,
setup, migration mapping, worked example, defaults — lives in `README.md`.
Review-time flags live in `REVIEW.md`; this file carries the conventions
and their rationale.

For the TanStack Query API itself (`useQuery`, `queryOptions`, invalidation,
caching), read the canonical docs:
<https://tanstack.com/query/latest/llms.txt>.
This file only covers the OpenRouter-specific conventions on top of it.

## Colocation

**One `queries.ts` per domain, colocated with the feature that owns it.**

- `projects/web/features/<domain>/queries.ts` for web features
- `packages/frontend/components/<domain>/queries.ts` for shared components
- Mission-control admin utils get one `queries.ts` per util directory

A feature whose components live entirely in a single app route directory and
whose keys no other surface consumes may colocate `queries.ts` in that route
dir instead — creating a `features/` dir to hold one file would split the
feature across two directories. Promote to `features/<domain>/` (keys and
queries together) as soon as any other surface needs the domain's keys
(e.g. an org switcher invalidating them, a dashboard widget reading them).

Consistency comes from three things, not from a central directory:

1. The fixed filename `queries.ts`.
2. Workspace-unique `createQueryKeys` namespaces (the namespace is the cache
   partition — two domains reusing a namespace would collide).
3. The `openrouter/query-primitives-in-owner-files` lint rule:
   `createQueryKeys`, `queryOptions`, `infiniteQueryOptions`, and
   `useAPIMutation` may only be called in canonical owner modules:
   `queries.ts`/`*-queries.ts`, `query-keys.ts` for split keys, and
   `mutations.ts`/`*-mutations.ts` for client-only mutation owners.

Split into `query-keys.ts` + per-resource files only when a domain outgrows
one file. When split, **keys stay in one shared file** — invalidation must be
able to see every key the domain uses.

## Keys come from `createQueryKeys`

`createQueryKeys` is the only sanctioned way to define keys — never write a
key array literal at a call site or in `queries.ts`. Hand-written `as const`
arrays are equivalent in power, but a second convention doubles what
reviewers and the ownership lint rule must check.

## Options factories are the primitive, hooks are sugar

Every resource exports a `queryOptions` factory named `<thing>Options`; paged
resources export an `infiniteQueryOptions` factory with the same naming rule.
Use no `use` prefix, so a factory is callable in `useQuery`, `useInfiniteQuery`,
`useQueries`, `useSuspenseQuery`, `queryClient.prefetchQuery`, and server
components. Component code consumes factories through TanStack's own hooks —
the layer never wraps or re-exports them.

Add a `use`-prefixed hook **in the same file** only when it adds a `select`
transform, an error-monitor side effect, or multi-query composition. Never a
pure one-liner around `useQuery` — call sites write
`useQuery(guardrailsViewOptions(id))` themselves.

Derived shapes belong in `select` (on the options factory, or in one of
those `use` hooks) — not in post-processing of `data` at the call site or in
a wrapper hook. The cache keeps the raw server response as the single source
of truth; `select`-derived views stay render-optimized via structural
sharing.

## Consume query results without spreading

Destructure the query/mutation result and rename to domain-meaningful names
— don't keep an object around and reach into `.mutate` / `.isPending`, spread
the result (`{ ...query }`), or use rest destructuring (`const { data, ...meta }
= query`). Query result objects use tracked properties; rest/spread reads every
property and makes the component rerender for changes it does not consume.
The official `@tanstack/query/no-rest-destructuring` rule enforces this:

```tsx
const { mutate: deleteGuardrail, isPending: isDeleting } =
  useDeleteGuardrail(workspaceId);

const handleDelete = async (id: string): Promise<void> => {
  const result = await deleteGuardrail(id);
  if (isErr(result)) {
    toast({ title: "Error", description: result.error.message });
    return;
  }
  toast({ title: "Guardrail deleted" });
};
```

`mutate` and `reset` are stable references, so destructuring them is safe.

## Reuse canonical options for prefetching

Server and client prefetches must start from the same exported options factory
as the consuming hook. Do not reconstruct the query key, stale behavior, or
other options at the prefetch site. If an RSC needs a server-only transport,
spread the canonical options and override only `queryFn`:

```ts
const options = modelStatsOptions({ modelId, entityId });
await queryClient.prefetchQuery({
  ...options,
  queryFn: ({ signal }) => fetchModelStatsOnServer({ modelId, signal }),
});
```

The factory remains the single owner of cache identity and query policy.

## Server prefetching and hydration

Bridging server-fetched data to client `useQuery` consumers uses the
TanStack "Advanced Server Rendering" pattern
(<https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr>),
never `initialData`. `initialData` never overwrites an existing cache entry
(so `router.refresh()` cannot update the client cache), requires prop
drilling to the consuming component, and loses the server `dataUpdatedAt`.
Dehydrated state carries `dataUpdatedAt` and overwrites older entries.

The per-request server client is `getServerQueryClient()` from
`server-query-client.ts` — a React `cache()`-wrapped `makeQueryClient`, so
every prefetch site in one request shares one client and requests never
share state. Do not call `makeQueryClient()` directly in RSC code, except
for the multi-boundary case below.

```tsx
import { getServerQueryClient } from '@openrouter-monorepo/frontend/data-layer/server-query-client';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';

export default async function Page() {
  const queryClient = getServerQueryClient();
  await queryClient.prefetchQuery({
    ...widgetListOptions(workspaceId),
    // Only when the RSC needs a server-only transport — see
    // "Reuse canonical options for prefetching" above.
    queryFn: () => fetchWidgetsOnServer(workspaceId),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WidgetList />
    </HydrationBoundary>
  );
}
```

The client component under the boundary calls plain
`useQuery(widgetListOptions(workspaceId))` — no seed props. During SSR the
hydrated cache serves the data, so the first-pass HTML contains real rows;
on the client the same entry is available before the first render, so there
is no loading flash.

Two conventions on top of the TanStack pattern:

- **Keys and policy come from the canonical options factory**, exactly as
  for any other prefetch. Seeding with already-fetched data uses
  `queryClient.setQueryData(<thing>Options(...).queryKey, data, ...)`.
- **Seeds keep the default `updatedAt` (the render-time timestamp).** On a
  statically prerendered (ISR) route that timestamp is the generation time,
  frozen into the payload with the data. Hydration only replaces an existing
  cache entry when the incoming `dataUpdatedAt` is newer, so a newer server
  payload (a `router.refresh()` or a newer ISR generation) overwrites the
  cached entry while an older payload never clobbers fresher client data.
  Never seed with `updatedAt: 0` — a zero timestamp is older than every
  cache entry, so later server payloads can never replace what the client
  already holds and `router.refresh()` becomes a no-op for that query.
- **Bounded/partial projections seed with `partialSeedUpdatedAt()`.** When a
  seed is a trimmed projection of what the canonical client query returns
  (e.g. an SSR row cap), a render-time `updatedAt` would leave it fresh under
  `staleTime`, suppressing the client's fetch of the complete dataset — or a
  fresh generation could overwrite complete client data with partial rows.
  `partialSeedUpdatedAt()` (in `server-query-client.ts`) backdates the seed by
  the default `staleTime`, keeping it stale on mount so the client always
  fetches the authoritative full dataset, while newer generations still carry
  newer timestamps than older ones.

`dehydrate` only includes successful queries, so a failed server prefetch
degrades to the client-side fetch instead of hydrating an error.

Call `dehydrate(getServerQueryClient())` at most once per page: the
request-scoped client accumulates every seed site's queries, so each
`dehydrate` serializes the full accumulated set into its boundary, and a
second boundary on the same route would duplicate the first site's state
into its HTML. If a page genuinely needs independent boundaries, give each
site its own `makeQueryClient()` instead of the shared client.

## Mutations

- `mutationFn` is Result-native: pass a server action or
  `fetchJsonResult`-based call directly. `Err` results become mutation errors
  without try/catch at call sites.
- **`mutate` returns a `Result` and never throws.** Await it and branch with
  `isErr`/`isOk`, exactly like calling the server action directly. TanStack's
  callback style (`mutate(vars, { onSuccess, onError })`) is deliberately not
  exposed — it's dropped on mid-flight unmount, losing success toasts and
  tracking.
- `invalidates` is **required** (pass `[]` explicitly for the rare mutation
  that affects no cached reads). Reference keys from the same `queries.ts`.
- Invalidation is awaited before `mutate` resolves: both the awaited call and
  `isPending` cover the refetch of affected queries.
- Server actions keep calling `revalidatePath`/`revalidateTag` — that's the
  server-side RSC cache, orthogonal to the client cache invalidated here.
- Use direct `useMutation` only when `useAPIMutation` cannot express advanced
  optimistic concurrency that needs all of cancellation, snapshot rollback,
  and last-writer reconciliation. Keep that exception in the domain's
  `queries.ts`, document why it is required, and still use canonical keys.
  Ordinary optimistic UI, callbacks, or custom invalidation are not reasons to
  bypass `useAPIMutation`.

## Caching gotchas

A client cache serves stale data by design. Each non-obvious bug class has a
hard rule:

- **Every input the fetch reads must be in the key.** If `queryFn` reads a
  variable that isn't part of the query key, two call sites with different
  inputs share one cache entry and silently serve each other's data. The
  options-factory pattern enforces this structurally: the factory's
  parameters feed both the key and the fetch.
- **Entity scope lives in the key and gates the read.** Every cookie-authed
  read can return different data per workspace/org even when the URL and
  explicit request parameters are unchanged. Include the current entity id as
  a key segment (see `guardrailKeys.list(workspaceId)`) and do not execute the
  read before that id resolves. Use a non-null component boundary or
  `skipToken`; otherwise entity switching can show or cache another entity's
  data until a refetch lands.
- **After a mutation, invalidate — don't expect a refetch.** `staleTime` is
  30s; a remount or navigation inside that window renders cached data with
  no request. Declaring `invalidates` on the mutation is the only reliable
  way to make dependent reads refetch.
- **`data` can be stale while `isPending` is false.** Stale-while-revalidate
  shows the cached value first and refetches in the background. Don't gate
  correctness-sensitive UI (billing amounts, quota checks) on cached reads —
  refetch explicitly or lower `staleTime` for that query.
- **Never write to `data`.** Cached results are shared across every consumer
  of the key and compared by structural sharing; in-place mutation corrupts
  other components and defeats change detection. Derive with `select`,
  update via mutation + invalidation.

## Nullable query inputs

A key input is often `string | null` — while auth or entity context
bootstraps, or because the input is genuinely optional. Two rules apply
in every case; then pick a pattern by *why* the input is nullable.

- **Never coerce a nullable input into a sentinel** (`?? ''`, `?? 0`, a
  dummy object) to satisfy the types. The sentinel becomes a real cache
  key segment. On cookie-authed routes the entity id is in the key
  purely for cache scoping — the fetch succeeds without it — so when the
  `enabled` condition drifts from the coercion (two independent lines
  nothing forces to agree), the current entity's data is cached under
  key `''` and served to every other entity after a switch.
- **Never encode "prerequisite missing" as a loading state.** A
  disabled query is `status: 'pending'` with `fetchStatus: 'idle'`.
  Mapping `isPending` to a spinner shows an infinite skeleton while the
  input stays null; mapping `isLoading` to "done" renders an empty
  state for data that was never fetched. There is no honest single
  boolean — the blocked state is a third state that must either be
  eliminated (case A) or rendered explicitly from the input (case B).

### Case A: bootstrapping input that always resolves

Context that is only null while the surface mounts (auth, entity,
workspace). Don't let the nullability reach the query layer — hoist the
null check to a component boundary and pass a non-nullable prop down:

```tsx
export function NotificationsApp() {
  const { contextEntityId } = useEntity();
  if (contextEntityId === null) {
    return <LoadingState />;
  }
  return <NotificationsAppForEntity entityId={contextEntityId} />;
}
```

Below the boundary there is no `enabled`, no sentinel, and `isPending`
honestly means "first fetch in flight". In-tree exemplar:
`NotificationsApp.tsx` in
`projects/web/app/(user)/(dashboard)/settings/notifications/`.

This works because conditional *rendering* is the tool React gives you
— the `enabled` + sentinel dance only exists because hooks can't be
called conditionally. It also scales: one gate covers every query in
the subtree, instead of N per-query `enabled` conditions that can
drift. Companion trick: `key={contextEntityId ?? 'unresolved-entity'}`
on the gated subtree so entity switches remount and reset local state
(`NotificationsGate.tsx` in the same directory).

### Case B: genuinely nullable input

Dependent queries (B needs a value from A's data), optional user
selections, or a context hook consumed on surfaces you can't gate. Let
the nullable type flow into the options factory and use `skipToken`
(TanStack ≥ 5.25) as the `queryFn`:

```ts
import { queryOptions, skipToken } from "@tanstack/react-query";

export function widgetDetailOptions(id: string | null) {
  return queryOptions({
    queryKey: widgetKeys.detail(id), // the real null, never a sentinel
    queryFn:
      id === null
        ? skipToken
        : ({ signal }) =>
            fetchAPIQuery<Widget>(`/api/.../widgets/${id}`, { signal }),
  });
}
```

- `skipToken` moves "when the query runs, the param is real" from
  convention into the types: TypeScript narrows `id` in the non-skip
  branch, so the fetch can't see a fake value and there is no separate
  `enabled` line to drift out of sync.
- Put the **actual `null` in the query key** — it serializes fine and
  can't collide with a real id, unlike `''`. Widen the key factory to
  match (`detail: (id: string | null) => [id]`) so passing the nullable
  input straight through type-checks.
- Treat "input missing" as its own UI state derived from the input
  (`id === null`), never from the query's loading flags.

`enabled:` remains fine for plain boolean conditions (a feature flag,
"tab is visible") that don't involve coercing a nullable key input.

## Official TanStack Query lint rules

The repository enables the official TanStack Query rules as errors, including
dependency-complete query keys, stable clients and hook dependencies, result
destructuring, void-returning query functions, and canonical mutation/infinite
option ordering.

`@tanstack/query/exhaustive-deps` requires every value read by `queryFn` that
can change the response to appear in `queryKey`. Do not silence it by hiding a
value behind another closure or by adding a broad allowlist entry. The central
allowlist in `oxlint.config.ts` is only for named injected test seams whose
identity cannot change result semantics, and deterministic aliases already
fully represented by primitive key inputs. Any addition needs a commentable,
case-by-case proof; entity ids, filters, pagination inputs, and request bodies
are never allowlist candidates.
