# Management SDK — Agent Guide

`@openrouter-monorepo/management-sdk` is a typed internal TypeScript SDK
for OpenRouter's management/provisioning APIs, generated from
`openrouter-management.openapi.yaml` via Speakeasy. It mirrors the
committed-generated pattern used by `services/cfw-mcp/generated`.

## What lives where

| Path | Description |
|---|---|
| `generated/` | Speakeasy output — **committed** source, not build output |
| `generated/src/sdk/` | SDK entry classes (workspaces, api-keys, byok, etc.) |
| `generated/src/models/` | Typed request/response models |
| `generated/src/models/operations/` | Per-operation request/response types |
| `generated/.speakeasy/workflow.yaml` | Speakeasy target config + pinned CLI version |
| `generated/.speakeasy/gen.yaml` | Speakeasy generation options |
| `scripts/regen.ts` | Regen script: `speakeasy run` + artifact cleanup + `@ts-nocheck` stamping |
| `../../openrouter-management.openapi.yaml` | Input spec (committed, `linguist-generated`) |

## Regen workflow

The management spec is a **filtered subset** of the same assembled Hono
route schemas that produce the public OpenAPI spec. Routes opt into the
management spec via the `x-or-specs: ['management']` extension on their
`createRoute(...)` config.

```bash
# 1 + 2. Regenerate the management OpenAPI spec from Hono route schemas,
# then the typed SDK from that spec (speakeasy run + cleanup + @ts-nocheck stamping)
bun run generate:management-sdk       # at repo root

# 3. Verify
cd packages/management-sdk
bun test                              # smoke test: exports resolve, client instantiates, schemas parse
```

The root `generate:management-sdk` alias chains
`generate:management-openapi` before the SDK regen on purpose: the
package-local `bun run regen` reads `openrouter-management.openapi.yaml`
at the repo root, so running it against a stale spec silently produces
no change (no error — new endpoints just don't appear). Only run the
package-local `regen` directly when you know the committed spec is
current (e.g. reproducing the CI staleness gate).

## CI staleness gate

`management-sdk-regen-check` in `.github/workflows/openapi-pr-comment.yaml`
regenerates the SDK on every PR where the **management** spec or the SDK
package changed, and fails if the committed output is stale — unless the
staleness was inherited from the base branch. On a head-regen mismatch,
the job regenerates once more at the merge-base: if the two regens are
identical and the PR doesn't touch the committed `generated/` output,
the drift predates the PR, so the check passes with a warning (main
self-heals via `sdk-auto-regenerate-on-merge.yaml`; merge main to clear
it locally). Any PR-caused mismatch — spec changes without a regen, or
hand-edits to generated files — still fails. The check is gated
on `openapi-breaking-check.outputs.has_management_changes` — a merge-base
diff of `openrouter-management.openapi.yaml` and
`packages/management-sdk/**` — NOT on the public spec's `has_changes`.
The two can diverge: `x-or-specs` markers are stripped from the public
spec, so tagging/untagging a route for the management spec (or editing
`scripts/export-management-openapi.ts`) changes the management spec while
leaving the public spec byte-identical.

The `openapi-breaking-check` job also auto-commits
`openrouter-management.openapi.yaml` (via the `commit-spec` step) so the
spec stays in sync with route changes without manual intervention. The
commit is gated on a regen-to-regen diff (PR-branch regen vs merge-base
regen), so it only fires when the PR itself changes the management
spec — staleness of the committed spec on main never leaks bot commits
into unrelated PRs.

## Speakeasy CLI version

The CLI version is pinned in
`generated/.speakeasy/workflow.yaml` (`speakeasyVersion` field). Always
use the pinned version — a newer local binary produces different output
and fails the CI diff:

```bash
grep 'speakeasyVersion:' packages/management-sdk/generated/.speakeasy/workflow.yaml
curl -fsSL https://raw.githubusercontent.com/speakeasy-api/speakeasy/main/install.sh | sh
speakeasy update --version <PINNED_VERSION>
speakeasy --version   # verify
```

Do **not** bump `speakeasyVersion` as a side effect of having a newer
local CLI — that is a deliberate, reviewed change.

## Gotchas

- **`@ts-nocheck` stamping**: `regen.ts` stamps every generated `.ts`
  file because Speakeasy output doesn't pass the monorepo's stricter
  tsconfig. Don't remove the stamps; don't add hand-written code to
  stamped files. Consumers still get full types via the package's
  declared `exports`.
- **Consumed as source**: the package's `exports` point at
  `./generated/src/index.ts` (raw source), not compiled output. The
  `tsconfig.build.json` excludes `generated/` and `**/*.test.ts` — the
  composite build validates only `scripts/`; `smoke.test.ts` (which
  imports the generated sources) is checked by the package-local
  `bun run typecheck` (`tsgo --noEmit`) and run by `bun test`.
  Consumers import types from the generated source directly.
- **`--skip-compile --skip-versioning`**: these flags make regen
  idempotent (no npm-install/tsc step, no version bump). A second run on
  a clean tree must produce no diff — that's what the CI gate asserts.
- **Build artifacts are stripped**: `regen.ts` removes `node_modules`,
  `bin`, `esm`, `bun.lock`, `examples`, etc. after generation because the
  package is consumed as source by its callers.
