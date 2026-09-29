# Guidelines for sdk-generation package

This package generates the OpenRouter OpenAPI specification and nothing
else: SDK *code* is generated in the external SDK repos from the spec this
package emits, and SDK documentation is not produced here.

## Testing & typing

- Run `bun run --filter sdk-generation typecheck` and
  `bun run --filter sdk-generation test` before shipping; tooling details
  live in `README.md#development`.

## OpenAPI generation

- Generate the spec from the repo root with `bun run generate:openapi`.
  This runs `export:openapi` (assembles `openapi-assembled.json` from the
  API route definitions), then `src/openapi/generate-openapi.ts`
  (post-processing), then validates with `speakeasy lint`.
- `export:openapi` explicitly invokes `src/openapi/export-openapi.build.ts`.
  The `.build.ts` suffix keeps assembly out of bare `bun test` discovery,
  preventing the unit-suite flake; renaming it to `*.test.ts` reintroduces it.
- The assembly file still uses `bun:test` because `test-preload.ts`'s
  `mock.module` is the only stub for `cloudflare:workers`.
- The generated spec is written to `openrouter-openapi.yaml` (repo root),
  and `projects/docs/openapi/openapi.yaml` (Mintlify).

## Speakeasy CLI version requirement

- Each SDK pins a specific Speakeasy CLI version in its
  `.speakeasy/workflow.yaml` (`speakeasyVersion` field) in the external
  SDK repo, which is the source of truth. Read it from the repo you are
  generating for:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/OpenRouterTeam/typescript-sdk/main/.speakeasy/workflow.yaml | grep speakeasyVersion
  curl -fsSL https://raw.githubusercontent.com/OpenRouterTeam/python-sdk/main/.speakeasy/workflow.yaml | grep speakeasyVersion
  ```

  If the local `speakeasy --version` differs, switch to the pinned one with
  `speakeasy update --version <version>` before generating.
- You **must** use the exact pinned version when running Speakeasy. A
  mismatched version produces different generated output and may fail
  downstream SDK checks.
- Do **not** bump `speakeasyVersion` as a side-effect of generation.
  Version upgrades are intentional changes that affect the public SDK
  repos via Copybara export.
