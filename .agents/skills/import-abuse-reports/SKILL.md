---
name: import-abuse-reports
description: Upload a sheet of provider abuse reports (identifiers plus optional request IDs) to the cfw-internal abuse-reports import endpoint, authenticating with a Devin OIDC bearer token. Use when someone shares a CSV of user_profile_id / request_id rows from a provider and asks to file them as abuse reports.
user-invocable: true
---

# Import Abuse Reports

Turn a provider's abuse sheet into `provider_abuse_reports` rows via `POST https://openrouter.ai/api/v1/internal/abuse-reports/import` on cfw-internal. The route is in `services/cfw-internal/src/routes/abuse-reports/import.ts`, the request schema in `packages/db/provider-abuse-reports/import-api.ts`, and the persistence logic in `services/cfw-internal/src/abuse-reports/run-import.ts`. Read the schema before building a payload; it is the source of truth when this skill and the code disagree.

## Inputs to confirm before uploading

- **Provider**: the `ProviderName` enum value from `packages/enums/providers.ts` (`Anthropic`, `OpenAI`, ...). The route rejects the lowercase slug with `providerName: Invalid provider`. Infer it from the identifier prefix and models, then state the assumption.
- **Abuse type**: one of `ABUSE_TYPES` in `packages/enums/abuse-types.ts`. Sheets from providers usually do not carry one. Ask the requester rather than guessing; `other` is the fallback they may choose.
- **Columns**: the sheet needs an identifier column and, optionally, request ID, timestamp, and model columns. Unknown extra columns (region, etc.) go into `notes`.
- **Identifier kind**: the resolver understands provider safety identifiers, provider profile IDs, and our own Clerk `user_`/`org_` IDs (an internal case tracker exported as a CSV, for example), with attached request IDs as the fallback. A Clerk ID resolves to itself when the account exists, so the report shows on the account's Mission Control page. Rows the resolver cannot place land unresolved and still show up in the Sentinel alert digest as fresh, so tell the requester before uploading. Reports imported before Clerk-ID resolution shipped stay unresolved until someone runs the Mission Control "replay unresolved" action for that provider. Leave emails, credits, and other account metadata out of `notes`.
- **Idempotency**: set `reportRef` on every row when the sheet has a stable key (`<sheet slug>:<identifier>:<abuse type>` works, within `MAX_REPORT_REF_LENGTH`). Include every dimension that distinguishes a report: the endpoint keeps only the first of two rows sharing a `reportRef`, so a key without the abuse type silently drops an identifier's second category. The insert is idempotent on `(provider_name, report_ref)`, so a re-run returns the existing report instead of creating a second one.

## Steps

1. Inspect the CSV: row count, distinct identifiers, distinct models, any blank cells.
2. Build the payload with the bundled script. It validates the provider and abuse type against the enums and groups requests under their identifier.

   ```bash
   mkdir -p /tmp/abuse-import
   bun run .agents/skills/import-abuse-reports/scripts/build-import-payload.ts \
     --csv /path/to/sheet.csv --provider Anthropic --abuse-type other > /tmp/abuse-import/payload.json
   ```

   The script splits cells on bare commas and does not handle quoted fields, so a sheet with commas inside quotes (free-text notes, action columns) needs a proper CSV parser. When the sheet's columns do not match the script's (account-level sheets with action/case columns instead of request rows), write a one-off builder and validate its output with `SafetyIdentifierImportInputSchema.safeParse` from `packages/db/provider-abuse-reports/import-api.ts` before uploading.

   The script refuses to build a payload when an identifier exceeds 500 requests or the sheet exceeds 1,000 identifiers. Stop and ask the requester which 500 requests to keep or whether to file with the earliest 500 by timestamp, then split oversized sheets by identifier without splitting one identifier's requests because later duplicate rows are skipped without appending requests.

3. Mint a fresh OIDC token and POST in the same shell command. Tokens are short-lived, so do not store them or print them.

   ```bash
   TOKEN=$(bun run scripts/devin/oidc-token.ts) && curl -s -o /tmp/abuse-import/response.json -w "HTTP %{http_code}\n" \
     -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     --data @/tmp/abuse-import/payload.json https://openrouter.ai/api/v1/internal/abuse-reports/import
   ```

   Verify auth first if unsure: `curl -H "Authorization: Bearer $(bun run scripts/devin/oidc-token.ts)" https://openrouter.ai/api/v1/internal/devin/whoami` must return the session's `devin_id`. Imports over OIDC are attributed to the requester's Clerk user when `whoami` returns one, otherwise to `devin:<devin_id>`. The route also accepts an internal-admin Clerk session for humans using Mission Control.

4. Read the response and report it verbatim to the requester, including the payload and response files as attachments.

## Reading the response

`data.outcome` is `completed` or `partially_committed`. Counts:

- `created_count` new reports inserted.
- `skipped_count` rows whose `(identifier, abuseType)` pair already existed for that provider. Skipped rows are not touched at all, so their request IDs, notes, and model are dropped silently. The response does not say which rows were skipped; diff the payload identifiers against Mission Control if the requester needs to know.
- `resolved_count` / `resolved_clerk_user_ids` reports that resolved to an OpenRouter account. Resolution is best effort; unresolved reports can be replayed later.
- `import_batch_id` for auditing and for retrying a `partially_committed` import. On a partial commit, do not resend the whole payload blindly; earlier chunks are already saved and will show up as skipped.

A `200` with `created_count: 0` means nothing was filed. Do not report that as a successful import.

## After the import

Every report lands as status `received` with no alert stamp and joins the unalerted queue, which the provider-abuse digest drains oldest-first to scanner-runs at `MAX_UNALERTED_PROVIDER_ABUSE_REPORTS` per tick, so a large import (or an existing backlog) spreads across several ticks. The import endpoint accepts no status, and the status endpoint (`PATCH /api/v1/internal/abuse-reports/{id}`) sits behind the cfw-internal admin key, not Devin OIDC, and needs report IDs the API does not list. A status pass therefore happens in Mission Control at `https://internal.openrouter.ai/admin-utils/abuse-reports/batch/<import_batch_id>`, or needs a code change. Say so when the requester asks for statuses to be set from the sheet.

## Gotchas

- `providerName` is case-sensitive and must match the enum value, not the URL slug.
- `requestTimestamp` must parse as a date; the schema canonicalizes it and rejects garbage with a 400.
- Rows are deduplicated in the payload by identifier and abuse type before insert, so the same identifier appearing twice with different requests must be merged client-side (the script does this).
- Validation errors arrive as `{"error":{"message":"<path>: <reason>","code":400}}` and abort the whole import; nothing is written on a 400.
