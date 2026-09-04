# ClickHouse ClickPipe for `endpoint_requests`

Terraform root module for the Pub/Sub ClickPipe that ingests `endpoint_requests`
rows: one pipe, `endpoint-requests`, consuming
`insert-endpoint-requests-clickpipe` in GCP project `openrouter-core` and
writing `default.endpoint_requests_clickpipe`. The subscription is created and
owned by ClickPipes when the pipe starts and is never declared here. See the
header comment in `clickpipes.tf` for the schema-migration ordering rule.

This module has never been applied. Nothing in this repository has created a
ClickPipe, a Pub/Sub subscription, or any other cloud resource.

## Field mappings

Destination columns and field mappings are generated, never hand-edited. The
source of truth is the *migrated* schema — `system.columns` for
`default.endpoint_requests_clickpipe` on a locally migrated ClickHouse — not a
migration file, so a later `ALTER TABLE` cannot leave the Terraform stale:

```bash
cd packages/clickhouse && bun run ch:start && bun run ch:migrate && cd -
bun run x scripts/clickpipes/generate-endpoint-requests-mappings.ts
```

`bun run x` wraps the script in `infisical run`, so it needs an Infisical dev
login. Without one, point the client at the local container directly:

```bash
CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USERNAME=default \
  CLICKHOUSE_PASSWORD=clickhouse OR_ENV=test \
  bunx tsx --tsconfig ./scripts/tsconfig.json \
  scripts/clickpipes/generate-endpoint-requests-mappings.ts
```

Mapped columns keep their `DEFAULT`: the pipe writes whatever the message
carries and ClickHouse fills the column only when the JSON key is absent, so
`model_call_started_at DEFAULT started_at` and `attempt_opening_status DEFAULT
status` stay mapped. Only `inserted_at` is left out entirely, so `now64(3)`
always wins.

The checks live in
`packages/clickhouse/integration/clickpipes/endpoint-requests-mappings.test.ts`
and run in the `clickhouse-integration` job of
`.github/workflows/ci-clickhouse.yaml` (triggered by
`services/clickhouse-clickpipes/**` and `scripts/clickpipes/**` as well as by
the migrations), against the same real ClickHouse container the other
integration tests use. They fail when the committed mappings no longer match the
migrated schema, and when `endpoint_requests_clickpipe` stops being an exact
clone of `endpoint_requests`. The rows-to-mappings transform is a pure function
with a colocated unit test in
`packages/clickhouse/endpoint-requests/clickpipe-mappings.test.ts`.

## Deploying

### 1. Prerequisites

| Check | Expected |
| --- | --- |
| Topic and identity exist | Topic `insert-endpoint-requests-clickpipe`, service account `clickpipes-endpoint-requests`, and secret `clickpipes-endpoint-requests-sa-key` in GCP project `openrouter-core` |
| Destination table exists | `default.endpoint_requests_clickpipe` is migrated on the production ClickHouse service |
| JSON key minted | A key for `clickpipes-endpoint-requests` is stored as the latest version of `clickpipes-endpoint-requests-sa-key`, minted out of band so it never passes through Terraform state |
| ClickPipes Pub/Sub private preview | Enabled for our ClickHouse Cloud organization (confirmed 2026-09-03) |
| Service id in hand | `production_service_id` for the production ClickHouse service that owns `endpoint_requests`, from the ClickHouse Cloud console. The pipe belongs on that service, not the analytics service |
| Provider credential | No new key needed: the existing `clickhouse-terraform-api-key` secret, already read by `services/otel/infra`, holds the Service Admin role on the production service, which is what creating a ClickPipe requires |

### 2. Bootstrap the state bucket (first apply only)

`tfstate-clickhouse-clickpipes-infra-openrouter-ai` does not exist yet, and
`terraform init` needs it for the `backend "gcs"` block in `config.tf`, so the
first run cannot create the bucket through its own backend — `init` fails with
`Failed to get existing workspaces: bucket doesn't exist`. `-backend=false` is
not a way around it either: it initializes for `validate` only, and `apply` then
refuses with `Backend initialization required`.

Create the bucket out of band and adopt it, which keeps every Terraform command
on the real backend:

```bash
gcloud storage buckets create gs://tfstate-clickhouse-clickpipes-infra-openrouter-ai \
  --project=openrouter-core --location=US \
  --uniform-bucket-level-access --public-access-prevention
# versioning is an update-only flag on `gcloud storage buckets`
gcloud storage buckets update gs://tfstate-clickhouse-clickpipes-infra-openrouter-ai --versioning

cd services/clickhouse-clickpipes/infra
rm -rf .terraform    # drop a backend recorded by an earlier failed init
terraform init
terraform import -var 'production_service_id=<service-id>' \
  module.tfstate-bucket.google_storage_bucket.tfstate \
  tfstate-clickhouse-clickpipes-infra-openrouter-ai
```

