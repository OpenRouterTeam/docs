# Enterprise arrears offboarding: local e2e runbook

Drives the Mission Control **Offboard** flow end to end on a local stack against
the real Sequence **sandbox**: freeze debt, publish usage, close the schedule,
issue one closing invoice, then settle (paid webhook) or enforce (deadline
cron). No vendor stubs.

Scripts here target the Sequence sandbox only; they refuse to run against production, and nothing is ever deleted.

## 1. Prerequisites

- Local stack: `bun install && bun run dev:up` (Postgres `:54322`, cfw-internal
  `:8794`, web `:3000`, cfw-api `:8787`, Mission Control `:3001`). If
  `internal`/`mission-control` are not enabled in Tilt:
  `tilt enable internal mission-control`.
- Migrations applied: `bun run db:migrate` must include the
  `arrears_offboarding` migrations (`arrears_offboardings` table with its
  `needs_reconciliation` phase, `users.arrears_offboarded_at`,
  `arrears_offboarding` restriction source).
- Signed in to Mission Control as a local admin
  (`.agents/skills/clerk-dev-signin-token/SKILL.md`).
- Secrets via Infisical (never paste or print values). The helpers come from [infisical-agent-auth](../../../.agents/skills/infisical-agent-auth/SKILL.md); the token and both keys stay in this shell, un-exported, and the `x` wrapper hands them to each `bun run x` below:

```bash
source scripts/infisical/agent-auth.sh && infisical_auth
infisical_get /services/cfw-api SEQUENCE_API_KEY SEQUENCE_API_KEY
infisical_get /projects/web SEQUENCE_WEBHOOK_SECRET SEQUENCE_WEBHOOK_SECRET
export CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USERNAME=default CLICKHOUSE_PASSWORD=clickhouse
x() { INFISICAL_TOKEN="$INFISICAL_TOKEN" SEQUENCE_API_KEY="$SEQUENCE_API_KEY" SEQUENCE_WEBHOOK_SECRET="$SEQUENCE_WEBHOOK_SECRET" bun run x "$@"; }
psql() { docker exec -i openrouter-web_db psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
```

## 2. Fixture

Creates a sandbox customer, usage-metric monthly in-arrears price and an active billing schedule, then seeds five $2.50 ClickHouse generations on each of yesterday and today (D-1/D-0). It prints the Postgres seed (enterprise, billed in arrears, `negative_balance_limit -1000`, `-25` usage debit, one API key) for you to apply. Use a fresh clerk user id and run the fixture and the Mission Control offboard on the same UTC day because the seeded days are relative to today. The start date must be on or before D-1.

The price bills the sandbox credit-usage product (`SANDBOX_PRICING_REFRESH_CREDIT_USAGE_PRODUCT_ID`, `[2026 Refresh] OpenRouter Credits`) rather than a fixture-only product, because the paid-invoice webhook turns a line item into credits only when its product is in `SANDBOX_CREDIT_PRODUCT_IDS`. A fixture product still settles the offboarding, but the account keeps its negative balance instead of being topped up (step 5). The seeded generations carry `variant: standard`, the value the usage pipeline writes; a row seeded without it lands under an empty variant in `user_activity_daily_v7`, which fails the API's `z.enum(Variant)`; the monthly-usage route then answers 500 and the credits page's arrears card renders its unavailable state (`—`) instead of the month's spend.

```bash
ID=user_arrears_e2e_$(date +%s)
LOG_LEVEL=0 NEXT_PUBLIC_LOG_LEVEL=0 x scripts/sequence/arrears-offboarding/create-fixture.ts -- --clerk-user-id=$ID --start-date=2026-09-01 | tee /tmp/$ID.sql
psql < /tmp/$ID.sql
```

Add `--billing-preference=NONE` for a second fixture: Sequence cannot send an
invoice to a customer without a billing contact, so its close-out ends in
`needs_reconciliation` (the reconciliation path below).

## 3. Happy path (Mission Control)

