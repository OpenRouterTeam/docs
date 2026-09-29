# Plan-tier-change sandbox scripts

Runnable versions of the manual test plan for appending a plan-tier-change phase
to an existing Sequence billing schedule (no second schedule, no double bill).

These scripts drive the **production** code — `appendTierChangePhase` and the
schedule-state rules from `@openrouter-monorepo/clients/sequence/helpers` — against
a real Sequence sandbox, so a passing run is evidence about Sequence's behavior
rather than about a re-implementation of ours.

## Safety

- The target is chosen by how you invoke the script (`SequenceClient` reads
  `isProduction()`), and every script prints the resolved base URL first.
- Anything that writes refuses to run against production unless you pass
  `--confirm`. Don't; these are sandbox tools.
- `apply-tier-change.ts` is a **dry run by default** — it fetches, computes, and
  prints the update body without writing. `--apply` performs the `PUT`.
- `inspect-schedule.ts` and `check-customer-state.ts` never write.
- Nothing is ever deleted. Sequence has no delete endpoint for customers or
  schedules, so fixtures are cancelled/archived by hand in the sandbox
  dashboard; every script prints the ids it created or touched.

## Running

`SEQUENCE_API_KEY` lives under the `/services/cfw-api` Infisical path, so a bare `bun run x` can't see it. Read it once into this shell with the helper from [infisical-agent-auth](../../../.agents/skills/infisical-agent-auth/SKILL.md), then hand it and the token to each `bun run x` (nothing is exported):

```bash
source scripts/infisical/agent-auth.sh && infisical_auth
infisical_get /services/cfw-api SEQUENCE_API_KEY SEQUENCE_API_KEY

run() {
  INFISICAL_TOKEN="$INFISICAL_TOKEN" SEQUENCE_API_KEY="$SEQUENCE_API_KEY" bun run x "$@"
}
```

Prerequisite: the catalogue must already exist in the sandbox, since the scripts
resolve `listPriceIds` by tier label (`Pro Tier 1`, `Pro Tier 2`, …). Provision
it with `scripts/sequence/provision-plan-tier-products.ts` if a tier lookup fails.

Note on prices: `PUT /billing-schedules/{id}` does **not** mint prices from a
phase's `listPriceIds` (schedule *creation* does). It accepts the field and
silently ignores it, leaving a phase with no prices that bills nothing. So a
tier change first creates concrete prices with `POST /prices` and attaches them
as `priceIds` — `apply-tier-change.ts` runs the same production helper
(`createSchedulePricesFromListPrices`), which is why `--apply` is required
before any price is created. A failed run can leave those prices behind
unattached; they are harmless (nothing bills a price that is not on a phase)
but they do accumulate in the catalogue's price list.

## The scripts

| Script | Writes? | Purpose |
| --- | --- | --- |
| `create-fixture.ts` | yes | Sandbox customer (or `--customer-id`) + starting schedule, optionally discount-split |
| `inspect-schedule.ts` | no | Dump a schedule's phases, prices, discounts, ARR metadata |
| `check-customer-state.ts` | no | What the setup flow would decide for a customer |
| `apply-tier-change.ts` | with `--apply` | Run the tier-change transform and assert the result |

## Test plan scenarios

### A — same tier is idempotent

```bash
run scripts/sequence/tier-change/create-fixture.ts -- --tier="Pro Tier 1" --start-date=2026-01-01
run scripts/sequence/tier-change/check-customer-state.ts -- --customer-id=<cus> --expect=appendable
```

The customer has exactly one live schedule, so the flow would append rather than
create. Same-tier skipping itself is decided from the org's plan tier in the DB
(`deal-actionable.ts`), not from Sequence — exercise that half in Mission Control.
What this proves on the Sequence side: one schedule, and re-running never mints a
second one.

### B — tier change appends a phase

```bash
run scripts/sequence/tier-change/apply-tier-change.ts -- \
  --schedule-id=<bs> --tier="Pro Tier 2" --effective-date=2026-05-01 --apply
```

Asserts: same schedule id; the crossing phase now ends `2026-04-30`; exactly one
phase starts `2026-05-01` with the Tier 2 prices, no discount, and a fresh
12-month end date; no old-tier phase left after the transition; the customer
still has exactly one schedule.

### C — future effective date

Same command with `--effective-date` in the future. The Sequence shape changes
immediately (that's the assertion here); deferring the OpenRouter plan tier to
that date is the `scheduled_plan_tier_changes` half, verified in Mission Control.

### D — downgrade

Same command starting from a Tier 2 fixture and targeting `Pro Tier 1`. There is
no separate downgrade path — identical assertions must hold.

### E — discount truncation

```bash
run scripts/sequence/tier-change/create-fixture.ts -- \
  --tier="Pro Tier 1" --start-date=2026-01-01 --discount-until=2026-04-01
run scripts/sequence/tier-change/apply-tier-change.ts -- \
  --schedule-id=<bs> --tier="Pro Tier 2" --effective-date=2026-06-01 --apply
```

The fixture has a discounted phase then a full-price phase. After the change the
past discounted phase is kept as-is, the full-price phase is truncated to
`2026-05-31`, and the new Tier 2 phase carries no discount.

Move `--effective-date` inside the discount window (e.g. `2026-03-01`) to check
the other half: the discounted phase truncates and the scheduled full-price
phase is dropped entirely.

### F — ambiguous / unsafe states are refused

```bash
# Two live schedules for one customer: attach a second schedule to the fixture.
run scripts/sequence/tier-change/create-fixture.ts -- \
  --tier="Pro Tier 1" --start-date=2027-01-01 --customer-id=<cus>
run scripts/sequence/tier-change/check-customer-state.ts -- --customer-id=<cus> --expect=reconcile
```

Also use `--expect=reconcile` against a customer whose only schedule was
suspended or completed in the dashboard. `apply-tier-change.ts` deliberately
takes a schedule id directly and does not re-run this selection — the refusal is
the setup action's job, and this script proves the rule it applies.
