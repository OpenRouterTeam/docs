# Batch API infrastructure review notes

## Submit DLQ recovery

The submit journal is the generation-CAS idempotency fence. Replaying a
dead-lettered submit message is safe because the fence permits at most one
provider create across deliveries. A live `processing` or `submitting` lease
returns 503; after its 65-minute lease expires, redelivery either reclaims
pre-submit processing or records a terminal internal error for an uncertain
provider outcome. No operator state mutation is required for beta.

## Ambiguous provider outcomes

For a platform-funded job estimated at $1 or less, the fenced worker makes one
immediate retry when the provider create response is ambiguous. OpenRouter
accepts the possible duplicate upstream cost. Expensive and BYOK jobs are not
retried. Any remaining ambiguity becomes `failed` with a generic internal-error
message while detailed context remains in logs and the durable journal.

## Acceptance-time policy snapshot

`SubmitJobAuthContextSchema` carries the policy fields used by worker
preflights, including `attestedTypes`, `batchBans`, and moderation settings.
These values intentionally reflect durable acceptance time; the worker does
not refetch policy during delayed delivery.
