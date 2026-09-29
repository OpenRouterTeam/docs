# UpdateObservabilityDestinationRequest

## Example Usage

```typescript
import { UpdateObservabilityDestinationRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: UpdateObservabilityDestinationRequest = {
  id: "99999999-aaaa-bbbb-cccc-dddddddddddd",
};
```

## Fields

| Field                                                                                                    | Type                                                                                                     | Required                                                                                                 | Description                                                                                              | Example                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `id`                                                                                                     | *string*                                                                                                 | :heavy_check_mark:                                                                                       | The destination ID (UUID).                                                                               | 99999999-aaaa-bbbb-cccc-dddddddddddd                                                                     |
| `body`                                                                                                   | [models.UpdateObservabilityDestinationRequest](../../models/update-observability-destination-request.md) | :heavy_minus_sign:                                                                                       | N/A                                                                                                      | {<br/>"name": "Updated Langfuse",<br/>"enabled": false<br/>}                                             |