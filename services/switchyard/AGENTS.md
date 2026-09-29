# Switchyard service operations

The service image pins a specific NVIDIA NeMo Switchyard revision. The
authoritative upstream pin and archive checksum are in
[`upstream-lock.txt`](upstream-lock.txt) and [`Dockerfile`](Dockerfile).

## Configuration conventions

- [`routes.toml`](routes.toml) is baked into the image. Model, route, or
  threshold changes require an image rebuild and deploy, not only a Terraform
  apply.
- The pinned Switchyard config schema denies unknown fields. A stray key is a
  startup failure.
- Keep route IDs synchronized with the shared schema in
  `packages/temporal/src/schemas.ts`; do not duplicate or rename them locally.
- The activity worker pool's Terraform configuration sets
  `SWITCHYARD_ENABLED=true`; the workflow-only pool does not run benchmark
  activities and does not need this variable. The worker pool and Switchyard
  service share one Terraform state and are created by the same apply, but no
  workflow applies that stack automatically. A routed run before the service
  is healthy fails non-retryably rather than falling back to direct OpenRouter
  traffic, while a run without a selected arm returns before reading the flag.

## Upstream reasoning handling

The bench image builds the pinned upstream revision without local patches.
Foreign unsigned reasoning reaching an Anthropic target is handled by
Switchyard's native guard only when the target uses the `anthropic_messages`
client format, which selects the native Anthropic backend. Responses-format
clients bypass that guard entirely, so a route that can escalate to an
Anthropic model must reach it through the `anthropic_messages` client rather
than rely on a local patch.

## Local validation

Run the pinned server's own dry-run from a Switchyard checkout, pointing at
this repository's config. From the repository root:

```bash
SWITCHYARD_CHECKOUT=/path/to/Switchyard
OPENROUTER_WEB_CHECKOUT=.
(cd "$SWITCHYARD_CHECKOUT" && cargo run --locked --release --package switchyard-server -- --config "$OPENROUTER_WEB_CHECKOUT/services/switchyard/routes.toml" --dry-run)
```
