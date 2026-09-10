# Notification checks

Enable `notifications_v2_enabled` and the `notifications` entitlement in the dev panel, and wait for `alert-delivery`. Save a localhost webhook sink before clicking **Test**. Each Save creates a new endpoint row, so correlate the current endpoint and test dedup key with `alert_event_delivery`.

- Useful delivery cases: 2xx, 4xx/5xx, redirects, DNS failure, and a resolvable host refusing connections. DNS failure and connection refusal exercise different failure reasons.
- Check `failure_reason` against the displayed result. Destination bodies, URLs containing tokens, and credentials must stay out of `last_error`, logs, and toasts; use a canary and inspect only the delivery just triggered.
- For the no-result polling fallback, temporarily disable `alert-delivery`, click **Test**, and let polling expire. Re-enable and trigger the worker afterward.
- Unmapped reasons require a local ledger fixture; normal worker failures all have mapped copy. With the worker disabled, use the test's dedup key and current endpoint to insert a failed webhook delivery with an unknown reason during polling. Cases with and without `last_error` cover the two fallbacks. Remove the fixture and restart the worker afterward.

The copy mapping and focused tests live in `projects/web/app/[locale]/(user)/(dashboard)/settings/notifications/webhook-test-failure-copy.ts` and its colocated test.
