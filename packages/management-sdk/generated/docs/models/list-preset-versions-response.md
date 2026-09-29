# ListPresetVersionsResponse

A paginated list of preset versions.

## Example Usage

```typescript
import { ListPresetVersionsResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ListPresetVersionsResponse = {
  data: [
    {
      id: "550e8400-e29b-41d4-a716-446655440000",
      presetId: "650e8400-e29b-41d4-a716-446655440001",
      creatorId: "user_2dHFtVWx2n56w6HkM0000000000",
      version: 1,
      systemPrompt: "You are a helpful assistant.",
      config: {
        "model": "openai/gpt-4o",
        "temperature": 0.7,
      },
      createdAt: "2026-04-20T10:00:00Z",
      updatedAt: "2026-04-20T10:00:00Z",
    },
  ],
  totalCount: 1,
};
```

## Fields

| Field                                                                      | Type                                                                       | Required                                                                   | Description                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `data`                                                                     | [models.PresetDesignatedVersion](../models/preset-designated-version.md)[] | :heavy_check_mark:                                                         | N/A                                                                        |
| `totalCount`                                                               | *number*                                                                   | :heavy_check_mark:                                                         | N/A                                                                        |