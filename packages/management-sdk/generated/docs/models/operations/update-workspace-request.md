# UpdateWorkspaceRequest

## Example Usage

```typescript
import { UpdateWorkspaceRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: UpdateWorkspaceRequest = {
  id: "production",
};
```

## Fields

| Field                                                                     | Type                                                                      | Required                                                                  | Description                                                               | Example                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `id`                                                                      | *string*                                                                  | :heavy_check_mark:                                                        | The workspace ID (UUID) or slug                                           | production                                                                |
| `body`                                                                    | [models.UpdateWorkspaceRequest](../../models/update-workspace-request.md) | :heavy_minus_sign:                                                        | N/A                                                                       | {<br/>"name": "Updated Workspace",<br/>"slug": "updated-workspace"<br/>}  |