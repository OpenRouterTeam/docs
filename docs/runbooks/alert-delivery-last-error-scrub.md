# Scrub `alert_event_delivery.last_error` (PLA-1455)

Removes webhook/Slack destination URLs, Slack path tokens, and response bodies stored in `last_error` before PLA-1455 shipped.

Prerequisites: PLA-1455 deployed to the alert-delivery worker; authorization from the on-call owner.

## 1. Count the affected rows

```sql
SELECT channel,
       count(*) AS rows,
       min(created_at) AS oldest
FROM public.alert_event_delivery
WHERE channel IN ('webhook', 'slack')
  AND last_error IS NOT NULL
GROUP BY channel;
```

Do not `SELECT last_error` — it may contain a live Slack token.

If `rows` is 0, stop. Retention (30 days) has already purged them.

## 2. Scrub

Under 50k rows, one statement:

```sql
UPDATE public.alert_event_delivery
SET last_error = '[redacted: PLA-1455]',
    updated_at = CURRENT_TIMESTAMP
WHERE channel IN ('webhook', 'slack')
  AND last_error IS NOT NULL
  AND last_error <> '[redacted: PLA-1455]';
```

Over 50k rows, run it as a reviewed backfill (`.agents/skills/add-reviewed-backfill`) chunked by `created_at` day. Do not write a migration.

Re-running is safe.

## 3. Verify

```sql
SELECT count(*) AS remaining
FROM public.alert_event_delivery
WHERE channel IN ('webhook', 'slack')
  AND last_error IS NOT NULL
  AND last_error <> '[redacted: PLA-1455]';
```

Expect 0. `failure_reason` and `response_status` are untouched and still carry the diagnostics.

## 4. Owner decisions

- Datadog retains its own copies of the pre-fix log lines: add a scrubbing rule or wait out log retention.
- Leaked Slack webhook URLs were visible to admins of the owning account and to internal log readers: decide whether to ask affected accounts to rotate them.
