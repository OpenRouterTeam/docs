# Teardown: gcp-data-deletions Cloud Run service

The `gcp-data-deletions` Cloud Run service is obsolete. `UserDeletionWorkflow`
in `services/cfw-internal` is the only deletion orchestrator, and it owns the
R2 bindings the legacy service never had. This runbook destroys the service's
infrastructure. It must run **before** the pull request that removes
`services/gcp-data-deletions` merges, because that directory holds the only
Terraform configuration able to manage the resources, and the Cloud Run service
carries `deletion_protection = true`.

Stack order:

1. [#40653](https://github.com/OpenRouterTeam/openrouter-web/pull/40653) and
   [#40654](https://github.com/OpenRouterTeam/openrouter-web/pull/40654) merge
   first. After that nothing enqueues work to the legacy service and deletion
   monitoring is emitted by `cfw-internal`.
2. This runbook runs.
3. [#40655](https://github.com/OpenRouterTeam/openrouter-web/pull/40655) merges
   once the Terraform state is empty.
4. [#40658](https://github.com/OpenRouterTeam/openrouter-web/pull/40658) merges
   last, and has its own prerequisite in the section at the bottom.

## Who runs this

Run the destroy as `terraform-apply@openrouter-core.iam.gserviceaccount.com`,
the identity the `Apply Cloud Run Terraform` workflow already uses against this
state. It holds exactly the permissions that created these resources — Cloud
Run, service accounts, and project and Secret Manager IAM bindings — so a
destroy run under it cannot fail authorization on a subset of them.

The operator needs `roles/iam.serviceAccountTokenCreator` on that service
account, membership in `engineering@openrouter.ai` (which carries
`roles/storage.admin` on the state bucket, for the manual bucket deletion in the
last step), and permission to dispatch the `Apply Cloud Run Terraform`
workflow.

```bash
gcloud auth application-default login
export GOOGLE_IMPERSONATE_SERVICE_ACCOUNT=terraform-apply@openrouter-core.iam.gserviceaccount.com
```

## What gets destroyed

| Resource | Address |
| --- | --- |
| Cloud Run service `gcp-data-deletions` (us-central1) | `google_cloud_run_v2_service.data_deletions` |
| Its invoker IAM policy | `google_cloud_run_v2_service_iam_policy.data_deletions` |
| Worker service account `gcp-data-deletions-worker@openrouter-core.iam.gserviceaccount.com` | `google_service_account.gcp-data-deletions-worker` |
| Secret accessor, Artifact Registry and Terraform SA-user bindings | `google_secret_manager_secret_iam_member.worker_secret_access`, `google_project_iam_member.worker_artifact_registry`, `google_service_account_iam_member.worker_terraform_apply_user` |
| State bucket `tfstate-gcp-data-deletions-infra-openrouter-ai` | `module.tfstate-bucket`, removed from state and deleted by hand in the last step |

The `GCP_DATA_DELETIONS_*` Secret Manager secrets are declared as `data`
sources, so Terraform does not delete them. Delete them by hand after the
destroy, or leave them: they are inert once no service account can read them.

`module.pg_us_secrets` has no managed resources either — it is data sources and
outputs that expose the pg-us connection env — so the destroy removes nothing
for it. The `gcp_data_deletions` Cloud SQL user and its
`sql-pg-us-central1-gcp_data_deletions-password` secret belong to
`packages/db/infra/postgres-us-central1.tf` in a separate state, and go away
with #40658 (see the database prerequisite below).

## Steps

Steps 3 through 5 all run in one shell, from a checkout of the deletion-protection commit with `services/gcp-data-deletions/infra` as the working directory. That directory does not exist on the branch you are reading this on, and will not exist on `main` once [#40655](https://github.com/OpenRouterTeam/openrouter-web/pull/40655) merges — which is why the destroy runs from the older checkout, and why step 2 must land before that merge.

1. **Confirm the service is idle.** In Datadog (us5), check that
   `service:gcp-data-deletions` has no request logs for the past 24 hours and
   that `data-deletion:sweep:completed` is arriving from `cfw-internal`.

   ```
   service:gcp-data-deletions
   service:internal* "data-deletion:sweep:completed"
   ```

2. **Disable deletion protection.** Deletion protection blocks a destroy while
   it is set, and it can only be cleared through an apply. Land a one-line
   commit on `main` setting `deletion_protection = false` in
   `services/gcp-data-deletions/infra/cloud-run.tf`, then dispatch
   `Apply Cloud Run Terraform` with `service-name: gcp-data-deletions`.

3. **Drop the state bucket out of Terraform's management.** `module.tfstate-bucket`
   is the bucket this configuration keeps its own state in, and it has object
   versioning with no `force_destroy`, so a destroy that includes it fails on a
   non-empty bucket and never reaches an empty state. Remove it from state
   first: the bucket and its objects are untouched, only Terraform's management
   of them ends.

   ```bash
   git checkout <deletion-protection-commit>
   cd services/gcp-data-deletions/infra
   terraform init
   terraform state rm module.tfstate-bucket
   ```

4. **Destroy the remaining resources**, in the same shell and directory as step 3. The `Apply Cloud Run Terraform` workflow only applies, never destroys, so this runs locally against production.

   ```bash
   gcloud auth application-default login
   terraform plan -destroy -out=destroy.tfplan
   terraform apply destroy.tfplan
   ```

   Read the plan before applying. It must name the resources in the table
   above and nothing else, with no state-bucket resources left in it. Anything
   else means the wrong state is loaded, and the destroy stops there.

5. **Verify the state is empty.**

   ```bash
   terraform state list   # expect no output
   gcloud run services describe gcp-data-deletions --region=us-central1 \
     --project=openrouter-core   # expect NOT_FOUND
   ```

6. **Merge the code removal.** With state empty,
   [#40655](https://github.com/OpenRouterTeam/openrouter-web/pull/40655) can
   merge. It removes the Terraform configuration, the release-workflow jobs and
   the service directory.

7. **Delete the state bucket.** The state now describes nothing, so the bucket
   holds only history. Delete it after the merge, once nothing needs the
   backend again.

   ```bash
   gcloud storage rm -r gs://tfstate-gcp-data-deletions-infra-openrouter-ai
   ```

## If the destroy fails partway

Terraform state still holds whatever survived, so the destroy is re-runnable
from the same checkout. Do not merge the code-removal pull request until
`terraform state list` is empty. `terraform state rm module.tfstate-bucket` is
not idempotent — a second run errors that the address is absent, which is
harmless. If the state file itself is lost while resources remain, delete them
by hand in the console: the service, then the worker service account and its IAM
bindings.

## Database prerequisite for #40658

[#40658](https://github.com/OpenRouterTeam/openrouter-web/pull/40658) drops the
`gcp_data_deletions` grants and default privileges. The `graphile_worker`
schema is not dropped by that migration: graphile-worker created it at runtime
as the `gcp_data_deletions` role, so the migration role does not own it. Drop it
out of band as the Cloud SQL administrator before the migration runs — the
migration fails with this instruction if the schema is still there, because
leaving it would fail the later Terraform user removal instead.

```sql
DROP SCHEMA graphile_worker CASCADE;
```

Then, in order: merge #40658 so the migration removes the grants, and let the
`packages/db/infra` apply remove the Cloud SQL user. The user cannot be dropped
while it still holds privileges or owns objects.
