# ScimGroupMapping

## Example Usage

```typescript
import { ScimGroupMapping } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ScimGroupMapping = {
  id: "770e8400-e29b-41d4-a716-446655440000",
  organizationId: "org_123456",
  scimGroupId: "550e8400-e29b-41d4-a716-446655440000",
  workspaceId: "660e8400-e29b-41d4-a716-446655440000",
  role: "member",
  createdAt: "2025-08-24T10:30:00Z",
  updatedAt: "2025-08-24T10:30:00Z",
};
```

## Fields

| Field                                                               | Type                                                                | Required                                                            | Description                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `id`                                                                | *string*                                                            | :heavy_check_mark:                                                  | N/A                                                                 |
| `organizationId`                                                    | *string*                                                            | :heavy_check_mark:                                                  | N/A                                                                 |
| `scimGroupId`                                                       | *string*                                                            | :heavy_check_mark:                                                  | N/A                                                                 |
| `workspaceId`                                                       | *string*                                                            | :heavy_check_mark:                                                  | N/A                                                                 |
| `role`                                                              | [models.ScimGroupMappingRole](../models/scim-group-mapping-role.md) | :heavy_check_mark:                                                  | N/A                                                                 |
| `createdAt`                                                         | *string*                                                            | :heavy_check_mark:                                                  | N/A                                                                 |
| `updatedAt`                                                         | *string*                                                            | :heavy_check_mark:                                                  | N/A                                                                 |