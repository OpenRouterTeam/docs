# E2E Test Agent Guide

## Type-assert request bodies per skin

Each API skin takes a different request shape, so pin the body to that skin's
request type with `satisfies` and let the compiler reject mismatched fields:

```typescript
// BAD — wrong fields silently pass
body: definedValues({ model, messages: [...] }),

// GOOD — compiler rejects invalid shapes
body: definedValues({
  model,
  messages: [...],
} satisfies ChatCompletionCreateParams),
```

Chat completions use `ChatCompletionCreateParams` and messages use
`AnthropicMessagesNormalizedRequestInput`, both from the skin's
`schemas/request` module; the responses suite asserts through the
`callApi<ResponsesAPIResponse>` generic instead. For a new skin, take the
request type from `packages/router/skins/<skin>/schemas/`.

## Running the suite against a specific production cfw-api version

The `E2E Tests (CF Version)` workflow
(`.github/workflows/e2e-tests-cf-version.yaml`) can be triggered with
`repository_dispatch`:

```bash
gh api repos/OpenRouterTeam/openrouter-web/dispatches \
  -f event_type=cfw-api-e2e-version \
  -f 'client_payload[cf_version_id]=<uuid>'
```

The dispatch token needs repository `contents: write` permission.

To narrow the suite, add
`-f 'client_payload[test_filter]=api/messages/beta-features/compaction.test.ts'`.
`test_filter` is a Vitest filter or test path and is rejected if it starts
with `-`, so it cannot become a runner flag in the secret-bearing job.
Repository dispatches always run the workflow from the default branch.

See [Running Against a Specific Production Worker Version in CI](./README.md#running-against-a-specific-production-worker-version-in-ci)
for pinning behavior and deployment checks.
