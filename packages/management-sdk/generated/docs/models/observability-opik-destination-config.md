# ObservabilityOpikDestinationConfig

## Example Usage

```typescript
import { ObservabilityOpikDestinationConfig } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ObservabilityOpikDestinationConfig = {
  apiKey: "<value>",
  workspace: "<value>",
  projectName: "<value>",
};
```

## Fields

| Field                                                           | Type                                                            | Required                                                        | Description                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `apiKey`                                                        | *string*                                                        | :heavy_check_mark:                                              | N/A                                                             |
| `workspace`                                                     | *string*                                                        | :heavy_check_mark:                                              | N/A                                                             |
| `projectName`                                                   | *string*                                                        | :heavy_check_mark:                                              | N/A                                                             |
| `headers`                                                       | Record<string, *string*>                                        | :heavy_minus_sign:                                              | Custom HTTP headers to include in requests to this destination. |