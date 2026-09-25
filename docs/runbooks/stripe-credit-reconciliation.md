# Stripe credit reconciliation

Use this runbook when the Stripe credit reconciliation monitor pages or
recovers. The cron compares succeeded Stripe credit purchases with payment
credits in the credits table.

## What the pages mean

- **Aged page:** at least one PaymentIntent was emitted as an aged missing
  charge. Its Stripe event is more than 70 minutes old and still has no
  matching payment credit.
- **Batch page:** more than 20 distinct PaymentIntents were seen missing
  matching payment credits during the past hour. This is a scale signal, not
  a concurrent count of currently missing charges. The one-hour window can
  retain an ID after its last missing-charge log.

The cron waits 15 minutes before evaluating an event. It emits ordinary and
aged missing-charge logs with the `payment_intent_id`, `age_seconds`, and
credits-reconciliation context needed for this check.

## Verify the credits

Pull the distinct `payment_intent_id` values from the ordinary and aged
missing-charge logs. Run the read-only query in the [Cloud SQL Studio read
replica](https://console.cloud.google.com/sql/instances/pg-us-east4/studio?project=openrouter-core):

```sql
WITH flagged(payment_intent_id) AS (
  VALUES
    ('pi_xxx'),
    ('pi_yyy')
)
SELECT f.payment_intent_id,
       count(c.id) FILTER (WHERE c.type = 'payment') AS payment_credits,
       min(c.created_at) FILTER (WHERE c.type = 'payment') AS credited_at
FROM flagged f
LEFT JOIN credits c ON c.stripe_payment_intent_id = f.payment_intent_id
GROUP BY f.payment_intent_id;
```

Interpret the result per PaymentIntent:

- `payment_credits = 0` means no matching payment credit was found.
- `payment_credits > 0` means a payment credit exists. Confirm the credit
  belongs to the expected purchase before closing the page.
- `credited_at` is the earliest matching payment credit timestamp.

After checking the credits rows, inspect Stripe webhook delivery and Postgres
connection-acquisition health. Stripe can retry live-mode webhooks for up to
three days. A manual resend is not the default first action.

## Recovery and lookback limitation

A monitor recovery does not prove that credits landed. The one-hour batch
window can delay recovery by up to one hour after the last missing-charge log.
Separately, the cron only walks a 12-hour lookback. An uncredited charge older
than 12 hours can fall out of reconciliation reporting. Verify the credits
rows before closing the incident.
