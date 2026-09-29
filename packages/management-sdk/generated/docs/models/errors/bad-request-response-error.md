# BadRequestResponseError

Bad Request - Invalid request parameters or malformed input

## Example Usage

```typescript
import { BadRequestResponseError } from "@openrouter-monorepo/management-sdk-generated/models/errors";

// No examples available for this model
```

## Fields

| Field                                                                                 | Type                                                                                  | Required                                                                              | Description                                                                           | Example                                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `error`                                                                               | [models.BadRequestResponseErrorData](../../models/bad-request-response-error-data.md) | :heavy_check_mark:                                                                    | Error data for BadRequestResponse                                                     | {<br/>"code": 400,<br/>"message": "Invalid request parameters"<br/>}                  |
| `userId`                                                                              | *string*                                                                              | :heavy_minus_sign:                                                                    | N/A                                                                                   |                                                                                       |
| `openrouterMetadata`                                                                  | Record<string, *any*>                                                                 | :heavy_minus_sign:                                                                    | N/A                                                                                   |                                                                                       |