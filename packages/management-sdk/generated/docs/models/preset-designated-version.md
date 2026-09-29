# PresetDesignatedVersion

A specific version of a preset, containing config and optional system prompt.

## Example Usage

```typescript
import { PresetDesignatedVersion } from "@openrouter-monorepo/management-sdk-generated/models";

let value: PresetDesignatedVersion = {
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
};
```

## Fields

| Field                 | Type                  | Required              | Description           |
| --------------------- | --------------------- | --------------------- | --------------------- |
| `id`                  | *string*              | :heavy_check_mark:    | N/A                   |
| `presetId`            | *string*              | :heavy_check_mark:    | N/A                   |
| `creatorId`           | *string*              | :heavy_check_mark:    | N/A                   |
| `version`             | *number*              | :heavy_check_mark:    | N/A                   |
| `systemPrompt`        | *string*              | :heavy_check_mark:    | N/A                   |
| `config`              | Record<string, *any*> | :heavy_check_mark:    | N/A                   |
| `createdAt`           | *string*              | :heavy_check_mark:    | N/A                   |
| `updatedAt`           | *string*              | :heavy_check_mark:    | N/A                   |