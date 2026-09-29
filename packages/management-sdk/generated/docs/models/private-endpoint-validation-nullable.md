# PrivateEndpointValidationNullable

## Example Usage

```typescript
import { PrivateEndpointValidationNullable } from "@openrouter-monorepo/management-sdk-generated/models";

let value: PrivateEndpointValidationNullable = {
  passed: true,
  checks: [
    {
      name: "auth_ok",
      passed: true,
    },
  ],
};
```

## Fields

| Field                                                                | Type                                                                 | Required                                                             | Description                                                          | Example                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `passed`                                                             | *boolean*                                                            | :heavy_check_mark:                                                   | Whether every check passed.                                          | true                                                                 |
| `checks`                                                             | [models.PrivateEndpointCheck](../models/private-endpoint-check.md)[] | :heavy_check_mark:                                                   | N/A                                                                  |                                                                      |