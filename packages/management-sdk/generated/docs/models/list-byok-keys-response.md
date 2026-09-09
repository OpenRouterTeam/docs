# ListBYOKKeysResponse

## Example Usage

```typescript
import { ListBYOKKeysResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ListBYOKKeysResponse = {
  data: [
    {
      id: "11111111-2222-3333-4444-555555555555",
      provider: "openai",
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      label: "sk-...AbCd",
      name: "Production OpenAI Key",
      disabled: false,
      isFallback: false,
      isRequired: false,
      isByokOnly: false,
      allowedModels: null,
      allowedApiKeyHashes: null,
      allowedUserIds: null,
      sortOrder: 0,
      createdAt: "2025-08-24T10:30:00Z",
    },
  ],
  totalCount: 1,
};
```

## Fields

| Field                                                  | Type                                                   | Required                                               | Description                                            | Example                                                |
| ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ |
| `data`                                                 | [models.BYOKKey](../models/byok-key.md)[]              | :heavy_check_mark:                                     | List of BYOK credentials.                              |                                                        |
| `totalCount`                                           | *number*                                               | :heavy_check_mark:                                     | Total number of BYOK credentials matching the filters. | 1                                                      |