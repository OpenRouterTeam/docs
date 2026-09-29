# GetWorkspaceBudgetRequest

## Example Usage

```typescript
import { GetWorkspaceBudgetRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: GetWorkspaceBudgetRequest = {
  workspaceRef: "production",
  interval: "monthly",
};
```

## Fields

| Field                                                                          | Type                                                                           | Required                                                                       | Description                                                                    | Example                                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `workspaceRef`                                                                 | *string*                                                                       | :heavy_check_mark:                                                             | The workspace ID (UUID) or slug                                                | production                                                                     |
| `interval`                                                                     | [models.WorkspaceBudgetInterval](../../models/workspace-budget-interval.md)    | :heavy_check_mark:                                                             | Budget reset interval. Use "lifetime" for a one-time budget that never resets. | monthly                                                                        |