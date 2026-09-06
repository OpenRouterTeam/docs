# Self-Serve SSO — Enablement Runbook (ENT-1655)

Ops procedure for enabling Clerk self-serve SSO for an entitled
customer organization, verifying that a connection went active, and
handling orgs that already have a manually-created enterprise
connection.

- **Ticket:** [ENT-1655](https://linear.app/openrouter/issue/ENT-1655/integrate-clerk-self-serve-sso-into-our-ui)
- **Plan:** `plans/ent-1655-self-serve-sso.md`
- **Clerk docs:** [Self-serve SSO](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/self-serve-sso)
  · [Changelog 2026-06-26](https://clerk.com/changelog/2026-06-26-self-serve-sso)

## How the pieces fit

Clerk owns the entire SSO setup flow. Our side is an entitlement gate,
an entry-point page, and an observability mirror:

- **Entitlement:** `Feature.SelfServeSso` (`self_serve_sso`) gates the
  SSO tab on the Organization Members page (third tab, after SCIM
  Mappings; `/settings/organization-sso` redirects there). It is part
  of `PLAN_FEATURES.enterprise`, so enterprise orgs see the page
  automatically; internal admins and orgs with an individual
  `user_entitlements` grant also see it.
- **Clerk per-org toggle:** "Allow this organization to set up
  enterprise SSO" in the Clerk dashboard. Until it is flipped, the
  Security tab does not exist for the org, no matter what we gate.
- **Mirror table:** `organization_sso_connections` mirrors Clerk
  connection state for support/observability. Clerk is the source of
  truth; the mirror is refreshed by reconciliation (see
  [Troubleshooting](#troubleshooting)).

Enabling a customer therefore takes both steps: grant the entitlement
(our side) and flip the toggle (Clerk side).

## Enablement procedure

### 1. Grant the entitlement (non-enterprise pilot orgs)

Individual grants live in the `user_entitlements` table, keyed by
`clerk_user_id`. Organizations are rows in `users` with
`is_organization = true`, so **the grant targets the org's Clerk ID,
not a member's user ID** — the settings page derives entitlements from
the org entity (the SSO status route in `cfw-frontend-api` calls
`deriveUserEntitlements` on the org's `userData`).

Use the existing query helper from a script or console:

```typescript
import { grantUserEntitlement } from '@openrouter-monorepo/db/user-entitlements/queries';

await grantUserEntitlement({
  clerkUserId: '<org clerk id, e.g. org_...>',
  feature: 'self_serve_sso',
  grantedBy: '<your clerk user id>',
  note: 'ENT-1655 pilot: <customer name>',
  // expiresAt: optional ISO timestamp for time-boxed pilots
});
```

Or the SQL equivalent (upsert on `(clerk_user_id, feature)`):

```sql
INSERT INTO user_entitlements
  (clerk_user_id, feature, granted_by, note)
VALUES
  ('<org clerk id>', 'self_serve_sso', '<your clerk id>',
   'ENT-1655 pilot: <customer name>')
ON CONFLICT (clerk_user_id, feature) DO UPDATE
  SET granted_by = EXCLUDED.granted_by, note = EXCLUDED.note;
```

Notes:

- Grants are additive and cached for 60 s in the entitlements read
  path, so allow up to a minute before the page reflects the grant.
- Internal admins (`is_internal_admin = true`) bypass entitlements
  entirely and always see the page — useful for verifying UI states
  without granting anything.
- `SelfServeSso` is part of the `ENTERPRISE_FEATURES` set in
  `tiers.ts`, so enterprise orgs (`is_enterprise = true` or plan
  `enterprise`) are entitled automatically — no individual grant
  needed. It is **not** on the `pro` plan. Individual grants remain
  only for non-enterprise exceptions (e.g. pilot orgs on other plans).

### 2. The customer enables the Clerk toggle themselves

Once entitled, the org admin's SSO tab shows an **"Enable SSO"**
button that flips Clerk's per-org toggle via the SSO status route's
`/enable` endpoint → `PATCH /v1/organizations/{id}`
(one-way; org admins only, for their own org only). No ops action is
needed.

**Fallback (dashboard):** if the API path fails — the parameter is
undocumented, see the section below — flip it manually in the
[Clerk dashboard](https://dashboard.clerk.com):

1. Select the correct instance (production vs. development).
2. Go to **Organizations** and open the customer's organization.
3. Open the **Settings** tab.
4. Under **Organization permissions**, enable **"Allow this
   organization to set up enterprise SSO"**.

Once enabled, a **Security** tab appears in the org's
`<OrganizationProfile />` for members holding the
`org:sys_entconns:manage` permission. We only use Clerk's default
roles, and default `org:admin` includes that permission — so all org
admins get the flow, members do not. No role configuration needed.

### 3. Hand off to the customer

Point the customer's org admin at
`https://openrouter.ai/settings/organization-members?tab=sso` (the old
`/settings/organization-sso` URL redirects there). The tab's
"Configure SSO" button deep-links into the Security tab of the Clerk
modal (via the experimental `__experimental_startPath` prop; if a
Clerk release drops it, the modal opens on its default tab and the
page copy tells them where to click).

## Verifying a connection went active

Any one of these confirms activation; check all three when debugging.

1. **Our SSO tab:** `/settings/organization-members?tab=sso` (as an
   internal admin with the org selected, or ask the customer). The
   panel reconciles from Clerk on load, so it reflects live state —
   the connection card should show status **Active**.
2. **The mirror table:**

   ```sql
   SELECT clerk_connection_id, domain, status, source, updated_at
   FROM organization_sso_connections
   WHERE organization_id = '<org clerk id>';
   ```

   Expect `status = 'active'`. `pending` means created but not yet
   activated. If the row is missing or stale, see
   [Troubleshooting](#troubleshooting).
3. **Clerk dashboard:** the instance's SSO connections list shows the
   connection and its active state, scoped to the organization.

End-to-end proof: a user whose email matches the verified domain
signs in and is routed through the customer's IdP.

## The per-org toggle API (used by the Enable SSO button)

Enablement is self-serve: `enableOrganizationSelfServeSso` in
`packages/clients/clerk/enterprise-connections.ts` PATCHes
`{"self_serve_sso_enabled": true}` (one-way — disabling remains a
dashboard/ops action) and validates that the response echoes the
applied value, failing loudly if Clerk accepts but ignores the
parameter.

Caveats (why the dashboard fallback above exists):

- The parameter is **undocumented**: it appears in neither the
  published Backend API OpenAPI spec (which even declares
  `additionalProperties: false` for this operation) nor
  `@clerk/backend` 3.11.4's `UpdateParams` — the live API is ahead of
  both, same as the `self_serve_sso_enabled` *read* field. Verified
  working with a flip/read/restore round-trip against the development
  instance (2026-07-19).
- **Confirm with Clerk support that the parameter is
  stable/supported.** If Clerk ever drops it, the button starts
  returning its error state (the echo validation catches silent
  ignoring too) and enablement falls back to the dashboard procedure
  until this is revisited.

## Coexistence with manually-created connections (Eastman)

Existing enterprise customers (e.g. Eastman) have connections our
team created in the Clerk dashboard. Per ticket, they stay on the
manual process: **leave their per-org toggle off**. The SSO tab still
lists their connections, and — once entitled — also renders an
**"Enable SSO"** card (same as the empty state) that lets the org
admin flip the toggle themselves. That is a footgun for these orgs
(see the next section); do not grant the entitlement to them until
the coexistence test below has been run.

### What happens if the toggle is flipped anyway

Clerk's docs and changelog are silent on coexistence. The following
is inferred from the clerk-js source
([`packages/ui/src/components/OrganizationProfile/OrganizationSecurityPage.tsx`](https://github.com/clerk/javascript/blob/main/packages/ui/src/components/OrganizationProfile/OrganizationSecurityPage.tsx)
and `ConfigureSSO/hooks/useOrganizationEnterpriseConnection.ts`),
**confidence: medium** — client code is public, but the server-side
FAPI filtering is not, and we have not tested against production
Clerk:

- The Security tab lists connections via the org-scoped Frontend API
  (`organization.getEnterpriseConnections()`) and renders **the first
  one** — the source notes "FAPI currently supports a single
  enterprise connection per organization."
- The hook applies **no filtering by how the connection was
  created**. A dashboard-created connection that is *scoped to the
  organization* would therefore likely appear in the Security tab,
  where the org admin has full mutations: update, deactivate,
  **delete**, and change provider (which deletes and recreates).
- Dashboard connections created *instance-wide* (no organization
  selected) are presumably not returned by the org-scoped query and
  would not appear — but this is untested.

Practical implication: flipping the toggle for an org with an
existing org-scoped connection likely hands the customer's admin the
keys to that connection, including deletion. Do not flip the toggle
for such orgs until the staging test below has been run.

### Recommended staging test procedure

On the development Clerk instance:

1. Create an org and a dashboard enterprise connection scoped to it
   (Clerk dashboard → SSO connections → "For specific domains or
   organizations" → select the org).
2. Flip the org's self-serve toggle and open the Security tab as an
   org admin.
3. Record whether the manual connection appears, and which mutations
   (edit/deactivate/delete/test) are offered.
4. Repeat with an *instance-wide* connection (no org selected) and
   record whether the tab treats the org as having no connection —
   and if so, whether creating a self-serve connection alongside the
   instance-wide one causes conflicts for the same email domain.
5. Document results here and update the confidence level.

### What our mirror does with manual connections

Reconciliation upserts every org-scoped SAML connection it finds in
Clerk, keyed by `clerk_connection_id` — including manually-created
ones. The `source` column:

- defaults to `'self_serve'` for rows first discovered by
  reconciliation (sync never sets `source`);
- is **preserved on upsert** when omitted — a row seeded with
  `source = 'manual'` keeps it across every subsequent sync;
- makes the row **exempt from sync deletion** — reconciliation only
  deletes stale `self_serve` rows. A `manual` row missing from
  Clerk's response is kept and logged
  (`orgSso.reconcile: manual rows missing from Clerk response`), so a
  transient empty/partial Clerk listing can never wipe ops-managed
  rows. Removing a `manual` row is an explicit ops action.

So for accurate reporting, seed the mirror row with
`source = 'manual'` when recording a known manually-created
connection (e.g. an Eastman backfill); reconciliation will then keep
its status/domain fresh without clobbering the source or deleting
the row.

## Customer-facing flow (what the org admin sees)

For support context — the entire flow below happens inside Clerk's
modal, not our code:

1. **Security tab** in the org profile modal (via our "Configure SSO"
   button or the modal's own navigation).
2. **Domains** — add their email domain; verify ownership via a DNS
   `TXT` record Clerk provides.
3. **Connection** — pick an IdP (Okta, Google Workspace, Microsoft
   Entra ID, or custom SAML) and follow inline setup instructions to
   exchange metadata with their IdP.
4. **Test** — run an end-to-end test sign-in from the wizard.
5. **Activate** — flip the connection live. From then on, users with
   matching email domains sign in through the IdP, and matching users
   are auto-added to the org (Clerk JIT provisioning defaults).

## Troubleshooting

- **Page shows "Enable SSO" for an entitled org:** the Clerk per-org
  toggle is off (or no connection exists yet). The admin can click it
  to self-serve — see step 2 of the enablement procedure. For orgs
  with manually-seeded connections, this is a footgun (see
  [Coexistence](#coexistence-with-manually-created-connections-eastman)).
- **Page 404s / not visible:** entitlement missing — the API returns
  404 to hide the feature from non-entitled orgs. Check the
  `user_entitlements` row is keyed by the **org's** Clerk ID and has
  not expired; remember the 60 s entitlements cache.
- **Mirror table stale or missing rows:** Clerk emits **no webhook
  events for the enterprise-connection lifecycle** (verified against
  `@clerk/backend` 3.11.4 webhook types and Clerk's OpenAPI webhook
  spec). Only `organizationDomain.*` events fire during setup, and we
  use them to trigger a full reconciliation. Gaps are expected —
  e.g. activation itself emits nothing. The settings page reconciles
  on every load, so the cheapest fix is opening
  the SSO tab for the org; the mirror is also served
  (with a `wLog`) even when Clerk is unreachable.
- **Deep link lands on the wrong tab:** the
  `__experimental_startPath: '/organization-security'` prop was
  dropped or renamed by a Clerk upgrade. Harmless — the modal opens
  on its default tab; users click "Security" manually. Fix the
  constant in
  `projects/web/app/[locale]/(user)/(dashboard)/settings/organization-sso/ConfigureSsoButton.tsx`.
- **Customer's IdP sign-in fails after activation with
  `saml_jit_provisioning_disabled`:** JIT provisioning was disabled
  for the connection; the user has no pre-provisioned account. Either
  re-enable "Create users during sign-in" or provision the user via
  invitation/Directory Sync.
