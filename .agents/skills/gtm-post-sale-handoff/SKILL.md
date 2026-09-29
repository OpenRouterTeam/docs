---
name: gtm-post-sale-handoff
description: >-
  Assemble the AE-to-post-sale handoff brief for a signed enterprise deal from
  HubSpot: use case/workload, required technical features, and key stakeholders
  (executive sponsor, technical lead, billing admin). Use when a deal is signed
  and CSM/FDE need context, when Mission Control shows the Phase 0 "GTM Handoff
  Brief" item as incomplete, or when preparing kickoff materials.
user-invocable: true
---

# GTM Post-Sale Handoff Brief

The brief is the contract between the AE and the post-sale team. It carries
three sections and nothing else: **Use Case / Workload**, **Required Features /
Technical Scope**, **Key Stakeholders**. Every field is either extracted from
HubSpot with a named source, or reported as missing. Never invent a value.

Mission Control derives the same brief in code from
`projects/mission-control/app/clients/hubspot/gtm-handoff.ts`. Keep this skill
and that extractor consistent: if you change a field mapping here, change it
there.

## Payload schema

```jsonc
{
  "dealId": "334893771488",
  "dealName": "Acme Corp - Enterprise",
  "companyName": "Acme Corp",
  "useCase": { "value": "...", "source": "deal.use_case", "status": "confirmed" },
  "features": [{ "label": "Zero data retention (ZDR)", "source": "contact.inbound_data_handling_needs" }],
  "stakeholders": [
    {
      "role": "executive_sponsor",   // executive_sponsor | technical_lead | billing_admin
      "name": "...",
      "email": "...",
      "jobTitle": "...",
      "source": "contact.buying_role",
      "status": "confirmed"          // confirmed | inferred
    }
  ],
  "missingFields": ["technical_lead"],
  "isComplete": false
}
```

`status` is `confirmed` when the value comes from a structured CRM field whose
meaning is unambiguous, `inferred` when it comes from free text, a job-title
heuristic, or a company-level field standing in for deal-level intent. Report
`inferred` values as inferred to the reader. Never upgrade an inference to
confirmed.

## Field mapping

Property names below exist in the HubSpot schema. Confirm with
`GET /crm/v3/properties/{deals|companies|contacts}` before relying on any
property not listed.

**Use Case / Workload**, first match wins:

1. `deal.use_case` (textarea) — confirmed
2. `deal.description` — confirmed
3. `company.use_case` — confirmed
4. `company.description`, `company.enriched_company_description` — inferred,
   company profile rather than the workload being bought
5. Deal notes and meeting engagements — inferred, see extraction below

**Required Features / Technical Scope**, union of all that are present:

- `deal.deal_special_terms` (checkbox: `EU Routing / Data Residency`,
  `BYOK Fee Waiver`, `Billed in Arrears`, `Custom Commit Terms`, `Other`)
- `deal.byok_terms`, `deal.other_terms`, `deal.trial_needed` (only `Yes` counts)
- `company.eu_routing`
- `contact.inbound_data_handling_needs` on associated contacts (checkbox:
  `EU in-region routing`, `Zero data retention (ZDR)`, `Guardrails`,
  `Data Processing Agreement (DPA)`)

There is no CRM property for target models, target providers, or custom rate
limits. Those come from notes or from the AE, and are `inferred` at best.
`Billed in Arrears` and `Custom Commit Terms` are commercial terms, not
technical scope, so they do not satisfy the technical-scope requirement on
their own.

**Key Stakeholders**, resolved from contacts associated with the deal, falling
back to contacts associated with the company:

| Role | Confirmed source | Inferred fallback |
| --- | --- | --- |
| Executive sponsor | `contact.buying_role` in `Economic Buyer`, `Decision Maker` | `contact.jobtitle` matching C-level, founder, VP, or head-of, excluding CTO |
| Technical lead | `contact.buying_role` = `Technical Contact` | `contact.jobtitle` matching engineer, architect, CTO, ML, platform, infrastructure |
| Billing admin | `contact.buying_role` = `Billing Contact`, or the company-to-contact association labeled `Billing Contact` | `deal.billing_contact_name` / `deal.billing_contact_email` |

`Champion`, `Primary Contact`, and `Influencer` do not fill any of the three
roles. When several contacts qualify for one role, keep the first by
`buying_role` match and list the others as additional context, not as the role
holder.

## Extraction procedure

1. Find the deal. Search deals for `openrouter_organization_id` or `org_id`
   equal to the Mission Control org ID. If none match, read the company by
   `hubspot_company_id` and take its associated deals. Prefer the deal with
   `date_signed` or `contract_start_date` set, then the most recently created.
2. Read the deal, its associated company, and its associated contacts with the
   property lists above. Requesting a property that does not exist in the
   portal is silently ignored by HubSpot, so a missing property reads as a
   missing value, not an error.
3. Apply the mapping. Record the source property for every value.
4. Only if a section is still empty, read the deal's notes and meeting
   engagements (`/crm/v3/objects/notes` associated to the deal) and extract
   from the AE's own words. Quote or closely paraphrase. Do not synthesize a
   use case from the company website, the industry, or your own knowledge of
   the customer.
5. Emit the payload with `missingFields` naming each unfilled section or role.

## Fallbacks when the CRM is incomplete

- **Section empty after step 4.** Leave the value `null` and name it in
  `missingFields`. An empty brief is a correct brief when the CRM is empty.
- **Ambiguous free text.** Record the candidate value as `inferred` and add
  the ambiguity to the AE request. Two plausible readings means neither is
  confirmed.
- **No stakeholder role match.** Report the role as missing. Do not promote the
  point of contact, the champion, or the deal owner into it. The AE naming the
  wrong person is recoverable, a fabricated technical lead is not.
- **HubSpot unavailable or the deal not found.** Report the brief as
  unavailable, distinct from incomplete, and say which lookup failed.

**AE request.** When anything is missing, ask the AE once, in the deal's Slack
thread or `#cs-ops`, naming exactly the missing fields and where to put each
one. Keep it to the CRM field names, so the answer lands back in HubSpot
rather than in chat:

> GTM handoff for {company} is missing: use case (`deal.use_case`), technical
> stakeholder (set `buying_role` = `Technical Contact` on the contact). Please
> fill these in HubSpot so the kickoff brief and Phase 0 check clear.

## Consumers

- **Phase 0 checklist** in Mission Control auto-clears the `GTM Handoff Brief`
  item only when the use case, at least one technical-scope feature, a
  technical stakeholder, and an executive stakeholder are all present.
- **Customer Intel sheet** shows the brief with per-field sources and the
  missing-field list.
- **Kickoff deck generation** pre-populates its use case, technical scope, and
  stakeholder slides from the brief. Slides for missing fields say the data was
  not in the CRM rather than filling with plausible content.
