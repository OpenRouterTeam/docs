# ConfirmDefaultWorkspaceDeletion

Required to delete the default workspace. Deleting it permanently disables the account’s unscoped inference API keys (management/provisioning keys are retained) and its budgets, guardrails, classifiers, and broadcast destinations. Ignored for non-default workspaces.

## Example Usage

```typescript
import { ConfirmDefaultWorkspaceDeletion } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ConfirmDefaultWorkspaceDeletion = "false";
```

## Values

```typescript
"true" | "false"
```