`import` evaluates the whole configuration, so it needs
`production_service_id` like `plan` and `apply` do, and prompts for it when the
flag is missing.

The `gcloud` flags match `configs/terraform/modules/tfstate-bucket`, so the
import leaves no diff on the bucket itself; the first `plan` then shows its IAM
policy (`google_storage_bucket_iam_policy.tfstate`) alongside the pipe. Every
later run is a plain `terraform init`, and the bucket and its IAM stay under
Terraform.

### 3. Plan and apply the pipe

```bash
terraform plan -var 'production_service_id=<service-id>'
```

Expected: exactly one `clickhouse_clickpipe` to create (`endpoint-requests`),
plus the state bucket resources if they are not yet in state. If the plan shows
more than one pipe, stop.

Then apply, and in the GCP console confirm one new subscription named
`clickpipes-{pipe-id}` on `insert-endpoint-requests-clickpipe` and no other
change.

Attributes documented as forcing replacement of the pipe:
`source.pubsub.filter`, `source.pubsub.enable_ordering`, and changing the source
type at all.

### 4. Confirm ingestion

```bash
gcloud pubsub topics publish insert-endpoint-requests-clickpipe \
  --project openrouter-core \
  --message '{"started_at":"2026-09-03 12:00:00.000","row_kind":"attempt","model_permaslug":"test/model","variant":"standard","provider_slug":"test","provider_name":"Test","endpoint_id":"00000000-0000-0000-0000-000000000001","generation_id":"gen-smoke-00000000000000000000","status":200,"latency":123,"router_attempt_number":1}'
```

The payload is a flat scrubbed `EndpointRequest` row with no wrapper object, the
same shape the publisher sends. Then in ClickHouse:

```sql
SELECT generation_id, started_at, model_call_started_at, inserted_at
FROM default.endpoint_requests_clickpipe
WHERE generation_id = 'gen-smoke-00000000000000000000';
```

Expected: one row; `inserted_at` is the ingest wall-clock time from the table's
`DEFAULT now64(3)`, and `model_call_started_at` equals `started_at` from its own
`DEFAULT started_at`. If either is `1970-01-01` or zero, ClickPipes writes an
explicit zero for unmapped columns instead of omitting them from the INSERT, and
the mapping design has to change: the publisher must send both columns, and
`inserted_at` has to leave `UNMAPPED_COLUMNS` in the generator.

A malformed message (wrong type in a field) is expected to land in
`default.endpoint_requests_clickpipe_clickpipes_error` while the pipe stays
`Running`. Pub/Sub is at-least-once and neither ClickPipes nor a `MergeTree`
destination deduplicates, so a redelivered message inserts a second row.

### Running it from CI instead of a laptop

`clickhouse-clickpipes` is *not* in the `workflow_dispatch` service list of
`.github/workflows/apply-cloudrun-terraform.yaml`, and it is deliberately not
wired into `release.yaml` — this module is applied by a human, never by a
release. Two things are unverified for that workflow's identity,
`terraform-apply@openrouter-core.iam.gserviceaccount.com`, and neither can be
checked without cloud credentials:

1. Whether it can read secret versions of `clickhouse-terraform-api-key` and
   `clickpipes-endpoint-requests-sa-key` (`roles/secretmanager.secretAccessor`
   on both). It applies `services/otel/infra`, which reads the first, so that
   one is likely; the ClickPipes key secret's IAM does not grant
   `terraform-apply`.
2. Whether the state bucket exists (step 2) and whether the `objectUser` grant
   the `tfstate-bucket` module writes has taken effect for `terraform-apply`. A
   CI dispatch before step 2 fails in `terraform init`.

Until both are confirmed, run this module locally with an engineer's
credentials. Adding it to the dispatch list before that would only move the
failure into CI.

### Teardown

The pipe carries `prevent_destroy`, so a destroy fails the plan until that block
is removed in the same change.

```bash
terraform destroy -var 'production_service_id=<service-id>'
```

Expected: the pipe is gone from the ClickHouse Cloud console and its
`clickpipes-{pipe-id}` subscription is gone from GCP. Anything published while
no subscription exists is discarded by Pub/Sub. The destination table and its
rows survive — Terraform does not own them.
