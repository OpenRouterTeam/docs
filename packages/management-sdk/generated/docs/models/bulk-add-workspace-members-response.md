# BulkAddWorkspaceMembersResponse

## Example Usage

```typescript
import { BulkAddWorkspaceMembersResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: BulkAddWorkspaceMembersResponse = {
  data: [
    {
      id: "660e8400-e29b-41d4-a716-446655440000",
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      userId: "user_abc123",
      role: "member",
      createdAt: "2025-08-24T10:30:00Z",
    },
  ],
  addedCount: 1,
};
```

## Fields

| Field                                                     | Type                                                      | Required                                                  | Description                                               | Example                                                   |
| --------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `data`                                                    | [models.WorkspaceMember](../models/workspace-member.md)[] | :heavy_check_mark:                                        | List of added workspace memberships                       |                                                           |
| `addedCount`                                              | *number*                                                  | :heavy_check_mark:                                        | Number of workspace memberships created or updated        | 2                                                         |