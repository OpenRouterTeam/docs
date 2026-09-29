# ListScimGroupMappingsResponse

## Example Usage

```typescript
import { ListScimGroupMappingsResponse } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListScimGroupMappingsResponse = {
  result: {
    data: [
      {
        id: "770e8400-e29b-41d4-a716-446655440000",
        organizationId: "org_123456",
        scimGroupId: "550e8400-e29b-41d4-a716-446655440000",
        workspaceId: "660e8400-e29b-41d4-a716-446655440000",
        role: "member",
        createdAt: "2025-08-24T10:30:00Z",
        updatedAt: "2025-08-24T10:30:00Z",
      },
    ],
    totalCount: 318254,
  },
};
```

## Fields

| Field                                                                                     | Type                                                                                      | Required                                                                                  | Description                                                                               |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `result`                                                                                  | [models.ListScimGroupMappingsResponse](../../models/list-scim-group-mappings-response.md) | :heavy_check_mark:                                                                        | N/A                                                                                       |