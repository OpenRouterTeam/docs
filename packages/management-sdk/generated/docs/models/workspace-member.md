# WorkspaceMember

## Example Usage

```typescript
import { WorkspaceMember } from "@openrouter-monorepo/management-sdk-generated/models";

let value: WorkspaceMember = {
  id: "660e8400-e29b-41d4-a716-446655440000",
  workspaceId: "550e8400-e29b-41d4-a716-446655440000",
  userId: "user_abc123",
  role: "member",
  createdAt: "2025-08-24T10:30:00Z",
};
```

## Fields

| Field                                                            | Type                                                             | Required                                                         | Description                                                      | Example                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `id`                                                             | *string*                                                         | :heavy_check_mark:                                               | Unique identifier for the workspace membership                   | 660e8400-e29b-41d4-a716-446655440000                             |
| `workspaceId`                                                    | *string*                                                         | :heavy_check_mark:                                               | ID of the workspace                                              | 550e8400-e29b-41d4-a716-446655440000                             |
| `userId`                                                         | *string*                                                         | :heavy_check_mark:                                               | Clerk user ID of the member                                      | user_abc123                                                      |
| `role`                                                           | [models.WorkspaceMemberRole](../models/workspace-member-role.md) | :heavy_check_mark:                                               | Role of the member in the workspace                              | member                                                           |
| `createdAt`                                                      | *string*                                                         | :heavy_check_mark:                                               | ISO 8601 timestamp of when the membership was created            | 2025-08-24 10:30:00 +0000 UTC                                    |