# OrderBy

## Example Usage

```typescript
import { OrderBy } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: OrderBy = {
  field: "request_count",
  direction: "asc",
};
```

## Fields

| Field                                                                                                                                                      | Type                                                                                                                                                       | Required                                                                                                                                                   | Description                                                                                                                                                | Example                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `field`                                                                                                                                                    | *string*                                                                                                                                                   | :heavy_check_mark:                                                                                                                                         | Field to order by: a metric included in `metrics` (or "request_count", which may be ordered by without being requested), a requested dimension, or "date". | request_count                                                                                                                                              |
| `direction`                                                                                                                                                | [operations.Direction](../../models/operations/direction.md)                                                                                               | :heavy_check_mark:                                                                                                                                         | N/A                                                                                                                                                        |                                                                                                                                                            |