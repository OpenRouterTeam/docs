# UpdatePrivateEndpointPricingRequest

## Example Usage

```typescript
import { UpdatePrivateEndpointPricingRequest } from "@openrouter-monorepo/management-sdk-generated/models";

let value: UpdatePrivateEndpointPricingRequest = {
  pricing: {
    prompt: "0.0000025",
    completion: "0.00001",
  },
};
```

## Fields

| Field                                                                     | Type                                                                      | Required                                                                  | Description                                                               | Example                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pricing`                                                                 | [models.PrivateEndpointPricing](../models/private-endpoint-pricing.md)    | :heavy_check_mark:                                                        | Negotiated per-token rates reported for requests routed to this endpoint. | {<br/>"prompt": "0.0000025",<br/>"completion": "0.00001"<br/>}            |