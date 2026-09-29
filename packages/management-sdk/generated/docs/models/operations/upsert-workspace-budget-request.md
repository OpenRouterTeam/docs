# UpsertWorkspaceBudgetRequest

## Example Usage

```typescript
import { UpsertWorkspaceBudgetRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: UpsertWorkspaceBudgetRequest = {
  workspaceRef: "production",
  interval: "monthly",
};
```

## Fields

| Field                                                                                  | Type                                                                                   | Required                                                                               | Description                                                                            | Example                                                                                |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `workspaceRef`                                                                         | *string*                                                                               | :heavy_check_mark:                                                                     | The workspace ID (UUID) or slug                                                        | production                                                                             |
| `interval`                                                                             | [models.WorkspaceBudgetInterval](../../models/workspace-budget-interval.md)            | :heavy_check_mark:                                                                     | Budget reset interval. Use "lifetime" for a one-time budget that never resets.         | monthly                                                                                |
| `body`                                                                                 | [models.UpsertWorkspaceBudgetRequest](../../models/upsert-workspace-budget-request.md) | :heavy_minus_sign:                                                                     | N/A                                                                                    | {<br/>"limit_usd": 100,<br/>"include_byok_in_budgets": true<br/>}                      |