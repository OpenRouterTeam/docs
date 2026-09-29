# ProviderOverloadedResponseError

Provider Overloaded - Provider is temporarily overloaded

## Example Usage

```typescript
import { ProviderOverloadedResponseError } from "@openrouter-monorepo/management-sdk-generated/models/errors";

// No examples available for this model
```

## Fields

| Field                                                                                                 | Type                                                                                                  | Required                                                                                              | Description                                                                                           | Example                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `error`                                                                                               | [models.ProviderOverloadedResponseErrorData](../../models/provider-overloaded-response-error-data.md) | :heavy_check_mark:                                                                                    | Error data for ProviderOverloadedResponse                                                             | {<br/>"code": 529,<br/>"message": "Provider returned error"<br/>}                                     |
| `userId`                                                                                              | *string*                                                                                              | :heavy_minus_sign:                                                                                    | N/A                                                                                                   |                                                                                                       |
| `openrouterMetadata`                                                                                  | Record<string, *any*>                                                                                 | :heavy_minus_sign:                                                                                    | N/A                                                                                                   |                                                                                                       |