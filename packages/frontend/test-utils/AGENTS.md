# Shared-process DOM test seams

DOM tests in `projects/web` and `projects/mission-control` run many files in one
process. A file that contains an executable `mock.module(` call is excluded from
that group. Use the seams below instead of `mock.module` for the targets they
cover. Every seam restores process-global state in `afterEach` or before each
test, so nothing leaks into the next file.

Run a single file from its package with its DOM preload:
`RTL_SKIP_AUTO_CLEANUP=true bun test --preload ./bun-test.dom-setup.ts ./path/to/file.dom.test.tsx`.

## `renderWithProviders`

Import `renderWithProviders` from
`@openrouter-monorepo/frontend/test-utils/render-with-providers`. It composes,
outermost first, the real locale provider, a fresh query client, Next's real
navigation contexts, then the optional real `UserContextProvider`,
`GlobalProvider`, `GlobalErrorToastProvider`, and finally the caller's
`wrapper`. It returns the RTL result plus `queryClient` and `router`.

```tsx
const { router, queryClient } = renderWithProviders(<Page />, {
  navigation: { pathname: '/settings', searchParams: { tab: 'keys' } },
  entity: { status: 'signed-in' },
  global: { models: [], providers: [] },
  globalErrorToast: true,
  wrapper: MyExtraProvider,
});
```

Cleanup: call `cleanup()` from `@testing-library/react` in `afterEach` when the
package preload does not auto-clean (`RTL_SKIP_AUTO_CLEANUP=true`).

For `renderHook`, build the same provider tree with `makeProvidersWrapper` from the same module. It takes the same options minus the RTL render options and returns `{ Wrapper, queryClient, router }`.

```tsx
const { Wrapper, queryClient } = makeProvidersWrapper({ entity: { status: 'signed-in' } });
const { result } = renderHook(() => useHeldAttestations(), { wrapper: Wrapper });
```

## 1. `@openrouter-monorepo/frontend/hooks/use-entity`

Render the real `UserContextProvider` through the `entity` option. Fixtures come
from `@openrouter-monorepo/frontend/test-utils/clerk-fixtures`
(`createMockClerkUser`, `createMockClerkOrganization`,
`createMockClerkOrganizationMembership`, `createMockClerkEmailAddress`) and
`@openrouter-monorepo/frontend/current-user/mock` (`createMockCurrentUser`).

```tsx
import type { EntityTestOptions } from '@openrouter-monorepo/frontend/test-utils/entity-test-seam';

const ORG = createMockClerkOrganization();
renderWithProviders(<Subtitle />, {
  entity: {
    status: 'signed-in',
    organization: ORG,
    membership: createMockClerkOrganizationMembership({ organization: ORG }),
    currentUser: { is_internal_admin: true },
  } satisfies EntityTestOptions,
});
```

- `status: 'loading'` and `status: 'signed-out'` model Clerk before and after
  load. `organizationLoading: true` keeps the organization hook pending while
  the user is loaded. `currentUser: null` leaves the current-user query
  unseeded so the component sees it pending. `currentUserClerkUserId` seeds the
  row under a different Clerk user than the selected one, to model a stale
  selection that `useCurrentUser` hides until it refetches.
- To move from one state to another inside a test, call
  `applyEntityTestOptions(queryClient, next)` from
  `@openrouter-monorepo/frontend/test-utils/entity-test-seam` and `rerender`.
- Cleanup: none. The preload resets the Clerk stubs and the user store before
  each test.

## 2. `next/navigation`

Use `renderWithProviders` with the `navigation` option, or wrap directly in
`NextNavigationTestProvider` from
`@openrouter-monorepo/frontend/test-utils/next-navigation` when there is no
other provider to compose. Assert on the returned `router` (every method is a
bun mock). To drive `usePathname` across renders, read a `let pathname`
variable inside the wrapper and `rerender`.

```tsx
const { router } = renderWithProviders(<Nav />, { navigation: { pathname: '/a' } });
fireEvent.click(screen.getByRole('link', { name: 'B' }));
expect(router.push).toHaveBeenCalledWith('/b');
```

Cleanup: none. Each render builds its own router.

## 3. `@openrouter-monorepo/frontend/components/ui/Toast`

Observe the process-global `toastManager` with `observeToasts` from
`@openrouter-monorepo/frontend/test-utils/toast-observer`. Call it once at file
or `describe` scope. It subscribes in `beforeEach` and unsubscribes and clears
in `afterEach`. The emitted payload uses `type` for what `toast()` receives as
`variant`.

```tsx
const observer = observeToasts();

it('toasts on save', async () => {
  renderWithProviders(<Form />);
  fireEvent.submit(screen.getByRole('form'));
  await waitFor(() =>
    expect(observer.toasts).toContainEqual(
      expect.objectContaining({ type: 'success', description: 'Saved' }),
    ),
  );
});
```

A rendered `<Toaster />` is not required to observe emissions. Do not spy on the
`toast` export: components import it by binding, so a namespace spy is not seen.

## 4. `@openrouter-monorepo/frontend/components/GlobalErrorToast`

Render the real provider with `globalErrorToast: true`. The provider emits a
destructive toast through the same `toastManager`, so combine with
`observeToasts()` to assert on it, or assert on the rendered error text.

```tsx
const observer = observeToasts();
renderWithProviders(<Section />, { globalErrorToast: true });
```

