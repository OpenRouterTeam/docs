# GetAnalyticsMetaData

## Example Usage

```typescript
import { GetAnalyticsMetaData } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: GetAnalyticsMetaData = {
  metrics: [],
  dimensions: [],
  operators: [
    {
      name: "eq",
      valueType: "array",
    },
  ],
  granularities: [
    {
      name: "day",
      displayLabel: "Day",
    },
  ],
};
```

## Fields

| Field                                                              | Type                                                               | Required                                                           | Description                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `metrics`                                                          | [operations.Metric](../../models/operations/metric.md)[]           | :heavy_check_mark:                                                 | N/A                                                                |
| `dimensions`                                                       | [operations.Dimension](../../models/operations/dimension.md)[]     | :heavy_check_mark:                                                 | N/A                                                                |
| `operators`                                                        | [operations.Operator](../../models/operations/operator.md)[]       | :heavy_check_mark:                                                 | N/A                                                                |
| `granularities`                                                    | [operations.Granularity](../../models/operations/granularity.md)[] | :heavy_check_mark:                                                 | N/A                                                                |