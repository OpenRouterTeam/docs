# HubSpot Dev Environment

Scripts for provisioning and seeding a HubSpot Developer Test Account
that mirrors production structure without exposing real customer data.

## Prerequisites

1. A HubSpot Developer Test Account created from the production portal
   (Settings → Development → Testing → Test Accounts → Create)
2. A Service Key created in the test account with CRM read/write scopes
   (Settings → Integrations → Service Keys)
3. The production HubSpot token (stored locally, **not** in Infisical dev)

## Environment Variables

| Variable | Source | Description |
|---|---|---|
| `HUBSPOT_PROD_ACCESS_TOKEN` | Local / 1Password | Production token (read-only usage) |
| `HUBSPOT_DEV_ACCESS_TOKEN` | Local / 1Password | Dev test account Service Key |

## Step 1: Provision Structure

Clones pipelines, deal stages, custom properties, and custom object
schemas from production into the dev account.

```bash
HUBSPOT_PROD_ACCESS_TOKEN=pat-na2-... \
HUBSPOT_DEV_ACCESS_TOKEN=pat-na2-... \
  bun run x scripts/hubspot-dev/provision.ts
```

### Dry-run mode

To see what would be created without making any changes to the dev
account:

```bash
HUBSPOT_PROD_ACCESS_TOKEN=pat-na2-... \
HUBSPOT_DEV_ACCESS_TOKEN=pat-na2-... \
  bun run x scripts/hubspot-dev/provision.ts --dry-run
```

Reports which pipelines, properties, and custom objects already exist,
would be created, or would have enum options updated. No writes to the
dev account, no `id-mapping.json` generated.

This creates `scripts/hubspot-dev/id-mapping.json` with the prod → dev
ID mapping for all pipelines and stages.

**After provisioning**, update the `DEV_CONFIG` object in
`packages/clients/hubspot/config.ts` with the provisioned dev
pipeline/stage IDs printed in the output. The fields map as follows:

- `providerOps.pipelineId` → Provider Ops pipeline
- `providerOps.qualificationStageId` → Qualification stage
- `providerOps.negotiationStageId` → Negotiation stage
- `providerOps.signatureStageId` → Signature stage
- `providerOps.closedWonStageId` → Closed Won stage
- `providerOps.closedLostStageId` → Closed Lost stage
- `providerOps.unqualifiedStageId` → Unqualified stage
- `startupApplication.pipelineId` → Startup Application pipeline
- `startupApplication.inReviewStageId` → In Review stage
- `startupApplication.qualifiedStageId` → Qualified stage
- `startupApplication.disqualifiedStageId` → Disqualified stage
- `enterprisePipeline.sequencePipelineId` → Sequence pipeline
- `enterprisePipeline.salesPipelineId` → Sales pipeline (if created)

Also update Infisical `dev` with:
- `HUBSPOT_ACCESS_TOKEN` → dev Service Key
- `HUBSPOT_PORTAL_ID` → dev test account portal ID

## Step 2: Seed Anonymized Data (optional)

Exports contacts, companies, and deals from production, strips PII,
and imports anonymized records into the dev account.

```bash
HUBSPOT_PROD_ACCESS_TOKEN=pat-na2-... \
HUBSPOT_DEV_ACCESS_TOKEN=pat-na2-... \
  bun run x scripts/hubspot-dev/migrate.ts
```

**Requires** `id-mapping.json` from Step 1 (used to remap pipeline and
stage IDs).

Running this again will archive existing dev records before importing
a fresh set.

### Dry-run mode

To preview what would be migrated without writing to the dev account:

```bash
HUBSPOT_PROD_ACCESS_TOKEN=pat-na2-... \
HUBSPOT_DEV_ACCESS_TOKEN=pat-na2-... \
  bun run x scripts/hubspot-dev/migrate.ts --dry-run
```

Exports from prod, anonymizes, and logs a summary with record counts
and sample anonymized records. No archiving, importing, or association
creation happens.

### What gets anonymized

| Field | Transform |
|---|---|
| Emails | `testuser-{hash}@example.com` |
| Names | `FirstName_{i}` / `LastName_{i}` |
| Company names | `Company_{i}` |
| Domains | `company-{hash}.example.com` |
| LinkedIn URLs | `https://linkedin.com/in/test-{hash}` |
| Clerk user IDs | `user_test_{hash}` |
| Organization IDs | `org_test_{hash}` |
| Due diligence notes | `(redacted)` |
| Supporting materials | Removed (GCS keys) |

### What passes through unchanged

- Deal amounts, credit tiers, employee count ranges
- Partner keys and names
- Product info, OpenRouter usage descriptions
- Deny reasons (category only, not notes)
- Pipeline stage distribution

## Refreshing Dev Data

Re-run Step 2 at any time. It archives all existing dev CRM records
before importing, so you always get a clean dataset.

## File Structure

```
scripts/hubspot-dev/
├── README.md           # This file
├── api.ts              # Shared HubSpot REST helpers
├── anonymize.ts        # PII stripping transforms
├── types.ts            # Shared types and Zod schemas (IdMapping)
├── provision.ts        # Structure provisioning (Step 1)
├── migrate.ts          # Data migration (Step 2)
└── id-mapping.json     # Generated: prod→dev ID mapping
```

## Notes

- `id-mapping.json` is gitignored (contains portal-specific IDs).
- The production token is used **read-only** — no writes to prod.
- Custom objects require Enterprise features. Dev test accounts created
  from an Enterprise parent account inherit Enterprise capabilities
  without a 90-day trial limitation.
- Pipeline/stage IDs live in `packages/clients/hubspot/config.ts` as
  static config (not Infisical). Only `HUBSPOT_ACCESS_TOKEN` and
  `HUBSPOT_PORTAL_ID` remain as environment secrets.