Open `http://localhost:3001/admin-utils/enterprise-offboarding`, **Accounts** tab,
**Offboard** on the fixture (disabled for accounts without
`sequence_customer_id`) → **Review offboarding** → **Freeze debt and issue
invoice**. Cutoff is server time at confirmation. Then check:

```sql
select status, cutoff_at, closing_invoice_id, payment_due_at, last_error from arrears_offboardings where clerk_user_id = '<ID>';
select negative_balance_limit, arrears_offboarded_at from users where clerk_user_id = '<ID>';
```

Start also accepts an optional `paymentDueAt` (ISO 8601 UTC, must be in the future); the Offboard form prefills it to issuance plus 15 days, which is the default when it is omitted. Extending the deadline from the Offboarding tab also moves the Sequence invoice's `dueDate` to the new deadline's UTC day.

Expect one row `awaiting_payment`, `negative_balance_limit = -25`,
`arrears_offboarded_at` set, and in the **Offboarding** tab the row shows the
invoice number and **Started by** as the operator's name. In the sandbox the
invoice is `SENT / UNPAID`, totals `$25.00`, and its D-1/D-0 usage events are
visible on the customer via `GET /api/usage-events?customerAlias=<ID>` or the
Sequence dashboard. The app's `payment_due_at` is issuance plus 15 days, and the Sequence invoice `dueDate` is patched to that instant's UTC calendar day after it is sent. Right after issuance the banner reads "15 days left to pay". Whether the finalize-and-send email carries Sequence's calculated date or the patched one is unverified.

Postpaid stop and prepaid recovery:

```bash
curl -s localhost:8787/api/v1/chat/completions -H "Authorization: Bearer sk-or-v1-$ID" -H 'Content-Type: application/json' \
  -d '{"model":"openai/gpt-4o-mini","max_tokens":5,"messages":[{"role":"user","content":"Say OK"}]}'
# → 402 insufficient credits
psql -c "insert into credits (clerk_user_id, amount, note) values ('$ID', 50, 'e2e top-up')"
# rerun the curl; the first retry may still 402 until the balance propagates → 200
```

## 4. Reconciliation path (`NONE` fixture)

Offboard it the same way. Expect the account frozen, the row in
`needs_reconciliation` with `last_error` populated, and **Record invoice** /
**Abandon** actions in the Offboarding tab.

- **Record invoice**: fix the contact in the sandbox (PUT
  `/customers/{id}/contacts/{contactId}` with `"billingPreference":"PRIMARY"`),
  send the FINAL invoice, then record its id → `awaiting_payment`. Recording an
  invoice of a different customer is rejected with 400.
- **Abandon conflict**: `update users set negative_balance_limit = -24 where
  clerk_user_id = '<ID>'`, Abandon → 409, no state change. Restore `-25`.
- **Abandon**: settle the sandbox invoice first (step 5 without the webhook, or
  mark it PAID in the dashboard), then Abandon → row `failed`,
  `arrears_offboarded_at` cleared, limit back to `-1000`.

## 5. Settlement (paid webhook)

Sends the invoice, marks it PAID in the sandbox and posts a signed
`INVOICE_UPDATED` notification to the local web webhook, exactly as Sequence
would:

```bash
x scripts/sequence/arrears-offboarding/settle-invoice.ts -- --invoice-id=<closing_invoice_id>
```

Use `--webhook-url` only with a loopback host (`localhost`, `127.0.0.1`, or `::1`).

Expect `settled`, `arrears_offboarded_at` null, ordinary prepaid settings restored, and any `arrears_offboarding` restriction revoked. Rerunning is idempotent (same `settled_at`, no duplicate credits); a rerun exits 0 when the credit was already issued.

The delivery adds the closing invoice's credits to the ledger — one `credits` row carrying `sequence_invoice_id` — so the account's balance moves from the frozen debt (`-25`) to `0` and the credits page stops showing an amount owed. That only happens because the fixture bills a product in `SANDBOX_CREDIT_PRODUCT_IDS`; check both halves, since the settlement and the top-up are separate branches of the same webhook handler:

