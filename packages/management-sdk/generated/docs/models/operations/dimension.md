# Dimension

## Example Usage

```typescript
import { Dimension } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: Dimension = {
  name: "model",
  displayLabel: "Model",
};
```

## Fields

| Field                                       | Type                                        | Required                                    | Description                                 | Example                                     |
| ------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| `name`                                      | *string*                                    | :heavy_check_mark:                          | Dimension identifier used in query requests | model                                       |
| `displayLabel`                              | *string*                                    | :heavy_check_mark:                          | Human-readable label                        | Model                                       |