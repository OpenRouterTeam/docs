# Granularity

## Example Usage

```typescript
import { Granularity } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: Granularity = {
  name: "day",
  displayLabel: "Day",
};
```

## Fields

| Field                                                                     | Type                                                                      | Required                                                                  | Description                                                               | Example                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `name`                                                                    | [operations.GranularityName](../../models/operations/granularity-name.md) | :heavy_check_mark:                                                        | Granularity identifier                                                    | day                                                                       |
| `displayLabel`                                                            | *string*                                                                  | :heavy_check_mark:                                                        | Human-readable label                                                      | Day                                                                       |