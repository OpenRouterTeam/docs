# ListGuardrailsRequest

## Example Usage

```typescript
import { ListGuardrailsRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListGuardrailsRequest = {
  workspaceId: "0df9e665-d932-5740-b2c7-b52af166bc11",
};
```

## Fields

| Field                                                                                            | Type                                                                                             | Required                                                                                         | Description                                                                                      | Example                                                                                          |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `offset`                                                                                         | *number*                                                                                         | :heavy_minus_sign:                                                                               | Number of records to skip for pagination                                                         | 0                                                                                                |
| `limit`                                                                                          | *number*                                                                                         | :heavy_minus_sign:                                                                               | Maximum number of records to return (max 100)                                                    | 50                                                                                               |
| `workspaceId`                                                                                    | *string*                                                                                         | :heavy_minus_sign:                                                                               | Filter guardrails by workspace ID. By default, guardrails in the default workspace are returned. | 0df9e665-d932-5740-b2c7-b52af166bc11                                                             |