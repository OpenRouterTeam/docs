# Useful Spanner queries

Local emulator: `http://localhost:9020`, database `projects/openrouter-dev/instances/dev/databases/usage`. Bind parameters as `STRING`. Use the internal `gen-*` ID; the first query returns the billing entity for the remaining queries.

## Generation

```sql
SELECT generation_id, billable_entity_id, model,
       tokens_prompt, tokens_completion, usage
FROM generations
WHERE generation_id = @generation_id;
```

## Usage rollups

```sql
SELECT billable_entity_id, started_at_shard_id,
       shard_total_usage, appended_at
FROM generation_shards
WHERE billable_entity_id = @billable_entity_id
ORDER BY appended_at DESC
LIMIT 3;
```

Rollups are cumulative; compare before and after the test request.

## Budgets

```sql
SELECT started_at_shard_id, budget_entity_type, budget_entity_id,
       reset_interval, usage_type, usage_total, updated_at
FROM budget_usage
WHERE billable_entity_id = @billable_entity_id
ORDER BY updated_at DESC
LIMIT 5;
```

Multiple rows are expected across shards, budget entities, reset intervals, and usage types. These limits show recent activity, not complete entity totals.

For automated checks, [the existing emulator helper](../../../../tests/e2e/utils/spanner-emulator.ts) handles REST sessions and polls generations by a unique request `Referer`.
