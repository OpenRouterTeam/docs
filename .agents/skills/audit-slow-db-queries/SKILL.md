---
name: audit-slow-db-queries
description: >-
  Weekly audit for slow PostgreSQL queries using Datadog DBM metrics, query
  samples, and explain plans. Produces evidence-backed optimization
  recommendations for openrouter-web.
user-invocable: true
---

# Audit Slow Database Queries

Use this skill for weekly slow-query audits in `openrouter-web`. The output is
an evidence-backed report, not a list of speculative index ideas.

## Required access

- `DD_API_KEY`
- `DD_APP_KEY` — must be an unscoped application key. Scoped keys lack the
  `built_in_features` scope and are rejected with `Forbidden` by the DBM logs
  analytics endpoint.
- Datadog site: `us5.datadoghq.com`
- DBM logs analytics access for `databasequery`

If DBM logs analytics returns `Forbidden`, continue with scalar DBM metrics and
record the permission gap. Do not claim a concrete SQL or index fix without a
query sample, an explain plan, or a safe reproduction case.

## Inputs

Set these variables before collecting data:

```bash
export DD_SITE="us5.datadoghq.com"
export DB_INSTANCE="primary"
export NOW_S="$(date -u +%s)"
export CURRENT_WINDOW_MS="$((7 * 24 * 60 * 60 * 1000))"
export TO_MS="${NOW_S}000"
export FROM_MS="$((NOW_S * 1000 - CURRENT_WINDOW_MS))"
export PRIOR_TO_MS="${FROM_MS}"
export PRIOR_FROM_MS="$((PRIOR_TO_MS - CURRENT_WINDOW_MS))"
```

For comparisons, use a prior window with the same duration as the current
window. Use `${PRIOR_FROM_MS}` and `${PRIOR_TO_MS}` for the comparison
`request.json`.

## Data sources

### Query metrics

Use the Datadog scalar metrics API as the primary source:

```bash
curl -sS -X POST \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" \
  -H "Content-Type: application/json" \
  "https://api.${DD_SITE}/api/v2/query/scalar" \
  -d @request.json
```

Use `api.${DD_SITE}` for Datadog's public API endpoints. The samples
and plans below use `app.${DD_SITE}` because Datadog exposes the DBM
logs analytics endpoint on the app host.

Build `request.json` with:

Replace the placeholder `0` values for `from` and `to` with `${FROM_MS}` and
`${TO_MS}` before posting the request. Template `${DB_INSTANCE}` before posting
as well; the example below should not be submitted with the literal placeholder.

```json
{
  "data": {
    "type": "scalar_request",
    "attributes": {
      "from": 0,
      "to": 0,
      "formulas": [
        {
          "formula": "query1",
          "limit": {
            "count": 100,
            "order": "desc"
          }
        }
      ],
      "queries": [
        {
          "name": "query1",
          "data_source": "metrics",
          "query": "sum:postgresql.queries.time{database_instance:${DB_INSTANCE}} by {query_signature,database_instance}",
          "aggregator": "sum"
        }
      ]
    }
  }
}
```

After ranking by `postgresql.queries.time`, pin the audited signature list.
Collect comparison windows and secondary metrics for that same list, not a fresh
top-100 per metric. If a multi-signature `IN` or `OR` tag filter is not
available, issue one scalar request per pinned signature with:

```text
database_instance:${DB_INSTANCE},query_signature:<signature>
```

Collect pinned-signature values for these metrics:

- `postgresql.queries.time`
- `postgresql.queries.count`
- `postgresql.queries.rows`
- `postgresql.queries.errors`

Aggregate by `query_signature` and `database_instance`. Preserve the raw JSON
outside the repo unless it is sanitized and useful for review.

For each top signature, rerun the same scalar queries with richer grouping when
DBM samples are unavailable:

```text
by {query_signature,database_instance,db,query,table}
```

The `query` and `table` tags often contain normalized SQL and involved tables.
Treat this as lower-fidelity than DBM samples because it still lacks parameters,
plans, row estimates, and buffer behavior.

### APM span ranking

When the audit is route-scoped rather than instance-scoped, rank by database time
inside requests instead of by `query_signature`. DB spans are
`service:postgres operation_name:postgresql.query` and carry the query function
in both `resource_name` and `@db.query_id`, so aggregate `@duration` by
`@db.query_id` through `POST /api/v2/spans/events/search` or the spans aggregate
endpoint.

Two properties of that API cost time if unknown: paginate on
`meta.page.after`, and treat a `null` `meta` on a response as the end of the
results rather than an error. Retained spans are sampled, and their timestamps
are millisecond resolution, so they cannot order sub-millisecond siblings and
can omit one entirely — confirm any serialization or N+1 shape in the source
before treating it as real.

### Query samples

Use DBM logs analytics to recover normalized SQL text:

```bash
curl -sS -X POST \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" \
  -H "Content-Type: application/json" \
  "https://app.${DD_SITE}/api/v1/logs-analytics/list?type=databasequery" \
  -d @samples-request.json
```

