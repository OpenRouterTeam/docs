# EdgeNetworkTimeoutResponseError

Infrastructure Timeout - Provider request timed out at edge network

## Example Usage

```typescript
import { EdgeNetworkTimeoutResponseError } from "@openrouter-monorepo/management-sdk-generated/models/errors";

// No examples available for this model
```

## Fields

| Field                                                                                                  | Type                                                                                                   | Required                                                                                               | Description                                                                                            | Example                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `error`                                                                                                | [models.EdgeNetworkTimeoutResponseErrorData](../../models/edge-network-timeout-response-error-data.md) | :heavy_check_mark:                                                                                     | Error data for EdgeNetworkTimeoutResponse                                                              | {<br/>"code": 524,<br/>"message": "Request timed out. Please try again later."<br/>}                   |
| `userId`                                                                                               | *string*                                                                                               | :heavy_minus_sign:                                                                                     | N/A                                                                                                    |                                                                                                        |
| `openrouterMetadata`                                                                                   | Record<string, *any*>                                                                                  | :heavy_minus_sign:                                                                                     | N/A                                                                                                    |                                                                                                        |