# usage-record Terraform

This OpenTofu root manages the infrastructure for the usage-record service, including
but not limited to the Spanner instance.

## Running

You can run any tofu command (`plan`, `apply`, etc.) via the wrapper:

    bun run terraform-or <plan|apply|...>

