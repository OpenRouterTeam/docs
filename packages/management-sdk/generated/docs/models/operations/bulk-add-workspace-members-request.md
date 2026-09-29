# BulkAddWorkspaceMembersRequest

## Example Usage

```typescript
import { BulkAddWorkspaceMembersRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: BulkAddWorkspaceMembersRequest = {
  id: "production",
};
```

## Fields

| Field                                                                                       | Type                                                                                        | Required                                                                                    | Description                                                                                 | Example                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`                                                                                        | *string*                                                                                    | :heavy_check_mark:                                                                          | The workspace ID (UUID) or slug                                                             | production                                                                                  |
| `body`                                                                                      | [models.BulkAddWorkspaceMembersRequest](../../models/bulk-add-workspace-members-request.md) | :heavy_minus_sign:                                                                          | N/A                                                                                         | {<br/>"user_ids": [<br/>"user_abc123",<br/>"user_def456"<br/>]<br/>}                        |