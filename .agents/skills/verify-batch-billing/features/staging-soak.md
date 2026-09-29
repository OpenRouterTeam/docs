# Staging soak (ECO-3192, producer load path ECO-4062)

**Status**: Drivable once the ECO-4062 Terraform is applied and the one-time staging rows below exist. Publishing synthetic chunks straight to `usage-record-batch-billing-staging` proves only the consumer half. This procedure drives the producer half (finalize reading results from GCS, chunking, incremental publish) at 50k / 100k / 200k rows through `staging-batch-api` with zero provider spend.

The consumer runs in staging as the `batch-billing` pipeline of `.github/workflows/deploy-dataflow-staging.yaml` and settles real chunks for long enough to expose what the emulator cannot: lock waits and aborts under concurrent deliveries of one job, republish and dead-letter volume against a real Pub/Sub, `LOCK_SCANNED_RANGES=exclusive` behaviour (the emulator ignores it), and settlement lag at production message sizes.

The staging shape is fixed by the deploy script and Terraform: job `usage-record-staging-batch-billing`, `c3-highcpu-4`, 1 min / 1 initial / 2 max workers; source topic `usage-record-batch-billing-staging` (7-day retention, `infra/queue.tf`) with an ephemeral per-run subscription; dead-letter topic `usage-record-batch-billing-dlq-staging`; transaction tag `lane:batch-billing`.

## How the fake provider reaches staging

`services/fake-provider` speaks the OpenAI Batch wire shape (`POST /v1/files`, `POST /v1/batches`, `GET /v1/batches/:id`, `GET /v1/files/:id/content`) behind a bearer check against its `FAKE_PROVIDER_API_KEY` secret. `staging-batch-api` reaches it the same way local Tilt does: the OpenAI adapter with an overridden base URL.

The shared `fake-provider` Cloud Run service scales to ten instances, and `FakeBatchStore` (`services/fake-provider/batch/fake-batch-store.ts`) is process-local, so a batch whose upload, create, poll, and download requests land on different instances gets `404`s or colliding IDs. `services/fake-provider/infra/cloudrun.tf` therefore declares a second service, `fake-provider-batch-staging`, pinned to `min = max = 1` instance with 2Gi memory, on the same image, service account, and secret. `staging-batch-api` targets only that service. The `fake-provider` build (`PROD-deploy` and the `Deploy Cloud Run Service` workflow) updates both services from one image. A revision rollout or instance restart of `fake-provider-batch-staging` still drops in-flight fake batches; treat a finalize `404` from the fake after a deploy as that, not as an adapter bug, and resubmit.

- `services/batch-api/src/adapters/optional-api-key-providers.ts` registers `ProviderName.FakeProvider` -> `OpenAIBatchAdapter` from `FAKE_PROVIDER_API_KEY` / `FAKE_PROVIDER_BASE_URL`. The entry is optional, so prod (which sets neither) never registers it.
- `services/batch-api/infra/staging.tf` injects `FAKE_PROVIDER_API_KEY` from GSM `BATCH_API_FAKE_PROVIDER_API_KEY` (already present in Secret Manager) and `FAKE_PROVIDER_BASE_URL` from `data.google_cloud_run_v2_service.fake_provider_batch_staging.uri`.
- The fake compares the bearer against its own `FAKE_PROVIDER_API_KEY` GSM secret. `BATCH_API_FAKE_PROVIDER_API_KEY` must hold the same value. A mismatch shows up as `401` on `POST /v1/files` in the staging finalize/submit logs, never as a Terraform error.

## One-time setup (authorized operator, not done by the ECO-4062 session)

Every step here changes shared infrastructure or the prod-shared Postgres / LiveConfig namespace. Run them deliberately, confirm each, and record who ran it and when in the run summary.

