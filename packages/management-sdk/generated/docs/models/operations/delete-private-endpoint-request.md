# DeletePrivateEndpointRequest

## Example Usage

```typescript
import { DeletePrivateEndpointRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: DeletePrivateEndpointRequest = {
  id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
};
```

## Fields

| Field                                                                         | Type                                                                          | Required                                                                      | Description                                                                   | Example                                                                       |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `id`                                                                          | *string*                                                                      | :heavy_check_mark:                                                            | Stable identifier of the private endpoint.                                    | 5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11                                          |
| `draftOnly`                                                                   | [operations.DraftOnly](../../models/operations/draft-only.md)                 | :heavy_minus_sign:                                                            | When `true`, only delete the endpoint if it is still a draft (409 otherwise). |                                                                               |