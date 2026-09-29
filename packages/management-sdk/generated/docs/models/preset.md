# Preset

A preset without version details.

## Example Usage

```typescript
import { Preset } from "@openrouter-monorepo/management-sdk-generated/models";

let value: Preset = {
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
};
```

## Fields

| Field                                             | Type                                              | Required                                          | Description                                       | Example                                           |
| ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| `id`                                              | *string*                                          | :heavy_check_mark:                                | N/A                                               |                                                   |
| `creatorUserId`                                   | *string*                                          | :heavy_check_mark:                                | N/A                                               |                                                   |
| `workspaceId`                                     | *string*                                          | :heavy_check_mark:                                | N/A                                               |                                                   |
| `name`                                            | *string*                                          | :heavy_check_mark:                                | N/A                                               |                                                   |
| `slug`                                            | *string*                                          | :heavy_check_mark:                                | N/A                                               |                                                   |
| `description`                                     | *string*                                          | :heavy_check_mark:                                | N/A                                               |                                                   |
| `status`                                          | [models.PresetStatus](../models/preset-status.md) | :heavy_check_mark:                                | The status of a preset.                           | active                                            |
| `designatedVersionId`                             | *string*                                          | :heavy_check_mark:                                | N/A                                               |                                                   |
| `createdAt`                                       | *string*                                          | :heavy_check_mark:                                | N/A                                               |                                                   |
| `updatedAt`                                       | *string*                                          | :heavy_check_mark:                                | N/A                                               |                                                   |
| `statusUpdatedAt`                                 | *string*                                          | :heavy_check_mark:                                | N/A                                               |                                                   |