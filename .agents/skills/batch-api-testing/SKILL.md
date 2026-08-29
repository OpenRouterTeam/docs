---
name: batch-api-testing
description: >-
  Write and audit tests for the Batch API — colocated bun:test unit tests in
  packages/batch and services/batch-api, the vitest e2e happy path in
  tests/e2e/api/batches against the local Tilt batch stack + fake provider,
  and the test-quality audit pass. Sub-skill of batch-api-development.
user-invocable: true
---

# Batch API Testing

Owns Phase 7 (verification + tests) and Phase 8 (audit tests) of
[`batch-api-development`](../batch-api-development/SKILL.md). Invoke
[`unit-test-writing`](../unit-test-writing/SKILL.md) before writing any
unit test.

## Test surfaces

| Surface                          | Framework  | Location                                          |
| -------------------------------- | ---------- | ------------------------------------------------- |
| Contracts, adapters, skins       | `bun:test` | colocated `*.test.ts` in `packages/batch`         |
| Submit/read/finalize/sweep units | `bun:test` | colocated `*.test.ts` in `services/batch-api/src` |
| Edge auth/forwarding             | `bun:test` | colocated in `services/cfw-batch-api/src`         |
| Cross-service happy path         | vitest e2e | `tests/e2e/api/batches/`                          |

## Unit tests

- Colocate next to the module. Use `assertOk`/`assertErr` for Results; no
  `any`, no mock-based DB tests.
- Drive skin/adapter tests from **committed fixtures**
  (see [`batch-sync-fixtures`](../batch-sync-fixtures/SKILL.md)) via the
  loader pattern in `packages/batch/test-fixtures/` — not
  hand-rolled minimal inline objects.
- Promote sanitized native rows captured during live verification into the
  adapter fixtures and pin normalization plus usage parsing against them.
  Synthetic rows are reserved for failures that cannot be captured safely or
  deterministically, and must be labeled as synthetic.
- Parity tests are the batch specialty: assert field-by-field that a
  rendered batch result line matches the sync-response shape, pinned to a
  golden vector (job ID, custom_id, startedAt, billed generation ID). See
  `packages/batch/skins/chat-completions/sync-parity.test.ts` and the
  `*.golden.test.ts` files under `packages/batch/adapters/openai/`.
- Fixture-shape guards: a small test that Zod-validates each committed
  JSONL fixture line keeps fixtures honest — see
  `services/batch-api/src/openai-batch-smoke-fixture.test.ts`.

Run: `bun test packages/batch services/batch-api services/cfw-batch-api`.

## E2E happy path

