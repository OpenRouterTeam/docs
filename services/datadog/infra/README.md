# Datadog Infrastructure Configuration

This Terraform project manages Datadog integrations with our infrastructure
providers.

## Provider credentials

The Datadog provider reads the latest `datadog-api-key` and `datadog-app-key` versions from Secret Manager in `openrouter-root`. These reads are ephemeral, so the provider credentials do not enter the plan or state. Apply the `openrouter-infra` foundation grants for `datadog-spacelift@openrouter-root.iam.gserviceaccount.com` before deploying this stack; it needs Secret Accessor on both secrets.

## Postgres Database Monitoring (DBM)

`postgres.tf` creates a read-only `datadog` Cloud SQL user for each primary
instance (`pg-us-central1`) and a Kubernetes secret with its
credentials. Read replicas (`pg-us-east4`, `pg-us-central1-replica`) cascade
from `pg-us-central1` (`pg-us-east4`) and from `pg-us-east4`
(`pg-us-central1-replica`), inheriting the primary's `datadog` user automatically.
DBM also needs
SQL-level grants (a `datadog` schema, the `pg_monitor` role, the
`pg_stat_statements` extension, and an `explain_statement` function) that
Terraform cannot express.

After `tofu apply` creates the user, run the grants once per instance
from the repo root:

```sh
bun run x datadog-dbm-grants.ts pg-us-central1
```

Currently monitored instances: `pg-us-central1`, `pg-us-east4`,
`pg-us-central1-replica`. The grants script currently supports
`pg-us-central1`; for other instances, add them to the script's `Instance`
enum or apply grants manually.

See `scripts/datadog-dbm-grants.ts` for the exact statements and the
Datadog GCSQL setup reference.
