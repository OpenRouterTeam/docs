# Workspaces agent guidelines

## The default workspace is not guaranteed to exist

Admins can delete their entity's default workspace. Code that assumes it
exists, or falls back to it when a workspace is not otherwise resolvable,
is a bug.

- **Never fall back to the default workspace.** If a code path has no
  resolved workspace, require an explicit workspace ID from the caller or
  fail the operation. Do not fabricate one.
- **`defaultWorkspaceId(entityId)` names a row, it does not prove one.** Use
  it only where the default workspace is being created or where a row's
  default-ness is being checked. Never use it as `?? defaultWorkspaceId(...)`
  to fill a missing workspace. Inference-path attribution reads
  `resolvedWorkspaceId` then `workspace.id` and returns `undefined` otherwise
  (`packages/helpers/require-workspace-id.ts`).
- **Every entity has at least one workspace.** `deleteWorkspaceIfNotLast`
  enforces this, so "zero workspaces" is unreachable but "no default
  workspace" is normal.
- **Workspace-less members are intentional.** Members added after the default
  workspace was deleted, and members whose only workspace was the deleted
  default, belong to no workspace and are prompted to request access from an
  admin. Do not auto-create a workspace or auto-assign one to repair this
  state.

`REVIEW.md` in `packages/db` covers query-layer scope enforcement; this file
covers the existence invariant only.
