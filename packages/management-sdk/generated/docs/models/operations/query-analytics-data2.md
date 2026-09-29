# QueryAnalyticsData2

## Example Usage

```typescript
import { QueryAnalyticsData2 } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: QueryAnalyticsData2 = {
  data: [
    {},
  ],
  metadata: {
    queryTimeMs: 928.75,
    rowCount: 203673,
    truncated: false,
  },
};
```

## Fields

| Field                                                                                                                                                                                | Type                                                                                                                                                                                 | Required                                                                                                                                                                             | Description                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data`                                                                                                                                                                               | [operations.QueryAnalyticsData1](../../models/operations/query-analytics-data1.md)[]                                                                                                 | :heavy_check_mark:                                                                                                                                                                   | N/A                                                                                                                                                                                  |
| `metadata`                                                                                                                                                                           | [operations.Metadata](../../models/operations/metadata.md)                                                                                                                           | :heavy_check_mark:                                                                                                                                                                   | N/A                                                                                                                                                                                  |
| `cachedAt`                                                                                                                                                                           | *number*                                                                                                                                                                             | :heavy_minus_sign:                                                                                                                                                                   | N/A                                                                                                                                                                                  |
| `warnings`                                                                                                                                                                           | *string*[]                                                                                                                                                                           | :heavy_minus_sign:                                                                                                                                                                   | Warnings about filter resolution issues (e.g. unresolvable api_key_id hashes). The query still runs normally; these inform the caller that some filter values could not be resolved. |