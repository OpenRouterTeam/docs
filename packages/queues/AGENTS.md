# Queues agent guidance

## Queue message schemas are CloudEvents v1

Every payload that crosses a queue or Pub/Sub topic is a
[CloudEvents 1.0](https://cloudevents.io/) envelope built from
`CloudEventEnvelopeV1Schema` in `signals/cloud-events.ts`, the same shape
the alerts pipeline and the billing usage signal already use.

- Define the domain payload as its own `<Name>DataSchema` and pass it as
  `data`. Never add domain fields to the top level of the envelope.
- Pin `type`, `source`, and `subject` with `z.literal(...)` from exported
  constants, so a consumer can reject a message published to the wrong
  topic. Follow the existing naming: `type` is reverse-DNS
  (`ai.openrouter.<domain>.<event>`), `source` is a URN
  (`urn:openrouter:<producer>`), `subject` names the stream.
- Version the envelope in the export name (`<Name>EnvelopeV1Schema`). A
  breaking change to `data` is a new `type` and a new `V2` export, with the
  old schema kept until every consumer has moved.
- `time` is `Rfc3339UtcTimestampSchema`, publication time in UTC with a `Z`
  suffix. Set it from the clock when the envelope is built, never from a row
  timestamp such as `created_at`, which belongs in `data`. `id` is the
  unique message ID for deduplication.
- Register the schema in `signals/`, one file per signal, with a colocated
  test that round-trips a valid envelope and rejects a wrong `specversion`,
  `type`, `source`, `subject`, and `datacontenttype`.
- Application-level contracts (the function a consumer calls after parsing)
  stay separate from the transport envelope. The envelope owns transport
  attributes, the contract owns semantics.

Customer-facing payloads (`signals/webhook-payload.ts`,
`signals/notice-webhook-payload.ts`) and their dispatch table
(`signals/webhook-payload-registry.ts`) are delivery bodies, not queue
messages, and keep their own versioned shape.
