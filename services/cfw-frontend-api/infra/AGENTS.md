# cfw-frontend-api/infra — agent guide

This root is applied manually. The release-train Terraform identity is
intentionally not permitted to create service-account keys
(`ci/infra/terraform.tf:84-87`), which this root provisions.

Apply this root before `services/alert-evaluator/infra`: that root resolves the
frontend-api service account through a `data` source.

From this directory, authenticate the Infisical provider with:

```bash
INFISICAL_TOKEN=$(infisical user get token --plain) tofu apply
```
