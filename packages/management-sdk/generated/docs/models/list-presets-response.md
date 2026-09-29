# ListPresetsResponse

A paginated list of presets.

## Example Usage

```typescript
import { ListPresetsResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ListPresetsResponse = {
  data: [
    {
      id: "650e8400-e29b-41d4-a716-446655440001",
      creatorUserId: "user_2dHFtVWx2n56w6HkM0000000000",
      workspaceId: "750e8400-e29b-41d4-a716-446655440002",
      name: "my-preset",
      slug: "my-preset",
      description: null,
      status: "active",
      designatedVersionId: "550e8400-e29b-41d4-a716-446655440000",
      createdAt: "2026-04-20T10:00:00Z",
      updatedAt: "2026-04-20T10:00:00Z",
      statusUpdatedAt: null,
    },
  ],
  totalCount: 1,
};
```

## Fields

| Field                                  | Type                                   | Required                               | Description                            |
| -------------------------------------- | -------------------------------------- | -------------------------------------- | -------------------------------------- |
| `data`                                 | [models.Preset](../models/preset.md)[] | :heavy_check_mark:                     | N/A                                    |
| `totalCount`                           | *number*                               | :heavy_check_mark:                     | N/A                                    |