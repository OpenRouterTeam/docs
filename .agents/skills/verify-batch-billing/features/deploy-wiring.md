# Deploy wiring

TypeScript and Python deploy-script tests confirm that the `batch_billing` lane option produces the right gcloud job arguments and `PipelineType.BATCH_BILLING_STREAM` enum is wired to all entry points.

## Sub-features

1. **Pipeline type enum**: `PipelineType.BATCH_BILLING_STREAM` is defined and recognized by the deploy machinery.
2. **gcloud argument generation**: The `batch_billing` choice produces correct `--job-name`, `--worker-machine-type`, `--num-workers`, and other flags.
3. **Worker sizing**: Initial workers for staging vs production are correct (2 on staging per the PR).
4. **Environment wiring**: `PIPELINE_NAME_ENV` and other env vars are set correctly for the consumer.
5. **Topic/subscription resolution**: The billing topic and DLQ subscription names are correctly looked up from Terraform outputs or env vars.

## How to get to it (user POV)

The operator runs the deploy script with `--pipeline=batch_billing` to launch the consumer pipeline. This test verifies that the CLI is wired correctly without actually launching a Dataflow job.

## Driving it with the harness

```bash
cd services/usage-record
bun test ./scripts/dataflow-deploy.test.ts
cd dataflow && uv run pytest tests/test_env_config.py -q
```

This is SKILL.md Drive step 6: the TypeScript deploy-script tests plus the Python env-wiring tests (`PipelineType.BATCH_BILLING_STREAM`, topic and subscription resolution per environment).

### Expected output

- Exit code: 0
- Every test passes; the count changes as the deploy script grows, so do not pin it

### Key test assertions

The test file (`scripts/dataflow-deploy.test.ts`) includes:

1. **Pipeline selection logic**: - `--pipeline=batch_billing` produces a gcloud command with the batch-billing pipeline type - The correct `--job-name` (e.g., `batch-billing-stream-staging`) - Correct worker options for the selected lane

2. **Worker sizing**: - Staging: 1 min / 1 initial / 2 max workers - Production: 2 min / 2 initial / 64 max workers (`streamingWorkerOptions` in `scripts/dataflow-deploy.ts`)

3. **Topic wiring**: - Billing topic is resolved from Terraform or env var - Dead-letter subscription is correctly named

## Gotchas

- **Dry-run only**: The test does not actually launch a Dataflow job. It captures the gcloud command that would be executed and asserts its structure. To launch the consumer, run the script with `--dry-run=false`.

- **Worker machine type**: The machine type for the worker depends on the lane and environment. The test asserts that a recognized type is chosen. If worker sizing is changed, update the test expectations.

- **Environment-specific secrets**: Topic names and Terraform outputs may differ between staging and production. The test mocks these dependencies. A real deploy reads them from GCP.

- **Enum synchronization**: If a new pipeline type is added, both `PipelineType` (Python) and the CLI choice list (TypeScript) must be updated. The test catches a missing enum member only if a test explicitly checks for it.
