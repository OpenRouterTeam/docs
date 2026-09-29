---
name: mission-control-customer-journey-e2e
description: Run local end-to-end verification of the Mission Control enterprise "Customer Journey" tab — dev server + Infisical secrets, admin gating, the milestone checklist with Done/Reopen, the Phase 0 prerequisite audit, Customer Intel, and the customer_journey_task_progress persistence behind them. Use when changing projects/mission-control/app/enterprise/CustomerJourneyTab.tsx, actions.ts, or customer-journey-derivations.ts.
---

# Customer Journey tab — local E2E testing

The tab is a read-mostly checklist: four phases of milestones, each either
automated (derived from other state) or manual (Done / Reopen), plus a Phase 0
prerequisite audit and a Customer Intel sheet. Deck generation is not part of
this surface: it lives in the max intern's `customer-kickoff` skill (removed
here in PR #39205). Nothing on this tab should call Devin.

## Start the app

```bash
cd /home/ubuntu/repos/openrouter-web/projects/mission-control
source ../../scripts/infisical/agent-auth.sh && infisical_auth
infisical_run /projects/mission-control bunx tsx scripts/dev.ts   # serves http://localhost:3001
```

`infisical_auth` and `infisical_run` come from [infisical-agent-auth](../infisical-agent-auth/SKILL.md); the token stays in this shell, un-exported.

Gotchas:
- `tsx` is not on PATH; use `bunx tsx`.
- `next dev` spawns a child `next-server`; killing only the parent leaves port 3001
  bound (`EADDRINUSE`). Kill the child pid too before restarting.
- Skipping `infisical_auth` gives "Unable to parse domain url / Failed to automatically trigger login flow".
- Redirect dev-server stdout to a log file (`/tmp/mc-dev.log`) so server action
  calls can be counted with `grep` instead of devtools.

## Access

The page uses `withContextSA({ requireAdmin: true })` — without admin it renders
a 404, which looks like a routing bug. Grant admin in local Postgres:

```bash
docker exec openrouter-web_db psql -U postgres -d postgres \
  -c "update users set is_admin = true where clerk_user_id = '<clerk_user_id>';"
```

URL: `http://localhost:3001/organization/<org-id>/customer-journey`
(an org with enterprise/CRM data is required; `org_3I68H8G6Gx4RuzDycFFCRIwoGZW` worked).

## Persistence: `customer_journey_task_progress`

Done / Reopen and the Phase 0 Verify / Reopen controls all go through
`toggleJourneyWorkstreamSA`, which upserts `customer_journey_task_progress`
(unique on `(org_id, task_id)`, boolean `is_closed`). There is no `completed`
column. This table is what makes a Done survive reload.

```bash
docker exec openrouter-web_db psql -U postgres -d postgres \
  -c "select task_id,is_closed,updated_at from customer_journey_task_progress where org_id like 'org_3I68%' order by updated_at desc;"
```

- `task_id` must exactly match an id in
  `app/enterprise/customer-journey-derivations.ts` (e.g. `step_2_2_sso_scim_setup`,
  not `step_2_2_sso_scim`). A wrong id is silently ignored and looks like a
  hydration bug.
- Display renumbering is display-only — persisted `task_id`s keep their original
  names (e.g. "1.6" writes `step_2_1_technical_setup`, "2.5" writes
  `step_2_6_end_of_onboarding_review`). Assert on IDs in Postgres, not numbers.
- Completing previously-untouched milestones INSERTs new rows, so the row count
  after a run can exceed the pre-run count. Restoring the baseline means every
  `step_%` row `is_closed=false`, not the original row count.

If the tab renders `Failed to load customer journey: Internal Server Error`,
check the dev-server log for `relation "..." does not exist` — a pending
migration hard-fails the whole tab. Run `bun run db:migrate` from the repo root.

## What to verify after a tab change

1. **Rendering:** four phases, every milestone present, automated ones show the
   `⚡ Automated` (or "Planned automated pipeline") pill with no button, manual
   ones show `Done` / `Reopen`. Header progress shows Expected vs Actual.
2. **Done / Reopen round-trip:** click Done on a manual milestone, confirm the
   phase counter and Actual % move, hard reload, confirm they persist, then
   Reopen and confirm the row flips back to `is_closed=false`.
3. **No generation leftovers:** grep the dev log for `getPlaybookSessionStatusSA`
   and `getCustomerJourneyGenerationStateSA` — both must be absent, and the page
   must not show Generate / Re-generate, Sparkles icons, artifact cards, Drive or
   Devin session links.
4. **Customer Intel:** the sheet opens and renders workspace, feature, security,
   identity and CRM sections; closing it does not disturb checklist state.
5. **Phase 0 audit:** see below.

## Phase 0 prerequisite checklist

Three items only, each mapping to one milestone:
`HubSpot deal complete → step_1_1_preclose_checklist`,
`Billing configured in Sequence → step_1_3_instance_invoicing_setup` (never
auto-verified), `OpenRouter account provisioned → step_1_2_close_email_handoff`.
Auto-verified items render `✓` with **no** `Reopen`; manual ones render
`— Pending manual check [Verify]` and, once verified, `✓ Reopen`. Verify/Reopen
must write only the mapped milestone. Blank `hubspot_company_id` in ClickHouse to
force the HubSpot item pending while the account item stays auto-verified.

The GTM handoff brief (`app/clients/hubspot/gtm-handoff.ts`) feeds the HubSpot
item and Customer Intel. Local dev HubSpot lookups commonly return 404 for the
test orgs; the expected result is the fallback warning, not populated fee /
BYOK / payment-terms fields. Report those fields as untested locally rather
than failed.

