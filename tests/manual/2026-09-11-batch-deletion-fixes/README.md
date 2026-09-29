# Batch deletion fixes — validation

This stack fixes the cleanup gaps found during the September 11 production dogfood. The modified implementation was tested locally and selected cleanup helpers were exercised directly against live provider APIs. The stack has not been deployed to production.

## Coverage

| Path | Verification |
| --- | --- |
| Mistral | Captured `deleted:false` receipt followed by exact file absence, counterexamples for retained/inaccessible files, native batch deletion and repeat-delete receipts, and a complete real-adapter lifecycle through the HTTP fake. Fresh live input-file deletion and repeat cleanup passed. |
| xAI | Real adapter upload, submit, poll, file deletion and repeat cleanup through the HTTP fake. Fresh live uploaded-file deletion and repeat cleanup passed. Native batch deletion remains unsupported. |
| Together | Real adapter lifecycle through the HTTP fake; uploaded input is removed and generated output deletion remains forbidden. Service coverage verifies input-only cleanup and propagates input permission failures. Fresh live input-file deletion and repeat cleanup passed. |
| Fireworks | Real adapter lifecycle through the HTTP fake, native deletion completion polling, repeat cleanup, and independent input/output dataset removal. Captured native receipts cover asynchronous deletion. Fresh live dataset deletion, confirmed absence and repeat cleanup passed. |
| Missing Vertex/Fireworks jobs | Only provider-confirmed absence enters finalization. Service regressions cover saved raw output, Vertex output recovery, no output, storage failures, stable billing IDs on replay, stale leases and failed-job result reads. The public Vertex E2E removes the native job before finalization, verifies recovered results and positive usage, then verifies local and managed output cleanup plus GET 404. |
| Cleanup orchestration | Native deletion completes before provider files are removed; a failed native cleanup preserves those handles, still purges OpenRouter artifacts, and leaves `purged_at` unset so DELETE can resume. |

The provider HTTP lifecycle tests use real adapters against deterministic fake-provider routes. They do not call the public ingress. The separate public E2E uses cfw-batch-api, the batch service, Dataflow and the Spanner/Pub/Sub/GCS emulators.

All eight distinct public scenarios passed across the focused runs: active-job rejection, completed and failed OpenAI cleanup, Anthropic cleanup, Google AI Studio cleanup, BYOK disabled-key handling with and without an interrupted deletion, and Vertex recovery before deletion. The two BYOK cases required the same encryption key as the batch service and the local auth service for finalize-time billing; the initial missing-configuration failures are not counted as passes. Vertex recovery was also repeated successfully during the BYOK rerun and the captured curl flow.

## Run

Use the normal local batch stack (`tilt up cfw-batch-api dataflow-async-jobs auth`) with current Dataflow code and seeded batch endpoints. The test runner and batch service must use the same `PROVIDER_ENCRYPTION_KEY`; BYOK finalization also requires the local auth service. Set a distinct `BATCH_E2E_SUBSCRIPTION_SUFFIX` when another local suite is running, so it cannot consume this run's Pub/Sub messages. Google AI Studio coverage uses only Gemini 2.5 Flash Lite.

```sh
(cd packages/batch && bun run test)
(cd services/batch-api && bun run test)
(cd services/fake-provider && bun run test batch)
(cd tests/e2e && BATCH_E2E_SUBSCRIPTION_SUFFIX=-deletion-fixes bun run test:e2e run api/batches/delete.test.ts api/batches/missing-native-job.test.ts --retry=0)
```

Each command starts from the repository root. Test counts and live cleanup receipts are recorded in `snapshot.json`. Sanitized terminal request/response evidence is attached to the stack PRs.

## Limits

These changes have not been verified through a deployed public API. Live BYOK, expiry and every provider terminal-state combination are not comprehensive. Together's generated output/error files remain provider-held because the observed API denies their deletion; `unsupported` does not certify their absence.

The supplemental Mistral native repeat-delete probe returned 403 with the available dev credential for an older run-owned job. This was retained as an access limitation, not treated as deletion success. All fresh files/datasets created by the supplemental cleanup checks were removed.

The original production dogfood's missing Vertex and Fireworks public jobs remain preserved for recovery after deployment. No production database, IAM or deployment changes were made to force those jobs into a successful state.
