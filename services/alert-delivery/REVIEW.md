# Alert delivery review checklist

- Is the customer-controlled endpoint URL validated on the initial URL with
  resolved-host pinning, with redirects terminal on this path and per-hop
  revalidation retained for other guard consumers? The fixed-host first-party
  Resend email transport is the exception: it does not use attacker-chosen
  destinations, while webhook and Slack destinations retain guard and pinning.
- Are private destination ranges denied by the VPC firewall?
- Are signing secrets stored only as `EncryptedSecret` envelopes?
- Does a failed response preserve bounded, cancelled response-body handling?
- Does Pub/Sub receive a non-2xx response when retry should occur?
- Are breaker transitions and outcome logs keyed by endpoint ID?
- Are durable delivery outcomes written idempotently to
  `alert_event_delivery` (one row per event × endpoint × channel, with
  delivered rows skipped on redelivery)?
