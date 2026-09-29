# ListObservabilityDestinationsRequest

## Example Usage

```typescript
import { ListObservabilityDestinationsRequest } from "@openrouter-monorepo/management-sdk-generated/models/operations";

let value: ListObservabilityDestinationsRequest = {
  workspaceId: "550e8400-e29b-41d4-a716-446655440000",
};
```

## Fields

| Field                                                                                         | Type                                                                                          | Required                                                                                      | Description                                                                                   | Example                                                                                       |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `offset`                                                                                      | *number*                                                                                      | :heavy_minus_sign:                                                                            | Number of records to skip for pagination                                                      | 0                                                                                             |
| `limit`                                                                                       | *number*                                                                                      | :heavy_minus_sign:                                                                            | Maximum number of records to return (max 100)                                                 | 50                                                                                            |
| `workspaceId`                                                                                 | *string*                                                                                      | :heavy_minus_sign:                                                                            | Optional workspace ID to filter by. Defaults to the authenticated entity's default workspace. | 550e8400-e29b-41d4-a716-446655440000                                                          |