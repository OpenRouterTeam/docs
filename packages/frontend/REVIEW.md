# Frontend Package Review Guidelines

## Shared data and navigation foundations

TanStack Query primitives belong in the shared data layer so web and Mission
Control can use consistent query keys, cache behavior, and invalidation.
Feature code should not recreate provider-specific fetch/cache wrappers.
Review every TanStack Query change against both the canonical
[`data-layer/AGENTS.md`](data-layer/AGENTS.md) conventions and
[`data-layer/REVIEW.md`](data-layer/REVIEW.md) checklist, including changes in
Web and Mission Control that import shared frontend code.

Shared history navigation belongs in the `HistorySidebar` container/drawer
boundary. Keep desktop and mobile consumers responsible for layout inputs,
not duplicate history state or drawer behavior.

## Use the `Container` component for page-width layout

Prefer the v2 `Container` component (`components/v2/Container.tsx`) over the
legacy `.main-content-container` CSS class. When migrating a page off the class,
migrate every consumer in the same PR — leaving a consumer on a deleted class
breaks its layout.

Watch the width cascade: `Container`'s `size` variant and a `max-w-*` utility in
`className` both set `max-width`, and `tailwind-merge` keeps the last one. To
constrain a page narrower than the default, pass the width through `className`
(e.g. `max-w-5xl md:max-w-5xl`) rather than bumping `size`.

*Source: [PR #26360](https://github.com/OpenRouterTeam/openrouter-web/pull/26360) — Container design system component; reviewers flagged an un-migrated `ModelNotFound.tsx` consumer and a `size='xl'` width regression on the Labs page.*

## SSR-safe observer hooks

`useResizeObserver`, `useIntersectionObserver`, `useInterval`, and
`useIsMounted` must stay SSR-safe. Use `useIsomorphicLayoutEffect` (not
`useLayoutEffect` directly) so server renders don't warn.

For `useIntersectionObserver`'s `freezeOnceVisible`, freeze on the
threshold-adjusted computed `isIntersecting` value, not the raw observer
entry's `isIntersecting`.

When testing hooks that mock module-level observer/timer state, reset that
state in `beforeEach` so tests don't leak across cases.

*Source: [PR #26340](https://github.com/OpenRouterTeam/openrouter-web/pull/26340) — add `useInterval`, `useResizeObserver`, `useIntersectionObserver` hooks; reviewers caught a raw-entry freeze check and missing per-test mock cleanup.*

## Deterministic timers in tests

Flag any test that awaits a `setTimeout` with a nonzero delay. Timer-driven
behavior belongs under `jest.useFakeTimers()` with
`await act(async () => { jest.advanceTimersByTime(MS); })` and a
`jest.useRealTimers()` restore. Async UI settling belongs in `waitFor`,
`findBy*`, or `await act(async () => {})`, which must not run under fake timers
because Testing Library polls on real timers. A zero-delay macrotask yield is
acceptable only when the production path itself queues a macrotask.

## Shared visual tokens

Model author icons belong in the shared author mapping and asset surface so
marketplace and admin consumers render the same identity. Shared error-toast
content should inherit the toaster foreground color rather than hard-code a
surface-specific text color.
