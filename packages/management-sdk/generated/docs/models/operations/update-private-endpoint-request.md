# UpdatePrivateEndpointRequest

## Example Usage

```typescript
import { UpdatePrivateEndpointRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: UpdatePrivateEndpointRequest = {
  id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
  body: {
    baseUrl: "https://contoso.openai.azure.com",
    upstreamModelId: "gpt-4o-prod",
    declaredRegion: "us",
  },
};
```

## Fields

| Field                                                                                  | Type                                                                                   | Required                                                                               | Description                                                                            | Example                                                                                |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`                                                                                   | *string*                                                                               | :heavy_check_mark:                                                                     | Stable identifier of the private endpoint.                                             | 5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11                                                   |
| `body`                                                                                 | [models.UpdatePrivateEndpointRequest](../../models/update-private-endpoint-request.md) | :heavy_check_mark:                                                                     | N/A                                                                                    |                                                                                        |