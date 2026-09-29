# Account exposure

Exposure is the money OpenRouter could lose on an account right now. It is a console quantity that sits beside the trust score so review queues can be ordered by score times exposure. It does not enter the score, the policy, or any inference path.

## Formula

```text
total_usd = balance_usd + auto_topup_projection_usd + arrears_headroom_usd + burn_rate_ceiling_usd
```

`computeAccountExposure(input, now)` in `compute.ts` is pure. Every component is either a USD number or the literal `unknown` from `constants.ts`. The total is `unknown` whenever any component is, so a partial sum is never read as the full exposure. Missing inputs are never coerced to zero.

## Component to input mapping

| Doc component | Output field | Input fields | Notes |
| --- | --- | --- | --- |
| Loaded credit balance | `balance_usd` | `balance` | Spendable balance from `getSpendableBalance({ user, balance: getEffectiveBalance(user) })`, the same figure the abuse-rule `balance` field uses. For offboarded arrears accounts this already includes the remaining negative-balance allowance. Negative balances count as `0` loaded credit. `null` means the balance was not loaded and yields `unknown`. |
| Projected auto-top-up | `auto_topup_projection_usd` | `autobuy_credit` | The `amount` of the newest enabled `autobuy` trigger, carried on the payload as `autobuyCredit` with the same trigger filter the auth query uses. `null` means the payload reports no enabled trigger and projects `0`. `undefined` means the payload was loaded without triggers and yields `unknown`. The trigger threshold is not needed because one top-up is projected regardless of when it fires. |
| Arrears billing limit minus paid invoices | `arrears_headroom_usd` | `is_billed_in_arrears`, `arrears_offboarded_at` | `0` for accounts that are not actively billed in arrears, including offboarded ones, whose remaining allowance is already inside `balance_usd`. `unknown` for actively arrears-billed accounts, see below. |
| Burn-rate ceiling | `burn_rate_ceiling_usd` | `usage_daily`, `usage_weekly`, `usage_monthly`, `usage_updated_at` | The highest USD-per-day rate across the buckets in `BURN_RATE_WINDOWS`, projected over `BURN_RATE_PROJECTION_HORIZON_DAYS`. The horizon is one day, the shortest window the buckets resolve, so the ceiling is one more day of spend at the peak rate. The ARS doc asks for a short horizon without fixing one, and lengthening it is a one-constant product change. A bucket whose `usage_updated_at` falls in a previous UTC period for that bucket counts as zero, matching how the credit guardrails read those buckets. |

`toAccountExposureInput(user)` builds the input from a `UserJoinAnalytics` payload and reads the auto-top-up amount from `user.autobuyCredit`. `getUserJoinAnalytics` sets that field on the user it returns, so the cfw-internal console route gets a known projection without a second trigger read. The auth query also selects the amount but `makeUserContext` stores it on `UserContext.autobuyCredit` beside `data`, so a caller holding an auth context must pass `{ ...context.data, autobuyCredit: context.autobuyCredit }` or the projection is `unknown`. No caller does that today because exposure is a console quantity and is not computed on inference paths.

## Components that remain unknown

**Arrears headroom for actively arrears-billed accounts.** The doc defines this as the arrears limit minus invoices already paid. `users.negative_balance_limit` supplies the limit, but nothing on `UserJoinAnalytics` or the auth payload records which arrears invoices have been paid. A paid-invoice source, for example a per-user sum of settled arrears invoices from the billing system, would let this component become `negative_balance_limit` minus that sum. Until then it stays `unknown` and forces the total to `unknown` for those accounts.

## Contract

`console-api.ts` exports `AccountExposureSchema`, the Zod contract for the console response. Consumers import it from here rather than redefining the shape.