1. **Create `fake-provider-batch-staging`.** The release train (`release.yaml`: `build-fake-provider` -> `apply-terraform-fake-provider` -> `deploy-fake-provider`) creates it on the first release after the ECO-4062 merge. To run ahead of that, dispatch `Apply Cloud Run Terraform` (`service-name: fake-provider`) and then `Deploy Cloud Run Service` (`fake-provider`), in that order: the deploy runs `gcloud run services update` on `fake-provider-batch-staging`, which fails until the apply has created it. The plan must show one new resource, `google_cloud_run_v2_service.fake_provider["fake-provider-batch-staging"]`, plus the `moved` block renaming the existing service to `google_cloud_run_v2_service.fake_provider["fake-provider"]` in state, and no change to that service.
2. **Apply the batch-api Terraform.** Dispatch `Apply Cloud Run Terraform` (`service-name: batch-api`; staging lives in the same state) and confirm it goes green. The plan must show only the two new `env` entries on `google_cloud_run_v2_service.staging-batch-api` and the new `data.google_cloud_run_v2_service.fake_provider_batch_staging` read. The CI plan SA already reads the `auth` Cloud Run service with the same data source, so no new IAM grant is expected; a `403` on the plan means that assumption failed and needs a `roles/run.viewer` grant before retrying.
3. **Roll a staging revision.** `version = "latest"` secret refs bind at revision creation, so dispatch `deploy-staging-batch-api.yaml` (`STAGING-deploy`) from `main` after the apply. Confirm the new revision boots without `batch_api.fake_provider.provider_disabled` in its startup logs. That warning means the secret arrived blank.
4. **Stage a FakeProvider `:batch` endpoint row.** Staging reads the prod Postgres, so this is a prod row and must be `is_private: true`. Mirror the row the local e2e writes in `tests/e2e/api/batches/stage-fake-provider-batch-endpoint.ts`: `provider_name = 'FakeProvider'`, `variant = 'batch'`, `is_private = true`, `hidden = false`, `provider_overrides = {"adapterName":"OpenAIBatchAdapter"}`, and a `pricing_versions` row at any non-zero price with `openai:`-prefixed keys. Do not add a `pricingStrategy` key: `openai` is not a `PricingStrategyName`, so `initEndpointFromDb` drops the endpoint (`Invalid pricing strategy: openai`) and submit answers `does not have a :batch endpoint`; the endpoint inherits `openai_chat_completions` from the FakeProvider row. Any chat-capable model permaslug works, because the fake's `result-generator.ts` echoes whatever `body.model` the line carries. Use the Buddy skill (`.agents/skills/buddy/SKILL.md`) for the write rather than raw SQL, and note the endpoint ID and model slug in the run summary.
5. **Grant private access to the staging entity.** Insert the `private_endpoint_access` row for `org_staging_batch_test` on that endpoint (same shape as `grantBatchEndpointAccess` in the e2e helpers). Without it submit rejects the model as unavailable: the resolver logs `model_variant_found = true` with no visible endpoint (`services/batch-api/src/routing/batch-model-resolution.ts`).
6. **Raise the request-count cap for the staging entity only.** Open Live Config at `https://internal.openrouter.ai/admin-utils/live-config?key=batch_limits`. The KV namespace is shared with prod, so change only `entity_overrides` and add exactly one key:

   ```json
   {
     "entity_overrides": {
       "org_staging_batch_test": {
         "max_request_count": 200000,
         "max_in_flight_request_count": 400000,
         "max_row_attempts_per_minute": 200000
       }
     }
   }
   ```

   Leave every top-level default and every other override untouched. `resolveBatchLimits` (`packages/batch/limits.ts`) applies the override by exact billable entity ID, so no other entity's limits move. The edit posts to `#changelog-live-config`; link that message in the run summary. The in-flight and per-minute row caps are pinned too because the live `batch_limits` base values can sit below the compiled defaults in `limits.ts`, and a 200k submit must clear both caps on its own (`checkInFlightBatchRequestAdmission` in `services/batch-api/src/submit/accept/batch-admission.ts` rejects with `429` otherwise).