Build `samples-request.json` with:

```json
{
  "list": {
    "indexes": ["databasequery"],
    "limit": 25,
    "search": {
      "query": "dbm_type:activity @db.query_signature:<signature> @db.instance:${DB_INSTANCE}"
    },
    "sorts": [
      {
        "time": {
          "order": "desc"
        }
      }
    ],
    "time": {
      "from": 0,
      "to": 0
    }
  }
}
```

Replace `<signature>` with the target query signature. Replace the `0` values
for `from` and `to` with `${FROM_MS}` and `${TO_MS}`. Template
`${DB_INSTANCE}` before posting as well so samples stay scoped to the audited
database instance.

Record:

- normalized SQL statement
- query signature
- database instance
- wait event and wait event type
- rows returned or affected
- service, host, and database tags when present

### Explain plans

Fetch plans with the same logs analytics endpoint. The search query must
include:

```text
dbm_type:plan @db.query_signature:<signature> @db.instance:${DB_INSTANCE}
```

Use the same `samples-request.json` shape with `dbm_type:plan` in
`list.search.query`, preserving the `@db.instance:${DB_INSTANCE}` filter.

Record:

- plan definition
- plan signature
- plan cost
- relevant scan, join, sort, aggregate, and buffer behavior

If Datadog does not provide a plan, create a safe reproduction plan instead.
Use read-only production access only when explicitly available. Otherwise, use a
local seeded database or a staging replica and document data-size differences.

## Prioritization

Prioritize queries that combine user or infrastructure impact with a plausible
fix path:

1. Total database time dominates the selected window.
1. Mean latency is high enough to affect request latency.
1. Call count is high enough that small improvements compound.
1. Rows examined or returned are disproportionate to the expected result size.
1. The query is growing versus a comparable prior window.
1. Errors, waits, locks, or contention indicate operational risk.
1. Plans show fixable work such as broad scans, expensive joins, sorts,
   repeated lookups, stale index usage, or missing selective access paths.

Do not prioritize one-off expensive work unless it is recurring, user-visible,
or operationally risky.

## Fixability criteria

Classify a query as fixable only when at least one criterion is proven:

- The SQL shape is inefficient and can be narrowed or rewritten.
- An index is missing, stale for current data distribution, or no longer
  selective enough as the table has grown.
- The plan shows avoidable scans, joins, sorts, or repeated lookup patterns.
- Datadog metrics show high sustained impact and an explain/reproduction case
  identifies the bottleneck.

Classify as not actionable when the evidence only shows a signature hash and
aggregate timing. In that case, request DBM sample or plan access.

## Recommendation format

Each recommendation must include:

- query signature and database instance
- normalized SQL, if available
- Datadog metric window and links
- total time, call count, mean time, rows, and growth signal
- explain plan or reproduction evidence
- specific proposed change
- expected impact
- validation plan
- rollback plan
- confidence level and remaining uncertainty

Index recommendations must identify:

- table
- columns and order
- partial predicate, if any
- why existing indexes do not satisfy the access pattern
- migration requirements

Database migrations in this repo must be idempotent. Use
`CREATE INDEX CONCURRENTLY IF NOT EXISTS` for non-trivial index builds and avoid
non-idempotent DDL.

If a concurrent index build fails, Postgres can leave an `INVALID` index under
the target name and `IF NOT EXISTS` will skip it on retry. Verify invalid
indexes with:

```sql
SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE NOT indisvalid;
```

Drop the failed index with `DROP INDEX CONCURRENTLY <name>;` before rerunning the
migration.

## Weekly process

1. Collect query metrics for the current weekly window.
1. Collect matching metrics for the prior comparable window.
1. Rank query signatures by total database time.
1. Enrich top signatures with DBM samples and explain plans.
1. Search the repo for matching SQL or Kysely query shapes.
1. Re-check `origin/main` and recently merged PRs for the candidate immediately
   before shipping, not only at the start — a parallel audit run can land the
   same fix while this one is proving it locally.
1. Separate candidates into actionable, needs-more-evidence, and no-action.
1. Write the report to a local file (do not commit it to the repo).
1. Share the report with the user as a file attachment via `message_user`.

## Delivering results

Do **not** commit reports, findings, or audit documents to the repository.
Do **not** open PRs containing audit reports.

Instead, deliver all audit output directly to the user:

- Use `message_user` with the report file in the `attachments` parameter.
- If `message_user` is unavailable, output the full report as the final
  session response.
- Summarize actionable findings in the message body.
- Include the full report as an attached markdown file.

If the audit identifies code changes (e.g., new indexes, query rewrites),
those changes may be committed and submitted as a PR separately from the
report itself.

## Report template

```markdown
# Slow Database Query Audit

## Scope

- Window:
- Database instance:
- Data sources:

## Summary

- Actionable recommendations:
- Needs more evidence:
- No action:

## Recommendations

### <query signature>

- Evidence:
- Plan or reproduction:
- Proposed fix:
- Validation:
- Rollback:
- Confidence:

## Permission gaps

## Raw metric appendix
```
