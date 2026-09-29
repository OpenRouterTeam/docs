# Webhook Routes — Agent Guidelines

See the root [AGENTS.md](../../../../../AGENTS.md) for repo-wide rules.

These Pages API routes are the **live** inbound webhook endpoints: Svix/Clerk,
Stripe, Coinbase Commerce and Sequence deliveries to `openrouter.ai` land here,
on Vercel.

A parallel Cloudflare Worker exists at `services/cfw-webhooks` with routes for
the same providers, but no production route points at it yet, so instrumentation
added only there yields no production signal — see
[services/cfw-webhooks/AGENTS.md](../../../../../services/cfw-webhooks/AGENTS.md).
Both hosts share the handler cores in `packages/webhook-handlers`, so change a
handler there when the fix belongs to both; keep host-specific work (raw-body
handling, signature input, response serialization) in the route.
