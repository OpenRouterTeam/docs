# batch-api/infra — agent guide

Terraform for the `batch-api` Cloud Run service. Own state, no shared-VPC
declaration (modelled on `services/jerk`).

## CI must be able to plan your change

This stack is planned and applied in CI by
`terraform-plan@openrouter-core` / `terraform-apply@openrouter-core`
(`.github/workflows/apply-cloudrun-terraform.yaml`, also invoked by the
release train). Those SAs have a narrower role set than a human's
credentials, so a change that works with a local `terraform apply` can
still break every subsequent CI plan.

- **Any new `data` source that reads a GCP resource** (Cloud SQL, Cloud
  Scheduler, Cloud Run, etc.) executes at *plan* time for every future
  run of this stack — not just yours. Before merging, confirm both CI
  SAs hold a role that permits the read (e.g. `roles/cloudsql.viewer`
  for `google_sql_database_instance`), and add the grant if not; a
  missing grant 403-breaks every later plan of the stack (PR #26248).
- **Never validate infra changes only with a local `terraform apply`**
  under your own credentials. After merging, dispatch
  `Apply Cloud Run Terraform` (service-name: `batch-api`) and confirm it
  goes green — that is the proof CI can plan and apply the stack.
- New `resource` blocks are lower risk (apply-time, first run only), but
  check the apply SA's roles cover the create + any `setIamPolicy` the
  resource needs.

## Secret injection: how a secret reaches the container

Cloud Run doesn't read Infisical or KV. A value is relayed across four layers:

```
Infisical /services/batch-api  →(sync)→  GSM BATCH_API_<KEY>  →(SA grant)→  container env (secret_key_ref)
```

1. **Infisical** `/services/batch-api` (prod) holds the value. Source of truth.
2. **`secrets.tf`** — `infisical_secret_sync_gcp_secret_manager` mirrors the
   whole folder into GSM, renaming with `key_schema = "BATCH_API_{{secretKey}}"`.
   So `CF_KV_API_TOKEN` → GSM `BATCH_API_CF_KV_API_TOKEN`. Folder-wide, so no
   per-secret Terraform lives here.
3. **`iam.tf`** — the `batch-api-worker` SA holds
   `roles/secretmanager.secretAccessor` project-wide, so it already reads every
   `BATCH_API_*` secret. No per-secret IAM binding is needed.
4. **`cloudrun.tf`** — `value_source.secret_key_ref` maps the GSM secret onto a
   container env var. This is the only step that puts the value in the running
   container.

`env.manifest.json` (repo root) is **not** part of this pipeline. It's a
validation/doc artifact: `scripts/infisical/validate-infisical-mapping.ts`
checks that the keys it lists exist in Infisical. Adding a key there neither
creates the Infisical value nor triggers the sync nor injects into the
container.

## Adding a net-new secret

1. Put the value in Infisical `/services/batch-api` (prod, and dev if the local
   stack needs it). The folder sync then produces `BATCH_API_<KEY>` in GSM — no
   Terraform change for the sync itself.
2. Add a `secret_key_ref` env block in `cloudrun.tf`:

   ```hcl
   env {
     name = "<KEY>"
     value_source {
       secret_key_ref {
         secret  = "BATCH_API_<KEY>"
         version = "latest"
       }
     }
   }
   ```

3. No IAM change — the project-wide `secretAccessor` grant already covers it.
4. Add `<KEY>` to `env.manifest.json` under `/services/batch-api` so validation
   passes.
5. Apply via `apply-cloudrun-terraform.yaml` and deploy a new revision. Because
   `version = "latest"` binds at revision-creation time, an existing revision
   won't pick up a newly-added or rotated secret until it redeploys.

## Non-secret config

Bucket names, Spanner/PubSub IDs, and Vertex project/region are written as plain
`value` env in `cloudrun.tf`. Terraform is the write path for non-secret config;
Infisical only holds real secrets.

## Optional-at-boot secrets

Some env vars are read with an explicit optional branch rather than
`ensureEnv` (e.g. `CF_KV_API_TOKEN` in `src/submit/accept/batch-limits-config.ts`). A
missing value degrades to a compiled default (logged as
`CF_KV_API_TOKEN absent, using static batch limits`) instead of crashing boot —
so a broken wiring fails silently. If you add an optional secret, confirm all
four layers above, since nothing will crash to tell you a layer is missing.
