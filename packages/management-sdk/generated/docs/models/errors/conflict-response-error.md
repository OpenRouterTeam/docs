# ConflictResponseError

Conflict - Resource conflict or concurrent modification

## Example Usage

```typescript
import { ConflictResponseError } from "@openrouter-monorepo/management-sdk-generated/models/errors";

// No examples available for this model
```

## Fields

| Field                                                                            | Type                                                                             | Required                                                                         | Description                                                                      | Example                                                                          |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `error`                                                                          | [models.ConflictResponseErrorData](../../models/conflict-response-error-data.md) | :heavy_check_mark:                                                               | Error data for ConflictResponse                                                  | {<br/>"code": 409,<br/>"message": "Resource conflict. Please try again later."<br/>} |
| `userId`                                                                         | *string*                                                                         | :heavy_minus_sign:                                                               | N/A                                                                              |                                                                                  |
| `openrouterMetadata`                                                             | Record<string, *any*>                                                            | :heavy_minus_sign:                                                               | N/A                                                                              |                                                                                  |