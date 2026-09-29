# Coinbase Business Checkouts

This package contains the active Coinbase Business Checkouts integration used by the web/manual credits flow.

## Production

- Create checkouts with `POST https://business.coinbase.com/api/v1/checkouts`.
- Authenticate with a CDP JWT built from `COINBASE_BUSINESS_API_KEY_ID` and `COINBASE_BUSINESS_API_KEY_SECRET`.
- Configure Coinbase Business Checkout webhooks to target `/api/webhooks/coinbase-business`.
- Subscribe to Checkout webhook events: `checkout.payment.success`,
  `checkout.payment.failed`, and `checkout.payment.expired`.
- Verify incoming webhook signatures with the `X-Hook0-Signature` header and `COINBASE_BUSINESS_WEBHOOK_SECRET`.

`/api/webhooks/coinbase-business` is the active Coinbase Business Checkout webhook endpoint.

## Sandbox

Coinbase docs note the following sandbox differences for Checkouts:

- Sandbox endpoint: `https://business.coinbase.com/sandbox/api/v1/checkouts`
- Use the same CDP API keys as production.
- Sandbox payments are simulated and use Base Sepolia testnet.
- Sandbox webhook subscriptions must include `labels: { "sandbox": "true" }`.

## Scope Note

The legacy Coinbase Commerce integration has been removed. `/api/v1/credits/coinbase` is now a deprecated `410 Gone` endpoint, and the `/api/webhooks/coinbase` webhook route has been deleted. New Coinbase credit purchases go through the web checkout flow only.
