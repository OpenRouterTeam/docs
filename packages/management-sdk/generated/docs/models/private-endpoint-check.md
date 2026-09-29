# PrivateEndpointCheck

## Example Usage

```typescript
import { PrivateEndpointCheck } from "@openrouter-monorepo/management-sdk-generated/models";

let value: PrivateEndpointCheck = {
  name: "auth_ok",
  passed: true,
};
```

## Fields

| Field                                                                           | Type                                                                            | Required                                                                        | Description                                                                     | Example                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `name`                                                                          | *string*                                                                        | :heavy_check_mark:                                                              | Check name.                                                                     | auth_ok                                                                         |
| `passed`                                                                        | *boolean*                                                                       | :heavy_check_mark:                                                              | N/A                                                                             |                                                                                 |
| `reason`                                                                        | [models.PrivateEndpointCheckReason](../models/private-endpoint-check-reason.md) | :heavy_minus_sign:                                                              | Why the check failed.                                                           | no_byok_key                                                                     |
| `actualModel`                                                                   | *string*                                                                        | :heavy_minus_sign:                                                              | Model the upstream reported serving, when it differs from the request.          |                                                                                 |
| `upstreamStatus`                                                                | *number*                                                                        | :heavy_minus_sign:                                                              | HTTP status returned by your deployment when the call failed.                   |                                                                                 |
| `upstreamMessage`                                                               | *string*                                                                        | :heavy_minus_sign:                                                              | Error message returned by your deployment when the call failed.                 |                                                                                 |