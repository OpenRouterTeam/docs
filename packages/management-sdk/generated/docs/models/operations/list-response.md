# ListResponse

List of API keys

## Example Usage

```typescript
import { ListResponse } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListResponse = {
  data: [
    {
      hash: "f01d52606dc8f0a8303a7b5cc3fa07109c2e346cec7c0a16b40de462992ce943",
      name: "My Production Key",
      label: "Production API Key",
      disabled: false,
      limit: 100,
      limitRemaining: 74.5,
      limitReset: "monthly",
      includeByokInLimit: false,
      usage: 25.5,
      usageDaily: 25.5,
      usageWeekly: 25.5,
      usageMonthly: 25.5,
      byokUsage: 17.38,
      byokUsageDaily: 17.38,
      byokUsageWeekly: 17.38,
      byokUsageMonthly: 17.38,
      createdAt: "2025-08-24T10:30:00Z",
      updatedAt: "2025-08-24T15:45:00Z",
      expiresAt: new Date("2027-12-31T23:59:59Z"),
      externalUser: null,
      creatorUserId: "user_2dHFtVWx2n56w6HkM0000000000",
      workspaceId: "0df9e665-d932-5740-b2c7-b52af166bc11",
    },
  ],
};
```

## Fields

| Field                                                         | Type                                                          | Required                                                      | Description                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| `data`                                                        | [operations.ListData](../../models/operations/list-data.md)[] | :heavy_check_mark:                                            | List of API keys                                              |