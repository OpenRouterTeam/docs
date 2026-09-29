# Google BigQuery Broadcast Destination

OpenRouter can stream observability traces into a BigQuery table using the
BigQuery `tabledata.insertAll` REST endpoint. Each trace becomes exactly one
row, so the table can be queried directly without grouping or deduplicating by
`trace_id`.

## 1. Create or choose a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project or select an existing project.
3. Copy the project ID, not the project name. It is the lowercase identifier
   shown in **IAM & Admin → Settings**.

The project ID must be 6–30 characters, start with a letter, and contain only
lowercase letters, numbers, and hyphens.

## 2. Enable the BigQuery API

In the selected project, open **APIs & Services → Library**, search for
**BigQuery API**, and click **Enable**.

## 3. Create the dataset

1. Open **BigQuery → Explorer**.
2. Select the project, click the project menu, and choose **Create dataset**.
3. Choose a dataset ID, such as `openrouter`.
4. Choose the dataset location carefully. A dataset's region cannot be changed
   after creation. Choose a location allowed by your organization's data
   residency policy and use the same location for related BigQuery resources.
5. Create the dataset.

## 4. Create the trace table

The table layout is generated from the shared broadcast pipeline schema, so it
is not duplicated here. Print the exact DDL with:

```bash
bun -e "import {BIGQUERY_TABLE_DDL} from './packages/broadcast/destinations/bigquery/metadata';console.log(BIGQUERY_TABLE_DDL)"
```

The same statement is shown in the destination's **View Setup Instructions**
panel in the OpenRouter dashboard. Replace `my-gcp-project` with your project
ID, and the dataset or table IDs if you chose different ones, then run it in the
BigQuery SQL workspace.

The `JSON` columns receive JSON-encoded strings, which BigQuery parses into JSON
values. The `tags` column receives an array of strings. The table schema must
match these types exactly.

## 5. Create a service account

1. Open **IAM & Admin → Service Accounts** in the selected project.
2. Click **Create service account**.
3. Give it a name such as `openrouter-broadcast`.
4. Grant it the **BigQuery Data Editor** role on the trace dataset, not at the
   organization or project level:
   - Open the dataset's menu in BigQuery.
   - Choose **Share → Permissions**.
   - Add the service account email.
   - Select **BigQuery Data Editor**.
5. Do not grant BigQuery Job User. This destination uses a table metadata
   request and streaming inserts; it does not create query jobs.
6. Open the service account's **Keys** tab, choose **Add key → Create new key**,
   select **JSON**, and download the key.

Keep the downloaded key private. It contains a private signing key and should
not be committed to source control or pasted into chat.

## 6. Configure the OpenRouter destination

In the workspace observability settings, add **Google BigQuery** and enter:

- **Google Cloud project ID**: the project ID containing the dataset.
- **BigQuery dataset**: the dataset ID created above, normally `openrouter`.
- **BigQuery table**: the table ID created above, normally
  `openrouter_traces`.
- **Service-account key JSON**: the complete contents of the downloaded JSON
  key file, pasted as a single-line value. Whitespace inside the JSON is
  insignificant, and the destination parser handles the pasted value.

Click **Test connection**. The connection test reads the table's metadata to
verify the project, dataset, table, and credentials, then asks BigQuery whether
those credentials hold the row-insert permission. Read-only access therefore
fails the test rather than passing it and failing on every later trace. Neither
request runs a query job.

Then click **Send test trace**. The destination uses `insertAll` and supplies a
stable insertion ID derived from the trace and span IDs, so retries can be
deduplicated on a best-effort basis.

## 7. Confirm rows landed

Run this query in the BigQuery SQL workspace:

```sql
SELECT
  trace_id,
  span_id,
  timestamp,
  model,
  status,
  total_tokens,
  total_cost
FROM `my-gcp-project.openrouter.openrouter_traces`
ORDER BY timestamp DESC
LIMIT 20;
```

Replace `my-gcp-project` and the dataset/table IDs if you chose different
values. The test trace should appear as a single row.

