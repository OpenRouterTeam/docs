# BadGatewayResponseError

Bad Gateway - Provider/upstream API failure

## Example Usage

```typescript
import { BadGatewayResponseError } from "@openrouter-monorepo/management-sdk-generated/models/errors";

// No examples available for this model
```

## Fields

| Field                                                                                 | Type                                                                                  | Required                                                                              | Description                                                                           | Example                                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `error`                                                                               | [models.BadGatewayResponseErrorData](../../models/bad-gateway-response-error-data.md) | :heavy_check_mark:                                                                    | Error data for BadGatewayResponse                                                     | {<br/>"code": 502,<br/>"message": "Provider returned error"<br/>}                     |
| `userId`                                                                              | *string*                                                                              | :heavy_minus_sign:                                                                    | N/A                                                                                   |                                                                                       |
| `openrouterMetadata`                                                                  | Record<string, *any*>                                                                 | :heavy_minus_sign:                                                                    | N/A                                                                                   |                                                                                       |