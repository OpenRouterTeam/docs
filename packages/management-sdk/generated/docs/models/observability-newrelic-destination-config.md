# ObservabilityNewrelicDestinationConfig

## Example Usage

```typescript
import { ObservabilityNewrelicDestinationConfig } from "@openrouter-monorepo/management-sdk-generated/models";

let value: ObservabilityNewrelicDestinationConfig = {
  licenseKey: "<value>",
};
```

## Fields

| Field                                                           | Type                                                            | Required                                                        | Description                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `licenseKey`                                                    | *string*                                                        | :heavy_check_mark:                                              | N/A                                                             |
| `region`                                                        | [models.Region](../models/region.md)                            | :heavy_minus_sign:                                              | N/A                                                             |
| `headers`                                                       | Record<string, *string*>                                        | :heavy_minus_sign:                                              | Custom HTTP headers to include in requests to this destination. |