7. **Route the staging entity to incremental billing.** In the same Live Config UI, key `batch_billing_mode`, add one `incremental_targets` entry for `billable_entity_id = "org_staging_batch_test"` and the canonical model slug from step 4. Accept persists the mode per job, so jobs submitted before this edit stay `legacy`.
8. **Start the consumer.** Dispatch `deploy-dataflow-staging.yaml` with `pipeline: batch-billing` and a `staging_tag` (for example `eco4062`). The run creates the ephemeral subscription on `usage-record-batch-billing-staging`.

## Drive: submit 50k / 100k / 200k

From `services/batch-api`, with `gcloud` authenticated as a member of `engineering@openrouter.ai` (holds `roles/run.invoker` on `staging-batch-api`):

```bash
STAGING_URL=$(gcloud run services describe staging-batch-api --region us-central1 --project openrouter-core --format 'value(status.url)')
IDENTITY=$(gcloud auth print-identity-token)
INTERNAL=$(bun run staging:token)   # signs org_staging_batch_test with the staging-only key
MODEL=<model slug from setup step 4>
# Longest a single size may take from submit to settled before the run is treated as stuck.
# A parked finalize or a dead-lettered billing chunk never reaches a terminal status on its own.
SOAK_DEADLINE_SECONDS=${SOAK_DEADLINE_SECONDS:-7200}

for ROWS in 50000 100000 200000; do
  # One JSON envelope, the same shape submitBatch() sends in tests/e2e/api/batches/helpers.ts.
  # consumeBatchRequestStream reads endpoint/model/provider first and then streams `requests`.
  bun -e '
    const rows = Number(process.argv[1]); const model = process.argv[2];
    const requests = Array.from({ length: rows }, (_, i) => ({
      custom_id: `soak-${rows}-${i}${i % 100 === 0 ? "-fail" : ""}`,
      body: { model, messages: [{ role: "user", content: `row ${i}` }], max_tokens: 8 },
    }));
    process.stdout.write(JSON.stringify({
      endpoint: "/v1/chat/completions", model, provider: { only: ["fake-provider"] }, requests,
    }));
  ' "$ROWS" "$MODEL" > "/tmp/soak-$ROWS.json"

  curl -sS --fail-with-body -X POST "$STAGING_URL/api/v1/batches" \
    -H "Authorization: Bearer $IDENTITY" \
    -H "x-openrouter-internal-auth: $INTERNAL" \
    -H "Content-Type: application/json" \
    --data-binary "@/tmp/soak-$ROWS.json" | tee "/tmp/soak-$ROWS.submit.json"
  # A rejected submit has no `.id`; stop rather than polling an empty ID.
  BATCH_ID=$(jq -er '.id' "/tmp/soak-$ROWS.submit.json") || { echo "submit failed for $ROWS rows" >&2; break; }
  date -u +%FT%TZ > "/tmp/soak-$ROWS.submitted-at"
  DEADLINE=$(( $(date +%s) + SOAK_DEADLINE_SECONDS ))

  # Wait for this job to reach a terminal status before submitting the next size,
  # so finalize and Dataflow numbers attribute to exactly one job. A 4xx is a permanent
  # read failure and ends the run; a 5xx or network error is retried until the deadline.
  # Both credentials are re-minted per poll: signInternalAuthToken gives INTERNAL a 15-minute
  # lifetime (INTERNAL_AUTH_TOKEN_TTL_MS) and the gcloud identity token is short-lived too, both shorter than the deadline.
  while :; do
    IDENTITY=$(gcloud auth print-identity-token)
    INTERNAL=$(bun run staging:token)
    CODE=$(curl -sS -o "/tmp/soak-$ROWS.status.json" -w '%{http_code}' "$STAGING_URL/api/v1/batches/$BATCH_ID" \
      -H "Authorization: Bearer $IDENTITY" -H "x-openrouter-internal-auth: $INTERNAL" || echo 000)
    case "$CODE" in
      2*) jq -e '.status | IN("completed", "failed", "expired", "cancelled")' "/tmp/soak-$ROWS.status.json" >/dev/null && break ;;
      4*) echo "status read for $BATCH_ID returned $CODE; see /tmp/soak-$ROWS.status.json" >&2; exit 1 ;;
    esac
    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
      echo "$BATCH_ID not terminal after ${SOAK_DEADLINE_SECONDS}s; inspect the finalize DLQ (dlq-replay.md) before rerunning" >&2; exit 1
    fi
    sleep 30
  done
  date -u +%FT%TZ > "/tmp/soak-$ROWS.terminal-at"

  # Then wait for the consumer. try_complete_batch_job flips pending_charges.settled to true only
  # once settled_generation_count reaches the job's expected_settlement_generation_count, so this
  # row is the job-scoped settlement signal (same query tests/e2e/api/batches/helpers.ts readPendingCharge uses).
  # The by-id index is keyed (job_id_hash, job_id), so the predicate names both (SKILL.md, Spanner point lookups name the hash column).
  # The same deadline applies: a chunk in usage-record-batch-billing-dlq-staging never settles this row.
  until gcloud spanner databases execute-sql usage-staging \
      --instance usage-record-staging --project openrouter-core --format json \
      --sql "SELECT settled, settled_generation_count FROM pending_charges WHERE job_id_hash = SUBSTR(SHA256('$BATCH_ID'), 1, 4) AND job_id = '$BATCH_ID'" \
      | tee "/tmp/soak-$ROWS.settlement.json" | jq -e '.rows[0][0] == true' >/dev/null; do
    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
      echo "$BATCH_ID not settled after ${SOAK_DEADLINE_SECONDS}s; check the billing DLQ (dlq-replay.md) and the Dataflow job before rerunning" >&2; exit 1
    fi
    sleep 30
  done
  date -u +%FT%TZ > "/tmp/soak-$ROWS.settled-at"
done
```

