# cfw-webhooks — Agent Guidelines

See the root [AGENTS.md](../../AGENTS.md) for repo-wide rules.

## No Production Route Points At This Worker

The worker is deployed, but production webhook traffic is still served by the
Next.js Pages API routes in `projects/web/pages/api/webhooks/*` on Vercel.
Routes are managed manually in the Cloudflare dashboard (not in
`wrangler.toml`), so wrangler config is not evidence either way — the traffic
evidence below is.

Delete this file once a dashboard route points here; cutting traffic over is a
deliberate migration ([OPE-5703](https://linear.app/openrouter/issue/OPE-5703)),
not a config tweak.

### How to re-check (verified 2026-07-27, 7-day window)

Requests, with a routed worker as the control:

```
sum:cloudflare.workers.requests.all{worker_script:webhooks}.as_count()  # ~1-4/hour
sum:cloudflare.workers.requests.all{worker_script:api}.as_count()       # ~3e7/hour
```

Logs, by script rather than by service:

```
@script_name:webhooks                        # the worker's logs
@script_name:webhooks @url:*openrouter.ai*   # zero hits — no traffic on the prod hostname
```

**`cfw-webhooks` is not a value Datadog knows.** It is this directory and the
CI `service-name`; the Cloudflare script name is `webhooks` (`wrangler.toml`
`name`, and `release.yaml` maps `service-name: cfw-webhooks` →
`cloudflare-dashboard-name: webhooks`). Both `worker_script:cfw-webhooks` and
`@script_name:cfw-webhooks` return empty for every worker in every window —
that emptiness is the wrong name, not an absence of traffic.

The tail consumer and telemetry pipeline hardcode `service: 'api'` for every
worker and carry the origin in `script_name`
(`services/cfw-instrumentation/src/tail-direct.ts`,
`packages/queues/tasks/telemetry-pipeline.ts`); only the OTel path tags
`service:cfw-webhooks`. **A `service:cfw-webhooks` search returning nothing is
therefore not evidence of anything** — including of broken log wiring.

Every request in that window arrived on `webhooks.openrouter.workers.dev`, none
on `openrouter.ai`. Every sampled one was a `500` from `envMiddleware`
("Env error", missing `SEQUENCE_WEBHOOK_SECRET`), so the worker would currently
fail every request if a route were pointed at it
([OPE-5713](https://linear.app/openrouter/issue/OPE-5713)).

### Consequences for agents

- **Instrumentation added only here produces no production signal** — the
  handful of requests it sees are `*.workers.dev` probes. Add it to the
  `projects/web` route if you need prod visibility.
- Both hosts call the same shared handlers in `packages/webhook-handlers` (e.g.
  `handleClerkEvent`), so a handler-level change affects production even though
  this worker does not.
- The hosts are **not** byte-for-byte equivalent, so do not treat one as a
  behavioral proxy for the other.
