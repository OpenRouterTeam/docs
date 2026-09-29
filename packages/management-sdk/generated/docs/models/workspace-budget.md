# WorkspaceBudget

## Example Usage

```typescript
import { WorkspaceBudget } from "@openrouter-monorepo/management-sdk-generated/models";

let value: WorkspaceBudget = {
  id: "770e8400-e29b-41d4-a716-446655440000",
  workspaceId: "550e8400-e29b-41d4-a716-446655440000",
  limitUsd: 100,
  resetInterval: "monthly",
  createdAt: "2025-08-24T10:30:00Z",
  updatedAt: "2025-08-24T15:45:00Z",
};
```

## Fields

| Field                                                                    | Type                                                                     | Required                                                                 | Description                                                              | Example                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `id`                                                                     | *string*                                                                 | :heavy_check_mark:                                                       | Unique identifier for the budget                                         | 770e8400-e29b-41d4-a716-446655440000                                     |
| `workspaceId`                                                            | *string*                                                                 | :heavy_check_mark:                                                       | ID of the workspace the budget belongs to                                | 550e8400-e29b-41d4-a716-446655440000                                     |
| `limitUsd`                                                               | *number*                                                                 | :heavy_check_mark:                                                       | Spending limit in USD for this interval                                  | 100                                                                      |
| `resetInterval`                                                          | [models.ResetInterval](../models/reset-interval.md)                      | :heavy_check_mark:                                                       | Interval at which spend resets. Null means a lifetime (one-time) budget. | monthly                                                                  |
| `createdAt`                                                              | *string*                                                                 | :heavy_check_mark:                                                       | ISO 8601 timestamp of when the budget was created                        | 2025-08-24 10:30:00 +0000 UTC                                            |
| `updatedAt`                                                              | *string*                                                                 | :heavy_check_mark:                                                       | ISO 8601 timestamp of when the budget was last updated                   | 2025-08-24 15:45:00 +0000 UTC                                            |