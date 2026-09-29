# Runbook: Batch API finalize settlement blocked

Paged by `[Batch API] Finalize settlement blocked - job stranded in_progress with live hold` (`monitoring/batch_finalize_settlement_blocked.tf`, ECO-4080) and `[Batch API] Finalize settlement-block marker write failed` (`monitoring/batch_finalize_settlement_block_record_failed.tf`, ECO-4040, one alert group per `job_id`) into `#alerts-providers`. One `batch_api.finalize.settlement_blocked` event is one stranded job; `batch_api.finalize.settlement_block_record_failed` is the same stranded job whose marker could not be written yet. Neither alert should essentially ever fire.

## What happened

Finalize runs in this order for an incremental-billing job: it journals a billing proof bound to the `output/results` object at a specific GCS generation, publishes the billing chunks to the `usage-record-batch-billing` lane, then materializes and serves the customer artifact. A permanent failure that strikes after the proof is journaled cannot be retried (the proof is frozen) and cannot be resolved with a legacy `failed` publish (Dataflow may already be settling chunks for the same job, and a legacy terminal event on a lane-owned job is dropped, see `batch_billing_lane_legacy_terminal_dropped.tf`). Finalize therefore records a durable settlement block, acknowledges the delivery so the sweep stops republishing it, and logs the event once.

The job is left `in_progress` in `async_jobs`, the customer's estimated-cost hold in `pending_charges` stays live, and no results are served. Nothing else surfaces this state, so the alert is the only signal.

When the settlement-block write itself fails (`batch_api.finalize.settlement_block_record_failed`), the job is in the same state but no marker exists yet: the finalize attempt returns a permanent error instead of acking and `batch_api.finalize_one.finalize_failed` follows. Pub/Sub redelivers the same generation (60s-600s backoff, 8 deliveries), and once the released journal has been idle for `FINALIZE_DISPATCH_STALE_MS` (75 minutes) the sweep opens the next generation; every delivery retries the marker write. The event repeats per delivery until the write lands or `FINALIZE_MAX_ATTEMPTS` generations dead-letter the job: the sweep publishes its record to `batch-finalize-dead-letter-records` and closes the journal (`services/batch-api/src/finalize/finalize-dispatch.ts`, `services/batch-api/src/sweep/sweep.ts`). The raw envelopes Pub/Sub forwards to `batch-finalize-dlq` after each generation's 8 deliveries are not that signal; the sweep still reopens the job. The marker-write monitor's 4h window exceeds the 75-minute gap, so one job's group stays in alert across the whole lifecycle instead of paging once per generation. A dead-lettered job still needs the same recovery below; replaying it through the `Replay Batch Finalize DLQ` workflow (`.github/workflows/replay-batch-finalize-dlq.yaml`) only retries the marker write. That workflow's default `dry_run` mode with the job in `job_ids` is how to confirm the record exists: it reads `batch-finalize-dead-letter-records` with production credentials and touches nothing. Its `fix_reference` and `replay_reason` inputs are required in both modes (the audit contract in `services/batch-api/src/finalize-dlq/finalize-dlq-request.ts`); for the inventory dry run, enter the alert (monitor name or URL) and `dry-run inventory for settlement-block recovery`. That manifest cannot authorize a live replay: live mode accepts only the `dry_run_proof` of a dry run over the same selection whose `fix_reference` and `replay_reason` equal the live request's exactly (`requireDryRunProof` in `services/batch-api/src/finalize-dlq/finalize-dlq-run.ts`, a 412 on any difference), and the proof also expires if the subscription's contents change. Once the fix is deployed, run a second dry run with the live values (the fix PR or release as `fix_reference`, the justification as `replay_reason`), copy its `dry_run_proof` into the live dispatch, and reuse those two values unchanged. By contrast the script it wraps (`services/batch-api/scripts/finalize-dlq-replay.ts`) needs the subscription and GCS/Spanner settings supplied by hand.

## 1. Read the event

Open the alert's log link or query `service:batch-api* @data.jsonPayload.extra.job_id:<JOB_ID> ("batch_api.finalize.settlement_blocked" OR "batch_api.finalize.settlement_block_record_failed")` in Datadog (us5) and read from `@data.jsonPayload.extra`:

- `job_id`: the stranded job.
- `reason`: the `error_location` of the permanent failure, stable across retries (for example `batchGcsStore.writeBatchOutput.pipeline` or `finalizeBatchJob.billingProofInvalid`). It names the finalize step that failed, and therefore what the artifact state is likely to be.
- `results_generation`: the GCS object generation of `output/results` that the billing proof and every published chunk were bound to.
- `expected_settlement_generation_count`: how many generations the lane must settle before it closes the job on its own.
- `blocked_at` and the `error_*` fields for the underlying error message and code. On `settlement_block_record_failed` there is no `blocked_at`, and the `error_*` fields describe the failed marker write (typically GCS), not the permanent failure; `reason` still names the permanent failure.

If only `settlement_block_record_failed` events exist for the job, the finalize journal usually has no `settlement_blocked` marker yet, but not always: GCS can commit the object and still return an error, and when the verifying read-back in `writeJournal` (`services/batch-api/src/storage/gcs-journal-store.ts`) also fails the store reports the write as failed, so `blockSettlement` logs only `settlement_block_record_failed` and the next delivery finds the marker, logs `settlement_blocked_redelivery`, and acks. No `settlement_blocked` event is ever logged for that job. Read the job's `finalize_journal` object under the artifact prefix: the marker, not the event, is what says the block is recorded, and its fields carry everything the steps below read from the event. The job is stuck either way, and the steps below apply unchanged.

