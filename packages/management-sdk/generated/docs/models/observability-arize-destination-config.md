# ObservabilityArizeDestinationConfig

## Example Usage

```typescript
import { ObservabilityArizeDestinationConfig } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ObservabilityArizeDestinationConfig = {
  apiKey: "<value>",
  spaceKey: "<value>",
  modelId: "<id>",
};
```

## Fields

| Field                                                           | Type                                                            | Required                                                        | Description                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `apiKey`                                                        | *string*                                                        | :heavy_check_mark:                                              | N/A                                                             |
| `baseUrl`                                                       | *string*                                                        | :heavy_minus_sign:                                              | N/A                                                             |
| `spaceKey`                                                      | *string*                                                        | :heavy_check_mark:                                              | N/A                                                             |
| `modelId`                                                       | *string*                                                        | :heavy_check_mark:                                              | The name of the tracing project in Arize AX                     |
| `headers`                                                       | Record<string, *string*>                                        | :heavy_minus_sign:                                              | Custom HTTP headers to include in requests to this destination. |