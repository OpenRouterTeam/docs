# UnprocessableEntityResponseError

Unprocessable Entity - Semantic validation failure

## Example Usage

```typescript
import { UnprocessableEntityResponseError } from "@openrouter-monorepo/management-sdk-generated/models/errors";

// No examples available for this model
```

## Fields

| Field                                                                                                   | Type                                                                                                    | Required                                                                                                | Description                                                                                             | Example                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `error`                                                                                                 | [models.UnprocessableEntityResponseErrorData](../../models/unprocessable-entity-response-error-data.md) | :heavy_check_mark:                                                                                      | Error data for UnprocessableEntityResponse                                                              | {<br/>"code": 422,<br/>"message": "Invalid argument"<br/>}                                              |
| `userId`                                                                                                | *string*                                                                                                | :heavy_minus_sign:                                                                                      | N/A                                                                                                     |                                                                                                         |
| `openrouterMetadata`                                                                                    | Record<string, *any*>                                                                                   | :heavy_minus_sign:                                                                                      | N/A                                                                                                     |                                                                                                         |