```sql
select status, settled_at from arrears_offboardings where clerk_user_id = '<ID>';
select amount, sequence_invoice_id from credits where clerk_user_id = '<ID>' order by id;
```

## 6. Deadline enforcement

```bash
psql -c "update arrears_offboardings set payment_due_at = now() - interval '1 day' where clerk_user_id = '$ID' and status = 'awaiting_payment'"
curl -s -X POST localhost:8794/api/v1/internal/cron/trigger -H 'Content-Type: application/json' -d '{"task":"enforce-arrears-payment-deadlines"}'
psql -c "select status from arrears_offboardings where clerk_user_id = '$ID'; select source, type, revoked_at from restrictions where clerk_user_id = '$ID'"
```

Expect `enforced` and exactly one `arrears_offboarding` / `spend_cap`
restriction; a second trigger does not duplicate it. The task is not listed in
the Cron Triggers UI. Step 5 afterwards revokes the restriction.

## 7. Daily publisher cutoff

The daily Sequence publisher must skip the account from the cutoff onward. Do
not run the full publisher locally (it touches every sandbox customer);
instead check the eligibility query directly:

```ts
// bun run x /tmp/eligibility.ts   (PG_US_CENTRAL1_POOL_DB_URL pointed at local)
import { getUsersWithSequenceCustomerId } from '@openrouter-monorepo/db/users/lookup-queries';
for (const offset of [-1, 0, 1]) {
  const usageThroughIso = new Date(Date.parse(cutoffAt) + offset).toISOString();
  const rows = assertOk(await getUsersWithSequenceCustomerId({ usageThroughIso }));
  // expect included only for offset -1
}
```

## 8. Re-running against the same account

The fixture creates its own customer, so re-running it for a clerk id that already has one fails with `Customer alias already exists` — the alias holds the clerk id and Sequence has no delete endpoint for customers. Either use a fresh clerk id, or attach to the existing customer (`update users set sequence_customer_id = '<id>'`) and retire its schedules. The fixture checks local ClickHouse before creating the customer and logs the customer id as soon as it exists, so a run that fails partway leaves the id for attaching. A repeat run needs the following, none of it destructive:

- **Retire the previous schedule.** Bounding it is not enough: a schedule whose `endDate` has passed stays `ACTIVE`, so the account reads as having two live schedules and the offboard refuses to guess which one to close. `POST /billing-schedules/{id}/archive` moves it to `CANCELLED`, which is not a live status. Neither customers nor schedules can be deleted.
- **Clear stale usage events.** Sequence keeps the last write per `customerEventId` (`<mon>-<dd>-<yyyy>-usage_updated-<clerk id>`) and there is no `DELETE /usage-events`, so re-sending a day with zeros is what clears it — the same idempotency the daily publisher relies on. Only zero days that no issued invoice depends on.
- **Void invoices that will not be collected.** `POST /invoices/{id}/void` takes drafts and unpaid sent invoices; a paid invoice needs a credit note instead.
- **Expect a rebuild lag.** A schedule's open invoice is not recomputed when a usage event lands. It rebuilds asynchronously (observed around 100 s), or immediately when the schedule itself is written to — which is why a no-op `PUT` on the schedule makes a correction land at once, and why a close-out always gets a freshly rebuilt invoice.
- **Keep the ledger and the usage surfaces in step.** The balance the offboard freezes is `analytics_users.total_credits` minus the Spanner `budget_usage` buckets, while a credits page's monthly figure is ClickHouse spend. Nothing local derives one from the other, so a hand-set ledger can contradict a seeded ClickHouse history; keep the balance equal to the unbilled usage (what the closing invoice asks for) or the two will not reconcile.

## Not covered

Full daily publisher run, backend 422 for accounts without Sequence (button is
disabled in the UI), cancel-confirmation persistence, malformed invoice ids.
