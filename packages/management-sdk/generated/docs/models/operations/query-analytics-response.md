# QueryAnalyticsResponse

Analytics query results

## Example Usage

```typescript
import { QueryAnalyticsResponse } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: QueryAnalyticsResponse = {
  data: {
    data: [
      {},
    ],
    metadata: {
      queryTimeMs: 928.75,
      rowCount: 203673,
      truncated: false,
    },
  },
};
```

## Fields

| Field                                                                              | Type                                                                               | Required                                                                           | Description                                                                        |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `data`                                                                             | [operations.QueryAnalyticsData2](../../models/operations/query-analytics-data2.md) | :heavy_check_mark:                                                                 | N/A                                                                                |