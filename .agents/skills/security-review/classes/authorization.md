# Authorization Review

This class applies when a change:

- Adds or changes a caller-supplied-ID path to a row read or write that
  touches the query call, scoping predicate, or query argument.
- Passes a caller-supplied ID or workspace or tenant identifier to an
  object-storage `get`, `put`, `delete`, or `list`.
- Changes the function that constructs an object-storage key or the function
  that authorizes the requested tenant or workspace scope.
- Adds or changes an exported function with a module-level or function-level
  `'use server'` directive in any Next.js project, including
  `projects/mission-control`, whether or not the function name ends in `SA`.
- Adds or changes middleware that exempts server-action requests from an
  authentication gate.
- Adds or changes a `services/cfw-frontend-api` route.
- Adds or changes a query helper under `packages/db` or `packages/clickhouse`.
- Adds or changes a Next.js API route handler (`app/api/**/route.ts`) in any
  Next.js project.
- Passes a client-supplied user-id, creator-id, or workspace-id filter into an
  analytics or list query.
- Adds or changes a feature flag, email allowlist, or other rollout gate that
  decides who may reach a family of server actions or routes.
- Adds or changes an ingress, tunnel, or reverse-proxy config that decides
  which paths reach a service.

## Rule

**The ownership predicate belongs in the query, not next to it.**
Authorization and data access must be one operation.

