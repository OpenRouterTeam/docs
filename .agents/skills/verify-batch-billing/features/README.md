# Batch Billing Verification Features

This directory contains detailed documentation for each feature verified by the batch-billing skill. Each feature is a self-contained test suite that exercises one layer of the billing architecture.

## Built features (v1)

These are fully implemented and verifiable on this branch (ECO-3188).

- **[Contract parity](contract-parity.md)**: Fixture-driven assertion that both TS and Python decoders accept/reject the same message categories. Proof: both suites print the same `accepted=… rejected=… total=…` line and agree on every fixture's issue code.

- **[Settlement transaction](settlement-transaction.md)**: Emulator proof that a 100-row chunk commits all rows, dedupes by `generation_id`, caps hold release, and marks charge `settled=false`. Proof: `tests/integration/test_batch_billing_integration.py` on the local Spanner emulator.

- **[Retry and DLQ routing](retry-and-dlq-routing.md)**: TestPipeline proof that transient failures (attempts 1–2) republish with only `attempt_number` incremented, and permanent failures dead-letter. Proof: `tests/test_batch_billing_stream.py` on `TestPipeline`.

- **[Lane-extraction parity](lane-extraction-parity.md)**: SQL snapshot test validates that refactored `select_unseen_generations` / `insert_unseen_generations` produce identical statements to pre-refactor `write_generation_batch`. Proof: snapshot comparison in `test_generation_writer_sql_snapshot.py`.

- **[Deploy wiring](deploy-wiring.md)**: TypeScript and Python deploy-script tests confirm that the `batch_billing` lane option produces the right gcloud job arguments and `PipelineType.BATCH_BILLING_STREAM` enum is wired to all entry points. Proof: `scripts/dataflow-deploy.test.ts` asserts the generated `gcloud` argument list.

- **[DLQ replay (ECO-3706)](dlq-replay.md)**: Operator tool that inspects selected finalize dead-letter records and replays them through the generation-fenced journal, dry run first. Proof: the `runFinalizeDlq live replay` cases in `services/batch-api/src/finalize-dlq`.

## Planned expansions (stubs)

These are placeholders for future layers (ECO-3186 through ECO-3706) that will integrate with this consumer. Each stub names the expected evidence and what to look for when the layer is built.

- **[Producer (ECO-3186)](producer.md)**: Producer gate in `services/batch-api` publishes verified chunks from the sync endpoint.

- **[Job completion (ECO-3189)](job-completion.md)**: `try_complete_batch_job` seam closes jobs after all chunks are settled.

- **[Staging soak (ECO-3192, ECO-4062)](staging-soak.md)**: Consumer deployed to staging and soaked with 50k / 100k / 200k-row fake-provider batches submitted through `staging-batch-api`.

- **[Datadog auditability (ECO-3193)](datadog-auditability.md)**: Metrics are emitted and queryable on the Datadog dashboard.

## How to read this

1. Start with the main skill: [SKILL.md](../SKILL.md) § "Drive" section.
2. For each feature, run the command in the skill's "Drive" section.
3. Cross-reference the detailed feature documentation here for gotchas and what to look for in output.
4. When a test fails, check the "Gotchas" section of that feature's file for known issues.
