# UnauthorizedResponseError

Unauthorized - Authentication required or invalid credentials

## Example Usage

```typescript
import { UnauthorizedResponseError } from "@openrouter-monorepo/management-sdk-generated/models/errors";

// No examples available for this model
```

## Fields

| Field                                                                                    | Type                                                                                     | Required                                                                                 | Description                                                                              | Example                                                                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `error`                                                                                  | [models.UnauthorizedResponseErrorData](../../models/unauthorized-response-error-data.md) | :heavy_check_mark:                                                                       | Error data for UnauthorizedResponse                                                      | {<br/>"code": 401,<br/>"message": "Missing Authentication header"<br/>}                  |
| `userId`                                                                                 | *string*                                                                                 | :heavy_minus_sign:                                                                       | N/A                                                                                      |                                                                                          |
| `openrouterMetadata`                                                                     | Record<string, *any*>                                                                    | :heavy_minus_sign:                                                                       | N/A                                                                                      |                                                                                          |