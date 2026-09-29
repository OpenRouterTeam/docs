# BulkRemoveWorkspaceMembersRequest

## Example Usage

```typescript
import { BulkRemoveWorkspaceMembersRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: BulkRemoveWorkspaceMembersRequest = {
  id: "production",
};
```

## Fields

| Field                                                                                             | Type                                                                                              | Required                                                                                          | Description                                                                                       | Example                                                                                           |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `id`                                                                                              | *string*                                                                                          | :heavy_check_mark:                                                                                | The workspace ID (UUID) or slug                                                                   | production                                                                                        |
| `body`                                                                                            | [models.BulkRemoveWorkspaceMembersRequest](../../models/bulk-remove-workspace-members-request.md) | :heavy_minus_sign:                                                                                | N/A                                                                                               | {<br/>"user_ids": [<br/>"user_abc123",<br/>"user_def456"<br/>]<br/>}                              |