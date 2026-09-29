# ValidatePrivateEndpointRequest

## Example Usage

```typescript
import { ValidatePrivateEndpointRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ValidatePrivateEndpointRequest = {
  id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  body: {
    workspaceId: "550e8400-e29b-41d4-a716-446655440000",
  },
};
```

## Fields

| Field                                                                                      | Type                                                                                       | Required                                                                                   | Description                                                                                | Example                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `id`                                                                                       | *string*                                                                                   | :heavy_check_mark:                                                                         | Stable identifier of the private endpoint.                                                 | 5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11                                                       |
| `body`                                                                                     | [models.ValidatePrivateEndpointRequest](../../models/validate-private-endpoint-request.md) | :heavy_check_mark:                                                                         | N/A                                                                                        |                                                                                            |