A trace also contains child observations for the moderation, provider-attempt
and generation phases, but those are not sent: they carry no model, tokens,
costs, input or output, and what they do carry is already on the trace's row.
One row is emitted per generation, and OpenRouter builds exactly one generation
per trace, so that is one row per trace.
Per-attempt detail is in `metadata.provider_responses`, and the phase timings
are the `openrouter_*` fields of `attributes`. So `span_id` equals `trace_id`
for a trace OpenRouter generated, and `parent_span_id` is populated only when
the request supplied a parent span ID from the caller's own tracing system.

The `attributes`, `input`, `output`, `metadata`, `model_parameters`, and
`resource_attributes` columns are sent as JSON-encoded strings, because
`insertAll` populates a `JSON` column from a string rather than from a nested
object. BigQuery parses each string back into a real JSON value, so those
columns still report their `JSON_TYPE` and are queryable with `JSON_VALUE`. The
`tags` column is the exception: it is a repeated `STRING` column, which takes a
real array.

## Common failures

- **Project not found or permission denied**: confirm that the configured
  project ID is the project containing the dataset and that the service account
  belongs to the expected project.
- **Table not found**: confirm the dataset and table IDs and that the table was
  created in the configured dataset location.
- **403 permission denied**: grant the service account **BigQuery Data Editor**
  on the dataset. Project-level access may be restricted by organization
  policy, so verify the dataset permission directly.
- **400 invalid or schema mismatch**: compare the table schema with the exact
  DDL above. In particular, timestamps must be `TIMESTAMP`, nested trace fields
  must be `JSON`, and `tags` must be `ARRAY<STRING>`.
- **`This field: <column> is not a record`** in the `bigquery-row-rejected` logs:
  a `JSON` column received a nested object instead of a JSON-encoded string.
  BigQuery names only one offending column per row and picks it
  non-deterministically, so the log understates how many columns are affected.
- **No rows after a successful request**: `insertAll` can return HTTP 200 while
  rejecting individual rows, which is reported in the `bigquery-row-rejected`
  logs rather than as a destination failure. Check the table's dataset and
  region, then rerun the confirmation query without a restrictive time filter.

## Data and retry behavior

Rows are sent in batches bounded by both row count (at most 500) and serialized
size, so large prompt and completion payloads cannot push a request past
BigQuery's insert size limit. A single row larger than that limit cannot be sent
at all, so it is logged and dropped instead of failing the rest of its batch.
Every batch that loses rows, whether dropped for size, rejected by BigQuery, or
lost to a failed request, emits a `bigquery-rows-undelivered` error log with the
counts.

Whether the batch itself fails turns on one question: did any row land? A batch
is retried in full, so failing after even one row was accepted would insert that
row twice — `insertId` deduplication expires well before the queue retries. So a
batch that delivered anything succeeds, however much else it lost, and a failed
request part-way through a multi-request batch does not abort the requests that
follow it. When nothing landed there is nothing to duplicate, so the batch fails
and the loss is reported: a request-level failure is forwarded with its status
and body, and a table whose schema matches nothing becomes a destination failure
rather than a successful send. The exception is a batch whose rows were all
dropped for exceeding the request size limit, since a retry would drop them
again; that batch succeeds and the log alone carries the loss.

Each row contains the same typed columns as the Snowflake destination.
BigQuery's `insertId` provides best-effort deduplication for retries; it is not a
transactional guarantee.

When BigQuery accepts a request but rejects individual rows, usually because
they do not match the table schema, those rows are logged and skipped. Requests
set `skipInvalidRows`, so the valid rows in the same request still land instead
of being discarded along with the rejected ones. Retrying them cannot succeed, so
only transport and request-level failures are retried.

Rows rejected for a reason BigQuery documents as temporary, such as `timeout` or
`backendError`, are the exception. Those rows are resent on their own, a bounded
number of times with a short doubling delay, instead of failing the batch, so
requests that already succeeded are never sent again. Rows still rejected after
the last attempt count toward the undelivered totals.