Cleanup: covered by `observeToasts`.

## 5. `@openrouter-monorepo/frontend/providers/GlobalProvider`

Render the real `GlobalProvider` with the `global` option. Seed model rows with
`createMockModelWithEndpoint` from
`@openrouter-monorepo/router/mocks/mock-model-with-endpoint` plus
`createMockModelEndpoint` from `@openrouter-monorepo/providers/test/mock-endpoint`,
and provider rows with `createMockProviderInfo` from
`@openrouter-monorepo/db/providers/mock`. `global: {}` gives an empty catalog
that is still `isReady`.

```tsx
renderWithProviders(<ModelPicker />, {
  global: {
    models: [createMockModelWithEndpoint('openai/gpt-4o', createMockModelEndpoint('openai/gpt-4o'))],
    providers: [createMockProviderInfo(ProviderName.OpenAI)],
  },
});
```

Cleanup: none. The seeded data lives in the per-render query client.

For the pending and failed catalog states, pass `UnseededGlobalProvider` from
`@openrouter-monorepo/frontend/test-utils/unseeded-global-provider` as the
`wrapper` (without `global`) and drive the catalog request with
`setFetchJsonResultStub` from
`@openrouter-monorepo/frontend/test-utils/fetch-json-result`: a never-settling
promise keeps `isModelsReady` false, an `errT(...)` result sets
`hasAvailableModelsError`. Call `resetFetchJsonResult()` in `afterEach`.

## 6. `@/app/[locale]/(user)/(dashboard)/WorkspaceContext` (web only)

Use `renderWithWorkspace` from
`@/app/[locale]/(user)/(dashboard)/render-with-workspace`. It accepts every
`renderWithProviders` option plus `workspace`, renders the real
`WorkspaceProvider` innermost, and returns `workspaceProps`. Build the workspace
row with `createMockClientWorkspace` from `@openrouter-monorepo/db/workspaces/mock`.

```tsx
renderWithWorkspace(<PresetsTable />, {
  workspace: { workspace: createMockClientWorkspace({ id: 'ws_1' }), isOrgAdmin: true },
});
```

Cleanup: none.

## 7. `@clerk/nextjs`

Hooks (`useUser`, `useOrganization`, `useAuth`, `useOrganizationList`,
`useReverification`) are namespace-spied once per process by the DOM preload and
pass through to the real implementation until a test sets a state. Set the state
with `setClerkTestState` from
`@openrouter-monorepo/frontend/test-utils/clerk-test-stub`, or through the
`entity` option above, which does this for you. Auth actions are exposed as
`clerkSignOutMock`, `clerkGetTokenMock`, `clerkSetActiveMock`, and
`clerkCreateOrganizationMock`.

```tsx
setClerkTestState({ status: 'signed-in', user: createMockClerkUser() });
render(<SignOutButton />);
fireEvent.click(screen.getByRole('button'));
expect(clerkSignOutMock).toHaveBeenCalledTimes(1);
```

For Clerk components (`SignIn`, `SignUp`, `OrganizationSwitcher`), spy on the
namespace in `beforeEach` and restore in `afterEach`:

```tsx
import * as clerk from '@clerk/nextjs';

let spy: ReturnType<typeof spyOn<typeof clerk, 'SignIn'>> | null = null;
beforeEach(() => {
  spy = spyOn(clerk, 'SignIn').mockImplementation(FakeSignIn);
});
afterEach(() => {
  spy?.mockRestore();
  spy = null;
});
```

`useClerk` is not stubbed: render the real `ClerkProvider` for it.

Cleanup: hook state and action mocks reset before each test. Component spies
are the test file's responsibility, as above. `jest.restoreAllMocks()` is safe:
the preload reinstalls the hook spies before the next test.

## 8. `use-signup-timezone` and `use-posthog-client`

- `useSignupTimezone`: call `stubSignupTimezone()` from
  `@openrouter-monorepo/frontend/test-utils/signup-timezone-stub` once at file
  or `describe` scope. It installs a namespace spy in `beforeEach` and restores
  it in `afterEach`. The default state is resolved to `America/New_York`. Use the
  returned `set(state)` to change the value mid-test.
- `usePosthogClient`: the DOM preload already installs the stub from
  `@openrouter-monorepo/frontend/test-utils/posthog-test-stub`, so components
  render without a real client. Do not assert on `posthogCaptureMock`; event
  captures are analytics, not behavior (unit-test-writing skill → Logs,
  Metrics, and fs-log). Set `posthogGetSessionIdMock` /
  `posthogGetDistinctIdMock` when the code forwards those values. Wrap in the
  real `PosthogProvider` to inject a per-test client. Every mock resets before
  each test.

```tsx
stubSignupTimezone();
posthogGetSessionIdMock.mockReturnValue('session-1');
```

## Rules

- Prefer the real provider with fixture values, then an existing util in this
  directory, then a new adapter here. Add a test-only seam in production code
  only when none of those work, and name it in the PR.
- One `createMockX` factory per fixture shape, owned by the module that owns
  the shape. Build fixtures with the factory and `satisfies`, never a cast.
- Anything installed at file scope must be undone in `afterEach`, or be one of
  the preload-owned stubs listed above that reset themselves.
- Remove the `oxlint-disable openrouter/no-module-mocks` comment and the file's
  entry in `scripts/oxlint/module-mock-baseline.json` when the last
  `mock.module` leaves a file.
