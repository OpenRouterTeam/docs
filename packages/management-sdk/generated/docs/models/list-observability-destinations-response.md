# ListObservabilityDestinationsResponse

## Example Usage

```typescript
import { ListObservabilityDestinationsResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ListObservabilityDestinationsResponse = {
  data: [
    {
      id: "99999999-aaaa-bbbb-cccc-dddddddddddd",
      workspaceId: "550e8400-e29b-41d4-a716-446655440000",
      regions: [
        "global",
      ],
      name: "Production Langfuse",
      enabled: true,
      privacyMode: false,
      broadcastGenerationCost: false,
      broadcastGenerationIdentity: false,
      broadcastGenerationRequestContext: false,
      samplingRate: 1,
      apiKeyHashes: null,
      filterRules: null,
      createdAt: "2025-08-24T10:30:00Z",
      updatedAt: "2025-08-24T15:45:00Z",
      type: "langfuse",
      config: {
        secretKey: "sk-l...AbCd",
        publicKey: "pk-l...EfGh",
        baseUrl: "https://us.cloud.langfuse.com",
      },
    },
  ],
  totalCount: 1,
};
```

## Fields

| Field                                              | Type                                               | Required                                           | Description                                        | Example                                            |
| -------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| `data`                                             | *models.ObservabilityDestination*[]                | :heavy_check_mark:                                 | List of observability destinations.                |                                                    |
| `totalCount`                                       | *number*                                           | :heavy_check_mark:                                 | Total number of destinations matching the filters. | 1                                                  |