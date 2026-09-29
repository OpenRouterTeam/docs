# @openrouter-monorepo/entitlements

Feature entitlement gates. A **gate** is a small object that decides
whether a viewer is allowed to invoke a set of related operations,
combining two checks:

1. **Entitlement** — does the viewer have access to the feature at
   all? Sourced from `deriveUserEntitlements(user)`, which resolves
   entitlements from individual `user_entitlements` DB rows,
   `is_internal_admin`, and the plan of the user's resolved plan tier
   (`users.plan_tier_id` → `plan_tiers.plan`).
2. **Setting** — has the feature been turned on for the viewer's
   workspace / account / org? Each gate provides its own predicate
   over a caller-supplied context object.

When both checks pass, the gate mints a branded `GateToken` and runs
the caller's callback. Operations that belong to the gate take that
token as their first parameter, which makes calling them outside an
enclosure a **compile-time error**.

## Quick reference

```ts
import { defineGate, GateResult } from '@openrouter-monorepo/entitlements/gate';
import { Feature } from '@openrouter-monorepo/enums/entitlements';

const myGate = defineGate({
  feature: Feature.MyFeature,
  setting: (ctx: { is_my_feature_enabled: boolean }) => ctx.is_my_feature_enabled,
  label: 'My Feature',
});

// Inspect-only check (e.g. to render an upgrade CTA)
const verdict = myGate.check(entitlements, settings);
if (verdict === GateResult.NotEntitled) {
  // show upgrade UX
}

// Run-an-op check
const outcome = myGate.runEntitled(entitlements, settings, (token) =>
  doSomething(token, args),
);
if (outcome.status === GateResult.Granted) {
  // outcome.value is whatever the callback returned
}
```

`runEntitled` returns a discriminated union — `Granted` with a
`value`, or `NotEntitled` / `SettingDisabled` with no value. The
callback only runs in the `Granted` case.

## Multi-op pattern

Most real gates protect more than one operation: a feature usually
has CRUD ops (create / read / update / delete), or an "enforce" plus
a "configure" pair, and so on. The convention is **one gate, one
token type, many ops** — every op takes the same `GateToken<...>` as
its first parameter, so the compiler refuses to let a token from a
different gate flow in.

The worked example below is a fake "Widget" gate that exists only to
demonstrate the shape (no DB table, no API, no UI); real gates under
[`gates/`](./gates/) follow the same pattern. The relevant bits:

```ts
// a fictitious "Widget" gate
export const placeholderWidgetGate = defineGate({
  feature: Feature.PlaceholderWidget,
  setting: (ctx: PlaceholderWidgetSettings) => ctx.is_widget_management_enabled,
  label: 'Placeholder Widget',
});

export type PlaceholderWidgetToken = GateToken<typeof Feature.PlaceholderWidget>;

export function createWidget(_: PlaceholderWidgetToken, args: CreateWidgetArgs): Result<Widget, ErrorT> { /* ... */ }
export function readWidget  (_: PlaceholderWidgetToken, args: ReadWidgetArgs  ): Result<Widget, ErrorT> { /* ... */ }
export function updateWidget(_: PlaceholderWidgetToken, args: UpdateWidgetArgs): Result<Widget, ErrorT> { /* ... */ }
export function deleteWidget(_: PlaceholderWidgetToken, args: DeleteWidgetArgs): Result<{ id: string }, ErrorT> { /* ... */ }
```

Calling a CRUD op is then always wrapped in `runEntitled`:

```ts
const outcome = placeholderWidgetGate.runEntitled(entitlements, settings, (token) => {
  const created = createWidget(token, { name: 'sprocket' });
  if (isErr(created)) return created;
  return readWidget(token, { id: created.data.id });
});
```

Because the only way to obtain a `PlaceholderWidgetToken` is through
`placeholderWidgetGate.runEntitled`, every reachable call site of
`createWidget`/`readWidget`/`updateWidget`/`deleteWidget` is
necessarily inside a gate enclosure. There is no separate "did I
remember to check the gate?" review item.

## Adding a new gate

1. Add the feature to `packages/enums/entitlements.ts`:
   `Feature.MyThing: 'my_thing'`.
2. Create `gates/my-thing.ts` and export:
   - `myThingGate = defineGate({ feature, setting, label })`
   - `MyThingToken = GateToken<typeof Feature.MyThing>`
   - Each op as `(token: MyThingToken, args) => Result<T, ErrorT>`.
3. Co-locate `gates/my-thing.test.ts` covering: entitled vs
   unentitled, setting-on vs setting-off, and one happy-path test
   per op.
4. At call sites, replace any ad-hoc `if (user.has_feature_x)`
   branches with `myThingGate.runEntitled(...)`.
5. Obtain the entitlement set from `@openrouter-monorepo/entitlements/load-entity-entitlements` rather than composing `getUser`, `getActiveUserEntitlements`, and `deriveUserEntitlementsFromTierId` in the route. See `services/cfw-frontend-api/src/routes/AGENTS.md` → Entitlement checks.

## Files

- `gate.ts` — `defineGate`, `GateResult`, `GateToken`, `Gate`
- `check.ts` — `hasEntitlement(entitlements, feature)` helper
- `derive.ts` — `deriveUserEntitlements(user)` resolves
  entitlements from individual `user_entitlements` DB rows,
  `is_internal_admin`, and the plan of the user's resolved plan
  tier. Per-user DB entitlements override plan-level defaults.
  Also exports `deriveUserEntitlementsFromTierId(user)`, a wrapper
  for callers holding a raw user row: resolves `plan_tier_id` via
  the DB-backed plan-tier cache before deriving. Hot inference
  paths should pass their KV-resolved `planTier` to
  `deriveUserEntitlements` directly instead
- `tiers.ts` — `PLAN_FEATURES` maps each `SubscriptionPlan`
  (`standard`, `business`, `pro`, `enterprise`) to its feature set
- `gates/` — one file per gate

## Workspace capabilities (restricted modes)

Separate from gates: workspace **modes** (e.g. HIPAA) subtractively remove
**capabilities** (chat, fusion, ...) from a workspace. The policy table lives
in `workspace-capabilities.ts`; the full system — UI gates, route/endpoint
classification manifests, enforcement middleware, and governance — is
documented in [WORKSPACE_CAPABILITIES.md](./WORKSPACE_CAPABILITIES.md).