Every 100th `custom_id` carries the fake's `fail` marker (`FAIL_MARKER` in `services/fake-provider/batch/result-generator.ts`), so each job settles as 99% succeeded / 1% failed rows and exercises the mixed-outcome billing path. The fake emits one output line per input request, so the length of `requests` is the row count finalize has to chunk and bill.

Lifecycle knobs: the `x-fake-batch-*` headers (`services/fake-provider/batch/batch-config.ts`) are read by the fake on `POST /v1/batches`, which in this path is the request `staging-batch-api` makes, not the one you make. The adapter does not forward client headers, so from staging the levers are the fake service's env defaults (`FAKE_PROVIDER_BATCH_POLLS_BEFORE_COMPLETE`, `FAKE_PROVIDER_BATCH_TERMINAL_STATUS`, `FAKE_PROVIDER_BATCH_COUNTS_MISMATCH` on the `fake-provider-batch-staging` Cloud Run service, set in its Terraform, since a revision change also resets the store) and the per-line `custom_id` markers above. Leave the fake's defaults (instant completion) for the throughput measurement; set `FAKE_PROVIDER_BATCH_POLLS_BEFORE_COMPLETE` on `fake-provider-batch-staging` only for a separate long-poll sweep run, before submitting. Both header and env paths are covered by `services/fake-provider/batch/batch-config.test.ts`.

The loop submits the three sizes sequentially and lets each settle before the next, so finalize and Dataflow numbers attribute to one job. `terminal-at` minus `submitted-at` is the API-side wall time, `settled-at` minus `terminal-at` is the consumer lag for that job alone.

## Record

For each job, capture these lines and put the raw values in the run summary. Every number below is read from the named source, not estimated.

