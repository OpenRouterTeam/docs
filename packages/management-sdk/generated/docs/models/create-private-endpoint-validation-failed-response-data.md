# CreatePrivateEndpointValidationFailedResponseData

## Example Usage

```typescript
import { CreatePrivateEndpointValidationFailedResponseData } from "@openrouter-monorepo/management-sdk-generated/models";

let value: CreatePrivateEndpointValidationFailedResponseData = {
  endpoint: {
    id: "5b1c4c4e-7d0a-4a8e-9f3a-2d6c1b0e8a11",
    status: "active",
    modelPermaslug: "openai/gpt-4o-2024-08-06",
    modelSlug: "openai/gpt-4o",
    modelName: "OpenAI: GPT-4o",
    providerName: "Azure",
    createdAt: "2026-09-24T10:30:00Z",
    declaredZdr: true,
    declaredRegion: "us",
  },
  validation: {
    passed: true,
    checks: [
      {
        name: "auth_ok",
        passed: true,
      },
    ],
  },
};
```

## Fields

| Field                                                                                         | Type                                                                                          | Required                                                                                      | Description                                                                                   |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `endpoint`                                                                                    | [models.ManagedPrivateEndpoint](../models/managed-private-endpoint.md)                        | :heavy_check_mark:                                                                            | N/A                                                                                           |
| `validation`                                                                                  | [models.PrivateEndpointValidationNullable](../models/private-endpoint-validation-nullable.md) | :heavy_check_mark:                                                                            | N/A                                                                                           |