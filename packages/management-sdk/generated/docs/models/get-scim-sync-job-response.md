# GetScimSyncJobResponse

## Example Usage

```typescript
import { GetScimSyncJobResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: GetScimSyncJobResponse = {
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
};
```

## Fields

| Field                                            | Type                                             | Required                                         | Description                                      |
| ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------ |
| `data`                                           | [models.ScimSyncJob](../models/scim-sync-job.md) | :heavy_check_mark:                               | N/A                                              |