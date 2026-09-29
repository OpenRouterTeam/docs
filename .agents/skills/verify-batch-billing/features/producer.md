# Producer (ECO-3186)

**Status**: Stub (planned expansion, not in v1)

Producer gate in `services/batch-api` publishes verified billing chunks to the Pub/Sub topic for jobs whose persisted `async_jobs.batch_billing_mode` is `incremental`. The mode is chosen once at accept from the `batch_billing_mode` LiveConfig key (`incremental_targets` matched on exact `billable_entity_id` plus canonical model slug, everything else legacy).

## Expected evidence (to be added when ECO-3186 lands)

- Real batch submitted via the sync endpoint with entity enabled for incremental billing
- Chunks are published to `PUBSUB_BATCH_BILLING_TOPIC`
- Published messages match the contract (TS schema from `types/batch-billing-chunks.ts` validates them)
- `attempt_number` in message starts at 1
- Message is idempotent: re-publishing the same chunk to the consumer settles it only once (dedupe by `generation_id`)

## How to verify (draft)

1. Publish a `batch_billing_mode` LiveConfig value whose `incremental_targets` names the test entity and model (schema in `packages/batch/billing-mode.ts`), then create the batch. Jobs created before the change stay on their persisted mode
2. Submit a batch via the sync endpoint
3. Monitor the billing topic via `gcloud pubsub subscriptions pull` or the emulator dashboard
4. Verify a chunk message appears with `message_type="billing_chunk"`
5. Send it to the consumer and verify settlement

## Known unknowns

- How are chunks created from request chunks? (one chunk per request chunk, or per-shard aggregation?)
- Does the producer run inline (sync) or in a background job?
