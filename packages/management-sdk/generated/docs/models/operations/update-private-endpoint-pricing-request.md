# UpdatePrivateEndpointPricingRequest

## Example Usage

```typescript
import { UpdatePrivateEndpointPricingRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: UpdatePrivateEndpointPricingRequest = {
  id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  body: {
    pricing: {
      prompt: "0.0000025",
      completion: "0.00001",
    },
  },
};
```

## Fields

| Field                                                                                                 | Type                                                                                                  | Required                                                                                              | Description                                                                                           | Example                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `id`                                                                                                  | *string*                                                                                              | :heavy_check_mark:                                                                                    | Stable identifier of the private endpoint.                                                            | 5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11                                                                  |
| `body`                                                                                                | [models.UpdatePrivateEndpointPricingRequest](../../models/update-private-endpoint-pricing-request.md) | :heavy_check_mark:                                                                                    | N/A                                                                                                   |                                                                                                       |