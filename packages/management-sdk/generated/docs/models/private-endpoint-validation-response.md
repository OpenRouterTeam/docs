# PrivateEndpointValidationResponse

## Example Usage

```typescript
import { PrivateEndpointValidationResponse } from "@openrouter-monorepo/management-sdk-generated/models";

let value: PrivateEndpointValidationResponse = {
  data: {
    passed: true,
    checks: [
      {
        name: "auth_ok",
        passed: true,
      },
    ],
  },
};
```

## Fields

| Field                                                                        | Type                                                                         | Required                                                                     | Description                                                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `data`                                                                       | [models.PrivateEndpointValidation](../models/private-endpoint-validation.md) | :heavy_check_mark:                                                           | N/A                                                                          |