## Plan-type-gated note (2.4 Lunch & Learn)

`plan_type` comes from ClickHouse `analytics.mart_enterprise_crm`, so flip it
with a mutation and re-read before reloading the page:

```bash
curl -s http://localhost:8123/ --data-binary \
  "ALTER TABLE analytics.mart_enterprise_crm UPDATE plan_type='scale' WHERE org_id='<org>'"
```

Non-enterprise ⇒ the note "Enterprise-plan session — available here for all
orgs" renders under 2.4; anything starting with `enterprise` ⇒ no note. Restore
the original value when done. An org with no CRM row (e.g. a locally seeded fake
org) hits the `crm === null` branch ⇒ no note.

## Seeding a fake enterprise org locally

`bun run x scripts/seed-mission-control-enterprise-org.ts <org-id> "<name>"`
writes only a local Postgres `users` row (`is_organization=true`). The
`/organization/<id>/customer-journey` tab then renders all 4 phases, but the
**Overview tab may 500** (`Failed to fetch organization from Clerk:
resource_not_found`) because the fake id does not exist in Clerk — expect that,
and use a real Clerk org if you need the Overview/CRM panels.

The `clerk_data_unavailable` degradation lives in `OrgSyncUtility.tsx` (rendered
from `UserManagementContent`), which is *not* what fails: the org Overview page
throws earlier in `getOrgDetailsSA`, so a Clerk-unknown org id can still render
`Error: Internal Server Error` on both `/organization/<id>` and `/user/<id>`.
When asked to verify "Overview degrades gracefully", check the dev log for which
server action threw before believing a code-level fix covers the page.

### Local blocker for the "Clerk data unavailable" notice

Even once `getOrgDetailsSA` degrades correctly (returns 200 with
`clerk_data_unavailable: true`), the notice may still not render locally because
`UserManagementContent` first calls `getUserDataSA` / `getPendingJobSummarySA`,
which fetch the internal **usage-record** service via `createOidcJsonGetCaller`.
With only mission-control + Postgres + ClickHouse running, those fail with
`fetch failed` / `ECONNREFUSED` and the page shows a red
`Error: Internal Server Error` block. Distinguish env noise from a product bug:

1. `grep -n "Error 500" /tmp/mc-*.log` and read the `location` + `cause.code`.
   `ECONNREFUSED` ⇒ missing local service, not the Clerk path.
2. Run the same page for a **healthy** org (e.g.
   `/organization/org_3I68H8G6Gx4RuzDycFFCRIwoGZW`) as a control — if the same
   `Error: Internal Server Error` block appears there too, it is environmental.

To actually prove the notice renders, the usage-record service must be up (Tilt
stack / `services/usage-record`); otherwise report the assertion as
untested/blocked rather than failed.

## Kanban card layout: measure, don't eyeball

Phase cards are fixed width (`w-[370px]`), so milestone footers can overflow and a
button may be painted *behind* the next column — visually cut off and unclickable.
Measure instead of trusting a screenshot: in the browser console, for each
`div[class*="w-[370px]"]` compare `getBoundingClientRect().right` of the card
against every descendant `button`. Zero buttons past the card edge is the pass
condition.

Watch the reverse failure mode too: fixes that add `min-w-0` / `break-words` to
contain buttons can collapse sibling elements. The owner badge
(`max-w-[40%] break-words`) is the canary — check its measured width/height; a
badge under ~60px wide and 60px+ tall means the text is breaking mid-word
(`CS`/`M`/`+`/`FD`/`E`) and needs `whitespace-nowrap` or a wider `max-w`.
The healthy shape is a single 20px-tall pill (`CSM + FDE` ≈ 70px,
`VP CS (Sunil)` ≈ 94px, `FDE (Primary) + CSM` ≈ 130px) with computed
`white-space: nowrap`; assert on measured height rather than reading labels
off a screenshot, since a wrapped pill can still look plausible when zoomed.

After a hot reload of `CustomerJourneyTab.tsx`, the first Journey request can fail
with "Failed to load customer journey: An unexpected response was received from
the server." A hard reload (`ctrl+shift+r`) clears it — retry once before
reporting a server-side regression.

## Phase completion vs. automated derivation (don't over-predict "N/N")

An automated milestone completing does NOT necessarily complete its phase — count
the manual milestones that remain. Example on the rebalanced board: Phase 2 has
five items (2.1 SSO, 2.2 Workspace, 2.3 Lunch & Learn, 2.4 Health Check
automated, 2.5 End-of-Onboarding Review manual). Deriving 2.4 (from
`step_2_1_technical_setup` + sso + workspace + lunch&learn, where
`step_2_1_technical_setup` renders in Phase 1 as "1.6") only takes Phase 2 to
`4 / 5`; `5 / 5` requires an explicit `Done` on 2.5
(`step_2_6_end_of_onboarding_review`). Before writing a plan assertion of
"phase hits N/N", enumerate the phase's milestone list in
`customer-journey-derivations.ts` and subtract the manual ones.

Cross-phase derivation is the interesting hook: a click in Phase 1 (1.6) can flip
an automated milestone in Phase 2. Verify both headers in the same frame.

## Known-benign console noise

Clerk development-keys warning, `getContextSA` 404s for
`/api/frontend/v1/catalog/models` and `provider-preferences`, Next image
aspect-ratio warning, React DevTools/HMR logs.

## Devin Secrets Needed

- `INFISICAL_CLIENT`, `INFISICAL_SECRET` (to pull the mission-control dev env)