`tests/e2e/api/batches/index.test.ts` (ECO-1965,
[#28269](https://github.com/OpenRouterTeam/openrouter-web/pull/28269)) is
the template: submit (202 `validating`) → drive the async submit stage
(`runSubmitStage` — pull the `batch-submit` emulator message and replay it as
the `POST /submit-job` push; production push-delivers this automatically) →
poll → finalize → results + charge settle, driven
through the local stack against the deterministic fake OpenAI batch
upstream (`services/fake-provider`).

Requirements and conventions:

- Stack: `tilt up cfw-batch-api dataflow-async-jobs` (ingress on `:8800`,
  gcp-batch-api on `:8686`, Pub/Sub emulator `:8086`, Spanner emulator
  `:9020`, fake-gcs `:4443`). Validate readiness per
  [`tilt-testing`](../tilt-testing/SKILL.md). The BYOK e2e additionally
  needs the auth service (`tilt trigger valkey && tilt trigger auth`) —
  finalize resolves the key owner through it — plus
  `PROVIDER_ENCRYPTION_KEY` in the env (from
  `services/cfw-api/.dev.vars`) to seed the encrypted provider key. The
  seeded BYOK key is sent upstream verbatim, so it must equal the fake
  provider's `FAKE_PROVIDER_API_KEY` or the async submit stage 401s.
- Stale local state fails admission: the 200k in-flight cap counts
  `pending` rows from prior runs (clear `async_jobs` in the Spanner
  emulator) and the per-minute row rate limit lives in local redis
  (`docker exec dev-redis-1 redis-cli flushall`).
- Probe the stack at collection time and `describe.skipIf` with a `[WARN]`
  naming the unreachable services — the suite must stay green in
  environments that only boot cfw-api (`findUnavailableBatchServices` in
  `tests/e2e/api/batches/helpers.ts`).
- Keep helpers in `helpers.ts`; parse every external payload with a Zod
  schema; poll with a bounded `pollUntil` returning `Result`, never bare
  retry loops.
- Written for humans: flat steps with numbered comments, no nested
  branching.
- Log evidence with `sendToFSLog` and introspect via dev-fs-logs
  (`bun run dev dev-fs-logs`, files under `services/dev-fs-logs/.logs/`);
  sample the written files to confirm behavior matches.
- Expensive or provider-flaky scenarios go to `tests/manual/` with a
  date-prefixed dir, not the CI e2e suite.
- Run batch e2e files **one at a time** (`bun run test:e2e --run
  api/batches/<file>.test.ts`); a whole-directory run lets parallel files
  steal each other's finalize Pub/Sub messages and fail falsely.

Re-run the relevant tests after **every** push that changes behavior, not
just at PR creation ([`e2e-testing`](../e2e-testing/SKILL.md)).

For a new provider, the fake upstream comes from the
[`fake-batch-provider`](../fake-batch-provider/SKILL.md) phase — land it
early so the e2e suite covers the new provider from the adapter PR onward,
including forced failure/expiry/cancel paths via the `x-fake-batch-*`
header overrides.

The provider E2E matrix must cover malformed input/output, wrong schemas,
missing or negative usage, unsupported parameters/modalities, credential
misconfiguration, empty/paginated results, unordered ids, policy blocks,
unknown block reasons, and mixed success/failure rows. Mixed jobs bill only
successful rows; failed rows emit zero usage and zero cost.

## Intent-test traceability (new-provider stacks)

Every nuance the research note (`docs/batch-research/<provider>.md`)
records must name the test that pins it. Add a traceability table to the
note (or the tests PR body) mapping requirement → test file, covering at
least:

- request-line serialization (incl. sync-transform overrides)
- upload/create payloads
- exhaustive status mapping
- polling/backoff behavior
- result and error-file parsing
- mixed partial success
- `custom_id`/ordering preservation
- cancellation and expiry
- paginated/multi-file downloads
- idempotent finalize/re-delivery
- provider-specific limits

A row with no test is a gap to fix before hand-off, or an explicitly
justified exception recorded in the manifest.

## Live-provider verification (new-provider stacks)

Deterministic fakes don't prove the real integration. Before hand-off,
run one minimal live pass against the actual provider:

1. Pull scoped provider credentials from Infisical (never hardcode).
2. Submit a minimal live batch through the local stack.
3. Poll through every observable mapped state; force cancel on a second
   job where cheap.
4. Download results/errors and Zod-validate them against the committed
   schemas.
5. Verify the stored job status and charge settlement, and capture
   dev-fs-logs evidence.
6. Record cost, date, and artifact locations in the manifest and the top
   PR body.

Provider-proof checks:

- Read the downloaded artifact bytes and inspect response content; terminal
  status and healthy counts do not prove that the payload is valid.
- Decode the provider's native error envelope before falling back to generic
  status wording, so provider explanations survive result parsing.
- Confirm provider behavior used by a fixture against the live API and pin
  the accepted wire shape in the fixture rather than inferring it from
  documentation.
- When a fake injects per-line failures from line content, use neutral labels
  for terminal-state override tests so the heuristic cannot make the test pass
  accidentally.
- In local end-to-end runs, hand-deliver any submit message and scheduler tick
  when local plumbing does not provide them; record those hops explicitly and
  do not wait for an undriven queue to advance.
- Freeze the source tree before a multi-run proof, run the fake provider
  outside the watched tree, and correlate request logs to verify one poll per
  candidate per scheduler tick with no adapter retry loop.

For a scoped model rollout, repeat the minimal live pass for every model in
the documented/active/requested allowlist intersection. Do not infer batch
support from sync availability.

Keep the live scenario in `tests/manual/` with a date-prefixed dir — not
CI. If credentials or provider access are unavailable, record that as an
explicit exception rather than skipping silently.

## Auditing the tests (Phase 8)

After tests exist, audit them before hand-off:

1. Run the repo [`test-audit`](../test-audit/SKILL.md) skill scoped
   (`--repo <path>`) to the batch files the stack touched — drift, logic
   errors, slow tests, inline-snapshot opportunities, coverage gaps.
2. Batch-specific checks on top:
   - [ ] Golden vectors are real captured values with provenance noted in
         a comment (date + source run), not invented constants
   - [ ] Parity tests assert field-by-field, not `toEqual` on the whole
         object (whole-object equality hides which contract field broke)
   - [ ] No test reaches into another layer's internals (e.g. e2e asserting
         on `services/batch-api` private modules)
   - [ ] Skip guards fail loud: skipped suites `console.warn` the reason at
         collection time
   - [ ] Every fixture file is referenced by at least one test
   - [ ] The intent-test traceability table has no unowned rows
3. Record findings in the audit report (`/tmp/batch-test-audit-<pr>.md`)
   and fix them in the lowest owning PR before requesting review.

## Related skills

- [`batch-api-development`](../batch-api-development/SKILL.md)
- [`fake-batch-provider`](../fake-batch-provider/SKILL.md)
- [`batch-sync-fixtures`](../batch-sync-fixtures/SKILL.md)
- [`unit-test-writing`](../unit-test-writing/SKILL.md)
- [`test-audit`](../test-audit/SKILL.md)
- [`tilt-testing`](../tilt-testing/SKILL.md)
- [`e2e-testing`](../e2e-testing/SKILL.md)
