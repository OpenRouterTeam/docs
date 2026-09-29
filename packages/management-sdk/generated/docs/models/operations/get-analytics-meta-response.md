# GetAnalyticsMetaResponse

Returns analytics query metadata

## Example Usage

```typescript
import { GetAnalyticsMetaResponse } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: GetAnalyticsMetaResponse = {
  data: {
    metrics: [],
    dimensions: [
      {
        name: "model",
        displayLabel: "Model",
      },
    ],
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
  },
};
```

## Fields

| Field                                                                                 | Type                                                                                  | Required                                                                              | Description                                                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `data`                                                                                | [operations.GetAnalyticsMetaData](../../models/operations/get-analytics-meta-data.md) | :heavy_check_mark:                                                                    | N/A                                                                                   |