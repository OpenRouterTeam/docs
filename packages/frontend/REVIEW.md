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

## Props, URL, and query results in component state

State initialized from a prop, URL, or query result is exactly one of: a
snapshot (seed once, own thereafter), a draft (editable copy submitted back),
a reset-key (remount via `key` when the source identity changes), or a live
mirror (derive during render or lift the state to its owner) — never a copy
kept current by an effect.

## Use the `Container` component for page-width layout

Prefer the `Container` component (`components/ui/Container.tsx`) over the
legacy `.main-content-container` CSS class. When migrating a page off the class,
migrate every consumer in the same PR — leaving a consumer on a deleted class
breaks its layout.

Watch the width cascade: `Container`'s `size` variant and a `max-w-*` utility in
`className` both set `max-width`, and `tailwind-merge` keeps the last one. To
constrain a page narrower than the default, pass the width through `className`
(e.g. `max-w-5xl md:max-w-5xl`) rather than bumping `size`.

*Source: [PR #26360](https://github.com/OpenRouterTeam/openrouter-web/pull/26360)*

## SSR-safe observer hooks

`useIntersectionObserver` and `useInterval` must stay SSR-safe. Use
`useIsomorphicLayoutEffect` (not `useLayoutEffect` directly) so server
renders don't warn.

For `useIntersectionObserver`'s `freezeOnceVisible`, freeze on the
threshold-adjusted computed `isIntersecting` value, not the raw observer
entry's `isIntersecting`.

When testing hooks that mock module-level observer/timer state, reset that
state in `beforeEach` so tests don't leak across cases.

*Source: [PR #26340](https://github.com/OpenRouterTeam/openrouter-web/pull/26340)*

## Deterministic timers in tests

Flag any test that awaits a `setTimeout` with a nonzero delay. Timer-driven
behavior belongs under `jest.useFakeTimers()` with
`await act(async () => { jest.advanceTimersByTime(MS); })` and a
`jest.useRealTimers()` restore. Async UI settling belongs in `waitFor`,
`findBy*`, or `await act(async () => {})`, which must not run under fake timers
because Testing Library polls on real timers. A zero-delay macrotask yield is
acceptable only when the production path itself queues a macrotask.

## Behavior-first assertions

Prefer assertions about user-visible behavior, accessibility state, and
semantic outcomes over implementation-specific details such as CSS class names.
Assert a class only when that class is itself the documented or functional
contract.

## Shared visual tokens

Model author icons belong in the shared author mapping and asset surface so
marketplace and admin consumers render the same identity. Shared error-toast
content should inherit the toaster foreground color rather than hard-code a
surface-specific text color.

## Accessibility

<!-- src: #38668 talos 2026-08-31 -->

Interactive elements whose label changes with state need an `aria-label` that
reflects the current state, e.g.
`aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}`.

Label a non-native control on the control itself. A `<label>` wrapper
associates only with a native form control, so a headless trigger such as
`SelectTrigger` stays unlabelled. Put `aria-label` or a matching `id` on the
trigger, the way the sibling admin forms do.

```tsx
// BAD: the label text does not reach the trigger
<label>Disposition<Select …><SelectTrigger /></Select></label>

// GOOD
<SelectTrigger aria-label="Disposition" />
```

Error and validation text that appears after an async action needs
`role="alert"` (or `role="status"` for non-error updates) so it is announced.
Use one persistent live region whose content changes — a newly mounted
`aria-live` element is usually skipped by screen readers, so do not mount a
separate live region per loading/error/result branch. Mark decorative icons
next to announced text `aria-hidden="true"`.

## Pending mutation state

The initiating button of an in-flight mutation gets `disabled` plus visible
pending feedback (an `isLoading` spinner or a pending label like "Disabling…"),
not a silent `disabled` alone. Gate sibling controls that could mutate the same
row too — an Edit button while a lifecycle flip is pending, chip remove
handlers while a form is submitting. An `aria-disabled` attribute without a
handler guard does not prevent the click.

One click that affects many records needs a confirmation naming the number
affected ("Ban 50 users?"), and the success message should include the applied
count.

## Layout and JSX noise

Form inputs should be visually aligned within their containers; left-aligned
inputs in centered containers usually read as a mistake.

`<>...</>` around a single child is noise — return the child directly.
