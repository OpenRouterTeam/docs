# ObservabilitySentryDestinationConfig

## Example Usage

```typescript
import { ObservabilitySentryDestinationConfig } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ObservabilitySentryDestinationConfig = {
  otlpEndpoint: "<value>",
  dsn: "<value>",
};
```

## Fields

| Field                                                           | Type                                                            | Required                                                        | Description                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `otlpEndpoint`                                                  | *string*                                                        | :heavy_check_mark:                                              | N/A                                                             |
| `dsn`                                                           | *string*                                                        | :heavy_check_mark:                                              | N/A                                                             |
| `headers`                                                       | Record<string, *string*>                                        | :heavy_minus_sign:                                              | Custom HTTP headers to include in requests to this destination. |