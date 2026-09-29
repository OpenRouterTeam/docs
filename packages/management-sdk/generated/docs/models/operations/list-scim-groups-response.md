# ListScimGroupsResponse

## Example Usage

```typescript
import { ListScimGroupsResponse } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListScimGroupsResponse = {
  result: {
    data: [
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        organizationId: "org_123456",
        externalId: "group-external-id",
        displayName: "Engineering",
        createdAt: "2025-08-24T10:30:00Z",
        updatedAt: "2025-08-24T10:30:00Z",
      },
    ],
    totalCount: 39923,
  },
};
```

## Fields

| Field                                                                      | Type                                                                       | Required                                                                   | Description                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `result`                                                                   | [models.ListScimGroupsResponse](../../models/list-scim-groups-response.md) | :heavy_check_mark:                                                         | N/A                                                                        |