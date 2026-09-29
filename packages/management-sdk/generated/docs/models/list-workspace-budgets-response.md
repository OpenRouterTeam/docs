# ListWorkspaceBudgetsResponse

## Example Usage

```typescript
import { ListWorkspaceBudgetsResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ListWorkspaceBudgetsResponse = {
  data: [
    {
      id: "770e8400-e29b-41d4-a716-446655440000",
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      limitUsd: 100,
      resetInterval: "monthly",
      createdAt: "2025-08-24T10:30:00Z",
      updatedAt: "2025-08-24T15:45:00Z",
    },
  ],
  includeByokInBudgets: false,
};
```

## Fields

| Field                                                                                                                                                                                                     | Type                                                                                                                                                                                                      | Required                                                                                                                                                                                                  | Description                                                                                                                                                                                               | Example                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`                                                                                                                                                                                                    | [models.WorkspaceBudget](../models/workspace-budget.md)[]                                                                                                                                                 | :heavy_check_mark:                                                                                                                                                                                        | List of budgets configured for the workspace                                                                                                                                                              |                                                                                                                                                                                                           |
| `includeByokInBudgets`                                                                                                                                                                                    | *boolean*                                                                                                                                                                                                 | :heavy_minus_sign:                                                                                                                                                                                        | Whether BYOK (bring-your-own-key) spend is included when enforcing the workspace's budgets. This is a workspace-wide setting that applies to all budget intervals (daily, weekly, monthly, and lifetime). | false                                                                                                                                                                                                     |