Prefer a query that requires tenant or owner scope. A caller-side check
followed by an unscoped `getKeyById(id)` is not an atomic ownership boundary.
SEC-172 (PRs [#33193](https://github.com/OpenRouterTeam/openrouter-web/pull/33193),
[#33349](https://github.com/OpenRouterTeam/openrouter-web/pull/33349),
[#33398](https://github.com/OpenRouterTeam/openrouter-web/pull/33398)) swept
the bare-id `packages/db` accessors and pushed the owner predicate into the
statement; a new accessor that takes an id without a required owner argument
reintroduces the shape that produced SEC-94, SEC-100, and SEC-166.

## Failure modes to reject

### Wrong predicate

`key.clerk_user_id === ctx.user.entityId` is not sufficient in an organization:
`entityId` is the organization ID, so every member can pass the comparison.
This was fixed in SEC-94, PR
[#29628](https://github.com/OpenRouterTeam/openrouter-web/pull/29628),
commit `4a72ec91d6`. The accepted pattern is `authorizeApiKeyWrite`, which
resolves the key's own workspace and permits only workspace managers or the
key's `creator_user_id`. Do not substitute the caller's current entity for the
object's owner.

### Conditional predicate

An ownership check inside `if (workspaceId)` is not a check: omitting the
optional client-controlled field omits the guard. SEC-100, PR
[#30317](https://github.com/OpenRouterTeam/openrouter-web/pull/30317),
commit `4eacb09ffd`, had this shape while the mutation was keyed only by
`api_key_id`. The accepted fix hoisted key ownership validation so it runs on
every `assignApiKeyGuardrailSA` invocation. Authorization must not depend on
an unrelated optional input.

The read variant is worse: a query helper that applies the workspace
predicate only when the optional parameter is present turns omission into a
wider read, not a narrower one. The broadcast-destinations read route scoped
by `entity_id` alone and let a member omit `workspace_id` to read every
workspace in the organization (SEC-177, PR
[#33344](https://github.com/OpenRouterTeam/openrouter-web/pull/33344)). The
accepted fix calls `requireWorkspaceAdmin` before the query, matching the
sibling `byok` route. For any helper with a required `entityId` and an
optional `workspaceId`, ask what the omitted case returns and who is allowed
to receive it.

### Unscoped primitive

`getKeyById(id)` has no required tenant argument, while its sibling
`getKeysById({ entityId, ids })` does; both are in
`packages/db/api-keys/queries.ts`. The same shape exists in
`packages/db/provider-api-keys/*` and `packages/db/presets/queries/*`.
Prefer the scoped form. If an unscoped helper is unavoidable, put an
unconditional ownership check immediately adjacent to the operation and state
the exception in the PR description.

The accepted remedy is PR
[#13273](https://github.com/OpenRouterTeam/openrouter-web/pull/13273),
commit `9dc92d3a4c`, which converted `deleteGuardrail(id)` and
`updateGuardrail(id, updates)` into `(id, entityId, ...)` and moved the
`entity_id` predicate into the statement. Copy two details from it: make the
scope a positional argument so every call site must supply it, and return
"not found" rather than an error for a non-matching row, so a foreign ID is
indistinguishable from a missing one.

### Role is not ownership

A passing role check does not prove the caller owns the object. `requiredRole`
on `withContextSA` (PR
[#10118](https://github.com/OpenRouterTeam/openrouter-web/pull/10118),
commit `4cc185e4e1`) establishes privilege level, and it is skipped entirely
for personal, non-organization contexts. An org admin still passes it while
acting on another tenant's row. Role and ownership are separate predicates;
a handler that mutates a caller-supplied ID needs both.

### Unresolved role is not a personal context

Treating `orgRole === undefined` as proof of a personal account lets an
organization caller bypass workspace membership and reach the entity ownership
path. PR [#32325](https://github.com/OpenRouterTeam/openrouter-web/pull/32325),
commit `557f369821`, fixed `authorizeWorkspaceAccess` by gating unrestricted
access on `!orgId`. PR
[#32324](https://github.com/OpenRouterTeam/openrouter-web/pull/32324), commit
`d808af9c84`, fixed `createAuthCodeRouteHandler` by requiring membership when
`orgId` is present, the role is not admin, and the requested workspace is not
the default. Gate on the presence of org context itself and let an unresolved
role fall through to the membership check rather than past it.

The same short-circuit recurred in a second helper family two months later:
`assertCallerCanAccessWorkspace` and `assertCallerCanManageWorkspace` in
`packages/frontend/server-actions/workspace-auth.ts` still treated an
unrecognized org role as a personal account, and `GET /provider-preferences`
trusted a caller-supplied `workspace_id` after only a UUID check (SEC-184, PR
[#33567](https://github.com/OpenRouterTeam/openrouter-web/pull/33567)). The
accepted derivation is that a personal account means the absence of an org
(`!orgId`), a user ID is required before any admin or default-workspace
shortcut, and an unknown role is treated as an ordinary member. When a fix
changes a shared auth predicate's semantics, sweep every helper that
duplicates its short-circuits in the same change; a mirror that keeps the old
order is a finding.

### Entity scope is not member scope

Inside an organization, `entityId` is the organization id, so a query scoped
by entity alone hands every member the whole organization's data. Two
analytics routes had this shape, and both also forwarded a client-supplied
user-id filter array straight into the query, letting a member target a named
colleague: `/user-request-summaries` (SEC-136, PR
[#31029](https://github.com/OpenRouterTeam/openrouter-web/pull/31029)) and
`/user-sessions` (SEC-167, PR
[#33085](https://github.com/OpenRouterTeam/openrouter-web/pull/33085)).

The accepted pattern is the caller-scoping block in
`services/cfw-frontend-api/src/routes/migrated/user-sessions.ts:209-254`:
re-verify org membership from the primary so a revoked member fails closed,
let an admin keep the requested filter, and force every other caller's filter
to `[callerUserId]` rather than trusting the client-supplied array. A
role-based boundary inside one entity is still an authorization boundary;
tenant scope alone does not satisfy it.

### The authorization decision goes stale

An authorization decision recorded at one time and consumed at another needs
a lifetime bound. Browser OAuth authorization codes recorded the workspace
entitlement decision at issuance and could be redeemed indefinitely, so a
member who later lost the entitlement could still exchange an old code for a
key scoped to that workspace (SEC-147, PR
[#32345](https://github.com/OpenRouterTeam/openrouter-web/pull/32345)). The
accepted fix bounds redemption at ten minutes from issuance through a
constant shared with the MCP OAuth flow, treats a missing issuance timestamp
as expired, and runs the check after proof of possession. When a diff mints
or redeems a token, code, or grant, ask when the embedded authorization
decision was made and what bounds its consumption.

### Missing authorization wrapper

An exported function with a module-level or function-level `'use server'`
directive is a server action regardless of its name; naming conventions are
not a gate. This applies to helpers, not just handlers: an exported helper
that lives in an action module is an independently callable endpoint even if
no client ever imports it. `mergeAzureKeysWithStored` decrypted
caller-supplied ciphertext with the platform provider encryption key and was
reachable with no auth wrapper purely because it was exported from a
`'use server'` file (PR
[#33965](https://github.com/OpenRouterTeam/openrouter-web/pull/33965)). For a
function that is not meant to be an action, the accepted remedy is removal of
the endpoint, not a gate: relocate it to a module with `import 'server-only'`
(evidence:
`projects/web/app/(user)/(dashboard)/settings/integrations/azure-key-merge.ts`)
and keep only genuine actions exported from the action module. An entry added
to `scripts/oxlint/server-action-auth-wrapper-baseline.ts` or
`scripts/oxlint/route-handler-auth-baseline.ts` grants an exemption from the
static gate and is itself a finding to justify.

When middleware exempts `next-action` POSTs from authentication, the wrapper
is the only gate, so every exported action needs its own. PR
[#31997](https://github.com/OpenRouterTeam/openrouter-web/pull/31997),
commit `eb7439a6f7`, fixed this in `getEndpointsChangelog` with
`withContextSA`; internal-admin surfaces use `requireAdmin: true`, mirroring
the sibling `admin-utils` actions. Admin API routes use the shared gate in
`projects/mission-control/app/admin-utils/demo-hub/lib/internalAdminGate.ts`
and `requireInternalAdmin.ts`; do not duplicate the predicate.

### A rollout gate is not an authorization gate

An allowlist or flag evaluated in layout, RSC rendering, or client code decides
what is displayed, not who may call. Every server action and route in the gated
family re-checks it inside its own auth wrapper. A generic context wrapper is
not that check: `withContextSA` with `requireAdmin` proves an authenticated
admin, which is exactly the population a rollout allowlist excludes. The check
must fail closed on an anonymous caller, a missing primary email, an unknown
identity, and a failed identity-resolver call, so wrap the resolver rather than
letting it throw past the boundary.

The accepted shape is one combinator that owns context, the allowlist, and
input parsing for the whole family, plus a test that enumerates the module's
exports and asserts each denies for a denied identity (PR
[#38199](https://github.com/OpenRouterTeam/openrouter-web/pull/38199);
evidence: `withDevinShellSA` in
`projects/mission-control/app/devin/devin-shell-sa.ts` and
`projects/mission-control/app/devin/devin-actions.denied.test.ts`). Per-action
checks added by convention leave the next action unguarded, so a gated family
without a structural guard is a finding even when every current action checks.

### The edge forwards every path

When a service's own routes are unauthenticated, the ingress or tunnel config
in front of it is the authorization boundary, and a catch-all forward publishes
every route to anyone who learns the hostname. Require a path allowlist holding
only the paths with a public consumer, with the catch-all refusal last, built
by a pure helper with a per-route test (PR
[#38316](https://github.com/OpenRouterTeam/openrouter-web/pull/38316);
evidence:
`services/cfw-intern-provisioner/src/clients/tunnel-ingress-rules.ts`). Two
further checks: a request-signature check inside the service authenticates only
the paths that verify it and says nothing about the read routes beside them,
and a config applied only on fresh provisioning leaves existing instances open
until the write path re-pushes it.

### Fabricated default workspace

A workspace ID must come from authenticated context or the approved
`cfw-frontend-api` route. Never fall back to
`?? defaultWorkspaceId(entityId)`: that deterministic UUID outlived the
workspace it named (ENT-1778).

Use the helpers in `packages/helpers/require-workspace-id.ts` instead of
respelling the precedence chain:

- Use `requireWorkspaceId` when a missing workspace is an auth-layer invariant
  violation.
- Use `findWorkspaceIdForAttribution` when a caller legitimately proceeds
  without a workspace.
- Use `resolveBudgetAttributionWorkspaceId` for budget matching.
- Use `hasAttributionWorkspace` for guards.

For resolved workspace attribution, `null` and `undefined` are not
interchangeable. `null` means the auth query ran and failed closed on a
soft-deleted workspace, so no other source, including the raw
`api_keys.workspace_id` column, may resurrect that ID. `undefined` means the
field was never computed.

A guard that accepts what `requireWorkspaceId` rejects admits exactly the
payloads it exists to keep out, so guards must share that precedence.

Give every new attribution call site its own `AttributionSite` value. The
monitor message in `configs/terraform-monitors/` branches on it.

Thread the resolved workspace through auth, user context, cached and token
payloads, and post-response consumers. Do not re-resolve it per consumer.

## Patterns to copy

- Use `requireWorkspaceAdmin` from
  `services/cfw-frontend-api/src/helpers/require-workspace-admin.ts` when the
  operation is workspace-admin-only.
- Use `withContextSA` or `withValidatedContextSA` with
  `assertCallerCanManageWorkspace` from
  `packages/frontend/server-actions/context.ts` and
  `packages/frontend/server-actions/workspace-auth.ts`.
- Prefer entity-scoped queries such as `getKeysForProfile` in
  `packages/db/api-keys/get-keys-for-profile.ts`.
- Follow the generation ownership boundary in
  `services/cfw-frontend-api/src/routes/activity/generation-ownership/route.ts`.

The private-route factory at
`services/cfw-frontend-api/src/helpers/create-private-route-app.ts`
authenticates and installs request middleware; it does **not** authorize
caller-supplied object IDs.

## Object-storage key scope

When a resource is addressed by a storage key rather than a row, the key
prefix is the isolation boundary. Every allow path must tie the
caller-asserted scope segment back to a scope proven from authenticated
context, unconditionally, before the storage call.

The accepted in-repo pattern is `authorizeWorkspaceAccess` in
`services/cfw-files-api/src/files/authorize-workspace.ts`, together with
`buildR2Key` and `workspacePrefix` in
`services/cfw-files-api/src/files/r2-key.ts`. The key layout is
`${entityId}/${workspaceId}/${namespace}/${fileId}`, where `documents` is the
default namespace and `sandboxes` is a sibling namespace shared with
`cfw-sandbox`. Construction, listing, and parsing must use the same namespace,
and `fileIdFromKey` must return null outside that prefix so a key cannot be
mis-attributed. The authorization function ties `workspaceId` back to
`entityId` on every allow path. A scoped API key authorizes its own workspace,
and the default workspace is a UUIDv5 of `entityId`. A personal account (`!orgId`)
or org admin uses `getWorkspaceById({ workspaceId, entityId })`. Every other
org caller, including one with an unresolved role, uses `getWorkspaceMember`
with entity, workspace, and user scope.

The entity prefix prevents cross-entity access, but it does not prevent a
caller from addressing a foreign `workspaceId` inside its own entity prefix
or driving that workspace's quota Durable Object. The caller still must
prove workspace authorization before either operation.

## Review checklist

For every caller-supplied ID in the diff:

1. Where does tenant or owner scope enter the data access operation, whether
   as a SQL predicate or a storage-key prefix?
2. Is the scope check or key prefix unconditional before the read or write?
3. Is authorization in the same function or layer as the data access, before
   the query, storage, or quota Durable Object call?
4. Is query scope required by the helper signature, or do key construction,
   listing, and parsing require and preserve the same scope and namespace?
   When adding a required scope to a helper that already takes an options
   argument, fold `id`, the scope, and the options into one object parameter;
   Oxlint `max-params` caps positional parameters at two.
5. Does a cross-tenant negative test at the layer that owns the scoping
   predicate prove refusal and, when a mutation or storage write exists, that
   it was not called?
6. Do the handler's siblings in the same route family or actions module apply
   a gate this handler lacks? Divergence from an established sibling gate is
   itself a finding; the sibling states the intended bar (SEC-83, SEC-136,
   SEC-167, SEC-177 were each the one outlier in an otherwise gated family).

For every exported function in a touched module with a module-level or
function-level `'use server'` directive, confirm it has its own authorization
wrapper, not just the functions renamed or added in the diff.

For an exported internal-admin action, add a non-admin denial test. For
workspace-scoped data, assert soft-deleted resolved workspaces, sibling
workspaces inside the same entity, missing membership, org-admin access, and
failed workspace resolution. When a workspace field enters a public API or
SDK contract, inspect the generated API or SDK output.

## Test requirement

Every in-scope change ships a negative test for another tenant's object ID at
the layer that owns the scoping predicate. If the query helper applies the
predicate unconditionally, a query-layer test proving refusal satisfies this
requirement; do not require a duplicate handler test. Assert both the refusal
(`404` or `403`) and, when a mutation exists, that the mutation was not called.
For a storage-key resource, the authorization layer that runs before the
storage or quota Durable Object call owns the scoping proof. The cross-tenant
authorization cases in
`services/cfw-files-api/src/files/authorize-workspace.test.ts` are the local
pattern.
Report a missing test separately as `TEST GAP`, not as a vulnerability finding:
it means the authorization logic may be correct but its required proof is
absent. Copy the matrix and isolation coverage in
`projects/web/app/(user)/(dashboard)/workspaces/[workspaceId]/keys/authorize-api-key-write.test.ts`
(PR #29628, commit `4a72ec91d6`) and the regression test added by
`4eacb09ffd` for API-key guardrail assignment. For query-layer changes, copy
`should not delete guardrail with wrong entityId` in
`packages/db/integration/guardrails/delete.test.ts` (PR #13273): it re-reads
the row after the refused call and asserts it still exists.

## Return shape

Prefer `404` for an object the caller should not learn exists; use `403` when
the neighboring handler explicitly exposes authorization failure. Check
neighboring handlers before choosing, and keep the response shape consistent.
