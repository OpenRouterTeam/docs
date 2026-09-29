# ListWorkspaceMembersRequest

## Example Usage

```typescript
import { ListWorkspaceMembersRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListWorkspaceMembersRequest = {
  id: "production",
};
```

## Fields

| Field                                         | Type                                          | Required                                      | Description                                   | Example                                       |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `id`                                          | *string*                                      | :heavy_check_mark:                            | The workspace ID (UUID) or slug               | production                                    |
| `offset`                                      | *number*                                      | :heavy_minus_sign:                            | Number of records to skip for pagination      | 0                                             |
| `limit`                                       | *number*                                      | :heavy_minus_sign:                            | Maximum number of records to return (max 100) | 50                                            |