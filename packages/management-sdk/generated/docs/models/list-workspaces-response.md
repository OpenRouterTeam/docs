# ListWorkspacesResponse

## Example Usage

```typescript
import { ListWorkspacesResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ListWorkspacesResponse = {
  data: [
    {
      id: "550e8400-e29b-41d4-a716-446655440000",
      defaultGuardrailId: "595d5849-7e86-51fd-a7c0-705c34e4afff",
      name: "Production",
      slug: "production",
      description: "Production environment workspace",
      defaultTextModel: "openai/gpt-4o",
      defaultImageModel: "openai/dall-e-3",
      defaultProviderSort: "price",
      isObservabilityIoLoggingEnabled: false,
      isObservabilityBroadcastEnabled: false,
      isDataDiscountLoggingEnabled: true,
      includeByokInBudgets: false,
      ioLoggingSamplingRate: 1,
      ioLoggingApiKeyIds: null,
      disabledServerTools: null,
      createdAt: "2025-08-24T10:30:00Z",
      updatedAt: "2025-08-24T15:45:00Z",
      createdBy: "user_abc123",
    },
  ],
  totalCount: 1,
};
```

## Fields

| Field                                        | Type                                         | Required                                     | Description                                  | Example                                      |
| -------------------------------------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `data`                                       | [models.Workspace](../models/workspace.md)[] | :heavy_check_mark:                           | List of workspaces                           |                                              |
| `totalCount`                                 | *number*                                     | :heavy_check_mark:                           | Total number of workspaces                   | 5                                            |