- **Finalize duration and chunk count**: Datadog logs (`https://us5.datadoghq.com/logs`) filtered `service:staging-batch-api @job_id:<id>`. `batch_api.finalize.billing_chunks_published` carries `chunk_count` and `expected_settlement_generation_count`; `batch_api.finalize.completed` carries `total`, `succeeded`, `failed`, `served_requests`. Finalize duration is the wall time between the finalize push delivery log for the job and `batch_api.finalize.completed`. Expected chunk count at the staging limits (`BATCH_BILLING_CHUNK_MAX_ROWS=300`, `BATCH_BILLING_CHUNK_MAX_BYTES=8000000`): `ceil(rows / 300)`, so 167 / 334 / 667 unless the byte cap binds first.
- **Cloud Run memory**: Cloud Monitoring `run.googleapis.com/container/memory/utilizations` for `staging-batch-api` across the finalize window (the service runs at `2Gi`). Record the peak. Read the ECO-3659 runtime gauges in the same log stream (`services/batch-api/README.md`, Memory-Growth Attribution Runbook) when the peak approaches the limit.
- **Publish time**: wall time between the first and last `pubsub.publish` for the job's chunks, or the `billing_chunks_published` timestamp minus the `finalize.completed` predecessor when only log timestamps are available. Say which.
- **End-to-end settle time**: `batch_billing.settlement_lag_seconds` p99 for the run window, plus the wall time from submit response to the last `batch_billing.chunks.committed` increment for the job.
- **Consumer health**: `batch_billing.chunks.committed` reaches the published `chunk_count` per job, `batch_billing.chunks.noop` rises only on deliberate redeliveries, `batch_billing.dead_lettered` stays at zero (there are no `reject-*` fixtures in this path), `spanner.batch_update.non_ok_status{call_site:batch_release}` is zero, and the Dataflow job stays `Running` with no worker restarts.
- **Spanner**: `SPANNER_SYS.TXN_STATS_TOP_MINUTE` filtered by `lane:batch-billing` shows aborts only where concurrent deliveries of one job overlap.

Read the settled state back with the same queries the emulator suite uses (`pending_charges`, `generation_shards`, `budget_usage`) and compare row totals against `expected_settlement_generation_count`.

## Cleanup

Drain the Dataflow job. Leave the `batch_limits` and `batch_billing_mode` overrides in place only if the next soak is scheduled; otherwise remove the `org_staging_batch_test` entries and link the `#changelog-live-config` post. The endpoint row and access grant are inert for other entities (private) and can stay.

## Known unknowns

- Whether the finalize instance at `2Gi` / `cpu=1` completes a 200k-row job inside the `900s` Cloud Run timeout. If it does not, the first measurement is the row count at which it fails, and raising `local.batch_staging.memory` or `timeout` is a separate Terraform change.
- Whether 2Gi holds a 200k-row fake batch. `FakeBatchStore` keeps the input file and the eagerly generated output file in memory for the process lifetime, so watch that service's `container/memory/utilizations` during the 200k run and raise the limit in `services/fake-provider/infra/cloudrun.tf` if it approaches 100%.
- `fake-provider-batch-staging` is reachable from the public internet with the same shared bearer key as `fake-provider` (`staging-batch-api` has no VPC egress, so `INGRESS_TRAFFIC_INTERNAL_ONLY` is not an option without a connector, and the OpenAI adapter's `Authorization` header cannot carry a Cloud Run IAM token). Anyone holding the key can fill its memory with uploads until Cloud Run restarts it, which drops in-flight staging batches but touches nothing in prod. If that trade-off is not acceptable, the follow-ups are a VPC connector on `staging-batch-api` plus internal ingress on `fake-provider-batch-staging`, or `max_instance_count = 0` on it between soak runs.
- Whether the staging `batch-billing` lane writes the job's `pending_charges` row to `usage-record-staging` / `usage-staging`. `services/batch-api/README.md` documents that the staging `generations` lane writes there and inserts placeholder `async_jobs` rows, so the settlement wait above targets that database. If the row never appears while `batch_billing.chunks.committed` climbs, read the settled state from the database the lane's `--spanner-instance` argument names instead.
- The acceptance threshold for settlement lag and abort rate; the soak owner writes it here after the first full run.
