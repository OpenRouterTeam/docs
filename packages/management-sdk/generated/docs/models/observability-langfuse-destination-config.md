# ObservabilityLangfuseDestinationConfig

## Example Usage

```typescript
import { ObservabilityLangfuseDestinationConfig } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ObservabilityLangfuseDestinationConfig = {
  secretKey: "<value>",
  publicKey: "<value>",
};
```

## Fields

| Field                                                           | Type                                                            | Required                                                        | Description                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `secretKey`                                                     | *string*                                                        | :heavy_check_mark:                                              | N/A                                                             |
| `publicKey`                                                     | *string*                                                        | :heavy_check_mark:                                              | N/A                                                             |
| `baseUrl`                                                       | *string*                                                        | :heavy_minus_sign:                                              | N/A                                                             |
| `headers`                                                       | Record<string, *string*>                                        | :heavy_minus_sign:                                              | Custom HTTP headers to include in requests to this destination. |