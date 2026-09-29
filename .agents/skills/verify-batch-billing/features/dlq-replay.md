# DLQ replay (ECO-3706)

**Status**: Built (finalize DLQ, not the billing-chunk DLQ)

Operators inspect selected `batch-finalize-dead-letter-records` records and replay them through the generation-fenced finalize journal. Pointed at the raw `batch-finalize-dlq` subscription instead, the tool inspects the envelopes Pub/Sub forwarded and replays none. Dry run is the default and touches nothing. Live replay needs the `dry_run_proof` block from a dry run of the identical selection, an operator fix reference and replay reason, and acknowledges the source DLQ message only after the new-generation publish succeeded.

Code: `services/batch-api/src/finalize-dlq/` (request, inventory, replay, verify, run), CLI `services/batch-api/scripts/finalize-dlq-replay.ts`, workflow `.github/workflows/replay-batch-finalize-dlq.yaml`.

## Sub-features

1. Request gate (`finalize-dlq-request.ts`): explicit selection by message id or job id, 1 to 50 ids, required `fix_reference` / `replay_reason` / `workflow_run_id`, live mode requires `dry_run_proof`.
2. Inventory (`finalize-dlq-inventory.ts`): bounded pull that counts the scan complete only after two consecutive empty pulls, base64 decode, Zod parse of the DLQ record, journal inspect, finalize row read, blockers per record.
3. Replay (`finalize-dlq-replay.ts`): `replayDeadLetter` reopens the journal (generation +1, `attempt_count` 0, `dead_lettered_at` and `completed_at` cleared), publish with `replay_*` audit attributes beside the untouched payload, then ack.
4. Verify (`finalize-dlq-verify.ts`): polls the new generation, or any later generation the sweep reclaimed from it, to `completed`, `job_not_completed`, `dead_lettered_again`, `processing`, or `unknown` at the deadline (non-zero exit on anything but `completed`). `dead_lettered_again` lands `FINALIZE_MAX_ATTEMPTS` generations past the replayed one, because the replay resets the attempt budget and the only dead-letter path is a stale claim finding it spent.

## Driving it with the harness

Unit proof (no emulator, real journal CAS over in-memory GCS):

```bash
bun test services/batch-api/src/finalize-dlq services/batch-api/src/pubsub/pubsub-subscriber.test.ts
```

Every `finalize-dlq` test file must pass; the assertion lines that count are the `runFinalizeDlq live replay` cases that end in `replayed`, `fenced`, `publish_failed` and `completed`.

Emulator proof against the local Pub/Sub emulator (`dev/docker-compose.pubsub.yaml` creates `pull-batch-finalize-dead-letter-records` for this purpose; the values below match the batch-api block in the `Tiltfile`, which also needs the fake GCS emulator up):

```bash
# from services/batch-api, with the emulators up (see SKILL.md Launch) and a dead-lettered job
export PUBSUB_EMULATOR_HOST=localhost:8086 SPANNER_EMULATOR_HOST=localhost:9010
export PUBSUB_BATCH_FINALIZE_TOPIC=projects/openrouter-dev/topics/batch-finalize
export PUBSUB_BATCH_FINALIZE_DLQ_SUBSCRIPTION=projects/openrouter-dev/subscriptions/pull-batch-finalize-dead-letter-records
export BATCH_GCS_BUCKET=batch-jobs-dev GCS_API_ENDPOINT=http://localhost:4443
export SPANNER_PROJECT_ID=openrouter-dev SPANNER_INSTANCE_ID=dev SPANNER_DATABASE_ID=usage
bun run x scripts/finalize-dlq-replay.ts \
  --job-ids <job_id> --fix-reference "<PR or SHA>" --replay-reason "<why>" \
  --workflow-run-id local-$(date +%s) --manifest "$RUN_DIR/dlq-dry-run.json"
# copy `dry_run_proof` from the manifest, then
bun run x scripts/finalize-dlq-replay.ts \
  --mode live --job-ids <job_id> --fix-reference "<PR or SHA>" --replay-reason "<why>" \
  --workflow-run-id local-$(date +%s) --dry-run-proof "$(jq -c .dry_run_proof "$RUN_DIR/dlq-dry-run.json")" \
  --manifest "$RUN_DIR/dlq-live.json"
```

### Expected output

- Dry-run manifest: `mode: dry_run`, one inventory item per selected record with `record`, `journal`, `job`, `blockers`, and a `dry_run_proof` block; a record is replayable when its `blockers` list is empty.
- Live manifest: `mode: live`, `publish_count` = `acknowledge_count`, and one entry per candidate of the shape `{ replay, verification }`, where `replay.outcome` is `replayed` with `new_finalize_generation` = previous + 1, and `verification` is null when nothing new was published. Exit code 1 with `replay did not complete every selected job` when any entry's `verification.outcome` is not `completed`.
- Emulator: `gcloud pubsub subscriptions pull` on the finalize subscription shows the replayed message with `replay_source_message_id`, `replay_workflow_run_id`, `replay_reason`, `replay_fix_reference` attributes.

## Gotchas

- A live run re-pulls the DLQ and rejects when the matched message ids differ from the proof. Re-run the dry run after any DLQ change.
- Publish failure releases the freshly claimed generation and leaves the source message unacked. The journal is then undispatched at the new generation; the sweep redispatch (ECO-3186 layer 06) picks it up, and a raw redelivery of the old DLQ record is fenced. A later dry run reports that record as `blocked:journal_reopened_awaiting_sweep`, which means wait for the sweep, not replay again.
- A record whose `async_jobs` row is already `completed`, `failed`, `cancelled` or `expired` is `blocked:job_already_terminal`; the settlement consumer has closed the job and a replay would not change it.
- Before the first replay the run renews the lease on every candidate in one `modifyAckDeadline` call, and renews the ones still queued again once half the 600s lease has elapsed, so the DLQ subscription's deadline never has to outlast the whole serial run. Sources a live run did not acknowledge (fenced, failed) are released when the replays finish, so the next run can pull them at once.
- A live run refuses to replay (412, `inspection took ...s, past half the 600s lease`) and releases every matched lease when the per-record journal and Spanner reads took more than 300s after the post-pull lease renewal, because Pub/Sub answers `modifyAckDeadline` and `acknowledge` on an expired ack id with success and the run could otherwise publish and "ack" a record that is already back in the queue; run again, and select fewer records if it keeps happening.
- A manual `gcloud pubsub subscriptions pull` without `--auto-ack` leases what it pulls for up to 600s. A dry run started inside that window reports those records as unmatched; wait the lease out before re-running.
- Replay within 30 days of the dead-letter. The finalize journal lives in the customer-data bucket under its 30-day lifecycle (`services/batch-api/infra/customer-data-bucket.tf`), while `batch-finalize-dlq` retains records for 31 days (`services/batch-api/infra/pubsub.tf`). A record whose journal has expired is still inspectable but reports the `journal_missing` blocker and cannot be replayed: without the journal there is no generation to fence on.
- There is no replay counter. The application dead-letter publisher writes a fresh record without attributes, so a counter on the replayed message could never survive a second dead-letter. Correlate repeat replays across runs by `job_id` in the manifests and the `replay_workflow_run_id` attribute.
- The billing-chunk DLQ (`batch-billing-dlq`, consumer side) is out of scope here. Its replay still follows `services/usage-record` tooling.
