# Sequence provisioning scripts

## `provision-plan-tier-products.ts`

Idempotently creates the Sequence catalogue (usage metrics, products, and
prices) that back **pro / enterprise** plan-tier billing. Standard/business
plans are not provisioned here — they bill via top-up surcharges.

### What it creates

All metric and product names are prefixed with `[2026 Refresh]` so they're
distinguishable from objects created by hand in the Sequence dashboard.

Metrics (both aggregate the daily `usage_updated` event):

- `[2026 Refresh] OpenRouter Inference Usage` — `SUM(openrouter_non_byok_usage)`
- `[2026 Refresh] OpenRouter BYOK Upstream Usage` — `SUM(byok_upstream_usage)`

Only these two priced metrics are provisioned. The BYOK fee is recomputed from
upstream usage via the `BYOK Usage` graduated % price, so no separate
pre-computed byok-fee (or byok-request-count) metric is created.

Products (`label` is the customer-facing invoice group header):

- `[2026 Refresh] OpenRouter Subscription` (label `Subscription Fee`) — one
  `FIXED` price per pro/ent tier
- `[2026 Refresh] OpenRouter Credits` (label `OpenRouter Credits`) — one shared
  `LINEAR` price (`1.0`): non-BYOK usage recovered at cost, on the inference
  usage metric
- `[2026 Refresh] OpenRouter Credit Overage` (label
  `Credit Overages - Platform Fee`) — one `GRADUATED` **percentage** price per
  tier on the inference usage metric (`0%` below the non-BYOK threshold, the
  tier's `non_byok_fee_fraction` above)
- `[2026 Refresh] OpenRouter BYOK Usage` (label `BYOK Usage`) — one `GRADUATED`
  **percentage** price per tier on the BYOK upstream usage metric (`0%` below
  the BYOK threshold, the tier's `byok_fee_fraction` above)

Sequence treats a percentage tier's rate as a **literal percent**, so the
stored fraction is scaled to whole-number percent before it's sent
(`byok_fee_fraction = 0.05` → `"5"` for 5%; a raw `0.05` would render as
0.05%). Unlimited tiers (no threshold) skip the overage / BYOK price entirely.

### Attaching products to a customer's billing schedule

Sequence has no reusable "bundle"/"plan" object — a customer's plan is realized
by a billing schedule that lists individual price IDs. To bill a pro/enterprise
customer, attach all four products, selecting the price that matches their tier:

| Product | Price to select |
| --- | --- |
| Subscription | the tier's `FIXED` price (e.g. `Pro $2000 Subscription`) |
| Credits | the shared `OpenRouter Credits` price |
| Credit Overage | the tier's `GRADUATED` % price (e.g. `Pro $2000 …`) |
| BYOK Usage | the tier's `GRADUATED` % price (e.g. `Pro $2000 BYOK Usage`) |

Do **not** also attach `MONTHLY_CREDIT_USAGE` to a pro/enterprise schedule — it
bills the total and would double-charge against the component lines above.

All rates (subscription fee, non-BYOK threshold, overage fraction) are read
from the live `plan_tiers` rows in the **target environment's** database — the
script never hardcodes the numbers.

### List prices, not price variants

Prices are created via `POST /list-prices`, **not** `POST /prices`. The two
endpoints look interchangeable in the API but behave differently:

- `/list-prices` creates reusable **catalogue** prices that appear in the
  product's "List prices" table — what this script wants.
- `/prices` creates schedule-bound **price variants** that only surface under
  a customer's billing schedule and leave the product showing "No list
  prices."

If a product ever shows an empty "List prices" table after provisioning,
this is the first thing to check.

### Idempotency

Metrics and products are matched by name; prices by `(productId, name)`. The
Sequence create endpoints are not upserts, so this name-matching is what
prevents duplicates.

Products and prices are **updated in place** when they already exist but have
drifted from the plan: a product whose `label` changed is `PUT`-updated, and a
price whose structure/billing changed (e.g. a corrected percentage) is
`PUT`-updated by id. Anything already matching is skipped. So re-running after a
fix corrects the existing objects rather than spawning duplicates. (Metrics are
still create-or-skip — their definitions don't change.) Use `--dry-run` to see
which objects would be created vs. updated before writing.

### Choosing the target environment

The target is **not** a flag. `SequenceClient` selects sandbox vs production
from `isProduction()` (`OR_ENV`) and reads the matching `SEQUENCE_API_KEY`
injected by Infisical. You choose the target by how you invoke the script.

**Sandbox** (dev default — hits `sandbox.sequencehq.com`):

```bash
bun run x scripts/sequence/provision-plan-tier-products.ts -- --dry-run
bun run x scripts/sequence/provision-plan-tier-products.ts
```

`SEQUENCE_API_KEY` lives under the `/services/cfw-api` Infisical path (also `/services/cfw-webhooks`, `/services/cfw-frontend-api`, and `/projects/mission-control`), not `/scripts`, so the bare `bun run x` invocation cannot see it. Read it into the shell with the helper from [infisical-agent-auth](../../.agents/skills/infisical-agent-auth/SKILL.md) and hand it, with the token, to the one command that needs it. Don't write it to `.env.development.local` or any other file:

```bash
source scripts/infisical/agent-auth.sh && infisical_auth
infisical_get /services/cfw-api SEQUENCE_API_KEY SEQUENCE_API_KEY
INFISICAL_TOKEN="$INFISICAL_TOKEN" SEQUENCE_API_KEY="$SEQUENCE_API_KEY" \
  bun run x scripts/sequence/provision-plan-tier-products.ts -- --dry-run
```

**Production** (hits `eu.sequencehq.com`, requires `--confirm`). This step is for a human at their own terminal with a personal `infisical login`; agents must not target `--env=prod` (see [infisical-agent-auth](../../.agents/skills/infisical-agent-auth/SKILL.md)):

```bash
OR_ENV=production infisical run \
  --projectId=771b7bc0-6578-41b0-886e-9fcdb66e9173 \
  --env=prod --path=/scripts --include-imports=false -- \
  tsx --tsconfig ./scripts/tsconfig.json \
  scripts/sequence/provision-plan-tier-products.ts --confirm
```

The script prints the resolved base URL and detected environment on startup,
and refuses to write to production without `--confirm` (use `--dry-run` to
preview prod safely).

### Flags

- `--dry-run` — print every metric/product/price that *would* be created
  without writing. Existing objects are still listed.
- `--confirm` — required to write against production. Ignored in sandbox.

### Prerequisites

- `SEQUENCE_API_KEY` for the target environment (injected by Infisical at the
  `/scripts` path).
- `PG_US_CENTRAL1_POOL_DB_URL` for the target environment (the script reads
  `plan_tiers`). `bun run x` injects this; running `tsx` directly requires it
  in the environment.
- The sales-tax category (`SaaS (Software as a Service)`) must be set **by hand
  in the dashboard** on each of the four products after they're created — open
  the product catalog, select the product, set its tax category. Sequence does
  not allow setting it via the API ("Tax category invalid"), so the script does
  not manage it: it neither sends it on create nor flags a mismatch as drift, so
  the manual setting survives re-runs.

### After running

The script logs the resulting product IDs. Paste them into
`packages/invoices/sequence/constants.ts`. Attaching these prices to specific
customer billing schedules is a separate, reviewed step (not automated here).
