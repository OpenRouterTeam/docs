# Metric

## Example Usage

```typescript
import { Metric } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: Metric = {
  name: "request_count",
  displayLabel: "Request Count",
  isRate: false,
  displayFormat: "number",
};
```

## Fields

| Field                                                                                                                         | Type                                                                                                                          | Required                                                                                                                      | Description                                                                                                                   | Example                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `name`                                                                                                                        | *string*                                                                                                                      | :heavy_check_mark:                                                                                                            | Metric identifier used in query requests                                                                                      | request_count                                                                                                                 |
| `displayLabel`                                                                                                                | *string*                                                                                                                      | :heavy_check_mark:                                                                                                            | Human-readable label                                                                                                          | Request Count                                                                                                                 |
| `isRate`                                                                                                                      | *boolean*                                                                                                                     | :heavy_check_mark:                                                                                                            | Whether this metric is a rate/ratio (averaged, not summed)                                                                    |                                                                                                                               |
| `displayFormat`                                                                                                               | [operations.DisplayFormat](../../models/operations/display-format.md)                                                         | :heavy_check_mark:                                                                                                            | How this metric value should be formatted for display (e.g. percent → multiply by 100 and append %, currency → prefix with $) | number                                                                                                                        |