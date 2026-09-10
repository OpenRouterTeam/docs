# Web review additions

- Frontend server actions and RSC entrypoints must not use direct database
  access. Call a private `cfw-frontend-api` REST route and consume it through
  TanStack Query in the shared data layer; see
  [`../../packages/frontend/data-layer/AGENTS.md`](../../packages/frontend/data-layer/AGENTS.md)
  and [`../../packages/frontend/data-layer/README.md`](../../packages/frontend/data-layer/README.md).
- Keep the shared `HistorySidebar` container/drawer as the single owner of
  history navigation behavior across chat and fusion; consumers should provide
  data and layout context rather than fork the drawer implementation.
- All-providers consumers should use the frontend API route and preserve its
  public/private filtering contract.

# Web Review Guidelines

## Keep dynamic request APIs outside `unstable_cache`

When caching server-action work with the `edge-cache` `cache()` helper
(`unstable_cache`), Clerk auth and other dynamic request APIs must stay in the
action, outside the cache callback. Carry the identity through the cache key
(e.g. the entity ID) instead.

*Source: [PR #27126](https://github.com/OpenRouterTeam/openrouter-web/pull/27126)
— cached overdue-invoice status per entity; auth stays in the action and the
cache key carries the entity ID.*

## Don't cache transient lookup failures

When a cached lookup wraps a vendor or DB call, a transient failure must not be
stored for the full TTL — return the fail-open value without caching it, so the
next request retries. Also keep the `wrap()` fail-open behavior: an error path
should degrade to the empty status, not surface as a server-action error.

*Source: [PR #27126](https://github.com/OpenRouterTeam/openrouter-web/pull/27126)*

## Shared data layer (TanStack Query)

Code touching the shared data layer — TanStack Query reads/mutations,
`useAPIMutation`, `createQueryKeys`, and `queryOptions`/
`infiniteQueryOptions` factories — has its own implementation and review
rules. See
[`../../packages/frontend/data-layer/AGENTS.md`](../../packages/frontend/data-layer/AGENTS.md)
and
[`../../packages/frontend/data-layer/REVIEW.md`](../../packages/frontend/data-layer/REVIEW.md).

## Analytics scope and lineage

Saved charts must restore relative dates and filters while retaining creator
and entity scope. Activity and logs detail views should preserve server-tool
lineage roots and workspace context, with chart timezone labels derived from
the selected display timezone rather than the browser default.

## Pricing display review

Flag pricing displays that derive units or free status locally instead of
using `components/pricing/display-pricing.ts` and
`packages/helpers/pricing-line-items.ts`. Numeric formatting is not the
semantic boundary to review.

Zero legacy token prices are not evidence of free pricing. Image and video
models may store paid display pricing alongside zero token fields. The
endpoint free flag identifies a free variant or stealth model and is not
authoritative in both directions.

Keep legacy token fields for ranking, sorting, filtering, and billing. Compare
is a deliberate exception because its tier selection, blended pricing, and
slash separator are compare-specific. Reject generic helpers that need
caller-specific flags to absorb those differences.

## Workspace capability review

New user-facing surfaces must record a workspace-capability decision. A new
page route in the `(user)` or `(interactive)` route groups must be classified
in `app/workspace-route-capabilities.ts` (CI enforces this). Flag any PR that
classifies a new surface as `AVAILABLE_IN_ALL_MODES` without stating why the
surface is safe for HIPAA-restricted workspaces.

Leaf controls inherit the capability of the surface they serve: flag new
buttons, CTAs, or menu entries that link to or act on a capability-gated
surface without a `useWorkspaceCapabilityGate` check at their composition
point. Blocked nav and menu entries render disabled through the shared
`CapabilityDisabledNavItem` components with their standard tooltip; reject
hidden entries and hand-rolled per-surface disabled treatments alike. See
`packages/entitlements/WORKSPACE_CAPABILITIES.md` for the full model.

## Copy must describe what the code does

Every user-visible string is an assertion about runtime behavior. When a branch changes, its copy changes with it.

- A terminal state needs terminal copy. If a failure path deliberately stays put, it renders an error with a retry — not the "Redirecting you…" or spinner copy of the success path.
- Descriptive copy ("chat with the flow that created this post") only ships when the code it describes exists.
- A label or tooltip must match the number beside it. Aggregate wording over a single-entity value is wrong even when the number is right.

```tsx
// BAD: the reject path never navigates, but the copy promises it will
if (isErr(result)) return; // stays on /logout
return <p>Redirecting you to the home page.</p>;

// GOOD
if (isErr(result))
  return <ErrorState title='Sign out failed' onRetry={retry} />;
```

## In-flight mutations: freeze the inputs, re-read the state

A mutation that resolves against a snapshot taken before it started silently discards whatever the user did in between.

- Disable **every** field the submit reads while the request is in flight, not just the one that triggered it.
- Clear a dirty/unsaved latch only if the submitted revision is still the current one; otherwise the newest edits look saved and are not.
- A dialog that owns an in-flight mutation ignores close requests until it settles — a late success must not write over the surface the user moved to.
- A retry re-reads the state it depends on. Reusing the snapshot from the failed attempt reproduces the failure.
