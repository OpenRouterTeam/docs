# credit-expiration — review guidance

Patterns to flag when reviewing changes in this package.

## Spanner batching (`fetch-spanner-data.ts`)

- This package does not chunk its own Spanner reads: the whole batch goes to
  one `getBudgetDataMultiple` call, which sizes its queries from each request's
  estimated expression cost (`MAX_ESTIMATED_BUDGET_QUERY_FUNCTIONS` in
  `services/usage-record/helpers/query-budget-data.ts`) so every statement stays
  under Spanner's 1000-function-call limit. Flag any PR that reintroduces a
  caller-side user-batch constant here — the limit belongs to the helper, which
  derives it from request shape and is covered by its own unit and emulator
  tests.
- `DEFAULT_BATCH_SIZE` bounds per-step state and DB write size, not Spanner
  query limits. Flag a PR that justifies changing it with a Spanner argument.
- A `null` total usage must be treated as zero, not skipped.

## Depth-first pipeline (`buckets.ts` + workflow runner)

- Candidates are processed in depth-first batches: each batch runs
  validate→bucket→execute before the next batch is fetched. Review changes
  that reorder this so partial failures can't leave a batch validated but not
  executed (or vice versa).

## ClickHouse vs Pg+Spanner reconciliation

- `sumDiffVsPgSpanner` compares ClickHouse-derived amounts against Postgres +
  Spanner. Treat a growing diff as a signal, not noise — it must remain a
  read-only cross-check and never gate or mutate the actual expiration path.

## Reference doc sync (`credit-expiration-workflow.md`)

- `credit-expiration-workflow.md` is the reference write-up of the workflow's
  behavior. Flag any PR that changes workflow behavior — step gating (`dryRun`),
  payload params, trigger routes, result semantics, or step ordering — without
  updating the matching doc sections **and** the Mermaid diagrams, which readers
  trust over prose.

## Live workflow

- The workflow runs live in production, not only in dry-run. Any change that inserts
  negative credits or updates purchase `expires_at` runs for real — scrutinize
  idempotency (`idempotencyKey`) and the persisted validation drop-outs.
