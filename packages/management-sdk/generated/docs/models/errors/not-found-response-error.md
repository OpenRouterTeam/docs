# NotFoundResponseError

Not Found - Resource does not exist

## Example Usage

```typescript
import { NotFoundResponseError } from "@openrouter-monorepo/management-sdk-generated/models/errors";

// No examples available for this model
```

## Fields

| Field                                                                             | Type                                                                              | Required                                                                          | Description                                                                       | Example                                                                           |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `error`                                                                           | [models.NotFoundResponseErrorData](../../models/not-found-response-error-data.md) | :heavy_check_mark:                                                                | Error data for NotFoundResponse                                                   | {<br/>"code": 404,<br/>"message": "Resource not found"<br/>}                      |
| `userId`                                                                          | *string*                                                                          | :heavy_minus_sign:                                                                | N/A                                                                               |                                                                                   |
| `openrouterMetadata`                                                              | Record<string, *any*>                                                             | :heavy_minus_sign:                                                                | N/A                                                                               |                                                                                   |