# Video-generation review additions

- **Gate before dispatch.** Validate model-supported input references and
  input/output modalities before selecting an adapter; do not rely on provider
  failures to enforce capability policy.
- **Validate remote references defensively.** `input_reference` URLs must pass
  the shared SSRF checks, and modality edits must refresh the model cache before
  subsequent requests can route.

- **Token-based video billing.** For models that bill on provider-reported
  tokens (estimate at request time, actual usage at completion), follow the
  contract in
  [packages/pricing/strategies/seedance/AGENTS.md](../pricing/strategies/seedance/AGENTS.md):
  append both items under the same SKU and let the reducer's last-write-wins
  pick the final quantity, and keep DO RPC payloads JSON-primitive-safe (no
  `BigNumber` instances).

# Adapter and pricing review checklist

Patterns to flag when reviewing video-generation adapter and pricing changes.

## Adapter contract

- Adapter must extend `BaseVideoGenerationAdapter`; flag hand-rolled job persistence, alarms,
  retries, webhook delivery, or cleanup — `VideoGenerationJob` owns those.
- Every adapter must populate `video_output_duration` on the generation row through
  `getEstimatedVideoDuration` at request time or `setVideoDuration` at terminal poll; if neither is
  possible, document why in a comment at the `getEstimatedVideoDuration` override.
- Metadata added to `CompletedGenerationContext` that can change after submit must be merged
  back after polling, not only snapshotted at submission.
- Request capabilities must be endpoint-owned in `supported_video_parameters`; no provider
  limits hardcoded in the adapter, routing, or UI.
- Transient poll states must not be classified as terminal; transient states cannot loop
  forever, completed jobs cannot double-charge, and failed jobs release pending charges.
- Input-reference URL/data handling must pass the shared SSRF checks; signed URLs, artifact
  expiration, and response sizes are bounded; API keys, prompts, and media are redacted.

## Capability metadata

- Every field declared in `supported_video_parameters` is honored by the adapter's request
  mapping; ignored fields must be absent from the capability row.
- Provider values missing from the serving enums (`packages/enums/video-parameters.ts`) must
  be added in the same adapter PR, never dropped from the row.

## Pricing and SKUs

- Estimated SKU items, final SKU items, `pricing_json`, and public metadata must agree.
- Duration, resolution, audio, minimum-charge, per-video/per-second, BYOK, and provider-variant
  rules are reconciled against a live capture or invoice.

## Fixtures and tests

- Submit, poll, terminal success, failure, and artifact fixtures are checked in; tests cover
  every terminal state and invalid response.
- Artifact downloads resolve DNS through the SSRF guard before mocked fetch runs. Use literal
  address fixtures or mock the resolver when testing artifact downloads.
- Run each touched adapter test file independently. Bun can share `node:dns` mocks across files,
  allowing a whole-package run to hide hostname fixture failures.

# Review Guidelines

Video generation is expensive and slow. Every change to this package must include one of:

1. **A new e2e test** under `tests/manual/api/video/`, or **results from existing manual e2e tests** referenced in the PR description, when the change can alter the request or response path of an actual video generation. This includes request construction, provider dispatch, polling or status handling, output or video retrieval, capability gating, SSRF or input-reference validation, pricing, and accounting. Manual tests don't run in CI automatically, so they won't block pipelines or incur costs on every push.
2. **Unit-test coverage instead of manual e2e** for changes limited to error metadata or fault classification, types, comments, logging, refactors with no behavioral delta, or test-only changes. The PR description must state that this carve-out applies and name the unit coverage standing in for e2e.
