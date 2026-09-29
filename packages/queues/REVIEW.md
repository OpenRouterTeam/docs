# Queues Review Guidelines

## New queue payloads must be CloudEvents v1 envelopes

Flag any new or changed schema in `signals/` that is published to a queue or
Pub/Sub topic and is not built from `CloudEventEnvelopeV1Schema`
(`signals/cloud-events.ts`). A bare `z.object({...})` with a `version`
field, a hand-rolled `specversion`, or domain fields placed beside `data`
is a rejection, not a nit. See `AGENTS.md` in this directory for the
required shape.

Check on every queue schema PR:

- `type`, `source`, and `subject` are `z.literal(...)` over exported
  constants, following the reverse-DNS `type` and URN `source` conventions
  already used by `alert-event.ts` and `billing-entity-usage.ts`.
- The domain payload is a separate `<Name>DataSchema` passed as `data`.
- The export is versioned (`<Name>EnvelopeV1Schema`) and a breaking `data`
  change ships as a new `type` plus a `V2` export rather than editing `V1`.
- The colocated test rejects a wrong `specversion`, `type`, `source`,
  `subject`, and `datacontenttype`, not only invalid `data`.
- The consumer task parses the envelope with the schema before reading
  `data`. A task that `JSON.parse`s and reads fields directly has skipped
  the boundary.

The exemptions are the customer-facing delivery bodies
(`webhook-payload.ts`, `notice-webhook-payload.ts`) and the dispatch table
over them (`webhook-payload-registry.ts`), none of which are queue
messages. `alert-event-class.ts` defines a Pub/Sub message attribute, not a
payload. Every other schema in `signals/` that is published to a queue
already uses the envelope, so there are no pending migration targets.

## `time` is publication time, not a domain timestamp

Flag any producer that sets the envelope `time` from a row column such as
`created_at`. `time` is the instant the producer built the envelope, so a
delayed or reconciled publish carries a fresh `time` while `data` carries the
row's own timestamps. The producer takes the publication instant as a
parameter (`publishedAt: Date`) so a test can pin it.

_Source: [PR #42602 review](https://github.com/OpenRouterTeam/openrouter-web/pull/42602#discussion_r4001451999)._

_Source: [PR #41529 review](https://github.com/OpenRouterTeam/openrouter-web/pull/41529#discussion_r3994999172)._
