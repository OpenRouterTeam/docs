# CreateScimSyncJobResponse

## Example Usage

```typescript
import { CreateScimSyncJobResponse } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: CreateScimSyncJobResponse = {
  headers: {},
  result: {
    data: {
      id: "aab19a1f-6dd8-4a86-82af-5c77a632bf7c",
      status: "queued",
      syncedGroups: null,
      deletedGroups: 507760,
      errorMessage: "<value>",
      createdAt: "1713784034754",
      startedAt: "<value>",
      finishedAt: "<value>",
    },
  },
};
```

## Fields

| Field                                                                             | Type                                                                              | Required                                                                          | Description                                                                       |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `headers`                                                                         | Record<string, *string*[]>                                                        | :heavy_check_mark:                                                                | N/A                                                                               |
| `result`                                                                          | [models.CreateScimSyncJobResponse](../../models/create-scim-sync-job-response.md) | :heavy_check_mark:                                                                | N/A                                                                               |