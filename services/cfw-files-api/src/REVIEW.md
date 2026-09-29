# Files API review checklist

R2 keys use the entity and workspace prefix as the isolation boundary. The
entity segment alone does not stop a caller from addressing a foreign
`workspaceId` inside its own entity prefix or from driving that workspace's
quota Durable Object. Use the `security-review` authorization class for the
reasoning.

Flag a new or changed route or helper if it builds an R2 key or list prefix,
parses a file id, or addresses the quota Durable Object from a
caller-controlled `workspaceId` without an unconditional authorization path
before the operation.

Targeted automated coverage exists in `files/r2-key.test.ts`,
`files/authorize-workspace.test.ts`, and
`durable-objects/workspace-storage.cfw.test.ts`. These tests cover key
namespace matching, authorization refusals, and R2 prefix isolation, but do
not prove that every route or helper invokes authorization before its
operation.
