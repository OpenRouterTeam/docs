# PrivateEndpointPricing

Negotiated per-token rates reported for requests routed to this endpoint.

## Example Usage

```typescript
import { PrivateEndpointPricing } from "@openrouter-monorepo/management-sdk-generated/models";

let value: PrivateEndpointPricing = {
  prompt: "0.0000025",
  completion: "0.00001",
};
```

## Fields

| Field                                          | Type                                           | Required                                       | Description                                    | Example                                        |
| ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `prompt`                                       | *string*                                       | :heavy_check_mark:                             | USD per prompt token, as a decimal string.     | 0.0000025                                      |
| `completion`                                   | *string*                                       | :heavy_check_mark:                             | USD per completion token, as a decimal string. | 0.00001                                        |