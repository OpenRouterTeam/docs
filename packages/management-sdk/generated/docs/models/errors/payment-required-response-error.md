# PaymentRequiredResponseError

Payment Required - Insufficient credits or quota to complete request

## Example Usage

```typescript
import { PaymentRequiredResponseError } from "@openrouter-monorepo/management-sdk-generated/models/errors";

// No examples available for this model
```

## Fields

| Field                                                                                            | Type                                                                                             | Required                                                                                         | Description                                                                                      | Example                                                                                          |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `error`                                                                                          | [models.PaymentRequiredResponseErrorData](../../models/payment-required-response-error-data.md)  | :heavy_check_mark:                                                                               | Error data for PaymentRequiredResponse                                                           | {<br/>"code": 402,<br/>"message": "Insufficient credits. Add more using https://openrouter.ai/credits"<br/>} |
| `userId`                                                                                         | *string*                                                                                         | :heavy_minus_sign:                                                                               | N/A                                                                                              |                                                                                                  |
| `openrouterMetadata`                                                                             | Record<string, *any*>                                                                            | :heavy_minus_sign:                                                                               | N/A                                                                                              |                                                                                                  |