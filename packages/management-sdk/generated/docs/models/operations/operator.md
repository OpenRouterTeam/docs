# Operator

## Example Usage

```typescript
import { Operator } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: Operator = {
  name: "eq",
  valueType: "array",
};
```

## Fields

| Field                                                               | Type                                                                | Required                                                            | Description                                                         | Example                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `name`                                                              | [operations.OperatorName](../../models/operations/operator-name.md) | :heavy_check_mark:                                                  | Operator identifier used in filter definitions                      | eq                                                                  |
| `valueType`                                                         | [operations.ValueType](../../models/operations/value-type.md)       | :heavy_check_mark:                                                  | Whether the operator expects a single value or an array             |                                                                     |