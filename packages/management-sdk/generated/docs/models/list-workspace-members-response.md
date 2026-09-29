# ListWorkspaceMembersResponse

## Example Usage

```typescript
import { ListWorkspaceMembersResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ListWorkspaceMembersResponse = {
  data: [
    {
      id: "660e8400-e29b-41d4-a716-446655440000",
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      userId: "user_abc123",
      role: "member",
      createdAt: "2025-08-24T10:30:00Z",
    },
  ],
  totalCount: 1,
};
```

## Fields

| Field                                                     | Type                                                      | Required                                                  | Description                                               | Example                                                   |
| --------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `data`                                                    | [models.WorkspaceMember](../models/workspace-member.md)[] | :heavy_check_mark:                                        | List of workspace members                                 |                                                           |
| `totalCount`                                              | *number*                                                  | :heavy_check_mark:                                        | Total number of members in the workspace                  | 5                                                         |