`batch_api.finalize.settlement_blocked_redelivery` is left out of the query on purpose: it carries only `reason` and `blocked_at` copied from the marker, so it adds no field to read, and each occurrence only confirms that a redelivery found the marker and skipped finalization. Include it (as the per-job query in `.agents/skills/debug-batch-api/SKILL.md` does) when you want the delivery timeline, not for this step.

Resolve the billable entity and artifact prefix for the job as in `.agents/skills/debug-batch-api/SKILL.md` (Artifact layout). Artifacts live at `gs://customer-data-batch-api-prod/<billable_entity_id>/<job_id>/`.

## 2. Check whether `output/results` still exists at the journaled generation

```bash
gcloud storage objects describe "gs://customer-data-batch-api-prod/<billable_entity_id>/<job_id>/output/results" --format="value(generation,size)"
gcloud storage ls -a "gs://customer-data-batch-api-prod/<billable_entity_id>/<job_id>/output/results"
```

- Generation equals `results_generation`: the proof-bound artifact is intact. The permanent failure hit a later step (serving metadata, status write). Skip to step 4 and close the job with the artifact as-is.
- Object missing, or only a newer generation is listed: the results object was deleted or rewritten after the proof was journaled. The chunks the lane settled still reference `results_generation`, so the billing side is consistent, but the customer-facing artifact is gone. Go to step 3.

Bucket objects expire 30 days after creation (`services/batch-api/infra/bucket.tf`), so act before the raw artifacts age out.

## 3. Restore `output/results` from `output/raw_response` when possible

`output/raw_response` is the provider's raw output file as downloaded, and `output/results` is the transformed customer-facing JSONL derived from it. If `output/raw_response` still exists, regenerate `output/results` by re-running the finalize materialization for the job (the transform is deterministic for a fixed provider output and accept-time job fields) and write it back to the same object path. A restored object gets a new GCS generation. That is expected: the proof binds billing to `results_generation` for the settled chunks, and serving reads the current object, so do not attempt to reproduce the old generation number.

Do not hand-edit the JSONL, and do not upload a different provider file. If `output/raw_response` is also gone, the artifact cannot be restored and the job has to close as failed in step 4.

Once the object is restored, confirm it is readable through the normal read path for the customer before closing.

## 4. Manual close path

The lane owns the job's hold while `pending_charges.settled_generation_count` is non-NULL and `settled` is false. Never write `async_jobs.status` by hand: that removes the job from the sweep but leaves the hold outstanding, and a job closed behind the lane makes the lane refuse its unseen chunks.

1. Confirm no in-flight Dataflow chunks remain for the job. Read the settlement counters (by-id indexes are keyed on the hash column, so always pair the ID with its hash):

    ```sql
    SELECT pc.settled_generation_count, pc.settled, pc.released_estimated_cost, pc.estimated_cost,
           aj.status, aj.expected_settlement_generation_count
    FROM pending_charges pc
    JOIN async_jobs aj ON aj.job_id = pc.job_id
    WHERE pc.job_id_hash = SUBSTR(SHA256('<job_id>'), 1, 4) AND pc.job_id = '<job_id>';
    ```

    Also check `usage-record-batch-billing-dlq` for messages carrying this `job_id` (`bun run dataflow:dlq-replay` dry run with `--job-id`). A dead-lettered chunk for the job is an in-flight chunk: replay it first (see the DLQ replay runbook in `monitoring/batch_billing_incremental_lane.tf`) and wait for `settled_generation_count` to stop moving.

2. If `settled_generation_count` equals `expected_settlement_generation_count`, the lane will close the job itself on the reconcile message and release the remaining hold. Wait for `settled = true` and `async_jobs.status` to turn terminal, then only the artifact (step 3) is outstanding.

3. If the counters have stopped short of `expected_settlement_generation_count` and the DLQ is empty for the job, the missing chunks were never published (the failure hit between proof journal and publish). Ask the Batch API owner to emit the terminal outcome on the async-job path for this job: `completed` when `output/results` is intact or restored, `failed` when it is not. That path settles `pending_charges`, releases the remaining estimated-cost hold, and writes the terminal status in one transaction. There is no public cancel route and no direct Spanner shortcut that keeps the hold consistent.

4. Verify: `pending_charges.settled = true`, `released_estimated_cost` accounts for the full hold, `async_jobs.status` terminal, and the customer can read results (or sees the failed status). Recovery of the monitor alone does not mean the job was resolved: the settlement-blocked alert recovers one hour after the last event and the marker-write alert four hours after it, regardless.

## References

- `services/batch-api/src/finalize/finalize-settlement-block.ts`: the block record and its fields.
- `services/batch-api/src/finalize/finalize-batch-job.ts`: `blockSettlement` and the event.
- `services/usage-record/dataflow/src/openrouter_monorepo/usage_record/batch_completion.py`: how the lane closes a job and releases the hold.
- `.agents/skills/debug-batch-api/SKILL.md`: artifact layout, Spanner lookups, hold semantics.
- `services/usage-record/README.md`, "Replaying the batch billing DLQ".
