# Data Layer

Shared client data layer for internal API reads and mutations, backed by
TanStack Query. It replaced the legacy `useAPISWR` data path; see the
[RFC: Frontend Data Layer — SWR → TanStack Query](https://app.notion.com/p/openrouter/RFC-Frontend-Data-Layer-SWR-TanStack-Query-37b2fd57c4dc81f3a033c03d4206fa09)
and epic OPE-5282.

There is intentionally **no query wrapper hook**. Reads are idiomatic
TanStack Query: a `queryOptions`-style factory plus plain `useQuery`. The
layer provides the shared plumbing only:

| Module                  | Provides                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `query-client.ts`       | `DEFAULT_QUERY_OPTIONS`, SSR-safe `getQueryClient()`                                                                    |
| `server-query-client.ts` | `getServerQueryClient()` — per-request server client for RSC prefetching + `<HydrationBoundary>` (see `AGENTS.md`)     |
| `fetch-api-query.ts`    | `fetchAPIQuery` — the shared `queryFn` body (URL serialization, envelope unwrap, abort signal, optional Zod validation) |
| `api-query-error.ts`    | `APIQueryError` (thrown at the TanStack boundary), `extractErrorT`                                                      |
| `query-keys.ts`         | `createQueryKeys` — namespaced key factories                                                                            |
| `use-api-mutation.ts`   | `useAPIMutation` — Result-native mutations with required invalidation                                                   |
| `DataLayerProvider.tsx` | Mounts `QueryClientProvider`                                                                                            |
| `api-route.ts`          | `APIRoute` type, `buildAPIRequestPath`                                                                                  |

Import from subpaths (no barrel):

```ts
import { fetchAPIQuery } from "@openrouter-monorepo/frontend/data-layer/fetch-api-query";
import { createQueryKeys } from "@openrouter-monorepo/frontend/data-layer/query-keys";
import { useAPIMutation } from "@openrouter-monorepo/frontend/data-layer/use-api-mutation";
```

## Setup (once per app)

Mount the provider in the root layout's provider stack:

```tsx
import { DataLayerProvider } from "@openrouter-monorepo/frontend/data-layer/DataLayerProvider";

<DataLayerProvider>{children}</DataLayerProvider>;
```

SWR migration is complete. Do not add SWR providers, hooks, or dependencies.

## Conventions and review rules

The conventions for writing data-layer code (colocation, options-factory
naming, call-site destructuring, mutation rules) live in
[`AGENTS.md`](./AGENTS.md); the patterns reviewers flag live in
[`REVIEW.md`](./REVIEW.md). Both are colocated here so agent tooling picks
them up. The rest of this file is reference documentation.

## Migration mapping from `useAPISWR`

| `useAPISWR`                  | Data layer                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `useAPISWR<T>(route, opts)`  | options factory in `queries.ts` + `useQuery`                                                                        |
| `uri: null` to skip fetching | `skipToken` in the options factory, or hoist the null check — see `AGENTS.md` "Nullable query inputs"               |
| `searchParams`               | `searchParams` passed to `fetchAPIQuery` (byte-identical URL) **and** included in the query key via the key factory |
| `dependencies: [entityId]`   | put the entity id in the query key (`keys.list(entityId)`)                                                          |
| `keepPreviousData: true`     | `placeholderData: keepPreviousData` (from `@tanstack/react-query`)                                                  |
| `dedupingInterval`           | `staleTime` (default 30s covers the common case)                                                                    |
| `revalidateOnFocus`          | `refetchOnWindowFocus` (default `true`, parity)                                                                     |
| `refreshInterval`            | `refetchInterval`                                                                                                   |
| `revalidate()` / `mutate()`  | `refetch()`, or key invalidation via `useAPIMutation`'s `invalidates`                                               |
| `error: ErrorT \| null`      | `extractErrorT(query.error)`                                                                                        |

## Worked example: guardrails

### Before (legacy `useAPISWR` + server action + manual `mutate()`)

Before the migration, `GuardrailsPageContent.tsx` read with `useAPISWR` and
threaded a `mutate` callback into every mutation site:

```tsx
const { data, isLoading, error, mutate } = useAPISWR<GuardrailsView>(
  '/api/frontend/v1/private/guardrails',
  {
    searchParams: { workspace_id: workspace.id },
    dependencies: [workspace.id],
  },
);

const handleDeleteConfirm = async (): Promise<void> => {
  setIsDeleting(true);
  const result = await deleteGuardrailSA(deletedId, workspace.id);
  if (isErr(result)) {
    toast({ title: 'Error', ... });
  } else {
    await mutate(); // manual revalidation, coupled to this component's hook
  }
  setIsDeleting(false);
};
```

The failure mode of this pattern at its worst was the cross-page predicate
hack in `SkillDetailContent.tsx` — deleting a skill had to reverse-engineer
SWR's internal cache-key shape to invalidate the list page's cache:

```ts
await globalMutate(
  (key: unknown) => {
    if (typeof key !== "object" || key === null || !("uri" in key)) {
      return false;
    }
    return (
      typeof key.uri === "string" &&
      key.uri.startsWith("/api/v1/internal/skills")
    );
  },
  undefined,
  { revalidate: true },
);
```

### After (`queries.ts` + `useQuery` + `useAPIMutation`)

```ts
// features/guardrails/queries.ts
import { queryOptions } from "@tanstack/react-query";

export const guardrailKeys = createQueryKeys("guardrails", {
  list: (workspaceId: string) => [{ workspaceId }],
});

export function guardrailsViewOptions(workspaceId: string) {
  return queryOptions({
    queryKey: guardrailKeys.list(workspaceId),
    queryFn: ({ signal }) =>
      fetchAPIQuery<GuardrailsView>("/api/frontend/v1/private/guardrails", {
        searchParams: { workspace_id: workspaceId },
        schema: GuardrailsViewSchema,
        signal,
      }),
  });
}
```

```ts
// features/guardrails/queries.ts
export function useDeleteGuardrail(workspaceId: string) {
  return useAPIMutation({
    mutationFn: (id: string) => deleteGuardrailSA(id, workspaceId),
    invalidates: [guardrailKeys.all()],
  });
}
```

```tsx
// GuardrailsPageContent.tsx
const { data, isPending, error } = useQuery(
  guardrailsViewOptions(workspace.id),
);
const { mutate: deleteGuardrail, isPending: isDeleting } = useDeleteGuardrail(
  workspace.id,
);

const handleDeleteConfirm = async (): Promise<void> => {
  const result = await deleteGuardrail(guardrail.id);
  if (isErr(result)) {
    toast({ title: "Error", description: result.error.message });
    return;
  }
  toast({ title: "Guardrail deleted" });
};
```

The handler keeps the exact control flow of calling the server action
directly — `await`, `isErr`, done. No `mutate` threading, `isDeleting` comes
straight off the mutation and covers the refetch, and the skills-style
cross-page invalidation is `invalidates: [skillKeys.all()]` — a structural
key match, not a predicate over SWR internals. See [`AGENTS.md`](./AGENTS.md)
for the full mutation and call-site conventions.

## Skeleton for a new `queries.ts`

```ts
import type { Widget } from "./types";

import { WidgetSchema } from "./schemas";

import { fetchAPIQuery } from "@openrouter-monorepo/frontend/data-layer/fetch-api-query";
import { createQueryKeys } from "@openrouter-monorepo/frontend/data-layer/query-keys";
import { useAPIMutation } from "@openrouter-monorepo/frontend/data-layer/use-api-mutation";
import { queryOptions } from "@tanstack/react-query";

import { deleteWidgetSA } from "./api/actions";

export const widgetKeys = createQueryKeys("widgets", {
  list: (workspaceId: string) => [{ workspaceId }],
  detail: (id: string) => [id],
});

export function widgetListOptions(workspaceId: string) {
  return queryOptions({
    queryKey: widgetKeys.list(workspaceId),
    queryFn: ({ signal }) =>
      fetchAPIQuery<Widget[]>("/api/frontend/v1/private/widgets", {
        searchParams: { workspace_id: workspaceId },
        schema: WidgetSchema.array(),
        signal,
      }),
  });
}

export function widgetDetailOptions(id: string) {
  return queryOptions({
    queryKey: widgetKeys.detail(id),
    queryFn: ({ signal }) =>
      fetchAPIQuery<Widget>(`/api/frontend/v1/private/widgets/${id}`, {
        schema: WidgetSchema,
        signal,
      }),
  });
}

export function useDeleteWidget(workspaceId: string) {
  return useAPIMutation({
    mutationFn: (id: string) => deleteWidgetSA(id, workspaceId),
    invalidates: [widgetKeys.all()],
  });
}
```

## Defaults (and why)

Defined in `query-client.ts` (`DEFAULT_QUERY_OPTIONS`):

| Option                 | Value    | Rationale                                                                                                                                                                                                                                                                                   |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retry`                | `false`  | `useAPISWR` returned `Err` Results as SWR _data_, so no retry machinery ever ran in this codebase. TanStack's default (3 retries, including on 4xx) would be a silent behavior change and would quadruple the load of every failing request. Opt in per-query where retries genuinely help. |
| `refetchOnWindowFocus` | `true`   | Parity with SWR's `revalidateOnFocus` default.                                                                                                                                                                                                                                              |
| `staleTime`            | `30_000` | Approximates SWR's serve-stale-revalidate-in-background behavior without refetching on every remount.                                                                                                                                                                                       |

## Error handling

The data layer is Result-native at its edges (matching the codebase's
Result-monad rules) and throws only at the TanStack boundary, where thrown
errors drive `isError`, retries, and devtools. The thrown `APIQueryError`
carries the original `ErrorT` (`error.errorT`); use `extractErrorT(query.error)`
to feed it into `ErrorT`-shaped consumers like `useGlobalErrorMonitor`.

## Follow-ups

- **Devtools**: `@tanstack/react-query-devtools` is not bundled. Adding it
  requires a lazy dev-only import that stays out of production bundles; do
  it in a follow-up when the provider is actually mounted.
