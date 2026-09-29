# ScimSyncJob

## Example Usage

```typescript
import { ScimSyncJob } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ScimSyncJob = {
  id: "603a1558-0601-4fb0-9086-88e71e1a16bb",
  status: "succeeded",
  syncedGroups: 963802,
  deletedGroups: 203827,
  errorMessage: "<value>",
  createdAt: "1706674374894",
  startedAt: "<value>",
  finishedAt: "<value>",
};
```

## Fields

| Field                                                                  | Type                                                                   | Required                                                               | Description                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `id`                                                                   | *string*                                                               | :heavy_check_mark:                                                     | Unique identifier for the sync job.                                    |
| `status`                                                               | [models.Status](../models/status.md)                                   | :heavy_check_mark:                                                     | Current status of the sync job: queued, running, succeeded, or failed. |
| `syncedGroups`                                                         | *number*                                                               | :heavy_check_mark:                                                     | Number of groups synchronized, when the job completed successfully.    |
| `deletedGroups`                                                        | *number*                                                               | :heavy_check_mark:                                                     | Number of groups deleted, when the job completed successfully.         |
| `errorMessage`                                                         | *string*                                                               | :heavy_check_mark:                                                     | Stable error message when the job failed.                              |
| `createdAt`                                                            | *string*                                                               | :heavy_check_mark:                                                     | Time when the sync job was created.                                    |
| `startedAt`                                                            | *string*                                                               | :heavy_check_mark:                                                     | Time when synchronization started.                                     |
| `finishedAt`                                                           | *string*                                                               | :heavy_check_mark:                                                     | Time when synchronization finished.                                    |