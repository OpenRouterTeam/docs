# cfw-video-api/infra — agent guide

Terraform for the private generated-media buckets (`openrouter-generated-media-us`, `openrouter-generated-media-eu`) in `customer-data-483518` and the `generated-media-writer` service account in `openrouter-core`. Own state in `tfstate-cfw-video-api-infra-openrouter-ai`.

## CI applies this stack

The release train applies this stack through `.github/workflows/apply-cloudrun-terraform.yaml` (service-name `cfw-video-api`) as `terraform-apply@openrouter-core`. Dispatch `Apply Cloud Run Terraform` with the same service name for an out-of-band apply. Validate a change by that job going green, not by a local apply under your own credentials.

The CI service accounts hold no project role in `customer-data-483518`. They reach the buckets only through the `roles/storage.admin` binding in the bucket IAM policy, so:

- Keep both `terraform-apply@` and `terraform-plan@` in that binding. The policy is authoritative; dropping them 403-breaks every later apply.
- A new bucket in `customer-data-483518` cannot be created by CI. Create it with one local apply by someone with `storage.buckets.create` in that project, then let CI own it.

## First apply (one time)

The state bucket and the two generated-media buckets do not exist yet, and CI can create neither. Someone with `storage.admin` in `openrouter-core` and `customer-data-483518` runs, from this directory:

```bash
tofu init -backend=false
tofu apply -target=module.tfstate-bucket
tofu init -migrate-state
tofu apply
```

After that, release applies keep the stack in sync. The writer's key is created by hand (CI cannot create keys) and stored in Infisical as `GENERATED_MEDIA_GCS_CREDENTIALS_JSON`.
